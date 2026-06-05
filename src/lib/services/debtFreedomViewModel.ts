import { supabase } from '../core';
import {
  CreditCard,
  getBankAccounts,
  getCreditCards,
  getLoans,
  Loan,
} from '../database/financial';
import { getPeopleLedger } from '../database/userdata';
import {
  BalanceSnapshot,
  BankAccount,
  CreditCardStatement,
  PeopleLedger,
  Transaction,
  TransactionEvidence,
} from '../../types';
import {
  calculateDebtFreedomPlan,
  classifyIncomeCandidate,
  DebtFreedomOptions,
  DebtFreedomPlan,
  DebtItem,
  ExpensePlan,
  IncomeEvent,
  IncomePlan,
} from './debtFreedom';
import {
  DebtFreedomSettings,
  getDebtFreedomSettings,
  isDebtFreedomSettingsTableMissingError,
} from './debtFreedomSettings';


type DebtFreedomSourceRows = {
  transactions: Transaction[];
  bankAccounts: BankAccount[];
  creditCards: CreditCard[];
  creditCardStatements: CreditCardStatement[];
  loans: Loan[];
  peopleLedger: PeopleLedger[];
  balanceSnapshots: BalanceSnapshot[];
  incomeEvidence: TransactionEvidence[];
};

export type DebtFreedomCoachViewModelOptions = DebtFreedomOptions & {
  rows?: Partial<DebtFreedomSourceRows>;
  settings?: DebtFreedomSettings | null;
  settingsError?: unknown;
};

export type DebtFreedomCoachViewModel = {
  plan: DebtFreedomPlan;
  debtItems: DebtItem[];
  incomeEvents: IncomeEvent[];
  summary: {
    totalDebtLabel: string;
    monthlyIncomeLabel: string;
    dailyTargetLabel: string;
    debtFreeDateLabel: string;
    safeSpendLabel: string;
    scoreLabel: string;
  };
  dataQuality: {
    hasConfirmedIncome: boolean;
    hasVariableIncomeEstimate: boolean;
    needsIncomeReviewCount: number;
    duplicateDebtWarningCount: number;
    missingAprCount: number;
    missingEmiCount: number;
    hiddenDebtCount: number;
  };
  settings: DebtFreedomSettings | null;
  settingsStatus: 'loaded' | 'missing' | 'error';
};

const INCOME_TOKENS = [
  'salary',
  'income',
  'freelance',
  'freelancing',
  'business',
  'payout',
  'earnings',
  'earning',
  'porter',
  'swiggy',
  'zomato',
  'rapido',
  'zepto',
  'delivery',
];

const GIG_TOKENS = ['porter', 'swiggy', 'zomato', 'rapido', 'zepto', 'delivery'];
const FAMILY_OR_FRIEND_TOKENS = [
  'family',
  'friend',
  'papa',
  'mummy',
  'mom',
  'dad',
  'brother',
  'sister',
  'split',
  'rent return',
  'borrowed',
  'loan from friend',
];
const REFUND_TOKENS = ['refund', 'reimbursement', 'reimburse'];
const TRANSFER_TOKENS = ['self transfer', 'own account', 'personal transfer'];
const INCOME_EVIDENCE_COLUMNS = [
  'id',
  'user_id',
  'signal_id',
  'transaction_id',
  'source_type',
  'source_package',
  'source_app',
  'amount',
  'direction',
  'captured_at',
  'merchant_or_person',
  'bank_name',
  'confidence_level',
  'match_status',
].join(', ');

function finitePositive(value?: number | null): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}

function finiteNonNegative(value?: number | null): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

function normalizedText(...values: Array<string | null | undefined>): string {
  return values.filter(Boolean).join(' ').toLowerCase().replace(/\s+/g, ' ').trim();
}

