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
  showSmsFailedNotification,
  showTransactionConfirmation
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
  AutomaticTransactionReviewReason,
  getAutomaticTransactionPolicy,
} from '../services/automaticTransactionPolicy';
import { enqueueReviewCandidate } from '../services/autoTransactionReviewQueue';
import { processSignal } from '../services/transactionIntelligence';

// ═══════════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════════

interface SmsData {
  sender: string;
  body: string;
  timestamp: number;
}

interface ParsedTransaction {
  amount: number;
  type: 'debit' | 'credit';
  reference?: string;
  merchant?: string;
  balance?: number;
  source: 'bank' | 'upi';
  rawSender: string;
  accountLast4?: string;
  upiId?: string;
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
};

const BANK_SENDERS = [
  'HDFC', 'ICICI', 'SBI', 'AXIS', 'KOTAK', 'PNB', 
  'SCBANK', 'YESBNK', 'INDBNK', 'UNIONB', 'UTKARSH', 'UTKSPR', 'UTKSFB', 'SFBL', 'BOB'
];

const UPI_SENDERS = [
  'PAYTMB', 'GPAYID', 'PHONEPE', 'BHARTP', 'AMAZONP', 'WHATSAP',
  'MOBIKW', 'FREECHARGE', 'PAYZAPP', 'SLCEIT', 'SLICE', 'CRED', 'SUPERM', 'TEST'
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

// ═══════════════════════════════════════════════════════════════════════════════
// SHARED HELPER FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════════

function isBlockedSender(sender: string): boolean {
  const upperSender = sender.toUpperCase();
  return BLOCKED_SENDERS.some(blocked => upperSender.includes(blocked));
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

  return 'unknown';
}

function extractAccountLast4(body: string): string | undefined {
  const accountPatterns = [
    /(?:SuperCard|Card)\s+(\d{4})/i,
    /(?:A\/?C|Acct|Account)\s*(?:no\.?|number)?\s*[-:xX*]*\s*(\d{3,5})/i,
    /XX(\d{4})/i,
  ];
  for (const pattern of accountPatterns) {
    const match = body.match(pattern);
    if (match) return match[1];
  }
  return undefined;
}

function isNumericUpiId(str: string): boolean {
  return /^\d+$/.test(str.trim());
}

function hasAmount(body: string): boolean {
  return /(?:INR|Rs\.?|₹)\s*[0-9,]+(?:\.[0-9]{1,2})?/i.test(body) ||
    /(?:amount|amt|paid|debited|credited|received|deducted|spent|withdrawn|sent|transferred)\s*(?:of|:)?\s*(?:INR|Rs\.?|₹)?\s*[0-9,]+(?:\.[0-9]{1,2})?/i.test(body);
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
  if (isNonTransactionalAmountMention(body)) return false;

  const hasCompletedAction = hasCompletedTransactionEvidence(body);
  return hasCompletedAction || hasTransactionContext(body);
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
    upiIdPresent: Boolean(parsed.upiId),
  };
}

function hashFromRedactedRawText(value: string): string | null {
  return value.match(/\bhash=([a-f0-9]{8,64})\b/i)?.[1]?.toLowerCase() || null;
}

