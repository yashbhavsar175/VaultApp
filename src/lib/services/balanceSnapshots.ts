import { supabase } from '../core';
import {
  BalanceConfidence,
  BalanceKind,
  BalanceOwnerType,
  BalanceSnapshot,
  BalanceSource,
  BankAccount,
} from '../../types';
import { CACHE_KEYS, updateCache } from './cache';
import { emitFinanceDataChanged } from './dataEvents';

export type BalanceSourceMetadata = Record<string, unknown>;

export interface CreateBalanceSnapshotInput {
  owner_type: BalanceOwnerType;
  owner_id?: string | null;
  detected_bank_name?: string | null;
  account_last4?: string | null;
  card_last4?: string | null;
  balance_kind: BalanceKind;
  amount: number;
  currency?: string;
  source: BalanceSource;
  confidence: BalanceConfidence;
  detected_at?: string;
  source_sender_or_package?: string | null;
  raw_source_metadata?: BalanceSourceMetadata | null;
  note?: string | null;
}

const SAFE_METADATA_KEYS = new Set(['len', 'length', 'hash', 'source', 'sender', 'package', 'kind', 'reasons']);
const MAX_SAFE_NOTE_LENGTH = 120;
const RAW_TEXT_KEYS = [
  'raw',
  'rawtext',
  'raw_sms',
  'rawsms',
  'body',
  'message',
  'notificationtext',
  'notification_text',
  'payload',
  'text',
  'sms',
  'address',
  'accountnumber',
  'account_number',
  'cardnumber',
  'card_number',
  'fullaccount',
  'full_account',
  'fullcard',
  'full_card',
  'otp',
  'phone',
];

function normalizeMetadataKey(key: string): string {
  return key.replace(/[^A-Za-z0-9_]/g, '').toLowerCase();
}

function looksSensitive(value: string): boolean {
  return (
    /\b(?:otp|one\s*time\s*password|verification\s*code|security\s*code)\b/i.test(value) ||
    /\b(?:\+?91[-\s]?)?[6-9]\d{9}\b/.test(value) ||
    /\b\d(?:[ -]?\d){5,}\b/.test(value) ||
    /\b\d(?:[ -]?\d){11,18}\b/.test(value) ||
    /\b(?:address|flat|tower|road|street|society|sector|near|landmark|pincode|pin code)\b/i.test(value)
  );
}

function sanitizeMetadataValue(value: unknown): string | number | boolean | string[] | undefined {
  if (Array.isArray(value)) {
    const safeTokens = value
      .filter(item => typeof item === 'string')
      .map(item => item.trim())
      .filter(item => /^[A-Za-z0-9_:-]{1,64}$/.test(item))
      .slice(0, 20);

    return safeTokens.length ? safeTokens : undefined;
  }

  if (typeof value === 'number') {
    return Number.isFinite(value) && value >= 0 ? value : undefined;
  }

  if (typeof value === 'boolean') {
    return value;
  }

  if (typeof value !== 'string') {
    return undefined;
  }

  const trimmed = value.trim();
  if (!trimmed || looksSensitive(trimmed)) return undefined;

  const cleaned = trimmed
    .replace(/[^A-Za-z0-9._:-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 96);

  return cleaned || undefined;
}

export function sanitizeBalanceSourceMetadata(
  metadata?: BalanceSourceMetadata | null
): BalanceSourceMetadata {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
    return {};
  }

  const sanitized: BalanceSourceMetadata = {};

  for (const [key, value] of Object.entries(metadata)) {
    const normalizedKey = normalizeMetadataKey(key);
    const outputKey = normalizedKey === 'app' ? 'package' : normalizedKey;

    if (!SAFE_METADATA_KEYS.has(outputKey)) continue;
    if (RAW_TEXT_KEYS.some(rawKey => normalizedKey.includes(rawKey))) continue;

    if (outputKey === 'hash' && typeof value === 'string') {
      const hash = value.trim().toLowerCase();
      if (/^[a-f0-9]{8,64}$/.test(hash)) {
        sanitized[outputKey] = hash;
      }
      continue;
    }

    const sanitizedValue = sanitizeMetadataValue(value);
    if (sanitizedValue !== undefined) {
      sanitized[outputKey] = sanitizedValue;
    }
  }

  return sanitized;
}