function looksSensitiveText(value?: string | null): boolean {
  const text = value || '';
  return (
    /\b(?:otp|one\s*time\s*password|verification\s*code)\b/i.test(text)
    || /\b(?:\+?91[-\s]?)?[6-9]\d{9}\b/.test(text)
    || /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i.test(text)
    || /\b[\w.-]+@[a-z]{2,}\b/i.test(text)
    || /\b\d(?:[ -]?\d){5,}\b/.test(text)
    || /\b(?:address|flat|tower|road|street|society|sector|near|landmark|pincode|pin code)\b/i.test(text)
  );
}

function safeCategory(value?: string | null): string | null {
  const trimmed = value?.trim();
  if (!trimmed || looksSensitiveText(trimmed)) return null;
  return trimmed.slice(0, 48);
}

function hasAnyToken(text: string, tokens: string[]): boolean {
  return tokens.some(token => text.includes(token));
}

function normalizeDigits(value?: string | null): string | null {
  const digits = (value || '').replace(/\D/g, '');
  return digits ? digits.slice(-4) : null;
}

function normalizeName(value?: string | null): string {
  return (value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function amountClose(a?: number | null, b?: number | null): boolean {
  if (!finitePositive(a) || !finitePositive(b)) return false;
  const gap = Math.abs(Number(a) - Number(b));
  return gap <= Math.max(100, Math.max(Number(a), Number(b)) * 0.05);
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

function nextDateForDay(day?: number | null, nowValue?: string | null): string | null {
  if (!day || !Number.isFinite(day)) return null;
  const now = parseDate(nowValue) || new Date();
  const boundedDay = Math.max(1, Math.min(31, Math.trunc(day)));
  const candidate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), boundedDay));
  if (candidate < startOfUtcMonth(now) || candidate < now) {
    candidate.setUTCMonth(candidate.getUTCMonth() + 1);
  }
  return isoDate(candidate);
}

function isCurrentMonthDate(value: string | null | undefined, options: DebtFreedomOptions): boolean {
  const receivedAt = parseDate(value);
  if (!receivedAt) return false;
  const now = parseDate(options.now) || new Date();
  const monthStart = startOfUtcMonth(parseDate(options.monthStart) || now);
  const nextMonthStart = addUtcMonths(monthStart, 1);
  return receivedAt >= monthStart && receivedAt <= now && receivedAt < nextMonthStart;
}

function latestByDate<T>(
  rows: T[],
  dateSelector: (row: T) => string | null | undefined
): T | null {
  return [...rows].sort((a, b) => {
    const aTime = parseDate(dateSelector(a))?.getTime() || 0;
    const bTime = parseDate(dateSelector(b))?.getTime() || 0;
    return bTime - aTime;
  })[0] || null;
}

function confidenceFromSnapshot(snapshot?: BalanceSnapshot | null): DebtItem['confidence'] {
  if (!snapshot) return 'estimated';
  if (snapshot.confidence === 'exact') return 'exact';
  if (snapshot.confidence === 'low') return 'low';
  return 'estimated';
}

function latestSnapshot(
  snapshots: BalanceSnapshot[],
  ownerType: BalanceSnapshot['owner_type'],
  ownerId: string,
  kinds: BalanceSnapshot['balance_kind'][]
): BalanceSnapshot | null {
  return latestByDate(
    snapshots.filter(snapshot => (
      snapshot.owner_type === ownerType
      && snapshot.owner_id === ownerId
      && kinds.includes(snapshot.balance_kind)
    )),
    snapshot => snapshot.detected_at || snapshot.created_at
  );
}

function latestStatement(
  statements: CreditCardStatement[],
  cardId: string
): CreditCardStatement | null {
  return latestByDate(
    statements.filter(statement => statement.credit_card_id === cardId),
    statement => statement.payment_due_date || statement.statement_date || statement.created_at
  );
}

function debtDuplicateGroupCount(debts: DebtItem[]): number {
  const counts = new Map<string, number>();
  for (const debt of debts) {
    if (!debt.duplicateGroupKey) continue;
    counts.set(debt.duplicateGroupKey, (counts.get(debt.duplicateGroupKey) || 0) + 1);
  }
  return [...counts.values()].filter(count => count > 1).length;
}

