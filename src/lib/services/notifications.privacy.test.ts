import AsyncStorage from '@react-native-async-storage/async-storage';
import notifee from '@notifee/react-native';
import {
  handleTransactionNotificationEvent,
  showTransactionConfirmation,
  showSmsFailedNotification,
  summarizeParsedSmsForLog,
} from './notifications';

describe('notification privacy paths', () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    await AsyncStorage.clear();
    (notifee as any).cancelNotification = jest.fn(() => Promise.resolve());
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

    expect(payload.data.rawSms).toMatch(/^redacted_sms len=\d+ hash=[a-f0-9]{8}/);
    expect(serializedPayload).not.toContain('OTP 123456');
    expect(serializedPayload).not.toContain('9876543210');
    expect(serializedPayload).not.toContain('Main Road');
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
});
