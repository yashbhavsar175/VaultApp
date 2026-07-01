// ═══════════════════════════════════════════════════════════════════════════════
// TRANSACTION HELPER FUNCTIONS
// Shared utilities for transaction screens
// ═══════════════════════════════════════════════════════════════════════════════

export const getTransactionIcon = (type: string): string => {
  switch (type?.toLowerCase()) {
    case 'income': return 'trending-up';
    case 'expense': return 'trending-down';
    case 'refund': return 'cash-refund';
    case 'investment': return 'chart-line';
    case 'emi': return 'credit-card';
    case 'transfer': return 'swap-horizontal';
    case 'lent': return 'hand-coin';
    case 'borrowed': return 'hand-heart';
    default: return 'cash';
  }
};

export const getTransactionColor = (type: string): string => {
  switch (type?.toLowerCase()) {
    case 'income': return '#10b981';
    case 'expense': return '#ef4444';
    case 'refund': return '#14b8a6';
    case 'investment': return '#7c3aed';
    case 'emi': return '#f59e0b';
    case 'transfer': return '#f97316';
    case 'lent': return '#06b6d4';
    case 'borrowed': return '#ec4899';
    default: return '#999';
  }
};

export const getTransactionAmountPrefix = (type: string): string => {
  switch (type?.toLowerCase()) {
    case 'income':
    case 'refund':
      return '+';
    case 'transfer':
      return '\u2194';
    default:
      return '-';
  }
};

export const getTransactionTypeLabel = (type: string): string => {
  switch (type) {
    case 'income': return 'Income';
    case 'expense': return 'Expense';
    case 'refund': return 'Refund';
    case 'investment': return 'Investment';
    case 'emi': return 'EMI';
    case 'transfer': return 'Transfer';
    case 'lent': return 'Lent';
    case 'borrowed': return 'Borrowed';
    default:
      return type
        .replace(/[_-]/g, ' ')
        .replace(/\b\w/g, char => char.toUpperCase());
  }
};

type TransactionDisplayInput = {
  id?: string | null;
  type?: string | null;
  account_match_status?: string | null;
  primary_evidence_id?: string | null;
  account_match_reason?: string | null;
  account_match_owner_type?: string | null;
  sms_source?: string | null;
  client_idempotency_key?: string | null;
};

type ReviewCountAction = {
  label: string;
  icon: string;
  countAs: boolean;
};

const normalizeTransactionType = (type?: string | null): string => type?.toLowerCase() || '';
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CONFIRMED_EXPENSE_REASONS = new Set([
  'review_detail_expense_confirmed',
  'review_queue_expense_confirmed',
]);

export const isTransactionNotCounted = (transaction: TransactionDisplayInput): boolean =>
  transaction.account_match_status === 'ignored';

export const isTransactionPendingSync = (transaction: TransactionDisplayInput): boolean => {
  const id = transaction.id?.trim() || '';
  const clientKey = transaction.client_idempotency_key?.trim() || '';
  return Boolean(clientKey && id && id === clientKey && !UUID_PATTERN.test(id));
};

export const getTransactionSyncStatusLabel = (transaction: TransactionDisplayInput): string | null =>
  isTransactionPendingSync(transaction) ? 'Pending sync' : null;

const getIgnoredReviewLabel = (reason?: string | null): string => {
  switch (reason) {
    case 'review_detail_not_expense':
      return 'Not expense';
    case 'review_detail_not_income':
      return 'Not income';
    case 'review_detail_transfer_confirmed':
      return 'Transfer';
    case 'credit_card_bill_payment':
      return 'Card payment';
    default:
      return 'Not counted';
  }
};

// Icon that reflects BOTH the money instrument (bank account / credit card /
// debit card) and the direction (money in vs money out). This makes a bank
// credit visually distinct from a card spend or a card-bill payment.
const getInstrumentDirectionIcon = (
  ownerType: string | null | undefined,
  type: string
): string | null => {
  const normalizedType = type.toLowerCase();
  const isMoneyIn = normalizedType === 'income' || normalizedType === 'refund';
  const isMoneyOut = normalizedType === 'expense';

  switch (ownerType) {
    case 'credit_card':
      if (normalizedType === 'emi') return 'credit-card-clock-outline';
      if (isMoneyIn) return 'credit-card-refund-outline'; // refund / money back to card
      if (isMoneyOut) return 'credit-card-minus-outline'; // spent on card
      return 'credit-card-outline';
    case 'debit_card':
      if (isMoneyIn) return 'credit-card-plus-outline';
      if (isMoneyOut) return 'credit-card-minus-outline';
      return 'credit-card-outline';
    case 'bank_account':
      if (isMoneyIn) return 'bank-plus'; // money into bank
      if (isMoneyOut) return 'bank-minus'; // money out of bank
      if (normalizedType === 'transfer') return 'bank-transfer';
      return 'bank-outline';
    default:
      return null;
  }
};