function applyLoanDuplicateGroups(debts: DebtItem[]): void {
  const standaloneLoans = debts.filter(debt => debt.sourceType === 'loan');
  const loanAccounts = debts.filter(debt => debt.sourceType === 'loan_account');

  for (const account of loanAccounts) {
    const match = standaloneLoans.find(loan => {
      const sameLast4 = account.metadata?.last4
        && loan.metadata?.last4
        && account.metadata.last4 === loan.metadata.last4;
      const sameBank = account.metadata?.bankName
        && loan.metadata?.bankName
        && normalizeName(account.metadata.bankName) === normalizeName(loan.metadata.bankName);
      return Boolean((sameLast4 || sameBank) && amountClose(account.outstanding, loan.outstanding));
    });
    if (!match) continue;
    const groupKey = `loan:${match.id}:${account.id}`;
    match.duplicateGroupKey = groupKey;
    account.duplicateGroupKey = groupKey;
    account.confidence = 'needs_review';
  }
}

function applyCreditCardDuplicateGroups(debts: DebtItem[]): void {
  const cards = debts.filter(debt => debt.sourceType === 'credit_card' && debt.ownerId?.startsWith('card:'));
  const accountCards = debts.filter(debt => debt.sourceType === 'credit_card' && debt.ownerId?.startsWith('bank:'));

  for (const account of accountCards) {
    const match = cards.find(card => (
      account.metadata?.last4
      && card.metadata?.last4
      && account.metadata.last4 === card.metadata.last4
      && (
        !account.metadata.bankName
        || !card.metadata.bankName
        || normalizeName(account.metadata.bankName) === normalizeName(card.metadata.bankName)
      )
    ));
    if (!match) continue;
    const groupKey = `credit_card:${match.id}:${account.id}`;
    match.duplicateGroupKey = groupKey;
    account.duplicateGroupKey = groupKey;
    account.confidence = 'needs_review';
  }
}

function debtItem(
  item: DebtItem
): DebtItem | null {
  return item.outstanding > 0 ? item : null;
}

