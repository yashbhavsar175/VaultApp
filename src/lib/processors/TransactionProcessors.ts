// ═══════════════════════════════════════════════════════════════════════════════
// TRANSACTION PROCESSORS MODULE
// Consolidated: NotificationProcessorTask + SmsProcessorTask
// Handles both SMS and App Notification processing for financial transactions
// ═══════════════════════════════════════════════════════════════════════════════

import { supabase } from '../core';
import AsyncStorage from '@react-native-async-storage/async-storage';
import NetInfo from '@react-native-community/netinfo';
import {
  isSpamMessage,
  showFinancialEventNotification,
  showSmsFailedNotification
} from '../services/notifications';
import { extractUpiIdFromText } from '../../utils/upi';
import {
  getTransactionDisplayName,
  inferTransactionCategory,
} from '../../utils/transactionPresentation';
import { CACHE_KEYS, updateCache } from '../services/cache';
import { emitFinanceDataChanged } from '../services/dataEvents';
import { BankAccount, Transaction } from '../../types';
import { createRedactedRawTextRecord } from '../privacy/rawText';
import {
  recordBalanceSignalForUser,
  recordEstimatedBankBalanceMovementForUser,
} from '../services/balanceSignalRecorder';
import {
  recordNotificationTransactionEvidence,
  recordSmsTransactionEvidence,
} from '../services/runtimeTransactionEvidence';
import {
  getAutomaticTransactionPolicy,
} from '../services/automaticTransactionPolicy';
import { OFFLINE_TX_QUEUE_BASE_KEY, appendUserScopedQueueItem } from '../services/userScopedQueues';
import {
  PaymentAppBankAccountMatch,
  resolvePaymentAppBankAccountForUser,
} from '../services/paymentAppAccountMappings';

// ═══════════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════════

export interface SmsData {
  sender: string;
  body: string;
  timestamp: number;
}

export interface ParsedTransaction {
  amount: number;
  type: 'debit' | 'credit';
  reference?: string;
  merchant?: string;
  balance?: number;
  source: 'bank' | 'upi';
  rawSender: string;
  accountLast4?: string;
  cardLast4?: string;
  upiId?: string;
}

export interface ProcessorResult {
  transactionId: string | null;
  type: string;
  note: string;
  amount: number;
  accountLast4?: string;
  rawSms?: string;
  skipped: boolean;
  classificationOptions?: {
    classificationStatus?: 'manual_confirmed' | 'review_required' | 'ignored' | null;
    classificationReason?: string | null;
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// CONFIGURATION
// ═══════════════════════════════════════════════════════════════════════════════

// Allowed app packages for notification processing
const ALLOWED_PACKAGES = [
  'com.google.android.apps.nbu.paisa.user', // Google Pay
  'com.phonepe.app', // PhonePe
  'tech.ula', // Slice (legacy)
  'indwin.c3.shareapp', // Slice (actual)
  'com.dreamplug.androidapp', // CRED
  'in.amazon.mShop.android.shopping', // Amazon Pay
  'net.one97.paytm', // Paytm
  'com.whatsapp', // WhatsApp (for UPI)
  'money.super.app', // Super.money
  'money.super.payments', // Super.money (current Play package)
  'com.spendsense', // Test notifications
  // Bank apps - push notification capture
  'com.kotak.mahindra.kotakbanking', // Kotak Bank
  'com.snapwork.hdfc', // HDFC MobileBanking
  'com.csam.icici.bank.imobile', // ICICI iMobile
  'com.axis.mobile', // Axis Mobile
  'com.sbi.SBIFreedomPlus', // SBI YONO
  'com.idfcfirstbank.mobilebanking', // IDFC First Bank
  'com.yesbank', // Yes Bank
  'com.induslnd.mobilebanking', // IndusInd Bank
  'com.fbl', // Federal Bank
];

const PACKAGE_TO_SENDER: { [key: string]: string } = {
  'com.google.android.apps.nbu.paisa.user': 'GPAYID',
  'com.phonepe.app': 'PHONEPE',
  'tech.ula': 'SLICE',
  'indwin.c3.shareapp': 'SLICE',
  'com.dreamplug.androidapp': 'CRED',
  'in.amazon.mShop.android.shopping': 'AMAZONP',
  'net.one97.paytm': 'PAYTMB',
  'com.whatsapp': 'WHATSAP',
  'money.super.app': 'SUPERM',
  'money.super.payments': 'SUPERM',
  'com.spendsense': 'TEST',
  'com.kotak.mahindra.kotakbanking': 'KOTAK',
  'com.snapwork.hdfc': 'HDFC',
  'com.csam.icici.bank.imobile': 'ICICIB',
  'com.axis.mobile': 'AXISBK',
  'com.sbi.SBIFreedomPlus': 'SBIINB',
  'com.idfcfirstbank.mobilebanking': 'IDFCFB',
  'com.yesbank': 'YESBNK',
  'com.induslnd.mobilebanking': 'INDBNK',
  'com.fbl': 'FEDBK',
};

const BANK_SENDERS = [
  'HDFC', 'ICICI', 'ICICIB', 'SBI', 'SBIINB', 'AXIS', 'AXISBK', 'KOTAK', 'PNB',
  'SCBANK', 'YESBNK', 'INDBNK', 'IDFCFB', 'FEDBK', 'UNIONB', 'UTKARSH', 'UTKSPR', 'UTKSFB', 'SFBL', 'BOB', 'SLCBNK'
];

const UPI_SENDERS = [
  'PAYTMB', 'GPAYID', 'PHONEPE', 'BHARTP', 'AMAZONP', 'WHATSAP',
  'MOBIKW', 'FREECHARGE', 'PAYZAPP', 'SLCEIT', 'SLICE', 'CRED', 'SUPERM', 'TEST',
  // Investment platforms (SEBI-regulated, send fund transfer confirmations via SMS)
  'INDDEM', 'INDMNY', 'GROWW', 'ZERODHA', 'KUVERA', 'FISDOM', 'ANGELB', 'UPSTOX',
  'NSDL', 'BSEINV', 'MFUINV', 'CAMSINV', 'KARVY',
];

const BLOCKED_SENDERS = ['TEST', 'TEST-SMS', 'DM-TEST', 'VM-TEST'];
const TRAI_DLT_PREFIXES = ['JM-', 'BT-', 'AD-', 'VM-', 'DM-', 'TM-', 'AM-', 'LM-'];

const NON_TRANSACTION_AMOUNT_PATTERNS = [
  /(?:send|transfer)\s+(?:up\s*to|upto)\s+(?:INR|Rs\.?|₹)\s*[0-9,]+/i,
  /(?:up\s*to|upto|starting\s+from|starts?\s+at|as\s+low\s+as)\s+(?:INR|Rs\.?|₹)\s*[0-9,]+/i,
  /(?:INR|Rs\.?|₹)\s*[0-9,]+(?:\.\d{1,2})?\s*(?:off|discount|coupon|voucher|reward)/i,
  /(?:get|save|earn|win|claim|unlock)\s+(?:up\s*to|upto|flat)?\s*(?:INR|Rs\.?|₹)\s*[0-9,]+/i,
  /(?:offer|deal|discount|sale|promo|coupon|voucher|reward)\b/i,
  /(?:free\s+cancellation|book\s+(?:train|flight|bus|hotel|ticket)|travel|trip|holiday)/i,
  /\b(?:t20\s+vibes|kaafi\s+hai)\b/i,
  /(?:add(?:ed|ing)?|beneficiary|payee).*?(?:send|transfer).*?(?:up\s*to|upto|limit|first\s+\d+\s*(?:hrs?|hours?|days?))/i,
  /(?:\d+\s*(?:mins?|minutes?|hrs?|hours?)\s+have\s+passed).*?(?:add(?:ed|ing)?|payee|beneficiary)/i,
];

const COMPLETED_TRANSACTION_PATTERNS = [
  /\b(?:debited|credited|deducted|spent|withdrawn|withdrawal|purchased?|paid|received|deposited|refunded|transferred|sent)\b/i,
  /\b(?:dr|cr)\.?\s*(?:INR|Rs\.?|₹)?\s*[0-9,]+/i,
  /\bpayment\s+(?:of\s+)?(?:INR|Rs\.?|₹)?\s*[0-9,]+(?:\.\d{1,2})?\s+(?:made|successful|completed|done|received)/i,
  /\b(?:payment|transaction|txn)\s+(?:successful|completed|done|failed|declined)\b/i,
  /you'?ve\s+got\s+(?:INR|Rs\.?|₹)\s*[0-9,]+.*\bfrom\b/i,
];

const TRANSACTION_CONTEXT_PATTERNS = [
  /\b(?:a\/?c|acct|account|card|supercard|upi|utr|ref(?:erence)?\s*(?:no|id)?|txn|transaction\s+id)\b/i,
  /\b(?:avl|available|current|closing)\s+bal(?:ance)?\b/i,
  /\b(?:to|from|at)\s+[a-zA-Z0-9._-]+@[a-zA-Z0-9.-]+\b/i,
];

const FINANCIAL_EVENT_DEBUG =
  typeof __DEV__ === 'undefined' ? true : __DEV__;

type EventDebugDetails = {
  sourceKind: 'sms' | 'notification';
  direction?: 'credit' | 'debit';
  amount?: number;
  accountLast4?: string;
  cardLast4?: string;
  routeDecision?: string;
  reasonCode?: string;
  eventIdSuffix?: string;
};

// ═══════════════════════════════════════════════════════════════════════════════
// SHARED HELPER FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════════

function isBlockedSender(sender: string): boolean {
  const upperSender = sender.toUpperCase();
  return BLOCKED_SENDERS.some(blocked => upperSender.includes(blocked));
}

function summarizeSenderForLog(sender?: string | null) {
  const value = sender?.trim() || '';
  const compactValue = value.replace(/[\s()-]/g, '');
  const senderKind = !value
    ? 'missing'
    : /^\+?\d{6,}$/.test(compactValue)
      ? 'phone_like'
      : /^[A-Za-z]{2}-/.test(value)
        ? 'dlt_prefixed'
        : /^[A-Za-z0-9_-]+$/.test(value)
          ? 'token'
          : 'other';

  return {
    senderPresent: Boolean(value),
    senderKind,
  };
}

function isLegitimateFinancialSender(sender: string): boolean {
  if (/^[A-Za-z]{2}-/.test(sender)) return true;
  const upperSender = sender.toUpperCase();
  const isWhitelisted = BANK_SENDERS.some(bank => upperSender.includes(bank)) ||
                       UPI_SENDERS.some(upi => upperSender.includes(upi));
  if (isWhitelisted) return true;
  return TRAI_DLT_PREFIXES.some(prefix => upperSender.startsWith(prefix));
}

function identifySource(sender: string, body = ''): 'bank' | 'upi' | 'unknown' {
  const upperSender = sender.toUpperCase();
  if (BANK_SENDERS.some(bank => upperSender.includes(bank))) return 'bank';
  if (UPI_SENDERS.some(upi => upperSender.includes(upi))) return 'upi';

  const upperBody = body.toUpperCase();
  if (BANK_SENDERS.some(bank => upperBody.includes(bank))) return 'bank';

  // Fallback: if body mentions bank account/transfer keywords, treat as upi-like
  // so parseTransaction() can attempt to parse it (investment platform payouts, etc.)
  if (
    /\b(?:account|a\/c|bank\s+account|registered\s+bank)\b/i.test(body) &&
    /\b(?:transferred|credited|refund|payout|settlement|neft|imps|rtgs)\b/i.test(body)
  ) {
    if (__DEV__) console.log('[IdentifySource] Fallback: body matches bank-payout pattern, treating as upi');
    return 'upi';
  }

  if (__DEV__ && hasAmount(body)) {
    console.warn('[IdentifySource] Unknown sender with amount — check sender lists', {
      senderPresent: Boolean(sender),
    });
  }

  return 'unknown';
}

function extractAccountLast4(body: string): string | undefined {
  const accountPatterns = [
    /(?:A\/?C|Acct|Account)\s*(?:ending\s*(?:with\s*)?|no\.?|number)?\s*[-:xX* ]*\s*(\d{3,5})/i,
    /(?:credited|debited|deposited|transferred)\s+(?:to|from|into)\s+(?:your\s+)?(?:[A-Za-z]+\s+Bank\s+)?(?:A\/?C|Acct|Account\s*)?(?:x{1,}|\*{2,})\s*(\d{3,5})/i,
  ];
  for (const pattern of accountPatterns) {
    const match = body.match(pattern);
    if (match) return match[1];
  }
  return undefined;
}

function extractCreditCardLast4(body: string): string | undefined {
  const cardPatterns = [
    /\b(?:credit\s*)?card\b[^.]{0,48}?\b(?:ending|ended)\s*(?:with\s*)?[-:xX* ]*(\d{4})\b/i,
    /\b(?:credit\s*)?card(?:\s*(?:no\.?|number))?\s*(?:xx|x{2,}|[*]+)\s*(\d{4})\b/i,
    /\bcc\b[^.]{0,32}?\b(?:ending|ended|xx|x{2,}|[*]+)\s*(?:with\s*)?[-:xX* ]*(\d{4})\b/i,
  ];
  for (const pattern of cardPatterns) {
    const match = body.match(pattern);
    if (match) return match[1];
  }
  return undefined;
}

function isNumericUpiId(str: string): boolean {
  return /^\d+$/.test(str.trim());
}

function hasAmount(body: string): boolean {
  return /(?:INR|Rs\.?:|Rs\.?|₹)\s*[0-9,]+(?:\.[0-9]{1,2})?/i.test(body) ||
    /(?:amount|amt|paid|debited|credited|received|deducted|spent|withdrawn|sent|transferred)\s*(?:of|:)?\s*(?:INR|Rs\.?:|Rs\.?|₹)?\s*[0-9,]+(?:\.[0-9]{1,2})?/i.test(body);
}

function isNonTransactionalAmountMention(body: string): boolean {
  return NON_TRANSACTION_AMOUNT_PATTERNS.some(pattern => pattern.test(body));
}

function hasCompletedTransactionEvidence(body: string): boolean {
  return COMPLETED_TRANSACTION_PATTERNS.some(pattern => pattern.test(body));
}

function hasTransactionContext(body: string): boolean {
  return TRANSACTION_CONTEXT_PATTERNS.some(pattern => pattern.test(body));
}

function shouldAttemptTransactionParse(body: string): boolean {
  if (!hasAmount(body)) return false;

  const hasCompletedAction = hasCompletedTransactionEvidence(body);
  if (hasCompletedAction) return true;
  if (isNonTransactionalAmountMention(body)) return false;
  return hasTransactionContext(body);
}

function normalizeComparableText(value?: string | null): string {
  return (value || '').trim().replace(/\s+/g, ' ').toLowerCase();
}

function isSameUnreferencedTransaction(
  existingTxn: any,
  rawText?: string,
  merchant?: string
): boolean {
  const existingRaw = normalizeComparableText(existingTxn?.raw_sms);
  const incomingRaw = normalizeComparableText(rawText);
  if (existingRaw && incomingRaw && existingRaw === incomingRaw) return true;

  const incomingMerchant = normalizeComparableText(merchant);
  if (!incomingMerchant) return !incomingRaw;

  return [existingTxn?.note, existingTxn?.category]
    .map(normalizeComparableText)
    .some(value => value === incomingMerchant);
}

function isDuplicateInsertError(error: unknown): boolean {
  return typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: string }).code === '23505';
}