async function enqueueAutomaticReviewCandidate(input: {
  text: string;
  senderOrPackage: string;
  sourceType: 'sms' | 'notification';
  timestamp: number;
  reasonCode: AutomaticTransactionReviewReason;
}): Promise<boolean> {
  const candidate = processSignal({
    rawText: input.text,
    senderOrPackage: input.senderOrPackage,
    sourceType: input.sourceType,
    timestamp: input.timestamp,
  });

  const reviewReasonLabels: Record<AutomaticTransactionReviewReason, string> = {
    borrowed_money: 'Borrowed money needs confirmation',
    cash_deposit: 'Cash deposit needs confirmation',
    cash_withdrawal: 'Cash withdrawal is not a normal expense',
    credit_card_bill_payment: 'Credit card bill payment needs separate review',
    debt_repayment: 'Debt repayment needs separate review',
    personal_transfer: 'Personal transfer needs confirmation',
    refund_or_reimbursement: 'Refund or reimbursement needs confirmation',
    self_transfer: 'Self transfer needs confirmation',
    unverified_credit: 'Credit needs confirmation before counting as income',
    unverified_debit: 'Debit needs confirmation before counting as an expense',
  };

  const stripCounterpartyFromQueue = new Set<AutomaticTransactionReviewReason>([
    'borrowed_money',
    'personal_transfer',
    'unverified_credit',
    'unverified_debit',
  ]).has(input.reasonCode);

  const enqueued = await enqueueReviewCandidate({
    ...candidate,
    merchantOrPerson: stripCounterpartyFromQueue ? null : candidate.merchantOrPerson,
    duplicateFingerprints: stripCounterpartyFromQueue
      ? candidate.duplicateFingerprints.filter(fingerprint => fingerprint.strategy !== 'minute_bucket')
      : candidate.duplicateFingerprints,
    decision: 'review_required',
  }, [reviewReasonLabels[input.reasonCode]]);

  console.info('[AutoTransaction] Routed to review queue', {
    sourceType: input.sourceType,
    direction: candidate.direction,
    reasonCode: input.reasonCode,
  });

  return enqueued;
}

// ═══════════════════════════════════════════════════════════════════════════════
// TRANSACTION PARSING
// ═══════════════════════════════════════════════════════════════════════════════

