import { supabase } from '../core';
import {
  BalanceConfidence,
  BalanceKind,
  BalanceOwnerType,
  BalanceSnapshot,
  BalanceSource,
  BankAccount,
  CreditCardStatement,
  DetectedAccount,
} from '../../types';
import { CreditCard } from '../database/financial';

export interface LatestBalanceValue {
  balanceKind: BalanceKind;
  amount: number;
  source: BalanceSource;
  confidence: BalanceConfidence;
  detectedAt: string | null;
  sourceLabel: string;
  confidenceLabel: string;
  isEstimated: boolean;
  staleWarning: boolean;
}

export type LatestBalanceByKind = Partial<Record<BalanceKind, LatestBalanceValue>>;

export interface BankAccountBalanceView {
  accountId: string;
  bankName: string;
  accountLast4: string;
  accountType: BankAccount['account_type'];
  displayBalance: number;
  balanceKind: BalanceKind;
  source: BalanceSource;
  confidence: BalanceConfidence;
  lastUpdated: string | null;
  isEstimated: boolean;
  sourceLabel: string;
  confidenceLabel: string;
  staleWarning?: boolean;
}

export interface CreditCardBalanceView {
  creditCardId: string;
  bankName: string;
  cardName: string | null;
  cardLast4: string;
  outstanding: number;
  availableLimit: number;
  creditLimit: number;
  dueAmount: number | null;
  minimumDue: number | null;
  paymentDueDate: string | null;
  source: BalanceSource;
  confidence: BalanceConfidence;
  lastUpdated: string | null;
  utilizationPercent: number;
  sourceLabel: string;
  confidenceLabel: string;
  staleWarning?: boolean;
}

export interface LegacyCreditCardPosition {
  outstanding: number;
  availableCredit: number;
  creditLimit: number;
}

export interface BalanceHistoryItem {
  id: string;
  balanceKind: BalanceKind;
  balanceKindLabel: string;
  amount: number;
  source: BalanceSource;
  confidence: BalanceConfidence;
  detectedAt: string;
  freshnessLabel: string;
  sourceLabel: string;
  confidenceLabel: string;
  noteSafe: string | null;
}

export interface BalanceHistoryOptions {
  limit?: number;
  balanceKind?: BalanceKind;
}

export interface BalanceHistoryView {
  ownerType: BalanceOwnerType;
  ownerId: string;
  items: BalanceHistoryItem[];
  hasHistory: boolean;
}

export interface BankAccountDetailView extends BankAccountBalanceView {
  history: BalanceHistoryItem[];
  hasHistory: boolean;
}

export interface CreditCardDetailView extends CreditCardBalanceView {
  history: BalanceHistoryItem[];
  historyByKind: Partial<Record<BalanceKind, BalanceHistoryItem[]>>;
}

export interface PendingDetectedBalanceSummary {
  total: number;
  bank_account: number;
  credit_card: number;
  debit_card: number;
  loan: number;
}

type SnapshotRow = Pick<
  BalanceSnapshot,
  | 'id'
  | 'owner_type'
  | 'owner_id'
  | 'balance_kind'
  | 'amount'
  | 'source'
  | 'confidence'
  | 'detected_at'
  | 'created_at'
>;

type HistorySnapshotRow = Pick<
  BalanceSnapshot,
  | 'id'
  | 'balance_kind'
  | 'amount'
  | 'source'
  | 'confidence'
  | 'detected_at'
  | 'created_at'
  | 'note'
>;

type StatementRow = Pick<
  CreditCardStatement,
  | 'id'
  | 'user_id'
  | 'credit_card_id'
  | 'statement_date'
  | 'period_start'
  | 'period_end'
  | 'total_due'
  | 'minimum_due'
  | 'payment_due_date'
  | 'statement_balance'
  | 'source_snapshot_id'
  | 'status'
  | 'source'
  | 'confidence'
  | 'created_at'
  | 'updated_at'
>;

const STALE_BALANCE_MS = 7 * 24 * 60 * 60 * 1000;
const BALANCE_TIE_WINDOW_MS = 2 * 60 * 1000;

function toNumber(value: unknown, fallback = 0): number {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : fallback;
}

export function isAssetBankAccount(account: Pick<BankAccount, 'account_type'>): boolean {
  return account.account_type === 'savings' || account.account_type === 'current';
}

