/**
 * Notifications Module
 * Consolidated: transactionNotifications.ts + BackgroundEventHandler.ts
 *
 * Handles:
 * - Transaction confirmation notifications
 * - Failed SMS parsing notifications
 * - Background/foreground event handlers
 * - Spam/promo filtering
 */

import notifee, {
  AndroidImportance,
  AuthorizationStatus,
  EventType,
  type Event as NotifeeEvent,
} from '@notifee/react-native';
import RNAndroidNotificationListener from 'react-native-android-notification-listener';
import NetInfo from '@react-native-community/netinfo';
import { deleteTransaction, supabase } from '../core';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { enqueueSms } from '../processors/TransactionQueue';
import { parseSMS, ParsedTransaction } from './smsParser';
import { Transaction } from '../../types';
import { CACHE_KEYS, updateCache } from './cache';
import { emitFinanceDataChanged } from './dataEvents';
import {
  createRedactedRawTextRecord,
  ensureRedactedRawTextRecord,
  sanitizeDebugBugReportEntry,
  RedactedRawTextKind,
} from '../privacy/rawText';
import {
  OFFLINE_DELETE_QUEUE_BASE_KEY,
  USER_QUEUE_ACTIONS,
  appendUserScopedQueueItem,
  logUserQueueAction,
} from './userScopedQueues';

export function summarizeParsedSmsForLog(parsed: ParsedTransaction) {
  return {
    transactionType: parsed.transactionType,
    amountPresent: parsed.amount !== null,
    balancePresent: parsed.balance !== null,
    accountLast4Present: parsed.last4Digits !== null,
    bankNamePresent: parsed.bankName !== null,
    merchantPresent: parsed.merchant !== null,
    upiIdPresent: parsed.upiId !== null,
    confidencePresent: Number.isFinite(parsed.confidence),
  };
}

type FinancialEventRoute = 'stored_transaction' | 'balance_only' | 'review_required';

interface FinancialEventNotificationInput {
  route: FinancialEventRoute;
  sourceKind: 'sms' | 'notification';
  amount?: number | null;
  direction?: 'credit' | 'debit' | 'neutral' | 'unknown' | null;
  accountLast4?: string | null;
  cardLast4?: string | null;
  eventId?: string | null;
}

type NotificationData = Record<string, string | number | object | undefined>;

interface NotificationEventDetail {
  notification?: {
    id?: string;
    data?: NotificationData;
  };
  pressAction?: {
    id: string;
  };
}

interface SafeNotifeeEvent {
  type?: EventType;
  detail?: NotificationEventDetail;
}

const CHANNELS = {
  SMS_PARSED: 'sms_parsed',
  SMS_FAILED: 'sms_failed',
} as const;

const DEBUG_BUG_REPORTS_KEY = 'debug_bug_reports';
const MAX_DEBUG_BUG_REPORTS = 50;
const DEBUG_BUG_REPORT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const CONFIRMATION_DEBOUNCE_TTL_MS = 5 * 60 * 1000;
const CONFIRMATION_DEBOUNCE_CLEANUP_MS = 60 * 1000;

function safeErrorCode(error: unknown): string {
  if (!error || typeof error !== 'object') return 'unknown_error';
  const code = (error as { code?: unknown; name?: unknown; status?: unknown }).code
    || (error as { name?: unknown }).name
    || (error as { status?: unknown }).status;
  return typeof code === 'string' || typeof code === 'number'
    ? String(code).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 48) || 'unknown_error'
    : 'unknown_error';
}

function suffixId(value?: string | null): string | undefined {
  const safe = value?.replace(/[^A-Za-z0-9_-]/g, '');
  if (!safe) return undefined;
  return safe.slice(-8);
}

function logInfo(..._details: unknown[]): void {
  // Intentionally silent: financial notification paths must not write runtime details to logs.
}

function safeLast4(value?: string | null): string | undefined {
  const digits = value?.replace(/\D/g, '') || '';
  return digits.length >= 4 ? digits.slice(-4) : undefined;
}

