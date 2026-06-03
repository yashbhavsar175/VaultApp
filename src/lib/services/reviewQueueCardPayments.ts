import {
  addCreditCard,
  addCCTransaction,
  archiveBankAccountIfSupported,
  CreditCard,
  getCardTransactions,
} from '../database/financial';
import { BankAccount } from '../../types';
import { markPosted, ReviewItem } from './autoTransactionReviewQueue';
import { getLatestBalanceSnapshot } from './balanceSnapshots';
import { emitFinanceDataChanged } from './dataEvents';

const DUPLICATE_WINDOW_MS = 10 * 60 * 1000;
const MAX_DESCRIPTION_LENGTH = 80;
const SNAPSHOT_AMOUNT_TOLERANCE = 0.01;

export type CardMatchResult =
  | { status: 'matched'; card: CreditCard }
  | { status: 'needs_legacy_link'; legacyAccount: BankAccount; last4: string }
  | { status: 'needs_selection' }
  | { status: 'needs_setup' };

export type LegacyCreditCardLinkResult = {
  card: CreditCard;
  reusedExisting: boolean;
  archivedLegacy: boolean;
  outstandingInference: LegacyCreditCardOutstandingInference;
};

export type LegacyCreditCardBalanceKind =
  | 'available_limit'
  | 'outstanding'
  | 'used'
  | 'unknown';

export type LegacyCreditCardLinkContext = {
  balanceKind?: LegacyCreditCardBalanceKind | null;
};

export type LegacyCreditCardOutstandingInference = {
  currentOutstanding: number;
  source: 'explicit_outstanding' | 'available_credit' | 'ambiguous_default';
  needsUserConfirmation: boolean;
};

function safeLast4(value?: string | null): string | null {
  const digits = value?.replace(/\D/g, '') || '';
  return digits.length >= 4 ? digits.slice(-4) : null;
}

function getCandidateTimestamp(item: ReviewItem): number {
  const signalId = item.candidate.signalId || item.id;
  const match = signalId.match(/^sig_(\d+)_/);
  return match ? Number.parseInt(match[1], 10) : Date.now();
}

export function resolveCreditCardMatch(
  item: ReviewItem,
  cards: CreditCard[],
  legacyCreditCardAccounts: BankAccount[] = []
): CardMatchResult {
  const last4 = safeLast4(item.candidate.cardLast4 || item.candidate.last4);
  if (!last4) {
    return cards.length === 0 && legacyCreditCardAccounts.length === 0
      ? { status: 'needs_setup' }
      : { status: 'needs_selection' };
  }

  const matches = cards.filter(card => safeLast4(card.last_4_digits) === last4);
  if (matches.length === 1) {
    return { status: 'matched', card: matches[0] };
  }
  if (matches.length > 1) {
    return { status: 'needs_selection' };
  }

  const legacyMatches = legacyCreditCardAccounts.filter(account =>
    account.account_type === 'credit_card' &&
    safeLast4(account.account_last4) === last4
  );
  if (legacyMatches.length === 1) {
    return { status: 'needs_legacy_link', legacyAccount: legacyMatches[0], last4 };
  }
  if (legacyMatches.length > 1) {
    return { status: 'needs_selection' };
  }

  return cards.length === 0 ? { status: 'needs_setup' } : { status: 'needs_selection' };
}

function finiteMoney(value: unknown): number {
  const amount = Number(value);
  return Number.isFinite(amount) && amount > 0 ? amount : 0;
}

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

function normalizeBalanceKind(value: unknown): LegacyCreditCardBalanceKind | null {
  if (typeof value !== 'string') return null;
  const normalized = value.toLowerCase().replace(/[^a-z0-9]+/g, '_');
  if (normalized === 'available_limit' || normalized === 'available_credit') return 'available_limit';
  if (normalized === 'outstanding' || normalized === 'current_outstanding') return 'outstanding';
  if (normalized === 'used' || normalized === 'used_amount') return 'used';
  return null;
}

function legacyRowBalanceKind(account: BankAccount): LegacyCreditCardBalanceKind | null {
  const row = account as unknown as Record<string, unknown>;
  return normalizeBalanceKind(row.balance_kind)
    || normalizeBalanceKind(row.balanceKind)
    || normalizeBalanceKind(row.balance_source)
    || normalizeBalanceKind(row.balanceSource);
}

function explicitOutstanding(account: BankAccount): number | null {
  const row = account as unknown as Record<string, unknown>;
  const value = row.current_outstanding ?? row.outstanding ?? row.used_amount ?? row.usedAmount;
  if (value === undefined || value === null || value === '') return null;

  const amount = Number(value);
  return Number.isFinite(amount) && amount >= 0 ? roundMoney(amount) : null;
}

