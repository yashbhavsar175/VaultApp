import {
  addCCTransaction,
  CreditCard,
  getCardTransactions,
} from '../database/financial';
import { markPosted, ReviewItem } from './autoTransactionReviewQueue';

const DUPLICATE_WINDOW_MS = 10 * 60 * 1000;
const MAX_DESCRIPTION_LENGTH = 80;

export type CardMatchResult =
  | { status: 'matched'; card: CreditCard }
  | { status: 'needs_selection' }
  | { status: 'needs_setup' };

function getCandidateTimestamp(item: ReviewItem): number {
  const signalId = item.candidate.signalId || item.id;
  const match = signalId.match(/^sig_(\d+)_/);
  return match ? Number.parseInt(match[1], 10) : Date.now();
}

export function resolveCreditCardMatch(
  item: ReviewItem,
  cards: CreditCard[]
): CardMatchResult {
  if (cards.length === 0) {
    return { status: 'needs_setup' };
  }

  const last4 = item.candidate.last4?.trim();
  if (!last4) {
    return { status: 'needs_selection' };
  }

  const matches = cards.filter(card => card.last_4_digits === last4);
  if (matches.length === 1) {
    return { status: 'matched', card: matches[0] };
  }

  return { status: 'needs_selection' };
}

export function buildCardPaymentDescription(item: ReviewItem): string {
  const source = sanitizeCardPaymentLabel(item.candidate.redactedPreview.detectedSource);
  const merchant = sanitizeCardPaymentLabel(item.candidate.merchantOrPerson);

  if (merchant && !looksLikeRawPaymentText(merchant)) return merchant;
  if (source) return `Card payment from ${source}`;
  return 'Credit card bill payment';
}

function sanitizeCardPaymentLabel(value?: string | null): string {
  if (!value) return '';

  return value
    .replace(/\b(?:otp|one\s*time\s*password|verification\s*code|security\s*code)\b[^,.]*/gi, '')
    .replace(/\b(?:\d[ -]?){6,}\b/g, '[redacted]')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_DESCRIPTION_LENGTH);
}

function looksLikeRawPaymentText(value: string): boolean {
  return /\b(payment|received|towards|credit\s*card|ending|debited|credited|inr|rs\.?)\b/i.test(value);
}

export async function findDuplicateCardPayment(
  cardId: string,
  amount: number,
  candidateTimestamp: number
) {
  const cardTransactions = await getCardTransactions(cardId);

  return cardTransactions.find(tx => {
    if (tx.type !== 'payment') return false;
    if (Number(tx.amount) !== amount) return false;

    const txTime = new Date(tx.transaction_date).getTime();
    return Math.abs(txTime - candidateTimestamp) <= DUPLICATE_WINDOW_MS;
  }) || null;
}

export async function recordReviewQueueCardPayment(
  item: ReviewItem,
  cardId?: string
): Promise<{ status: 'posted' | 'duplicate'; ccTransactionId: string }> {
  if (item.candidate.autoClass !== 'credit_card_bill_payment') {
    throw new Error('Unsupported review item for card payment');
  }

  if (!item.candidate.amount || item.candidate.amount <= 0) {
    throw new Error('Valid amount required');
  }

  if (!cardId) {
    throw new Error('Credit card selection required');
  }

  const candidateTimestamp = getCandidateTimestamp(item);
  const duplicate = await findDuplicateCardPayment(
    cardId,
    item.candidate.amount,
    candidateTimestamp
  );

  if (duplicate) {
    await markPosted(item.id, duplicate.id);
    return { status: 'duplicate', ccTransactionId: duplicate.id };
  }

  const ccTransaction = await addCCTransaction({
    card_id: cardId,
    amount: item.candidate.amount,
    description: buildCardPaymentDescription(item),
    category: 'Credit Card Bill Payment',
    type: 'payment',
    transaction_date: new Date(candidateTimestamp),
  });

  await markPosted(item.id, ccTransaction.id);
  return { status: 'posted', ccTransactionId: ccTransaction.id };
}
