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

import notifee, { AndroidImportance, AuthorizationStatus, EventType } from '@notifee/react-native';
import RNAndroidNotificationListener from 'react-native-android-notification-listener';
import NetInfo from '@react-native-community/netinfo';
import { supabase } from '../core';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { parseSMS, isTransactionSMS, ParsedTransaction } from './smsParser';
import { getBankAccounts, updateBankAccount } from '../database/financial';
import {
  getTransactionDisplayName,
  inferTransactionCategory,
} from '../../utils/transactionPresentation';
import { BankAccount, Transaction } from '../../types';
import { CACHE_KEYS, updateCache } from './cache';
import { emitFinanceDataChanged } from './dataEvents';
import {
  createRedactedRawTextRecord,
  ensureRedactedRawTextRecord,
  sanitizeDebugBugReportEntry,
  RedactedRawTextKind,
} from '../privacy/rawText';
import { recordBalanceSignalForUser } from './balanceSignalRecorder';
import { recordSmsTransactionEvidence } from './runtimeTransactionEvidence';
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

function formatSafeAmount(amount?: number | null): string {
  return typeof amount === 'number' && Number.isFinite(amount)
    ? `Rs.${amount.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
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
    const getter = (notifee as any).getNotificationSettings;
    if (typeof getter !== 'function') {
      return { label: 'unknown', blocked: false };
    }

    const settings = await getter.call(notifee);
    const status = settings?.authorizationStatus;
    if (status === AuthorizationStatus.DENIED) return { label: 'denied', blocked: true };
    if (status === AuthorizationStatus.AUTHORIZED) return { label: 'authorized', blocked: false };
    if (status === AuthorizationStatus.PROVISIONAL) return { label: 'provisional', blocked: false };
    return { label: String(status ?? 'unknown'), blocked: false };
  } catch (error) {
    console.warn('[SpendSenseNotification] Permission status unavailable', {
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
        channelId: 'sms_parsed',
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
    console.warn('[SpendSenseNotification] Display failed', {
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
  'cashback offer', 'special offer', 'offer expire', 'expire',
  'spend limit', 'view offer', 'namaste', 'team bank',
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

/**
 * Check if SMS/notification is spam/promo — O(1) via pre-compiled SPAM_REGEX
 */
export function isSpamMessage(text: string): boolean {
  return SPAM_REGEX.test(text);
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
      id: 'sms_parsed',
      name: 'Transaction Confirmations',
      importance: AndroidImportance.DEFAULT,
      description: 'Notifications for auto-detected transactions',
    });

    await notifee.createChannel({
      id: 'sms_failed',
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
const confirmationDebounceMap = new Map<string, ReturnType<typeof setTimeout>>();

export async function showTransactionConfirmation(
  transactionId: string,
  type: 'income' | 'expense' | 'investment' | 'emi' | 'transfer' | 'lent' | 'borrowed',
  _merchant: string,
  amount: number,
  accountName?: string,
  rawSms?: string,
  logicLog?: string,
  sender?: string
): Promise<void> {
  // Clear any pending notification for this transaction
  const existingTimeout = confirmationDebounceMap.get(transactionId);
  if (existingTimeout) {
    clearTimeout(existingTimeout);
  }

  return new Promise<void>((resolve) => {
    const timeoutId = setTimeout(async () => {
      confirmationDebounceMap.delete(transactionId);
      await executeShowTransactionConfirmation(
        transactionId, type, _merchant, amount, accountName, rawSms, logicLog, sender
      );
      resolve();
    }, 500);
    confirmationDebounceMap.set(transactionId, timeoutId);
  });
}

async function executeShowTransactionConfirmation(
  transactionId: string,
  type: 'income' | 'expense' | 'investment' | 'emi' | 'transfer' | 'lent' | 'borrowed',
  _merchant: string,
  amount: number,
  accountName?: string,
  rawSms?: string,
  logicLog?: string,
  sender?: string
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

    if (type === 'transfer') {
      titleText = 'Self transfer';
      bodyText = _merchant || 'Bank to Bank';
    } else {
      const typeDisplay = type.charAt(0).toUpperCase() + type.slice(1);
      const formattedAmount = formatSafeAmount(amount);
      const accountLast4 = safeLast4(accountName);
      bodyText = `${typeDisplay} ${formattedAmount}${accountLast4 ? `\nAccount ending ${accountLast4}` : ''}`;
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
        channelId: 'sms_parsed',
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
      body: `From: ${sender}\n${redactedRawText}`,
      android: {
        channelId: 'sms_failed',
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
export async function handleTransactionNotificationEvent(event: any): Promise<void> {
  const { type, detail } = event;

  logInfo('[Transaction Notification] Event received:', type);

  if (type === EventType.ACTION_PRESS) {
    const { pressAction, notification } = detail;
    const transactionId = notification?.data?.transactionId;

    logInfo('[Transaction Notification] Action pressed:', pressAction?.id);
    logInfo('[Transaction Notification] Transaction ID:', transactionId);

    if (pressAction?.id === 'delete' && transactionId) {
      try {
        logInfo('Deleting transaction:', transactionId);

        // OFFLINE RELIABILITY: check connectivity before hitting Supabase
        const netState = await NetInfo.fetch();
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) {
          logUserQueueAction(OFFLINE_DELETE_QUEUE_BASE_KEY, USER_QUEUE_ACTIONS.skipped, 1);
          return;
        }

        if (netState.isConnected) {
          // Online — delete from Supabase immediately
          const { error } = await supabase
            .from('transactions')
            .delete()
            .eq('id', transactionId)
            .eq('user_id', user.id);

          if (error) {
            console.error('Error deleting transaction:', error);
          } else {
            logInfo('Transaction deleted successfully');
            await updateCache<Transaction[]>(CACHE_KEYS.TRANSACTIONS, current =>
              current ? current.filter(tx => tx.id !== transactionId) : current
            );
            emitFinanceDataChanged({
              areas: ['transactions'],
              source: 'notificationAction:delete',
              transactionId,
            });
            await notifee.cancelNotification(notification.id);
          }
        } else {
          // Offline — queue for background sync, dismiss immediately for uninterrupted UX
          logInfo('Offline — queuing delete for background sync');
          await appendUserScopedQueueItem(OFFLINE_DELETE_QUEUE_BASE_KEY, user.id, {
            transactionId,
            _queued_at: new Date().toISOString(),
          });
          await notifee.cancelNotification(notification.id);
          logInfo('Delete queued — notification dismissed');
        }
      } catch (error) {
        console.error('Error in delete handler:', error);
      }
    } else if (pressAction?.id === 'ok') {
      await notifee.cancelNotification(notification.id);
      logInfo('Transaction confirmed by user');
    } else if (pressAction?.id === 'report_bug') {
      try {
        logInfo('Reporting bug for notification');
        const rawSms = notification?.data?.rawSms || 'No raw SMS available';
        const sender = notification?.data?.sender || 'Unknown Sender';
        const logicLog = notification?.data?.logicLog || 'No logic log available';
        const actionType = notification?.data?.action;

        const currentLogsStr = await AsyncStorage.getItem('debug_bug_reports');
        const currentLogs = currentLogsStr ? JSON.parse(currentLogsStr) : [];

        currentLogs.unshift(sanitizeDebugBugReportEntry({
          id: Date.now().toString(),
          timestamp: new Date().toISOString(),
          transactionId: transactionId || 'failed_parse',
          type: actionType,
          sender,
          rawSms,
          rawSmsKind: notification?.data?.rawSmsKind,
          source: notification?.data?.source,
          app: notification?.data?.app,
          logicLog,
        }));

        if (currentLogs.length > 50) currentLogs.length = 50;

        await AsyncStorage.setItem('debug_bug_reports', JSON.stringify(currentLogs));
        await notifee.cancelNotification(notification.id);
        logInfo('Bug report saved successfully');
      } catch (error) {
        console.error('Error saving bug report:', error);
      }
    }
  }

  if (type === EventType.PRESS) {
    const { notification } = detail;
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
export async function onBackgroundEvent(event: any) {
  const { type, detail } = event;
  logInfo('[Background] Notifee event received:', type);

  if (type === EventType.ACTION_PRESS || type === EventType.PRESS) {
    const action = detail?.notification?.data?.action;
    if (action === 'transaction_confirmation' || action === 'sms_failed') {
      await handleTransactionNotificationEvent(event);
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
  return notifee.onForegroundEvent(async (event) => {
    const { type, detail } = event;
    logInfo('[Foreground] Notifee event received:', type);

    if (type === EventType.ACTION_PRESS || type === EventType.PRESS) {
      const action = detail?.notification?.data?.action;
      if (action === 'transaction_confirmation' || action === 'sms_failed') {
        await handleTransactionNotificationEvent(event);
      }
    }
  });
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

async function recordLegacySmsBalanceSignalSafely(
  userId: string,
  smsText: string,
  senderId: string
): Promise<void> {
  try {
    const result = await recordBalanceSignalForUser({
      userId,
      text: smsText,
      senderOrPackage: senderId,
      sourceType: 'sms',
      timestamp: Date.now(),
    });

    if (result.parsed.isBalanceSignal) {
      logInfo('[BalanceSignal] Recorded legacy SMS balance signal', {
        hash: result.parsed.redactedSource.hash,
        snapshots: result.snapshots.length,
        detectedCandidates: result.detectedCandidates.length,
      });
      if (
        result.snapshots.length > 0 ||
        result.detectedCandidates.length > 0 ||
        result.debitCards.length > 0 ||
        result.creditCardStatements.length > 0
      ) {
        emitFinanceDataChanged({
          areas: ['accounts', 'balances'],
          source: 'smsParser:balance_signal',
        });
      }
    }
  } catch (error) {
    console.warn('[BalanceSignal] Failed to record legacy SMS balance signal', {
      message: error instanceof Error ? error.message : 'unknown_error',
    });
  }
}

/**
 * Process incoming SMS and auto-create transaction if possible
 * Returns transaction ID if successful, null otherwise
 */
export async function processTransactionSMS(
  smsText: string,
  senderId: string
): Promise<{ success: boolean; transactionId?: string; parsed: ParsedTransaction }> {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (user?.id) {
      await recordLegacySmsBalanceSignalSafely(user.id, smsText, senderId);
    }

    // Step 1: Check if it's a transaction SMS
    if (!isTransactionSMS(smsText)) {
      logInfo('[SMS Parser] Not a transaction SMS');
      return { success: false, parsed: parseSMS(smsText, senderId) };
    }

    // Step 2: Parse SMS
    const parsed = parseSMS(smsText, senderId);
    logInfo('[SMS Parser] Parsed:', summarizeParsedSmsForLog(parsed));

    // Step 3: Check confidence
    if (parsed.confidence < 50) {
      logInfo('[SMS Parser] Low confidence, skipping auto-creation');
      await showSmsFailedNotification(smsText, senderId, `Low confidence: ${parsed.confidence}%`);
      return { success: false, parsed };
    }

    // Step 4: Find matching bank account
    const accounts = await getBankAccounts();
    let matchedAccount = null;

    if (parsed.last4Digits) {
      matchedAccount = accounts.find(acc => acc.account_last4 === parsed.last4Digits);
    }

    if (!matchedAccount && parsed.bankName) {
      matchedAccount = accounts.find(acc => 
        acc.bank_name.toLowerCase().includes(parsed.bankName!.toLowerCase())
      );
    }

    if (!matchedAccount) {
      logInfo('[SMS Parser] No matching account found');
      await showSmsFailedNotification(
        smsText,
        senderId,
        `Bank: ${parsed.bankName || 'Unknown'}, Last4: ${parsed.last4Digits || 'Unknown'} - No matching account`
      );
      return { success: false, parsed };
    }

    if (!user) {
      logInfo('[SMS Parser] No user found');
      return { success: false, parsed };
    }

    // Determine transaction type
    let type: 'income' | 'expense' | 'transfer' = 'expense';
    if (parsed.transactionType === 'credit') {
      type = 'income';
    } else if (parsed.transactionType === 'payment') {
      // Credit card payment is expense from bank account
      type = 'expense';
    }

    const presentation = {
      type,
      merchant: parsed.merchant,
      note: parsed.merchant || (parsed.bankName ? `${parsed.bankName} Transaction` : undefined),
      category: parsed.merchant,
      upi_id: parsed.upiId,
      raw_sms: smsText,
      sms_source: 'sms',
      sms_sender: senderId,
    };
    const transactionNote = getTransactionDisplayName(presentation);
    const transactionCategory = inferTransactionCategory(presentation);
    const redactedRawSms = createRedactedRawTextRecord({
      kind: 'sms',
      text: smsText,
      sender: senderId,
      source: 'sms',
    });

    const { data: transaction, error } = await supabase
      .from('transactions')
      .insert({
        user_id: user.id,
        type,
        amount: parsed.amount,
        note: transactionNote,
        category: transactionCategory,
        account_id: matchedAccount.id,
        account_last4: matchedAccount.account_last4,
        sms_source: 'sms',
        sms_sender: senderId,
        raw_sms: redactedRawSms,
        balance: parsed.balance,
        upi_id: parsed.upiId,
        created_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (error) {
      console.error('[SMS Parser] Error creating transaction:', error);
      await showSmsFailedNotification(smsText, senderId, `Database error: ${error.message}`);
      return { success: false, parsed };
    }

    void recordSmsTransactionEvidence({
      text: smsText,
      sender: senderId,
      parsed: {
        amount: parsed.amount,
        transactionType: parsed.transactionType,
        merchant: parsed.merchant,
        bankName: parsed.bankName,
        accountLast4: parsed.last4Digits,
        last4Digits: parsed.last4Digits,
        upiId: parsed.upiId,
      },
      transactionId: transaction.id,
      timestamp: Date.now(),
    }).catch(() => undefined);

    if (parsed.balance !== null && parsed.balance !== undefined) {
      try {
        await updateBankAccount(matchedAccount.id, { balance: parsed.balance });
        await updateCache<BankAccount[]>(CACHE_KEYS.BANK_ACCOUNTS, current =>
          current ? current.map(account => account.id === matchedAccount.id ? { ...account, balance: parsed.balance! } : account) : current
        );
      } catch (balanceError) {
        console.warn('[SMS Parser] Transaction saved, but balance update failed:', balanceError);
      }
    }

    await updateCache<Transaction[]>(CACHE_KEYS.TRANSACTIONS, current => [
      transaction as Transaction,
      ...(current || []).filter(tx => tx.id !== transaction.id),
    ]);
    emitFinanceDataChanged({
      areas: parsed.balance !== null && parsed.balance !== undefined
        ? ['transactions', 'accounts']
        : ['transactions'],
      source: 'smsParser:transaction',
      transactionId: transaction.id,
    });

    // Step 6: Show confirmation notification
    await showTransactionConfirmation(
      transaction.id,
      type,
      transactionNote,
      parsed.amount!,
      matchedAccount.bank_name,
      redactedRawSms,
      `Confidence: ${parsed.confidence}%\nMatched: ${matchedAccount.bank_name} (${matchedAccount.account_last4})`,
      senderId
    );

    logInfo('[SMS Parser] Transaction created successfully:', transaction.id);
    return { success: true, transactionId: transaction.id, parsed };
  } catch (error) {
    console.error('[SMS Parser] Error processing SMS:', error);
    return { success: false, parsed: parseSMS(smsText, senderId) };
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
    const bugReportsStr = await AsyncStorage.getItem('debug_bug_reports');
    const bugReports = bugReportsStr ? JSON.parse(bugReportsStr) : [];
    
    const total = bugReports.length;
    const failed = bugReports.filter((r: any) => r.type === 'sms_failed').length;
    const successful = bugReports.filter((r: any) => r.type === 'transaction_confirmation').length;
    const successRate = total > 0 ? (successful / total) * 100 : 0;

    return { total, successful, failed, successRate };
  } catch {
    return { total: 0, successful: 0, failed: 0, successRate: 0 };
  }
}