export const getTransactionDisplayIcon = (transaction: TransactionDisplayInput): string => {
  if (isTransactionNotCounted(transaction)) {
    if (transaction.account_match_reason === 'review_detail_transfer_confirmed') {
      return getTransactionIcon('transfer');
    }
    if (transaction.account_match_reason === 'credit_card_bill_payment') {
      return 'credit-card-check-outline';
    }
  }

  const instrumentIcon = getInstrumentDirectionIcon(
    transaction.account_match_owner_type,
    transaction.type || ''
  );
  if (instrumentIcon) return instrumentIcon;

  return getTransactionIcon(transaction.type || '');
};

export const getTransactionDisplayColor = (transaction: TransactionDisplayInput): string => {
  if (isTransactionNotCounted(transaction)) {
    if (transaction.account_match_reason === 'review_detail_transfer_confirmed') {
      return getTransactionColor('transfer');
    }
    if (transaction.account_match_reason === 'credit_card_bill_payment') {
      return '#6366f1';
    }
  }
  return getTransactionColor(transaction.type || '');
};

export const getTransactionDisplayAmountPrefix = (transaction: TransactionDisplayInput): string => {
  if (
    isTransactionNotCounted(transaction) &&
    (
      transaction.account_match_reason === 'review_detail_transfer_confirmed' ||
      transaction.account_match_reason === 'credit_card_bill_payment'
    )
  ) {
    return getTransactionAmountPrefix('transfer');
  }
  return getTransactionAmountPrefix(transaction.type || '');
};

export const getTransactionDisplayTypeLabel = (transaction: TransactionDisplayInput): string => {
  if (isTransactionNotCounted(transaction)) return getIgnoredReviewLabel(transaction.account_match_reason);
  if (!transaction.type) return 'Transaction';
  return getTransactionTypeLabel(transaction.type);
};

export const shouldShowCountedTransactionBadge = (transaction: TransactionDisplayInput): boolean => {
  if (isTransactionNotCounted(transaction) || transaction.account_match_status === 'review_required') {
    return false;
  }
  const type = normalizeTransactionType(transaction.type);
  if (type === 'income' || type === 'refund') {
    return true;
  }
  if (type !== 'expense') {
    return false;
  }

  return (
    transaction.account_match_status === 'manual_confirmed' &&
    CONFIRMED_EXPENSE_REASONS.has(transaction.account_match_reason || '')
  );
};

export const getCountedTransactionBadgeColor = (transaction: TransactionDisplayInput): string | null => {
  if (!shouldShowCountedTransactionBadge(transaction)) return null;
  const type = normalizeTransactionType(transaction.type);
  return type === 'expense' ? '#ef4444' : '#10b981';
};

export const shouldShowReviewDecisionForTransaction = (
  transaction: TransactionDisplayInput,
  hasPrimaryEvidence: boolean
): boolean => {
  const source = normalizeTransactionType(transaction.sms_source);
  const isAutomaticTransaction = ['bank', 'notification', 'sms', 'upi'].includes(source);
  const isUserEnteredTransaction = source === '' || source === 'manual' || source === 'voice';

  return Boolean(
    hasPrimaryEvidence ||
    transaction.primary_evidence_id ||
    transaction.account_match_reason ||
    isAutomaticTransaction ||
    isUserEnteredTransaction
  );
};

export const getExpenseReviewAction = (transaction: TransactionDisplayInput): ReviewCountAction | null => {
  const type = normalizeTransactionType(transaction.type);
  const status = transaction.account_match_status;
  if (type !== 'expense' && status !== 'review_required') return null;

  const isCurrentlyCountedExpense = type === 'expense' && status !== 'ignored' && status !== 'review_required';
  return isCurrentlyCountedExpense
    ? { label: 'Mark not expense', icon: 'cash-remove', countAs: false }
    : { label: 'Count as expense', icon: 'cash-check', countAs: true };
};

export const getIncomeReviewAction = (transaction: TransactionDisplayInput): ReviewCountAction | null => {
  const type = normalizeTransactionType(transaction.type);
  const status = transaction.account_match_status;
  if (type !== 'income' && status !== 'review_required') return null;

  const isCurrentlyCountedIncome = type === 'income' && status !== 'ignored' && status !== 'review_required';
  return isCurrentlyCountedIncome
    ? { label: 'Mark not income', icon: 'cash-remove', countAs: false }
    : { label: 'Count as income', icon: 'cash-check', countAs: true };
};

export const shouldShowNeutralReviewAction = (
  transaction: TransactionDisplayInput,
  reason: string
): boolean => {
  if (transaction.account_match_status === 'ignored' && transaction.account_match_reason === reason) {
    return false;
  }
  if (reason === 'review_detail_transfer_confirmed' && normalizeTransactionType(transaction.type) === 'transfer') {
    return false;
  }
  return true;
};

export const formatTransactionDate = (dateString: string): string => {
  const date = new Date(dateString);
  return date.toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
};

export const formatTransactionDateTime = (dateString: string): {
  date: string;
  time: string;
} => {
  const date = new Date(dateString);
  return {
    date: date.toLocaleDateString('en-IN', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    }),
    time: date.toLocaleTimeString('en-IN', {
      hour: '2-digit',
      minute: '2-digit',
    }),
  };
};
