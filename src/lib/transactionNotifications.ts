/**
 * Transaction Notifications
 * Handles confirmation notifications for auto-created transactions
 */

import notifee, { AndroidImportance, EventType } from '@notifee/react-native';
import { supabase } from './supabase';

// Spam/Promo keywords to filter out
const SPAM_KEYWORDS = [
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
];

/**
 * Check if SMS/notification is spam/promo
 */
export function isSpamMessage(text: string): boolean {
  const lowerText = text.toLowerCase();
  return SPAM_KEYWORDS.some(keyword => lowerText.includes(keyword));
}

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

/**
 * Show confirmation notification for successfully parsed transaction
 */
export async function showTransactionConfirmation(
  transactionId: string,
  type: 'income' | 'expense' | 'investment' | 'emi' | 'transfer' | 'lent' | 'borrowed',
  merchant: string,
  amount: number,
  accountName?: string
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
        ],
      },
      data: {
        transactionId,
        action: 'transaction_confirmation',
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
  sender: string
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
      },
      data: {
        action: 'sms_failed',
        rawSms: smsBody,
        sender,
      },
    });

    console.log('✅ SMS failed notification displayed');
  } catch (error) {
    console.error('❌ Error showing SMS failed notification:', error);
  }
}

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
