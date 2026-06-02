export type DebtSourceType =
  | 'loan'
  | 'credit_card'
  | 'people_borrowed'
  | 'loan_account'
  | 'manual';

export type DebtConfidence = 'exact' | 'estimated' | 'low' | 'needs_review';

export interface DebtItem {
  id: string;
  sourceType: DebtSourceType;
  ownerId?: string | null;
  label: string;
  outstanding: number;
  minimumMonthlyPayment?: number | null;
  dueDate?: string | null;
  annualInterestRate?: number | null;
  confidence: DebtConfidence;
  isHidden?: boolean;
  duplicateGroupKey?: string | null;
  metadata?: {
    bankName?: string | null;
    last4?: string | null;
    source?: string | null;
    totalLoanAmount?: number | null;
  };
}

export type IncomeSourceType =
  | 'salary'
  | 'gig_work'
  | 'freelance'
  | 'business'
  | 'cash_deposit'
  | 'upi_credit'
  | 'bank_credit'
  | 'refund'
  | 'personal_transfer'
  | 'borrowed'
  | 'unknown';

export type IncomeConfidence =
  | 'confirmed'
  | 'high'
  | 'medium'
  | 'low'
  | 'excluded'
  | 'needs_review';

export type IncomeExclusionReason =
  | 'refund'
  | 'self_transfer'
  | 'family_or_friend'
  | 'borrowed_money'
  | 'reimbursement'
  | 'duplicate'
  | 'unknown_credit';

export interface IncomeEvent {
  id: string;
  amount: number;
  receivedAt: string;
  sourceType: IncomeSourceType;
  label?: string | null;
  category?: string | null;
  counterpartyLabel?: string | null;
  confidence: IncomeConfidence;
  includeInIncome: boolean;
  exclusionReason?: IncomeExclusionReason | null;
  metadata?: {
    source?: string | null;
    appPackage?: string | null;
    bankName?: string | null;
    referencePresent?: boolean;
  };
}

export interface IncomePlan {
  confirmedMonthlyIncome?: number | null;
  estimatedMonthlyIncome?: number | null;
  incomeSource: 'confirmed' | 'current_month_daily_average' | 'manual_estimate' | 'missing';
  incomeEvents?: IncomeEvent[];
}

export interface ExpensePlan {
  essentialMonthlyExpenses?: number | null;
  emergencyContribution?: number | null;
  emergencyFundAvailable?: number | null;
  emergencyFundTarget?: number | null;
}

export interface DebtFreedomOptions {
  plannedMonthlyDebtPayment?: number | null;
  targetDebtFreeMonths?: number | null;
  targetMonthlyIncome?: number | null;
  strategy?: DebtFreedomStrategy;
  now?: string | null;
  monthStart?: string | null;
  daysInMonth?: number | null;
  elapsedDaysInCurrentMonth?: number | null;
}

export type DebtFreedomStrategy = 'balanced' | 'snowball' | 'avalanche';

export type DebtFreedomWarningCode =
  | 'income_missing'
  | 'income_variable_estimate'
  | 'income_needs_review'
  | 'income_pace_behind'
  | 'income_sample_too_small'
  | 'daily_target_high'
  | 'essential_expense_missing'
  | 'high_dti'
  | 'very_high_dti'
  | 'minimum_payment_exceeds_income'
  | 'missing_interest_rates'
  | 'duplicate_debt_possible'
  | 'emergency_buffer_low'
  | 'hidden_debt_included'
  | 'target_unreachable'
  | 'stale_or_low_confidence_debt';

export interface DebtFreedomWarning {
  code: DebtFreedomWarningCode;
  severity: 'info' | 'caution' | 'high';
  messageToken: string;
}

export interface IncomeProjection {
  monthlyIncome: number | null;
  source: IncomePlan['incomeSource'];
  confidence: 'confirmed' | 'estimated' | 'low' | 'missing';
  includedIncomeTotal: number;
  includedIncomeCount: number;
  excludedIncomeCount: number;
  needsReviewCount: number;
  elapsedDaysInCurrentMonth: number | null;
  daysInMonth: number | null;
  remainingDaysInMonth: number | null;
  averageDailyIncome: number | null;
  projectedMonthEndIncome: number | null;
  targetMonthlyIncome: number | null;
  requiredAverageDailyIncome: number | null;
  requiredRemainingDailyIncome: number | null;
  todayIncomeTarget: number | null;
  incomePaceGap: number | null;
  explanationToken: string;
}

