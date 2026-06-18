import { extractUpiIdFromText } from '../../utils/upi';
import {
  EvidenceConfidenceLevel,
  EvidenceDirection,
  EvidenceInstrumentHint,
  EvidenceSourceType,
} from '../../types';
import {
  CreateTransactionEvidenceInput,
  createTransactionEvidence,
  maskUpiId,
} from './transactionEvidence';
import { extractPaymentAppBankHint } from './paymentAppAccountMappings';

type RuntimeParsedTransaction = {
  amount?: number | null;
  type?: 'debit' | 'credit' | 'payment' | 'unknown' | null;
  transactionType?: 'debit' | 'credit' | 'payment' | 'unknown' | null;
  reference?: string | null;
  reference_number?: string | null;
  merchant?: string | null;
  bankName?: string | null;
  source?: 'bank' | 'upi' | 'unknown' | null;
  rawSender?: string | null;
  accountLast4?: string | null;
  last4Digits?: string | null;
  cardLast4?: string | null;
  upiId?: string | null;
};

export interface RuntimeSmsEvidenceInput {
  text: string;
  sender: string;
  parsed?: RuntimeParsedTransaction | null;
  transactionId?: string | null;
  timestamp?: number;
}

export interface RuntimeNotificationEvidenceInput {
  text: string;
  sourcePackage: string;
  sourceApp?: string | null;
  sender?: string | null;
  parsed?: RuntimeParsedTransaction | null;
  transactionId?: string | null;
  timestamp?: number;
}

export interface BuildEvidenceSignalIdInput {
  sourceType: EvidenceSourceType;
  sourceIdentity?: string | null;
  safeHash: string;
  amount?: number | null;
  referenceNumber?: string | null;
  capturedAt?: string | number | Date | null;
}

const PAYMENT_APP_PACKAGES = new Set([
  'com.google.android.apps.nbu.paisa.user',
  'com.phonepe.app',
  'money.super.app',
  'money.super.payments',
  'net.one97.paytm',
  'in.amazon.mShop.android.shopping',
  'com.whatsapp',
]);

const PACKAGE_LABELS: Record<string, string> = {
  'com.google.android.apps.nbu.paisa.user': 'GPay',
  'com.phonepe.app': 'PhonePe',
  'money.super.app': 'Super.money',
  'money.super.payments': 'Super.money',
  'net.one97.paytm': 'Paytm',
  'in.amazon.mShop.android.shopping': 'Amazon Pay',
  'com.whatsapp': 'WhatsApp',
  'com.dreamplug.androidapp': 'CRED',
  'com.kotak811mobilebankingapp.instantsavingsupiscanandpayrecharge': 'Kotak',
};

function normalizeForHash(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function stableHash(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }

  return (hash >>> 0).toString(16).padStart(8, '0');
}

function safeHash(text: string): string {
  return stableHash(normalizeForHash(text));
}

function normalizeIdentity(value?: string | null): string {
  const normalized = (value || 'unknown')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 64);

  return normalized || 'unknown';
}

function normalizeReference(value?: string | null): string | null {
  const cleaned = value?.trim().replace(/[^A-Za-z0-9_-]+/g, '').slice(0, 64);
  return cleaned || null;
}

function amountToken(amount?: number | null): string {
  return typeof amount === 'number' && Number.isFinite(amount)
    ? amount.toFixed(2)
    : 'none';
}

function toCapturedDate(value?: string | number | Date | null): Date {
  if (value instanceof Date) return value;
  if (typeof value === 'number') return new Date(value);
  if (typeof value === 'string') {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  return new Date();
}

function capturedAtIso(timestamp?: number): string {
  return toCapturedDate(timestamp).toISOString();
}

export function buildEvidenceSignalId(input: BuildEvidenceSignalIdInput): string {
  const identity = normalizeIdentity(input.sourceIdentity);
  const reference = normalizeReference(input.referenceNumber) || 'no_ref';
  return [
    'runtime',
    input.sourceType,
    identity,
    input.safeHash.toLowerCase(),
    amountToken(input.amount),
    reference.toLowerCase(),
  ].join(':');
}

function safeLast4(value?: string | null): string | null {
  const digits = (value || '').replace(/\D/g, '');
  return digits.length === 4 ? digits : null;
}

function directionFromParsed(parsed?: RuntimeParsedTransaction | null): EvidenceDirection {
  const direction = parsed?.type || parsed?.transactionType;
  if (direction === 'debit' || direction === 'credit') return direction;
  if (direction === 'payment') return 'debit';
  return 'unknown';
}

function inferAmountFromText(text: string): number | null {
  const match = text.match(/(?:INR|Rs\.?|₹)\s*([0-9,]+(?:\.[0-9]{1,2})?)/i);
  if (!match) return null;
  const amount = Number.parseFloat(match[1].replace(/,/g, ''));
  return Number.isFinite(amount) && amount > 0 ? amount : null;
}

function normalizeAmount(parsed?: RuntimeParsedTransaction | null, text?: string): number | null {
  if (typeof parsed?.amount === 'number' && Number.isFinite(parsed.amount)) return parsed.amount;
  return text ? inferAmountFromText(text) : null;
}

function looksLikeRawUpiId(value: string): boolean {
  return /^[A-Za-z0-9._+-]{2,}@[A-Za-z][A-Za-z0-9.-]{1,}$/.test(value) && !value.includes('*');
}

function safeSourceToken(value?: string | null): string | null {
  const trimmed = value?.trim();
  if (!trimmed || /\b(?:\+?91[-\s]?)?[6-9]\d{9}\b/.test(trimmed)) return null;

  const sanitized = trimmed.replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 96);
  return sanitized || null;
}

