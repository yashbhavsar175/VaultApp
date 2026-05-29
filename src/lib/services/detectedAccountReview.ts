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
import {
  buildBalanceSnapshotInsert,
  normalizeLast4,
} from './balanceSnapshots';
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
}

export interface ConfirmDetectedCreditCardInput {
  detectedAccountId: string;
  bankName: string;
  cardName: string;
  cardLast4: string;
  creditLimit?: number | null;
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
  const last4 = safeLast4(value);
  if (!last4) throw new Error(`${label} last4 must be exactly four digits`);
  return last4;
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
    subtitle: account.account_type === 'current' ? 'Current account' : account.account_type === 'loan' ? 'Loan account' : 'Bank account',
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
    return duplicate ? creditCardOption(duplicate) : null;
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

async function getPendingDetection(userId: string, id: string): Promise<DetectedAccount> {
  const { data, error } = await supabase
    .from('detected_accounts')
    .select('*')
    .eq('id', id)
    .eq('user_id', userId)
    .eq('status', 'pending')
    .maybeSingle();

  if (error) throw error;
  if (!data?.id) throw new Error('Detection is no longer pending');
  return data as DetectedAccount;
}

function ensureDetectionType(
  detection: DetectedAccount,
  expectedType: DetectedAccount['detection_type']
): void {
  if (detection.detection_type !== expectedType) {
    throw new Error(`Detection is not a ${detectionTypeLabel(expectedType).toLowerCase()}`);
  }
}

async function markDetectedResolved(
  userId: string,
  id: string,
  status: Extract<DetectedAccount['status'], 'confirmed' | 'merged' | 'ignored'>,
  ownerType?: ConfirmableOwnerType,
  ownerId?: string
): Promise<DetectedAccount> {
  const { data, error } = await supabase
    .from('detected_accounts')
    .update({
      status,
      matched_owner_type: ownerType || null,
      matched_owner_id: ownerId || null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
    .eq('user_id', userId)
    .eq('status', 'pending')
    .select()
    .single();

  if (error) throw error;
  return data as DetectedAccount;
}

function compatibleBalanceKinds(ownerType: BalanceOwnerType): BalanceKind[] {
  if (ownerType === 'bank_account') return BANK_SNAPSHOT_KINDS;
  if (ownerType === 'credit_card') return CREDIT_CARD_SNAPSHOT_KINDS;
  if (ownerType === 'debit_card') return [...BANK_SNAPSHOT_KINDS, ...CREDIT_CARD_SNAPSHOT_KINDS];
  return [];
}

async function createSnapshotFromDetection(
  userId: string,
  detection: DetectedAccount,
  ownerType: BalanceOwnerType,
  ownerId: string,
  detectedAt: string = detection.last_seen_at || new Date().toISOString()
): Promise<BalanceSnapshot | null> {
  if (detection.balance_amount === null || detection.balance_amount === undefined || !detection.balance_kind) {
    return null;
  }

  const amount = Number(detection.balance_amount);
  if (!Number.isFinite(amount) || amount < 0) return null;
  if (!compatibleBalanceKinds(ownerType).includes(detection.balance_kind)) return null;

  const existing = await supabase
    .from('balance_snapshots')
    .select('id')
    .eq('user_id', userId)
    .eq('owner_type', ownerType)
    .eq('owner_id', ownerId)
    .eq('balance_kind', detection.balance_kind)
    .eq('amount', amount)
    .eq('source', detection.source)
    .eq('detected_at', detectedAt)
    .limit(1)
    .maybeSingle();

  if (existing.error) throw existing.error;
  if (existing.data?.id) return null;

  const payload = buildBalanceSnapshotInsert(userId, {
    owner_type: ownerType,
    owner_id: ownerId,
    detected_bank_name: detection.detected_bank_name,
    account_last4: detection.account_last4,
    card_last4: detection.card_last4,
    balance_kind: detection.balance_kind,
    amount,
    currency: 'INR',
    source: detection.source,
    confidence: detection.confidence,
    detected_at: detectedAt,
    source_sender_or_package: detection.source_sender_or_package,
    raw_source_metadata: {
      source: detection.source,
      kind: 'detected_account_confirmation',
    },
  });

  const { data, error } = await supabase
    .from('balance_snapshots')
    .insert(payload)
    .select()
    .single();

  if (error) throw error;
  return data as BalanceSnapshot;
}

async function findDuplicateBankAccount(
  userId: string,
  bankName: string,
  accountLast4: string
): Promise<BankAccount | null> {
  const { data, error } = await supabase
    .from('bank_accounts')
    .select('*')
    .eq('user_id', userId)
    .eq('account_last4', accountLast4);

  if (error) throw error;
  const rows = (data || []) as BankAccount[];
  return rows.find(account =>
    sameBank(account.bank_name, bankName) &&
    account.account_type !== 'credit_card' &&
    account.account_type !== 'loan'
  ) || null;
}

async function findDuplicateCreditCard(
  userId: string,
  cardLast4: string
): Promise<CreditCard | null> {
  const { data, error } = await supabase
    .from('credit_cards')
    .select('*')
    .eq('user_id', userId)
    .eq('last_4_digits', cardLast4)
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return (data as CreditCard | null) || null;
}

async function findDuplicateDebitCard(
  userId: string,
  bankAccountId: string,
  cardLast4: string
): Promise<DebitCard | null> {
  const { data, error } = await supabase
    .from('debit_cards')
    .select('*')
    .eq('user_id', userId)
    .eq('bank_account_id', bankAccountId)
    .eq('card_last4', cardLast4)
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return (data as DebitCard | null) || null;
}

function accountTypeFromInput(type: ConfirmDetectedBankAccountInput['accountType']): ConfirmDetectedBankAccountInput['accountType'] {
  return type === 'current' ? 'current' : 'savings';
}

function creditLimitFromDetection(detection: DetectedAccount, explicitLimit?: number | null): number {
  if (explicitLimit !== undefined && explicitLimit !== null) {
    const limit = Number(explicitLimit);
    if (!Number.isFinite(limit) || limit < 0) throw new Error('Credit limit must be non-negative');
    return limit;
  }

  if (
    detection.balance_kind === 'credit_limit' &&
    detection.confidence === 'exact' &&
    detection.balance_amount !== null &&
    detection.balance_amount !== undefined
  ) {
    const limit = Number(detection.balance_amount);
    return Number.isFinite(limit) && limit >= 0 ? limit : 0;
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
  const detection = await getPendingDetection(userId, input.detectedAccountId);
  ensureDetectionType(detection, 'bank_account');

  const bankName = requireBankName(input.bankName);
  const accountLast4 = requireLast4(input.accountLast4, 'Account');
  const duplicate = await findDuplicateBankAccount(userId, bankName, accountLast4);
  if (duplicate) {
    throw new DetectedAccountDuplicateError(
      'A matching bank account already exists. Link this detection instead.',
      bankOption(duplicate)
    );
  }

  const payload = {
    user_id: userId,
    bank_name: bankName,
    account_last4: accountLast4,
    account_type: accountTypeFromInput(input.accountType),
    starting_balance: 0,
    balance: 0,
    credit_limit: 0,
    loan_total: 0,
    upi_ids: [],
  };

  const { data, error } = await supabase
    .from('bank_accounts')
    .insert(payload)
    .select()
    .single();

  if (error) throw error;
  const account = data as BankAccount;
  const snapshot = await createSnapshotFromDetection(userId, detection, 'bank_account', account.id);
  const detectedAccount = await markDetectedResolved(userId, detection.id, 'confirmed', 'bank_account', account.id);
  await notifyAccountsChanged();

  return { account, detectedAccount, snapshot };
}

export async function confirmDetectedCreditCard(input: ConfirmDetectedCreditCardInput): Promise<{
  creditCard: CreditCard;
  detectedAccount: DetectedAccount;
  snapshot: BalanceSnapshot | null;
}> {
  const userId = await getCurrentUserId();
  const detection = await getPendingDetection(userId, input.detectedAccountId);
  ensureDetectionType(detection, 'credit_card');

  const bankName = requireBankName(input.bankName);
  const cardLast4 = requireLast4(input.cardLast4, 'Card');
  const duplicate = await findDuplicateCreditCard(userId, cardLast4);
  if (duplicate) {
    throw new DetectedAccountDuplicateError(
      'A matching credit card already exists. Link this detection instead.',
      creditCardOption(duplicate)
    );
  }

  const payload = {
    user_id: userId,
    bank_name: bankName,
    card_name: sanitizeDetectedDisplayText(input.cardName, `${bankName} card ${cardLast4}`),
    last_4_digits: cardLast4,
    credit_limit: creditLimitFromDetection(detection, input.creditLimit),
    current_outstanding: 0,
    due_date: requireDay(input.dueDate, 1),
    billing_cycle_date: requireDay(input.billingCycleDate, 1),
  };

  const { data, error } = await supabase
    .from('credit_cards')
    .insert(payload)
    .select()
    .single();

  if (error) throw error;
  const creditCard = data as CreditCard;
  const snapshot = await createSnapshotFromDetection(userId, detection, 'credit_card', creditCard.id);
  const detectedAccount = await markDetectedResolved(userId, detection.id, 'confirmed', 'credit_card', creditCard.id);
  emitFinanceDataChanged({ areas: ['accounts'], source: 'detected_account_review' });

  return { creditCard, detectedAccount, snapshot };
}

export async function confirmDetectedDebitCard(input: ConfirmDetectedDebitCardInput): Promise<{
  debitCard: DebitCard;
  detectedAccount: DetectedAccount;
  snapshot: BalanceSnapshot | null;
}> {
  const userId = await getCurrentUserId();
  const detection = await getPendingDetection(userId, input.detectedAccountId);
  ensureDetectionType(detection, 'debit_card');

  const cardLast4 = requireLast4(input.cardLast4, 'Debit card');
  const { data: bankAccount, error: bankError } = await supabase
    .from('bank_accounts')
    .select('*')
    .eq('id', input.bankAccountId)
    .eq('user_id', userId)
    .maybeSingle();

  if (bankError) throw bankError;
  if (!bankAccount?.id) throw new Error('Choose a linked bank account first');

  const duplicate = await findDuplicateDebitCard(userId, input.bankAccountId, cardLast4);
  if (duplicate) {
    throw new DetectedAccountDuplicateError(
      'A matching debit card already exists. Link this detection instead.',
      debitCardOption(duplicate)
    );
  }

  const payload = {
    user_id: userId,
    bank_account_id: input.bankAccountId,
    bank_name: sanitizeDetectedDisplayText(detection.detected_bank_name || bankAccount.bank_name, '') || null,
    card_last4: cardLast4,
    card_network: null,
    card_label: input.cardLabel ? sanitizeDetectedDisplayText(input.cardLabel, '') || null : null,
    status: 'active' as const,
    detected_confidence: detection.confidence,
    source_sender_or_package: detection.source_sender_or_package || null,
    last_seen_at: detection.last_seen_at || null,
    updated_at: new Date().toISOString(),
  };

  const { data, error } = await supabase
    .from('debit_cards')
    .insert(payload)
    .select()
    .single();

  if (error) throw error;
  const debitCard = data as DebitCard;
  const snapshot = await createSnapshotFromDetection(userId, detection, 'bank_account', input.bankAccountId);
  const detectedAccount = await markDetectedResolved(userId, detection.id, 'confirmed', 'debit_card', debitCard.id);
  emitFinanceDataChanged({ areas: ['accounts'], source: 'detected_account_review' });

  return { debitCard, detectedAccount, snapshot };
}

async function assertOwnerBelongsToUser(
  userId: string,
  ownerType: ConfirmableOwnerType,
  ownerId: string
): Promise<void> {
  const table = ownerType === 'bank_account'
    ? 'bank_accounts'
    : ownerType === 'credit_card'
      ? 'credit_cards'
      : 'debit_cards';
  const { data, error } = await supabase
    .from(table)
    .select('id')
    .eq('id', ownerId)
    .eq('user_id', userId)
    .maybeSingle();

  if (error) throw error;
  if (!data?.id) throw new Error('Selected owner was not found');
}

function expectedMergeOwnerType(detectionType: DetectedAccount['detection_type']): ConfirmableOwnerType | null {
  if (detectionType === 'bank_account') return 'bank_account';
  if (detectionType === 'credit_card') return 'credit_card';
  if (detectionType === 'debit_card') return 'debit_card';
  return null;
}

export async function mergeDetectedAccount(input: MergeDetectedAccountInput): Promise<{
  detectedAccount: DetectedAccount;
  snapshot: BalanceSnapshot | null;
}> {
  const userId = await getCurrentUserId();
  const detection = await getPendingDetection(userId, input.detectedAccountId);
  const expectedOwnerType = expectedMergeOwnerType(detection.detection_type);
  if (!expectedOwnerType || input.ownerType !== expectedOwnerType) {
    throw new Error('This detection cannot be linked to the selected owner type');
  }

  await assertOwnerBelongsToUser(userId, input.ownerType, input.ownerId);
  const snapshot = await createSnapshotFromDetection(userId, detection, input.ownerType, input.ownerId);
  const detectedAccount = await markDetectedResolved(userId, detection.id, 'merged', input.ownerType, input.ownerId);
  emitFinanceDataChanged({ areas: ['accounts'], source: 'detected_account_review' });

  return { detectedAccount, snapshot };
}

export async function ignoreDetectedAccount(id: string): Promise<DetectedAccount> {
  const userId = await getCurrentUserId();
  await getPendingDetection(userId, id);
  const detectedAccount = await markDetectedResolved(userId, id, 'ignored');
  emitFinanceDataChanged({ areas: ['accounts'], source: 'detected_account_review' });
  return detectedAccount;
}
