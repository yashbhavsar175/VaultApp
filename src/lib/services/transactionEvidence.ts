import { supabase } from '../core';
import {
  AccountAppMapping,
  AccountMatchConfidence,
  AccountMatchStatus,
  EvidenceConfidenceLevel,
  EvidenceDirection,
  EvidenceInstrumentHint,
  EvidenceMatchStatus,
  EvidenceSourceType,
  TransactionEvidence,
} from '../../types';

export type EvidenceMetadata = Record<string, unknown>;

export interface CreateTransactionEvidenceInput {
  signal_id: string;
  transaction_id?: string | null;
  source_type: EvidenceSourceType;
  source_package?: string | null;
  source_app?: string | null;
  sender?: string | null;
  amount?: number | null;
  direction?: EvidenceDirection | null;
  captured_at?: string;
  reference_number?: string | null;
  merchant_or_person?: string | null;
  bank_name?: string | null;
  account_last4?: string | null;
  card_last4?: string | null;
  instrument_hint?: EvidenceInstrumentHint | null;
  upi_id?: string | null;
  upi_id_masked?: string | null;
  upi_id_hash?: string | null;
  confidence_level?: EvidenceConfidenceLevel;
  match_status?: EvidenceMatchStatus;
  match_reason_code?: string | null;
  raw_source_metadata?: EvidenceMetadata | null;
}

export interface CreateOrUpdateAccountAppMappingInput {
  app_package: string;
  app_label?: string | null;
  payment_method_hash?: string | null;
  payment_method_masked?: string | null;
  owner_type: AccountAppMapping['owner_type'];
  owner_id: string;
  account_last4?: string | null;
  card_last4?: string | null;
  bank_name?: string | null;
  confidence_level?: AccountAppMapping['confidence_level'];
}

const SAFE_METADATA_KEYS = new Set([
  'len',
  'length',
  'hash',
  'source',
  'sender',
  'package',
  'kind',
  'reasons',
  'parserVersion',
]);

const RAW_METADATA_KEYS = [
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
  'address',
];

function normalizeMetadataKey(key: string): string {
  return key.replace(/[^A-Za-z0-9_]/g, '').toLowerCase();
}

function outputMetadataKey(normalizedKey: string): string {
  if (normalizedKey === 'app') return 'package';
  if (normalizedKey === 'parserversion') return 'parserVersion';
  return normalizedKey;
}

function looksLikeRawUpiId(value: string): boolean {
  return /^[A-Za-z0-9._+-]{2,}@[A-Za-z][A-Za-z0-9.-]{1,}$/.test(value) && !value.includes('*');
}

function looksSensitive(value: string): boolean {
  return (
    /\b(?:otp|one\s*time\s*password|verification\s*code|security\s*code)\b/i.test(value) ||
    /\b(?:\+?91[-\s]?)?[6-9]\d{9}\b/.test(value) ||
    /\b\d(?:[ -]?\d){5,}\b/.test(value) ||
    /\b(?:address|flat|tower|road|street|society|sector|near|landmark|pincode|pin code)\b/i.test(value) ||
    looksLikeRawUpiId(value)
  );
}

function safeLast4(value?: string | null): string | null {
  const digits = (value || '').replace(/\D/g, '');
  return digits.length === 4 ? digits : null;
}