export function getBankAccountDisplayBalance(
  account: Pick<BankAccount, 'balance' | 'starting_balance'>,
  balanceView?: Pick<BankAccountBalanceView, 'displayBalance'>
): number {
  return toNumber(balanceView?.displayBalance ?? account.balance ?? account.starting_balance);
}

export function getLegacyCreditCardPosition(
  account: Pick<BankAccount, 'account_type' | 'balance' | 'starting_balance' | 'credit_limit'>,
  balanceView?: Pick<BankAccountBalanceView, 'displayBalance' | 'balanceKind'> & Partial<Pick<BankAccountBalanceView, 'source'>>
): LegacyCreditCardPosition {
  const creditLimit = Math.max(toNumber(account.credit_limit), 0);
  const displayBalance = Math.max(getBankAccountDisplayBalance(account, balanceView), 0);

  if (account.account_type !== 'credit_card') {
    return { outstanding: 0, availableCredit: 0, creditLimit };
  }

  const calculatedOutstandingFallback = !balanceView || (
    balanceView.balanceKind === 'outstanding' && balanceView.source === 'calculated'
  );
  const likelyAvailableCreditFallback = calculatedOutstandingFallback
    && creditLimit > 0
    && displayBalance >= creditLimit * 0.8;
  if (balanceView?.balanceKind === 'available_limit' || likelyAvailableCreditFallback) {
    const availableCredit = displayBalance;
    return {
      outstanding: creditLimit > 0 ? Math.max(creditLimit - availableCredit, 0) : 0,
      availableCredit,
      creditLimit,
    };
  }

  const outstanding = displayBalance;
  return {
    outstanding,
    availableCredit: creditLimit > 0 ? Math.max(creditLimit - outstanding, 0) : 0,
    creditLimit,
  };
}

export function getBankAccountAssetBalance(
  account: Pick<BankAccount, 'account_type' | 'balance' | 'starting_balance'>,
  balanceView?: Pick<BankAccountBalanceView, 'displayBalance'>
): number {
  return isAssetBankAccount(account) ? getBankAccountDisplayBalance(account, balanceView) : 0;
}

export function getBankAccountLiabilityBalance(
  account: Pick<BankAccount, 'account_type' | 'balance' | 'starting_balance' | 'credit_limit'>,
  balanceView?: Pick<BankAccountBalanceView, 'displayBalance' | 'balanceKind'> & Partial<Pick<BankAccountBalanceView, 'source'>>
): number {
  if (account.account_type === 'loan') {
    return Math.max(getBankAccountDisplayBalance(account, balanceView), 0);
  }
  if (account.account_type === 'credit_card') {
    return getLegacyCreditCardPosition(account, balanceView).outstanding;
  }
  return 0;
}

export function getTotalAssetBankBalance(
  accounts: Array<Pick<BankAccount, 'id' | 'account_type' | 'balance' | 'starting_balance'>>,
  balanceViews: Record<string, Pick<BankAccountBalanceView, 'displayBalance'> | undefined> = {}
): number {
  return accounts.reduce((sum, account) => sum + getBankAccountAssetBalance(account, balanceViews[account.id]), 0);
}

function sourceRank(source: BalanceSource, confidence: BalanceConfidence): number {
  if (source === 'manual' && confidence === 'exact') return 500;
  if ((source === 'sms' || source === 'notification') && confidence === 'exact') return 400;
  if (source === 'calculated' && confidence === 'exact') return 300;
  if (source === 'manual') return 280;
  if (source === 'sms' || source === 'notification') return confidence === 'estimated' ? 250 : 150;
  if (source === 'calculated') return confidence === 'estimated' ? 200 : 100;
  if (source === 'review') return 90;
  return 80;
}

function isManualExact(value: Pick<SnapshotRow, 'source' | 'confidence'> | Pick<LatestBalanceValue, 'source' | 'confidence'>): boolean {
  return value.source === 'manual' && value.confidence === 'exact';
}

function isWeakBalanceSignal(
  value: Pick<SnapshotRow, 'source' | 'confidence'> | Pick<LatestBalanceValue, 'source' | 'confidence'>
): boolean {
  return value.confidence !== 'exact' || value.source === 'calculated' || value.source === 'import';
}

function detectedTime(snapshot: SnapshotRow): number {
  const detected = new Date(snapshot.detected_at).getTime();
  if (Number.isFinite(detected)) return detected;
  const created = new Date(snapshot.created_at).getTime();
  return Number.isFinite(created) ? created : 0;
}