export interface DebtFreedomPlan {
  totalDebt: number;
  minimumDebtPayment: number;
  monthlyIncomeUsed: number | null;
  incomeProjection: IncomeProjection;
  debtToIncomePercent: number | null;
  safeSpendAmount: number | null;
  freeCashflowAfterDebt: number | null;
  estimatedMonthsToDebtFree: number | null;
  estimatedDebtFreeDate: string | null;
  extraMonthlyNeededForTarget: number | null;
  debtFreedomScore: number;
  scoreLabel: 'good' | 'caution' | 'high_risk' | 'unknown';
  strategy: DebtFreedomStrategy;
  orderedDebts: DebtItem[];
  debts: DebtItem[];
  warnings: DebtFreedomWarning[];
  insightTokens: string[];
  isEstimate: boolean;
}

export interface CalculateDebtFreedomPlanInput {
  debts: DebtItem[];
  income: IncomePlan;
  expenses: ExpensePlan;
  options: DebtFreedomOptions;
}

export interface CalculateDailyIncomeTargetInput {
  incomeEvents: IncomeEvent[];
  options: DebtFreedomOptions;
  expenses?: ExpensePlan;
  minimumDebtPayment?: number | null;
}

const MAX_TIMELINE_MONTHS = 1200;
const MAX_TARGET_PAYMENT = 1_000_000_000_000;
const DAILY_TARGET_HIGH_MULTIPLIER = 1.5;

const COUNTABLE_INCOME_CONFIDENCES = new Set<IncomeConfidence>(['confirmed', 'high', 'medium']);
const EARNED_INCOME_SOURCES = new Set<IncomeSourceType>(['salary', 'gig_work', 'freelance', 'business']);
const REVIEW_REQUIRED_SOURCES = new Set<IncomeSourceType>(['cash_deposit', 'upi_credit', 'bank_credit', 'unknown']);
const HARD_EXCLUSION_REASONS = new Set<IncomeExclusionReason>([
  'refund',
  'self_transfer',
  'family_or_friend',
  'borrowed_money',
  'reimbursement',
  'duplicate',
  'unknown_credit',
]);

const DEBT_CONFIDENCE_RANK: Record<DebtConfidence, number> = {
  exact: 4,
  estimated: 3,
  low: 2,
  needs_review: 1,
};

function finitePositive(value?: number | null): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}

function finiteNonNegative(value?: number | null): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function safeOptionalText(value?: string | null): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  const trimmed = value.trim();
  return trimmed || null;
}

function sanitizeIncomeMetadata(metadata: IncomeEvent['metadata']): IncomeEvent['metadata'] | undefined {
  if (!metadata) return undefined;
  return {
    source: safeOptionalText(metadata.source),
    appPackage: safeOptionalText(metadata.appPackage),
    bankName: safeOptionalText(metadata.bankName),
    referencePresent: metadata.referencePresent === true,
  };
}

function sanitizeDebtMetadata(metadata: DebtItem['metadata']): DebtItem['metadata'] | undefined {
  if (!metadata) return undefined;
  return {
    bankName: safeOptionalText(metadata.bankName),
    last4: safeOptionalText(metadata.last4),
    source: safeOptionalText(metadata.source),
  };
}

function exclusionToken(reason?: IncomeExclusionReason | null): string {
  switch (reason) {
    case 'refund':
      return 'income_excluded_refund';
    case 'borrowed_money':
      return 'income_excluded_borrowed_money';
    case 'family_or_friend':
      return 'income_excluded_family_or_friend';
    case 'reimbursement':
      return 'income_excluded_reimbursement';
    case 'duplicate':
      return 'income_excluded_duplicate';
    case 'self_transfer':
      return 'income_excluded_personal_transfer';
    default:
      return 'income_needs_review_unknown_credit';
  }
}

function sanitizeIncomeEvent(
  event: IncomeEvent,
  overrides: Partial<Pick<IncomeEvent, 'confidence' | 'includeInIncome' | 'exclusionReason' | 'label'>>
): IncomeEvent {
  const exclusionReason = overrides.exclusionReason === undefined
    ? event.exclusionReason
    : overrides.exclusionReason;
  const label = overrides.label === undefined
    ? safeOptionalText(event.label)
    : overrides.label;

  return {
    id: event.id,
    amount: Number.isFinite(event.amount) ? event.amount : 0,
    receivedAt: event.receivedAt,
    sourceType: event.sourceType,
    label,
    category: safeOptionalText(event.category),
    counterpartyLabel: overrides.includeInIncome === false
      ? null
      : safeOptionalText(event.counterpartyLabel),
    confidence: overrides.confidence || event.confidence,
    includeInIncome: overrides.includeInIncome === undefined
      ? event.includeInIncome
      : overrides.includeInIncome,
    exclusionReason,
    metadata: sanitizeIncomeMetadata(event.metadata),
  };
}

