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

import notifee, { AndroidImportance, EventType } from '@notifee/react-native';
import RNAndroidNotificationListener from 'react-native-android-notification-listener';
import NetInfo from '@react-native-community/netinfo';
import { supabase } from '../core';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { parseSMS, isTransactionSMS, ParsedTransaction } from './smsParser';
import { getBankAccounts } from '../database/financial';

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

// ─── Privacy: OTP / PIN scrubber ────────────────────────────────────────────
/**
 * Replace sensitive data before writing to AsyncStorage bug reports.
 * - 4-to-6 digit standalone numbers (OTPs / PINs) → '***'
 * - CVV keyword + trailing digits → 'CVV ***'
 */
function scrubSensitiveData(text: string): string {
  return text
    .replace(/\b\d{4,6}\b/g, '***')           // OTPs / PINs
    .replace(/\bCVV[:\s]*\d*/gi, 'CVV ***');   // CVV keyword + value
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

    console.log('Transaction notification channels created');
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
export async function showTransactionConfirmation(
  transactionId: string,
  type: 'income' | 'expense' | 'investment' | 'emi' | 'transfer' | 'lent' | 'borrowed',
  merchant: string,
  amount: number,
  accountName?: string,
  rawSms?: string,
  logicLog?: string,
  sender?: string
): Promise<void> {
  try {
    await createTransactionChannels();

    const typeDisplay = type.charAt(0).toUpperCase() + type.slice(1);
    const formattedAmount = `Rs.${amount.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

    let bodyText = `${merchant} - ${formattedAmount}`;
    if (accountName) bodyText += `\n${accountName}`;

    await notifee.displayNotification({
      id: `txn_${transactionId}`,
      title: `${typeDisplay} Added`,
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
        rawSms: rawSms || 'No raw SMS available',
        logicLog: logicLog || 'No logic log available',
      },
    });

    console.log('Transaction confirmation notification shown for', transactionId);
  } catch (error) {
    console.error('Error showing transaction confirmation:', error);
  }
}

/**
 * Show notification for failed SMS parsing
 */
export async function showSmsFailedNotification(
  smsBody: string,
  sender: string,
  logicLog?: string
): Promise<void> {
  try {
    await createTransactionChannels();

    const truncatedBody = smsBody.length > 100
      ? `${smsBody.substring(0, 100)}...`
      : smsBody;

    await notifee.displayNotification({
      title: 'Transaction SMS Not Recognized',
      body: `From: ${sender}\n${truncatedBody}`,
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
        rawSms: smsBody,
        sender,
        logicLog: logicLog || '',
      },
    });

    console.log('SMS failed notification displayed');
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

  console.log('[Transaction Notification] Event received:', type);

  if (type === EventType.ACTION_PRESS) {
    const { pressAction, notification } = detail;
    const transactionId = notification?.data?.transactionId;

    console.log('[Transaction Notification] Action pressed:', pressAction?.id);
    console.log('[Transaction Notification] Transaction ID:', transactionId);

    if (pressAction?.id === 'delete' && transactionId) {
      try {
        console.log('Deleting transaction:', transactionId);

        // OFFLINE RELIABILITY: check connectivity before hitting Supabase
        const netState = await NetInfo.fetch();
        if (netState.isConnected) {
          // Online — delete from Supabase immediately
          const { error } = await supabase
            .from('transactions')
            .delete()
            .eq('id', transactionId);

          if (error) {
            console.error('Error deleting transaction:', error);
          } else {
            console.log('Transaction deleted successfully');
            await notifee.cancelNotification(notification.id);
          }
        } else {
          // Offline — queue for background sync, dismiss immediately for uninterrupted UX
          console.log('Offline — queuing delete for background sync');
          const queueRaw = await AsyncStorage.getItem('offline_delete_queue');
          const queue: string[] = queueRaw ? JSON.parse(queueRaw) : [];
          if (!queue.includes(transactionId)) queue.push(transactionId);
          await AsyncStorage.setItem('offline_delete_queue', JSON.stringify(queue));
          await notifee.cancelNotification(notification.id);
          console.log('Delete queued — notification dismissed');
        }
      } catch (error) {
        console.error('Error in delete handler:', error);
      }
    } else if (pressAction?.id === 'ok') {
      await notifee.cancelNotification(notification.id);
      console.log('Transaction confirmed by user');
    } else if (pressAction?.id === 'report_bug') {
      try {
        console.log('Reporting bug for notification');
        const rawSms = notification?.data?.rawSms || 'No raw SMS available';
        const sender = notification?.data?.sender || 'Unknown Sender';
        const logicLog = notification?.data?.logicLog || 'No logic log available';
        const actionType = notification?.data?.action;

        const currentLogsStr = await AsyncStorage.getItem('debug_bug_reports');
        const currentLogs = currentLogsStr ? JSON.parse(currentLogsStr) : [];

        currentLogs.unshift({
          id: Date.now().toString(),
          timestamp: new Date().toISOString(),
          transactionId: transactionId || 'failed_parse',
          type: actionType,
          sender,
          // PRIVACY: scrub OTPs, PINs, CVV before persisting to AsyncStorage
          rawSms: scrubSensitiveData(rawSms),
          logicLog,
        });

        if (currentLogs.length > 50) currentLogs.length = 50;

        await AsyncStorage.setItem('debug_bug_reports', JSON.stringify(currentLogs));
        await notifee.cancelNotification(notification.id);
        console.log('Bug report saved successfully');
      } catch (error) {
        console.error('Error saving bug report:', error);
      }
    }
  }

  if (type === EventType.PRESS) {
    const { notification } = detail;
    const transactionId = notification?.data?.transactionId;
    console.log('[Transaction Notification] Notification pressed, ID:', transactionId);
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
  console.log('[Background] Notifee event received:', type);

  if (type === EventType.ACTION_PRESS || type === EventType.PRESS) {
    const action = detail?.notification?.data?.action;
    if (action === 'transaction_confirmation' || action === 'sms_failed') {
      await handleTransactionNotificationEvent(event);
      return;
    }
  }

  if (type === EventType.DELIVERED) {
    console.log('[Background] Notification delivered');
  }
}

/**
 * Initialize foreground listeners for notifee
 * Call this inside a useEffect in the main App component
 */
export function initializeForegroundListener() {
  return notifee.onForegroundEvent(async (event) => {
    const { type, detail } = event;
    console.log('[Foreground] Notifee event received:', type);

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
  console.log('[Background] Initializing background listeners...');

  try {
    const hasPermission = await RNAndroidNotificationListener.getPermissionStatus();

    if (hasPermission === 'authorized') {
      console.log('[Background] Notification listener permission granted');
    } else {
      console.log('[Background] Notification listener permission not granted');
    }
  } catch (error) {
    console.error('[Background] Error initializing listeners:', error);
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// INTELLIGENT SMS PROCESSING
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Process incoming SMS and auto-create transaction if possible
 * Returns transaction ID if successful, null otherwise
 */
export async function processTransactionSMS(
  smsText: string,
  senderId: string
): Promise<{ success: boolean; transactionId?: string; parsed: ParsedTransaction }> {
  try {
    // Step 1: Check if it's a transaction SMS
    if (!isTransactionSMS(smsText)) {
      console.log('[SMS Parser] Not a transaction SMS');
      return { success: false, parsed: parseSMS(smsText, senderId) };
    }

    // Step 2: Parse SMS
    const parsed = parseSMS(smsText, senderId);
    console.log('[SMS Parser] Parsed:', JSON.stringify(parsed, null, 2));

    // Step 3: Check confidence
    if (parsed.confidence < 50) {
      console.log('[SMS Parser] Low confidence, skipping auto-creation');
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
      console.log('[SMS Parser] No matching account found');
      await showSmsFailedNotification(
        smsText,
        senderId,
        `Bank: ${parsed.bankName || 'Unknown'}, Last4: ${parsed.last4Digits || 'Unknown'} - No matching account`
      );
      return { success: false, parsed };
    }

    // Step 5: Create transaction
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      console.log('[SMS Parser] No user found');
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

    const { data: transaction, error } = await supabase
      .from('transactions')
      .insert({
        user_id: user.id,
        type,
        amount: parsed.amount,
        note: parsed.merchant || `${parsed.bankName || 'Bank'} Transaction`,
        category: type === 'income' ? 'salary' : 'general',
        account_id: matchedAccount.id,
        account_last4: matchedAccount.account_last4,
        sms_source: 'sms',
        sms_sender: senderId,
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

    // Step 6: Show confirmation notification
    await showTransactionConfirmation(
      transaction.id,
      type,
      parsed.merchant || `${parsed.bankName || 'Bank'} Transaction`,
      parsed.amount!,
      matchedAccount.bank_name,
      smsText,
      `Confidence: ${parsed.confidence}%\nMatched: ${matchedAccount.bank_name} (${matchedAccount.account_last4})`,
      senderId
    );

    console.log('[SMS Parser] Transaction created successfully:', transaction.id);
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