function safeMerchantOrPerson(value?: string | null): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;

  if (
    /\b(?:otp|one\s*time\s*password|verification\s*code)\b/i.test(trimmed) ||
    /\b(?:\+?91[-\s]?)?[6-9]\d{9}\b/.test(trimmed) ||
    /\b\d(?:[ -]?\d){11,}\b/.test(trimmed) ||
    /\b(?:account|acct|a\/c|card)\b/i.test(trimmed) ||
    /\b(?:address|flat|tower|road|street|society|sector|near|landmark|pincode|pin code)\b/i.test(trimmed)
  ) {
    return null;
  }

  const masked = trimmed.replace(
    /\b[A-Za-z0-9._+-]{2,}@[A-Za-z][A-Za-z0-9.-]{1,}\b/g,
    upiId => maskUpiId(upiId) || ''
  );
  const sanitized = masked
    .replace(/[^A-Za-z0-9 ._&*/:@-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 96);

  return sanitized || null;
}

function detectCardContext(text: string): boolean {
  return /\b(?:card|credit\s*card|debit\s*card|supercard)\b/i.test(text);
}

function detectLoanContext(text: string): boolean {
  return /\b(?:loan|emi)\b/i.test(text);
}

function inferSmsInstrumentHint(input: RuntimeSmsEvidenceInput): EvidenceInstrumentHint {
  if (detectLoanContext(input.text)) return 'loan';
  if (detectCardContext(input.text)) {
    return /\bcredit\s*card|supercard\b/i.test(input.text) ? 'credit_card' : 'debit_card';
  }
  return input.parsed?.accountLast4 || input.parsed?.last4Digits ? 'bank_account' : 'unknown';
}

function confidenceForSms(input: RuntimeSmsEvidenceInput): EvidenceConfidenceLevel {
  const last4 = safeLast4(input.parsed?.accountLast4 || input.parsed?.last4Digits || input.parsed?.cardLast4);
  const reference = normalizeReference(input.parsed?.reference || input.parsed?.reference_number);
  const amount = normalizeAmount(input.parsed, input.text);

  if (last4 && reference) return 'exact';
  if (last4 && amount !== null) return 'high';
  return 'low';
}

function safeUpiHash(upiId?: string | null): string | null {
  const trimmed = upiId?.trim().toLowerCase();
  return trimmed && looksLikeRawUpiId(trimmed) ? stableHash(trimmed) : null;
}

function sourceAppLabel(packageName: string, explicit?: string | null): string | null {
  const value = explicit || PACKAGE_LABELS[packageName] || dynamicPackageLabel(packageName);
  if (!value) return null;
  return value.replace(/[^A-Za-z0-9 ._-]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 64) || null;
}

/** Dynamically extract a readable app label from any Android package name */
function dynamicPackageLabel(packageName: string): string | null {
  const IGNORE = new Set(['com', 'in', 'net', 'org', 'co', 'app', 'android', 'apps', 'user', 'mobile', 'banking']);
  const parts = packageName.split(/[._-]/).filter(p => !IGNORE.has(p.toLowerCase()));
  if (parts.length === 0) return null;
  return parts.map(p => p.charAt(0).toUpperCase() + p.slice(1)).join(' ');
}

export function mapParsedTransactionToEvidence(
  input: RuntimeSmsEvidenceInput
): CreateTransactionEvidenceInput {
  const parsed = input.parsed || {};
  const sender = safeSourceToken(input.sender);
  const captured_at = capturedAtIso(input.timestamp);
  const amount = normalizeAmount(parsed, input.text);
  const sourceHash = safeHash(input.text);
  const reference_number = normalizeReference(parsed.reference || parsed.reference_number);
  const isCard = detectCardContext(input.text);
  const accountLast4 = safeLast4(parsed.accountLast4 || parsed.last4Digits);
  const parsedCardLast4 = safeLast4(parsed.cardLast4);
  const fallbackLast4 = safeLast4(parsed.accountLast4 || parsed.last4Digits || parsed.cardLast4);
  const upiId = parsed.upiId || extractUpiIdFromText(input.text);

  return {
    signal_id: buildEvidenceSignalId({
      sourceType: 'sms',
      sourceIdentity: sender,
      safeHash: sourceHash,
      amount,
      referenceNumber: reference_number,
      capturedAt: captured_at,
    }),
    transaction_id: input.transactionId || null,
    source_type: 'sms',
    sender,
    amount,
    direction: directionFromParsed(parsed),
    captured_at,
    reference_number,
    merchant_or_person: safeMerchantOrPerson(parsed.merchant),
    bank_name: safeMerchantOrPerson(parsed.bankName),
    account_last4: isCard && !parsedCardLast4 ? null : accountLast4,
    card_last4: isCard ? parsedCardLast4 || (!accountLast4 ? fallbackLast4 : null) : parsedCardLast4,
    instrument_hint: inferSmsInstrumentHint(input),
    upi_id_masked: maskUpiId(upiId),
    upi_id_hash: safeUpiHash(upiId),
    confidence_level: confidenceForSms(input),
    match_status: input.transactionId ? 'linked' : 'unlinked',
    raw_source_metadata: {
      len: input.text.length,
      hash: sourceHash,
      source: 'runtime',
      sender,
      kind: 'transaction_evidence',
      reasons: reference_number ? ['reference'] : ['runtime_parse'],
    },
  };
}