function sanitizeDebtItem(item: DebtItem): DebtItem {
  return {
    id: item.id,
    sourceType: item.sourceType,
    ownerId: safeOptionalText(item.ownerId),
    label: item.label,
    outstanding: Number.isFinite(item.outstanding) ? item.outstanding : 0,
    minimumMonthlyPayment: finiteNonNegative(item.minimumMonthlyPayment),
    dueDate: safeOptionalText(item.dueDate),
    annualInterestRate: finiteNonNegative(item.annualInterestRate),
    confidence: item.confidence,
    isHidden: item.isHidden === true,
    duplicateGroupKey: safeOptionalText(item.duplicateGroupKey),
    metadata: sanitizeDebtMetadata(item.metadata),
  };
}

export function classifyIncomeCandidate(event: IncomeEvent): IncomeEvent {
  if (event.exclusionReason && HARD_EXCLUSION_REASONS.has(event.exclusionReason)) {
    return sanitizeIncomeEvent(event, {
      confidence: 'excluded',
      includeInIncome: false,
      label: exclusionToken(event.exclusionReason),
    });
  }

  if (event.sourceType === 'refund') {
    return sanitizeIncomeEvent(event, {
      confidence: 'excluded',
      includeInIncome: false,
      exclusionReason: 'refund',
      label: exclusionToken('refund'),
    });
  }

  if (event.sourceType === 'borrowed') {
    return sanitizeIncomeEvent(event, {
      confidence: 'excluded',
      includeInIncome: false,
      exclusionReason: 'borrowed_money',
      label: exclusionToken('borrowed_money'),
    });
  }

  if (event.sourceType === 'personal_transfer') {
    const explicitlyConfirmed = event.includeInIncome && event.confidence === 'confirmed';
    return explicitlyConfirmed
      ? sanitizeIncomeEvent(event, {})
      : sanitizeIncomeEvent(event, {
          confidence: 'excluded',
          includeInIncome: false,
          exclusionReason: 'self_transfer',
          label: exclusionToken('self_transfer'),
        });
  }

  if (REVIEW_REQUIRED_SOURCES.has(event.sourceType)) {
    const explicitlyConfirmed = event.includeInIncome && event.confidence === 'confirmed';
    return explicitlyConfirmed
      ? sanitizeIncomeEvent(event, {})
      : sanitizeIncomeEvent(event, {
          confidence: 'needs_review',
          includeInIncome: false,
          exclusionReason: 'unknown_credit',
          label: exclusionToken('unknown_credit'),
        });
  }

  if (
    EARNED_INCOME_SOURCES.has(event.sourceType)
    && event.includeInIncome
    && COUNTABLE_INCOME_CONFIDENCES.has(event.confidence)
  ) {
    return sanitizeIncomeEvent(event, {});
  }

  return sanitizeIncomeEvent(event, {
    confidence: event.confidence === 'needs_review' ? 'needs_review' : 'excluded',
    includeInIncome: false,
  });
}

function parseDate(value?: string | null): Date | null {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function startOfUtcMonth(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}

function addUtcMonths(date: Date, months: number): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months, 1));
}

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

interface MonthWindow {
  now: Date;
  monthStart: Date;
  nextMonthStart: Date;
  daysInMonth: number;
  elapsedDays: number;
  remainingDays: number;
}

function resolveMonthWindow(options: DebtFreedomOptions): MonthWindow {
  const now = parseDate(options.now) || new Date();
  const monthStart = startOfUtcMonth(parseDate(options.monthStart) || now);
  const calculatedDaysInMonth = addUtcMonths(monthStart, 1);
  calculatedDaysInMonth.setUTCDate(0);
  const daysInMonth = Math.max(
    1,
    Math.min(
      31,
      Math.trunc(finitePositive(options.daysInMonth) || calculatedDaysInMonth.getUTCDate())
    )
  );
  const elapsedDays = Math.min(
    daysInMonth,
    Math.max(1, Math.trunc(finitePositive(options.elapsedDaysInCurrentMonth) || now.getUTCDate()))
  );

  return {
    now,
    monthStart,
    nextMonthStart: addUtcMonths(monthStart, 1),
    daysInMonth,
    elapsedDays,
    remainingDays: Math.max(daysInMonth - elapsedDays, 0),
  };
}