function compareBalanceAuthority(
  left: Pick<SnapshotRow, 'source' | 'confidence'>,
  right: Pick<SnapshotRow, 'source' | 'confidence'>,
  leftTime: number,
  rightTime: number
): number {
  const timeDiff = rightTime - leftTime;
  const closeInTime = Math.abs(timeDiff) <= BALANCE_TIE_WINDOW_MS;
  const rankDiff = sourceRank(right.source, right.confidence) - sourceRank(left.source, left.confidence);

  if (isManualExact(left) && isWeakBalanceSignal(right)) return -1;
  if (isManualExact(right) && isWeakBalanceSignal(left)) return 1;

  if (left.confidence === 'low' || right.confidence === 'low') {
    if (rankDiff !== 0) return rankDiff;
  }

  if (!closeInTime) {
    return timeDiff;
  }

  if (rankDiff !== 0) return rankDiff;
  return 0;
}

export function selectBestBalanceSnapshot(snapshots: SnapshotRow[]): SnapshotRow | null {
  if (!snapshots.length) return null;

  return [...snapshots].sort((left, right) => {
    const leftTime = detectedTime(left);
    const rightTime = detectedTime(right);
    const authorityDiff = compareBalanceAuthority(left, right, leftTime, rightTime);
    if (authorityDiff !== 0) return authorityDiff;

    return String(right.id).localeCompare(String(left.id));
  })[0];
}

export function getBalanceSourceLabel(source: BalanceSource): string {
  switch (source) {
    case 'sms':
      return 'SMS';
    case 'notification':
      return 'Notification';
    case 'manual':
      return 'Manual correction';
    case 'calculated':
      return 'Calculated';
    case 'review':
      return 'Review';
    case 'import':
      return 'Import';
    default:
      return 'Calculated';
  }
}

export function getBalanceConfidenceLabel(confidence: BalanceConfidence): string {
  switch (confidence) {
    case 'exact':
      return 'Exact';
    case 'estimated':
      return 'Estimated';
    case 'low':
      return 'Low';
    default:
      return 'Estimated';
  }
}

export function getBalanceKindLabel(kind: BalanceKind): string {
  switch (kind) {
    case 'available_balance':
      return 'Available';
    case 'current_balance':
      return 'Current';
    case 'outstanding':
      return 'Outstanding';
    case 'available_limit':
      return 'Available Limit';
    case 'credit_limit':
      return 'Credit Limit';
    case 'due_amount':
      return 'Due Amount';
    case 'minimum_due':
      return 'Minimum Due';
    case 'loan_outstanding':
      return 'Loan Outstanding';
    default:
      return 'Balance';
  }
}

export function isBalanceStale(detectedAt?: string | null, now = Date.now()): boolean {
  if (!detectedAt) return false;
  const time = new Date(detectedAt).getTime();
  return Number.isFinite(time) && now - time > STALE_BALANCE_MS;
}

export function getBalanceFreshnessLabel(detectedAt?: string | null, now = Date.now()): string {
  if (!detectedAt) return 'Calculated balance';

  const time = new Date(detectedAt).getTime();
  if (!Number.isFinite(time)) return 'Updated recently';

  const diffMs = now - time;
  if (diffMs < 60 * 1000) return 'Just now';
  const days = Math.floor(diffMs / (24 * 60 * 60 * 1000));
  if (days <= 0) return 'Updated today';
  if (days === 1) return 'Updated 1 day ago';
  return `Updated ${days} days ago`;
}

function safeSnapshotNote(note?: string | null): string | null {
  const trimmed = note?.trim();
  if (!trimmed) return null;
  if (/\b(raw|sms|notification|payload|json|otp|phone|address|message|body|account\s*number|card\s*number|full\s*account|full\s*card)\b/i.test(trimmed)) return null;
  if (/\d{6,}/.test(trimmed)) return null;
  const cleaned = trimmed
    .replace(/[^\w\s.,:;()/-]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80)
    .trim();
  return cleaned || null;
}

function toLatestBalanceValue(snapshot: SnapshotRow): LatestBalanceValue {
  return {
    balanceKind: snapshot.balance_kind,
    amount: toNumber(snapshot.amount),
    source: snapshot.source,
    confidence: snapshot.confidence,
    detectedAt: snapshot.detected_at,
    sourceLabel: getBalanceSourceLabel(snapshot.source),
    confidenceLabel: getBalanceConfidenceLabel(snapshot.confidence),
    isEstimated: snapshot.confidence !== 'exact',
    staleWarning: isBalanceStale(snapshot.detected_at),
  };
}

