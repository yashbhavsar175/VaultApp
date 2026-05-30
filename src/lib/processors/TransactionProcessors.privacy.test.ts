import AsyncStorage from '@react-native-async-storage/async-storage';
import NetInfo from '@react-native-community/netinfo';
import { processNotification, processSms } from './TransactionProcessors';
import { supabase } from '../core';
import { showTransactionConfirmation } from '../services/notifications';
import { recordBalanceSignalForUser } from '../services/balanceSignalRecorder';
import {
  recordNotificationTransactionEvidence,
  recordSmsTransactionEvidence,
} from '../services/runtimeTransactionEvidence';

jest.mock('../core', () => ({
  supabase: {
    auth: {
      getSession: jest.fn(),
    },
    from: jest.fn(),
  },
}));

jest.mock('../services/notifications', () => ({
  isSpamMessage: jest.fn(() => false),
  showSmsFailedNotification: jest.fn(),
  showTransactionConfirmation: jest.fn(),
}));

jest.mock('../services/cache', () => ({
  CACHE_KEYS: {
    TRANSACTIONS: 'cache_transactions',
    BANK_ACCOUNTS: 'cache_bank_accounts',
  },
  updateCache: jest.fn(() => Promise.resolve()),
}));

jest.mock('../services/dataEvents', () => ({
  emitFinanceDataChanged: jest.fn(),
}));

jest.mock('../services/balanceSignalRecorder', () => ({
  recordBalanceSignalForUser: jest.fn(async () => ({
    parsed: { isBalanceSignal: false },
    snapshots: [],
    detectedCandidates: [],
    debitCards: [],
    creditCardStatements: [],
  })),
}));

jest.mock('../services/runtimeTransactionEvidence', () => ({
  recordSmsTransactionEvidence: jest.fn(() => Promise.resolve('created')),
  recordNotificationTransactionEvidence: jest.fn(() => Promise.resolve('created')),
}));

type InsertedTransaction = Record<string, any>;

const mockSupabase = supabase as any;
const mockShowTransactionConfirmation = showTransactionConfirmation as jest.Mock;
const mockRecordBalanceSignalForUser = recordBalanceSignalForUser as jest.Mock;
const mockRecordSmsEvidence = recordSmsTransactionEvidence as jest.Mock;
const mockRecordNotificationEvidence = recordNotificationTransactionEvidence as jest.Mock;
const insertedTransactions: InsertedTransaction[] = [];

function setupSupabaseMock() {
  let nextId = 1;

  mockSupabase.auth.getSession.mockResolvedValue({
    data: { session: { user: { id: 'user_1' } } },
  });

  mockSupabase.from.mockImplementation((table: string) => {
    const filters: Record<string, any> = {};

    const builder: any = {
      select: jest.fn(() => builder),
      eq: jest.fn((key: string, value: any) => {
        filters[key] = value;
        return builder;
      }),
      is: jest.fn((key: string, value: any) => {
        filters[key] = value;
        return builder;
      }),
      gte: jest.fn(() => builder),
      order: jest.fn(() => builder),
      limit: jest.fn(async () => {
        if (table === 'bank_accounts') {
          return { data: [{ id: 'bank_1' }], error: null };
        }

        const matches = insertedTransactions.filter(tx => {
          if (filters.user_id && tx.user_id !== filters.user_id) return false;
          if (filters.amount && tx.amount !== filters.amount) return false;
          if (filters.type && tx.type !== filters.type) return false;
          if ('reference_number' in filters && tx.reference_number !== filters.reference_number) return false;
          if ('raw_sms' in filters && tx.raw_sms !== filters.raw_sms) return false;
          return true;
        });

        return { data: matches, error: null };
      }),
      insert: jest.fn((payload: InsertedTransaction) => ({
        select: jest.fn(() => ({
          single: jest.fn(async () => {
            const transaction = {
              id: `tx_${nextId++}`,
              created_at: new Date().toISOString(),
              ...payload,
            };
            insertedTransactions.push(transaction);
            return { data: transaction, error: null };
          }),
        })),
      })),
    };

    return builder;
  });
}

