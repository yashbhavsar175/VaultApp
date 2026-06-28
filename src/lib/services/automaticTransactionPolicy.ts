export type AutomaticTransactionDirection = 'debit' | 'credit';

export type AutomaticTransactionReviewReason =
  | 'borrowed_money'
  | 'cash_deposit'
  | 'cash_withdrawal'
  | 'credit_card_bill_payment'
  | 'debt_repayment'
  | 'foreign_currency_estimate'
  | 'personal_transfer'
  | 'refund_or_reimbursement'
  | 'self_transfer'
  | 'unverified_credit'
  | 'unverified_debit';

export type AutomaticTransactionPolicy =
  | {
    action: 'post';
    type: 'expense' | 'income' | 'transfer';
    accountMatchStatus: 'manual_confirmed' | 'review_required' | 'ignored';
    accountMatchReason: AutomaticTransactionReviewReason | 'auto_confirmed_expense' | 'auto_confirmed_income';
    accountMatchConfidence?: 'high' | 'medium' | 'low';
  };

const SELF_TRANSFER_PATTERN =
  /\b(?:self[\s_-]*transfer|own account|between (?:my|your)(?: own)? accounts?|account transfer)\b/i;
const CARD_PAYMENT_PATTERN =
  /\b(?:credit\s*card|card)\b.{0,80}\b(?:payment|bill|paid|received|settled)\b|\b(?:payment|bill)\b.{0,80}\b(?:credit\s*card|card)\b/i;
const REFUND_PATTERN =
  /\b(?:refund(?:ed)?|reversal|reimburs(?:ed|ement)|chargeback|cashback)\b/i;
const CASH_DEPOSIT_PATTERN =
  /\b(?:cash\s+deposit|deposited\s+cash|cash\s+credited)\b/i;
const CASH_WITHDRAWAL_PATTERN =
  /\b(?:cash\s+withdraw(?:al|n)?|atm\s+withdraw(?:al|n)?|withdrawn\s+from\s+atm)\b/i;
const PERSONAL_TRANSFER_PATTERN =
  /\b(?:from|to)\s+(?:brother|sister|friend|father|mother|dad|mom|wife|husband|relative|family)\b/i;
const SALARY_INCOME_PATTERN =
  /\b(?:salary|payroll|stipend|freelance|freelancer|client\s+payment|business\s+income|gig\s+(?:work|payment)|payout)\b/i;

export function getAutomaticTransactionPolicy(
  direction: AutomaticTransactionDirection,
  text: string
): AutomaticTransactionPolicy {
  if (SELF_TRANSFER_PATTERN.test(text)) {
    return {
      action: 'post',
      type: 'transfer',
      accountMatchStatus: 'ignored',
      accountMatchReason: 'self_transfer',
      accountMatchConfidence: 'high',
    };
  }

  if (CARD_PAYMENT_PATTERN.test(text)) {
    return {
      action: 'post',
      type: 'transfer',
      accountMatchStatus: 'ignored',
      accountMatchReason: 'credit_card_bill_payment',
      accountMatchConfidence: 'high',
    };
  }

  if (REFUND_PATTERN.test(text)) {
    return {
      action: 'post',
      type: direction === 'credit' ? 'income' : 'expense',
      accountMatchStatus: 'review_required',
      accountMatchReason: 'refund_or_reimbursement',
      accountMatchConfidence: 'medium',
    };
  }

  if (CASH_DEPOSIT_PATTERN.test(text)) {
    return {
      action: 'post',
      type: 'income',
      accountMatchStatus: 'review_required',
      accountMatchReason: 'cash_deposit',
      accountMatchConfidence: 'medium',
    };
  }

  if (CASH_WITHDRAWAL_PATTERN.test(text)) {
    return {
      action: 'post',
      type: 'expense',
      accountMatchStatus: 'review_required',
      accountMatchReason: 'cash_withdrawal',
      accountMatchConfidence: 'medium',
    };
  }

  // Detect personal transfers (from/to brother, sister, friend etc.)
  if (PERSONAL_TRANSFER_PATTERN.test(text)) {
    if (direction === 'credit') {
      return {
        action: 'post',
        type: 'income',
        accountMatchStatus: 'review_required',
        accountMatchReason: 'personal_transfer',
        accountMatchConfidence: 'medium',
      };
    }
    return {
      action: 'post',
      type: 'transfer',
      accountMatchStatus: 'review_required',
      accountMatchReason: 'personal_transfer',
      accountMatchConfidence: 'medium',
    };
  }

  if (direction === 'credit') {
    // Income is counted by default. Most incoming money is the user's earning, so we
    // mark it confirmed straight away; the user can tap "This is not income" to drop it.
    return {
      action: 'post',
      type: 'income',
      accountMatchStatus: 'manual_confirmed',
      accountMatchReason: 'auto_confirmed_income',
      accountMatchConfidence: SALARY_INCOME_PATTERN.test(text) ? 'high' : 'medium',
    };
  }

  // DEBIT default — NOT counted as the user's expense until they confirm it. Many debits
  // are money the user is only passing on (e.g. forwarding cash they received), so we
  // hold the expense in review and surface an "Is this an expense?" action instead.
  return {
    action: 'post',
    type: 'expense',
    accountMatchStatus: 'review_required',
    accountMatchReason: 'unverified_debit',
    accountMatchConfidence: 'medium',
  };
}
