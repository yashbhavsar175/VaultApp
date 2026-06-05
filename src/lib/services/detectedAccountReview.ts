import { supabase } from '../core';
import { getBankAccounts, getCreditCards, CreditCard } from '../database/financial';
import {
  BalanceKind,
  BalanceOwnerType,
  BalanceSnapshot,
  BankAccount,
  DebitCard,
  DetectedAccount,
} from '../../types';
import { normalizeLast4 } from './balanceSnapshots';
import { getDebitCards } from './debitCards';
import { getPendingDetectedAccounts } from './detectedAccounts';
import { CACHE_KEYS, removeCache } from './cache';
import { emitFinanceDataChanged } from './dataEvents';

type ConfirmableOwnerType = Extract<BalanceOwnerType, 'bank_account' | 'credit_card' | 'debit_card'>;

export interface DetectedAccountReviewItem {
  id: string;
  detectionType: DetectedAccount['detection_type'];
  detectionTypeLabel: string;
  bankName: string;
  accountLast4: string | null;
  cardLast4: string | null;
  accountTypeHint: string | null;
  balanceAmount: number | null;
  balanceKind: BalanceKind | null;
  balanceLabel: string | null;
  sourceLabel: string;
  confidenceLabel: string;
  lastSeenLabel: string;
  duplicateOwner: ExistingOwnerOption | null;
  canConfirmNew: boolean;
  loanUnsupported: boolean;
}

export interface ExistingOwnerOption {
  ownerType: ConfirmableOwnerType;
  ownerId: string;
  label: string;
  subtitle: string;
  bankName: string | null;
  last4: string | null;
}

export interface DetectedAccountReviewData {
  detections: DetectedAccount[];
  items: DetectedAccountReviewItem[];
  accounts: BankAccount[];
  creditCards: CreditCard[];
  debitCards: DebitCard[];
}

export interface ConfirmDetectedBankAccountInput {
  detectedAccountId: string;
  bankName: string;
  accountLast4: string;
  accountType: Extract<BankAccount['account_type'], 'savings' | 'current'>;
  startingBalance?: number | null;
}

export interface ConfirmDetectedCreditCardInput {
  detectedAccountId: string;
  bankName: string;
  cardName: string;
  cardLast4: string;
  creditLimit?: number | null;
  currentOutstanding?: number | null;
  dueDate?: number | null;
  billingCycleDate?: number | null;
}

export interface ConfirmDetectedDebitCardInput {
  detectedAccountId: string;
  bankAccountId: string;
  cardLast4: string;
  cardLabel?: string | null;
}

export interface MergeDetectedAccountInput {
  detectedAccountId: string;
  ownerType: ConfirmableOwnerType;
  ownerId: string;
}

export class DetectedAccountDuplicateError extends Error {
  existingOwner: ExistingOwnerOption;

  constructor(message: string, existingOwner: ExistingOwnerOption) {
    super(message);
    this.name = 'DetectedAccountDuplicateError';
    this.existingOwner = existingOwner;
    Object.setPrototypeOf(this, DetectedAccountDuplicateError.prototype);
  }
}

const BANK_SNAPSHOT_KINDS: BalanceKind[] = ['available_balance', 'current_balance'];
const CREDIT_CARD_SNAPSHOT_KINDS: BalanceKind[] = [
  'outstanding',
  'available_limit',
  'credit_limit',
  'due_amount',
  'minimum_due',
];

function assertNever(value: never): never {
  throw new Error(`Unsupported value: ${String(value)}`);
}

async function getCurrentUserId(): Promise<string> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user?.id) throw new Error('Not authenticated');
  return user.id;
}