function sanitizeToken(value: string, maxLength = 96): string | undefined {
  const trimmed = value.trim();
  if (!trimmed || looksSensitive(trimmed)) return undefined;

  const cleaned = trimmed
    .replace(/[^A-Za-z0-9._:*@-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, maxLength);

  if (!cleaned || looksSensitive(cleaned)) return undefined;
  return cleaned;
}

function sanitizeMetadataValue(
  key: string,
  value: unknown
): string | number | boolean | string[] | undefined {
  if (key === 'hash' && typeof value === 'string') {
    const hash = value.trim().toLowerCase();
    return /^[a-f0-9]{8,128}$/.test(hash) ? hash : undefined;
  }

  if ((key === 'len' || key === 'length') && typeof value === 'number') {
    return Number.isFinite(value) && value >= 0 ? value : undefined;
  }

  if (Array.isArray(value)) {
    const safeValues = value
      .filter(item => typeof item === 'string')
      .map(item => sanitizeToken(item, 64))
      .filter((item): item is string => Boolean(item))
      .slice(0, 20);

    return safeValues.length ? safeValues : undefined;
  }

  if (typeof value === 'boolean') {
    return value;
  }

  if (typeof value !== 'string') {
    return undefined;
  }

  return sanitizeToken(value);
}

export function sanitizeEvidenceMetadata(input?: EvidenceMetadata | null): EvidenceMetadata {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return {};

  const sanitized: EvidenceMetadata = {};

  for (const [key, value] of Object.entries(input)) {
    const normalizedKey = normalizeMetadataKey(key);
    const outputKey = outputMetadataKey(normalizedKey);

    if (!SAFE_METADATA_KEYS.has(outputKey)) continue;
    if (RAW_METADATA_KEYS.some(rawKey => normalizedKey.includes(rawKey))) continue;

    const sanitizedValue = sanitizeMetadataValue(outputKey, value);
    if (sanitizedValue !== undefined) {
      sanitized[outputKey] = sanitizedValue;
    }
  }

  return sanitized;
}

export function maskUpiId(upiId?: string | null): string | null {
  const trimmed = upiId?.trim().toLowerCase();
  if (!trimmed || !trimmed.includes('@')) return null;

  const [local, domain, ...extra] = trimmed.split('@');
  if (!local || !domain || extra.length > 0) return null;

  const safeDomain = domain.replace(/[^a-z0-9.-]/g, '').slice(0, 40);
  if (!safeDomain) return null;

  const isPhoneLike = /^(?:\+?91)?[6-9]\d{9}$/.test(local.replace(/\D/g, ''));
  if (isPhoneLike) return `****@${safeDomain}`;

  const safeLocal = local.replace(/[^a-z0-9._-]/g, '');
  if (!safeLocal) return `****@${safeDomain}`;

  const prefix = safeLocal.slice(0, Math.min(4, Math.max(1, safeLocal.length)));
  return `${prefix}***@${safeDomain}`;
}

async function getCurrentUserId(): Promise<string> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user?.id) throw new Error('Not authenticated');
  return user.id;
}

function buildEvidencePayload(userId: string, input: CreateTransactionEvidenceInput) {
  return {
    user_id: userId,
    signal_id: input.signal_id.trim(),
    transaction_id: input.transaction_id || null,
    source_type: input.source_type,
    source_package: input.source_package?.trim() || null,
    source_app: input.source_app?.trim() || null,
    sender: input.sender?.trim() || null,
    amount: input.amount ?? null,
    direction: input.direction || null,
    captured_at: input.captured_at || new Date().toISOString(),
    reference_number: input.reference_number?.trim() || null,
    merchant_or_person: input.merchant_or_person?.trim() || null,
    bank_name: input.bank_name?.trim() || null,
    account_last4: safeLast4(input.account_last4),
    card_last4: safeLast4(input.card_last4),
    instrument_hint: input.instrument_hint || null,
    upi_id_masked: input.upi_id_masked?.trim() || maskUpiId(input.upi_id),
    upi_id_hash: input.upi_id_hash?.trim().toLowerCase() || null,
    confidence_level: input.confidence_level || 'low',
    match_status: input.match_status || 'unlinked',
    match_reason_code: input.match_reason_code?.trim() || null,
    raw_source_metadata: sanitizeEvidenceMetadata(input.raw_source_metadata),
  };
}

export async function createTransactionEvidence(
  input: CreateTransactionEvidenceInput
): Promise<TransactionEvidence> {
  const userId = await getCurrentUserId();
  const payload = buildEvidencePayload(userId, input);

  const { data, error } = await supabase
    .from('transaction_evidence')
    .insert(payload)
    .select()
    .single();

  if (error) throw error;
  return data as TransactionEvidence;
}

export async function getEvidenceForTransaction(transactionId: string): Promise<TransactionEvidence[]> {
  const userId = await getCurrentUserId();
  const { data, error } = await supabase
    .from('transaction_evidence')
    .select('*')
    .eq('user_id', userId)
    .eq('transaction_id', transactionId)
    .order('captured_at', { ascending: false });

  if (error) throw error;
  return (data || []) as TransactionEvidence[];
}

export async function getUnlinkedEvidence(limit = 50): Promise<TransactionEvidence[]> {
  const userId = await getCurrentUserId();
  const safeLimit = Math.max(1, Math.min(limit, 100));

  const { data, error } = await supabase
    .from('transaction_evidence')
    .select('*')
    .eq('user_id', userId)
    .eq('match_status', 'unlinked')
    .order('captured_at', { ascending: false })
    .limit(safeLimit);

  if (error) throw error;
  return (data || []) as TransactionEvidence[];
}

