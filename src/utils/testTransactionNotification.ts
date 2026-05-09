/**
 * Test Transaction Notification
 * Use this to test the confirmation notification system
 */

import { showTransactionConfirmation, showSmsFailedNotification, isSpamMessage } from '../lib/transactionNotifications';

/**
 * Test successful transaction notification
 */
export async function testSuccessNotification() {
  console.log('🧪 Testing success notification...');
  
  await showTransactionConfirmation(
    'test-txn-123',
    'expense',
    'Amazon',
    1250.50,
    'HDFC Bank ••1234'
  );
  
  console.log('✅ Success notification sent');
}

/**
 * Test failed SMS notification
 */
export async function testFailedNotification() {
  console.log('🧪 Testing failed notification...');
  
  await showSmsFailedNotification(
    'Dear customer, your account has been debited for INR 500.00 on 13-Apr-26. Ref: ABC123',
    'TESTBANK'
  );
  
  console.log('✅ Failed notification sent');
}

/**
 * Test spam filter
 */
export function testSpamFilter() {
  console.log('🧪 Testing spam filter...');
  
  const testCases = [
    {
      text: 'Get your instant loan offer! Apply now and get pre-approved in minutes.',
      expected: true,
      label: 'Loan offer spam'
    },
    {
      text: 'Your account has been debited for Rs 500.00 at Amazon',
      expected: false,
      label: 'Valid transaction'
    },
    {
      text: 'Limited time offer! Click here to claim your cashback',
      expected: true,
      label: 'Cashback spam'
    },
    {
      text: 'INR 1000.00 credited to your account. Balance: Rs 5000.00',
      expected: false,
      label: 'Valid credit'
    },
  ];
  
  testCases.forEach(({ text, expected, label }) => {
    const result = isSpamMessage(text);
    const status = result === expected ? '✅' : '❌';
    console.log(`${status} ${label}: ${result} (expected: ${expected})`);
  });
  
  console.log('✅ Spam filter tests complete');
}

/**
 * Run all tests
 */
export async function runAllNotificationTests() {
  console.log('🧪 Running all notification tests...\n');
  
  testSpamFilter();
  console.log('');
  
  await testSuccessNotification();
  console.log('');
  
  await testFailedNotification();
  console.log('');
  
  console.log('✅ All notification tests complete!');
}