function includedCurrentMonthEvents(
  incomeEvents: IncomeEvent[],
  window: MonthWindow
): {
  includedIncomeTotal: number;
  includedIncomeCount: number;
  excludedIncomeCount: number;
  needsReviewCount: number;
} {
  return incomeEvents.reduce((summary, rawEvent) => {
    const event = classifyIncomeCandidate(rawEvent);
    const receivedAt = parseDate(event.receivedAt);
    if (
      !receivedAt
      || receivedAt < window.monthStart
      || receivedAt > window.now
      || receivedAt >= window.nextMonthStart
    ) {
      return summary;
    }

    if (event.confidence === 'needs_review') {
      summary.needsReviewCount += 1;
    }

    if (
      event.includeInIncome
      && event.amount > 0
      && COUNTABLE_INCOME_CONFIDENCES.has(event.confidence)
    ) {
      summary.includedIncomeTotal += event.amount;
      summary.includedIncomeCount += 1;
    } else {
      summary.excludedIncomeCount += 1;
    }
    return summary;
  }, {
    includedIncomeTotal: 0,
    includedIncomeCount: 0,
    excludedIncomeCount: 0,
    needsReviewCount: 0,
  });
}

function resolveTargetMonthlyIncome(
  options: DebtFreedomOptions,
  expenses?: ExpensePlan,
  minimumDebtPayment?: number | null
): number | null {
  const explicitTarget = finitePositive(options.targetMonthlyIncome);
  if (explicitTarget) return explicitTarget;
  const essentials = finiteNonNegative(expenses?.essentialMonthlyExpenses);
  if (essentials === null) return null;
  const debtPayment = finiteNonNegative(options.plannedMonthlyDebtPayment)
    ?? finiteNonNegative(minimumDebtPayment)
    ?? 0;
  const emergencyContribution = finiteNonNegative(expenses?.emergencyContribution) ?? 0;
  return essentials + debtPayment + emergencyContribution;
}

function applyDailyTarget(
  projection: IncomeProjection,
  targetMonthlyIncome: number | null
): IncomeProjection {
  const daysInMonth = projection.daysInMonth;
  const remainingDays = projection.remainingDaysInMonth;
  if (!targetMonthlyIncome || !daysInMonth || remainingDays === null) {
    return {
      ...projection,
      targetMonthlyIncome,
      requiredAverageDailyIncome: null,
      requiredRemainingDailyIncome: null,
      todayIncomeTarget: null,
      incomePaceGap: null,
    };
  }

  const remainingTargetAmount = Math.max(targetMonthlyIncome - projection.includedIncomeTotal, 0);
  const requiredRemainingDailyIncome = remainingTargetAmount === 0
    ? 0
    : remainingDays > 0
      ? roundMoney(remainingTargetAmount / remainingDays)
      : null;

  return {
    ...projection,
    targetMonthlyIncome,
    requiredAverageDailyIncome: roundMoney(targetMonthlyIncome / daysInMonth),
    requiredRemainingDailyIncome,
    todayIncomeTarget: requiredRemainingDailyIncome,
    incomePaceGap: projection.projectedMonthEndIncome === null
      ? null
      : roundMoney(projection.projectedMonthEndIncome - targetMonthlyIncome),
  };
}

export function calculateCurrentMonthIncomePace(
  incomeEvents: IncomeEvent[],
  options: DebtFreedomOptions = {}
): IncomeProjection {
  const window = resolveMonthWindow(options);
  const counts = includedCurrentMonthEvents(incomeEvents, window);
  const averageDailyIncome = roundMoney(counts.includedIncomeTotal / window.elapsedDays);
  const projectedMonthEndIncome = roundMoney(
    counts.includedIncomeTotal / window.elapsedDays * window.daysInMonth
  );
  const confidence = window.elapsedDays < 4 || counts.includedIncomeCount === 0 ? 'low' : 'estimated';

  return applyDailyTarget({
    monthlyIncome: counts.includedIncomeCount > 0 ? projectedMonthEndIncome : null,
    source: counts.includedIncomeCount > 0 ? 'current_month_daily_average' : 'missing',
    confidence: counts.includedIncomeCount > 0 ? confidence : 'missing',
    ...counts,
    elapsedDaysInCurrentMonth: window.elapsedDays,
    daysInMonth: window.daysInMonth,
    remainingDaysInMonth: window.remainingDays,
    averageDailyIncome,
    projectedMonthEndIncome,
    targetMonthlyIncome: null,
    requiredAverageDailyIncome: null,
    requiredRemainingDailyIncome: null,
    todayIncomeTarget: null,
    incomePaceGap: null,
    explanationToken: counts.includedIncomeCount > 0
      ? 'income_projection_current_month_daily_average'
      : 'income_projection_missing',
  }, finitePositive(options.targetMonthlyIncome));
}