function safeSenderLabel(value?: string | null): string {
  const trimmed = value?.trim();
  if (!trimmed || /\d{7,}/.test(trimmed)) return 'Sender redacted';
  return trimmed
    .replace(/[^A-Za-z0-9._-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 48) || 'Sender redacted';
}

function formatSafeAmount(amount?: number | null): string {
  return typeof amount === 'number' && Number.isFinite(amount)
    ? `₹${amount.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`
    : 'Amount captured';
}

function routeTitle(route: FinancialEventRoute): string {
  if (route === 'balance_only') return 'Balance updated';
  return 'Transaction saved';
}

function routeBody(input: FinancialEventNotificationInput): string {
  const source = input.sourceKind === 'notification' ? 'Notification' : 'SMS';
  const amount = formatSafeAmount(input.amount);
  const direction = input.direction && input.direction !== 'unknown'
    ? input.direction.charAt(0).toUpperCase() + input.direction.slice(1)
    : 'Money movement';
  const last4 = safeLast4(input.accountLast4) || safeLast4(input.cardLast4);
  const suffix = last4 ? `\nAccount ending ${last4}` : '';
  return `${direction} ${amount} from ${source}${suffix}`;
}

async function getNotificationPermissionStatus(): Promise<{
  label: string;
  blocked: boolean;
}> {
  try {
    const settings = await notifee.getNotificationSettings();
    const status = settings?.authorizationStatus;
    if (status === AuthorizationStatus.DENIED) return { label: 'denied', blocked: true };
    if (status === AuthorizationStatus.AUTHORIZED) return { label: 'authorized', blocked: false };
    if (status === AuthorizationStatus.PROVISIONAL) return { label: 'provisional', blocked: false };
    return { label: String(status ?? 'unknown'), blocked: false };
  } catch (error) {
    if (__DEV__) console.warn('[SpendSenseNotification] Permission status unavailable', {
      errorCode: safeErrorCode(error),
    });
    return { label: 'unknown_error', blocked: false };
  }
}

export async function showFinancialEventNotification(
  input: FinancialEventNotificationInput
): Promise<'sent' | 'blocked' | 'failed'> {
  if (input.route === 'review_required') {
    logInfo('[SpendSenseNotification] Display skipped', {
      route: input.route,
      reasonCode: 'review_required_notifications_disabled',
      sourceKind: input.sourceKind,
      eventIdSuffix: suffixId(input.eventId),
    });
    return 'blocked';
  }

  const permission = await getNotificationPermissionStatus();
  logInfo('[SpendSenseNotification] Display requested', {
    route: input.route,
    sourceKind: input.sourceKind,
    permissionStatus: permission.label,
    eventIdSuffix: suffixId(input.eventId),
  });

  if (permission.blocked) {
    logInfo('[SpendSenseNotification] Display blocked', {
      route: input.route,
      reasonCode: 'permission_denied',
    });
    return 'blocked';
  }

  try {
    await createTransactionChannels();
    logInfo('[SpendSenseNotification] Channel ready', {
      channelId: 'sms_parsed',
      route: input.route,
    });

    await notifee.displayNotification({
      id: input.eventId ? `finance_${input.route}_${suffixId(input.eventId)}` : undefined,
      title: routeTitle(input.route),
      body: routeBody(input),
      android: {
        channelId: CHANNELS.SMS_PARSED,
        importance: AndroidImportance.DEFAULT,
        pressAction: { id: 'default' },
      },
      data: {
        action: input.route,
        sourceKind: input.sourceKind,
        eventIdSuffix: suffixId(input.eventId) || '',
      },
    });

    logInfo('[SpendSenseNotification] Display succeeded', {
      route: input.route,
      notificationScheduled: true,
    });
    return 'sent';
  } catch (error) {
    if (__DEV__) console.warn('[SpendSenseNotification] Display failed', {
      route: input.route,
      errorCode: safeErrorCode(error),
    });
    return 'failed';
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// SPAM FILTERING
// ═══════════════════════════════════════════════════════════════════════════════

// PERFORMANCE: Single pre-compiled regex — O(1) .test() vs O(n) .some() scan
const SPAM_KEYWORDS_LIST = [
  // Promotional / marketing
  'loan offer', 'get your', 'instantly', 't&c', 'tap:', 'click here',
  'offer ends', 'apply now', 'pre-approved', 'pre approved', 'limited time',
  'hurry', 'claim now', 'exclusive offer', 'congratulations',
  'you are eligible', 'instant approval', 'no documents', 'easy emi',
  'cashback offer', 'special offer', 'offer expire', 'offer expired',
  'deal expires', 'code expires', 'voucher expir',
  'spend limit', 'view offer',
  // EMI / Bill reminders (NOT actual transactions)
  'emi due', 'emi is due', 'is due on', 'due on ', 'payment due',
  'bill due', 'pay now with', 'overdue', 'reminder:', 'upcoming emi',
  'emi reminder', 'bill reminder', 'autopay scheduled', 'autopay reminder',
  'auto-debit scheduled', 'scheduled for', 'will be debited on',
  'will be deducted on', 'mandate', 'pay before', 'avoid late',
  'late fee', 'penalty',
  // Insurance / subscription reminders
  'policy renewal', 'renew now', 'subscription due', 'recharge due',
  // Rewards / cashback promos
  'earn cashback', 'win up to', 'scratch card', 'goldfly',
  'book domestic', 'every domestic trip',
];

const SPAM_REGEX = new RegExp(
  SPAM_KEYWORDS_LIST
    .map(k => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')) // escape regex specials
    .join('|'),
  'i'
);

const SPAM_KEYWORD_REGEXES = SPAM_KEYWORDS_LIST.map(keyword =>
  new RegExp(keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i')
);

/**
 * Check if SMS/notification is spam/promo — O(1) via pre-compiled SPAM_REGEX
 */
export function isSpamMessage(text: string): boolean {
  return SPAM_REGEX.test(text);
}

export function getSpamConfidence(text: string): number {
  if (!text.trim()) return 0;
  const matches = SPAM_KEYWORD_REGEXES.reduce(
    (count, pattern) => count + (pattern.test(text) ? 1 : 0),
    0
  );
  return Math.min(matches / Math.max(SPAM_KEYWORD_REGEXES.length, 1), 1);
}

// ═══════════════════════════════════════════════════════════════════════════════
// NOTIFICATION CHANNELS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Create notification channels for transaction confirmations
 */
export async function createTransactionChannels() {
  try {
    await notifee.createChannel({
      id: CHANNELS.SMS_PARSED,
      name: 'Transaction Confirmations',
      importance: AndroidImportance.DEFAULT,
      description: 'Notifications for auto-detected transactions',
    });

    await notifee.createChannel({
      id: CHANNELS.SMS_FAILED,
      name: 'SMS Parsing Failures',
      importance: AndroidImportance.HIGH,
      description: 'Notifications when SMS cannot be parsed',
    });

    logInfo('Transaction notification channels created');
  } catch (error) {
    console.error('Error creating transaction channels:', error);
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// SHOW NOTIFICATIONS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Show confirmation notification for successfully parsed transaction
 */
const confirmationDebounceMap = new Map<string, {
  timeoutId: ReturnType<typeof setTimeout>;
  createdAt: number;
}>();

function clearStaleConfirmationDebounces(now = Date.now()): void {
  confirmationDebounceMap.forEach((entry, transactionId) => {
    if (now - entry.createdAt <= CONFIRMATION_DEBOUNCE_TTL_MS) return;
    clearTimeout(entry.timeoutId);
    confirmationDebounceMap.delete(transactionId);
  });
}

export async function showTransactionConfirmation(
  transactionId: string,
  type: 'income' | 'expense' | 'investment' | 'emi' | 'transfer' | 'lent' | 'borrowed' | 'refund',
  _merchant: string,
  amount: number,
  accountName?: string,
  rawSms?: string,
  logicLog?: string,
  sender?: string,
  options?: {
    classificationStatus?: 'manual_confirmed' | 'review_required' | 'ignored' | null;
    classificationReason?: string | null;
  }
): Promise<void> {
  clearStaleConfirmationDebounces();

  // Clear any pending notification for this transaction
  const existingEntry = confirmationDebounceMap.get(transactionId);
  if (existingEntry) {
    clearTimeout(existingEntry.timeoutId);
  }

  return new Promise<void>((resolve) => {
    const timeoutId = setTimeout(async () => {
      confirmationDebounceMap.delete(transactionId);
      try {
        await executeShowTransactionConfirmation(
          transactionId, type, _merchant, amount, accountName, rawSms, logicLog, sender, options
        );
      } finally {
        resolve();
      }
    }, 500);
    confirmationDebounceMap.set(transactionId, {
      timeoutId,
      createdAt: Date.now(),
    });
  });
}

async function executeShowTransactionConfirmation(
  transactionId: string,
  type: 'income' | 'expense' | 'investment' | 'emi' | 'transfer' | 'lent' | 'borrowed' | 'refund',
  _merchant: string,
  amount: number,
  accountName?: string,
  rawSms?: string,
  logicLog?: string,
  sender?: string,
  options?: {
    classificationStatus?: 'manual_confirmed' | 'review_required' | 'ignored' | null;
    classificationReason?: string | null;
  }
): Promise<void> {
  try {
    const permission = await getNotificationPermissionStatus();
    logInfo('[SpendSenseNotification] Display requested', {
      route: 'stored_transaction',
      sourceKind: rawSms?.startsWith('redacted_notification') ? 'notification' : 'sms',
      permissionStatus: permission.label,
      eventIdSuffix: suffixId(transactionId),
    });
    if (permission.blocked) {
      logInfo('[SpendSenseNotification] Display blocked', {
        route: 'stored_transaction',
        reasonCode: 'permission_denied',
      });
      return;
    }

    await createTransactionChannels();
    logInfo('[SpendSenseNotification] Channel ready', {
        channelId: 'sms_parsed',
        route: 'stored_transaction',
    });

    let titleText = 'Transaction saved';
    let bodyText = '';
    const formattedAmount = formatSafeAmount(amount);
    const accountLast4 = safeLast4(accountName);
    const accountSuffix = accountLast4 ? `\nAccount ending ${accountLast4}` : '';

    if (options?.classificationStatus === 'review_required') {
      if (type === 'income') {
        bodyText = `${formattedAmount} saved. Review income status.${accountSuffix}`;
      } else {
        bodyText = `${formattedAmount} saved. Review classification in details.${accountSuffix}`;
      }
    } else if (type === 'transfer') {
      titleText = options?.classificationReason === 'credit_card_bill_payment'
        ? 'Card payment saved'
        : 'Money movement saved';
      bodyText = `${formattedAmount} saved.${accountSuffix}`;
    } else {
      const typeDisplay = type.charAt(0).toUpperCase() + type.slice(1);
      bodyText = `${typeDisplay} ${formattedAmount}${accountSuffix}`;
    }

    const notificationRawText = ensureRedactedRawTextRecord(rawSms, {
      kind: 'sms',
      sender,
      source: 'transaction_confirmation',
    });
    const rawSmsKind: RedactedRawTextKind = notificationRawText.startsWith('redacted_notification')
      ? 'notification'
      : 'sms';

    await notifee.displayNotification({
      id: `txn_${transactionId}`,
      title: titleText,
      body: bodyText,
      android: {
        channelId: CHANNELS.SMS_PARSED,
        importance: AndroidImportance.DEFAULT,
        pressAction: { id: 'default' },
        actions: [
          { title: 'OK', pressAction: { id: 'ok' } },
          { title: 'Delete', pressAction: { id: 'delete' } },
          { title: 'Report Bug', pressAction: { id: 'report_bug' } },
        ],
      },
      data: {
        transactionId,
        action: 'transaction_confirmation',
        sender: sender || 'Unknown Sender',
        rawSms: notificationRawText,
        rawSmsKind,
        logicLog: logicLog || 'No logic log available',
      },
    });

    logInfo('[SpendSenseNotification] Display succeeded', {
      route: 'stored_transaction',
      transactionIdSuffix: suffixId(transactionId),
    });
  } catch (error) {
    console.error('[SpendSenseNotification] Display failed', {
      route: 'stored_transaction',
      errorCode: safeErrorCode(error),
    });
  }
}

async function removeTransactionFromLocalState(
  transactionId: string,
  source: string
): Promise<void> {
  await updateCache<Transaction[]>(CACHE_KEYS.TRANSACTIONS, current =>
    current ? current.filter(tx => tx.id !== transactionId) : current
  );
  emitFinanceDataChanged({
    areas: ['transactions', 'review'],
    source,
    transactionId,
  });
}

let bugReportWriteQueue: Promise<void> = Promise.resolve();

function parseDebugBugReports(value: string | null): Record<string, any>[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    if (__DEV__) console.warn('[SpendSenseNotification] Ignoring corrupt bug report cache', {
      errorCode: safeErrorCode(error),
    });
    return [];
  }
}

function isRecentBugReport(entry: Record<string, any>, now: number): boolean {
  if (typeof entry.timestamp !== 'string') return true;
  const timestamp = new Date(entry.timestamp).getTime();
  if (!Number.isFinite(timestamp)) return false;
  return now - timestamp < DEBUG_BUG_REPORT_MAX_AGE_MS;
}

async function appendDebugBugReport(entry: Record<string, any>): Promise<void> {
  const write = bugReportWriteQueue.then(async () => {
    const now = Date.now();
    const currentLogsStr = await AsyncStorage.getItem(DEBUG_BUG_REPORTS_KEY);
    const currentLogs = parseDebugBugReports(currentLogsStr).filter(log =>
      isRecentBugReport(log, now)
    );
    const newLogs = [
      sanitizeDebugBugReportEntry(entry),
      ...currentLogs.slice(0, MAX_DEBUG_BUG_REPORTS - 1),
    ];

    await AsyncStorage.setItem(DEBUG_BUG_REPORTS_KEY, JSON.stringify(newLogs));
  });

  bugReportWriteQueue = write.catch(error => {
    if (__DEV__) console.error('[SpendSenseNotification] Bug report write failed', {
      errorCode: safeErrorCode(error),
    });
  });
  return write;
}

/**
 * Show notification for failed SMS parsing
 */
export async function showSmsFailedNotification(
  smsBody: string,
  sender: string,
  logicLog?: string,
  options?: {
    kind?: RedactedRawTextKind;
    source?: string;
    app?: string;
  }
): Promise<void> {
  try {
    await createTransactionChannels();

    const rawSmsKind = options?.kind || 'sms';
    const redactedRawText = createRedactedRawTextRecord({
      kind: rawSmsKind,
      text: smsBody,
      sender,
      source: options?.source || 'parse_failed',
      app: options?.app,
    });

    await notifee.displayNotification({
      title: 'Transaction SMS Not Recognized',
      body: `From: ${safeSenderLabel(sender)}\n${redactedRawText}`,
      android: {
        channelId: CHANNELS.SMS_FAILED,
        importance: AndroidImportance.HIGH,
        pressAction: { id: 'default' },
        actions: [
          { title: 'Report Bug', pressAction: { id: 'report_bug' } },
        ],
      },
      data: {
        action: 'sms_failed',
        rawSms: redactedRawText,
        rawSmsKind,
        sender,
        logicLog: logicLog || '',
        source: options?.source || 'parse_failed',
        app: options?.app || '',
      },
    });

    logInfo('SMS failed notification displayed');
  } catch (error) {
    console.error('Error showing SMS failed notification:', error);
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// EVENT HANDLERS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Handle background notification events (when app is closed/background)
 */
export async function handleTransactionNotificationEvent(
  event: SafeNotifeeEvent | NotifeeEvent
): Promise<void> {
  const { type, detail } = event;

  logInfo('[Transaction Notification] Event received:', type);

  if (type === EventType.ACTION_PRESS) {
    const { pressAction, notification } = detail || {};
    const transactionId = notification?.data?.transactionId;

    logInfo('[Transaction Notification] Action pressed:', pressAction?.id);
    logInfo('[Transaction Notification] Transaction ID:', transactionId);

    if (pressAction?.id === 'delete' && typeof transactionId === 'string') {
      try {
        logInfo('Deleting transaction:', transactionId);
        await removeTransactionFromLocalState(transactionId, 'notification:delete_requested');

        // OFFLINE RELIABILITY: check connectivity before hitting Supabase
        const netState = await NetInfo.fetch();
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) {
          logUserQueueAction(OFFLINE_DELETE_QUEUE_BASE_KEY, USER_QUEUE_ACTIONS.skipped, 1);
          return;
        }

        if (netState.isConnected) {
          // Online — use shared deletion path so review state stays consistent
          await deleteTransaction(transactionId);
          logInfo('Transaction deleted successfully');
          if (notification?.id) await notifee.cancelNotification(notification.id);
        } else {
          // Offline — queue for background sync, dismiss immediately for uninterrupted UX
          logInfo('Offline — queuing delete for background sync');
          await appendUserScopedQueueItem(OFFLINE_DELETE_QUEUE_BASE_KEY, user.id, {
            transactionId,
            _queued_at: new Date().toISOString(),
          });
          if (notification?.id) await notifee.cancelNotification(notification.id);
          logInfo('Delete queued — notification dismissed');
        }
      } catch (error) {
        emitFinanceDataChanged({
          areas: ['transactions', 'review'],
          source: 'notification:delete_failed',
          transactionId,
        });
        if (__DEV__) console.error('Error in delete handler:', {
          errorCode: safeErrorCode(error),
        });
      }
    } else if (pressAction?.id === 'ok') {
      if (notification?.id) await notifee.cancelNotification(notification.id);
      logInfo('Transaction confirmed by user');
    } else if (pressAction?.id === 'report_bug') {
      try {
        logInfo('Reporting bug for notification');
        const rawSms = String(notification?.data?.rawSms || 'No raw SMS available');
        const sender = String(notification?.data?.sender || 'Unknown Sender');
        const logicLog = String(notification?.data?.logicLog || 'No logic log available');
        const actionType = notification?.data?.action;

        await appendDebugBugReport({
          id: Date.now().toString(),
          timestamp: new Date().toISOString(),
          transactionId: typeof transactionId === 'string' ? transactionId : 'failed_parse',
          type: typeof actionType === 'string' ? actionType : undefined,
          sender,
          rawSms,
          rawSmsKind: typeof notification?.data?.rawSmsKind === 'string'
            ? notification.data.rawSmsKind
            : undefined,
          source: typeof notification?.data?.source === 'string'
            ? notification.data.source
            : undefined,
          app: typeof notification?.data?.app === 'string'
            ? notification.data.app
            : undefined,
          logicLog,
        });
        if (notification?.id) await notifee.cancelNotification(notification.id);
        logInfo('Bug report saved successfully');
      } catch (error) {
        if (__DEV__) console.error('Error saving bug report:', {
          errorCode: safeErrorCode(error),
        });
      }
    }
  }

  if (type === EventType.PRESS) {
    const { notification } = detail || {};
    const transactionId = notification?.data?.transactionId;
    logInfo('[Transaction Notification] Notification pressed, ID:', transactionId);
    // TODO: Navigate to transaction detail screen — handled in foreground listener in App.tsx
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// BACKGROUND EVENT HANDLER
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Background event handler for Notifee — runs even when the app is closed
 */
export async function onBackgroundEvent(event: SafeNotifeeEvent | NotifeeEvent) {
  const { type, detail } = event;
  logInfo('[Background] Notifee event received:', type);

  if (type === EventType.ACTION_PRESS || type === EventType.PRESS) {
    const action = detail?.notification?.data?.action;
    if (action === 'transaction_confirmation' || action === 'sms_failed') {
      await handleTransactionNotificationEvent(event);
      return;
    } else if (action === 'transaction_reminder_meetup') {
      await handleMeetupReminderEvent(event);
      return;
    }
  }

  if (type === EventType.DELIVERED) {
    logInfo('[Background] Notification delivered');
  }
}

/**
 * Initialize foreground listeners for notifee
 * Call this inside a useEffect in the main App component
 */
export function initializeForegroundListener() {
  const cleanupInterval = setInterval(
    clearStaleConfirmationDebounces,
    CONFIRMATION_DEBOUNCE_CLEANUP_MS
  );
  const unsubscribe = notifee.onForegroundEvent(async (event) => {
    const { type, detail } = event;
    logInfo('[Foreground] Notifee event received:', type);

    if (type === EventType.ACTION_PRESS || type === EventType.PRESS) {
      const action = detail?.notification?.data?.action;
      if (action === 'transaction_confirmation' || action === 'sms_failed') {
        await handleTransactionNotificationEvent(event);
      } else if (action === 'transaction_reminder_meetup') {
        await handleMeetupReminderEvent(event);
      }
    }
  });

  return () => {
    clearInterval(cleanupInterval);
    unsubscribe();
  };
}

async function handleMeetupReminderEvent(event: SafeNotifeeEvent | NotifeeEvent) {
  const { type, detail } = event;
  const actionId = detail?.pressAction?.id;
  
  if (type === EventType.ACTION_PRESS && actionId?.startsWith('snooze_')) {
    const data = detail.notification?.data;
    const txId = data?.transactionId as string;
    const amount = Number(data?.amount);
    const note = data?.note as string;
    
    if (txId && !isNaN(amount) && note) {
      if (__DEV__) console.log('[Meetup Reminder] Snoozing action triggered:', actionId);
      
      // Cancel the original notification
      if (detail.notification?.id) {
        await notifee.cancelNotification(detail.notification.id);
      }
      
      // Calculate new time
      const newTime = new Date();
      if (actionId === 'snooze_10m') {
        newTime.setMinutes(newTime.getMinutes() + 10);
      } else if (actionId === 'snooze_30m') {
        newTime.setMinutes(newTime.getMinutes() + 30);
      } else if (actionId === 'snooze_1h') {
        newTime.setHours(newTime.getHours() + 1);
      } else {
        // Fallback to 1 hour
        newTime.setHours(newTime.getHours() + 1);
      }
      
      // Schedule new reminder
      const { scheduleTransactionReminder } = require('./scheduledNotifications');
      await scheduleTransactionReminder(txId, amount, note, newTime);
      
      // Update local storage so the modal shows the correct time if opened
      const { storeTransactionReminder } = require('../../components/modals/TransactionReminderModal');
      await storeTransactionReminder({
        transactionId: txId,
        scheduledAt: newTime.toISOString(),
        note,
      });
    }
  }
}

/**
 * Initialize background listeners
 * Call this when app starts to ensure listeners are active
 */
export async function initializeBackgroundListeners() {
  logInfo('[Background] Initializing background listeners...');

  try {
    const hasPermission = await RNAndroidNotificationListener.getPermissionStatus();

    if (hasPermission === 'authorized') {
      logInfo('[Background] Notification listener permission granted');
    } else {
      logInfo('[Background] Notification listener permission not granted');
    }
  } catch (error) {
    console.error('[Background] Error initializing listeners:', error);
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// INTELLIGENT SMS PROCESSING
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * @deprecated DO NOT USE. This is a legacy SMS processor that bypasses all
 * duplicate detection, offline queuing, and self-transfer logic.
 * It now delegates to enqueueSms() from TransactionQueue.ts and returns once
 * queued. The queue owns dedupe, offline handling, and self-transfer routing.
 */
export async function processTransactionSMS(
  smsText: string,
  senderId: string
): Promise<{ success: boolean; transactionId?: string; parsed: ParsedTransaction }> {
  const parsed = parseSMS(smsText, senderId);

  logInfo('[DEPRECATED] processTransactionSMS() called. Delegating to enqueueSms().');

  try {
    await enqueueSms({
      body: smsText,
      sender: senderId,
      timestamp: Date.now(),
    });
    return { success: true, parsed };
  } catch (error) {
    if (__DEV__) console.error('[SMS Parser] Error queueing SMS:', {
      errorCode: safeErrorCode(error),
    });
    return { success: false, parsed };
  }
}

/**
 * Get SMS parsing statistics for debugging
 */
export async function getSMSParsingStats(): Promise<{
  total: number;
  successful: number;
  failed: number;
  successRate: number;
}> {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { total: 0, successful: 0, failed: 0, successRate: 0 };

    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const { count: successful } = await supabase
      .from('transactions')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', user.id)
      .not('sms_source', 'is', null)
      .gte('created_at', todayStart.toISOString());

    const bugReportsStr = await AsyncStorage.getItem(DEBUG_BUG_REPORTS_KEY);
    const bugReports = parseDebugBugReports(bugReportsStr);
    const failed = bugReports.filter((r: any) => r.type === 'sms_failed').length;

    const total = (successful || 0) + failed;
    const successRate = total > 0 ? ((successful || 0) / total) * 100 : 0;

    return {
      total,
      successful: successful || 0,
      failed,
      successRate: Math.round(successRate * 10) / 10,
    };
  } catch {
    return { total: 0, successful: 0, failed: 0, successRate: 0 };
  }
}
