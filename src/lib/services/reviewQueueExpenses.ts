import { BankAccount, Transaction } from '../../types';
import { addTransaction, getTransactions } from '../core';
import { markPosted, ReviewItem } from './autoTransactionReviewQueue';
import { linkEvidenceToTransaction } from './transactionEvidence';

export const REVIEWED_EXPENSE_CATEGORY = 'Reviewed Expense';
export const REVIEWED_EXPENSE_NOTE = 'Reviewed expense';
export const REVIEWED_EXPENSE_REASON = 'review_queue_expense_confirmed';

const DEBIT_REVIEW_REASON = 'Debit needs confirmation before counting as an expense';
const DUPLICATE_WINDOW_MS = 24 * 60 * 60 * 1000;
const AMOUNT_EPSILON = 0.01;
const inFlightReviewIds = new Set<string>();

function safeLast4(value?: string | null): string | undefined {
  const digits = (value || '').replace(/\D/g, '');
  return digits.length === 4 ? digits : undefined;
}

function safeReference(value?: string | null): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed || !/^[A-Za-z0-9_-]{6,64}$/.test(trimmed)) return undefined;
  return trimmed;
}

export function sanitizeReviewedExpenseSourceToken(value?: string | null): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed || trimmed.length > 96) return undefined;
  if (/^(?:\+?91)?\d{10}$/.test(trimmed.replace(/[\s()-]/g, ''))) return undefined;
  return /^[A-Za-z0-9._-]+$/.test(trimmed) ? trimmed : undefined;
}

function getCandidateTimestamp(item: ReviewItem): number {
  const signalId = item.candidate.signalId || item.id;
  const match = signalId.match(/^sig_(\d+)_/);
  if (match) return Number.parseInt(match[1], 10);
  return item.createdAt || Date.now();
}

function isSameAmount(left?: number | null, right?: number | null): boolean {
  if (left == null || right == null) return false;
  return Math.abs(Number(left) - Number(right)) <= AMOUNT_EPSILON;
}

function isSupportedOrdinaryDebitClass(item: ReviewItem): boolean {
  if (!item.candidate.autoClass && item.candidate.direction === 'debit') return true;
  return [
    'bank_debit',
    'upi_payment',
    'credit_card_spend',
    'unknown_financial',
  ].includes(item.candidate.autoClass);
}

export function isReviewedDebitCandidate(item: ReviewItem): boolean {
  const debitDirection = item.candidate.direction === 'debit' ||
    item.reasons.includes(DEBIT_REVIEW_REASON);
  return debitDirection && isSupportedOrdinaryDebitClass(item);
}

function selectedAccountLast4(
  selectedAccount?: BankAccount,
  candidateLast4?: string | null
): string | undefined {
  return safeLast4(selectedAccount?.account_last4) || safeLast4(candidateLast4);
}

export function findDuplicateReviewedExpense(
  item: ReviewItem,
  transactions: Transaction[],
  selectedAccount?: BankAccount,
): Transaction | null {
  const amount = item.candidate.amount;
  if (!amount || amount <= 0) return null;

  const reference = safeReference(item.candidate.reference)?.toLowerCase();
  const accountLast4 = selectedAccountLast4(selectedAccount, item.candidate.last4);
  const evidenceId = item.candidate.evidenceId?.trim();
  const candidateTimestamp = getCandidateTimestamp(item);

  return transactions.find(transaction => {
    if (transaction.type !== 'expense') return false;
    if (!isSameAmount(transaction.amount, amount)) return false;

    if (evidenceId && transaction.primary_evidence_id === evidenceId) return true;
    if (reference && transaction.reference_number?.trim().toLowerCase() === reference) return true;

    const transactionTimestamp = new Date(transaction.created_at).getTime();
    if (!Number.isFinite(transactionTimestamp)) return false;
    if (Math.abs(transactionTimestamp - candidateTimestamp) > DUPLICATE_WINDOW_MS) return false;

    if (accountLast4) return safeLast4(transaction.account_last4) === accountLast4;
    return transaction.note === REVIEWED_EXPENSE_NOTE &&
      transaction.category === REVIEWED_EXPENSE_CATEGORY;
  }) || null;
}

async function linkOptionalEvidence(item: ReviewItem, transactionId: string): Promise<void> {
  const evidenceId = item.candidate.evidenceId?.trim();
  if (!evidenceId) return;

  try {
    await linkEvidenceToTransaction(
      evidenceId,
      transactionId,
      'linked',
      item.candidate.confidenceLevel,
      REVIEWED_EXPENSE_REASON,
    );
  } catch {
    console.warn('[ReviewQueueExpense] Evidence link deferred', {
      evidenceLinkFailed: true,
    });
  }
}

export async function recordReviewQueueExpense(
  item: ReviewItem,
  selectedAccount?: BankAccount,
): Promise<{ status: 'posted' | 'duplicate'; transactionId: string }> {
  if (!isReviewedDebitCandidate(item)) {
    throw new Error('Unsupported review item for expense');
  }
  if (!item.candidate.amount || item.candidate.amount <= 0) {
    throw new Error('Valid amount required');
  }
  if (inFlightReviewIds.has(item.id)) {
    throw new Error('Expense review is already being saved');
  }

  inFlightReviewIds.add(item.id);
  try {
    const transactions = await getTransactions();
    const duplicate = findDuplicateReviewedExpense(item, transactions, selectedAccount);
    if (duplicate) {
      await linkOptionalEvidence(item, duplicate.id);
      await markPosted(item.id, duplicate.id);
      return { status: 'duplicate', transactionId: duplicate.id };
    }

    const sourceToken = sanitizeReviewedExpenseSourceToken(
      item.candidate.redactedPreview.detectedSource
    );
    const sourceType = item.candidate.sourceType === 'notification' ? 'notification' : 'sms';
    const transaction = await addTransaction({
      amount: item.candidate.amount,
      type: 'expense',
      category: REVIEWED_EXPENSE_CATEGORY,
      note: REVIEWED_EXPENSE_NOTE,
      created_at: new Date(getCandidateTimestamp(item)).toISOString(),
      account_id: selectedAccount?.id,
      account_last4: selectedAccountLast4(selectedAccount, item.candidate.last4),
      reference_number: safeReference(item.candidate.reference),
      sms_source: sourceType,
      sms_sender: sourceToken,
      account_match_status: 'manual_confirmed',
      account_match_confidence: item.candidate.confidenceLevel,
      account_match_reason: REVIEWED_EXPENSE_REASON,
    });

    await linkOptionalEvidence(item, transaction.id);
    await markPosted(item.id, transaction.id);
    return { status: 'posted', transactionId: transaction.id };
  } finally {
    inFlightReviewIds.delete(item.id);
  }
}