function parseTransaction(body: string, sender: string): ParsedTransaction | null {
  try {
    const source = identifySource(sender, body);
    if (source === 'unknown') return null;

    if (!shouldAttemptTransactionParse(body)) return null;

    // Extract amount
    const amountPatterns = [
      /^(?:INR|Rs\.?|₹)\s*([0-9,]+(?:\.[0-9]{2})?)/i,
      /(?:INR|Rs\.?|₹)\s*([0-9,]+(?:\.[0-9]{2})?)/i,
      /(?:amount|amt)[\s:]*(?:INR|Rs\.?|₹)?\s*([0-9,]+(?:\.[0-9]{2})?)/i,
      /(?:debited|credited|paid|received|deducted|spent|withdrawn|sent|transferred)[\s:]*(?:INR|Rs\.?|₹)?\s*([0-9,]+(?:\.[0-9]{2})?)/i,
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

    // Determine type
    const isPaidToYou = /paid\s+(?:to\s+)?you/i.test(body);
    const isCredit = isPaidToYou || 
                     /you'?ve\s+got/i.test(body) ||
                     /credited|received|deposited|refund|added|cr\.?\s/i.test(body);
    const isDebit = /debited|deducted|spent|withdrawn|purchase|purchased|sent|dr\.?\s/i.test(body) ||
                    /\bpayment\s+(?:of\s+)?(?:INR|Rs\.?|₹)?\s*[0-9,]+(?:\.\d{1,2})?\s+(?:made|successful|completed|done)\b/i.test(body) ||
                    (!isCredit && /paid/i.test(body));

    if (!isCredit && !isDebit) return null;
    
    let type: 'debit' | 'credit';
    if (/\bdebited\b|\bdr\.?\s/i.test(body)) {
      type = 'debit';
    } else if (/\bcredited\b|\bcr\.?\s/i.test(body)) {
      type = 'credit';
    } else {
      type = isCredit ? 'credit' : isDebit ? 'debit' : 'debit';
    }

    // Extract reference
    const refPatterns = [
      /\b(?:UPI\s*Ref(?:erence)?|UTR|RRN|Ref(?:erence)?|Transaction ID|TXN ID)\s*(?:no\.?|number|id)?\s*[:#-]?\s*([A-Z0-9]{6,})\b/i,
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
    const upiId = extractUpiIdFromText(body) || undefined;

    return { amount, type, reference, merchant, balance, source, rawSender: sender, accountLast4, upiId };
  } catch (error) {
    console.error('Error parsing transaction:', error);
    return null;
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// DATABASE OPERATIONS
// ═══════════════════════════════════════════════════════════════════════════════

async function checkForDuplicates(
  userId: string,
  amount: number,
  timestamp: number,
  type: 'expense' | 'income',
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
        .select('*')
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
        .select('*')
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
      .select('*')
      .eq('user_id', userId)
      .eq('amount', amount)
      .eq('type', type)
      .gte('created_at', oneMinuteAgo)
      .order('created_at', { ascending: false });

    if (referenceNumber) {
      recentQuery = recentQuery.eq('reference_number', referenceNumber);
    } else {
      recentQuery = recentQuery.is('reference_number', null);
    }

    const { data: recentData, error: recentError } = await recentQuery.limit(referenceNumber ? 1 : 5);
    if (recentError) return null;

    if (recentData && recentData.length > 0) {
      const existingTxn = referenceNumber
        ? recentData[0]
        : recentData.find(tx => isSameUnreferencedTransaction(tx, rawText, merchant));
      if (existingTxn) {
        // Additional check: if we have SMS source, make sure it matches
        if (smsSource && existingTxn.sms_source && smsSource !== existingTxn.sms_source) {
          return existingTxn;
        }
        return existingTxn;
      }
    }

    // Then check for older duplicates (within 5 minutes) - but be less aggressive
    let query = supabase
      .from('transactions')
      .select('*')
      .eq('user_id', userId)
      .eq('amount', amount)
      .eq('type', type)
      .gte('created_at', fiveMinutesAgo)
      .order('created_at', { ascending: false });

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
        // Additional check: if we have SMS source, make sure it matches
        if (smsSource && existingTxn.sms_source && smsSource !== existingTxn.sms_source) {
          return existingTxn;
        }
        return existingTxn;
      }
    }

    // Fallback: check for transactions without reference number
    if (!referenceNumber) {
      const { data: fallbackData } = await supabase
        .from('transactions')
        .select('*')
        .eq('user_id', userId)
        .eq('amount', amount)
        .eq('type', type)
        .gte('created_at', fiveMinutesAgo)
        .is('reference_number', null)
        .order('created_at', { ascending: false })
        .limit(1);

      if (fallbackData && fallbackData.length > 0) {
        const existingTxn = fallbackData[0];
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
      console.warn('[TransactionProcessors] Ambiguous bank account match; leaving transaction unlinked', {
        matches: matches.length,
      });
      return null;
    }

    const accountId = matches[0]?.id || null;
    if (!accountId) return null;

    if (balance !== undefined && balance !== null) {
      const { error } = await supabase
        .from('bank_accounts')
        .update({ balance })
        .eq('id', accountId)
        .eq('user_id', userId);

      if (error) {
        console.warn('[TransactionProcessors] Failed to sync bank balance from SMS:', error.message);
      }

      await updateCache<BankAccount[]>(CACHE_KEYS.BANK_ACCOUNTS, current =>
        current ? current.map(account => account.id === accountId ? { ...account, balance } : account) : current
      );
    }

    return accountId;
  } catch (error) {
    console.warn('[TransactionProcessors] Failed to find matched bank account:', error);
    return null;
  }
}

async function getProcessorUserId(): Promise<string | null> {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (session?.user?.id) return session.user.id;
  } catch {}

  const storedUserId = await AsyncStorage.getItem('app_user_id');
  return storedUserId || null;
}

async function recordBalanceSignalSafely(input: {
  userId: string;
  text: string;
  senderOrPackage?: string | null;
  sourceType: 'sms' | 'notification';
  timestamp?: number;
}): Promise<boolean> {
  try {
    const result = await recordBalanceSignalForUser(input);
    if (result.parsed.isBalanceSignal) {
      console.log('[BalanceSignal] Recorded parsed balance signal', {
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
    console.warn('[BalanceSignal] Failed to record parsed balance signal', {
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
    });

    if (snapshot) {
      console.log('[BalanceSignal] Recorded estimated balance movement', {
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
    console.warn('[BalanceSignal] Failed to record estimated balance movement', {
      sourceType: input.sourceType,
      message: error instanceof Error ? error.message : 'unknown_error',
    });
  }

  return false;
}

// ═══════════════════════════════════════════════════════════════════════════════
// SMS PROCESSOR
// ═══════════════════════════════════════════════════════════════════════════════

export const processSms = async (taskData: SmsData) => {
  console.log('SMS Processor Started', {
    sender: taskData.sender,
    bodyLength: taskData.body?.length ?? 0,
    timestamp: taskData.timestamp,
  });

  try {
    if (isBlockedSender(taskData.sender)) {
      console.log('⛔ Blocked sender - skipping:', taskData.sender);
      return;
    }

    if (!isLegitimateFinancialSender(taskData.sender)) {
      console.log('⛔ Non-financial sender - skipping:', taskData.sender);
      return;
    }

    if (isSpamMessage(taskData.body)) {
      console.log('⚠️ Spam SMS - skipping');
      return;
    }

    const userId = await getProcessorUserId();
    if (!userId) {
      console.log('No user ID found');
      return;
    }

    await recordBalanceSignalSafely({
      userId,
      text: taskData.body,
      senderOrPackage: taskData.sender,
      sourceType: 'sms',
      timestamp: taskData.timestamp,
    });

    const parsed = parseTransaction(taskData.body, taskData.sender);
    if (!parsed) {
      console.log('SMS not recognized as financial transaction');
      return;
    }

    console.log('Parsed Transaction:', summarizeParsedTransactionForLog(parsed));

    const automaticPolicy = getAutomaticTransactionPolicy(parsed.type, taskData.body);
    if (automaticPolicy.action === 'review') {
      const enqueued = await enqueueAutomaticReviewCandidate({
        text: taskData.body,
        senderOrPackage: taskData.sender,
        sourceType: 'sms',
        timestamp: taskData.timestamp,
        reasonCode: automaticPolicy.reasonCode,
      });
      let balanceChanged = false;
      if (enqueued) {
        const matchedAccountId = await findAndSyncBankAccount(userId, parsed.accountLast4, parsed.balance);
        balanceChanged = await recordEstimatedBalanceMovementSafely({
          userId,
          bankAccountId: matchedAccountId,
          parsed,
          text: taskData.body,
          senderOrPackage: taskData.sender,
          sourceType: 'sms',
          timestamp: taskData.timestamp,
        });
      }
      if (enqueued || balanceChanged) {
        emitFinanceDataChanged({
          areas: ['review'],
          source: 'sms:review',
        });
      }
      void recordSmsTransactionEvidence({
        text: taskData.body,
        sender: taskData.sender,
        parsed,
        transactionId: null,
        timestamp: taskData.timestamp,
      }).catch(() => undefined);
      return;
    }

    // Check for duplicates
    const dbType = automaticPolicy.type;
    const redactedRawSms = createRedactedRawTextRecord({
      kind: 'sms',
      text: taskData.body,
      sender: parsed.rawSender,
      source: parsed.source,
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

    if (duplicate) {
      console.log('Duplicate transaction detected - skipping');
      void recordSmsTransactionEvidence({
        text: taskData.body,
        sender: taskData.sender,
        parsed,
        transactionId: duplicate.id || null,
        timestamp: taskData.timestamp,
      }).catch(() => undefined);
      return;
    }

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
    const presentation = {
      type: dbType,
      merchant: parsed.merchant,
      note: parsed.merchant,
      category: parsed.merchant,
      upi_id: parsed.upiId,
      raw_sms: taskData.body,
      sms_source: parsed.source,
      sms_sender: parsed.rawSender,
    };
    const transactionNote = getTransactionDisplayName(presentation);
    const transactionCategory = inferTransactionCategory(presentation);

    // OFFLINE-FIRST: check connectivity before hitting Supabase
    const netState = await NetInfo.fetch();
    let transactionId: string | null = null;

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
          account_id: matchedAccountId,
          reference_number: parsed.reference,
          account_last4: parsed.accountLast4,
          balance: parsed.balance,
          sms_source: parsed.source,
          sms_sender: parsed.rawSender,
          upi_id: parsed.upiId,
          raw_sms: redactedRawSms,
          _localId: tempId,
          _queued_at: new Date().toISOString(),
        };
        const queueRaw = await AsyncStorage.getItem('offline_tx_queue');
        const queue = queueRaw ? JSON.parse(queueRaw) : [];
        queue.push(offlineTx);
        await AsyncStorage.setItem('offline_tx_queue', JSON.stringify(queue));
        transactionId = tempId;
      } else {
        // Online — insert to Supabase
        const { data: newTxn, error } = await supabase
          .from('transactions')
          .insert({
            user_id: userId,
            amount: parsed.amount,
            type: dbType,
            note: transactionNote,
            category: transactionCategory,
            account_id: matchedAccountId,
            reference_number: parsed.reference,
            account_last4: parsed.accountLast4,
            balance: parsed.balance,
            sms_source: parsed.source,
            sms_sender: parsed.rawSender,
            upi_id: parsed.upiId,
            raw_sms: redactedRawSms,
          })
          .select()
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
      }
    } catch (error) {
      if (isDuplicateInsertError(error)) {
        console.log('Duplicate transaction detected by database - skipping');
        return;
      }

      // Network call failed unexpectedly — queue offline
      console.error('Database operation failed, queuing offline:', error);
      const tempId = Date.now().toString();
      const offlineTx = {
        user_id: userId,
        amount: parsed.amount,
        type: dbType,
        note: transactionNote,
        category: transactionCategory,
        account_id: matchedAccountId,
        reference_number: parsed.reference,
        account_last4: parsed.accountLast4,
        balance: parsed.balance,
        sms_source: parsed.source,
        sms_sender: parsed.rawSender,
        upi_id: parsed.upiId,
        raw_sms: redactedRawSms,
        _localId: tempId,
        _queued_at: new Date().toISOString(),
      };
      const queueRaw = await AsyncStorage.getItem('offline_tx_queue');
      const queue = queueRaw ? JSON.parse(queueRaw) : [];
      queue.push(offlineTx);
      await AsyncStorage.setItem('offline_tx_queue', JSON.stringify(queue));
      transactionId = tempId;
    }

    // Show confirmation notification - this should not fail the whole operation
    if (transactionId) {
      void recordSmsTransactionEvidence({
        text: taskData.body,
        sender: taskData.sender,
        parsed,
        transactionId,
        timestamp: taskData.timestamp,
      }).catch(() => undefined);

      try {
        await showTransactionConfirmation(
          transactionId,
          dbType,
          transactionNote,
          parsed.amount,
          parsed.accountLast4,
          redactedRawSms
        );
      } catch (notificationError) {
        console.error('Failed to show transaction notification (non-critical):', notificationError);
        // Don't fail the whole operation for notification issues
      }
    }

    // Log success - this should not fail the whole operation
    try {
      console.log('Transaction processed successfully:', transactionId);
    } catch {
      // Swallow logging errors - they're not critical
    }
  } catch (error) {
    console.error('Error in SMS processor:', error);
  }
};

// ═══════════════════════════════════════════════════════════════════════════════
// NOTIFICATION PROCESSOR
// ═══════════════════════════════════════════════════════════════════════════════

export const processNotification = async (taskData: any) => {
  console.log('🔔 Notification Processor Started:', {
    payloadLength: getNotificationPayloadLength(taskData),
  });

  try {
    const notif = normalizeNotificationPayload(taskData);
    console.log('Parsed notification:', summarizeNotificationForLog(notif));

    if (!ALLOWED_PACKAGES.includes(notif.app)) {
      console.log('Notification from non-financial app - ignoring:', notif.app);
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
      console.log('⚠️ Spam notification - skipping');
      return;
    }

    const sender = PACKAGE_TO_SENDER[notif.app] || 'UNKNOWN';

    if (isBlockedSender(sender)) {
      console.log('⛔ Blocked sender - skipping:', sender);
      return;
    }

    if (!isLegitimateFinancialSender(sender)) {
      console.log('⛔ Non-financial sender - skipping:', sender);
      return;
    }

    const userId = await getProcessorUserId();
    if (!userId) {
      console.log('No user ID found');
      return;
    }

    await recordBalanceSignalSafely({
      userId,
      text: combinedText,
      senderOrPackage: notif.app,
      sourceType: 'notification',
      timestamp: notif.time || Date.now(),
    });

    // Non-transaction filter
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
      /(?:offer|deal|discount|sale|promo)/i,
      /use\s+code\s+[A-Z0-9]+/i,
      /(?:plus|&)\s+(?:assured|get|win)/i,
      /pay\s+now\s*[.!]?\s*$/i,
      /(?:limited|exclusive)\s+(?:offer|deal)/i,
      /(?:save|earn|win)\s+(?:upto|up to)\s+(?:INR|Rs\.?|₹)/i,
    ];
    
    if (NON_TRANSACTION_PATTERNS.some(pattern => pattern.test(combinedText))) {
      console.log('⚠️ Reminder notification - skipping');
      return;
    }

    // WhatsApp strict validation
    if (notif.app === 'com.whatsapp') {
      const textLower = combinedText.toLowerCase();
      const hasUPIReference = textLower.includes('upi ref') || 
                             textLower.includes('upi id') || 
                             textLower.includes('transaction id') ||
                             textLower.includes('utr');
      const hasPaymentKeyword = textLower.includes('payment') || 
                               textLower.includes('₹') || 
                               textLower.includes('rs.');
      
      if (!hasUPIReference || !hasPaymentKeyword) {
        console.log('⚠️ WhatsApp notification not a valid payment - skipping');
        return;
      }
    }

    const parsed = parseTransaction(combinedText, sender);
    if (!parsed) {
      console.log('Notification not recognized as financial transaction');
      if (hasAmount(combinedText) && hasCompletedTransactionEvidence(combinedText)) {
        void recordNotificationTransactionEvidence({
          text: combinedText,
          sourcePackage: notif.app,
          sender,
          transactionId: null,
          timestamp: notif.time || Date.now(),
        }).catch(() => undefined);

        await showSmsFailedNotification(combinedText, sender, 'Parse failed', {
          kind: 'notification',
          source: 'notification_parse_failed',
          app: notif.app,
        });
      }
      return;
    }

    console.log('✅ Parsed Transaction:', summarizeParsedTransactionForLog(parsed));

    const automaticPolicy = getAutomaticTransactionPolicy(parsed.type, combinedText);
    if (automaticPolicy.action === 'review') {
      const enqueued = await enqueueAutomaticReviewCandidate({
        text: combinedText,
        senderOrPackage: notif.app,
        sourceType: 'notification',
        timestamp: notif.time || Date.now(),
        reasonCode: automaticPolicy.reasonCode,
      });
      let balanceChanged = false;
      if (enqueued) {
        const matchedAccountId = await findAndSyncBankAccount(userId, parsed.accountLast4, parsed.balance);
        balanceChanged = await recordEstimatedBalanceMovementSafely({
          userId,
          bankAccountId: matchedAccountId,
          parsed,
          text: combinedText,
          senderOrPackage: notif.app,
          sourceType: 'notification',
          timestamp: notif.time || Date.now(),
        });
      }
      if (enqueued || balanceChanged) {
        emitFinanceDataChanged({
          areas: ['review'],
          source: 'notification:review',
        });
      }
      void recordNotificationTransactionEvidence({
        text: combinedText,
        sourcePackage: notif.app,
        sender,
        parsed,
        transactionId: null,
        timestamp: notif.time || Date.now(),
      }).catch(() => undefined);
      return;
    }

    // Check for duplicates
    const dbType = automaticPolicy.type;
    const senderLabel = notif.app || parsed.rawSender;
    const redactedRawNotification = createRedactedRawTextRecord({
      kind: 'notification',
      text: combinedText,
      sender: senderLabel,
      source: parsed.source,
      app: notif.app,
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

    if (duplicate) {
      console.log('Duplicate transaction detected - skipping');
      void recordNotificationTransactionEvidence({
        text: combinedText,
        sourcePackage: notif.app,
        sender,
        parsed,
        transactionId: duplicate.id || null,
        timestamp: notif.time || Date.now(),
      }).catch(() => undefined);
      return;
    }

    const matchedAccountId = await findAndSyncBankAccount(userId, parsed.accountLast4, parsed.balance);
    void recordEstimatedBalanceMovementSafely({
      userId,
      bankAccountId: matchedAccountId,
      parsed,
      text: combinedText,
      senderOrPackage: notif.app,
      sourceType: 'notification',
      timestamp: notif.time || Date.now(),
    });
    const presentation = {
      type: dbType,
      merchant: parsed.merchant,
      note: parsed.merchant,
      category: parsed.merchant,
      upi_id: parsed.upiId,
      raw_sms: combinedText,
      sms_source: parsed.source,
      sms_sender: senderLabel,
    };
    const transactionNote = getTransactionDisplayName(presentation);
    const transactionCategory = inferTransactionCategory(presentation);

    // OFFLINE-FIRST: check connectivity before hitting Supabase
    const netState = await NetInfo.fetch();
    let transactionId: string | null = null;

    try {
      if (!netState.isConnected) {
        const tempId = Date.now().toString();
        const offlineTx = {
          user_id: userId,
          amount: parsed.amount,
          type: dbType,
          note: transactionNote,
          category: transactionCategory,
          account_id: matchedAccountId,
          reference_number: parsed.reference,
          account_last4: parsed.accountLast4,
          balance: parsed.balance,
          sms_source: parsed.source,
          sms_sender: senderLabel,
          upi_id: parsed.upiId,
          raw_sms: redactedRawNotification,
          _localId: tempId,
          _queued_at: new Date().toISOString(),
        };
        const queueRaw = await AsyncStorage.getItem('offline_tx_queue');
        const queue = queueRaw ? JSON.parse(queueRaw) : [];
        queue.push(offlineTx);
        await AsyncStorage.setItem('offline_tx_queue', JSON.stringify(queue));
        transactionId = tempId;
      } else {
        // Online — insert to Supabase
        const { data: newTxn, error } = await supabase
          .from('transactions')
          .insert({
            user_id: userId,
            amount: parsed.amount,
            type: dbType,
            note: transactionNote,
            category: transactionCategory,
            account_id: matchedAccountId,
            reference_number: parsed.reference,
            account_last4: parsed.accountLast4,
            balance: parsed.balance,
            sms_source: parsed.source,
            sms_sender: senderLabel,
            upi_id: parsed.upiId,
            raw_sms: redactedRawNotification,
          })
          .select()
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
      }
    } catch (error) {
      if (isDuplicateInsertError(error)) {
        console.log('Duplicate transaction detected by database - skipping');
        return;
      }

      // Network call failed unexpectedly — queue offline
      console.error('Database operation failed, queuing offline:', error);
      const tempId = Date.now().toString();
      const offlineTx = {
        user_id: userId,
        amount: parsed.amount,
        type: dbType,
        note: transactionNote,
        category: transactionCategory,
        account_id: matchedAccountId,
        reference_number: parsed.reference,
        account_last4: parsed.accountLast4,
        balance: parsed.balance,
        sms_source: parsed.source,
        sms_sender: senderLabel,
        upi_id: parsed.upiId,
        raw_sms: redactedRawNotification,
        _localId: tempId,
        _queued_at: new Date().toISOString(),
      };
      const queueRaw = await AsyncStorage.getItem('offline_tx_queue');
      const queue = queueRaw ? JSON.parse(queueRaw) : [];
      queue.push(offlineTx);
      await AsyncStorage.setItem('offline_tx_queue', JSON.stringify(queue));
      transactionId = tempId;
    }

    // Show confirmation notification - this should not fail the whole operation
    if (transactionId) {
      void recordNotificationTransactionEvidence({
        text: combinedText,
        sourcePackage: notif.app,
        sender,
        parsed,
        transactionId,
        timestamp: notif.time || Date.now(),
      }).catch(() => undefined);

      try {
        await showTransactionConfirmation(
          transactionId,
          dbType,
          transactionNote,
          parsed.amount,
          parsed.accountLast4,
          redactedRawNotification
        );
      } catch (notificationError) {
        console.error('Failed to show transaction notification (non-critical):', notificationError);
        // Don't fail the whole operation for notification issues
      }
    }

    // Log success - this should not fail the whole operation
    try {
      console.log('Transaction processed successfully:', transactionId);
    } catch {
      // Swallow logging errors - they're not critical
    }
  } catch (error) {
    console.error('Error in notification processor:', error);
  }
};

// ═══════════════════════════════════════════════════════════════════════════════
// EXPORTS (for backward compatibility)
// ═══════════════════════════════════════════════════════════════════════════════

export default processSms; // Default export for SMS