export function calculateDailyIncomeTarget(
  input: CalculateDailyIncomeTargetInput
): IncomeProjection {
  const projection = calculateCurrentMonthIncomePace(input.incomeEvents, input.options);
  return applyDailyTarget(
    projection,
    resolveTargetMonthlyIncome(input.options, input.expenses, input.minimumDebtPayment)
  );
}

function selectCanonicalDebts(debts: DebtItem[]): {
  debts: DebtItem[];
  hasDuplicates: boolean;
} {
  const positiveDebts = debts
    .map(sanitizeDebtItem)
    .filter(debt => debt.outstanding > 0);
  const grouped = new Map<string, DebtItem[]>();
  const ungrouped: DebtItem[] = [];

  for (const debt of positiveDebts) {
    if (!debt.duplicateGroupKey) {
      ungrouped.push(debt);
      continue;
    }
    const group = grouped.get(debt.duplicateGroupKey) || [];
    group.push(debt);
    grouped.set(debt.duplicateGroupKey, group);
  }

  let hasDuplicates = false;
  const canonical = [...ungrouped];
  for (const group of grouped.values()) {
    if (group.length > 1) hasDuplicates = true;
    canonical.push([...group].sort((a, b) => (
      DEBT_CONFIDENCE_RANK[b.confidence] - DEBT_CONFIDENCE_RANK[a.confidence]
      || b.outstanding - a.outstanding
      || a.id.localeCompare(b.id)
    ))[0]);
  }

  return { debts: canonical, hasDuplicates };
}

function compareDueDates(a: DebtItem, b: DebtItem, now: Date): number {
  const aDue = parseDate(a.dueDate);
  const bDue = parseDate(b.dueDate);
  const priority = (due: Date | null): number => {
    if (!due) return 3;
    const daysAway = Math.ceil((due.getTime() - now.getTime()) / (24 * 60 * 60 * 1000));
    if (daysAway < 0) return 0;
    if (daysAway <= 7) return 1;
    return 2;
  };
  return priority(aDue) - priority(bDue);
}

function orderDebts(
  debts: DebtItem[],
  strategy: DebtFreedomStrategy,
  now: Date
): DebtItem[] {
  return [...debts].sort((a, b) => {
    if (strategy === 'snowball') {
      return a.outstanding - b.outstanding || a.id.localeCompare(b.id);
    }

    if (strategy === 'avalanche') {
      const aRate = finiteNonNegative(a.annualInterestRate);
      const bRate = finiteNonNegative(b.annualInterestRate);
      if (aRate !== null && bRate === null) return -1;
      if (aRate === null && bRate !== null) return 1;
      return (bRate || 0) - (aRate || 0)
        || a.outstanding - b.outstanding
        || a.id.localeCompare(b.id);
    }

    return compareDueDates(a, b, now)
      || Number(b.sourceType === 'credit_card') - Number(a.sourceType === 'credit_card')
      || (finiteNonNegative(b.annualInterestRate) || 0) - (finiteNonNegative(a.annualInterestRate) || 0)
      || a.outstanding - b.outstanding
      || a.id.localeCompare(b.id);
  });
}

function calculateMinimumDebtPayment(debts: DebtItem[]): {
  minimumDebtPayment: number;
  hasEstimatedCardMinimum: boolean;
  hasMissingLoanPayment: boolean;
} {
  return debts.reduce<{
    minimumDebtPayment: number;
    hasEstimatedCardMinimum: boolean;
    hasMissingLoanPayment: boolean;
  }>((summary, debt) => {
    const minimumPayment = finiteNonNegative(debt.minimumMonthlyPayment);
    if (minimumPayment !== null) {
      summary.minimumDebtPayment += minimumPayment;
    } else if (debt.sourceType === 'credit_card') {
      summary.minimumDebtPayment += debt.outstanding * 0.05;
      summary.hasEstimatedCardMinimum = true;
    } else if (debt.sourceType === 'loan' || debt.sourceType === 'loan_account') {
      summary.hasMissingLoanPayment = true;
    }
    return summary;
  }, {
    minimumDebtPayment: 0,
    hasEstimatedCardMinimum: false,
    hasMissingLoanPayment: false,
  });
}

