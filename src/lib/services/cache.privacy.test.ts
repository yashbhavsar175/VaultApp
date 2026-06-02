import AsyncStorage from '@react-native-async-storage/async-storage';
import { getBankAccounts } from '../database/financial';
import { getPeopleLedger, getPlaces } from '../database/userdata';
import { getTransactions, supabase } from '../core';
import { CACHE_KEYS, clearCache, getCached, prefetchAllData, setCache } from './cache';
import { OFFLINE_TX_QUEUE_BASE_KEY, REVIEW_QUEUE_BASE_KEY, getUserScopedQueueKey } from './userScopedQueues';

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
    jest.clearAllMocks();
  });

  it('clears current user financial queues on sign-out cache cleanup without touching another user queue', async () => {
    (supabase.auth.getUser as jest.Mock).mockResolvedValue({
      data: { user: { id: 'user_a' } },
    });
    await AsyncStorage.setItem(getUserScopedQueueKey(OFFLINE_TX_QUEUE_BASE_KEY, 'user_a'), JSON.stringify([
      { user_id: 'user_a', queueOwnerId: 'user_a', amount: 123, note: 'current user queued note' },
    ]));
    await AsyncStorage.setItem(getUserScopedQueueKey(REVIEW_QUEUE_BASE_KEY, 'user_a'), JSON.stringify([
      { user_id: 'user_a', queueOwnerId: 'user_a', id: 'review_a', status: 'pending' },
    ]));
    await AsyncStorage.setItem(getUserScopedQueueKey(OFFLINE_TX_QUEUE_BASE_KEY, 'user_b'), JSON.stringify([
      { user_id: 'user_b', queueOwnerId: 'user_b', amount: 456, note: 'other user queued note' },
    ]));

    await clearCache();

    expect(await AsyncStorage.getItem(getUserScopedQueueKey(OFFLINE_TX_QUEUE_BASE_KEY, 'user_a'))).toBeNull();
    expect(await AsyncStorage.getItem(getUserScopedQueueKey(REVIEW_QUEUE_BASE_KEY, 'user_a'))).toBeNull();
    expect(await AsyncStorage.getItem(getUserScopedQueueKey(OFFLINE_TX_QUEUE_BASE_KEY, 'user_b'))).not.toBeNull();
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

  it('redacts personal profile fields before writing profile cache', async () => {
    await setCache(CACHE_KEYS.USER_PROFILE, {
      email: 'task30a.profile@example.com',
      name: 'Task30A Profile Person',
      full_name: 'Task30A Profile Person',
      phone: '+919876543210',
      currency: 'INR',
    });

    const raw = await AsyncStorage.getItem(CACHE_KEYS.USER_PROFILE);

    expect(raw).toContain('Task30A Profile Person');
    expect(raw).toContain('currency');
    expect(raw).not.toContain('task30a.profile@example.com');
    expect(raw).not.toContain('email');
    expect(raw).not.toContain('+919876543210');
    expect(raw).not.toContain('phone');
    expect(raw).not.toContain('full_name');
  });

  it('redacts legacy personal profile fields when reading profile cache', async () => {
    await AsyncStorage.setItem(CACHE_KEYS.USER_PROFILE, JSON.stringify({
      data: {
        email: 'task30a.legacy@example.com',
        name: 'Task30A Legacy Person',
        full_name: 'Task30A Legacy Person',
        phone: '+919123456789',
      },
      timestamp: Date.now(),
    }));

    const cached = await getCached<any>(CACHE_KEYS.USER_PROFILE);

    expect(cached?.data).toEqual({
      name: 'Task30A Legacy Person',
    });

    const rewritten = await AsyncStorage.getItem(CACHE_KEYS.USER_PROFILE);
    expect(rewritten).not.toContain('task30a.legacy@example.com');
    expect(rewritten).not.toContain('+919123456789');
    expect(rewritten).not.toContain('email');
    expect(rewritten).not.toContain('phone');
    expect(rewritten).not.toContain('full_name');
  });

  it('does not log profile email or raw profile fields during prefetch', async () => {
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const profileSelect = jest.fn().mockReturnValue({
      eq: jest.fn().mockReturnValue({
        single: jest.fn().mockResolvedValue({
          data: { full_name: 'Task28L Profile Person' },
        }),
      }),
    });

    (supabase.auth.getUser as jest.Mock).mockResolvedValue({
      data: {
        user: {
          id: 'user-task-28l-abcdef',
          email: 'task28l.profile@example.com',
        },
      },
    });
    (supabase.from as jest.Mock).mockReturnValue({ select: profileSelect });
    (getBankAccounts as jest.Mock).mockResolvedValue([]);
    (getPlaces as jest.Mock).mockResolvedValue([]);
    (getTransactions as jest.Mock).mockResolvedValue([]);
    (getPeopleLedger as jest.Mock).mockResolvedValue([]);

    try {
      await prefetchAllData();

      const logs = JSON.stringify([
        ...logSpy.mock.calls,
        ...warnSpy.mock.calls,
      ]);

      expect(logs).toContain('profileNamePresent');
      expect(logs).not.toContain('task28l.profile@example.com');
      expect(logs).not.toContain('Task28L Profile Person');
      expect(logs).not.toContain('email');
      expect(logs).not.toContain('full_name');
      expect(logs).not.toContain('user-task-28l-abcdef');

      const cached = await AsyncStorage.getItem(CACHE_KEYS.USER_PROFILE);
      expect(cached).toContain('user-task-28l-abcdef');
      expect(cached).not.toContain('task28l.profile@example.com');
      expect(cached).not.toContain('email');
    } finally {
      logSpy.mockRestore();
      warnSpy.mockRestore();
    }
  });

  it('does not dump raw profile prefetch errors with session or profile data', async () => {
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const sensitiveError = {
      code: 'PGRST123',
      name: 'PostgrestError',
      status: 400,
      message: 'profile lookup failed for task28l.failure@example.com',
      user: { id: 'user-failure-sensitive-123456', email: 'task28l.failure@example.com' },
      session: { access_token: 'raw_failure_token' },
      profile: { full_name: 'Raw Failure Name' },
    };

    (supabase.auth.getUser as jest.Mock).mockResolvedValue({
      data: {
        user: {
          id: 'user-task-28l-failure',
          email: 'task28l.failure@example.com',
        },
      },
    });
    (supabase.from as jest.Mock).mockImplementation(() => {
      throw sensitiveError;
    });
    (getBankAccounts as jest.Mock).mockResolvedValue([]);
    (getPlaces as jest.Mock).mockResolvedValue([]);
    (getTransactions as jest.Mock).mockResolvedValue([]);
    (getPeopleLedger as jest.Mock).mockResolvedValue([]);

    try {
      await prefetchAllData();

      expect(warnSpy).toHaveBeenCalledWith('🚀 [Prefetch] ❌ Profile failed', {
        operation: 'prefetchProfile',
        error: {
          code: 'PGRST123',
          name: 'PostgrestError',
          status: 400,
        },
      });

      const logs = JSON.stringify([
        ...logSpy.mock.calls,
        ...warnSpy.mock.calls,
      ]);

      expect(logs).not.toContain('task28l.failure@example.com');
      expect(logs).not.toContain('user-failure-sensitive-123456');
      expect(logs).not.toContain('raw_failure_token');
      expect(logs).not.toContain('Raw Failure Name');
      expect(logs).not.toContain('access_token');
      expect(logs).not.toContain('full_name');
      expect(logs).not.toContain('session');
    } finally {
      logSpy.mockRestore();
      warnSpy.mockRestore();
    }
  });

  it('does not dump raw Supabase payloads from background prefetch failures', async () => {
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const sensitiveError = {
      code: 'PGRST500',
      name: 'PostgrestError',
      status: 500,
      message: 'failed for task34a.prefetch@example.com',
      session: { access_token: 'raw-prefetch-token' },
      payload: { account: '123456789012', upi: 'private@oksbi' },
    };
    const profileSelect = jest.fn().mockReturnValue({
      eq: jest.fn().mockReturnValue({
        single: jest.fn().mockResolvedValue({
          data: { full_name: 'Task34A Profile Person' },
        }),
      }),
    });

    (supabase.auth.getUser as jest.Mock).mockResolvedValue({
      data: {
        user: {
          id: 'user-task-34a',
          email: 'task34a.prefetch@example.com',
        },
      },
    });
    (supabase.from as jest.Mock).mockReturnValue({ select: profileSelect });
    (getBankAccounts as jest.Mock).mockRejectedValue(sensitiveError);
    (getPlaces as jest.Mock).mockRejectedValue(sensitiveError);
    (getTransactions as jest.Mock).mockRejectedValue(sensitiveError);
    (getPeopleLedger as jest.Mock).mockRejectedValue(sensitiveError);

    try {
      await prefetchAllData();

      const logs = JSON.stringify([
        ...logSpy.mock.calls,
        ...warnSpy.mock.calls,
      ]);

      expect(logs).toContain('PGRST500');
      expect(logs).not.toContain('task34a.prefetch@example.com');
      expect(logs).not.toContain('raw-prefetch-token');
      expect(logs).not.toContain('123456789012');
      expect(logs).not.toContain('private@oksbi');
      expect(logs).not.toContain('access_token');
      expect(logs).not.toContain('session');
      expect(logs).not.toContain('payload');
    } finally {
      logSpy.mockRestore();
      warnSpy.mockRestore();
    }
  });
});