export function buildBalanceHistoryItemsForRows(rows: HistorySnapshotRow[]): BalanceHistoryItem[] {
  return [...rows]
    .sort((left, right) => {
      const timeDiff = detectedTime({
        ...right,
        owner_type: 'bank_account',
        owner_id: null,
      }) - detectedTime({
        ...left,
        owner_type: 'bank_account',
        owner_id: null,
      });
      if (timeDiff !== 0) return timeDiff;
      return String(right.id).localeCompare(String(left.id));
    })
    .map(row => ({
      id: row.id,
      balanceKind: row.balance_kind,
      balanceKindLabel: getBalanceKindLabel(row.balance_kind),
      amount: toNumber(row.amount),
      source: row.source,
      confidence: row.confidence,
      detectedAt: row.detected_at,
      freshnessLabel: getBalanceFreshnessLabel(row.detected_at),
      sourceLabel: getBalanceSourceLabel(row.source),
      confidenceLabel: getBalanceConfidenceLabel(row.confidence),
      noteSafe: safeSnapshotNote(row.note),
    }));
}

export function buildBalanceHistoryViewForRows(
  ownerType: BalanceOwnerType,
  ownerId: string,
  rows: HistorySnapshotRow[],
  options: BalanceHistoryOptions = {}
): BalanceHistoryView {
  const limit = Math.max(1, Math.min(options.limit ?? 20, 50));
  const filtered = options.balanceKind
    ? rows.filter(row => row.balance_kind === options.balanceKind)
    : rows;
  const items = buildBalanceHistoryItemsForRows(filtered).slice(0, limit);

  return {
    ownerType,
    ownerId,
    items,
    hasHistory: items.length > 0,
  };
}

function fallbackBalanceValue(balanceKind: BalanceKind, amount: number): LatestBalanceValue {
  return {
    balanceKind,
    amount,
    source: 'calculated',
    confidence: 'estimated',
    detectedAt: null,
    sourceLabel: getBalanceSourceLabel('calculated'),
    confidenceLabel: getBalanceConfidenceLabel('estimated'),
    isEstimated: true,
    staleWarning: false,
  };
}

function balanceValueRank(value: LatestBalanceValue): number {
  return sourceRank(value.source, value.confidence);
}

function balanceValueTime(value: LatestBalanceValue): number {
  const parsed = value.detectedAt ? new Date(value.detectedAt).getTime() : 0;
  return Number.isFinite(parsed) ? parsed : 0;
}

function compareBalanceValues(
  left: LatestBalanceValue,
  right: LatestBalanceValue,
  preferredKinds: BalanceKind[]
): number {
  const authorityDiff = compareBalanceAuthority(left, right, balanceValueTime(left), balanceValueTime(right));
  if (authorityDiff !== 0) return authorityDiff;

  const leftKindRank = preferredKinds.indexOf(left.balanceKind);
  const rightKindRank = preferredKinds.indexOf(right.balanceKind);
  if (leftKindRank !== rightKindRank) {
    if (leftKindRank === -1) return 1;
    if (rightKindRank === -1) return -1;
    return leftKindRank - rightKindRank;
  }

  const rankDiff = balanceValueRank(right) - balanceValueRank(left);
  if (rankDiff !== 0) return rankDiff;

  return balanceValueTime(right) - balanceValueTime(left);
}

export function pickBestBalanceValue(
  values: Array<LatestBalanceValue | null | undefined>,
  preferredKinds: BalanceKind[] = []
): LatestBalanceValue | null {
  const candidates = values.filter((value): value is LatestBalanceValue => Boolean(value));
  if (!candidates.length) return null;

  return [...candidates].sort((left, right) => compareBalanceValues(left, right, preferredKinds))[0];
}

function groupSnapshotsByOwnerAndKind(snapshots: SnapshotRow[]): Map<string, Map<BalanceKind, SnapshotRow[]>> {
  const grouped = new Map<string, Map<BalanceKind, SnapshotRow[]>>();

  for (const snapshot of snapshots) {
    if (!snapshot.owner_id) continue;
    if (!grouped.has(snapshot.owner_id)) grouped.set(snapshot.owner_id, new Map());
    const ownerGroup = grouped.get(snapshot.owner_id)!;
    const kindGroup = ownerGroup.get(snapshot.balance_kind) || [];
    kindGroup.push(snapshot);
    ownerGroup.set(snapshot.balance_kind, kindGroup);
  }

  return grouped;
}

