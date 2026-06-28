import AsyncStorage from '@react-native-async-storage/async-storage';
import notifee from '@notifee/react-native';
import { enqueueSms } from '../processors/TransactionQueue';
import {
  handleTransactionNotificationEvent,
  getSpamConfidence,
  isSpamMessage,
  processTransactionSMS,
  showFinancialEventNotification,
  showTransactionConfirmation,
  showSmsFailedNotification,
  summarizeParsedSmsForLog,
} from './notifications';

jest.mock('../processors/TransactionQueue', () => ({
  enqueueSms: jest.fn(() => Promise.resolve()),
}));

describe('notification privacy paths', () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    await AsyncStorage.clear();
    (notifee as any).cancelNotification = jest.fn(() => Promise.resolve());
    (notifee as any).getNotificationSettings = jest.fn(() => Promise.resolve({ authorizationStatus: 1 }));
  });

  it('shows failed SMS notifications without raw body text', async () => {
    const sensitiveBody = 'OTP 123456 for account 9876543210 at 12 Main Road. This is not a transaction.';

    await showSmsFailedNotification(sensitiveBody, 'TESTBK', 'Parse failed');

    const payload = (notifee.displayNotification as jest.Mock).mock.calls[0][0];
    const serializedPayload = JSON.stringify(payload);

    expect(payload.body).toContain('redacted_sms');
    expect(payload.data.rawSms).toMatch(/^redacted_sms len=\d+ hash=[a-f0-9]{8}/);
    expect(serializedPayload).not.toContain('OTP 123456');
    expect(serializedPayload).not.toContain('9876543210');
    expect(serializedPayload).not.toContain('Main Road');
  });

  it('redacts phone-like failed SMS senders from notification body', async () => {
    await showSmsFailedNotification('PLACEHOLDER_UNPARSED_TEXT', '9999999999', 'Parse failed');

    const payload = (notifee.displayNotification as jest.Mock).mock.calls[0][0];

    expect(payload.body).toContain('Sender redacted');
    expect(payload.body).not.toContain('9999999999');
  });

  it('redacts raw text in transaction confirmation bug-report data defensively', async () => {
    const sensitiveBody = 'Rs.50 debited from account 9876543210 at 12 Main Road. OTP 123456.';

    await showTransactionConfirmation(
      'tx_sensitive',
      'expense',
      'Sensitive Merchant',
      50,
      'HDFC',
      sensitiveBody,
      'test',
      'HDFCBK'
    );

    const payload = (notifee.displayNotification as jest.Mock).mock.calls[0][0];
    const serializedPayload = JSON.stringify(payload);

    expect(payload.title).toBe('Transaction saved');
    expect(payload.body).toContain('Expense');
    expect(payload.body).not.toContain('Sensitive Merchant');
    expect(payload.data.rawSms).toMatch(/^redacted_sms len=\d+ hash=[a-f0-9]{8}/);
    expect(serializedPayload).not.toContain('OTP 123456');
    expect(serializedPayload).not.toContain('9876543210');
    expect(serializedPayload).not.toContain('Main Road');
  });

  it('labels saved transfers as self transfers in local notifications', async () => {
    await showTransactionConfirmation(
      'tx_transfer',
      'transfer',
      'Yashbhavsar',
      1,
      '1447',
      'redacted_notification len=91 hash=abcdef12 sender=SUPERM',
      'test',
      'SUPERM'
    );

    const payload = (notifee.displayNotification as jest.Mock).mock.calls[0][0];

    expect(payload.title).toBe('Money movement saved');
    expect(payload.body).toContain('₹1');
    expect(payload.body).not.toContain('Yashbhavsar');
  });

  it('does not label unconfirmed automatic rows as expense or income', async () => {
    await showTransactionConfirmation(
      'tx_uncertain_debit',
      'expense',
      'Unknown merchant',
      20,
      '0719',
      'redacted_sms len=80 hash=abcdef12 sender=HDFC',
      'test',
      'HDFC',
      {
        classificationStatus: 'review_required',
        classificationReason: 'unverified_debit',
      }
    );

    const payload = (notifee.displayNotification as jest.Mock).mock.calls[0][0];

    expect(payload.title).toBe('Transaction saved');
    expect(payload.body).toContain('₹20 saved');
    expect(payload.body).toContain('Review classification in details');
    expect(payload.body).not.toContain('Expense');
    expect(payload.body).not.toContain('Unknown merchant');
  });

  it('stores bug reports with redacted metadata even for legacy raw notification data', async () => {
    const sensitiveBody = 'Rs.99 debited from account 9876543210 at 12 Main Road. OTP 123456.';

    await handleTransactionNotificationEvent({
      type: undefined,
      detail: {
        pressAction: { id: 'report_bug' },
        notification: {
          id: 'failed_notification',
          data: {
            action: 'sms_failed',
            rawSms: sensitiveBody,
            rawSmsKind: 'notification',
            sender: 'GPAY',
            app: 'com.google.android.apps.nbu.paisa.user',
            logicLog: 'Parse failed',
          },
        },
      },
    });

    const stored = await AsyncStorage.getItem('debug_bug_reports');
    const reports = stored ? JSON.parse(stored) : [];
    const serializedReports = JSON.stringify(reports);

    expect(reports).toHaveLength(1);
    expect(reports[0].rawSms).toMatch(/^redacted_notification len=\d+ hash=[a-f0-9]{8}/);
    expect(reports[0].rawSms).toContain('sender=GPAY');
    expect(reports[0].rawSms).toContain('app=com.google.android.apps.nbu.paisa.user');
    expect(serializedReports).not.toContain('OTP 123456');
    expect(serializedReports).not.toContain('9876543210');
    expect(serializedReports).not.toContain('Main Road');
  });

  it('stores bug reports immutably and caps the newest 50 entries', async () => {
    const existingReports = Array.from({ length: 50 }, (_, index) => ({
      id: `old_${index}`,
      timestamp: new Date(Date.now() - index * 1000).toISOString(),
      transactionId: `old_tx_${index}`,
      type: 'sms_failed',
      rawSms: 'redacted_sms len=24 hash=abcdef12 sender=TEST',
      rawSmsKind: 'sms',
      sender: 'TEST',
      logicLog: 'already redacted',
    }));
    await AsyncStorage.setItem('debug_bug_reports', JSON.stringify(existingReports));

    await handleTransactionNotificationEvent({
      type: undefined,
      detail: {
        pressAction: { id: 'report_bug' },
        notification: {
          id: 'failed_notification',
          data: {
            action: 'sms_failed',
            rawSms: 'redacted_sms len=30 hash=12345678 sender=TEST',
            rawSmsKind: 'sms',
            sender: 'TEST',
            logicLog: 'Parse failed',
          },
        },
      },
    });

    const stored = await AsyncStorage.getItem('debug_bug_reports');
    const reports = stored ? JSON.parse(stored) : [];

    expect(reports).toHaveLength(50);
    expect(reports[0].transactionId).toBe('failed_parse');
    expect(reports.some((report: any) => report.id === 'old_49')).toBe(false);
  });

  it('recovers safely from corrupt bug report storage', async () => {
    await AsyncStorage.setItem('debug_bug_reports', '{not-json');

    await handleTransactionNotificationEvent({
      type: undefined,
      detail: {
        pressAction: { id: 'report_bug' },
        notification: {
          id: 'failed_notification',
          data: {
            action: 'sms_failed',
            rawSms: 'redacted_sms len=30 hash=12345678 sender=TEST',
            rawSmsKind: 'sms',
            sender: 'TEST',
            logicLog: 'Parse failed',
          },
        },
      },
    });

    const stored = await AsyncStorage.getItem('debug_bug_reports');
    const reports = stored ? JSON.parse(stored) : [];

    expect(reports).toHaveLength(1);
    expect(reports[0].transactionId).toBe('failed_parse');
    expect(reports[0].rawSms).toMatch(/^redacted_sms len=\d+ hash=[a-f0-9]{8}/);
  });

  it('summarizes parsed SMS logs without extracted sensitive values', () => {
    const serializedSummary = JSON.stringify(summarizeParsedSmsForLog({
      amount: 2841.32,
      balance: 9876543210,
      last4Digits: '2841',
      bankName: 'CODEX28KR BANK',
      transactionType: 'debit',
      merchant: 'CODEX28KR SHOP',
      upiId: 'codex28kr@bank',
      confidence: 100,
      rawText: 'OTP 123456 at 12 Main Road. UPI Ref 284128412841.',
    }));

    expect(serializedSummary).toEqual(JSON.stringify({
      transactionType: 'debit',
      amountPresent: true,
      balancePresent: true,
      accountLast4Present: true,
      bankNamePresent: true,
      merchantPresent: true,
      upiIdPresent: true,
      confidencePresent: true,
    }));
    expect(serializedSummary).not.toContain('CODEX28KR');
    expect(serializedSummary).not.toContain('284128412841');
    expect(serializedSummary).not.toContain('2841.32');
    expect(serializedSummary).not.toContain('9876543210');
    expect(serializedSummary).not.toContain('codex28kr@bank');
    expect(serializedSummary).not.toContain('OTP 123456');
    expect(serializedSummary).not.toContain('Main Road');
  });

  it('shows balance update notifications when called directly', async () => {
    await expect(showFinancialEventNotification({
      route: 'balance_only',
      sourceKind: 'notification',
      amount: 1250,
      direction: 'debit',
      accountLast4: '1234',
      eventId: 'runtime:notification:test:abcdef12',
    })).resolves.toBe('sent');

    const payload = (notifee.displayNotification as jest.Mock).mock.calls[0][0];
    const serializedPayload = JSON.stringify(payload);
    expect(payload.title).toBe('Balance updated');
    expect(payload.android).toMatchObject({
      smallIcon: 'ic_notification',
      color: '#FFFFFF',
    });
    expect(payload.body).toContain('₹1,250');
    expect(serializedPayload).not.toContain('runtime:notification:test:abcdef12');
  });

  it('does not display review-required financial notifications', async () => {
    await expect(showFinancialEventNotification({
      route: 'review_required',
      sourceKind: 'notification',
      amount: 1250,
      direction: 'debit',
      accountLast4: '1234',
      eventId: 'runtime:notification:test:review1234',
    })).resolves.toBe('blocked');

    expect(notifee.displayNotification).not.toHaveBeenCalled();
    expect(notifee.createChannel).not.toHaveBeenCalled();
  });

  it('keeps spam filtering predictable for promo markers and neutral placeholders', () => {
    expect(isSpamMessage('PLACEHOLDER limited time offer apply now')).toBe(true);
    expect(isSpamMessage('PLACEHOLDER balance status captured')).toBe(false);
    expect(isSpamMessage('PLACEHOLDER UPI txn ref 123456789 captured')).toBe(false);
    expect(isSpamMessage('Namaste, PLACEHOLDER credited with INR 10.')).toBe(false);
    expect(getSpamConfidence('PLACEHOLDER limited time offer apply now')).toBeGreaterThan(0);
    expect(getSpamConfidence('PLACEHOLDER balance status captured')).toBe(0);
  });

  it('delegates deprecated processTransactionSMS to the queued processor path', async () => {
    await expect(processTransactionSMS('PLACEHOLDER_TRANSACTION_TEXT', 'TEST')).resolves.toMatchObject({
      success: true,
    });

    expect(enqueueSms).toHaveBeenCalledWith({
      body: 'PLACEHOLDER_TRANSACTION_TEXT',
      sender: 'TEST',
      timestamp: expect.any(Number),
    });
  });

  it('blocks local financial notifications safely when notification permission is denied', async () => {
    (notifee as any).getNotificationSettings = jest.fn(() => Promise.resolve({ authorizationStatus: 0 }));

    await expect(showFinancialEventNotification({
      route: 'balance_only',
      sourceKind: 'sms',
      amount: 99,
      direction: 'credit',
      eventId: 'sig_permission_denied',
    })).resolves.toBe('blocked');

    expect(notifee.displayNotification).not.toHaveBeenCalled();
  });
});
