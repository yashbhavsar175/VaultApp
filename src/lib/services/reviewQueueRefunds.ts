import {
  createLinkedRefundTransaction,
  findDuplicateLinkedRefundTransaction,
} from '../core';
import { markPosted, ReviewItem } from './autoTransactionReviewQueue';
import { Transaction } from '../../types';

const AMOUNT_EPSILON = 0.01;
const MATCH_WINDOW_MS = 90 * 24 * 60 * 60 * 1000;
const DUPLICATE_WINDOW_MS = 24 * 60 * 60 * 1000;
const MAX_NOTE_LENGTH = 80;

export type RefundExpenseMatch = {
  transaction: Transaction;
  score: number;
  reasons: string[];
};

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

function normalize(value?: string | null): string {
  return value?.trim().toLowerCase() || '';
}

function sanitizeRefundLabel(value?: string | null): string {
  if (!value) return '';

  return value
    .replace(/\b(?:otp|one\s*time\s*password|verification\s*code|security\s*code)\b[^,.]*/gi, '')
    .replace(/\b(?:\+?91[-\s]?)?[6-9]\d{9}\b/g, '[redacted]')
    .replace(/\b(?:\d[ -]?){6,}\b/g, '[redacted]')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_NOTE_LENGTH);
}

function looksLikeRawRefundText(value: string): boolean {
  return /\b(credited|debited|refund|account|a\/c|upi|utr|inr|rs\.?|otp|available balance)\b/i.test(value);
}

export function buildRefundNote(item: ReviewItem): string {
  const merchant = sanitizeRefundLabel(item.candidate.merchantOrPerson);
  const source = sanitizeRefundLabel(item.candidate.redactedPreview.detectedSource);

  if (merchant && !looksLikeRawRefundText(merchant)) return merchant;
  if (source) return `Refund from ${source}`;
  return 'Linked refund';
}

function scoreExpenseMatch(item: ReviewItem, tx: Transaction): RefundExpenseMatch | null {
  const amount = item.candidate.amount;
  if (!amount || amount <= 0) return null;
  if (tx.type !== 'expense') return null;
  if (Number(tx.amount) + AMOUNT_EPSILON < amount) return null;

  const candidateTime = getCandidateTimestamp(item);
  const txTime = new Date(tx.created_at).getTime();
  if (Number.isFinite(txTime)) {
    if (txTime > candidateTime + DUPLICATE_WINDOW_MS) return null;
    if (candidateTime - txTime > MATCH_WINDOW_MS) return null;
  }

  let score = 0;
  const reasons: string[] = [];

  score += 20;
  reasons.push('expense');

  if (isSameAmount(Number(tx.amount), amount)) {
    score += 12;
    reasons.push('same amount');
  } else if (Number(tx.amount) > amount) {
    score += 8;
    reasons.push('covers refund amount');
  }

  const candidateLast4 = normalize(item.candidate.last4);
  if (candidateLast4 && normalize(tx.account_last4) === candidateLast4) {
    score += 12;
    reasons.push('same account');
  }

  const merchant = normalize(item.candidate.merchantOrPerson);
  const source = normalize(item.candidate.redactedPreview.detectedSource);
  const txText = normalize(`${tx.note || ''} ${tx.category || ''}`);
  if (merchant && txText.includes(merchant)) {
    score += 18;
    reasons.push('similar merchant');
  } else if (source && txText.includes(source)) {
    score += 8;
    reasons.push('similar source');
  }

  if (Number.isFinite(txTime)) {
    const ageDays = Math.abs(candidateTime - txTime) / (24 * 60 * 60 * 1000);
    if (ageDays <= 7) {
      score += 10;
      reasons.push('recent');
    } else if (ageDays <= 30) {
      score += 6;
      reasons.push('within 30 days');
    }
  }

  return { transaction: tx, score, reasons };
}

export function getRefundExpenseMatches(
  item: ReviewItem,
  transactions: Transaction[]
): RefundExpenseMatch[] {
  return transactions
    .map(tx => scoreExpenseMatch(item, tx))
    .filter((match): match is RefundExpenseMatch => Boolean(match))
    .sort((left, right) => {
      if (right.score !== left.score) return right.score - left.score;
      return new Date(right.transaction.created_at).getTime() -
        new Date(left.transaction.created_at).getTime();
    });
}

export function findLocalDuplicateLinkedRefund(
  item: ReviewItem,
  originalExpense: Transaction,
  transactions: Transaction[]
): Transaction | null {
  const reference = normalize(item.candidate.reference);
  const candidateTime = getCandidateTimestamp(item);

  return transactions.find(tx => {
    if (tx.type !== 'refund') return false;
    if (tx.refund_of_transaction_id !== originalExpense.id) return false;
    if (!isSameAmount(Number(tx.amount), item.candidate.amount)) return false;

    const txReference = normalize(tx.reference_number);
    if (reference && txReference === reference) return true;

    const txTime = new Date(tx.created_at).getTime();
    return Number.isFinite(txTime) &&
      Math.abs(txTime - candidateTime) <= DUPLICATE_WINDOW_MS;
  }) || null;
}

export function isRefundSchemaMissingError(error: unknown): boolean {
  const message = String((error as { message?: unknown })?.message || error).toLowerCase();
  return message.includes('refund_of_transaction_id') ||
    message.includes('transactions_type_check') ||
    message.includes('schema cache') ||
    message.includes('column') ||
    message.includes('invalid input value for enum') ||
    (message.includes('violates check constraint') && message.includes('refund'));
}

export async function recordReviewQueueRefund(
  item: ReviewItem,
  originalExpense: Transaction | undefined,
  transactions: Transaction[] = []
): Promise<{ status: 'posted' | 'duplicate'; transactionId: string }> {
  if (item.candidate.autoClass !== 'refund') {
    throw new Error('Unsupported review item for refund');
  }

  if (!item.candidate.amount || item.candidate.amount <= 0) {
    throw new Error('Valid refund amount required');
  }

  if (!originalExpense) {
    throw new Error('Original expense selection required');
  }

  if (originalExpense.type !== 'expense') {
    throw new Error('Original transaction must be an expense');
  }

  if (Number(originalExpense.amount) + AMOUNT_EPSILON < item.candidate.amount) {
    throw new Error('Refund cannot exceed original expense');
  }

  const localDuplicate = findLocalDuplicateLinkedRefund(item, originalExpense, transactions);
  if (localDuplicate) {
    await markPosted(item.id, localDuplicate.id);
    return { status: 'duplicate', transactionId: localDuplicate.id };
  }

  const duplicate = await findDuplicateLinkedRefundTransaction({
    amount: item.candidate.amount,
    refundOfTransactionId: originalExpense.id,
    reference_number: item.candidate.reference || undefined,
  });

  if (duplicate) {
    await markPosted(item.id, duplicate.id);
    return { status: 'duplicate', transactionId: duplicate.id };
  }

  const refund = await createLinkedRefundTransaction({
    amount: item.candidate.amount,
    refundOfTransactionId: originalExpense.id,
    note: buildRefundNote(item),
    category: 'Refund',
    reference_number: item.candidate.reference || undefined,
    account_id: originalExpense.account_id || undefined,
    account_last4: originalExpense.account_last4 || item.candidate.last4 || undefined,
  });

  await markPosted(item.id, refund.id);
  return { status: 'posted', transactionId: refund.id };
}