function latestByKindForOwner(
  grouped: Map<string, Map<BalanceKind, SnapshotRow[]>>,
  ownerId: string
): LatestBalanceByKind {
  const ownerGroup = grouped.get(ownerId);
  if (!ownerGroup) return {};

  const latest: LatestBalanceByKind = {};
  for (const [kind, rows] of ownerGroup.entries()) {
    const best = selectBestBalanceSnapshot(rows);
    if (best) latest[kind] = toLatestBalanceValue(best);
  }
  return latest;
}

function preferredBankBalanceKinds(accountType: BankAccount['account_type']): BalanceKind[] {
  if (accountType === 'loan') return ['loan_outstanding', 'current_balance'];
  if (accountType === 'credit_card') {
    return ['outstanding', 'available_limit', 'credit_limit', 'due_amount', 'minimum_due'];
  }
  return ['available_balance', 'current_balance'];
}

export function buildAccountBalanceViewModelsForRows(
  accounts: BankAccount[],
  snapshots: SnapshotRow[]
): BankAccountBalanceView[] {
  const grouped = groupSnapshotsByOwnerAndKind(snapshots);

  return accounts.map(account => {
    const latest = latestByKindForOwner(grouped, account.id);
    const fallbackKind: BalanceKind = account.account_type === 'loan'
      ? 'loan_outstanding'
      : account.account_type === 'credit_card'
        ? 'outstanding'
        : 'current_balance';
    const fallbackAmount = toNumber(account.balance ?? account.starting_balance);
    const preferredKinds = preferredBankBalanceKinds(account.account_type);
    const balance = pickBestBalanceValue([
      ...preferredKinds.map(kind => latest[kind]),
      fallbackBalanceValue(fallbackKind, fallbackAmount),
    ], preferredKinds)!;

      const result = {
        accountId: account.id,
        bankName: account.bank_name,
        accountLast4: account.account_last4,
        accountType: account.account_type,
        displayBalance: balance.amount,
        balanceKind: balance.balanceKind,
        source: balance.source,
        confidence: balance.confidence,
        lastUpdated: balance.detectedAt,
        isEstimated: balance.isEstimated,
        sourceLabel: balance.sourceLabel,
        confidenceLabel: balance.confidenceLabel,
        staleWarning: balance.staleWarning,
      };
      
      return result;
    });
  }

function latestStatementForCard(
  statements: StatementRow[],
  creditCardId: string
): StatementRow | null {
  const rows = statements.filter(statement => statement.credit_card_id === creditCardId);
  if (!rows.length) return null;

  return [...rows].sort((left, right) => {
    const leftTime = new Date(left.payment_due_date || left.statement_date || left.created_at).getTime();
    const rightTime = new Date(right.payment_due_date || right.statement_date || right.created_at).getTime();
    return (Number.isFinite(rightTime) ? rightTime : 0) - (Number.isFinite(leftTime) ? leftTime : 0);
  })[0];
}

export function buildCreditCardBalanceViewModelsForRows(
  cards: CreditCard[],
  snapshots: SnapshotRow[],
  statements: StatementRow[] = []
): CreditCardBalanceView[] {
  const grouped = groupSnapshotsByOwnerAndKind(snapshots);

  return cards.map(card => {
    const latest = latestByKindForOwner(grouped, card.id);
    const outstanding = pickBestBalanceValue([
      latest.outstanding,
      fallbackBalanceValue('outstanding', toNumber(card.current_outstanding)),
    ])!;
    const creditLimit = pickBestBalanceValue([
      latest.credit_limit,
      fallbackBalanceValue('credit_limit', toNumber(card.credit_limit)),
    ])!;
    const fallbackAvailableLimit = Math.max(creditLimit.amount - outstanding.amount, 0);
    const availableLimit = pickBestBalanceValue([
      latest.available_limit,
      fallbackBalanceValue('available_limit', fallbackAvailableLimit),
    ])!;
    const dueAmount = pickBestBalanceValue([latest.due_amount]) || null;
    const minimumDue = pickBestBalanceValue([latest.minimum_due]) || null;
    const statement = latestStatementForCard(statements, card.id);
    const displaySource = outstanding;
    const limitAmount = Math.max(creditLimit.amount, 0);

      const result = {
        creditCardId: card.id,
        bankName: card.bank_name,
        cardName: card.card_name || null,
        cardLast4: card.last_4_digits,
        outstanding: outstanding.amount,
        availableLimit: availableLimit.amount,
        creditLimit: creditLimit.amount,
        dueAmount: dueAmount?.amount ?? statement?.total_due ?? null,
        minimumDue: minimumDue?.amount ?? statement?.minimum_due ?? null,
        paymentDueDate: statement?.payment_due_date || null,
        source: displaySource.source,
        confidence: displaySource.confidence,
        lastUpdated: displaySource.detectedAt,
        utilizationPercent: limitAmount > 0 ? Math.min((outstanding.amount / limitAmount) * 100, 999) : 0,
        sourceLabel: displaySource.sourceLabel,
        confidenceLabel: displaySource.confidenceLabel,
        staleWarning: displaySource.staleWarning,
      };

      return result;
    });
  }

