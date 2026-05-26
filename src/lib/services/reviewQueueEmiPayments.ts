import { addEMIPayment, getEMIPayments, Loan } from '../database/financial';
import { markPosted, ReviewItem } from './autoTransactionReviewQueue';

const DUPLICATE_WINDOW_MS = 24 * 60 * 60 * 1000;
const AMOUNT_EPSILON = 0.01;

export type LoanMatchResult =
  | { status: 'matched'; loan: Loan }
  | { status: 'needs_selection' }
  | { status: 'needs_setup' };

function getCandidateTimestamp(item: ReviewItem): number {
  const signalId = item.candidate.signalId || item.id;
  const match = signalId.match(/^sig_(\d+)_/);
  return match ? Number.parseInt(match[1], 10) : Date.now();
}

function normalizeLabel(value?: string | null): string {
  return (value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function isSameAmount(left?: number | null, right?: number | null): boolean {
  if (left == null || right == null) return false;
  return Math.abs(Number(left) - Number(right)) <= AMOUNT_EPSILON;
}

function getOptionalNumber(source: unknown, keys: string[]): number | undefined {
  if (!source || typeof source !== 'object') return undefined;
  const record = source as Record<string, unknown>;

  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
      return value;
    }
  }

  return undefined;
}

function hasUsableLoanRate(loan: Loan): boolean {
  return typeof loan.interest_rate === 'number' && Number.isFinite(loan.interest_rate);
}

export function resolveLoanMatch(item: ReviewItem, loans: Loan[]): LoanMatchResult {
  if (loans.length === 0) {
    return { status: 'needs_setup' };
  }

  const candidate = item.candidate;
  const sourceLabels = [
    candidate.merchantOrPerson,
    candidate.redactedPreview.detectedSource,
  ].map(normalizeLabel).filter(Boolean);
  const candidateDay = new Date(getCandidateTimestamp(item)).getDate();
  const last4 = candidate.last4?.trim();

  const scored = loans
    .map(loan => {
      let score = 0;
      const loanLabels = [
        loan.loan_name,
        loan.lender_name,
      ].map(normalizeLabel).filter(Boolean);

      const loanLast4 = (loan as unknown as Record<string, unknown>).loan_account_last4;
      if (last4 && typeof loanLast4 === 'string' && loanLast4 === last4) {
        score += 90;
      }

      const hasLabelMatch = sourceLabels.some(source =>
        loanLabels.some(label => label === source || label.includes(source) || source.includes(label))
      );
      if (hasLabelMatch) {
        score += 55;
      }

      if (isSameAmount(candidate.amount, loan.emi_amount)) {
        score += 40;
      } else if (
        candidate.amount != null &&
        loan.emi_amount > 0 &&
        Math.abs(candidate.amount - loan.emi_amount) / loan.emi_amount <= 0.05
      ) {
        score += 25;
      }

      const dueDiff = Math.abs(candidateDay - loan.emi_due_date);
      const circularDueDiff = Math.min(dueDiff, 31 - dueDiff);
      if (circularDueDiff === 0) {
        score += 20;
      } else if (circularDueDiff <= 2) {
        score += 10;
      }

      return { loan, score };
    })
    .filter(result => result.score >= 70)
    .sort((left, right) => right.score - left.score);

  if (scored.length === 1) {
    return { status: 'matched', loan: scored[0].loan };
  }

  return { status: 'needs_selection' };
}

export function canRecordEMIWithLoan(item: ReviewItem, loan: Loan): boolean {
  const principal = getOptionalNumber(item.candidate, ['principal_component', 'principalComponent']);
  const interest = getOptionalNumber(item.candidate, ['interest_component', 'interestComponent']);

  if (principal != null && interest != null) {
    return true;
  }

  return hasUsableLoanRate(loan);
}

export async function findDuplicateEMIPayment(
  loanId: string,
  amount: number,
  candidateTimestamp: number,
  reference?: string | null
) {
  const payments = await getEMIPayments(loanId);
  const normalizedReference = reference?.trim().toLowerCase();

  if (normalizedReference) {
    const byReference = payments.find(payment =>
      isSameAmount(Number(payment.amount_paid), amount) &&
      payment.reference_number?.trim().toLowerCase() === normalizedReference
    );
    if (byReference) return byReference;
  }

  return payments.find(payment => {
    if (!isSameAmount(Number(payment.amount_paid), amount)) return false;

    const paymentTime = new Date(payment.payment_date).getTime();
    return Math.abs(paymentTime - candidateTimestamp) <= DUPLICATE_WINDOW_MS;
  }) || null;
}

export async function recordReviewQueueEMIPayment(
  item: ReviewItem,
  loan?: Loan
): Promise<{ status: 'posted' | 'duplicate'; emiPaymentId: string }> {
  if (item.candidate.autoClass !== 'loan_emi_payment') {
    throw new Error('Unsupported review item for EMI payment');
  }

  if (!item.candidate.amount || item.candidate.amount <= 0) {
    throw new Error('Valid amount required');
  }

  if (!loan) {
    throw new Error('Loan selection required');
  }

  if (!canRecordEMIWithLoan(item, loan)) {
    throw new Error('Loan interest rate or EMI split required');
  }

  const candidateTimestamp = getCandidateTimestamp(item);
  const duplicate = await findDuplicateEMIPayment(
    loan.id,
    item.candidate.amount,
    candidateTimestamp,
    item.candidate.reference
  );

  if (duplicate) {
    await markPosted(item.id, duplicate.id);
    return { status: 'duplicate', emiPaymentId: duplicate.id };
  }

  const principal = getOptionalNumber(item.candidate, ['principal_component', 'principalComponent']);
  const interest = getOptionalNumber(item.candidate, ['interest_component', 'interestComponent']);
  const shouldPassExplicitSplit = principal != null && interest != null;
  const zeroRateSplit = !shouldPassExplicitSplit && loan.interest_rate === 0;

  const emiPayment = await addEMIPayment({
    loan_id: loan.id,
    amount_paid: item.candidate.amount,
    payment_date: new Date(candidateTimestamp),
    principal_component: shouldPassExplicitSplit || zeroRateSplit ? (principal ?? item.candidate.amount) : undefined,
    interest_component: shouldPassExplicitSplit || zeroRateSplit ? (interest ?? 0) : undefined,
    reference_number: item.candidate.reference || undefined,
  });

  await markPosted(item.id, emiPayment.id);
  return { status: 'posted', emiPaymentId: emiPayment.id };
}
