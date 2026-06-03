import { Transaction } from '../types';

export interface MonthlyTransactionTotals {
  totalIncome: number;
  grossExpense: number;
  totalRefunds: number;
  netExpense: number;
  totalExpense: number;
  totalInvestment: number;
  totalEMI: number;
  monthlyBalance: number;
}

export type DashboardReviewRoute = 'income_review' | 'review_queue';
export type DashboardReviewDirection = 'credit' | 'debit' | 'neutral';
export type DashboardReviewReason =
  | 'needs_review'
  | 'personal_transfer'
  | 'bank_deposit'
  | 'cash_deposit'
  | 'cash_withdrawal'
  | 'self_transfer'
  | 'borrowed_repayment'
  | 'refund_reimbursement'
  | 'unverified_credit'
  | 'unverified_debit';

export interface DashboardReviewMovement {
  transactionId: string;
  direction: DashboardReviewDirection;
  reason: DashboardReviewReason;
  label: string;
  route: DashboardReviewRoute;
}

export interface DashboardReviewPromptSummary {
  count: number;
  creditCount: number;
  debitCount: number;
  route: DashboardReviewRoute | null;
  items: DashboardReviewMovement[];
}

export interface DashboardIncomeReviewCandidateSummary {
  amount: number;
  receivedAt: string;
  suggestedDecision: 'count_as_income' | 'not_income' | 'needs_review';
  currentDecision?: {
    decision: 'count_as_income' | 'not_income' | 'needs_review';
  } | null;
}

export interface DashboardTransactionReviewItemSummary {
  status: 'pending' | 'posted' | 'ignored' | 'reviewed';
  candidate: {
    signalId: string;
    direction: 'debit' | 'credit' | 'neutral' | 'unknown';
    amount: number | null;
  };
}

export interface DashboardReviewBreakdown {
  totalReviewableCount: number;
  incomeReviewCount: number;
  transactionReviewCount: number;
  historicalCorrectionCount: number;
}

export interface DashboardIncomeReviewDecision {
  transaction_id: string | null;
  decision: 'count_as_income' | 'not_income' | 'needs_review';
}

interface ComputeMonthlyTransactionTotalsOptions {
  incomeReviewDecisions?: DashboardIncomeReviewDecision[];
}

const AUTO_DETECTED_SOURCES = new Set(['bank', 'notification', 'sms', 'upi']);
const MOVEMENT_PATTERN =
  /\b(?:atm|borrowed|cash deposit|bank deposit|cash withdrawal|debt repayment|family|friend|brother|sister|mom|mother|dad|father|papa|mummy|personal transfer|refunds?|reimburse(?:ment|d)?|repay(?:ment|aid)?|self transfer|own account|account transfer|transfer|withdrawn?)\b|\b(?:sent to|received from)\b/i;
const EARNED_INCOME_PATTERN =
  /\b(?:salary|payroll|wages?|freelance|business)\b|\b(?:porter|swiggy|zomato|rapido|zepto|delivery)\b.*\b(?:earning|earnings|payout|settlement)\b|\b(?:earning|earnings|payout|settlement)\b.*\b(?:porter|swiggy|zomato|rapido|zepto|delivery)\b/i;
const NON_EXPENSE_CATEGORY_PATTERN =
  /\b(?:cash\s*&?\s*atm|credit card bills?|debt repayment|personal transfer|transfers?|withdrawal)\b/i;
const CASH_DEPOSIT_PATTERN = /\bcash deposit\b/i;
const BANK_DEPOSIT_PATTERN = /\bbank deposit\b/i;
const CASH_WITHDRAWAL_PATTERN = /\b(?:atm|cash\s*&?\s*atm|cash withdrawal|withdrawn?|withdrawal)\b/i;
const SELF_TRANSFER_PATTERN = /\b(?:self transfer|own account|account transfer|transfer to own|between accounts)\b/i;
const PERSONAL_TRANSFER_PATTERN =
  /\b(?:family|friend|brother|sister|mom|mother|dad|father|papa|mummy|personal transfer|sent to|received from)\b/i;
const BORROWED_REPAYMENT_PATTERN = /\b(?:borrowed|debt repayment|repay(?:ment|aid)?)\b/i;
const REFUND_REIMBURSEMENT_PATTERN = /\b(?:refunds?|reimburse(?:ment|d)?)\b/i;
const REVIEWED_EXPENSE_CATEGORY = 'Reviewed Expense';
const REVIEWED_EXPENSE_NOTE = 'Reviewed expense';
const EXPLICIT_EXPENSE_REVIEW_REASONS = new Set([
  'review_detail_expense_confirmed',
  'review_queue_expense_confirmed',
]);