export function buildBankAccountDetailViewForRows(
  account: BankAccount,
  snapshots: SnapshotRow[],
  historyRows: HistorySnapshotRow[],
  options: BalanceHistoryOptions = {}
): BankAccountDetailView {
  const balanceView = buildAccountBalanceViewModelsForRows([account], snapshots)[0];
  const history = buildBalanceHistoryViewForRows(
    account.account_type === 'loan' ? 'loan' : account.account_type === 'credit_card' ? 'credit_card' : 'bank_account',
    account.id,
    historyRows,
    options
  );

  return {
    ...balanceView,
    history: history.items,
    hasHistory: history.hasHistory,
  };
}

export function buildCreditCardDetailViewForRows(
  card: CreditCard,
  snapshots: SnapshotRow[],
  statements: StatementRow[] = [],
  historyRows: HistorySnapshotRow[] = [],
  options: BalanceHistoryOptions = {}
): CreditCardDetailView {
  const balanceView = buildCreditCardBalanceViewModelsForRows([card], snapshots, statements)[0];
  const history = buildBalanceHistoryViewForRows('credit_card', card.id, historyRows, options);
  const historyByKind = history.items.reduce<Partial<Record<BalanceKind, BalanceHistoryItem[]>>>((groups, item) => {
    groups[item.balanceKind] = [...(groups[item.balanceKind] || []), item];
    return groups;
  }, {});

  return {
    ...balanceView,
    history: history.items,
    historyByKind,
  };
}

export function summarizePendingDetectedAccounts(
  rows: Pick<DetectedAccount, 'detection_type'>[]
): PendingDetectedBalanceSummary {
  return rows.reduce<PendingDetectedBalanceSummary>(
    (summary, row) => {
      summary.total += 1;
      summary[row.detection_type] += 1;
      return summary;
    },
    { total: 0, bank_account: 0, credit_card: 0, debit_card: 0, loan: 0 }
  );
}

async function getCurrentUserId(): Promise<string> {
  try {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user?.id) throw new Error('Not authenticated');
  return user.id;

  } catch (err) {
    if (__DEV__) console.error('[API] balanceViewModel.ts:getCurrentUserId failed:', err);
    throw err;
  }}

async function fetchSnapshotsForOwners(
  userId: string,
  ownerType: BalanceOwnerType,
  ownerIds: string[]
): Promise<SnapshotRow[]> {
  try {
  if (!ownerIds.length) return [];

  const { data, error } = await supabase
    .from('balance_snapshots')
    .select('id, owner_type, owner_id, balance_kind, amount, source, confidence, detected_at, created_at')
    .eq('user_id', userId)
    .eq('owner_type', ownerType)
    .in('owner_id', ownerIds)
    .order('detected_at', { ascending: false })
    .limit(Math.max(100, ownerIds.length * 8));

  if (error) throw error;
  return (data || []) as SnapshotRow[];

  } catch (err) {
    if (__DEV__) console.error('[API] balanceViewModel.ts:fetchSnapshotsForOwners failed:', err);
    throw err;
  }}