function timelineMonthsForPayment(debts: DebtItem[], orderedDebts: DebtItem[], payment: number): number | null {
  if (debts.length === 0) return 0;
  if (!(payment > 0) || !Number.isFinite(payment)) return null;

  const hasKnownRate = debts.some(debt => finiteNonNegative(debt.annualInterestRate) !== null);
  if (!hasKnownRate) {
    return Math.ceil(debts.reduce((sum, debt) => sum + debt.outstanding, 0) / payment);
  }

  const balances = new Map(debts.map(debt => [debt.id, debt.outstanding]));
  for (let month = 1; month <= MAX_TIMELINE_MONTHS; month += 1) {
    let beforePayment = 0;
    for (const debt of debts) {
      const balance = balances.get(debt.id) || 0;
      const monthlyRate = (finiteNonNegative(debt.annualInterestRate) || 0) / 12 / 100;
      const balanceWithInterest = balance * (1 + monthlyRate);
      balances.set(debt.id, balanceWithInterest);
      beforePayment += balanceWithInterest;
    }

    let remainingPayment = payment;
    for (const debt of orderedDebts) {
      const balance = balances.get(debt.id) || 0;
      const applied = Math.min(balance, remainingPayment);
      balances.set(debt.id, balance - applied);
      remainingPayment -= applied;
      if (remainingPayment <= 0) break;
    }

    const afterPayment = [...balances.values()].reduce((sum, balance) => sum + balance, 0);
    if (afterPayment <= 0.005) return month;
    if (afterPayment >= beforePayment && payment <= 0) return null;
  }
  return null;
}

function requiredPaymentForTarget(
  debts: DebtItem[],
  orderedDebts: DebtItem[],
  targetMonths?: number | null
): number | null {
  if (debts.length === 0) return 0;
  if (!targetMonths || !Number.isFinite(targetMonths) || targetMonths <= 0) return null;

  let low = 0;
  let high = debts.reduce((sum, debt) => sum + debt.outstanding, 0);
  while (
    high < MAX_TARGET_PAYMENT
    && (timelineMonthsForPayment(debts, orderedDebts, high) || Number.POSITIVE_INFINITY) > targetMonths
  ) {
    high *= 2;
  }

  if ((timelineMonthsForPayment(debts, orderedDebts, high) || Number.POSITIVE_INFINITY) > targetMonths) {
    return null;
  }

  for (let iteration = 0; iteration < 60; iteration += 1) {
    const middle = (low + high) / 2;
    if ((timelineMonthsForPayment(debts, orderedDebts, middle) || Number.POSITIVE_INFINITY) <= targetMonths) {
      high = middle;
    } else {
      low = middle;
    }
  }
  return Math.ceil(high * 100) / 100;
}

function addWarning(
  warnings: DebtFreedomWarning[],
  code: DebtFreedomWarningCode,
  severity: DebtFreedomWarning['severity']
): void {
  if (warnings.some(warning => warning.code === code)) return;
  warnings.push({ code, severity, messageToken: `debt_freedom_warning_${code}` });
}

function addMonthsToDate(value: string | null | undefined, months: number | null): string | null {
  if (months === null) return null;
  const date = parseDate(value) || new Date();
  const originalDay = date.getUTCDate();
  const firstOfTargetMonth = new Date(Date.UTC(
    date.getUTCFullYear(),
    date.getUTCMonth() + months,
    1
  ));
  const lastDayOfTargetMonth = new Date(Date.UTC(
    firstOfTargetMonth.getUTCFullYear(),
    firstOfTargetMonth.getUTCMonth() + 1,
    0
  )).getUTCDate();
  firstOfTargetMonth.setUTCDate(Math.min(originalDay, lastDayOfTargetMonth));
  return isoDate(firstOfTargetMonth);
}

function resolveIncomeProjection(
  income: IncomePlan,
  expenses: ExpensePlan,
  options: DebtFreedomOptions,
  minimumDebtPayment: number
): {
  monthlyIncomeUsed: number | null;
  projection: IncomeProjection;
  isVariableEstimate: boolean;
} {
  const targetMonthlyIncome = resolveTargetMonthlyIncome(options, expenses, minimumDebtPayment);
  const pace = applyDailyTarget(
    calculateCurrentMonthIncomePace(income.incomeEvents || [], options),
    targetMonthlyIncome
  );
  const confirmedMonthlyIncome = finitePositive(income.confirmedMonthlyIncome);
  if (confirmedMonthlyIncome) {
    return {
      monthlyIncomeUsed: confirmedMonthlyIncome,
      projection: {
        ...pace,
        monthlyIncome: confirmedMonthlyIncome,
        source: 'confirmed',
        confidence: 'confirmed',
        explanationToken: 'income_projection_confirmed_monthly_income',
      },
      isVariableEstimate: false,
    };
  }

  const manualEstimate = income.incomeSource === 'manual_estimate'
    ? finitePositive(income.estimatedMonthlyIncome)
    : null;
  if (manualEstimate) {
    return {
      monthlyIncomeUsed: manualEstimate,
      projection: {
        ...pace,
        monthlyIncome: manualEstimate,
        source: 'manual_estimate',
        confidence: 'estimated',
        explanationToken: 'income_projection_manual_estimate',
      },
      isVariableEstimate: true,
    };
  }

  if (pace.includedIncomeCount > 0 && pace.projectedMonthEndIncome !== null) {
    return {
      monthlyIncomeUsed: pace.projectedMonthEndIncome,
      projection: pace,
      isVariableEstimate: true,
    };
  }

  return {
    monthlyIncomeUsed: null,
    projection: pace,
    isVariableEstimate: false,
  };
}