describe('TransactionProcessors raw_sms privacy', () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    insertedTransactions.length = 0;
    await AsyncStorage.clear();
    (NetInfo.fetch as jest.Mock).mockResolvedValue({ isConnected: true });
    mockRecordBalanceSignalForUser.mockResolvedValue({
      parsed: { isBalanceSignal: false },
      snapshots: [],
      detectedCandidates: [],
      debitCards: [],
      creditCardStatements: [],
    });
    setupSupabaseMock();
  });

  it('stores redacted raw_sms for new SMS transactions', async () => {
    const body = 'Rs.31 debited from your HDFC Bank account XX1234 to TASK24D SHOP via UPI. UPI Ref 313131313131. OTP 123456. Call 9876543210.';

    await processSms({ sender: 'HDFCBK', body, timestamp: Date.now() });

    expect(insertedTransactions).toHaveLength(1);
    const rawSms = insertedTransactions[0].raw_sms;
    expect(rawSms).toMatch(/^redacted_sms len=\d+ hash=[a-f0-9]{8}/);
    expect(rawSms).toContain('sender=HDFCBK');
    expect(rawSms).toContain('source=bank');
    expect(rawSms).not.toContain('TASK24D SHOP');
    expect(rawSms).not.toContain('313131313131');
    expect(rawSms).not.toContain('123456');
    expect(rawSms).not.toContain('9876543210');
    expect(insertedTransactions[0]).toEqual(expect.objectContaining({
      amount: 31,
      type: 'expense',
      reference_number: '313131313131',
      account_last4: '1234',
    }));
    expect(mockShowTransactionConfirmation.mock.calls[0][5]).toBe(rawSms);
    expect(mockRecordBalanceSignalForUser).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'user_1',
      sourceType: 'sms',
      senderOrPackage: 'HDFCBK',
    }));
    expect(mockRecordSmsEvidence).toHaveBeenCalledWith(expect.objectContaining({
      text: body,
      sender: 'HDFCBK',
      transactionId: 'tx_1',
      parsed: expect.objectContaining({
        amount: 31,
        reference: '313131313131',
        accountLast4: '1234',
      }),
    }));
  });

  it('stores redacted raw_sms for new notification transactions', async () => {
    const text = 'Rs.42 debited from your HDFC Bank account XX1234 to TASK24D NOTIFY via UPI. UPI Ref 424242424242. OTP 654321. Phone 9876543210.';

    await processNotification({
      notification: JSON.stringify({
        app: 'com.google.android.apps.nbu.paisa.user',
        title: 'HDFCBK',
        text,
        time: Date.now(),
      }),
    });

    expect(insertedTransactions).toHaveLength(1);
    const rawSms = insertedTransactions[0].raw_sms;
    expect(rawSms).toMatch(/^redacted_notification len=\d+ hash=[a-f0-9]{8}/);
    expect(rawSms).toContain('app=com.google.android.apps.nbu.paisa.user');
    expect(rawSms).not.toContain('TASK24D NOTIFY');
    expect(rawSms).not.toContain('424242424242');
    expect(rawSms).not.toContain('654321');
    expect(rawSms).not.toContain('9876543210');
    expect(insertedTransactions[0]).toEqual(expect.objectContaining({
      amount: 42,
      type: 'expense',
      reference_number: '424242424242',
      account_last4: '1234',
    }));
    expect(mockShowTransactionConfirmation.mock.calls[0][5]).toBe(rawSms);
    expect(mockRecordBalanceSignalForUser).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'user_1',
      sourceType: 'notification',
      senderOrPackage: 'com.google.android.apps.nbu.paisa.user',
    }));
    expect(mockRecordNotificationEvidence).toHaveBeenCalledWith(expect.objectContaining({
      text: expect.stringContaining(text),
      sourcePackage: 'com.google.android.apps.nbu.paisa.user',
      sender: 'GPAYID',
      transactionId: 'tx_1',
      parsed: expect.objectContaining({
        amount: 42,
        reference: '424242424242',
      }),
    }));
  });

  it('logs only structural parsed transaction summaries', async () => {
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);
    const sms = 'Rs.31 debited from your HDFC Bank account XX1234 to TASK28K SMS via UPI. UPI Ref 313131313131.';
    const notification = 'Rs.42 debited from your HDFC Bank account XX1234 to TASK28K NOTIFY via UPI. UPI Ref 424242424242.';

    try {
      await processSms({ sender: 'HDFCBK', body: sms, timestamp: Date.now() });
      await processNotification({
        notification: JSON.stringify({
          app: 'com.google.android.apps.nbu.paisa.user',
          title: 'HDFCBK',
          text: notification,
          time: Date.now() + 1000,
        }),
      });

      const parsedLogs = logSpy.mock.calls.filter(([message]) =>
        typeof message === 'string' && message.includes('Parsed Transaction:')
      );

      expect(parsedLogs).toHaveLength(2);
      for (const [, summary] of parsedLogs) {
        expect(summary).toEqual(expect.objectContaining({
          type: 'debit',
          source: expect.stringMatching(/^(bank|upi)$/),
          amountPresent: true,
          balancePresent: false,
          referencePresent: true,
          merchantPresent: true,
          accountLast4Present: true,
          upiIdPresent: false,
        }));
      }

      const serializedLogs = JSON.stringify(parsedLogs);
      expect(serializedLogs).not.toContain('TASK28K');
      expect(serializedLogs).not.toContain('313131313131');
      expect(serializedLogs).not.toContain('424242424242');
      expect(serializedLogs).not.toContain('1234');
    } finally {
      logSpy.mockRestore();
    }
  });

  it('still skips duplicate replay of the same SMS', async () => {
    const body = 'Rs.31 debited from your HDFC Bank account XX1234 to TASK24D SHOP via UPI. UPI Ref 313131313131.';

    await processSms({ sender: 'HDFCBK', body, timestamp: Date.now() });
    await processSms({ sender: 'HDFCBK', body, timestamp: Date.now() + 1000 });

    expect(insertedTransactions).toHaveLength(1);
    expect(mockRecordSmsEvidence).toHaveBeenCalledTimes(2);
    expect(mockRecordSmsEvidence.mock.calls[1][0]).toEqual(expect.objectContaining({
      transactionId: 'tx_1',
    }));
  });

  it('does not fail transaction processing if balance signal recording fails', async () => {
    mockRecordBalanceSignalForUser.mockRejectedValueOnce(new Error('snapshot write failed'));
    const body = 'Rs.31 debited from your HDFC Bank account XX1234 to TASK26D SHOP via UPI. UPI Ref 313131313131.';

    await processSms({ sender: 'HDFCBK', body, timestamp: Date.now() });

    expect(insertedTransactions).toHaveLength(1);
    expect(insertedTransactions[0]).toEqual(expect.objectContaining({
      amount: 31,
      type: 'expense',
      account_last4: '1234',
    }));
  });

  it('does not fail transaction processing if evidence recording fails', async () => {
    mockRecordSmsEvidence.mockRejectedValueOnce(new Error('evidence write failed'));
    const body = 'Rs.31 debited from your HDFC Bank account XX1234 to TASK28J SHOP via UPI. UPI Ref 313131313131.';

    await processSms({ sender: 'HDFCBK', body, timestamp: Date.now() });

    expect(insertedTransactions).toHaveLength(1);
    expect(insertedTransactions[0]).toEqual(expect.objectContaining({
      amount: 31,
      type: 'expense',
      account_last4: '1234',
    }));
  });

  it('does not wait for evidence recording before completing transaction processing', async () => {
    mockRecordSmsEvidence.mockReturnValueOnce(new Promise(() => undefined));
    const body = 'Rs.31 debited from your HDFC Bank account XX1234 to TASK28J NONBLOCKING via UPI. UPI Ref 323232323232.';

    await expect(Promise.race([
      processSms({ sender: 'HDFCBK', body, timestamp: Date.now() }),
      new Promise((_, reject) => setTimeout(() => reject(new Error('processor waited for evidence')), 100)),
    ])).resolves.toBeUndefined();

    expect(insertedTransactions).toHaveLength(1);
  });

  it('records unlinked payment app notification evidence when parsing fails safely', async () => {
    const text = 'Transaction successful for Rs.77 to yash.codex28j@oksbi.';

    await processNotification({
      notification: JSON.stringify({
        app: 'com.google.android.apps.nbu.paisa.user',
        title: 'Google Pay',
        text,
        time: Date.now(),
      }),
    });

    expect(insertedTransactions).toHaveLength(0);
    expect(mockRecordNotificationEvidence).toHaveBeenCalledWith(expect.objectContaining({
      text: expect.stringContaining('Transaction successful for Rs.77'),
      sourcePackage: 'com.google.android.apps.nbu.paisa.user',
      sender: 'GPAYID',
      transactionId: null,
    }));
  });
});
