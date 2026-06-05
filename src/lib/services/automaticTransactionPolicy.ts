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
  | { action: 'post'; type: 'expense' | 'income' | 'transfer' }
  | { action: 'skip'; reason: AutomaticTransactionReviewReason };

const EARNED_INCOME_PATTERN =
  /\b(?:salary|payroll|wages?|freelance|business)\b|\b(?:porter|swiggy|zomato|rapido|zepto|delivery)\b.*\b(?:earning|earnings|payout|settlement)\b|\b(?:earning|earnings|payout|settlement)\b.*\b(?:porter|swiggy|zomato|rapido|zepto|delivery)\b/i;
const PERSONAL_PATTERN =
  /\b(?:family|friend|brother|sister|mom|mother|dad|father|papa|mummy|bhai|dost|yaar|personal)\b/i;
const SELF_TRANSFER_PATTERN =
  /\b(?:self[\s_-]*transfer|own account|between (?:my|your)(?: own)? accounts?|account transfer)\b/i;
const CASH_DEPOSIT_PATTERN =
  /\b(?:cash|atm|bank)\s+deposit(?:ed)?\b|\bdeposit(?:ed)?\s+(?:cash|into (?:my|your) (?:bank )?account)\b/i;
const CASH_WITHDRAWAL_PATTERN =
  /\bwithdraw(?:al|n)?\b|\bwithdrawn\b/i;
const CREDIT_CARD_BILL_PATTERN =
  /\b(?:credit\s*card|creditcard|card|cc)\s+(?:bill\s+)?payment\b|\bpayment\b.*\b(?:credit\s*card|creditcard|card bill)\b|\b(?:gpay|googlepay|paytm|phonepe|cred)?[-_.]?(?:creditcard|cardbill|cc)[-_.]?[a-z0-9._-]*@[a-z0-9.-]+\b/i;
const DEBT_REPAYMENT_PATTERN =
  /\b(?:loan|debt|borrowed money)\s+repay(?:ment|aid)?\b|\brepay(?:ment|aid)?\b.*\b(?:loan|debt|borrowed)\b/i;
const BORROWED_PATTERN =
  /\b(?:borrowed|loan from (?:family|friend|brother|sister|person))\b/i;
const REFUND_OR_REIMBURSEMENT_PATTERN =
  /\b(?:refund(?:ed)?|reimburse(?:ment|d)?)\b/i;
const MERCHANT_EXPENSE_PATTERN =
  /\b(?:merchant|vendor|purchase|purchased|shopping|shop|store|mart|restaurant|cafe|food|fuel|petrol|diesel|rent|utility|utilities|recharge|grocery|groceries|bill payment|pos|ecom|amazon|flipkart|zomato|swiggy|blinkit|zepto|uber|ola|rapido)\b/i;

function extractDebitCounterparty(text: string): string | null {
  const match = text.match(/\b(?:sent|paid|transferred)?\s*(?:to|towards)\s+([A-Za-z][A-Za-z\s.'-]{2,48}?)(?:\s+on\b|\s+via\b|\s+ref\b|\.|$)/i);
  return match?.[1]?.trim() || null;
}

function looksLikePersonCounterparty(text: string): boolean {
  if (MERCHANT_EXPENSE_PATTERN.test(text)) return false;

  const counterparty = extractDebitCounterparty(text);
  if (!counterparty) return false;
  if (/@|\d/.test(counterparty)) return false;
  if (/\b(?:bank|account|a\/c|upi|credit|card|loan|bill|payment|google|amazon|paytm|phonepe|supermoney|super\s+money)\b/i.test(counterparty)) {
    return false;
  }

  const words = counterparty
    .replace(/[^A-Za-z\s.'-]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  return words.length >= 2 && words.length <= 4 && words.every(word => word.length >= 2);
}

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