function debtFreedomScore(
  totalDebt: number,
  warnings: DebtFreedomWarning[]
): Pick<DebtFreedomPlan, 'debtFreedomScore' | 'scoreLabel'> {
  if (totalDebt <= 0) {
    return { debtFreedomScore: 100, scoreLabel: 'good' };
  }

  const codes = new Set(warnings.map(warning => warning.code));
  let score = 100;
  if (codes.has('income_missing')) score -= 35;
  if (codes.has('income_variable_estimate')) score -= 10;
  if (codes.has('income_sample_too_small')) score -= 5;
  if (codes.has('essential_expense_missing')) score -= 15;
  if (codes.has('emergency_buffer_low')) score -= 10;
  if (codes.has('missing_interest_rates')) score -= 5;
  if (codes.has('duplicate_debt_possible')) score -= 10;
  if (codes.has('stale_or_low_confidence_debt')) score -= 10;
  if (codes.has('hidden_debt_included')) score -= 5;
  if (codes.has('income_pace_behind')) score -= 5;
  if (codes.has('high_dti')) score -= 15;
  if (codes.has('very_high_dti')) score -= 25;
  if (codes.has('minimum_payment_exceeds_income')) score -= 35;
  score = Math.max(0, Math.min(100, score));
  if (codes.has('income_variable_estimate') && codes.has('income_sample_too_small')) {
    score = Math.min(score, 74);
  }

  if (codes.has('income_missing')) return { debtFreedomScore: score, scoreLabel: 'unknown' };
  if (score >= 75) return { debtFreedomScore: score, scoreLabel: 'good' };
  if (score >= 45) return { debtFreedomScore: score, scoreLabel: 'caution' };
  return { debtFreedomScore: score, scoreLabel: 'high_risk' };
}