function amountsMatch(left: number, right: number): boolean {
  return Math.abs(left - right) <= SNAPSHOT_AMOUNT_TOLERANCE;
}

async function snapshotBalanceKindForLegacyCard(
  account: BankAccount
): Promise<LegacyCreditCardBalanceKind | null> {
  const legacyBalance = finiteMoney(account.balance ?? account.starting_balance);
  if (legacyBalance <= 0) return null;

  try {
    const [availableLimit, outstanding] = await Promise.all([
      getLatestBalanceSnapshot('bank_account', account.id, 'available_limit'),
      getLatestBalanceSnapshot('bank_account', account.id, 'outstanding'),
    ]);

    if (availableLimit && amountsMatch(Number(availableLimit.amount), legacyBalance)) {
      return 'available_limit';
    }
    if (outstanding && amountsMatch(Number(outstanding.amount), legacyBalance)) {
      return 'outstanding';
    }
  } catch {
    return null;
  }

  return null;
}

export function inferLegacyCreditCardOutstanding(
  account: BankAccount,
  context: LegacyCreditCardLinkContext = {}
): LegacyCreditCardOutstandingInference {
  const outstanding = explicitOutstanding(account);
  if (outstanding !== null) {
    return {
      currentOutstanding: outstanding,
      source: 'explicit_outstanding',
      needsUserConfirmation: false,
    };
  }

  const creditLimit = finiteMoney(account.credit_limit);
  const legacyBalance = finiteMoney(account.balance ?? account.starting_balance);
  const balanceKind = context.balanceKind || legacyRowBalanceKind(account);

  if (creditLimit > 0 && legacyBalance > 0) {
    if (balanceKind === 'available_limit') {
      return {
        currentOutstanding: roundMoney(Math.max(creditLimit - Math.min(legacyBalance, creditLimit), 0)),
        source: 'available_credit',
        needsUserConfirmation: false,
      };
    }

    if (balanceKind === 'outstanding' || balanceKind === 'used') {
      return {
        currentOutstanding: roundMoney(Math.min(legacyBalance, creditLimit)),
        source: 'explicit_outstanding',
        needsUserConfirmation: false,
      };
    }

    if (legacyBalance <= creditLimit && legacyBalance >= creditLimit * 0.8) {
      return {
        currentOutstanding: roundMoney(Math.max(creditLimit - legacyBalance, 0)),
        source: 'available_credit',
        needsUserConfirmation: false,
      };
    }
  }

  return {
    currentOutstanding: 0,
    source: 'ambiguous_default',
    needsUserConfirmation: true,
  };
}

export async function linkLegacyCreditCardAccount(
  legacyAccount: BankAccount,
  existingCards: CreditCard[] = [],
  context: LegacyCreditCardLinkContext = {}
): Promise<LegacyCreditCardLinkResult> {
  if (legacyAccount.account_type !== 'credit_card') {
    throw new Error('Legacy credit card account required');
  }

  const last4 = safeLast4(legacyAccount.account_last4);
  if (!last4) {
    throw new Error('Valid card last4 required');
  }

  const existing = existingCards.find(card => safeLast4(card.last_4_digits) === last4);
  const snapshotBalanceKind = context.balanceKind
    ? null
    : await snapshotBalanceKindForLegacyCard(legacyAccount);
  const outstandingInference = inferLegacyCreditCardOutstanding(
    legacyAccount,
    snapshotBalanceKind ? { ...context, balanceKind: snapshotBalanceKind } : context
  );
  const card = existing || await addCreditCard({
    bank_name: legacyAccount.bank_name,
    card_name: `${legacyAccount.bank_name} card ${last4}`,
    last_4_digits: last4,
    credit_limit: finiteMoney(legacyAccount.credit_limit),
    current_outstanding: outstandingInference.currentOutstanding,
    due_date: 1,
    billing_cycle_date: 1,
  });

  const archivedLegacy = await archiveBankAccountIfSupported(legacyAccount.id);
  emitFinanceDataChanged({
    areas: ['accounts', 'balances', 'review'],
    source: existing ? 'legacy_credit_card_link:reused' : 'legacy_credit_card_link:created',
    transactionId: card.id,
  });

  return { card, reusedExisting: Boolean(existing), archivedLegacy, outstandingInference };
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
    emitFinanceDataChanged({
      areas: ['transactions', 'accounts', 'balances', 'review'],
      source: 'review_card_payment:duplicate',
      transactionId: duplicate.id,
    });
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
  emitFinanceDataChanged({
    areas: ['transactions', 'accounts', 'balances', 'review'],
    source: 'review_card_payment:posted',
    transactionId: ccTransaction.id,
  });
  return { status: 'posted', ccTransactionId: ccTransaction.id };
}