export function buildDebtItemsFromRows(rows: Partial<DebtFreedomSourceRows>, options: DebtFreedomOptions = {}): DebtItem[] {
  const debts: DebtItem[] = [];
  const snapshots = rows.balanceSnapshots || [];
  const statements = rows.creditCardStatements || [];

  for (const loan of rows.loans || []) {
    const outstanding = finitePositive(loan.current_outstanding) || finitePositive(loan.principal_amount) || 0;
    const dueDate = (loan as Loan & { next_due_date?: string | null }).next_due_date
      || nextDateForDay(loan.emi_due_date, options.now);
    const item = debtItem({
      id: `loan:${loan.id}`,
      sourceType: 'loan',
      ownerId: loan.id,
      label: 'Loan',
      outstanding,
      minimumMonthlyPayment: finiteNonNegative(loan.emi_amount),
      dueDate,
      annualInterestRate: finiteNonNegative(loan.interest_rate),
      confidence: finitePositive(loan.current_outstanding) ? 'exact' : 'estimated',
      metadata: {
        bankName: loan.lender_name || null,
        source: 'loans',
      },
    });
    if (item) debts.push(item);
  }

  for (const card of rows.creditCards || []) {
    const snapshot = latestSnapshot(snapshots, 'credit_card', card.id, ['outstanding']);
    const statement = latestStatement(statements, card.id);
    const outstanding = finitePositive(snapshot?.amount)
      || finitePositive(statement?.statement_balance)
      || finitePositive(card.current_outstanding)
      || 0;
    const hidden = card.is_archived === true;
    if (hidden && outstanding <= 0) continue;

    const item = debtItem({
      id: `credit_card:${card.id}`,
      sourceType: 'credit_card',
      ownerId: `card:${card.id}`,
      label: 'Credit card',
      outstanding,
      minimumMonthlyPayment: finiteNonNegative(statement?.minimum_due),
      dueDate: statement?.payment_due_date || nextDateForDay(card.due_date, options.now),
      annualInterestRate: finiteNonNegative((card as CreditCard & { annual_interest_rate?: number | null }).annual_interest_rate),
      confidence: snapshot ? confidenceFromSnapshot(snapshot) : 'estimated',
      isHidden: hidden,
      metadata: {
        bankName: card.bank_name || null,
        last4: normalizeDigits(card.last_4_digits),
        source: snapshot ? 'balance_snapshots' : 'credit_cards',
      },
    });
    if (item) debts.push(item);
  }

  for (const entry of rows.peopleLedger || []) {
    if (entry.type !== 'borrowed') continue;
    const outstanding = finitePositive(entry.remaining_amount) || 0;
    const item = debtItem({
      id: `people_borrowed:${entry.id}`,
      sourceType: 'people_borrowed',
      ownerId: entry.id,
      label: 'Borrowed balance',
      outstanding,
      minimumMonthlyPayment: finiteNonNegative(entry.installment_amount),
      dueDate: entry.due_date,
      annualInterestRate: null,
      confidence: entry.remaining_amount === entry.total_amount ? 'estimated' : 'exact',
      metadata: {
        source: 'people_ledger',
      },
    });
    if (item) debts.push(item);
  }

  for (const account of rows.bankAccounts || []) {
    const hidden = account.is_archived === true;

    if (account.account_type === 'loan') {
      const snapshot = latestSnapshot(snapshots, 'loan', account.id, ['loan_outstanding']);
      const outstanding = finitePositive(snapshot?.amount)
        || finitePositive(Math.abs(account.balance))
        || 0;
      if (hidden && outstanding <= 0) continue;
      const item = debtItem({
        id: `loan_account:${account.id}`,
        sourceType: 'loan_account',
        ownerId: account.id,
        label: 'Loan account',
        outstanding,
        minimumMonthlyPayment: finiteNonNegative(account.monthly_emi_amount),
        dueDate: null,
        annualInterestRate: null,
        confidence: snapshot
          ? confidenceFromSnapshot(snapshot)
          : finitePositive(Math.abs(account.balance)) ? 'exact' : 'estimated',
        isHidden: hidden,
        metadata: {
          bankName: account.bank_name || null,
          last4: normalizeDigits(account.account_last4),
          source: snapshot ? 'balance_snapshots' : 'bank_accounts',
          totalLoanAmount: finiteNonNegative(account.loan_total),
        },
      });
      if (item) debts.push(item);
    }

    if (account.account_type === 'credit_card') {
      const snapshot = latestSnapshot(snapshots, 'credit_card', account.id, ['outstanding', 'due_amount']);
      const outstanding = finitePositive(snapshot?.amount)
        || finitePositive(account.balance)
        || finitePositive(account.starting_balance)
        || 0;
      if (hidden && outstanding <= 0) continue;
      const item = debtItem({
        id: `credit_card_account:${account.id}`,
        sourceType: 'credit_card',
        ownerId: `bank:${account.id}`,
        label: 'Credit card account',
        outstanding,
        minimumMonthlyPayment: null,
        dueDate: null,
        annualInterestRate: null,
        confidence: snapshot ? confidenceFromSnapshot(snapshot) : 'estimated',
        isHidden: hidden,
        metadata: {
          bankName: account.bank_name || null,
          last4: normalizeDigits(account.account_last4),
          source: snapshot ? 'balance_snapshots' : 'bank_accounts',
        },
      });
      if (item) debts.push(item);
    }
  }

  applyLoanDuplicateGroups(debts);
  applyCreditCardDuplicateGroups(debts);
  return debts;
}

function incomeSourceForText(text: string): IncomeEvent['sourceType'] {
  if (text.includes('salary')) return 'salary';
  if (hasAnyToken(text, GIG_TOKENS)) return 'gig_work';
  if (text.includes('freelance') || text.includes('freelancing')) return 'freelance';
  if (text.includes('business')) return 'business';
  if (text.includes('upi')) return 'upi_credit';
  if (text.includes('bank')) return 'bank_credit';
  return 'unknown';
}