export function calculateDebtFreedomPlan(input: CalculateDebtFreedomPlanInput): DebtFreedomPlan {
  const warnings: DebtFreedomWarning[] = [];
  const insightTokens: string[] = [];
  const { debts, hasDuplicates } = selectCanonicalDebts(input.debts);
  const strategy = input.options.strategy || 'balanced';
  const now = parseDate(input.options.now) || new Date();
  const orderedDebts = orderDebts(debts, strategy, now);
  const totalDebt = debts.reduce((sum, debt) => sum + debt.outstanding, 0);
  const minimums = calculateMinimumDebtPayment(debts);
  const minimumDebtPayment = minimums.minimumDebtPayment;
  let isEstimate = debts.some(debt => debt.confidence !== 'exact');

  if (hasDuplicates) {
    addWarning(warnings, 'duplicate_debt_possible', 'caution');
    isEstimate = true;
  }
  if (debts.some(debt => debt.isHidden)) {
    addWarning(warnings, 'hidden_debt_included', 'info');
  }
  if (debts.some(debt => debt.confidence === 'low' || debt.confidence === 'needs_review')) {
    addWarning(warnings, 'stale_or_low_confidence_debt', 'caution');
    isEstimate = true;
  }
  if (minimums.hasEstimatedCardMinimum) {
    insightTokens.push('credit_card_minimum_payment_estimated');
    isEstimate = true;
  }
  if (minimums.hasMissingLoanPayment) {
    insightTokens.push('loan_minimum_payment_missing');
    isEstimate = true;
  }

  const debtsMissingRates = debts.some(debt => finiteNonNegative(debt.annualInterestRate) === null);
  if (totalDebt > 0 && debtsMissingRates) {
    addWarning(warnings, 'missing_interest_rates', 'info');
    isEstimate = true;
  }

  const income = resolveIncomeProjection(input.income, input.expenses, input.options, minimumDebtPayment);
  const monthlyIncomeUsed = income.monthlyIncomeUsed;
  const projection = income.projection;
  if (monthlyIncomeUsed === null) {
    addWarning(warnings, 'income_missing', 'caution');
    isEstimate = true;
  }
  if (income.isVariableEstimate) {
    addWarning(warnings, 'income_variable_estimate', 'info');
    isEstimate = true;
  }
  if (projection.needsReviewCount > 0) {
    addWarning(warnings, 'income_needs_review', 'info');
    isEstimate = true;
  }
  if (
    projection.includedIncomeCount > 0
    && projection.elapsedDaysInCurrentMonth !== null
    && projection.elapsedDaysInCurrentMonth < 4
  ) {
    addWarning(warnings, 'income_sample_too_small', 'info');
    isEstimate = true;
  }
  if (projection.incomePaceGap !== null && projection.incomePaceGap < 0) {
    addWarning(warnings, 'income_pace_behind', 'caution');
  }
  if (
    projection.requiredRemainingDailyIncome !== null
    && projection.requiredRemainingDailyIncome > 0
    && (
      !projection.averageDailyIncome
      || projection.requiredRemainingDailyIncome
        > projection.averageDailyIncome * DAILY_TARGET_HIGH_MULTIPLIER
    )
  ) {
    addWarning(warnings, 'daily_target_high', 'caution');
  }

  const debtToIncomePercent = monthlyIncomeUsed
    ? minimumDebtPayment / monthlyIncomeUsed * 100
    : null;
  if (debtToIncomePercent !== null && debtToIncomePercent > 50) {
    addWarning(warnings, 'very_high_dti', 'high');
  } else if (debtToIncomePercent !== null && debtToIncomePercent > 40) {
    addWarning(warnings, 'high_dti', 'caution');
  }
  if (monthlyIncomeUsed !== null && minimumDebtPayment > monthlyIncomeUsed) {
    addWarning(warnings, 'minimum_payment_exceeds_income', 'high');
  }

  const essentialExpenses = finiteNonNegative(input.expenses.essentialMonthlyExpenses);
  const emergencyContribution = finiteNonNegative(input.expenses.emergencyContribution) || 0;
  if (essentialExpenses === null) {
    addWarning(warnings, 'essential_expense_missing', 'caution');
    isEstimate = true;
  }
  const safeSpendAmount = monthlyIncomeUsed !== null && essentialExpenses !== null
    ? Math.max(
        monthlyIncomeUsed
          - essentialExpenses
          - (finiteNonNegative(input.options.plannedMonthlyDebtPayment) ?? minimumDebtPayment)
          - emergencyContribution,
        0
      )
    : null;
  const freeCashflowAfterDebt = monthlyIncomeUsed !== null && essentialExpenses !== null
    ? Math.max(monthlyIncomeUsed - essentialExpenses - emergencyContribution, 0)
    : null;

  const emergencyFundTarget = finitePositive(input.expenses.emergencyFundTarget);
  const emergencyFundAvailable = finiteNonNegative(input.expenses.emergencyFundAvailable);
  if (
    emergencyFundTarget !== null
    && (emergencyFundAvailable === null || emergencyFundAvailable < emergencyFundTarget)
  ) {
    addWarning(warnings, 'emergency_buffer_low', 'caution');
  }

  const monthlyDebtPayment = finitePositive(input.options.plannedMonthlyDebtPayment)
    || finitePositive(minimumDebtPayment);
  const estimatedMonthsToDebtFree = totalDebt <= 0
    ? 0
    : monthlyDebtPayment
      ? timelineMonthsForPayment(debts, orderedDebts, monthlyDebtPayment)
      : null;
  if (totalDebt > 0 && estimatedMonthsToDebtFree === null) {
    addWarning(warnings, 'target_unreachable', 'high');
  }
  const estimatedDebtFreeDate = addMonthsToDate(input.options.now, estimatedMonthsToDebtFree);

  let extraMonthlyNeededForTarget: number | null = null;
  if (input.options.targetDebtFreeMonths !== undefined && input.options.targetDebtFreeMonths !== null) {
    const requiredPayment = requiredPaymentForTarget(
      debts,
      orderedDebts,
      input.options.targetDebtFreeMonths
    );
    if (requiredPayment === null) {
      addWarning(warnings, 'target_unreachable', 'high');
    } else {
      extraMonthlyNeededForTarget = Math.max(requiredPayment - (monthlyDebtPayment || 0), 0);
    }
  }

  const score = debtFreedomScore(totalDebt, warnings);
  return {
    totalDebt,
    minimumDebtPayment,
    monthlyIncomeUsed,
    incomeProjection: projection,
    debtToIncomePercent,
    safeSpendAmount,
    freeCashflowAfterDebt,
    estimatedMonthsToDebtFree,
    estimatedDebtFreeDate,
    extraMonthlyNeededForTarget,
    ...score,
    strategy,
    orderedDebts,
    debts,
    warnings,
    insightTokens,
    isEstimate,
  };
}