function normalizeComparable(value?: string | null): string {
  return (value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function isSensitiveText(value: string): boolean {
  return (
    /\b(?:otp|one\s*time\s*password|verification\s*code|security\s*code)\b/i.test(value) ||
    /\b(?:\+?91[-\s]?)?[6-9]\d{9}\b/.test(value) ||
    /\b\d(?:[ -]?\d){5,}\b/.test(value) ||
    /\b(?:address|flat|tower|road|street|society|sector|near|landmark|pincode|pin code)\b/i.test(value)
  );
}

export function sanitizeDetectedDisplayText(value?: string | null, fallback = 'Unknown'): string {
  const trimmed = value?.trim();
  if (!trimmed || isSensitiveText(trimmed)) return fallback;

  const cleaned = trimmed
    .replace(/[^\w\s.&/-]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 64)
    .trim();

  return cleaned || fallback;
}

function safeLast4(value?: string | null): string | null {
  const last4 = normalizeLast4(value);
  return last4 && last4.length === 4 ? last4 : null;
}

function requireLast4(value: string, label: string): string {
  const trimmed = value.trim();
  if (!/^[0-9]{4}$/.test(trimmed)) {
    throw new Error(`${label} last4 must be exactly four digits`);
  }
  return trimmed;
}

function requireBankName(value: string): string {
  const bankName = sanitizeDetectedDisplayText(value, '');
  if (!bankName) throw new Error('Bank name is required');
  return bankName;
}

function requireDay(value: number | null | undefined, fallback: number): number {
  const day = Number(value ?? fallback);
  if (!Number.isInteger(day) || day < 1 || day > 31) {
    throw new Error('Credit card dates must be between 1 and 31');
  }
  return day;
}

function detectionTypeLabel(type: DetectedAccount['detection_type']): string {
  switch (type) {
    case 'bank_account':
      return 'Bank Account';
    case 'credit_card':
      return 'Credit Card';
    case 'debit_card':
      return 'Debit Card';
    case 'loan':
      return 'Loan';
    default:
      return assertNever(type);
  }
}

function sourceLabel(source: DetectedAccount['source']): string {
  switch (source) {
    case 'sms':
      return 'SMS';
    case 'notification':
      return 'Notification';
    case 'manual':
      return 'Manual';
    case 'import':
      return 'Import';
    default:
      return 'Detected';
  }
}

function confidenceLabel(confidence: DetectedAccount['confidence']): string {
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

function balanceKindLabel(kind: BalanceKind): string {
  switch (kind) {
    case 'available_balance':
      return 'Available balance';
    case 'current_balance':
      return 'Current balance';
    case 'outstanding':
      return 'Outstanding';
    case 'available_limit':
      return 'Available limit';
    case 'credit_limit':
      return 'Credit limit';
    case 'due_amount':
      return 'Due amount';
    case 'minimum_due':
      return 'Minimum due';
    case 'loan_outstanding':
      return 'Loan outstanding';
    default:
      return assertNever(kind);
  }
}

function formatAmount(amount: number): string {
  return `INR ${amount.toLocaleString('en-IN', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  })}`;
}

function formatLastSeen(lastSeenAt?: string | null, now = Date.now()): string {
  if (!lastSeenAt) return 'Seen recently';
  const time = new Date(lastSeenAt).getTime();
  if (!Number.isFinite(time)) return 'Seen recently';

  const diffMs = Math.max(now - time, 0);
  if (diffMs < 60 * 1000) return 'Just now';
  const minutes = Math.floor(diffMs / (60 * 1000));
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hr ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return '1 day ago';
  return `${days} days ago`;
}

function bankOption(account: BankAccount): ExistingOwnerOption {
  return {
    ownerType: 'bank_account',
    ownerId: account.id,
    label: `${sanitizeDetectedDisplayText(account.bank_name)} - ${account.account_last4}`,
    subtitle: account.account_type === 'credit_card'
      ? 'Legacy credit card setup'
      : account.account_type === 'current'
        ? 'Current account'
        : account.account_type === 'loan'
          ? 'Loan account'
          : 'Bank account',
    bankName: sanitizeDetectedDisplayText(account.bank_name),
    last4: safeLast4(account.account_last4),
  };
}

function creditCardOption(card: CreditCard): ExistingOwnerOption {
  return {
    ownerType: 'credit_card',
    ownerId: card.id,
    label: `${sanitizeDetectedDisplayText(card.card_name || card.bank_name)} - ${card.last_4_digits}`,
    subtitle: sanitizeDetectedDisplayText(card.bank_name, 'Credit card'),
    bankName: sanitizeDetectedDisplayText(card.bank_name),
    last4: safeLast4(card.last_4_digits),
  };
}

function debitCardOption(card: DebitCard): ExistingOwnerOption {
  return {
    ownerType: 'debit_card',
    ownerId: card.id,
    label: `${sanitizeDetectedDisplayText(card.card_label || card.bank_name || 'Debit card')} - ${card.card_last4}`,
    subtitle: card.bank_account_id ? 'Linked debit card' : 'Debit card',
    bankName: sanitizeDetectedDisplayText(card.bank_name, 'Debit card'),
    last4: safeLast4(card.card_last4),
  };
}

function sameBank(left?: string | null, right?: string | null): boolean {
  const normalizedLeft = normalizeComparable(left);
  const normalizedRight = normalizeComparable(right);
  return Boolean(normalizedLeft && normalizedRight && normalizedLeft === normalizedRight);
}

function findDuplicateOwner(
  detection: DetectedAccount,
  accounts: BankAccount[],
  creditCards: CreditCard[],
  debitCards: DebitCard[]
): ExistingOwnerOption | null {
  if (detection.detection_type === 'bank_account') {
    const last4 = safeLast4(detection.account_last4);
    const duplicate = accounts.find(account =>
      account.account_type !== 'credit_card' &&
      account.account_type !== 'loan' &&
      safeLast4(account.account_last4) === last4 &&
      sameBank(account.bank_name, detection.detected_bank_name)
    );
    return duplicate ? bankOption(duplicate) : null;
  }

  if (detection.detection_type === 'credit_card') {
    const last4 = safeLast4(detection.card_last4 || detection.account_last4);
    const duplicate = creditCards.find(card => safeLast4(card.last_4_digits) === last4);
    if (duplicate) return creditCardOption(duplicate);

    const legacyDuplicate = accounts.find(account =>
      account.account_type === 'credit_card' &&
      safeLast4(account.account_last4) === last4
    );
    return legacyDuplicate ? bankOption(legacyDuplicate) : null;
  }

  if (detection.detection_type === 'debit_card') {
    const last4 = safeLast4(detection.card_last4);
    const duplicate = debitCards.find(card => safeLast4(card.card_last4) === last4);
    return duplicate ? debitCardOption(duplicate) : null;
  }

  return null;
}

export function buildDetectedAccountReviewItems(
  detections: DetectedAccount[],
  accounts: BankAccount[] = [],
  creditCards: CreditCard[] = [],
  debitCards: DebitCard[] = []
): DetectedAccountReviewItem[] {
  return detections.map(detection => {
    const duplicateOwner = findDuplicateOwner(detection, accounts, creditCards, debitCards);
    const balanceAmount = detection.balance_amount === null || detection.balance_amount === undefined
      ? null
      : Number(detection.balance_amount);
    const validBalanceAmount = Number.isFinite(balanceAmount) ? balanceAmount : null;
    const bankName = sanitizeDetectedDisplayText(detection.detected_bank_name, 'Unknown bank');
    const accountLast4 = safeLast4(detection.account_last4);
    const cardLast4 = safeLast4(detection.card_last4);
    const balanceLabel = validBalanceAmount !== null && detection.balance_kind
      ? `${balanceKindLabel(detection.balance_kind)}: ${formatAmount(validBalanceAmount)}`
      : null;

    return {
      id: detection.id,
      detectionType: detection.detection_type,
      detectionTypeLabel: detectionTypeLabel(detection.detection_type),
      bankName,
      accountLast4,
      cardLast4,
      accountTypeHint: detection.account_type_hint
        ? sanitizeDetectedDisplayText(detection.account_type_hint, 'Account')
        : null,
      balanceAmount: validBalanceAmount,
      balanceKind: detection.balance_kind,
      balanceLabel,
      sourceLabel: sourceLabel(detection.source),
      confidenceLabel: confidenceLabel(detection.confidence),
      lastSeenLabel: formatLastSeen(detection.last_seen_at),
      duplicateOwner,
      canConfirmNew: detection.detection_type !== 'loan' && !duplicateOwner,
      loanUnsupported: detection.detection_type === 'loan',
    };
  });
}

export function buildMergeOwnerOptions(
  detection: DetectedAccount,
  accounts: BankAccount[],
  creditCards: CreditCard[],
  debitCards: DebitCard[]
): ExistingOwnerOption[] {
  if (detection.detection_type === 'bank_account') {
    const detectionLast4 = safeLast4(detection.account_last4);
    return accounts
      .filter(account => account.account_type !== 'credit_card' && account.account_type !== 'loan')
      .map(bankOption)
      .sort((left, right) => Number(right.last4 === detectionLast4) - Number(left.last4 === detectionLast4));
  }

  if (detection.detection_type === 'credit_card') {
    const detectionLast4 = safeLast4(detection.card_last4 || detection.account_last4);
    return creditCards
      .map(creditCardOption)
      .sort((left, right) => Number(right.last4 === detectionLast4) - Number(left.last4 === detectionLast4));
  }

  if (detection.detection_type === 'debit_card') {
    const detectionLast4 = safeLast4(detection.card_last4);
    return debitCards
      .map(debitCardOption)
      .sort((left, right) => Number(right.last4 === detectionLast4) - Number(left.last4 === detectionLast4));
  }

  return [];
}

export async function getDetectedAccountReviewData(): Promise<DetectedAccountReviewData> {
  const [detections, accounts, creditCards, debitCards] = await Promise.all([
    getPendingDetectedAccounts(),
    getBankAccounts(),
    getCreditCards(),
    getDebitCards(),
  ]);

  return {
    detections,
    items: buildDetectedAccountReviewItems(detections, accounts, creditCards, debitCards),
    accounts,
    creditCards,
    debitCards,
  };
}

function compatibleBalanceKinds(ownerType: BalanceOwnerType): BalanceKind[] {
  if (ownerType === 'bank_account') return BANK_SNAPSHOT_KINDS;
  if (ownerType === 'credit_card') return CREDIT_CARD_SNAPSHOT_KINDS;
  if (ownerType === 'debit_card') return [...BANK_SNAPSHOT_KINDS, ...CREDIT_CARD_SNAPSHOT_KINDS];
  return [];
}

type DetectedAccountRpcName =
  | 'confirm_detected_bank_account'
  | 'confirm_detected_credit_card'
  | 'confirm_detected_debit_card'
  | 'merge_detected_account'
  | 'ignore_detected_account_rpc';

interface DetectedAccountRpcRow {
  owner_id: string | null;
  status: DetectedAccount['status'];
}

async function callDetectedAccountRpc(
  rpcName: DetectedAccountRpcName,
  params: Record<string, unknown>
): Promise<DetectedAccountRpcRow> {
  const { data, error } = await supabase.rpc(rpcName, params);

  if (error) {
    throw new Error(error.message || 'Could not update this detection');
  }

  const row = Array.isArray(data) ? data[0] : data;
  if (!row || typeof row !== 'object') {
    throw new Error('Detection review did not return a result');
  }

  const ownerId = 'owner_id' in row && typeof row.owner_id === 'string' ? row.owner_id : null;
  const status = 'status' in row && typeof row.status === 'string' ? row.status : null;
  if (!status || !['confirmed', 'merged', 'ignored'].includes(status)) {
    throw new Error('Detection review returned an invalid status');
  }

  return { owner_id: ownerId, status: status as DetectedAccount['status'] };
}

async function getDetectionById(userId: string, id: string): Promise<DetectedAccount> {
  const { data, error } = await supabase
    .from('detected_accounts')
    .select('*')
    .eq('id', id)
    .eq('user_id', userId)
    .maybeSingle();

  if (error) throw error;
  if (!data?.id) throw new Error('Detection was not found');
  return data as DetectedAccount;
}

async function getBankAccountById(userId: string, id: string): Promise<BankAccount> {
  const { data, error } = await supabase
    .from('bank_accounts')
    .select('*')
    .eq('id', id)
    .eq('user_id', userId)
    .maybeSingle();

  if (error) throw error;
  if (!data?.id) throw new Error('Bank account was not found');
  return data as BankAccount;
}

async function getCreditCardById(userId: string, id: string): Promise<CreditCard> {
  const { data, error } = await supabase
    .from('credit_cards')
    .select('*')
    .eq('id', id)
    .eq('user_id', userId)
    .maybeSingle();

  if (error) throw error;
  if (!data?.id) throw new Error('Credit card was not found');
  return data as CreditCard;
}

async function getDebitCardById(userId: string, id: string): Promise<DebitCard> {
  const { data, error } = await supabase
    .from('debit_cards')
    .select('*')
    .eq('id', id)
    .eq('user_id', userId)
    .maybeSingle();

  if (error) throw error;
  if (!data?.id) throw new Error('Debit card was not found');
  return data as DebitCard;
}

function ownerIdFromRpc(row: DetectedAccountRpcRow, detection: DetectedAccount): string {
  const ownerId = row.owner_id || detection.matched_owner_id;
  if (!ownerId) throw new Error('Detection review completed without an owner');
  return ownerId;
}

async function getSnapshotFromDetection(
  userId: string,
  detection: DetectedAccount,
  ownerType: BalanceOwnerType,
  ownerId: string
): Promise<BalanceSnapshot | null> {
  if (detection.balance_amount === null || detection.balance_amount === undefined || !detection.balance_kind) {
    return null;
  }

  const amount = Number(detection.balance_amount);
  if (!Number.isFinite(amount) || amount < 0) return null;
  if (!compatibleBalanceKinds(ownerType).includes(detection.balance_kind)) return null;

  const { data, error } = await supabase
    .from('balance_snapshots')
    .select('*')
    .eq('user_id', userId)
    .eq('owner_type', ownerType)
    .eq('owner_id', ownerId)
    .eq('balance_kind', detection.balance_kind)
    .eq('amount', amount)
    .eq('source', detection.source)
    .eq('detected_at', detection.last_seen_at)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return (data as BalanceSnapshot | null) || null;
}

function accountTypeFromInput(type: ConfirmDetectedBankAccountInput['accountType']): ConfirmDetectedBankAccountInput['accountType'] {
  return type === 'current' ? 'current' : 'savings';
}

function creditLimitFromInput(explicitLimit?: number | null): number {
  if (explicitLimit !== undefined && explicitLimit !== null) {
    const limit = Number(explicitLimit);
    if (!Number.isFinite(limit) || limit < 0) throw new Error('Credit limit must be non-negative');
    return limit;
  }

  return 0;
}

async function notifyAccountsChanged() {
  await removeCache(CACHE_KEYS.BANK_ACCOUNTS);
  emitFinanceDataChanged({ areas: ['accounts'], source: 'detected_account_review' });
}

export async function confirmDetectedBankAccount(input: ConfirmDetectedBankAccountInput): Promise<{
  account: BankAccount;
  detectedAccount: DetectedAccount;
  snapshot: BalanceSnapshot | null;
}> {
  const userId = await getCurrentUserId();
  const bankName = requireBankName(input.bankName);
  const accountLast4 = requireLast4(input.accountLast4, 'Account');

  const rpcResult = await callDetectedAccountRpc('confirm_detected_bank_account', {
    p_detection_id: input.detectedAccountId,
    p_bank_name: bankName,
    p_account_last4: accountLast4,
    p_account_type: accountTypeFromInput(input.accountType),
  });

  const detectedAccount = await getDetectionById(userId, input.detectedAccountId);
  const ownerId = ownerIdFromRpc(rpcResult, detectedAccount);
  const account = await getBankAccountById(userId, ownerId);
  const snapshot = await getSnapshotFromDetection(userId, detectedAccount, 'bank_account', ownerId);
  
  if (input.startingBalance !== undefined && input.startingBalance !== null) {
    await supabase.from('bank_accounts').update({ starting_balance: input.startingBalance }).eq('id', ownerId);
  }

  await notifyAccountsChanged();

  return { account, detectedAccount, snapshot };
}

export async function confirmDetectedCreditCard(input: ConfirmDetectedCreditCardInput): Promise<{
  creditCard: CreditCard;
  detectedAccount: DetectedAccount;
  snapshot: BalanceSnapshot | null;
}> {
  const userId = await getCurrentUserId();
  const bankName = requireBankName(input.bankName);
  const cardLast4 = requireLast4(input.cardLast4, 'Card');

  const rpcResult = await callDetectedAccountRpc('confirm_detected_credit_card', {
    p_detection_id: input.detectedAccountId,
    p_bank_name: bankName,
    p_card_name: sanitizeDetectedDisplayText(input.cardName, `${bankName} card ${cardLast4}`),
    p_card_last4: cardLast4,
    p_credit_limit: creditLimitFromInput(input.creditLimit),
    p_due_date: requireDay(input.dueDate, 1),
    p_billing_cycle_date: requireDay(input.billingCycleDate, 1),
  });

  const detectedAccount = await getDetectionById(userId, input.detectedAccountId);
  const ownerId = ownerIdFromRpc(rpcResult, detectedAccount);
  
  if (input.currentOutstanding !== undefined && input.currentOutstanding !== null) {
    await supabase.from('credit_cards').update({ current_outstanding: input.currentOutstanding }).eq('id', ownerId);
  }

  const creditCard = await getCreditCardById(userId, ownerId);
  const snapshot = await getSnapshotFromDetection(userId, detectedAccount, 'credit_card', ownerId);
  emitFinanceDataChanged({ areas: ['accounts'], source: 'detected_account_review' });

  return { creditCard, detectedAccount, snapshot };
}

export async function confirmDetectedDebitCard(input: ConfirmDetectedDebitCardInput): Promise<{
  debitCard: DebitCard;
  detectedAccount: DetectedAccount;
  snapshot: BalanceSnapshot | null;
}> {
  const userId = await getCurrentUserId();
  const cardLast4 = requireLast4(input.cardLast4, 'Debit card');
  if (!input.bankAccountId?.trim()) {
    throw new Error('Choose a linked bank account first');
  }

  const rpcResult = await callDetectedAccountRpc('confirm_detected_debit_card', {
    p_detection_id: input.detectedAccountId,
    p_bank_account_id: input.bankAccountId,
    p_card_last4: cardLast4,
    p_card_label: input.cardLabel ? sanitizeDetectedDisplayText(input.cardLabel, '') || null : null,
  });

  const detectedAccount = await getDetectionById(userId, input.detectedAccountId);
  const ownerId = ownerIdFromRpc(rpcResult, detectedAccount);
  const debitCard = await getDebitCardById(userId, ownerId);
  const snapshot = await getSnapshotFromDetection(userId, detectedAccount, 'bank_account', input.bankAccountId);
  emitFinanceDataChanged({ areas: ['accounts'], source: 'detected_account_review' });

  return { debitCard, detectedAccount, snapshot };
}

export async function mergeDetectedAccount(input: MergeDetectedAccountInput): Promise<{
  detectedAccount: DetectedAccount;
  snapshot: BalanceSnapshot | null;
}> {
  const userId = await getCurrentUserId();
  await callDetectedAccountRpc('merge_detected_account', {
    p_detection_id: input.detectedAccountId,
    p_owner_type: input.ownerType,
    p_owner_id: input.ownerId,
  });

  const detectedAccount = await getDetectionById(userId, input.detectedAccountId);
  const snapshot = await getSnapshotFromDetection(userId, detectedAccount, input.ownerType, input.ownerId);
  emitFinanceDataChanged({ areas: ['accounts'], source: 'detected_account_review' });

  return { detectedAccount, snapshot };
}

export async function ignoreDetectedAccount(id: string): Promise<DetectedAccount> {
  const userId = await getCurrentUserId();
  await callDetectedAccountRpc('ignore_detected_account_rpc', {
    p_detection_id: id,
  });

  const detectedAccount = await getDetectionById(userId, id);
  emitFinanceDataChanged({ areas: ['accounts'], source: 'detected_account_review' });
  return detectedAccount;
}
