import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  autoAddBank,
  detectAndSuggestBank,
  getCachedDetectionResult,
} from './bankAutoDetection';
import { addBankAccount, getBankAccounts } from '../database/financial';

jest.mock('react-native-get-sms-android', () => ({}), { virtual: true });

jest.mock('../database/financial', () => ({
  addBankAccount: jest.fn(),
  getBankAccounts: jest.fn(),
  updateBankAccount: jest.fn(),
}));

describe('bank auto detection sampleSMS privacy', () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    await AsyncStorage.clear();
    (getBankAccounts as jest.Mock).mockResolvedValue([]);
  });

  it('redacts sampleSMS for new real-time bank suggestions while preserving account type hint', async () => {
    const body = 'Rs.55 debited from your HDFC Bank account XX1234 to TASK24F STORE via UPI. UPI Ref 555555555555.';

    const result = await detectAndSuggestBank(body, 'HDFCBK');

    expect(result.shouldSuggest).toBe(true);
    expect(result.detectedBank?.sampleSMS).toMatch(/^redacted_sms len=\d+ hash=[a-f0-9]{8}/);
    expect(result.detectedBank?.sampleSMS).toContain('sender=HDFCBK');
    expect(result.detectedBank?.sampleSMS).toContain('source=bank_auto_detection_realtime');
    expect(result.detectedBank?.sampleSMS).not.toContain('TASK24F STORE');
    expect(result.detectedBank?.sampleSMS).not.toContain('555555555555');
    expect(result.detectedBank?.accountTypeHint).toBe('savings');
  });

  it('sanitizes legacy cached sampleSMS and rewrites the local detection cache', async () => {
    await AsyncStorage.setItem('bank_auto_detection_result', JSON.stringify({
      detectedBanks: [
        {
          bankName: 'HDFC Bank',
          senderIds: ['HDFCBK'],
          last4Digits: ['1234'],
          sampleSMS: 'Rs.60 debited from your HDFC Bank credit card XX1234 to TASK24F LEGACY. OTP 123456.',
          confidence: 90,
          firstSeen: '2026-05-28T00:00:00.000Z',
          lastSeen: '2026-05-28T00:00:00.000Z',
          transactionCount: 1,
        },
      ],
      totalSMSScanned: 1,
      timeElapsed: 10,
    }));

    const cached = await getCachedDetectionResult();
    const sampleSMS = cached?.detectedBanks[0].sampleSMS;

    expect(sampleSMS).toMatch(/^redacted_sms len=\d+ hash=[a-f0-9]{8}/);
    expect(sampleSMS).not.toContain('TASK24F LEGACY');
    expect(sampleSMS).not.toContain('OTP');
    expect(sampleSMS).not.toContain('123456');
    expect(cached?.detectedBanks[0].accountTypeHint).toBe('credit_card');

    const rewritten = await AsyncStorage.getItem('bank_auto_detection_result');
    expect(rewritten).not.toContain('TASK24F LEGACY');
  });

  it('uses accountTypeHint after sampleSMS is redacted', async () => {
    await autoAddBank({
      bankName: 'HDFC Bank',
      senderIds: ['HDFCBK'],
      last4Digits: ['1234'],
      sampleSMS: 'redacted_sms len=10 hash=abcdef12 sender=HDFCBK source=bank_auto_detection',
      accountTypeHint: 'credit_card',
      confidence: 90,
      firstSeen: '2026-05-28T00:00:00.000Z',
      lastSeen: '2026-05-28T00:00:00.000Z',
      transactionCount: 1,
    });

    expect(addBankAccount).toHaveBeenCalledWith(expect.objectContaining({
      account_type: 'credit_card',
      account_last4: '1234',
    }));
  });
});

