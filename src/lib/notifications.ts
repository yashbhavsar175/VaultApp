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
import { supabase } from './core';
import AsyncStorage from '@react-native-async-storage/async-storage';

// ═══════════════════════════════════════════════════════════════════════════════
// SPAM FILTERING
// ═══════════════════════════════════════════════════════════════════════════════

// Spam/Promo keywords to filter out
const SPAM_KEYWORDS = [
  // Promotional / marketing
  'loan offer',
  'get your',
  'instantly',
  't&c',
  'tap:',
  'click here',
  'offer ends',
  'apply now',
  'pre-approved',
  'pre approved',
  'limited time',
  'hurry',
  'claim now',
  'exclusive offer',
  'congratulations',
  'you are eligible',
  'instant approval',
  'no documents',
  'easy emi',
  'cashback offer',
  'special offer',
  'offer expire',
  'expire',
  'spend limit',
  'view offer',
  'धन्यवाद',  // "Thank you" in Hindi - common in promotional emails
  'namaste',
  'team bank',  // "Team BankBazaar", "Team HDFC" etc.
  // EMI / Bill reminders (NOT actual transactions)
  'emi due',
  'emi is due',
  'is due on',
  'due on ',       // trailing space to avoid false positives
  'payment due',
  'bill due',
  'pay now with',
  'overdue',
  'reminder:',
  'upcoming emi',
  'emi reminder',
  'bill reminder',
  'autopay scheduled',
  'autopay reminder',
  'auto-debit scheduled',
  'scheduled for',
  'will be debited on',
  'will be deducted on',
  'mandate',
  'pay before',
  'avoid late',
  'late fee',
  'penalty',
  // Insurance / subscription reminders
  'policy renewal',
  'renew now',
  'subscription due',
  'recharge due',
  // Rewards / cashback promos
  'earn cashback',
  'win up to',
  'scratch card',
  'goldfly',
  'gold*',
  'book domestic',
  'every domestic trip',
];

/**
 * Check if SMS/notification is spam/promo
 */
export function isSpamMessage(text: string): boolean {
  const lowerText = text.toLowerCase();
  return SPAM_KEYWORDS.some(keyword => lowerText.includes(keyword));
}

// ═══════════════════════════════════════════════════════════════════════════════
// NOTIFICATION CHANNELS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Create notification channels for transaction confirmations
 */
