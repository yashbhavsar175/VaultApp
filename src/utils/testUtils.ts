/**
 * Test Utilities — Consolidated
 * Merged from: testNotification.ts, testNotifications.ts, testTransactionNotification.ts
 * 
 * Contains all test notification helpers for development/debugging.
 */

import notifee, { AndroidImportance, AuthorizationStatus } from '@notifee/react-native';
import { showTransactionConfirmation, showSmsFailedNotification, isSpamMessage } from '../lib/services/notifications';

// ─── Permission Helper ─────────────────────────────────────────────────────────

export const requestTestNotificationPermission = async (): Promise<boolean> => {
  const settings = await notifee.requestPermission();
  return settings.authorizationStatus >= AuthorizationStatus.AUTHORIZED;
};

// ─── Single Test Notification ───────────────────────────────────────────────────

/**
 * Send a single test notification mimicking a banking transaction
 */
export const sendTestNotification = async (): Promise<boolean> => {
  try {
    await notifee.requestPermission();

    const channelId = await notifee.createChannel({
      id: 'test',
      name: 'Test Notifications',
      importance: AndroidImportance.HIGH,
    });

    await notifee.displayNotification({
      title: 'HDFC Bank',
      body: 'Rs 500.00 debited from A/c XX1234 on 07-Apr-26. UPI/PhonePe/9876543210. Avl Bal: Rs 10,500.00',
      android: {
        channelId,
        smallIcon: 'ic_launcher',
        importance: AndroidImportance.HIGH,
        pressAction: { id: 'default' },
      },
    });

    console.log('✅ Test notification sent');
    return true;
  } catch (error) {
    console.error('❌ Error sending test notification:', error);
    return false;
  }
};

// ─── Multiple Test Notifications ────────────────────────────────────────────────

/**
 * Send multiple test notifications for different bank/UPI scenarios
 */
export const sendMultipleTestNotifications = async (): Promise<boolean> => {
  try {
    await notifee.requestPermission();

    const channelId = await notifee.createChannel({
      id: 'test',
      name: 'Test Notifications',
      importance: AndroidImportance.HIGH,
    });

    const scenarios = [
      { title: 'HDFC Bank', body: 'Rs 850.00 debited from A/c XX9876 on 08-Apr-26. Paid at Amazon. Avl Bal: Rs 25,150.00' },
      { title: 'Google Pay', body: 'You received Rs 1,200.00 from Rahul Sharma to A/c XX9876. Avl Bal: Rs 26,350.00' },
      { title: 'slice', body: 'Payment of Rs 500 made at Swiggy using Slice card ending 4567. Available limit: Rs 45,150' },
      { title: 'KOTAK BANK', body: 'Rs 300.00 debited from A/c XX1447 on 08-Apr-26. UPI/PhonePe/9876543210. Avl Bal: Rs 10,500.00' },
    ];

    for (let i = 0; i < scenarios.length; i++) {
      await notifee.displayNotification({
        title: scenarios[i].title,
        body: scenarios[i].body,
        android: { channelId, smallIcon: 'ic_launcher' },
      });
      console.log(`✅ Sent ${i + 1}/${scenarios.length}: ${scenarios[i].title}`);
      if (i < scenarios.length - 1) {
        await new Promise(resolve => setTimeout(() => resolve(undefined), 2000));
      }
    }

    return true;
  } catch (error) {
    console.error('❌ Error sending test notifications:', error);
    return false;
  }
};

// ─── Typed Test SMS Notification ────────────────────────────────────────────────

/**
 * Send test notification for specific transaction type (debit/credit)
 */
export const sendTypedTestNotification = async (type: 'debit' | 'credit'): Promise<void> => {
  const hasPermission = await requestTestNotificationPermission();
  if (!hasPermission) return;

  const channelId = await notifee.createChannel({
    id: 'test-sms',
    name: 'Test SMS Notifications',
    importance: AndroidImportance.HIGH,
    sound: 'default',
    vibration: true,
  });

  const messages = {
    debit: {
      title: 'Test Debit SMS',
      body: 'Rs.2,500.00 debited from A/c XX1234 on 28-Mar-26. UPI/Amazon/123456789. Avl Bal: Rs.15,000.00',
      sender: 'VM-TESTBANK',
    },
    credit: {
      title: 'Test Credit SMS',
      body: 'Rs.5,000.00 credited to A/c XX1234 on 28-Mar-26. UPI/SALARY/987654321. Avl Bal: Rs.20,000.00',
      sender: 'VM-TESTBANK',
    },
  };

  const msg = messages[type];
  await notifee.displayNotification({
    title: msg.title,
    body: msg.body,
    android: {
      channelId,
      importance: AndroidImportance.HIGH,
      pressAction: { id: 'default' },
      smallIcon: 'ic_launcher',
      sound: 'default',
      vibrationPattern: [300, 500],
      showTimestamp: true,
    },
    data: { sender: msg.sender, body: msg.body, isTest: 'true' },
  });
};

export const sendBothTestNotifications = async (): Promise<void> => {
  await sendTypedTestNotification('debit');
  setTimeout(() => sendTypedTestNotification('credit'), 2000);
};

// ─── Transaction Notification Tests ─────────────────────────────────────────────

export async function testSuccessNotification() {
  await showTransactionConfirmation('test-txn-123', 'expense', 'Amazon', 1250.50, 'HDFC Bank ••1234');
  console.log('✅ Success notification sent');
}

export async function testFailedNotification() {
  await showSmsFailedNotification(
    'Dear customer, your account has been debited for INR 500.00 on 13-Apr-26. Ref: ABC123',
    'TESTBANK'
  );
  console.log('✅ Failed notification sent');
}

export function testSpamFilter() {
  const testCases = [
    { text: 'Get your instant loan offer! Apply now and get pre-approved in minutes.', expected: true, label: 'Loan offer spam' },
    { text: 'Your account has been debited for Rs 500.00 at Amazon', expected: false, label: 'Valid transaction' },
    { text: 'Limited time offer! Click here to claim your cashback', expected: true, label: 'Cashback spam' },
    { text: 'INR 1000.00 credited to your account. Balance: Rs 5000.00', expected: false, label: 'Valid credit' },
  ];

  testCases.forEach(({ text, expected, label }) => {
    const result = isSpamMessage(text);
    const status = result === expected ? '✅' : '❌';
    console.log(`${status} ${label}: ${result} (expected: ${expected})`);
  });
}

export async function runAllNotificationTests() {
  console.log('🧪 Running all notification tests...\n');
  testSpamFilter();
  await testSuccessNotification();
  await testFailedNotification();
  console.log('✅ All notification tests complete!');
}