function normalizeNotificationPayload(taskData: any): {
  app: string;
  title?: string;
  text?: string;
  bigText?: string;
  summaryText?: string;
  subText?: string;
  time?: number;
} {
  if (typeof taskData?.notification === 'string') {
    const parsed = JSON.parse(taskData.notification);
    return {
      app: parsed.app || parsed.packageName || '',
      title: parsed.title || '',
      text: parsed.text || parsed.body || '',
      bigText: parsed.bigText || parsed.titleBig || '',
      summaryText: parsed.summaryText || '',
      subText: parsed.subText || parsed.extraInfoText || '',
      time: parsed.time || parsed.timestamp,
    };
  }

  return {
    app: taskData?.app || taskData?.packageName || '',
    title: taskData?.title || '',
    text: taskData?.text || taskData?.body || '',
    bigText: taskData?.bigText || taskData?.titleBig || '',
    summaryText: taskData?.summaryText || '',
    subText: taskData?.subText || taskData?.extraInfoText || '',
    time: taskData?.time || taskData?.timestamp,
  };
}

function getNotificationPayloadLength(taskData: any): number {
  if (typeof taskData?.notification === 'string') {
    return taskData.notification.length;
  }

  try {
    return JSON.stringify(taskData ?? {}).length;
  } catch {
    return 0;
  }
}

function summarizeNotificationForLog(notif: {
  app: string;
  title?: string;
  text?: string;
  bigText?: string;
  summaryText?: string;
  subText?: string;
  time?: number;
}) {
  return {
    app: notif.app,
    titleLength: notif.title?.length ?? 0,
    textLength: notif.text?.length ?? 0,
    bigTextLength: notif.bigText?.length ?? 0,
    summaryTextLength: notif.summaryText?.length ?? 0,
    subTextLength: notif.subText?.length ?? 0,
    time: notif.time,
  };
}

function summarizeParsedTransactionForLog(parsed: ParsedTransaction) {
  return {
    type: parsed.type,
    source: parsed.source,
    amountPresent: Number.isFinite(parsed.amount),
    balancePresent: parsed.balance !== undefined,
    referencePresent: Boolean(parsed.reference),
    merchantPresent: Boolean(parsed.merchant),
    accountLast4Present: Boolean(parsed.accountLast4),
    cardLast4Present: Boolean(parsed.cardLast4),
    upiIdPresent: Boolean(parsed.upiId),
  };
}

function safeErrorCode(error: unknown): string {
  if (!error || typeof error !== 'object') return 'unknown_error';
  const value = (error as { code?: unknown; name?: unknown; status?: unknown }).code
    || (error as { name?: unknown }).name
    || (error as { status?: unknown }).status;
  return typeof value === 'string' || typeof value === 'number'
    ? String(value).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 48) || 'unknown_error'
    : 'unknown_error';
}

function suffixId(value?: string | null): string | undefined {
  const safe = value?.replace(/[^A-Za-z0-9_:-]/g, '');
  if (!safe) return undefined;
  return safe.slice(-12);
}