function labelForIncomeSource(sourceType: IncomeEvent['sourceType'], includeInIncome: boolean): string {
  if (!includeInIncome) return 'Income needs review';
  switch (sourceType) {
    case 'salary':
      return 'Salary income';
    case 'gig_work':
      return 'Gig income';
    case 'freelance':
      return 'Freelance income';
    case 'business':
      return 'Business income';
    default:
      return 'Income';
  }
}

function exclusionForTransaction(tx: Transaction, text: string): IncomeEvent['exclusionReason'] | null {
  if (tx.refund_of_transaction_id || tx.type === 'refund' || hasAnyToken(text, REFUND_TOKENS)) {
    return 'refund';
  }
  if (tx.type === 'borrowed' || text.includes('borrowed') || text.includes('loan from friend')) {
    return 'borrowed_money';
  }
  if (tx.type === 'transfer' || tx.from_account_id || tx.to_account_id || hasAnyToken(text, TRANSFER_TOKENS)) {
    return 'self_transfer';
  }
  if (tx.type === 'lent' || hasAnyToken(text, FAMILY_OR_FRIEND_TOKENS)) {
    return 'family_or_friend';
  }
  if (text.includes('reimbursement') || text.includes('reimburse')) {
    return 'reimbursement';
  }
  return null;
}

export function buildIncomeEventsFromTransactions(
  transactions: Transaction[],
  options: DebtFreedomOptions = {}
): IncomeEvent[] {
  return transactions.reduce<IncomeEvent[]>((events, tx) => {
    if (!isCurrentMonthDate(tx.created_at, options)) return events;

    const text = normalizedText(tx.category, tx.note, tx.sms_source);
    const exclusionReason = exclusionForTransaction(tx, text);
    if (exclusionReason) {
      const sourceType: IncomeEvent['sourceType'] = exclusionReason === 'refund'
        ? 'refund'
        : exclusionReason === 'borrowed_money'
          ? 'borrowed'
          : 'personal_transfer';
      events.push(classifyIncomeCandidate({
        id: tx.id,
        amount: tx.amount,
        receivedAt: tx.created_at,
        sourceType,
        label: 'Excluded income candidate',
        category: safeCategory(tx.category),
        confidence: 'excluded',
        includeInIncome: false,
        exclusionReason,
        metadata: {
          source: tx.sms_source ? 'transaction_signal' : 'manual',
          referencePresent: Boolean(tx.reference_number),
        },
      }));
      return events;
    }

    if (tx.account_match_status === 'ignored') {
      events.push(classifyIncomeCandidate({
        id: tx.id,
        amount: tx.amount,
        receivedAt: tx.created_at,
        sourceType: 'unknown',
        label: 'Excluded by user',
        category: safeCategory(tx.category),
        confidence: 'excluded',
        includeInIncome: false,
        exclusionReason: 'unknown_credit',
        metadata: {
          source: tx.sms_source ? 'transaction_signal' : 'manual',
          referencePresent: Boolean(tx.reference_number),
        },
      }));
      return events;
    }

    if (tx.type !== 'income') return events;

    const isManualConfirmed = tx.account_match_status === 'manual_confirmed';
    const sourceType = incomeSourceForText(text);
    const explicitCategory = hasAnyToken(normalizedText(tx.category), INCOME_TOKENS);
    const earnedSignal = hasAnyToken(text, INCOME_TOKENS);
    const includeInIncome = isManualConfirmed || (['salary', 'gig_work', 'freelance', 'business'].includes(sourceType) && earnedSignal);
    const confidence: IncomeEvent['confidence'] = isManualConfirmed
      ? 'confirmed'
      : includeInIncome
        ? explicitCategory || sourceType === 'salary' ? 'high' : 'medium'
        : 'needs_review';

    events.push(classifyIncomeCandidate({
      id: tx.id,
      amount: tx.amount,
      receivedAt: tx.created_at,
      sourceType: includeInIncome ? sourceType : (text.includes('upi') ? 'upi_credit' : sourceType),
      label: labelForIncomeSource(sourceType, includeInIncome),
      category: safeCategory(tx.category),
      counterpartyLabel: null,
      confidence,
      includeInIncome,
      exclusionReason: null,
      metadata: {
        source: tx.sms_source ? 'transaction_signal' : 'manual',
        referencePresent: Boolean(tx.reference_number),
      },
    }));
    return events;
  }, []);
}