export function normalizeLast4(value?: string | null): string | null {
  const digits = (value || '').replace(/\D/g, '');
  if (!digits) return null;
  return digits.slice(-4);
}

export function sanitizeBalanceSnapshotNote(note?: string | null): string | null {
  const trimmed = note?.trim();
  if (!trimmed || looksSensitive(trimmed)) return null;

  const cleaned = trimmed
    .replace(/[^\w\s.,:;()/-]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_SAFE_NOTE_LENGTH)
    .trim();

  return cleaned || null;
}

export function parseManualBalanceCorrectionAmount(value: string): number | null {
  const normalized = value.replace(/[,\s₹]/g, '');
  if (!normalized || !/^\d+(\.\d{1,2})?$/.test(normalized)) return null;

  const amount = Number(normalized);
  return Number.isFinite(amount) && amount >= 0 ? amount : null;
}

export function buildBalanceSnapshotInsert(
  userId: string,
  input: CreateBalanceSnapshotInput
): Omit<BalanceSnapshot, 'id' | 'created_at'> {
  if (input.amount === undefined || input.amount === null || !Number.isFinite(input.amount) || input.amount < 0) {
    throw new Error('Balance snapshot amount must be non-negative');
  }

  return {
    user_id: userId,
    owner_type: input.owner_type,
    owner_id: input.owner_id || null,
    detected_bank_name: input.detected_bank_name?.trim() || null,
    account_last4: normalizeLast4(input.account_last4),
    card_last4: normalizeLast4(input.card_last4),
    balance_kind: input.balance_kind,
    amount: input.amount,
    currency: input.currency?.trim() || 'INR',
    source: input.source,
    confidence: input.confidence,
    detected_at: input.detected_at || new Date().toISOString(),
    source_sender_or_package: input.source_sender_or_package?.trim() || null,
    raw_source_metadata: sanitizeBalanceSourceMetadata(input.raw_source_metadata),
    note: sanitizeBalanceSnapshotNote(input.note),
  };
}

export interface ManualBalanceCorrectionInput {
  owner_type: Extract<BalanceOwnerType, 'bank_account' | 'credit_card' | 'loan'>;
  owner_id: string;
  balance_kind: BalanceKind;
  amount: number;
  note?: string | null;
  account_last4?: string | null;
  card_last4?: string | null;
  detected_bank_name?: string | null;
}

const MANUAL_BALANCE_KINDS_BY_OWNER: Record<ManualBalanceCorrectionInput['owner_type'], BalanceKind[]> = {
  bank_account: ['available_balance', 'current_balance'],
  credit_card: ['outstanding', 'available_limit', 'credit_limit', 'due_amount', 'minimum_due'],
  loan: ['loan_outstanding'],
};

function validateManualBalanceCorrectionInput(input: ManualBalanceCorrectionInput) {
  const allowedKinds = MANUAL_BALANCE_KINDS_BY_OWNER[input.owner_type];
  if (!allowedKinds.includes(input.balance_kind)) {
    throw new Error('Balance kind is not valid for this balance owner');
  }

  if (!input.owner_id?.trim()) {
    throw new Error('Balance owner is required');
  }
}

export function buildManualBalanceCorrectionSnapshotInput(
  input: ManualBalanceCorrectionInput
): CreateBalanceSnapshotInput {
  validateManualBalanceCorrectionInput(input);

  return {
    owner_type: input.owner_type,
    owner_id: input.owner_id,
    balance_kind: input.balance_kind,
    amount: input.amount,
    currency: 'INR',
    source: 'manual',
    confidence: 'exact',
    detected_at: new Date().toISOString(),
    detected_bank_name: input.detected_bank_name || null,
    account_last4: input.account_last4 || null,
    card_last4: input.card_last4 || null,
    note: sanitizeBalanceSnapshotNote(input.note),
    raw_source_metadata: {
      source: 'manual',
      kind: 'balance_correction',
    },
  };
}