function normalizeNameParts(value?: string | null): string[] {
  return (value || '')
    .toLowerCase()
    .replace(/[^a-z\s.'-]+/g, ' ')
    .split(/\s+/)
    .map(part => part.replace(/[^a-z]+/g, ''))
    .filter(part => part.length >= 2)
    .sort();
}

function sameNameTokenSet(left?: string | null, right?: string | null): boolean {
  const leftParts = normalizeNameParts(left);
  const rightParts = normalizeNameParts(right);
  if (leftParts.length >= 1 && rightParts.length >= 1) {
    const hasStrongEmbeddedMatch = leftParts.some(leftPart =>
      rightParts.some(rightPart =>
        leftPart.length >= 5 &&
        rightPart.length >= 5 &&
        (leftPart.includes(rightPart) || rightPart.includes(leftPart))
      )
    );
    if (hasStrongEmbeddedMatch) return true;
  }

  if (leftParts.length < 2 || rightParts.length < 2) return false;
  if (leftParts.length !== rightParts.length) return false;
  return leftParts.every((part, index) => part === rightParts[index]);
}

async function getProfileNameForSelfMatch(userId: string): Promise<string | null> {
  try {
    const { data, error } = await supabase
      .from('profiles')
      .select('full_name')
      .eq('id', userId)
      .single();

    if (error) {
      if (__DEV__) console.warn('[SelfTransferPairing] Profile lookup unavailable', {
        errorCode: safeErrorCode(error),
      });
      return null;
    }

    return typeof data?.full_name === 'string' ? data.full_name : null;
  } catch (error) {
    if (__DEV__) console.warn('[SelfTransferPairing] Profile lookup failed', {
      errorCode: safeErrorCode(error),
    });
    return null;
  }
}

async function isCurrentUserCounterparty(userId: string, parsed: ParsedTransaction): Promise<boolean> {
  if (!parsed.merchant) return false;
  const profileName = await getProfileNameForSelfMatch(userId);
  return sameNameTokenSet(parsed.merchant, profileName);
}

function eventDebugLog(message: string, details: Record<string, unknown>): void {
  if (!FINANCIAL_EVENT_DEBUG) return;
  if (__DEV__) console.log(message, details);
}

function eventDebugWarn(message: string, details: Record<string, unknown>): void {
  if (!FINANCIAL_EVENT_DEBUG) return;
  if (__DEV__) console.warn(message, details);
}

async function resolveAutomaticPolicy(input: {
  userId: string;
  parsed: ParsedTransaction;
  text: string;
  sourceKind: 'sms' | 'notification';
}): Promise<ReturnType<typeof getAutomaticTransactionPolicy> & { sameUserNameMatch?: boolean }> {
  const sameUserNameMatch = await isCurrentUserCounterparty(input.userId, input.parsed);
  if (sameUserNameMatch) {
    eventDebugLog('[SelfTransferPairing] Policy check', {
      sourceKind: input.sourceKind,
      amount: input.parsed.amount,
      direction: input.parsed.type,
      accountLast4: input.parsed.accountLast4,
      sameUserNameMatch: true,
      pairedEvidenceFound: false,
      routeDecision: 'post_transfer',
      reasonCode: 'self_transfer',
    });
    return {
      action: 'post',
      type: 'transfer',
      accountMatchStatus: 'ignored',
      accountMatchReason: 'self_transfer',
      accountMatchConfidence: 'high',
      sameUserNameMatch,
    };
  }

  const policy = getAutomaticTransactionPolicy(input.parsed.type, input.text);
  eventDebugLog('[SelfTransferPairing] Policy check', {
    sourceKind: input.sourceKind,
    amount: input.parsed.amount,
    direction: input.parsed.type,
    accountLast4: input.parsed.accountLast4,
    sameUserNameMatch: false,
    pairedEvidenceFound: false,
    routeDecision: 'stored_transaction',
    reasonCode: policy.type,
  });
  return { ...policy, sameUserNameMatch };
}

function transactionClassificationFields(
  policy: ReturnType<typeof getAutomaticTransactionPolicy> & { sameUserNameMatch?: boolean }
) {
  return {
    account_match_status: policy.accountMatchStatus,
    account_match_reason: policy.accountMatchReason,
    ...(policy.accountMatchConfidence ? { account_match_confidence: policy.accountMatchConfidence } : {}),
  };
}

function notificationClassificationOptions(input: {
  dbType: 'expense' | 'income' | 'transfer';
  policy: ReturnType<typeof getAutomaticTransactionPolicy> & { sameUserNameMatch?: boolean };
  upgradedTransfer?: boolean;
}) {
  if (input.dbType === 'transfer') {
    return {
      classificationStatus: 'ignored' as const,
      classificationReason: input.upgradedTransfer ? 'self_transfer' : input.policy.accountMatchReason,
    };
  }

  return {
    classificationStatus: input.policy.accountMatchStatus,
    classificationReason: input.policy.accountMatchReason,
  };
}

type TransferPatch = {
  type: 'transfer';
  note: string;
  category: 'Transfers';
  account_id: string | null;
  from_account_id: string | null;
  to_account_id: string | null;
  is_transfer_pending: true;
};

async function getBankAccountName(userId: string, accountId?: string | null): Promise<string | null> {
  if (!accountId) return null;

  try {
    const { data, error } = await supabase
      .from('bank_accounts')
      .select('bank_name')
      .eq('id', accountId)
      .eq('user_id', userId)
      .single();

    if (error) return null;
    return typeof data?.bank_name === 'string' && data.bank_name.trim()
      ? data.bank_name.trim()
      : null;
  } catch {
    return null;
  }
}

async function buildPendingTransferPatch(input: {
  userId: string;
  incomingType: ParsedTransaction['type'];
  incomingAccountId?: string | null;
  existing?: Partial<Transaction> | null;
}): Promise<TransferPatch> {
  let fromAccountId = input.existing?.from_account_id || null;
  let toAccountId = input.existing?.to_account_id || null;

  if (!fromAccountId && input.existing?.type === 'expense') {
    fromAccountId = input.existing.account_id || null;
  }
  if (!toAccountId && input.existing?.type === 'income') {
    toAccountId = input.existing.account_id || null;
  }

  if (input.incomingType === 'debit' && input.incomingAccountId) {
    fromAccountId = input.incomingAccountId;
  }
  if (input.incomingType === 'credit' && input.incomingAccountId) {
    toAccountId = input.incomingAccountId;
  }

  const fromName = await getBankAccountName(input.userId, fromAccountId);
  const toName = await getBankAccountName(input.userId, toAccountId);
  const routeName = fromName && toName ? `${fromName} to ${toName}` : 'Bank to Bank';

  return {
    type: 'transfer',
    note: routeName,
    category: 'Transfers',
    account_id: fromAccountId || toAccountId || input.existing?.account_id || input.incomingAccountId || null,
    from_account_id: fromAccountId,
    to_account_id: toAccountId,
    is_transfer_pending: true,
  };
}

function safeEventDetails(input: {
  sourceKind: 'sms' | 'notification';
  parsed?: ParsedTransaction | null;
  routeDecision?: string;
  reasonCode?: string;
  eventId?: string | null;
}) {
  return {
    sourceKind: input.sourceKind,
    direction: input.parsed?.type,
    amount: input.parsed?.amount,
    accountLast4: input.parsed?.accountLast4,
    cardLast4: input.parsed?.cardLast4,
    routeDecision: input.routeDecision,
    reasonCode: input.reasonCode,
    eventIdSuffix: suffixId(input.eventId),
  };
}

function recordSmsEvidenceWithDebug(
  input: Parameters<typeof recordSmsTransactionEvidence>[0],
  details: EventDebugDetails
): void {
  eventDebugLog('[AutoTransactionDebug] Evidence write attempted', {
    ...details,
    sourceKind: 'sms',
  });
  void recordSmsTransactionEvidence(input)
    .then(status => eventDebugLog('[AutoTransactionDebug] Evidence write completed', {
      ...details,
      sourceKind: 'sms',
      status,
    }))
    .catch(error => eventDebugWarn('[AutoTransactionDebug] Evidence write failed', {
      ...details,
      sourceKind: 'sms',
      errorCode: safeErrorCode(error),
    }));
}

function recordNotificationEvidenceWithDebug(
  input: Parameters<typeof recordNotificationTransactionEvidence>[0],
  details: EventDebugDetails
): void {
  eventDebugLog('[AutoTransactionDebug] Evidence write attempted', {
    ...details,
    sourceKind: 'notification',
  });
  void recordNotificationTransactionEvidence(input)
    .then(status => eventDebugLog('[AutoTransactionDebug] Evidence write completed', {
      ...details,
      sourceKind: 'notification',
      status,
    }))
    .catch(error => eventDebugWarn('[AutoTransactionDebug] Evidence write failed', {
      ...details,
      sourceKind: 'notification',
      errorCode: safeErrorCode(error),
    }));
}

function hashFromRedactedRawText(value: string): string | null {
  return value.match(/\bhash=([a-f0-9]{8,64})\b/i)?.[1]?.toLowerCase() || null;
}



// ═══════════════════════════════════════════════════════════════════════════════
// TRANSACTION PARSING
// ═══════════════════════════════════════════════════════════════════════════════

function parseTransaction(body: string, sender: string): ParsedTransaction | null {
  try {
    const source = identifySource(sender, body);
    if (source === 'unknown') {
      if (__DEV__) console.warn('[ParseTransaction] Skipped: source unknown — sender not in BANK/UPI lists');
      return null;
    }

    if (!shouldAttemptTransactionParse(body)) return null;

    // Extract amount
    const amountPatterns = [
      /^(?:INR|Rs\.?:|Rs\.?|₹)\s*([0-9,]+(?:\.[0-9]{2})?)/i,
      /(?:INR|Rs\.?:|Rs\.?|₹)\s*([0-9,]+(?:\.[0-9]{2})?)/i,
      /(?:amount|amt)[\s:]*(?:INR|Rs\.?:|Rs\.?|₹)?\s*([0-9,]+(?:\.[0-9]{2})?)/i,
      /(?:debited|credited|paid|received|deducted|spent|withdrawn|sent|transferred)[\s:]*(?:INR|Rs\.?:|Rs\.?|₹)?\s*([0-9,]+(?:\.[0-9]{2})?)/i,
    ];

    let amount = 0;
    for (const pattern of amountPatterns) {
      const match = body.match(pattern);
      if (match) {
        amount = parseFloat(match[1].replace(/,/g, ''));
        break;
      }
    }
    if (amount === 0) return null;

    // Special case: "transferred to your account" = credit (incoming)
    const isTransferredToAccount = /transferred\s+to\s+(?:your\s+)?(?:account|a\/c|bank)/i.test(body);

    // Priority 1: Explicit debit keywords (strongest signal)
    let type: 'debit' | 'credit';
    if (/\bdebited\b/i.test(body) || /\bdr\.?\s/i.test(body) || /\bdeducted\b/i.test(body)) {
      type = 'debit';
    }
    // Priority 2: Explicit credit keywords
    else if (/\bcredited\b/i.test(body) || /\bcr\.?\s/i.test(body)) {
      type = 'credit';
    }
    // Priority 3: Semantic credit signals
    else if (
      /paid\s+(?:to\s+)?you/i.test(body) ||
      /you'?ve\s+got/i.test(body) ||
      /\breceived\b/i.test(body) ||
      /\bdeposited\b/i.test(body) ||
      /\brefund\b/i.test(body) ||
      isTransferredToAccount
    ) {
      type = 'credit';
    }
    // Priority 4: Semantic debit signals
    else if (
      /\bspent\b/i.test(body) ||
      /\bwithdrawn\b/i.test(body) ||
      /\bpurchased?\b/i.test(body) ||
      /\bsent\b/i.test(body) ||
      (/\btransferred\b/i.test(body) && !isTransferredToAccount) ||
      /\bpayment\s+(?:of\s+)?(?:INR|Rs\.?:|Rs\.?|₹)?\s*[0-9,]+(?:\.\d{1,2})?\s+(?:made|successful|completed|done)\b/i.test(body) ||
      /\bpaid\b/i.test(body)
    ) {
      type = 'debit';
    }
    // Priority 5: Cannot determine
    else {
      return null;
    }

    // Extract reference
    const refPatterns = [
      /\b(?:UPI\s*Ref(?:erence)?|UTR|RRN|Ref(?:erence)?|Transaction ID|TXN ID)\s*(?:no\.?|number|id)?\s*[:#-]?\s*([A-Z0-9]{6,})\b/i,
      /\bUPI\s+transaction\s+reference\s+no\.?\s*[:#-]?\s*([A-Z0-9]{6,})\b/i,
      /(?:for\s+)?UPI\s*-?\s*(\d{6,})/i,
      /\b(?:UPI ID|UPI)\s*[:#-]?\s*([A-Z0-9]{6,})\b/i,
    ];
    let reference: string | undefined;
    for (const pattern of refPatterns) {
      const match = body.match(pattern);
      if (match && !/^(?:NO|ID|REF)$/i.test(match[1])) {
        reference = match[1];
        break;
      }
    }

    // Extract merchant
    const merchantPatterns = [
      /^([A-Za-z0-9\s&/.!@#$-]+?)\s+paid\s+(?:to\s+)?you\s+(?:INR|Rs\.?|₹)/i,
      /;\s*([A-Za-z0-9\s&]+?)\s+credited/i,
      /You'?ve\s+got\s+(?:INR|Rs\.?|₹)[0-9,.]+ from\s+([A-Za-z\s]+?)(?:\s+in\s+your|\s+to\s+your|\s+on|\.|$)/i,
      /(?:received from|from)\s+([A-Z][A-Za-z\s]+?)(?:\s+deposited\s+into|\s+in\s+your|\s+to\s+your|\s+on\s+\d|\.|$)/i,
      /(?:received from|from)\s+([A-Z][A-Za-z\s]+?)(?:\s+in\s+your|\s+to\s+your|\s+on\s+\d|\.|$)/i,
      /(?:at|made at|for)\s+([A-Za-z0-9\s&]+?)(?:\s+using|\s+on|\.|$)/i,
      /(?:to)\s+([A-Z][A-Za-z\s&]+?)(?:\s*\(UPI Ref)/i,
      /(?:to|from|paid to|sent to)\s+(?!view\b)([a-zA-Z0-9.-]+@[a-zA-Z0-9.-]+|[A-Za-z0-9\s&]+?)(?:\s+on|\s+via|[\s(]+UPI|\s+to A\/c|\s+in\s+your|\.|$)/i,
      /(?:paid to|sent to|received from)\s+(?!view\b)([A-Za-z0-9\s&]+?)(?:\s+on|\s+via|\s+to A\/c|\.|$)/i,
      /Info[:\s]*([A-Z0-9*/]+?)(?:\.|\s|$)/i,
    ];
    let merchant: string | undefined;
    for (const pattern of merchantPatterns) {
      const match = body.match(pattern);
      if (match) {
        merchant = match[1].trim();
        break;
      }
    }
    if (merchant && isNumericUpiId(merchant)) {
      merchant = 'UPI Payment';
    }

    // Extract balance
    const balancePattern = /(?:balance|bal|avbl bal)[\s:]*(?:INR|Rs\.?|₹)?\s*([0-9,]+(?:\.[0-9]{2})?)/i;
    const balanceMatch = body.match(balancePattern);
    const balance = balanceMatch ? parseFloat(balanceMatch[1].replace(/,/g, '')) : undefined;

    const accountLast4 = extractAccountLast4(body);
    const cardLast4 = extractCreditCardLast4(body);
    const upiId = extractUpiIdFromText(body) || undefined;

    return { amount, type, reference, merchant, balance, source, rawSender: sender, accountLast4, cardLast4, upiId };
  } catch (error) {
    if (__DEV__) console.error('Error parsing transaction:', error);
    return null;
  }
}

export function dryRunParseTransaction(body: string, sender: string): {
  parsed: ParsedTransaction | null;
  source: 'bank' | 'upi' | 'unknown';
  wouldAttemptParse: boolean;
} {
  const source = identifySource(sender, body);
  const wouldAttemptParse = source !== 'unknown' && shouldAttemptTransactionParse(body);
  const parsed = wouldAttemptParse ? parseTransaction(body, sender) : null;
  return { parsed, source, wouldAttemptParse };
}

// ═══════════════════════════════════════════════════════════════════════════════
// DATABASE OPERATIONS
// ═══════════════════════════════════════════════════════════════════════════════

async function checkForDuplicates(
  userId: string,
  amount: number,
  timestamp: number,
  type: 'expense' | 'income' | 'transfer',
  referenceNumber?: string,
  smsSource?: 'bank' | 'upi',
  rawText?: string,
  merchant?: string
): Promise<any | null> {
  try {
    const oneMinuteAgo = new Date(timestamp - 1 * 60 * 1000).toISOString();
    const fiveMinutesAgo = new Date(timestamp - 5 * 60 * 1000).toISOString();

    if (referenceNumber) {
      const { data: referenceData, error: referenceError } = await supabase
        .from('transactions')
        .select('id, type, account_id, account_last4, sms_source, reference_number, raw_sms, note, category, from_account_id, to_account_id')
        .eq('user_id', userId)
        .eq('amount', amount)
        .eq('type', type)
        .eq('reference_number', referenceNumber)
        .order('created_at', { ascending: false })
        .limit(1);

      if (!referenceError && referenceData && referenceData.length > 0) {
        return referenceData[0];
      }
    } else if (rawText) {
      const { data: rawData, error: rawError } = await supabase
        .from('transactions')
        .select('id, type, account_id, account_last4, sms_source, reference_number, raw_sms, note, category, from_account_id, to_account_id')
        .eq('user_id', userId)
        .eq('amount', amount)
        .eq('type', type)
        .is('reference_number', null)
        .eq('raw_sms', rawText)
        .order('created_at', { ascending: false })
        .limit(1);

      if (!rawError && rawData && rawData.length > 0) {
        return rawData[0];
      }
    }

    // First check for very recent duplicates (within 1 minute) - these should always be skipped
    let recentQuery = supabase
      .from('transactions')
      .select('id, type, account_id, account_last4, sms_source, reference_number, raw_sms, note, category, from_account_id, to_account_id')
      .eq('user_id', userId)
      .eq('amount', amount)
      .gte('created_at', oneMinuteAgo)
      .order('created_at', { ascending: false });
    
    // Always allow cross-type matching for recent transactions (within 1 min)
    // to catch income + expense = transfer pairs.

    if (referenceNumber) {
      recentQuery = recentQuery.eq('reference_number', referenceNumber);
    } else {
      recentQuery = recentQuery.is('reference_number', null);
    }

    const { data: recentData, error: recentError } = await recentQuery.limit(referenceNumber ? 1 : 5);
    if (recentError) return null;

    if (recentData && recentData.length > 0) {
      // For transactions within 1 minute with EXACT same amount and type,
      // we aggressively deduplicate them (whether referenced or unreferenced)
      // because they are almost certainly the same event reported by different sources.
      return recentData[0];
    }

    const { data: mirrorData, error: mirrorError } = await supabase
      .from('transactions')
      .select('id, type, account_id, account_last4, sms_source, reference_number, raw_sms, note, category, from_account_id, to_account_id')
      .eq('user_id', userId)
      .eq('amount', amount)
      .gte('created_at', oneMinuteAgo)
      .order('created_at', { ascending: false })
      .limit(5);

    if (!mirrorError && mirrorData && mirrorData.length > 0) {
      // Cross-source same-type: bank SMS + UPI notification reporting same event
      // Both sources flagged AND same transaction type = same event, not a transfer pair
      const crossSourceDuplicate = mirrorData.find(existingTxn =>
        existingTxn.type === type &&
        Boolean(existingTxn.sms_source) &&
        Boolean(smsSource) &&
        existingTxn.sms_source !== smsSource
      );
      if (crossSourceDuplicate) return crossSourceDuplicate;

      const mirror = mirrorData.find(existingTxn => {
        const isOpposingMovement =
          existingTxn.type === 'transfer' ||
          (existingTxn.type === 'income' && type === 'expense') ||
          (existingTxn.type === 'expense' && type === 'income') ||
          (existingTxn.type !== 'transfer' && type === 'transfer');
        const sourceDiffers = !smsSource || !existingTxn.sms_source || existingTxn.sms_source !== smsSource;
        return isOpposingMovement && sourceDiffers;
      });
      if (mirror) return mirror;
    }

    // Then check for older duplicates (within 5 minutes) - but be less aggressive
    let query = supabase
      .from('transactions')
      .select('id, type, account_id, account_last4, sms_source, reference_number, raw_sms, note, category, from_account_id, to_account_id')
      .eq('user_id', userId)
      .eq('amount', amount)
      .gte('created_at', fiveMinutesAgo)
      .order('created_at', { ascending: false });

    if (type !== 'transfer') {
      query = query.eq('type', type);
    }

    if (referenceNumber) {
      query = query.eq('reference_number', referenceNumber);
    } else {
      query = query.is('reference_number', null);
    }

    const { data, error } = await query.limit(referenceNumber ? 1 : 5);
    if (error) return null;

    if (data && data.length > 0) {
      const existingTxn = referenceNumber
        ? data[0]
        : data.find(tx => isSameUnreferencedTransaction(tx, rawText, merchant));
      if (existingTxn) {
        // smsSource differs = same transaction reported by two different sources
        // returning existingTxn signals to caller: "this is a duplicate, skip it"
        if (smsSource && existingTxn.sms_source && smsSource !== existingTxn.sms_source) {
          return existingTxn;
        }
        return existingTxn;
      }
    }

    // Fallback: check for transactions without reference number
    if (!referenceNumber) {
      let fallbackQuery = supabase
        .from('transactions')
        .select('id, type, account_id, account_last4, sms_source, reference_number, raw_sms, note, category, from_account_id, to_account_id')
        .eq('user_id', userId)
        .eq('amount', amount)
        .gte('created_at', fiveMinutesAgo)
        .is('reference_number', null)
        .order('created_at', { ascending: false })
        .limit(1);

      if (type !== 'transfer') {
        fallbackQuery = fallbackQuery.eq('type', type);
      }

      const { data: fallbackData } = await fallbackQuery;

      if (fallbackData && fallbackData.length > 0) {
        const existingTxn = fallbackData[0];
        // smsSource differs = same transaction reported by two different sources
        // returning existingTxn signals to caller: "this is a duplicate, skip it"
        if (smsSource && existingTxn.sms_source && smsSource !== existingTxn.sms_source) {
          return existingTxn;
        }
        if (isSameUnreferencedTransaction(existingTxn, rawText, merchant)) {
          return existingTxn;
        }
      }
    }

    return null;
  } catch {
    return null;
  }
}

async function findAndSyncBankAccount(
  userId: string,
  accountLast4?: string,
  balance?: number
): Promise<string | null> {
  if (!accountLast4) return null;

  try {
    const { data } = await supabase
      .from('bank_accounts')
      .select('id')
      .eq('user_id', userId)
      .eq('account_last4', accountLast4)
      .limit(2);

    const matches = data || [];
    if (matches.length > 1) {
      if (__DEV__) console.warn('[TransactionProcessors] Ambiguous bank account match; leaving transaction unlinked', {
        matches: matches.length,
      });
      return null;
    }

    const accountId = matches[0]?.id || null;
    if (!accountId) return null;

    if (balance !== undefined && balance !== null) {
      const { data: prevData } = await supabase
        .from('bank_accounts')
        .select('balance, name, account_last4')
        .eq('id', accountId)
        .single();

      const prevBalance = prevData?.balance !== undefined ? prevData.balance : 'Unknown';
      const bankName = prevData?.name || accountLast4 || accountId;

      if (__DEV__) console.log('================================================================');
      if (__DEV__) console.log(`[BalanceSync] 💳 Bank Account: ${bankName}`);
      if (__DEV__) console.log(`[BalanceSync] 📝 Exact Balance Found in SMS/Notification`);
      if (__DEV__) console.log(`[BalanceSync] 💰 Previous Balance: ₹${prevBalance}`);
      if (__DEV__) console.log(`[BalanceSync] 💵 New Updated Balance: ₹${balance}`);
      if (__DEV__) console.log('================================================================');

      const { error } = await supabase
        .from('bank_accounts')
        .update({ balance })
        .eq('id', accountId)
        .eq('user_id', userId);

      if (error) {
        if (__DEV__) console.warn('[TransactionProcessors] Failed to sync bank balance from SMS:', error.message);
      }

      await updateCache<BankAccount[]>(CACHE_KEYS.BANK_ACCOUNTS, current =>
        current ? current.map(account => account.id === accountId ? { ...account, balance } : account) : current
      );
    }

    return accountId;
  } catch (error) {
    if (__DEV__) console.warn('[TransactionProcessors] Failed to find matched bank account:', error);
    return null;
  }
}

async function getProcessorUserId(): Promise<string | null> {
  const storedUserId = await AsyncStorage.getItem('app_user_id');
  if (!storedUserId) return null;

  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (session?.user?.id && storedUserId === session.user.id) return session.user.id;
  } catch {}

  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user?.id) {
      await AsyncStorage.removeItem('app_user_id');
      return null;
    }
    if (storedUserId && storedUserId !== user.id) {
      if (__DEV__) console.warn('[ProcessorAuth] Stale user ID in AsyncStorage — clearing. SMS halted until re-login.', {
        storedPresent: true,
        sessionPresent: true,
        mismatch: true,
      });
      await AsyncStorage.removeItem('app_user_id');
      return null;
    }
    return user.id;
  } catch {
    if (__DEV__) console.warn('[ProcessorAuth] getUser() failed — session may be expired.');
    return null;
  }
}

async function recordBalanceSignalSafely(input: {
  userId: string;
  text: string;
  senderOrPackage?: string | null;
  sourceType: 'sms' | 'notification';
  timestamp?: number;
  bankAccountIdHint?: string | null;
}): Promise<boolean> {
  try {
    const result = await recordBalanceSignalForUser(input);
    if (result.parsed.isBalanceSignal) {
      if (__DEV__) console.log('[BalanceSignal] Recorded parsed balance signal', {
        sourceType: input.sourceType,
        hash: result.parsed.redactedSource.hash,
        snapshots: result.snapshots.length,
        detectedCandidates: result.detectedCandidates.length,
        debitCards: result.debitCards.length,
        creditCardStatements: result.creditCardStatements.length,
      });
      const changed = result.snapshots.length > 0 ||
        result.detectedCandidates.length > 0 ||
        result.debitCards.length > 0 ||
        result.creditCardStatements.length > 0;
      if (changed) {
        emitFinanceDataChanged({
          areas: ['accounts', 'balances'],
          source: `${input.sourceType}:balance_signal`,
        });
      }
      return changed;
    }
  } catch (error) {
    if (__DEV__) console.warn('[BalanceSignal] Failed to record parsed balance signal', {
      sourceType: input.sourceType,
      message: error instanceof Error ? error.message : 'unknown_error',
    });
  }
  return false;
}

async function recordEstimatedBalanceMovementSafely(input: {
  userId: string;
  bankAccountId: string | null;
  parsed: ParsedTransaction;
  text: string;
  senderOrPackage: string;
  sourceType: 'sms' | 'notification';
  timestamp: number;
  reason?: 'app_mapping';
}): Promise<boolean> {
  if (!input.bankAccountId || input.parsed.balance !== undefined) return false;

  try {
    const redacted = createRedactedRawTextRecord({
      kind: input.sourceType,
      text: input.text,
      sender: input.senderOrPackage,
      source: input.parsed.source,
      app: input.sourceType === 'notification' ? input.senderOrPackage : undefined,
    });
    const snapshot = await recordEstimatedBankBalanceMovementForUser({
      userId: input.userId,
      bankAccountId: input.bankAccountId,
      amount: input.parsed.amount,
      direction: input.parsed.type,
      sourceType: input.sourceType,
      timestamp: input.timestamp,
      sourceHash: hashFromRedactedRawText(redacted),
      sourceLength: input.text.length,
      senderOrPackage: input.senderOrPackage,
      reason: input.reason,
    });

    if (snapshot) {
      if (__DEV__) console.log('[BalanceSignal] Recorded estimated balance movement', {
        sourceType: input.sourceType,
        direction: input.parsed.type,
        balanceKind: snapshot.balance_kind,
      });
      emitFinanceDataChanged({
        areas: ['balances'],
        source: `${input.sourceType}:balance_estimate`,
      });
      return true;
    }
  } catch (error) {
    if (__DEV__) console.warn('[BalanceSignal] Failed to record estimated balance movement', {
      sourceType: input.sourceType,
      message: error instanceof Error ? error.message : 'unknown_error',
    });
  }

  return false;
}

async function resolvePaymentAppBankAccountSafely(input: {
  userId: string;
  text: string;
  sourcePackage: string;
}): Promise<PaymentAppBankAccountMatch | null> {
  try {
    return await resolvePaymentAppBankAccountForUser(input);
  } catch {
    if (__DEV__) console.warn('[PaymentAppMapping] Failed to resolve account hint', {
      sourcePackagePresent: Boolean(input.sourcePackage),
    });
    return null;
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// SMS PROCESSOR
// ═══════════════════════════════════════════════════════════════════════════════

export const processSms = async (
  taskData: SmsData
): Promise<ProcessorResult | void> => {
  if (__DEV__) console.log('SMS Processor Started', {
    sender: summarizeSenderForLog(taskData.sender),
    bodyLength: taskData.body?.length ?? 0,
    timestamp: taskData.timestamp,
  });

  try {
    if (isBlockedSender(taskData.sender)) {
      if (__DEV__) console.log('⛔ Blocked sender - skipping:', summarizeSenderForLog(taskData.sender));
      return;
    }

    if (!isLegitimateFinancialSender(taskData.sender)) {
      if (__DEV__) console.log('⛔ Non-financial sender - skipping:', summarizeSenderForLog(taskData.sender));
      return;
    }

    if (isSpamMessage(taskData.body)) {
      if (__DEV__) console.log('⚠️ Spam SMS - skipping');
      return;
    }

    const userId = await getProcessorUserId();
    if (!userId) {
      if (__DEV__) console.log('No user ID found');
      return;
    }

    const balanceChanged = await recordBalanceSignalSafely({
      userId,
      text: taskData.body,
      senderOrPackage: taskData.sender,
      sourceType: 'sms',
      timestamp: taskData.timestamp,
    });

    const parsed = parseTransaction(taskData.body, taskData.sender);
    if (!parsed) {
      if (__DEV__) console.log('SMS not recognized as financial transaction');
      eventDebugLog('[AutoTransactionDebug] Route decision', {
        sourceKind: 'sms',
        routeDecision: balanceChanged ? 'balance_only' : 'ignored',
        reasonCode: balanceChanged ? 'balance_signal_recorded' : 'parse_failed',
      });
      if (balanceChanged) {
        void showFinancialEventNotification({
          route: 'balance_only',
          sourceKind: 'sms',
          eventId: `${taskData.timestamp}`,
        });
      }
      return;
    }

    if (__DEV__) console.log('Parsed Transaction:', summarizeParsedTransactionForLog(parsed));

    const automaticPolicy = await resolveAutomaticPolicy({
      userId,
      parsed,
      text: taskData.body,
      sourceKind: 'sms',
    });


    // Check for duplicates
    let dbType = automaticPolicy.type;
    const resultClassificationOptions = (
      resultType: 'expense' | 'income' | 'transfer',
      upgradedTransfer = false
    ) => notificationClassificationOptions({
      dbType: resultType,
      policy: automaticPolicy,
      upgradedTransfer,
    });
    const redactedRawSms = createRedactedRawTextRecord({
      kind: 'sms',
      text: taskData.body,
      sender: parsed.rawSender,
      source: parsed.source,
    });
    const matchedAccountId = await findAndSyncBankAccount(userId, parsed.accountLast4, parsed.balance);
    void recordEstimatedBalanceMovementSafely({
      userId,
      bankAccountId: matchedAccountId,
      parsed,
      text: taskData.body,
      senderOrPackage: taskData.sender,
      sourceType: 'sms',
      timestamp: taskData.timestamp,
    });

    const duplicate = await checkForDuplicates(
      userId,
      parsed.amount,
      taskData.timestamp,
      dbType,
      parsed.reference,
      parsed.source,
      redactedRawSms,
      parsed.merchant
    );

    let transactionId: string | null = null;
    let isUpgradedTransfer = false;
    let currentTransferPatch: TransferPatch | null = null;
    let confirmationAccountLast4 = parsed.accountLast4;

    if (duplicate) {
      if (duplicate.type === 'transfer') {
        const transferPatch = await buildPendingTransferPatch({
          userId,
          incomingType: parsed.type,
          incomingAccountId: matchedAccountId,
          existing: duplicate as Partial<Transaction>,
        });
        await supabase
          .from('transactions')
          .update({
            ...transferPatch,
            account_match_status: 'ignored',
            account_match_reason: 'self_transfer',
            account_match_confidence: 'high',
          })
          .eq('id', duplicate.id)
          .eq('user_id', userId)
          .select()
          .single();
        recordSmsEvidenceWithDebug({
          text: taskData.body,
          sender: taskData.sender,
          parsed,
          transactionId: duplicate.id || null,
          timestamp: taskData.timestamp,
        }, safeEventDetails({
          sourceKind: 'sms',
          parsed,
          routeDecision: 'duplicate',
          eventId: duplicate.id || null,
        }));
        emitFinanceDataChanged({
          areas: ['transactions'],
          source: 'sms:transaction_upgraded',
          transactionId: duplicate.id,
        });
        return {
          transactionId: duplicate.id,
          type: 'transfer',
          note: transferPatch.note || duplicate.note || 'Bank to Bank',
          amount: parsed.amount,
          accountLast4: confirmationAccountLast4,
          rawSms: redactedRawSms,
          skipped: false,
          classificationOptions: resultClassificationOptions('transfer', true),
        };
      } else if (
        (duplicate.type === 'income' && dbType === 'expense') ||
        (duplicate.type === 'expense' && dbType === 'income') ||
        (duplicate.type !== 'transfer' && dbType === 'transfer')
      ) {
        // If they are opposing types (income vs expense) or one is explicitly transfer
        if (__DEV__) console.log('Self-transfer pair detected - upgrading existing transaction to transfer');
        const transferPatch = await buildPendingTransferPatch({
          userId,
          incomingType: parsed.type,
          incomingAccountId: matchedAccountId,
          existing: duplicate as Partial<Transaction>,
        });
        currentTransferPatch = transferPatch;
        const { error: upgradeError } = await supabase
          .from('transactions')
          .update({
            ...transferPatch,
            account_match_status: 'ignored',
            account_match_reason: 'self_transfer',
            account_match_confidence: 'high',
          })
          .eq('id', duplicate.id)
          .eq('user_id', userId)
          .select()
          .single();
        
        if (!upgradeError) {
          isUpgradedTransfer = true;
          transactionId = duplicate.id;
          dbType = 'transfer'; // Update local type for notification
          confirmationAccountLast4 = duplicate.account_last4 || parsed.accountLast4;
        } else {
          if (__DEV__) console.error('Failed to upgrade transaction to transfer:', upgradeError);
          return {
            transactionId: duplicate.id,
            type: dbType,
            note: duplicate.note || '',
            amount: parsed.amount,
            rawSms: redactedRawSms,
            skipped: true,
            classificationOptions: resultClassificationOptions(dbType),
          };
        }
      } else {
        if (__DEV__) console.log('Duplicate transaction detected - skipping');
        recordSmsEvidenceWithDebug({
          text: taskData.body,
          sender: taskData.sender,
          parsed,
          transactionId: duplicate.id || null,
          timestamp: taskData.timestamp,
        }, safeEventDetails({
          sourceKind: 'sms',
          parsed,
          routeDecision: 'duplicate',
          eventId: duplicate.id || null,
        }));
        return {
          transactionId: duplicate.id,
          type: dbType,
          note: duplicate.note || '',
          amount: parsed.amount,
          accountLast4: confirmationAccountLast4,
          rawSms: redactedRawSms,
          skipped: true,
          classificationOptions: resultClassificationOptions(dbType),
        };
      }
    }
    if (dbType === 'transfer' && !currentTransferPatch) {
      currentTransferPatch = await buildPendingTransferPatch({
        userId,
        incomingType: parsed.type,
        incomingAccountId: matchedAccountId,
      });
    }
    const presentation = {
      type: dbType,
      merchant: currentTransferPatch?.note || parsed.merchant,
      note: currentTransferPatch?.note || parsed.merchant,
      category: currentTransferPatch?.category || parsed.merchant,
      upi_id: parsed.upiId,
      raw_sms: taskData.body,
      sms_source: parsed.source,
      sms_sender: parsed.rawSender,
    };
    const transactionNote = getTransactionDisplayName(presentation);
    const transactionCategory = inferTransactionCategory(presentation);

    // OFFLINE-FIRST: check connectivity before hitting Supabase
    const netState = await NetInfo.fetch();
    try {
      if (!netState.isConnected) {
        // Offline — build local record and queue for sync
        const tempId = Date.now().toString();
        const offlineTx = {
          user_id: userId,
          amount: parsed.amount,
          type: dbType,
          note: transactionNote,
          category: transactionCategory,
          account_id: currentTransferPatch?.account_id ?? matchedAccountId,
          ...(currentTransferPatch ? {
            from_account_id: currentTransferPatch.from_account_id,
            to_account_id: currentTransferPatch.to_account_id,
            is_transfer_pending: currentTransferPatch.is_transfer_pending,
          } : {}),
          reference_number: parsed.reference,
          account_last4: parsed.accountLast4,
          balance: parsed.balance,
          sms_source: parsed.source,
          sms_sender: parsed.rawSender,
          upi_id: parsed.upiId,
          raw_sms: redactedRawSms,
          ...transactionClassificationFields(automaticPolicy),
          _localId: tempId,
          _queued_at: new Date().toISOString(),
        };
        await appendUserScopedQueueItem(OFFLINE_TX_QUEUE_BASE_KEY, userId, offlineTx);
        transactionId = tempId;
      } else if (!isUpgradedTransfer) {
        // Online — insert to Supabase
        const { data: newTxn, error } = await supabase
          .from('transactions')
          .insert({
            user_id: userId,
            amount: parsed.amount,
            type: dbType,
            note: transactionNote,
            category: transactionCategory,
            account_id: currentTransferPatch?.account_id ?? matchedAccountId,
            ...(currentTransferPatch ? {
              from_account_id: currentTransferPatch.from_account_id,
              to_account_id: currentTransferPatch.to_account_id,
              is_transfer_pending: currentTransferPatch.is_transfer_pending,
            } : {}),
            reference_number: parsed.reference,
            account_last4: parsed.accountLast4,
            balance: parsed.balance,
            sms_source: parsed.source,
            sms_sender: parsed.rawSender,
            upi_id: parsed.upiId,
            raw_sms: redactedRawSms,
            ...transactionClassificationFields(automaticPolicy),
          })
          .select()
          .eq('user_id', userId)
          .single();

        if (error) throw error;

        transactionId = newTxn.id;
        await updateCache<Transaction[]>(CACHE_KEYS.TRANSACTIONS, current => [
          newTxn as Transaction,
          ...(current || []).filter(tx => tx.id !== newTxn.id),
        ]);
        emitFinanceDataChanged({
          areas: parsed.accountLast4 ? ['transactions', 'accounts'] : ['transactions'],
          source: 'sms:transaction',
          transactionId: newTxn.id,
        });
      } else if (isUpgradedTransfer) {
        // We upgraded an existing transaction, just update cache and emit
        await updateCache<Transaction[]>(CACHE_KEYS.TRANSACTIONS, current => 
          current ? current.map(tx => tx.id === transactionId ? {
            ...tx,
            type: 'transfer',
            ...(currentTransferPatch || {}),
            account_match_status: 'ignored',
            account_match_reason: 'self_transfer',
            account_match_confidence: 'high',
          } : tx) : current
        );
        emitFinanceDataChanged({
          areas: ['transactions'],
          source: 'sms:transaction_upgraded',
          transactionId: transactionId!,
        });
      }
    } catch (error) {
      if (isDuplicateInsertError(error)) {
        if (__DEV__) console.log('Duplicate transaction detected by database - skipping');
        return {
          transactionId: null,
          type: dbType,
          note: transactionNote,
          amount: parsed.amount,
          rawSms: redactedRawSms,
          skipped: true,
          classificationOptions: resultClassificationOptions(dbType, isUpgradedTransfer),
        };
      }

      // Network call failed unexpectedly — queue offline
      if (__DEV__) console.error('Database operation failed, queuing offline:', error);
      const tempId = Date.now().toString();
      const offlineTx = {
        user_id: userId,
        amount: parsed.amount,
        type: dbType,
        note: transactionNote,
        category: transactionCategory,
        account_id: currentTransferPatch?.account_id ?? matchedAccountId,
        ...(currentTransferPatch ? {
          from_account_id: currentTransferPatch.from_account_id,
          to_account_id: currentTransferPatch.to_account_id,
          is_transfer_pending: currentTransferPatch.is_transfer_pending,
        } : {}),
        reference_number: parsed.reference,
        account_last4: parsed.accountLast4,
        balance: parsed.balance,
        sms_source: parsed.source,
        sms_sender: parsed.rawSender,
        upi_id: parsed.upiId,
        raw_sms: redactedRawSms,
        ...transactionClassificationFields(automaticPolicy),
        _localId: tempId,
        _queued_at: new Date().toISOString(),
      };
      await appendUserScopedQueueItem(OFFLINE_TX_QUEUE_BASE_KEY, userId, offlineTx);
      transactionId = tempId;
    }

    // Show confirmation notification - this should not fail the whole operation
    if (transactionId) {
      const debugDetails = safeEventDetails({
        sourceKind: 'sms',
        parsed,
        routeDecision: 'stored_transaction',
        eventId: transactionId,
      });
      eventDebugLog('[AutoTransactionDebug] Route decision', debugDetails);
      recordSmsEvidenceWithDebug({
        text: taskData.body,
        sender: taskData.sender,
        parsed,
        transactionId,
        timestamp: taskData.timestamp,
      }, debugDetails);
    }

    // Log success - this should not fail the whole operation
    try {
      if (__DEV__) console.log('Transaction processed successfully:', transactionId);
    } catch {
      // Swallow logging errors - they're not critical
    }

    return {
      transactionId,
      type: dbType,
      note: transactionNote,
      amount: parsed.amount,
      accountLast4: confirmationAccountLast4,
      rawSms: redactedRawSms,
      skipped: false,
      classificationOptions: resultClassificationOptions(dbType, isUpgradedTransfer),
    };
  } catch (error) {
    if (__DEV__) console.error('Error in SMS processor:', error);
  }
};

// ═══════════════════════════════════════════════════════════════════════════════
// NOTIFICATION PROCESSOR
// ═══════════════════════════════════════════════════════════════════════════════

export const processNotification = async (
  taskData: any
): Promise<ProcessorResult | void> => {
  if (__DEV__) console.log('🔔 Notification Processor Started:', {
    payloadLength: getNotificationPayloadLength(taskData),
  });

  try {
    const notif = normalizeNotificationPayload(taskData);
    if (__DEV__) console.log('Parsed notification:', summarizeNotificationForLog(notif));

    if (!ALLOWED_PACKAGES.includes(notif.app)) {
      if (__DEV__) console.log('Notification from non-financial app - ignoring:', notif.app);
      return;
    }

    const combinedText = [
      notif.title,
      notif.text,
      notif.bigText,
      notif.summaryText,
      notif.subText,
    ]
      .filter((part, index, parts): part is string => Boolean(part) && parts.indexOf(part) === index)
      .join(' ')
      .trim();
    
    if (isSpamMessage(combinedText)) {
      if (__DEV__) console.log('⚠️ Spam notification - skipping');
      return;
    }

    const sender = PACKAGE_TO_SENDER[notif.app] || 'UNKNOWN';

    if (isBlockedSender(sender)) {
      if (__DEV__) console.log('⛔ Blocked sender - skipping:', summarizeSenderForLog(sender));
      return;
    }

    if (!isLegitimateFinancialSender(sender)) {
      if (__DEV__) console.log('⛔ Non-financial sender - skipping:', summarizeSenderForLog(sender));
      return;
    }

    const userId = await getProcessorUserId();
    if (!userId) {
      if (__DEV__) console.log('No user ID found');
      return;
    }

    const paymentAppAccountMatch = await resolvePaymentAppBankAccountSafely({
      userId,
      text: combinedText,
      sourcePackage: notif.app,
    });

    const balanceChanged = await recordBalanceSignalSafely({
      userId,
      text: combinedText,
      senderOrPackage: notif.app,
      sourceType: 'notification',
      timestamp: notif.time || Date.now(),
      bankAccountIdHint: paymentAppAccountMatch?.mappingStatus === 'user_confirmed'
        ? paymentAppAccountMatch.mappedBankAccountId
        : null,
    });

    // Non-transaction filter (moved after WhatsApp check, applied post-parse)
    const NON_TRANSACTION_PATTERNS = [
      /emi\s+of\s+(?:INR|Rs\.?|₹)\s*[0-9,]+.*(?:is\s+)?due/i,
      /(?:INR|Rs\.?|₹)\s*[0-9,]+.*(?:is\s+)?due\s+on/i,
      /(?:loan|emi|bill|payment)\s+due/i,
      /due\s+on\s+\d{1,2}(?:st|nd|rd|th)?\s+\w+/i,
      /pay\s+now\s+with\s+(?:INR|Rs\.?|₹)\s*0/i,
      /(?:upcoming|pending|scheduled)\s+(?:emi|payment|bill)/i,
      /(?:autopay|auto-pay|auto\s+debit|mandate)\s+(?:for|of|on)/i,
      /(?:renew|recharge|subscribe)\s+(?:now|before|by)/i,
      /(?:avoid|prevent)\s+(?:late|penalty|interest)/i,
      // Promotional/Cashback/Offer messages
      /cashback\s+on/i,
      /get\s+(?:INR|Rs\.?|₹)\s*[0-9,]+\s+cashback/i,
      /(?:exclusive\s+offer|limited\s+offer|special\s+offer|offer\s+valid|offer\s+expires)/i,
      /(?:use\s+code\s+[A-Z0-9]+|apply\s+coupon|promo\s+code)/i,
      /(?:get\s+flat|flat\s+\d+%\s+off|upto\s+\d+%\s+off)/i,
      /(?:plus|&)\s+(?:assured|get|win)/i,
      /pay\s+now\s*[.!]?\s*$/i,
      /(?:limited|exclusive)\s+(?:offer|deal)/i,
      /(?:save|earn|win)\s+(?:upto|up to)\s+(?:INR|Rs\.?|₹)/i,
    ];

    // WhatsApp strict validation
    if (notif.app === 'com.whatsapp') {
      const textLower = combinedText.toLowerCase();

      // Pattern A: UPI P2P transfers — needs payment reference
      const hasUPIReference = textLower.includes('upi ref') || 
                             textLower.includes('upi id') || 
                             textLower.includes('transaction id') ||
                             textLower.includes('utr');
      const hasPaymentKeyword = textLower.includes('payment') || 
                               textLower.includes('₹') || 
                               textLower.includes('rs.') ||
                               textLower.includes('rs:');
      const isUpiTransfer = hasUPIReference && hasPaymentKeyword;

      // Pattern B: SEBI-mandated investment payouts — needs amount + account + transfer keyword
      const hasAmountB = /(?:rs\.?:|rs\.|inr|₹)\s*[\d,]+/i.test(combinedText);
      const hasAccountRef = textLower.includes('account no') ||
                           textLower.includes('account number') ||
                           textLower.includes('account linked') ||
                           textLower.includes('bank account') ||
                           textLower.includes('registered bank');
      const hasTransferKeyword = textLower.includes('transferred') ||
                                textLower.includes('credited') ||
                                textLower.includes('payout') ||
                                textLower.includes('settlement') ||
                                textLower.includes('refund');
      const isInvestmentPayout = hasAmountB && hasAccountRef && hasTransferKeyword;

      if (!isUpiTransfer && !isInvestmentPayout) {
        if (__DEV__) {
          console.log('WhatsApp notification not a valid payment - skipping');
          if (hasAmount(combinedText)) {
            console.warn('[WhatsApp] Filtered message had amount — may be a missed transaction', {
              textLength: combinedText.length,
            });
          }
        }
        return;
      }
    }

    const parsed = parseTransaction(combinedText, sender);
    if (!parsed) {
      const promoFiltered = NON_TRANSACTION_PATTERNS.some(pattern => pattern.test(combinedText));
      const reasonCode = promoFiltered
        ? 'promo_filtered'
        : balanceChanged
          ? 'balance_signal_recorded'
          : 'parse_failed';
      if (__DEV__) console.log(promoFiltered
        ? '⚠️ Promo/reminder notification - skipping'
        : 'Notification not recognized as financial transaction'
      );
      eventDebugLog('[AutoTransactionDebug] Route decision', {
        sourceKind: 'notification',
        routeDecision: balanceChanged ? 'balance_only' : 'ignored',
        reasonCode,
      });
      if (balanceChanged) {
        void showFinancialEventNotification({
          route: 'balance_only',
          sourceKind: 'notification',
          eventId: `${notif.time || Date.now()}`,
        });
      }
      if (!promoFiltered && hasAmount(combinedText) && hasCompletedTransactionEvidence(combinedText)) {
        recordNotificationEvidenceWithDebug({
          text: combinedText,
          sourcePackage: notif.app,
          sender,
          transactionId: null,
          timestamp: notif.time || Date.now(),
        }, {
          sourceKind: 'notification',
          routeDecision: 'ignored',
          reasonCode,
        });

        await showSmsFailedNotification(combinedText, sender, 'Parse failed', {
          kind: 'notification',
          source: 'notification_parse_failed',
          app: notif.app,
        });
      }
      return;
    }

    if (__DEV__) console.log('✅ Parsed Transaction:', summarizeParsedTransactionForLog(parsed));

    const automaticPolicy = await resolveAutomaticPolicy({
      userId,
      parsed,
      text: combinedText,
      sourceKind: 'notification',
    });


    // Check for duplicates
    let dbType = automaticPolicy.type;
    const resultClassificationOptions = (
      resultType: 'expense' | 'income' | 'transfer',
      upgradedTransfer = false
    ) => notificationClassificationOptions({
      dbType: resultType,
      policy: automaticPolicy,
      upgradedTransfer,
    });
    const senderLabel = notif.app || parsed.rawSender;
    const redactedRawNotification = createRedactedRawTextRecord({
      kind: 'notification',
      text: combinedText,
      sender: senderLabel,
      source: parsed.source,
      app: notif.app,
    });
    const mappedBankAccountId = paymentAppAccountMatch?.mappingStatus === 'user_confirmed'
      ? paymentAppAccountMatch.mappedBankAccountId || null
      : null;
    const matchedAccountId = await findAndSyncBankAccount(userId, parsed.accountLast4, parsed.balance)
      || mappedBankAccountId;
    const matchedAccountLast4 = parsed.accountLast4 || paymentAppAccountMatch?.mappedBankAccountLast4;
    void recordEstimatedBalanceMovementSafely({
      userId,
      bankAccountId: matchedAccountId,
      parsed,
      text: combinedText,
      senderOrPackage: notif.app,
      sourceType: 'notification',
      timestamp: notif.time || Date.now(),
      reason: mappedBankAccountId && matchedAccountId === mappedBankAccountId
        ? 'app_mapping'
        : undefined,
    });

    const duplicate = await checkForDuplicates(
      userId,
      parsed.amount,
      notif.time || Date.now(),
      dbType,
      parsed.reference,
      parsed.source,
      redactedRawNotification,
      parsed.merchant
    );

    let transactionId: string | null = null;
    let isUpgradedTransfer = false;
    let currentTransferPatch: TransferPatch | null = null;

    if (duplicate) {
      if (duplicate.type === 'transfer') {
        const transferPatch = await buildPendingTransferPatch({
          userId,
          incomingType: parsed.type,
          incomingAccountId: matchedAccountId,
          existing: duplicate as Partial<Transaction>,
        });
        await supabase
          .from('transactions')
          .update({
            ...transferPatch,
            account_match_status: 'ignored',
            account_match_reason: 'self_transfer',
            account_match_confidence: 'high',
          })
          .eq('id', duplicate.id)
          .eq('user_id', userId)
          .select()
          .single();
        recordNotificationEvidenceWithDebug({
          text: combinedText,
          sourcePackage: notif.app,
          sender,
          parsed,
          transactionId: duplicate.id || null,
          timestamp: notif.time || Date.now(),
        }, safeEventDetails({
          sourceKind: 'notification',
          parsed,
          routeDecision: 'duplicate',
          eventId: duplicate.id || null,
        }));
        emitFinanceDataChanged({
          areas: ['transactions'],
          source: 'notification:transaction_upgraded',
          transactionId: duplicate.id,
        });
        return {
          transactionId: duplicate.id,
          type: 'transfer',
          note: transferPatch.note || duplicate.note || 'Bank to Bank',
          amount: parsed.amount,
          accountLast4: matchedAccountLast4,
          rawSms: redactedRawNotification,
          skipped: false,
          classificationOptions: resultClassificationOptions('transfer', true),
        };
      } else if (
        (duplicate.type === 'income' && dbType === 'expense') ||
        (duplicate.type === 'expense' && dbType === 'income') ||
        (duplicate.type !== 'transfer' && dbType === 'transfer')
      ) {
        if (__DEV__) console.log('Self-transfer pair detected - upgrading existing transaction to transfer');
        const transferPatch = await buildPendingTransferPatch({
          userId,
          incomingType: parsed.type,
          incomingAccountId: matchedAccountId,
          existing: duplicate as Partial<Transaction>,
        });
        currentTransferPatch = transferPatch;
        const { error: upgradeError } = await supabase
          .from('transactions')
          .update({
            ...transferPatch,
            account_match_status: 'ignored',
            account_match_reason: 'self_transfer',
            account_match_confidence: 'high',
          })
          .eq('id', duplicate.id)
          .eq('user_id', userId)
          .select()
          .single();
        
        if (!upgradeError) {
          isUpgradedTransfer = true;
          transactionId = duplicate.id;
          dbType = 'transfer';
        } else {
          if (__DEV__) console.error('Failed to upgrade transaction to transfer:', upgradeError);
          return {
            transactionId: duplicate.id,
            type: dbType,
            note: duplicate.note || '',
            amount: parsed.amount,
            rawSms: redactedRawNotification,
            skipped: true,
            classificationOptions: resultClassificationOptions(dbType),
          };
        }
      } else {
        if (__DEV__) console.log('Duplicate transaction detected - skipping');
        recordNotificationEvidenceWithDebug({
          text: combinedText,
          sourcePackage: notif.app,
          sender,
          parsed,
          transactionId: duplicate.id || null,
          timestamp: notif.time || Date.now(),
        }, safeEventDetails({
          sourceKind: 'notification',
          parsed,
          routeDecision: 'duplicate',
          eventId: duplicate.id || null,
        }));
        return {
          transactionId: duplicate.id,
          type: dbType,
          note: duplicate.note || '',
          amount: parsed.amount,
          accountLast4: matchedAccountLast4,
          rawSms: redactedRawNotification,
          skipped: true,
          classificationOptions: resultClassificationOptions(dbType),
        };
      }
    }
    if (dbType === 'transfer' && !currentTransferPatch) {
      currentTransferPatch = await buildPendingTransferPatch({
        userId,
        incomingType: parsed.type,
        incomingAccountId: matchedAccountId,
      });
    }
    const presentation = {
      type: dbType,
      merchant: currentTransferPatch?.note || parsed.merchant,
      note: currentTransferPatch?.note || parsed.merchant,
      category: currentTransferPatch?.category || parsed.merchant,
      upi_id: parsed.upiId,
      raw_sms: combinedText,
      sms_source: parsed.source,
      sms_sender: senderLabel,
    };
    const transactionNote = getTransactionDisplayName(presentation);
    const transactionCategory = inferTransactionCategory(presentation);

    // OFFLINE-FIRST: check connectivity before hitting Supabase
    const netState = await NetInfo.fetch();

    try {
      if (!netState.isConnected) {
        const tempId = Date.now().toString();
        const offlineTx = {
          user_id: userId,
          amount: parsed.amount,
          type: dbType,
          note: transactionNote,
          category: transactionCategory,
          account_id: currentTransferPatch?.account_id ?? matchedAccountId,
          ...(currentTransferPatch ? {
            from_account_id: currentTransferPatch.from_account_id,
            to_account_id: currentTransferPatch.to_account_id,
            is_transfer_pending: currentTransferPatch.is_transfer_pending,
          } : {}),
          reference_number: parsed.reference,
          account_last4: matchedAccountLast4,
          balance: parsed.balance,
          sms_source: parsed.source,
          sms_sender: senderLabel,
          upi_id: parsed.upiId,
          raw_sms: redactedRawNotification,
          ...transactionClassificationFields(automaticPolicy),
          _localId: tempId,
          _queued_at: new Date().toISOString(),
        };
        await appendUserScopedQueueItem(OFFLINE_TX_QUEUE_BASE_KEY, userId, offlineTx);
        transactionId = tempId;
      } else if (!isUpgradedTransfer) {
        // Online — insert to Supabase
        const { data: newTxn, error } = await supabase
          .from('transactions')
          .insert({
            user_id: userId,
            amount: parsed.amount,
            type: dbType,
            note: transactionNote,
            category: transactionCategory,
            account_id: currentTransferPatch?.account_id ?? matchedAccountId,
            ...(currentTransferPatch ? {
              from_account_id: currentTransferPatch.from_account_id,
              to_account_id: currentTransferPatch.to_account_id,
              is_transfer_pending: currentTransferPatch.is_transfer_pending,
            } : {}),
            reference_number: parsed.reference,
            account_last4: matchedAccountLast4,
            balance: parsed.balance,
            sms_source: parsed.source,
            sms_sender: senderLabel,
            upi_id: parsed.upiId,
            raw_sms: redactedRawNotification,
            ...transactionClassificationFields(automaticPolicy),
          })
          .select()
          .eq('user_id', userId)
          .single();

        if (error) throw error;

        transactionId = newTxn.id;
        await updateCache<Transaction[]>(CACHE_KEYS.TRANSACTIONS, current => [
          newTxn as Transaction,
          ...(current || []).filter(tx => tx.id !== newTxn.id),
        ]);
        emitFinanceDataChanged({
          areas: parsed.accountLast4 ? ['transactions', 'accounts'] : ['transactions'],
          source: 'notification:transaction',
          transactionId: newTxn.id,
        });
      } else if (isUpgradedTransfer) {
        await updateCache<Transaction[]>(CACHE_KEYS.TRANSACTIONS, current =>
          current ? current.map(tx => tx.id === transactionId ? {
            ...tx,
            type: 'transfer',
            ...(currentTransferPatch || {}),
            account_match_status: 'ignored',
            account_match_reason: 'self_transfer',
            account_match_confidence: 'high',
          } : tx) : current
        );
        emitFinanceDataChanged({
          areas: ['transactions'],
          source: 'notification:transaction_upgraded',
          transactionId: transactionId!,
        });
      }
    } catch (error) {
      if (isDuplicateInsertError(error)) {
        if (__DEV__) console.log('Duplicate transaction detected by database - skipping');
        return {
          transactionId: null,
          type: dbType,
          note: transactionNote,
          amount: parsed.amount,
          accountLast4: matchedAccountLast4,
          rawSms: redactedRawNotification,
          skipped: true,
          classificationOptions: resultClassificationOptions(dbType, isUpgradedTransfer),
        };
      }

      // Network call failed unexpectedly — queue offline
      if (__DEV__) console.error('Database operation failed, queuing offline:', error);
      const tempId = Date.now().toString();
      const offlineTx = {
        user_id: userId,
        amount: parsed.amount,
        type: dbType,
        note: transactionNote,
        category: transactionCategory,
        account_id: currentTransferPatch?.account_id ?? matchedAccountId,
        ...(currentTransferPatch ? {
          from_account_id: currentTransferPatch.from_account_id,
          to_account_id: currentTransferPatch.to_account_id,
          is_transfer_pending: currentTransferPatch.is_transfer_pending,
        } : {}),
        reference_number: parsed.reference,
        account_last4: matchedAccountLast4,
        balance: parsed.balance,
        sms_source: parsed.source,
        sms_sender: senderLabel,
        upi_id: parsed.upiId,
        raw_sms: redactedRawNotification,
        ...transactionClassificationFields(automaticPolicy),
        _localId: tempId,
        _queued_at: new Date().toISOString(),
      };
      await appendUserScopedQueueItem(OFFLINE_TX_QUEUE_BASE_KEY, userId, offlineTx);
      transactionId = tempId;
    }

    // Show confirmation notification - this should not fail the whole operation
    if (transactionId) {
      const debugDetails = safeEventDetails({
        sourceKind: 'notification',
        parsed,
        routeDecision: 'stored_transaction',
        eventId: transactionId,
      });
      eventDebugLog('[AutoTransactionDebug] Route decision', debugDetails);
      recordNotificationEvidenceWithDebug({
        text: combinedText,
        sourcePackage: notif.app,
        sender,
        parsed,
        transactionId,
        timestamp: notif.time || Date.now(),
      }, debugDetails);
    }

    // Log success - this should not fail the whole operation
    try {
      if (__DEV__) console.log('Transaction processed successfully:', transactionId);
    } catch {
      // Swallow logging errors - they're not critical
    }

    return {
      transactionId,
      type: dbType,
      note: transactionNote,
      amount: parsed.amount,
      accountLast4: parsed.accountLast4,
      rawSms: redactedRawNotification,
      skipped: false,
      classificationOptions: resultClassificationOptions(dbType, isUpgradedTransfer),
    };
  } catch (error) {
    if (__DEV__) console.error('Error in notification processor:', error);
  }
};

// ═══════════════════════════════════════════════════════════════════════════════
// EXPORTS (for backward compatibility)
// ═══════════════════════════════════════════════════════════════════════════════

export default processSms; // Default export for SMS