function rupee(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return 'Needs review';
  return `₹${Math.round(value).toLocaleString('en-IN')}`;
}

function formatDateLabel(value: string | null): string {
  const date = parseDate(value);
  if (!date) return 'Debt-free date estimate: Needs review';
  return `Debt-free date estimate: ${date.toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  })}`;
}

function scoreLabel(score: DebtFreedomPlan['scoreLabel']): string {
  switch (score) {
    case 'good':
      return 'Good';
    case 'caution':
      return 'Caution';
    case 'high_risk':
      return 'High risk';
    default:
      return 'Needs review';
  }
}

export function buildDebtFreedomSummaryLabels(plan: DebtFreedomPlan): DebtFreedomCoachViewModel['summary'] {
  const monthlyIncomePrefix = plan.incomeProjection.source === 'confirmed'
    ? 'Confirmed: '
    : plan.incomeProjection.source === 'manual_estimate'
      ? 'Manual estimate: '
      : plan.incomeProjection.source === 'current_month_daily_average'
        ? 'Estimate: '
        : '';
  const safeSpendPrefix = plan.safeSpendAmount === null || plan.isEstimate ? 'Estimate: ' : '';
  return {
    totalDebtLabel: rupee(plan.totalDebt),
    monthlyIncomeLabel: plan.monthlyIncomeUsed === null
      ? 'Needs review'
      : `${monthlyIncomePrefix}${rupee(plan.monthlyIncomeUsed)}`,
    dailyTargetLabel: `Today’s target: ${rupee(plan.incomeProjection.todayIncomeTarget)}`,
    debtFreeDateLabel: formatDateLabel(plan.estimatedDebtFreeDate),
    safeSpendLabel: plan.safeSpendAmount === null
      ? 'Needs review'
      : `${safeSpendPrefix}${rupee(plan.safeSpendAmount)}`,
    scoreLabel: scoreLabel(plan.scoreLabel),
  };
}

async function getCurrentUserId(): Promise<string> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user?.id) throw new Error('Not authenticated');
  return user.id;
}

async function fetchTransactionsForUser(userId: string): Promise<Transaction[]> {
  const { data, error } = await supabase
    .from('transactions')
    .select('id, user_id, amount, type, note, category, created_at, account_id, account_last4, sms_source, reference_number, from_account_id, to_account_id, refund_of_transaction_id, account_match_status')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });

  if (error) throw error;
  return (data || []) as Transaction[];
}

async function fetchIncomeEvidenceForUser(userId: string): Promise<TransactionEvidence[]> {
  const { data, error } = await supabase
    .from('transaction_evidence')
    .select(INCOME_EVIDENCE_COLUMNS)
    .eq('user_id', userId)
    .eq('direction', 'credit')
    .order('captured_at', { ascending: false })
    .limit(200);

  if (error) throw error;
  return (data || []) as unknown as TransactionEvidence[];
}

async function fetchCreditCardStatementsForUser(userId: string, cardIds: string[]): Promise<CreditCardStatement[]> {
  if (!cardIds.length) return [];
  const { data, error } = await supabase
    .from('credit_card_statements')
    .select('id, user_id, credit_card_id, statement_date, period_start, period_end, total_due, minimum_due, payment_due_date, statement_balance, source_snapshot_id, status, source, confidence, created_at')
    .eq('user_id', userId)
    .in('credit_card_id', cardIds)
    .order('payment_due_date', { ascending: false });

  if (error) throw error;
  return (data || []) as CreditCardStatement[];
}