async function fetchStatementsForCards(userId: string, cardIds: string[]): Promise<StatementRow[]> {
  try {
  if (!cardIds.length) return [];

  const { data, error } = await supabase
    .from('credit_card_statements')
    .select(
      'id, user_id, credit_card_id, statement_date, period_start, period_end, total_due, minimum_due, payment_due_date, statement_balance, source_snapshot_id, status, source, confidence, created_at, updated_at'
    )
    .eq('user_id', userId)
    .in('credit_card_id', cardIds)
    .order('payment_due_date', { ascending: false });

  if (error) throw error;
  return (data || []) as StatementRow[];

  } catch (err) {
    if (__DEV__) console.error('[API] balanceViewModel.ts:fetchStatementsForCards failed:', err);
    throw err;
  }}

async function fetchHistoryForOwner(
  userId: string,
  ownerType: BalanceOwnerType,
  ownerId: string,
  options: BalanceHistoryOptions = {}
): Promise<HistorySnapshotRow[]> {
  const limit = Math.max(1, Math.min(options.limit ?? 20, 50));
  let query = supabase
    .from('balance_snapshots')
    .select('id, balance_kind, amount, source, confidence, detected_at, created_at, note')
    .eq('user_id', userId)
    .eq('owner_type', ownerType)
    .eq('owner_id', ownerId)
    .order('detected_at', { ascending: false })
    .limit(limit);

  if (options.balanceKind) {
    query = query.eq('balance_kind', options.balanceKind);
  }

  const { data, error } = await query;
  if (error) throw error;
  return (data || []) as HistorySnapshotRow[];
}

export async function getLatestBalanceForOwner(
  ownerType: BalanceOwnerType,
  ownerId: string
): Promise<LatestBalanceByKind> {
  const userId = await getCurrentUserId();
  const snapshots = await fetchSnapshotsForOwners(userId, ownerType, [ownerId]);
  const grouped = groupSnapshotsByOwnerAndKind(snapshots);
  return latestByKindForOwner(grouped, ownerId);
}

export async function getBalanceHistoryView(
  ownerType: BalanceOwnerType,
  ownerId: string,
  options: BalanceHistoryOptions = {}
): Promise<BalanceHistoryView> {
  const userId = await getCurrentUserId();
  const rows = await fetchHistoryForOwner(userId, ownerType, ownerId, options);
  return buildBalanceHistoryViewForRows(ownerType, ownerId, rows, options);
}

export async function getBankAccountDetailView(accountId: string): Promise<BankAccountDetailView> {
  try {
  const userId = await getCurrentUserId();
  const { data, error } = await supabase
    .from('bank_accounts')
    .select('*')
    .eq('user_id', userId)
    .eq('id', accountId)
    .single();

  if (error) throw error;
  const account = data as BankAccount;
  const ownerType: BalanceOwnerType = account.account_type === 'loan'
    ? 'loan'
    : account.account_type === 'credit_card'
      ? 'credit_card'
      : 'bank_account';
  const [snapshots, historyRows] = await Promise.all([
    fetchSnapshotsForOwners(userId, ownerType, [account.id]),
    fetchHistoryForOwner(userId, ownerType, account.id),
  ]);

  return buildBankAccountDetailViewForRows(account, snapshots, historyRows);

  } catch (err) {
    if (__DEV__) console.error('[API] balanceViewModel.ts:getBankAccountDetailView failed:', err);
    throw err;
  }}

export async function getCreditCardDetailView(creditCardId: string): Promise<CreditCardDetailView> {
  try {
  const userId = await getCurrentUserId();
  const { data, error } = await supabase
    .from('credit_cards')
    .select('*')
    .eq('user_id', userId)
    .eq('id', creditCardId)
    .single();

  if (error) throw error;
  const card = data as CreditCard;
  const [snapshots, statements, historyRows] = await Promise.all([
    fetchSnapshotsForOwners(userId, 'credit_card', [creditCardId]),
    fetchStatementsForCards(userId, [creditCardId]),
    fetchHistoryForOwner(userId, 'credit_card', creditCardId),
  ]);

  return buildCreditCardDetailViewForRows(card, snapshots, statements, historyRows);

  } catch (err) {
    if (__DEV__) console.error('[API] balanceViewModel.ts:getCreditCardDetailView failed:', err);
    throw err;
  }}