export async function createTransactionChannels() {
  try {
    // Channel for successful parses
    await notifee.createChannel({
      id: 'sms_parsed',
      name: 'Transaction Confirmations',
      importance: AndroidImportance.DEFAULT,
      description: 'Notifications for auto-detected transactions',
    });

    // Channel for failed parses
    await notifee.createChannel({
      id: 'sms_failed',
      name: 'SMS Parsing Failures',
      importance: AndroidImportance.HIGH,
      description: 'Notifications when SMS cannot be parsed',
    });

    console.log('✅ Transaction notification channels created');
  } catch (error) {
    console.error('❌ Error creating transaction channels:', error);
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
  logicLog?: string
): Promise<void> {
  try {
    await createTransactionChannels();

    // Format type for display
    const typeDisplay = type.charAt(0).toUpperCase() + type.slice(1);
    
    // Format amount
    const formattedAmount = `₹${amount.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    
    // Build body text
    let bodyText = `${merchant} • ${formattedAmount}`;
    if (accountName) {
      bodyText += `\n${accountName}`;
    }

    // Display notification
    await notifee.displayNotification({
      id: `txn_${transactionId}`,
      title: `${typeDisplay} Added`,
      body: bodyText,
      android: {
        channelId: 'sms_parsed',
        importance: AndroidImportance.DEFAULT,
        pressAction: {
          id: 'default',
        },
        actions: [
          {
            title: '✓ OK',
            pressAction: {
              id: 'ok',
            },
          },
          {
            title: '✗ Delete',
            pressAction: {
              id: 'delete',
            },
          },
          {
            title: '🐛 Report Bug',
            pressAction: {
              id: 'report_bug',
            },
          },
        ],
      },
      data: {
        transactionId,
        action: 'transaction_confirmation',
        rawSms: rawSms || '',
        logicLog: logicLog || '',
      },
    });

    console.log(`✅ Transaction confirmation notification shown for ${transactionId}`);
  } catch (error) {
    console.error('❌ Error showing transaction confirmation:', error);
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

    // Truncate SMS body for notification
    const truncatedBody = smsBody.length > 100 
      ? `${smsBody.substring(0, 100)}...` 
      : smsBody;

    await notifee.displayNotification({
      title: '⚠️ Transaction SMS Not Recognized',
      body: `From: ${sender}\n${truncatedBody}`,
      android: {
        channelId: 'sms_failed',
        importance: AndroidImportance.HIGH,
        pressAction: {
          id: 'default',
        },
        actions: [
          {
            title: '🐛 Report Bug',
            pressAction: {
              id: 'report_bug',
            },
          },
        ],
      },
      data: {
        action: 'sms_failed',
        rawSms: smsBody,
        sender,
        logicLog: logicLog || '',
      },
    });

    console.log('✅ SMS failed notification displayed');
  } catch (error) {
    console.error('❌ Error showing SMS failed notification:', error);
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

  console.log('🔔 [Transaction Notification] Event received:', type);

  // Handle action press
  if (type === EventType.ACTION_PRESS) {
    const { pressAction, notification } = detail;
    const transactionId = notification?.data?.transactionId;

    console.log('🔔 [Transaction Notification] Action pressed:', pressAction?.id);
    console.log('🔔 [Transaction Notification] Transaction ID:', transactionId);

    if (pressAction?.id === 'delete' && transactionId) {
      try {
        console.log('🗑️ Deleting transaction:', transactionId);

        // Delete transaction from Supabase
        const { error } = await supabase
          .from('transactions')
          .delete()
          .eq('id', transactionId);

        if (error) {
          console.error('❌ Error deleting transaction:', error);
        } else {
          console.log('✅ Transaction deleted successfully');
          
          // Dismiss the notification
          await notifee.cancelNotification(notification.id);
        }
      } catch (error) {
        console.error('❌ Error in delete handler:', error);
      }
    } else if (pressAction?.id === 'ok') {
      // Just dismiss the notification
      await notifee.cancelNotification(notification.id);
      console.log('✅ Transaction confirmed by user');
    } else if (pressAction?.id === 'report_bug') {
      try {
        console.log('🐛 Reporting bug for notification');
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
          rawSms,
          logicLog,
        });
        
        // Keep only last 50 logs
        if (currentLogs.length > 50) currentLogs.length = 50;
        
        await AsyncStorage.setItem('debug_bug_reports', JSON.stringify(currentLogs));
        
        await notifee.cancelNotification(notification.id);
        console.log('✅ Bug report saved successfully');
      } catch (error) {
        console.error('❌ Error saving bug report:', error);
      }
    }
  }

  // Handle notification press (tap on notification body)
  if (type === EventType.PRESS) {
    const { notification } = detail;
    const transactionId = notification?.data?.transactionId;

    console.log('🔔 [Transaction Notification] Notification pressed');
    console.log('🔔 [Transaction Notification] Transaction ID:', transactionId);

    // TODO: Navigate to transaction detail/edit screen
    // This will be handled in foreground event handler in App.tsx
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// BACKGROUND EVENT HANDLER (from BackgroundEventHandler.ts)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Background event handler for Notifee
 * This runs even when the app is closed
 */
export async function onBackgroundEvent(event: any) {
  const { type, detail } = event;
  console.log('🔔 [Background] Notifee event received:', type);
  
  // Handle transaction notification actions (delete, ok)
  if (type === EventType.ACTION_PRESS || type === EventType.PRESS) {
    const action = detail?.notification?.data?.action;
    
    if (action === 'transaction_confirmation' || action === 'sms_failed') {
      await handleTransactionNotificationEvent(event);
      return;
    }
  }
  
  // Handle notification events in background
  if (type === EventType.DELIVERED) {
    console.log('📬 [Background] Notification delivered');
  }
}

/**
 * Initialize foreground listeners for notifee
 * Call this inside a useEffect in the main App component
 */
export function initializeForegroundListener() {
  return notifee.onForegroundEvent(async (event) => {
    const { type, detail } = event;
    console.log('🔔 [Foreground] Notifee event received:', type);
    
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
  console.log('🚀 [Background] Initializing background listeners...');
  
  try {
    // Check if notification listener permission is granted
    const hasPermission = await RNAndroidNotificationListener.getPermissionStatus();
    
    if (hasPermission === 'authorized') {
      console.log('✅ [Background] Notification listener permission granted');
      console.log('✅ [Background] Listener service is already active');
      // DO NOT call requestPermission() here - it opens settings screen!
      // The service is automatically active when permission is granted
    } else {
      console.log('⚠️ [Background] Notification listener permission not granted');
      console.log('ℹ️ [Background] User needs to enable it from first-time dialog');
    }
  } catch (error) {
    console.error('❌ [Background] Error initializing listeners:', error);
  }
}
