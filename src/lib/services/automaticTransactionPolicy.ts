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
const MERCHANT_EXPENSE_PATTERN =
  /\b(?:paid\s+to|spent\s+at|purchase(?:d)?\s+(?:at|from)|payment\s+(?:to|at)|debited\s+at|upi\s+to)\b/i;
const KNOWN_MERCHANT_PATTERN =
  /\b(?:amazon|flipkart|swiggy|zomato|blinkit|zepto|uber|ola|rapido|irctc|myntra|bigbasket|dmart|netflix|spotify|jio|airtel)\b/i;

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

  if (direction === 'credit') {
    if (SALARY_INCOME_PATTERN.test(text)) {
      return {
        action: 'post',
        type: 'income',
        accountMatchStatus: 'manual_confirmed',
        accountMatchReason: 'auto_confirmed_income',
        accountMatchConfidence: 'high',
      };
    }

    return {
      action: 'post',
      type: 'income',
      accountMatchStatus: 'review_required',
      accountMatchReason: PERSONAL_TRANSFER_PATTERN.test(text) ? 'personal_transfer' : 'unverified_credit',
      accountMatchConfidence: 'low',
    };
  }

  if (MERCHANT_EXPENSE_PATTERN.test(text) || KNOWN_MERCHANT_PATTERN.test(text)) {
    return {
      action: 'post',
      type: 'expense',
      accountMatchStatus: 'manual_confirmed',
      accountMatchReason: 'auto_confirmed_expense',
      accountMatchConfidence: 'high',
    };
  }

  return {
    action: 'post',
    type: 'expense',
    accountMatchStatus: PERSONAL_TRANSFER_PATTERN.test(text) ? 'review_required' : 'review_required',
    accountMatchReason: PERSONAL_TRANSFER_PATTERN.test(text) ? 'personal_transfer' : 'unverified_debit',
    accountMatchConfidence: 'low',
  };
}