export async function createManualBalanceCorrectionSnapshot(
  input: ManualBalanceCorrectionInput
): Promise<BalanceSnapshot> {
  const snapshot = await createBalanceSnapshot(buildManualBalanceCorrectionSnapshotInput(input));
  await writeThroughManualBalanceCorrection(input, snapshot);
  emitFinanceDataChanged({ areas: ['accounts', 'balances'], source: 'manual_balance_correction' });
  return snapshot;
}

function safeManualCorrectionLogCode(error: unknown): string {
  if (error && typeof error === 'object') {
    const code = (error as { code?: unknown; name?: unknown }).code || (error as { name?: unknown }).name;
    if (typeof code === 'string') return code.replace(/[^a-z0-9_:-]/gi, '').slice(0, 32) || 'unknown';
  }
  return 'unknown';
}

async function writeThroughManualBalanceCorrection(
  input: ManualBalanceCorrectionInput,
  snapshot: BalanceSnapshot
): Promise<void> {
  if (input.owner_type !== 'bank_account' && input.owner_type !== 'loan') return;

  const userId = await getCurrentUserId();
  const amount = Number(snapshot.amount);
  if (!Number.isFinite(amount)) return;

  const { error } = await supabase
    .from('bank_accounts')
    .update({ balance: amount })
    .eq('id', input.owner_id)
    .eq('user_id', userId);

  if (error) {
    console.warn('[Balances] Manual correction account write-through failed', {
      ownerType: input.owner_type,
      balanceKind: input.balance_kind,
      code: safeManualCorrectionLogCode(error),
    });
    return;
  }

  await updateCache<BankAccount[]>(CACHE_KEYS.BANK_ACCOUNTS, current => {
    if (!current) return current;
    return current.map(account => account.id === input.owner_id ? { ...account, balance: amount } : account);
  });
}

async function getCurrentUserId(): Promise<string> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user?.id) throw new Error('Not authenticated');
  return user.id;
}

export async function createBalanceSnapshot(
  input: CreateBalanceSnapshotInput
): Promise<BalanceSnapshot> {
  const userId = await getCurrentUserId();
  const payload = buildBalanceSnapshotInsert(userId, input);

  const { data, error } = await supabase
    .from('balance_snapshots')
    .insert(payload)
    .select()
    .single();

  if (error) throw error;
  return data as BalanceSnapshot;
}

export async function getLatestBalanceSnapshot(
  ownerType: BalanceOwnerType,
  ownerId: string | null,
  balanceKind: BalanceKind
): Promise<BalanceSnapshot | null> {
  const userId = await getCurrentUserId();
  let query = supabase
    .from('balance_snapshots')
    .select('*')
    .eq('user_id', userId)
    .eq('owner_type', ownerType)
    .eq('balance_kind', balanceKind);

  query = ownerId ? query.eq('owner_id', ownerId) : query.is('owner_id', null);

  const { data, error } = await query
    .order('detected_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return (data as BalanceSnapshot | null) || null;
}

export async function getBalanceHistory(
  ownerType: BalanceOwnerType,
  ownerId: string | null,
  balanceKind: BalanceKind,
  limit = 20
): Promise<BalanceSnapshot[]> {
  const userId = await getCurrentUserId();
  let query = supabase
    .from('balance_snapshots')
    .select('*')
    .eq('user_id', userId)
    .eq('owner_type', ownerType)
    .eq('balance_kind', balanceKind);

  query = ownerId ? query.eq('owner_id', ownerId) : query.is('owner_id', null);

  const { data, error } = await query
    .order('detected_at', { ascending: false })
    .limit(Math.max(1, Math.min(limit, 100)));

  if (error) throw error;
  return (data || []) as BalanceSnapshot[];
}
