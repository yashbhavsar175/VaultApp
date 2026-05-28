import AsyncStorage from '@react-native-async-storage/async-storage';
import { CACHE_KEYS, getCached, setCache } from './cache';

jest.mock('../database/financial', () => ({
  getBankAccounts: jest.fn(),
}));

jest.mock('../database/userdata', () => ({
  getPeopleLedger: jest.fn(),
  getPlaces: jest.fn(),
}));

jest.mock('../core', () => ({
  getTransactions: jest.fn(),
  supabase: {
    auth: {
      getUser: jest.fn(),
    },
    from: jest.fn(),
  },
}));

describe('cache privacy sanitization', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
  });

  it('redacts historical transaction raw_sms before writing transaction cache', async () => {
    await setCache(CACHE_KEYS.TRANSACTIONS, [
      {
        id: 'tx_legacy',
        raw_sms: 'Rs.50 debited from account XX1234 to TASK24F CACHE. OTP 123456. Call 9876543210.',
        sms_source: 'bank',
        sms_sender: 'HDFCBK',
      },
    ]);

    const raw = await AsyncStorage.getItem(CACHE_KEYS.TRANSACTIONS);
    expect(raw).toContain('redacted_sms');
    expect(raw).not.toContain('TASK24F CACHE');
    expect(raw).not.toContain('OTP');
    expect(raw).not.toContain('123456');
    expect(raw).not.toContain('9876543210');
  });

  it('redacts legacy transaction cache on read without dropping display fields', async () => {
    await AsyncStorage.setItem(CACHE_KEYS.TRANSACTIONS, JSON.stringify({
      data: [
        {
          id: 'tx_legacy',
          amount: 50,
          note: 'Task24F Cache',
          category: 'Shopping',
          raw_sms: 'Rs.50 debited from account XX1234 to TASK24F CACHE via UPI.',
          sms_source: 'bank',
          sms_sender: 'HDFCBK',
        },
      ],
      timestamp: Date.now(),
    }));

    const cached = await getCached<any[]>(CACHE_KEYS.TRANSACTIONS);

    expect(cached?.data[0]).toEqual(expect.objectContaining({
      id: 'tx_legacy',
      amount: 50,
      note: 'Task24F Cache',
      category: 'Shopping',
    }));
    expect(cached?.data[0].raw_sms).toMatch(/^redacted_sms len=\d+ hash=[a-f0-9]{8}/);

    const rewritten = await AsyncStorage.getItem(CACHE_KEYS.TRANSACTIONS);
    expect(rewritten).not.toContain('TASK24F CACHE via UPI');
  });
});