export async function linkEvidenceToTransaction(
  evidenceId: string,
  transactionId: string,
  matchStatus: EvidenceMatchStatus,
  confidence: AccountMatchConfidence,
  reason?: string | null
): Promise<TransactionEvidence> {
  const userId = await getCurrentUserId();
  const safeReason = reason?.trim() || null;

  const { data, error } = await supabase
    .from('transaction_evidence')
    .update({
      transaction_id: transactionId,
      match_status: matchStatus,
      confidence_level: confidence,
      match_reason_code: safeReason,
    })
    .eq('id', evidenceId)
    .eq('user_id', userId)
    .select()
    .single();

  if (error) throw error;

  await supabase
    .from('transactions')
    .update({
      account_match_status: matchStatus as AccountMatchStatus,
      account_match_confidence: confidence,
      account_match_reason: safeReason,
      primary_evidence_id: evidenceId,
    })
    .eq('id', transactionId)
    .eq('user_id', userId);

  return data as TransactionEvidence;
}

export async function markEvidenceReviewRequired(
  evidenceId: string,
  reason?: string | null
): Promise<TransactionEvidence> {
  const userId = await getCurrentUserId();

  const { data, error } = await supabase
    .from('transaction_evidence')
    .update({
      match_status: 'review_required',
      match_reason_code: reason?.trim() || null,
    })
    .eq('id', evidenceId)
    .eq('user_id', userId)
    .select()
    .single();

  if (error) throw error;
  return data as TransactionEvidence;
}

function buildMappingPayload(userId: string, input: CreateOrUpdateAccountAppMappingInput) {
  if (input.owner_type === 'wallet') {
    throw new Error('Wallet mappings are not supported yet');
  }

  const confidence = input.confidence_level === 'low' ? 'low' : 'medium';

  return {
    user_id: userId,
    app_package: input.app_package.trim(),
    app_label: input.app_label?.trim() || null,
    payment_method_hash: input.payment_method_hash?.trim().toLowerCase() || null,
    payment_method_masked: input.payment_method_masked?.trim() || null,
    owner_type: input.owner_type,
    owner_id: input.owner_id,
    account_last4: safeLast4(input.account_last4),
    card_last4: safeLast4(input.card_last4),
    bank_name: input.bank_name?.trim() || null,
    confidence_level: confidence,
    last_confirmed_at: new Date().toISOString(),
    status: 'active',
  };
}

export async function createOrUpdateAccountAppMapping(
  input: CreateOrUpdateAccountAppMappingInput
): Promise<AccountAppMapping> {
  const userId = await getCurrentUserId();
  const payload = buildMappingPayload(userId, input);

  let query = supabase
    .from('account_app_mappings')
    .select('*')
    .eq('user_id', userId)
    .eq('app_package', payload.app_package)
    .eq('owner_type', payload.owner_type)
    .eq('owner_id', payload.owner_id)
    .eq('status', 'active');

  query = payload.payment_method_hash
    ? query.eq('payment_method_hash', payload.payment_method_hash)
    : query.is('payment_method_hash', null);

  const { data: existing, error: existingError } = await query
    .limit(1)
    .maybeSingle();

  if (existingError) throw existingError;

  if (existing?.id) {
    const nextUseCount = Number(existing.use_count || 0) + 1;
    const { data, error } = await supabase
      .from('account_app_mappings')
      .update({ ...payload, use_count: nextUseCount })
      .eq('id', existing.id)
      .eq('user_id', userId)
      .select()
      .single();

    if (error) throw error;
    return data as AccountAppMapping;
  }

  const { data, error } = await supabase
    .from('account_app_mappings')
    .insert({ ...payload, use_count: 1 })
    .select()
    .single();

  if (error) throw error;
  return data as AccountAppMapping;
}

export async function getActiveAppMappings(
  appPackage: string,
  paymentMethodHash?: string | null
): Promise<AccountAppMapping[]> {
  const userId = await getCurrentUserId();
  let query = supabase
    .from('account_app_mappings')
    .select('*')
    .eq('user_id', userId)
    .eq('app_package', appPackage)
    .eq('status', 'active');

  if (paymentMethodHash) {
    query = query.eq('payment_method_hash', paymentMethodHash.trim().toLowerCase());
  }

  const { data, error } = await query.order('last_confirmed_at', { ascending: false });
  if (error) throw error;
  return (data || []) as AccountAppMapping[];
}

export async function disableAccountAppMapping(id: string): Promise<AccountAppMapping> {
  const userId = await getCurrentUserId();
  const { data, error } = await supabase
    .from('account_app_mappings')
    .update({ status: 'disabled' })
    .eq('id', id)
    .eq('user_id', userId)
    .select()
    .single();

  if (error) throw error;
  return data as AccountAppMapping;
}