function summaryText(transaction: Transaction): string {
  return [transaction.category, transaction.note]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function isAutomaticallyDetected(transaction: Transaction): boolean {
  return AUTO_DETECTED_SOURCES.has((transaction.sms_source || '').trim().toLowerCase());
}

function incomeReviewDecisionFor(
  transaction: Transaction,
  decisions: DashboardIncomeReviewDecision[]
): DashboardIncomeReviewDecision['decision'] | null {
  return decisions.find(decision => decision.transaction_id === transaction.id)?.decision || null;
}

export function isDashboardIncome(
  transaction: Transaction,
  incomeReviewDecisions: DashboardIncomeReviewDecision[] = []
): boolean {
  if (transaction.type !== 'income') return false;

  const reviewedDecision = incomeReviewDecisionFor(transaction, incomeReviewDecisions);
  if (reviewedDecision === 'count_as_income') return true;
  if (reviewedDecision === 'not_income' || reviewedDecision === 'needs_review') return false;

  const text = summaryText(transaction);
  if (MOVEMENT_PATTERN.test(text)) return false;
  if (!isAutomaticallyDetected(transaction)) return true;

  return EARNED_INCOME_PATTERN.test(text);
}

export function isDashboardExpense(transaction: Transaction): boolean {
  if (transaction.type !== 'expense') return false;
  if (transaction.account_match_status === 'ignored' || transaction.account_match_status === 'review_required') {
    return false;
  }
  if (
    transaction.account_match_status === 'manual_confirmed' &&
    EXPLICIT_EXPENSE_REVIEW_REASONS.has(transaction.account_match_reason || '')
  ) {
    return true;
  }
  if (
    transaction.category === REVIEWED_EXPENSE_CATEGORY &&
    transaction.note === REVIEWED_EXPENSE_NOTE
  ) {
    return true;
  }

  const text = summaryText(transaction);
  if (MOVEMENT_PATTERN.test(text) || NON_EXPENSE_CATEGORY_PATTERN.test(text)) return false;
  if (!isAutomaticallyDetected(transaction)) return true;

  return true;
}

function reviewReasonForText(text: string, fallback: DashboardReviewReason): Pick<DashboardReviewMovement, 'reason' | 'label'> {
  if (CASH_DEPOSIT_PATTERN.test(text)) return { reason: 'cash_deposit', label: 'Cash deposit' };
  if (BANK_DEPOSIT_PATTERN.test(text)) return { reason: 'bank_deposit', label: 'Bank deposit' };
  if (CASH_WITHDRAWAL_PATTERN.test(text)) return { reason: 'cash_withdrawal', label: 'Cash withdrawal' };
  if (SELF_TRANSFER_PATTERN.test(text)) return { reason: 'self_transfer', label: 'Self transfer' };
  if (PERSONAL_TRANSFER_PATTERN.test(text)) return { reason: 'personal_transfer', label: 'Personal transfer' };
  if (BORROWED_REPAYMENT_PATTERN.test(text)) return { reason: 'borrowed_repayment', label: 'Borrowed or repayment' };
  if (REFUND_REIMBURSEMENT_PATTERN.test(text)) return { reason: 'refund_reimbursement', label: 'Refund or reimbursement' };
  if (fallback === 'unverified_credit') return { reason: fallback, label: 'Needs review' };
  if (fallback === 'unverified_debit') return { reason: fallback, label: 'Needs review' };
  return { reason: fallback, label: 'Needs review' };
}

export function getDashboardReviewMovement(
  transaction: Transaction,
  incomeReviewDecisions: DashboardIncomeReviewDecision[] = []
): DashboardReviewMovement | null {
  const amount = Number(transaction.amount);
  if (!Number.isFinite(amount)) return null;

  const text = summaryText(transaction);
  const reviewedDecision = incomeReviewDecisionFor(transaction, incomeReviewDecisions);

  if (reviewedDecision === 'count_as_income' || reviewedDecision === 'not_income') {
    return null;
  }

  if (reviewedDecision === 'needs_review') {
    return {
      transactionId: transaction.id,
      direction: 'credit',
      route: 'income_review',
      reason: 'needs_review',
      label: 'Needs review',
    };
  }

  if (transaction.account_match_status === 'review_required') {
    const direction: DashboardReviewDirection = transaction.type === 'income'
      ? 'credit'
      : transaction.type === 'expense'
        ? 'debit'
        : 'neutral';
    return {
      transactionId: transaction.id,
      direction,
      route: direction === 'credit' ? 'income_review' : 'review_queue',
      reason: 'needs_review',
      label: 'Needs review',
    };
  }

  if (transaction.type === 'income' && !isDashboardIncome(transaction, incomeReviewDecisions)) {
    return {
      transactionId: transaction.id,
      direction: 'credit',
      route: 'income_review',
      ...reviewReasonForText(text, 'unverified_credit'),
    };
  }

  if (transaction.type === 'expense' && !isDashboardExpense(transaction)) {
    return {
      transactionId: transaction.id,
      direction: 'debit',
      route: 'review_queue',
      ...reviewReasonForText(text, 'unverified_debit'),
    };
  }

  if (transaction.type === 'transfer' && (MOVEMENT_PATTERN.test(text) || isAutomaticallyDetected(transaction))) {
    return {
      transactionId: transaction.id,
      direction: 'neutral',
      route: 'review_queue',
      ...reviewReasonForText(text, 'self_transfer'),
    };
  }

  return null;
}

export function computeDashboardReviewPromptSummary(
  transactions: Transaction[],
  selectedDate: Date,
  options: ComputeMonthlyTransactionTotalsOptions = {}
): DashboardReviewPromptSummary {
  const year = selectedDate.getFullYear();
  const month = selectedDate.getMonth();
  const items = transactions.reduce<DashboardReviewMovement[]>((summary, transaction) => {
    const txDate = new Date(transaction.created_at);
    if (txDate.getFullYear() !== year || txDate.getMonth() !== month) {
      return summary;
    }

    const movement = getDashboardReviewMovement(transaction, options.incomeReviewDecisions);
    if (movement) summary.push(movement);
    return summary;
  }, []);

  const creditCount = items.filter(item => item.direction === 'credit').length;
  const debitCount = items.filter(item => item.direction !== 'credit').length;
  const route = items.length === 0
    ? null
    : debitCount > 0
      ? 'review_queue'
      : 'income_review';

  return {
    count: items.length,
    creditCount,
    debitCount,
    route,
    items,
  };
}

function reviewQueueTimestamp(item: DashboardTransactionReviewItemSummary): number | null {
  const timestamp = item.candidate.signalId.match(/^sig_(\d+)_/)?.[1];
  if (!timestamp) return null;
  const parsed = Number(timestamp);
  return Number.isFinite(parsed) ? parsed : null;
}

function isRepresentedByQueuedCredit(
  candidate: DashboardIncomeReviewCandidateSummary,
  queueItems: DashboardTransactionReviewItemSummary[]
): boolean {
  const receivedAt = new Date(candidate.receivedAt).getTime();
  if (!Number.isFinite(receivedAt)) return false;

  return queueItems.some(item => (
    item.candidate.direction === 'credit'
    && Number(item.candidate.amount) === Number(candidate.amount)
    && reviewQueueTimestamp(item) === receivedAt
  ));
}

export function computeDashboardReviewBreakdown(
  historicalSummary: DashboardReviewPromptSummary,
  incomeReviewCandidates: DashboardIncomeReviewCandidateSummary[],
  transactionReviewItems: DashboardTransactionReviewItemSummary[]
): DashboardReviewBreakdown {
  const pendingTransactionItems = transactionReviewItems.filter(item => item.status === 'pending');
  const incomeReviewCount = incomeReviewCandidates.filter(candidate => {
    const effectiveDecision = candidate.currentDecision?.decision || candidate.suggestedDecision;
    return effectiveDecision === 'needs_review'
      && !isRepresentedByQueuedCredit(candidate, pendingTransactionItems);
  }).length;
  const transactionReviewCount = pendingTransactionItems.length;

  return {
    totalReviewableCount: incomeReviewCount + transactionReviewCount,
    incomeReviewCount,
    transactionReviewCount,
    historicalCorrectionCount: historicalSummary.items.filter(item => item.route === 'review_queue').length,
  };
}

export function computeMonthlyTransactionTotals(
  transactions: Transaction[],
  selectedDate: Date,
  options: ComputeMonthlyTransactionTotalsOptions = {}
): MonthlyTransactionTotals {
  const year = selectedDate.getFullYear();
  const month = selectedDate.getMonth();

  const totals = transactions.reduce(
    (summary, transaction) => {
      const txDate = new Date(transaction.created_at);
      if (txDate.getFullYear() !== year || txDate.getMonth() !== month) {
        return summary;
      }

      const amount = Number(transaction.amount);
      if (!Number.isFinite(amount)) {
        return summary;
      }

      if (isDashboardIncome(transaction, options.incomeReviewDecisions)) {
        summary.totalIncome += amount;
      } else if (isDashboardExpense(transaction)) {
        summary.grossExpense += amount;
      } else if (transaction.type === 'refund') {
        summary.totalRefunds += amount;
      } else if (transaction.type === 'investment') {
        summary.totalInvestment += amount;
      } else if (transaction.type === 'emi') {
        summary.totalEMI += amount;
      }

      return summary;
    },
    {
      totalIncome: 0,
      grossExpense: 0,
      totalRefunds: 0,
      totalInvestment: 0,
      totalEMI: 0,
    }
  );

  const netExpense = Math.max(0, totals.grossExpense - totals.totalRefunds);

  return {
    ...totals,
    netExpense,
    totalExpense: netExpense,
    monthlyBalance: totals.totalIncome - netExpense - totals.totalInvestment - totals.totalEMI,
  };
}