export async function getAccountBalanceViewModels(): Promise<BankAccountBalanceView[]> {
  try {
  const userId = await getCurrentUserId();
  const { data: accounts, error } = await supabase
    .from('bank_accounts')
    .select('*')
    .eq('user_id', userId)
    .eq('is_archived', false)
    .order('created_at', { ascending: true });

  if (error && isMissingArchiveColumnError(error)) {
    warnArchiveFallbackOnce('bank_accounts', error);
    const { data: fallbackAccounts, error: fallbackError } = await supabase
      .from('bank_accounts')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: true });
    if (fallbackError) throw fallbackError;
    return buildAccountBalanceViewModels(userId, (fallbackAccounts || []) as BankAccount[]);
  }

  if (error) throw error;
  return buildAccountBalanceViewModels(userId, (accounts || []) as BankAccount[]);

  } catch (err) {
    if (__DEV__) console.error('[API] balanceViewModel.ts:getAccountBalanceViewModels failed:', err);
    throw err;
  }}

async function buildAccountBalanceViewModels(
  userId: string,
  accountRows: BankAccount[]
): Promise<BankAccountBalanceView[]> {
  const loanAccountIds = accountRows.filter(account => account.account_type === 'loan').map(account => account.id);
  const creditCardAccountIds = accountRows.filter(account => account.account_type === 'credit_card').map(account => account.id);
  const bankAccountIds = accountRows
    .filter(account => account.account_type !== 'loan' && account.account_type !== 'credit_card')
    .map(account => account.id);
  const [bankSnapshots, creditCardSnapshots, loanSnapshots] = await Promise.all([
    fetchSnapshotsForOwners(userId, 'bank_account', bankAccountIds),
    fetchSnapshotsForOwners(userId, 'credit_card', creditCardAccountIds),
    fetchSnapshotsForOwners(userId, 'loan', loanAccountIds),
  ]);
  const snapshots = [...bankSnapshots, ...creditCardSnapshots, ...loanSnapshots];
  return buildAccountBalanceViewModelsForRows(accountRows, snapshots);
}

export async function getCreditCardBalanceViewModels(): Promise<CreditCardBalanceView[]> {
  try {
  const userId = await getCurrentUserId();
  const { data: cards, error } = await supabase
    .from('credit_cards')
    .select('*')
    .eq('user_id', userId)
    .eq('is_archived', false)
    .order('created_at', { ascending: false });

  if (error && isMissingArchiveColumnError(error)) {
    warnArchiveFallbackOnce('credit_cards', error);
    const { data: fallbackCards, error: fallbackError } = await supabase
      .from('credit_cards')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });
    if (fallbackError) throw fallbackError;
    return buildCreditCardBalanceViewModels(userId, (fallbackCards || []) as CreditCard[]);
  }

  if (error) throw error;
  return buildCreditCardBalanceViewModels(userId, (cards || []) as CreditCard[]);

  } catch (err) {
    if (__DEV__) console.error('[API] balanceViewModel.ts:getCreditCardBalanceViewModels failed:', err);
    throw err;
  }}

async function buildCreditCardBalanceViewModels(
  userId: string,
  cardRows: CreditCard[]
): Promise<CreditCardBalanceView[]> {
  const snapshots = await fetchSnapshotsForOwners(userId, 'credit_card', cardRows.map(card => card.id));
  const statements = await fetchStatementsForCards(userId, cardRows.map(card => card.id));

  return buildCreditCardBalanceViewModelsForRows(cardRows, snapshots, statements);
}

export async function getPendingDetectedBalanceSummary(): Promise<PendingDetectedBalanceSummary> {
  try {
  const userId = await getCurrentUserId();
  const { data, error } = await supabase
    .from('detected_accounts')
    .select('detection_type')
    .eq('user_id', userId)
    .eq('status', 'pending');

  if (error) throw error;
  return summarizePendingDetectedAccounts((data || []) as Pick<DetectedAccount, 'detection_type'>[]);

  } catch (err) {
    if (__DEV__) console.error('[API] balanceViewModel.ts:getPendingDetectedBalanceSummary failed:', err);
    throw err;
  }}
function isMissingArchiveColumnError(error: any): boolean {
  const message = String(error?.message || '').toLowerCase();
  return error?.code === '42703'
    || message.includes('is_archived')
    || message.includes('archived_at');
}

const archiveFallbackWarnings = new Set<string>();

function warnArchiveFallbackOnce(table: 'bank_accounts' | 'credit_cards', error: any): void {
  if (archiveFallbackWarnings.has(table)) return;
  archiveFallbackWarnings.add(table);
  console.warn('[Balances] Archive fields unavailable; loading without archive filter', {
    table,
    code: error?.code || 'unknown',
  });
}
