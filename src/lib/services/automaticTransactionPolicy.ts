export type AutomaticTransactionDirection = 'debit' | 'credit';

export type AutomaticTransactionReviewReason =
  | 'borrowed_money'
  | 'cash_deposit'
  | 'cash_withdrawal'
  | 'credit_card_bill_payment'
  | 'debt_repayment'
  | 'personal_transfer'
  | 'refund_or_reimbursement'
  | 'self_transfer'
  | 'unverified_credit'
  | 'unverified_debit';

export type AutomaticTransactionPolicy =
  | { action: 'post'; type: 'expense' | 'income' | 'transfer' };

const SELF_TRANSFER_PATTERN =
  /\b(?:self[\s_-]*transfer|own account|between (?:my|your)(?: own)? accounts?|account transfer)\b/i;

export function getAutomaticTransactionPolicy(
  direction: AutomaticTransactionDirection,
  text: string
): AutomaticTransactionPolicy {
  // Directly save all transactions as requested by user, removing the "needs review" feature.
  if (SELF_TRANSFER_PATTERN.test(text)) {
    return { action: 'post', type: 'transfer' };
  }
  if (direction === 'credit') {
    return { action: 'post', type: 'income' };
  }
  return { action: 'post', type: 'expense' };
}