async function fetchBalanceSnapshotsForUser(
  userId: string,
  owners: Array<{ ownerType: BalanceSnapshot['owner_type']; ownerId: string }>
): Promise<BalanceSnapshot[]> {
  const snapshots: BalanceSnapshot[] = [];
  for (const ownerType of ['credit_card', 'loan'] as const) {
    const ownerIds = owners
      .filter(owner => owner.ownerType === ownerType)
      .map(owner => owner.ownerId);
    if (!ownerIds.length) continue;
    const { data, error } = await supabase
      .from('balance_snapshots')
      .select('id, user_id, owner_type, owner_id, detected_bank_name, account_last4, card_last4, balance_kind, amount, currency, source, confidence, detected_at, source_sender_or_package, created_at')
      .eq('user_id', userId)
      .eq('owner_type', ownerType)
      .in('owner_id', ownerIds)
      .order('detected_at', { ascending: false })
      .limit(Math.max(100, ownerIds.length * 8));

    if (error) throw error;
    snapshots.push(...((data || []) as BalanceSnapshot[]));
  }
  return snapshots;
}

async function fetchDebtFreedomRows(): Promise<DebtFreedomSourceRows> {
  const userId = await getCurrentUserId();
  const [transactions, bankAccounts, creditCards, loans, peopleLedger] = await Promise.all([
    fetchTransactionsForUser(userId),
    getBankAccounts({ includeArchived: true }),
    getCreditCards({ includeArchived: true }),
    getLoans(),
    getPeopleLedger(false),
  ]);
  const creditCardOwnerIds = [
    ...creditCards.map(card => ({ ownerType: 'credit_card' as const, ownerId: card.id })),
    ...bankAccounts
      .filter(account => account.account_type === 'credit_card')
      .map(account => ({ ownerType: 'credit_card' as const, ownerId: account.id })),
  ];
  const loanOwnerIds = bankAccounts
    .filter(account => account.account_type === 'loan')
    .map(account => ({ ownerType: 'loan' as const, ownerId: account.id }));
  const [creditCardStatements, balanceSnapshots, incomeEvidence] = await Promise.all([
    fetchCreditCardStatementsForUser(userId, creditCards.map(card => card.id)),
    fetchBalanceSnapshotsForUser(userId, [...creditCardOwnerIds, ...loanOwnerIds]),
    fetchIncomeEvidenceForUser(userId),
  ]);

  return {
    transactions,
    bankAccounts,
    creditCards,
    creditCardStatements,
    loans,
    peopleLedger,
    balanceSnapshots,
    incomeEvidence,
  };
}

function buildDataQuality(
  plan: DebtFreedomPlan,
  debtItems: DebtItem[],
  incomeEvents: IncomeEvent[]
): DebtFreedomCoachViewModel['dataQuality'] {
  return {
    hasConfirmedIncome: plan.incomeProjection.source === 'confirmed',
    hasVariableIncomeEstimate: plan.incomeProjection.source === 'current_month_daily_average',
    needsIncomeReviewCount: incomeEvents.filter(event => event.confidence === 'needs_review').length,
    duplicateDebtWarningCount: debtDuplicateGroupCount(debtItems),
    missingAprCount: debtItems.filter(debt => debt.outstanding > 0 && debt.annualInterestRate === null).length,
    missingEmiCount: debtItems.filter(debt =>
      debt.outstanding > 0
      && debt.minimumMonthlyPayment === null
      && (debt.sourceType === 'loan' || debt.sourceType === 'loan_account')
    ).length,
    hiddenDebtCount: debtItems.filter(debt => debt.outstanding > 0 && debt.isHidden).length,
  };
}

async function resolveSettings(
  options: DebtFreedomCoachViewModelOptions
): Promise<Pick<DebtFreedomCoachViewModel, 'settings' | 'settingsStatus'>> {
  if (Object.prototype.hasOwnProperty.call(options, 'settingsError')) {
    if (isDebtFreedomSettingsTableMissingError(options.settingsError)) {
      return { settings: null, settingsStatus: 'error' };
    }
    throw options.settingsError;
  }

  if (Object.prototype.hasOwnProperty.call(options, 'settings')) {
    return options.settings
      ? { settings: options.settings, settingsStatus: 'loaded' }
      : { settings: null, settingsStatus: 'missing' };
  }

  if (options.rows) {
    return { settings: null, settingsStatus: 'missing' };
  }

  try {
    const settings = await getDebtFreedomSettings();
    return settings
      ? { settings, settingsStatus: 'loaded' }
      : { settings: null, settingsStatus: 'missing' };
  } catch (error) {
    if (isDebtFreedomSettingsTableMissingError(error)) {
      return { settings: null, settingsStatus: 'error' };
    }
    throw error;
  }
}