export function mapNotificationToEvidence(
  input: RuntimeNotificationEvidenceInput
): CreateTransactionEvidenceInput {
  const parsed = input.parsed || {};
  const sourcePackage = safeSourceToken(input.sourcePackage) || 'unknown';
  const sender = safeSourceToken(input.sender);
  const captured_at = capturedAtIso(input.timestamp);
  const amount = normalizeAmount(parsed, input.text);
  const sourceHash = safeHash(input.text);
  const reference_number = normalizeReference(parsed.reference || parsed.reference_number);
  const upiId = parsed.upiId || extractUpiIdFromText(input.text);
  const paymentAppEvidenceOnly = PAYMENT_APP_PACKAGES.has(sourcePackage) ||
    /\b(?:pay|wallet|money|payment|upi)\b/i.test(sourcePackage);
  const paymentAppBankHint = paymentAppEvidenceOnly
    ? extractPaymentAppBankHint(input.text, sourcePackage)
    : null;

  return {
    signal_id: buildEvidenceSignalId({
      sourceType: 'notification',
      sourceIdentity: sourcePackage,
      safeHash: sourceHash,
      amount,
      referenceNumber: reference_number,
      capturedAt: captured_at,
    }),
    transaction_id: input.transactionId || null,
    source_type: 'notification',
    source_package: sourcePackage,
    source_app: sourceAppLabel(sourcePackage, input.sourceApp),
    sender,
    amount,
    direction: directionFromParsed(parsed),
    captured_at,
    reference_number,
    merchant_or_person: paymentAppEvidenceOnly ? null : safeMerchantOrPerson(parsed.merchant),
    bank_name: paymentAppEvidenceOnly
      ? paymentAppBankHint?.bankHintLabel || null
      : safeMerchantOrPerson(parsed.bankName),
    account_last4: paymentAppEvidenceOnly ? null : safeLast4(parsed.accountLast4 || parsed.last4Digits),
    card_last4: null,
    instrument_hint: paymentAppEvidenceOnly ? 'unknown' : 'bank_account',
    upi_id_masked: maskUpiId(upiId),
    upi_id_hash: safeUpiHash(upiId),
    confidence_level: paymentAppEvidenceOnly ? 'low' : confidenceForSms({
      text: input.text,
      sender: sender || sourcePackage,
      parsed,
      transactionId: input.transactionId,
      timestamp: input.timestamp,
    }),
    match_status: input.transactionId ? 'linked' : 'unlinked',
    raw_source_metadata: {
      len: input.text.length,
      hash: sourceHash,
      source: 'runtime',
      package: sourcePackage,
      kind: 'transaction_evidence',
      bankHint: paymentAppBankHint?.bankHint,
      reasons: [paymentAppEvidenceOnly ? 'payment_app_evidence_only' : 'runtime_notification'],
    },
  };
}

function isDuplicateEvidenceError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const maybeError = error as { code?: string; message?: string };
  return maybeError.code === '23505' || /duplicate key/i.test(maybeError.message || '');
}

function safeErrorReason(error: unknown): string {
  if (!error || typeof error !== 'object') return 'unknown_error';
  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' && /^[A-Za-z0-9_-]{1,32}$/.test(code)
    ? `database_${code.toLowerCase()}`
    : 'evidence_write_failed';
}

async function createEvidenceSafely(
  sourceType: EvidenceSourceType,
  payload: CreateTransactionEvidenceInput
): Promise<'created' | 'duplicate' | 'failed'> {
  try {
    await createTransactionEvidence(payload);
    return 'created';
  } catch (error) {
    if (isDuplicateEvidenceError(error)) return 'duplicate';

    console.warn('[RuntimeTransactionEvidence] Failed to record evidence', {
      sourceType,
      reason: safeErrorReason(error),
    });
    return 'failed';
  }
}

export async function recordSmsTransactionEvidence(
  input: RuntimeSmsEvidenceInput
): Promise<'created' | 'duplicate' | 'failed'> {
  return createEvidenceSafely('sms', mapParsedTransactionToEvidence(input));
}

export async function recordNotificationTransactionEvidence(
  input: RuntimeNotificationEvidenceInput
): Promise<'created' | 'duplicate' | 'failed'> {
  return createEvidenceSafely('notification', mapNotificationToEvidence(input));
}
