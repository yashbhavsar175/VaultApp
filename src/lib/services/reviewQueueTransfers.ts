import {
  createTransferTransaction,
  getTransactions,
} from '../core';
import { markPosted, ReviewItem } from './autoTransactionReviewQueue';
import { BankAccount, Transaction } from '../../types';

const DUPLICATE_WINDOW_MS = 24 * 60 * 60 * 1000;
const AMOUNT_EPSILON = 0.01;
const MAX_NOTE_LENGTH = 80;

export type TransferSelectionResult = {
  status: 'ready' | 'needs_selection' | 'needs_setup';
  fromAccountId?: string;
  toAccountId?: string;
};

function getCandidateTimestamp(item: ReviewItem): number {
  const signalId = item.candidate.signalId || item.id;
  const match = signalId.match(/^sig_(\d+)_/);
  return match ? Number.parseInt(match[1], 10) : Date.now();
}

function isSameAmount(left?: number | null, right?: number | null): boolean {
  if (left == null || right == null) return false;
  return Math.abs(Number(left) - Number(right)) <= AMOUNT_EPSILON;
}

function getCandidateString(source: unknown, keys: string[]): string | undefined {
  if (!source || typeof source !== 'object') return undefined;
  const record = source as Record<string, unknown>;

  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }

  return undefined;
}

function resolveUniqueLast4(accounts: BankAccount[], last4?: string | null): string | undefined {
  if (!last4) return undefined;

  const matches = accounts.filter(account => account.account_last4 === last4.trim());
  return matches.length === 1 ? matches[0].id : undefined;
}

export function getEligibleTransferAccounts(accounts: BankAccount[]): BankAccount[] {
  return accounts.filter(account =>
    account.account_type === 'savings' || account.account_type === 'current'
  );
}

export function resolveTransferSelection(
  item: ReviewItem,
  accounts: BankAccount[]
): TransferSelectionResult {
  const eligibleAccounts = getEligibleTransferAccounts(accounts);
  if (eligibleAccounts.length < 2) {
    return { status: 'needs_setup' };
  }

  const candidate = item.candidate as unknown as Record<string, unknown>;
  const fromLast4 = getCandidateString(candidate, [
    'from_account_last4',
    'fromAccountLast4',
    'source_account_last4',
    'sourceAccountLast4',
  ]);
  const toLast4 = getCandidateString(candidate, [
    'to_account_last4',
    'toAccountLast4',
    'destination_account_last4',
    'destinationAccountLast4',
  ]);

  const fromAccountId = resolveUniqueLast4(eligibleAccounts, fromLast4);
  const toAccountId = resolveUniqueLast4(eligibleAccounts, toLast4);

  if (fromAccountId && toAccountId && fromAccountId !== toAccountId) {
    return { status: 'ready', fromAccountId, toAccountId };
  }

  const singleAccountHint = resolveUniqueLast4(eligibleAccounts, item.candidate.last4);
  if (singleAccountHint) {
    return { status: 'needs_selection', fromAccountId: singleAccountHint };
  }

  return { status: 'needs_selection' };
}

export function canRecordTransfer(
  item: ReviewItem,
  accounts: BankAccount[],
  fromAccountId?: string,
  toAccountId?: string
): boolean {
  const eligibleAccounts = getEligibleTransferAccounts(accounts);
  const eligibleIds = new Set(eligibleAccounts.map(account => account.id));

  return item.candidate.autoClass === 'self_transfer' &&
    !!item.candidate.amount &&
    item.candidate.amount > 0 &&
    eligibleAccounts.length >= 2 &&
    !!fromAccountId &&
    !!toAccountId &&
    fromAccountId !== toAccountId &&
    eligibleIds.has(fromAccountId) &&
    eligibleIds.has(toAccountId);
}

function sanitizeTransferLabel(value?: string | null): string {
  if (!value) return '';

  return value
    .replace(/\b(?:otp|one\s*time\s*password|verification\s*code|security\s*code)\b[^,.]*/gi, '')
    .replace(/\b(?:\d[ -]?){6,}\b/g, '[redacted]')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_NOTE_LENGTH);
}

function looksLikeRawTransferText(value: string): boolean {
  return /\b(transferred|transfer|debited|credited|account|a\/c|upi|utr|inr|rs\.?|otp)\b/i.test(value);
}

export function buildTransferNote(item: ReviewItem): string {
  const merchant = sanitizeTransferLabel(item.candidate.merchantOrPerson);
  const source = sanitizeTransferLabel(item.candidate.redactedPreview.detectedSource);

  if (merchant && !looksLikeRawTransferText(merchant)) return merchant;
  if (source) return `Transfer from ${source}`;
  return 'Self transfer';
}

export async function findDuplicateTransfer(
  amount: number,
  fromAccountId: string,
  toAccountId: string,
  candidateTimestamp: number,
  reference?: string | null
): Promise<Transaction | null> {
  const transactions = await getTransactions();
  const normalizedReference = reference?.trim().toLowerCase();

  if (normalizedReference) {
    const byReference = transactions.find(tx =>
      tx.type === 'transfer' &&
      isSameAmount(Number(tx.amount), amount) &&
      tx.reference_number?.trim().toLowerCase() === normalizedReference
    );
    if (byReference) return byReference;
  }

  return transactions.find(tx => {
    if (tx.type !== 'transfer') return false;
    if (!isSameAmount(Number(tx.amount), amount)) return false;
    if (tx.from_account_id !== fromAccountId) return false;
    if (tx.to_account_id !== toAccountId) return false;

    const txTime = new Date(tx.created_at).getTime();
    return Math.abs(txTime - candidateTimestamp) <= DUPLICATE_WINDOW_MS;
  }) || null;
}

export async function recordReviewQueueTransfer(
  item: ReviewItem,
  fromAccountId?: string,
  toAccountId?: string,
  accounts: BankAccount[] = []
): Promise<{ status: 'posted' | 'duplicate'; transactionId: string }> {
  if (item.candidate.autoClass !== 'self_transfer') {
    throw new Error('Unsupported review item for transfer');
  }

  if (!item.candidate.amount || item.candidate.amount <= 0) {
    throw new Error('Valid amount required');
  }

  if (!fromAccountId) {
    throw new Error('From account selection required');
  }

  if (!toAccountId) {
    throw new Error('To account selection required');
  }

  if (fromAccountId === toAccountId) {
    throw new Error('Transfer source and destination must be different accounts');
  }

  if (!canRecordTransfer(item, accounts, fromAccountId, toAccountId)) {
    throw new Error('Eligible bank account selection required');
  }

  const candidateTimestamp = getCandidateTimestamp(item);
  const duplicate = await findDuplicateTransfer(
    item.candidate.amount,
    fromAccountId,
    toAccountId,
    candidateTimestamp,
    item.candidate.reference
  );

  if (duplicate) {
    await markPosted(item.id, duplicate.id);
    return { status: 'duplicate', transactionId: duplicate.id };
  }

  const transfer = await createTransferTransaction({
    amount: item.candidate.amount,
    from_account_id: fromAccountId,
    to_account_id: toAccountId,
    note: buildTransferNote(item),
    reference_number: item.candidate.reference || undefined,
  });

  await markPosted(item.id, transfer.id);
  return { status: 'posted', transactionId: transfer.id };
}