function buildIncomePlan(
  incomeEvents: IncomeEvent[],
  settings: DebtFreedomSettings | null
): IncomePlan {
  const amount = finitePositive(settings?.confirmed_monthly_income);
  if (settings?.income_mode === 'confirmed' && amount) {
    return {
      confirmedMonthlyIncome: amount,
      estimatedMonthlyIncome: null,
      incomeSource: 'confirmed',
      incomeEvents,
    };
  }

  if (settings?.income_mode === 'manual_estimate' && amount) {
    return {
      confirmedMonthlyIncome: null,
      estimatedMonthlyIncome: amount,
      incomeSource: 'manual_estimate',
      incomeEvents,
    };
  }

  return {
    confirmedMonthlyIncome: null,
    estimatedMonthlyIncome: null,
    incomeSource: incomeEvents.length ? 'current_month_daily_average' : 'missing',
    incomeEvents,
  };
}

function buildExpensePlan(settings: DebtFreedomSettings | null): ExpensePlan {
  return {
    essentialMonthlyExpenses: finiteNonNegative(settings?.essential_monthly_expenses),
    emergencyContribution: finiteNonNegative(settings?.emergency_contribution) || 0,
    emergencyFundAvailable: null,
    emergencyFundTarget: null,
  };
}

function applySettingsOptions(
  planOptions: DebtFreedomOptions,
  settings: DebtFreedomSettings | null
): DebtFreedomOptions {
  return {
    ...planOptions,
    strategy: settings?.strategy || planOptions.strategy || 'balanced',
    targetMonthlyIncome: finitePositive(settings?.target_monthly_income) ?? planOptions.targetMonthlyIncome,
    plannedMonthlyDebtPayment: finitePositive(settings?.planned_monthly_debt_payment)
      ?? planOptions.plannedMonthlyDebtPayment,
    targetDebtFreeMonths: settings?.target_debt_free_months || planOptions.targetDebtFreeMonths,
  };
}

export async function getDebtFreedomCoachViewModel(
  options: DebtFreedomCoachViewModelOptions = {}
): Promise<DebtFreedomCoachViewModel> {
  const { rows } = options;
  const planOptions = options as DebtFreedomOptions;
  const sourceRows = rows ? {
    transactions: rows.transactions || [],
    bankAccounts: rows.bankAccounts || [],
    creditCards: rows.creditCards || [],
    creditCardStatements: rows.creditCardStatements || [],
    loans: rows.loans || [],
    peopleLedger: rows.peopleLedger || [],
    balanceSnapshots: rows.balanceSnapshots || [],
    incomeEvidence: rows.incomeEvidence || [],
  } : await fetchDebtFreedomRows();

  const debtItems = buildDebtItemsFromRows(sourceRows, planOptions);
  const rawIncomeEvents = buildIncomeEventsFromTransactions(sourceRows.transactions, planOptions);
  const incomeEvents = rawIncomeEvents;
  const { settings, settingsStatus } = await resolveSettings(options);
  const income = buildIncomePlan(incomeEvents, settings);
  const expenses = buildExpensePlan(settings);
  const settingsPlanOptions = applySettingsOptions(planOptions, settings);
  const plan = calculateDebtFreedomPlan({
    debts: debtItems,
    income,
    expenses,
    options: {
      ...settingsPlanOptions,
    },
  });

  return {
    plan,
    debtItems,
    incomeEvents,
    summary: buildDebtFreedomSummaryLabels(plan),
    dataQuality: buildDataQuality(plan, debtItems, incomeEvents),
    settings,
    settingsStatus,
  };
}
