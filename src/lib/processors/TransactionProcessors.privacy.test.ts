import AsyncStorage from '@react-native-async-storage/async-storage';
import NetInfo from '@react-native-community/netinfo';
import { processNotification, processSms } from './TransactionProcessors';
import { supabase } from '../core';
import {
  showFinancialEventNotification,
  showTransactionConfirmation,
} from '../services/notifications';
import {
  recordBalanceSignalForUser,
  recordEstimatedBankBalanceMovementForUser,
} from '../services/balanceSignalRecorder';
import { emitFinanceDataChanged } from '../services/dataEvents';
import {
  recordNotificationTransactionEvidence,
  recordSmsTransactionEvidence,
} from '../services/runtimeTransactionEvidence';
import { REVIEW_QUEUE_BASE_KEY, getUserScopedQueueKey } from '../services/userScopedQueues';
import { resolvePaymentAppBankAccountForUser } from '../services/paymentAppAccountMappings';

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
  showFinancialEventNotification: jest.fn(),
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
  recordEstimatedBankBalanceMovementForUser: jest.fn(async () => null),
}));

jest.mock('../services/runtimeTransactionEvidence', () => ({
  recordSmsTransactionEvidence: jest.fn(() => Promise.resolve('created')),
  recordNotificationTransactionEvidence: jest.fn(() => Promise.resolve('created')),
}));

jest.mock('../services/paymentAppAccountMappings', () => ({
  resolvePaymentAppBankAccountForUser: jest.fn(async () => null),
}));

type InsertedTransaction = Record<string, any>;

const mockSupabase = supabase as any;
const mockShowFinancialEventNotification = showFinancialEventNotification as jest.Mock;
const mockShowTransactionConfirmation = showTransactionConfirmation as jest.Mock;
const mockRecordBalanceSignalForUser = recordBalanceSignalForUser as jest.Mock;
const mockRecordEstimatedBankBalanceMovementForUser = recordEstimatedBankBalanceMovementForUser as jest.Mock;
const mockEmitFinanceDataChanged = emitFinanceDataChanged as jest.Mock;
const mockRecordSmsEvidence = recordSmsTransactionEvidence as jest.Mock;
const mockRecordNotificationEvidence = recordNotificationTransactionEvidence as jest.Mock;
const mockResolvePaymentAppBankAccount = resolvePaymentAppBankAccountForUser as jest.Mock;
const insertedTransactions: InsertedTransaction[] = [];
let matchedBankAccounts = [{ id: 'bank_1' }];
let profileFullName: string | null = null;

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
      update: jest.fn(() => builder),
      single: jest.fn(async () => {
        if (table === 'profiles') {
          return { data: { full_name: profileFullName }, error: null };
        }
        return { data: null, error: null };
      }),
      limit: jest.fn(async () => {
        if (table === 'bank_accounts') {
          return { data: matchedBankAccounts, error: null };
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
    matchedBankAccounts = [{ id: 'bank_1' }];
    profileFullName = null;
    await AsyncStorage.clear();
    (NetInfo.fetch as jest.Mock).mockResolvedValue({ isConnected: true });
    mockRecordBalanceSignalForUser.mockResolvedValue({
      parsed: { isBalanceSignal: false },
      snapshots: [],
      detectedCandidates: [],
      debitCards: [],
      creditCardStatements: [],
    });
    mockRecordEstimatedBankBalanceMovementForUser.mockResolvedValue(null);
    mockResolvePaymentAppBankAccount.mockResolvedValue(null);
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
    const text = 'Rs.42 debited from your HDFC Bank account XX1234 to TASK24D SHOP via UPI. UPI Ref 424242424242. OTP 654321. Phone 9876543210.';

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

  it.each([
    ['phone-like', '9876543210'],
    ['arbitrary', 'private.sender.value'],
    ['bank token', 'HDFCBK'],
  ])('redacts %s incoming SMS senders before filtering', async (_label, sender) => {
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);

    try {
      await processSms({
        sender,
        body: 'Task40F sender privacy probe',
        timestamp: Date.now(),
      });

      const serializedLogs = JSON.stringify(logSpy.mock.calls);
      expect(serializedLogs).not.toContain(sender);
      expect(serializedLogs).toContain('senderPresent');
      expect(serializedLogs).toContain('senderKind');
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

  it('routes HDFC sent debit to the profile name as self-transfer review instead of expense', async () => {
    profileFullName = 'Yash Bhavsar';
    const body = 'Sent Rs.20.00 From HDFC Bank A/C *0719 To BHAVSAR YASH On 03/06/26 Ref 615411041468';

    await processSms({ sender: 'AD-HDFCBK-S', body, timestamp: Date.now() });

    expect(insertedTransactions).toHaveLength(0);
    const queue = JSON.parse(await AsyncStorage.getItem(getUserScopedQueueKey(REVIEW_QUEUE_BASE_KEY, 'user_1')) || '[]');
    expect(queue).toHaveLength(1);
    expect(queue[0].candidate).toEqual(expect.objectContaining({
      autoClass: 'self_transfer',
      direction: 'neutral',
      amount: 20,
      accountLast4: '0719',
      reference: '615411041468',
    }));
    expect(mockShowTransactionConfirmation).not.toHaveBeenCalled();
    expect(mockShowFinancialEventNotification).toHaveBeenCalledWith(expect.objectContaining({
      route: 'review_queue',
      sourceKind: 'sms',
      amount: 20,
      direction: 'neutral',
      accountLast4: '0719',
    }));
    const serializedQueue = JSON.stringify(queue);
    expect(serializedQueue).not.toContain(body);
    expect(serializedQueue).not.toContain('BHAVSAR YASH');
  });

  it('merges HDFC self debit and near-time GPay paid-you notification into one self-transfer review item', async () => {
    profileFullName = 'Yash Bhavsar';
    const timestamp = Date.now();
    const smsText = 'Sent Rs.20.00 From HDFC Bank A/C *0719 To BHAVSAR YASH On 03/06/26 Ref 615413129779';
    const gpayTitle = 'BHAVSAR YASH paid you ₹20.00';
    const gpayText = 'Paid via SuperMoney UPI';

    await processSms({
      sender: 'AD-HDFCBK-S',
      body: smsText,
      timestamp,
    });
    await processNotification({
      notification: JSON.stringify({
        app: 'com.google.android.apps.nbu.paisa.user',
        title: gpayTitle,
        text: gpayText,
        time: timestamp + 60_000,
      }),
    });

    expect(insertedTransactions).toHaveLength(0);
    const queue = JSON.parse(await AsyncStorage.getItem(getUserScopedQueueKey(REVIEW_QUEUE_BASE_KEY, 'user_1')) || '[]');
    expect(queue).toHaveLength(1);
    expect(queue[0].candidate).toEqual(expect.objectContaining({
      autoClass: 'self_transfer',
      direction: 'neutral',
      amount: 20,
      accountLast4: '0719',
      reference: '615413129779',
    }));
    expect(queue[0].reasons).toEqual(expect.arrayContaining([
      'Self transfer needs confirmation',
      'Paired bank debit and payment-app credit need transfer review',
    ]));
    expect(mockShowTransactionConfirmation).not.toHaveBeenCalled();
    expect(mockShowFinancialEventNotification).toHaveBeenCalledWith(expect.objectContaining({
      route: 'review_queue',
      sourceKind: 'sms',
      amount: 20,
      direction: 'neutral',
      accountLast4: '0719',
    }));
    expect(mockRecordSmsEvidence).toHaveBeenCalledWith(expect.objectContaining({
      transactionId: null,
    }));
    expect(mockRecordNotificationEvidence).toHaveBeenCalledWith(expect.objectContaining({
      transactionId: null,
    }));

    const serializedQueue = JSON.stringify(queue);
    expect(serializedQueue).not.toContain(smsText);
    expect(serializedQueue).not.toContain(gpayTitle);
    expect(serializedQueue).not.toContain(gpayText);
    expect(serializedQueue).not.toContain('BHAVSAR YASH');
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

  it('emits a balance refresh after an exact balance snapshot is recorded', async () => {
    mockRecordBalanceSignalForUser.mockResolvedValueOnce({
      parsed: {
        isBalanceSignal: true,
        redactedSource: { hash: 'abcdef12' },
      },
      snapshots: [{ id: 'balance_exact_1' }],
      detectedCandidates: [],
      debitCards: [],
      creditCardStatements: [],
    });
    const body = 'Rs.31 debited from your HDFC Bank account XX1234 to TASK36D SHOP via UPI. Avl Bal Rs.12000. Ref 353535353535.';

    await processSms({ sender: 'HDFCBK', body, timestamp: Date.now() });

    expect(mockEmitFinanceDataChanged).toHaveBeenCalledWith({
      areas: ['accounts', 'balances'],
      source: 'sms:balance_signal',
    });
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
    const body = 'Rs.31 debited from your HDFC Bank account XX1234 to TASK28J SHOP via UPI. UPI Ref 323232323232.';

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

  it.each([
    ['cash deposit credit', 'Rs.11000 cash deposited into your HDFC Bank account XX1234. Ref 111111111111.'],
    ['family debit', 'Rs.11000 debited from your HDFC Bank account XX1234 to brother via UPI. Ref 222222222222.'],
    ['generic credit', 'Rs.11000 credited to your HDFC Bank account XX1234 via UPI. Ref 333333333333.'],
    ['cash withdrawal', 'Rs.11000 withdrawn from your HDFC Bank account XX1234 at ATM. Ref 444444444444.'],
    ['credit card bill payment', 'Rs.11000 debited from your HDFC Bank account XX1234 for credit card bill payment. Ref 555555555555.'],
    ['self transfer', 'Rs.11000 debited and transferred from your HDFC account XX1234 to your own account. Ref 666666666666.'],
  ])('routes %s to Review Queue without creating a transaction', async (_label, body) => {
    await processSms({ sender: 'HDFCBK', body, timestamp: Date.now() });

    expect(insertedTransactions).toHaveLength(0);
    expect(mockRecordSmsEvidence).toHaveBeenCalledWith(expect.objectContaining({
      text: body,
      sender: 'HDFCBK',
      transactionId: null,
    }));

    const queue = JSON.parse(await AsyncStorage.getItem(getUserScopedQueueKey(REVIEW_QUEUE_BASE_KEY, 'user_1')) || '[]');
    expect(queue).toHaveLength(1);
    expect(queue[0].status).toBe('pending');
    if (_label === 'self transfer') {
      expect(mockShowFinancialEventNotification).toHaveBeenCalledWith(expect.objectContaining({
        route: 'review_queue',
        amount: 11000,
        direction: 'neutral',
      }));
    } else {
      expect(mockShowFinancialEventNotification).not.toHaveBeenCalledWith(expect.objectContaining({
        route: 'review_queue',
      }));
    }
    expect(JSON.stringify(queue[0])).not.toContain(body);
    if (_label === 'family debit') {
      expect(JSON.stringify(queue[0])).not.toContain('brother');
    }
  });

  it('emits review and balance refresh after a review-routed matched credit without creating income', async () => {
    mockRecordEstimatedBankBalanceMovementForUser.mockResolvedValueOnce({
      id: 'balance_estimate_1',
      balance_kind: 'current_balance',
    });
    const body = 'Rs.11000 credited to your HDFC Bank account XX1234 via UPI. Ref 333333333333.';

    await processSms({ sender: 'HDFCBK', body, timestamp: Date.now() });

    expect(insertedTransactions).toHaveLength(0);
    expect(mockRecordEstimatedBankBalanceMovementForUser).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'user_1',
      bankAccountId: 'bank_1',
      amount: 11000,
      direction: 'credit',
      sourceType: 'sms',
    }));
    const queue = JSON.parse(await AsyncStorage.getItem(getUserScopedQueueKey(REVIEW_QUEUE_BASE_KEY, 'user_1')) || '[]');
    expect(queue[0].reasons).toEqual([
      'Credit needs confirmation before counting as income',
    ]);
    expect(mockEmitFinanceDataChanged).toHaveBeenCalledWith(expect.objectContaining({
      areas: ['balances'],
      source: 'sms:balance_estimate',
    }));
    expect(mockEmitFinanceDataChanged).toHaveBeenCalledWith(expect.objectContaining({
      areas: ['review'],
      source: 'sms:review',
    }));
    expect(mockShowFinancialEventNotification).not.toHaveBeenCalledWith(expect.objectContaining({
      route: 'review_queue',
    }));
  });

  it('merges paired HDFC card-payment SMS and Gmail alert into one card-payment review item', async () => {
    const timestamp = Date.now();
    const gmailText = 'Rs.589.00 debited from account ending 0719 towards VPA gpay-creditcard@okpayaxis Google India Digital Services Pvt Ltd. UPI transaction reference no. 124115794477';
    const smsText = 'Sent Rs.589.00 from HDFC Bank A/C *0719 to Google India Digital Serv Ref 124115794477. PAYMENT OF Rs.589.00 RECEIVED TOWARDS YOUR CREDIT CARD ENDING WITH 2246. Available limit is Rs.82999.86';

    await processNotification({
      notification: JSON.stringify({
        app: 'com.google.android.apps.nbu.paisa.user',
        title: 'HDFC InstaAlerts',
        text: gmailText,
        time: timestamp,
      }),
    });
    await processSms({
      sender: 'AD-HDFCBK-S',
      body: smsText,
      timestamp: timestamp + 1000,
    });

    expect(insertedTransactions).toHaveLength(0);
    const queue = JSON.parse(await AsyncStorage.getItem(getUserScopedQueueKey(REVIEW_QUEUE_BASE_KEY, 'user_1')) || '[]');
    expect(queue).toHaveLength(1);
    expect(queue[0].candidate).toEqual(expect.objectContaining({
      autoClass: 'credit_card_bill_payment',
      direction: 'neutral',
      amount: 589,
      accountLast4: '0719',
      cardLast4: '2246',
      last4: '2246',
      reference: '124115794477',
      instrumentHint: 'credit_card',
    }));
    const serializedQueue = JSON.stringify(queue);
    expect(serializedQueue).not.toContain(gmailText);
    expect(serializedQueue).not.toContain(smsText);
    expect(serializedQueue).not.toContain('gpay-creditcard@okpayaxis');
    expect(mockRecordNotificationEvidence).toHaveBeenCalledWith(expect.objectContaining({
      transactionId: null,
    }));
    expect(mockRecordSmsEvidence).toHaveBeenCalledWith(expect.objectContaining({
      transactionId: null,
    }));
  });

  it('does not estimate a balance against an ambiguous same-last4 bank account', async () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    matchedBankAccounts = [{ id: 'bank_1' }, { id: 'bank_2' }];
    const body = 'Rs.11000 credited to your HDFC Bank account XX1234 via UPI. Ref 343434343434.';

    try {
      await processSms({ sender: 'HDFCBK', body, timestamp: Date.now() });

      expect(insertedTransactions).toHaveLength(0);
      expect(mockRecordEstimatedBankBalanceMovementForUser).not.toHaveBeenCalled();
      expect(mockEmitFinanceDataChanged).toHaveBeenCalledWith(expect.objectContaining({
        areas: ['review'],
        source: 'sms:review',
      }));
      expect(warnSpy).toHaveBeenCalledWith(
        '[TransactionProcessors] Ambiguous bank account match; leaving transaction unlinked',
        { matches: 2 }
      );
    } finally {
      warnSpy.mockRestore();
    }
  });

  it('queues mapped super.money credit with destination account context without auto-counting income', async () => {
    matchedBankAccounts = [];
    mockResolvePaymentAppBankAccount.mockResolvedValueOnce({
      sourcePackage: 'money.super.payments',
      sourceLabel: 'Super.money',
      bankHint: 'slice',
      bankHintLabel: 'Slice',
      bankHintHash: 'abcdef12',
      mappingStatus: 'user_confirmed',
      mappedBankAccountId: 'bank_slice_1',
      mappedBankAccountLast4: '5235',
      mappedBankName: 'Slice',
    });
    mockRecordEstimatedBankBalanceMovementForUser.mockResolvedValueOnce({
      id: 'balance_estimate_1',
      balance_kind: 'current_balance',
    });

    await processNotification({
      notification: JSON.stringify({
        app: 'money.super.payments',
        text: '₹103.00 received from PRIVATE PERSON. Deposited in your slice bank.',
        time: Date.now(),
      }),
    });

    expect(insertedTransactions).toHaveLength(0);
    const queue = JSON.parse(await AsyncStorage.getItem(getUserScopedQueueKey(REVIEW_QUEUE_BASE_KEY, 'user_1')) || '[]');
    expect(queue).toHaveLength(1);
    expect(queue[0].candidate.paymentAppAccountMatch).toEqual(expect.objectContaining({
      mappingStatus: 'user_confirmed',
      mappedBankAccountId: 'bank_slice_1',
      mappedBankAccountLast4: '5235',
    }));
    expect(JSON.stringify(queue)).not.toContain('PRIVATE PERSON');
    expect(mockRecordEstimatedBankBalanceMovementForUser).toHaveBeenCalledWith(expect.objectContaining({
      bankAccountId: 'bank_slice_1',
      amount: 103,
      direction: 'credit',
      sourceType: 'notification',
      reason: 'app_mapping',
    }));
    expect(mockShowFinancialEventNotification).not.toHaveBeenCalledWith(expect.objectContaining({
      route: 'review_queue',
    }));
  });

  it('logs review route decisions without raw notification text or full UPI', async () => {
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);
    const text = 'Rs.103.00 received from PRIVATE PERSON at yash.private@oksbi. Deposited in your slice bank.';

    try {
      await processNotification({
        notification: JSON.stringify({
          app: 'money.super.payments',
          text,
          time: Date.now(),
        }),
      });

      const routeLogs = logSpy.mock.calls.filter(([message]) =>
        typeof message === 'string' && message.includes('[AutoTransactionDebug] Route decision')
      );
      expect(routeLogs.length).toBeGreaterThan(0);
      const serializedLogs = JSON.stringify(routeLogs);
      expect(serializedLogs).toContain('review_queue');
      expect(serializedLogs).toContain('notification');
      expect(serializedLogs).not.toContain('PRIVATE PERSON');
      expect(serializedLogs).not.toContain('yash.private@oksbi');
      expect(serializedLogs).not.toContain(text);
    } finally {
      logSpy.mockRestore();
    }
  });

  it('requests a safe balance-updated notification only after a balance signal is recorded', async () => {
    mockRecordBalanceSignalForUser.mockResolvedValueOnce({
      parsed: {
        isBalanceSignal: true,
        redactedSource: { hash: 'abcdef12' },
      },
      snapshots: [{ id: 'balance_only_1' }],
      detectedCandidates: [],
      debitCards: [],
      creditCardStatements: [],
    });

    await processSms({
      sender: 'HDFCBK',
      body: 'Available balance in your HDFC Bank account XX1234 is Rs.12000.',
      timestamp: Date.now(),
    });

    expect(insertedTransactions).toHaveLength(0);
    expect(mockShowFinancialEventNotification).toHaveBeenCalledWith(expect.objectContaining({
      route: 'balance_only',
      sourceKind: 'sms',
    }));
  });

  it('queues unknown super.money destination for account confirmation without inventing a balance', async () => {
    matchedBankAccounts = [];
    mockResolvePaymentAppBankAccount.mockResolvedValueOnce({
      sourcePackage: 'money.super.payments',
      sourceLabel: 'Super.money',
      bankHint: 'slice',
      bankHintLabel: 'Slice',
      bankHintHash: 'abcdef12',
      mappingStatus: 'needs_review',
    });

    await processNotification({
      notification: JSON.stringify({
        app: 'money.super.payments',
        text: '₹103.00 received from PRIVATE PERSON. Deposited in your slice bank.',
        time: Date.now(),
      }),
    });

    expect(insertedTransactions).toHaveLength(0);
    expect(mockRecordEstimatedBankBalanceMovementForUser).not.toHaveBeenCalled();
    const queue = JSON.parse(await AsyncStorage.getItem(getUserScopedQueueKey(REVIEW_QUEUE_BASE_KEY, 'user_1')) || '[]');
    expect(queue[0].candidate.paymentAppAccountMatch).toEqual(expect.objectContaining({
      bankHint: 'slice',
      mappingStatus: 'needs_review',
    }));
    expect(queue[0].reasons).toContain('Destination account needs confirmation');
    expect(JSON.stringify(queue)).not.toContain('PRIVATE PERSON');
  });

  it('emits a balance refresh after a review-routed matched debit estimate', async () => {
    mockRecordEstimatedBankBalanceMovementForUser.mockResolvedValueOnce({
      id: 'balance_estimate_1',
      balance_kind: 'current_balance',
    });
    const body = 'Rs.11000 withdrawn from your HDFC Bank account XX1234 at ATM. Ref 363636363636.';

    await processSms({ sender: 'HDFCBK', body, timestamp: Date.now() });

    expect(insertedTransactions).toHaveLength(0);
    expect(mockRecordEstimatedBankBalanceMovementForUser).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'user_1',
      bankAccountId: 'bank_1',
      amount: 11000,
      direction: 'debit',
      sourceType: 'sms',
    }));
    expect(mockEmitFinanceDataChanged).toHaveBeenCalledWith({
      areas: ['balances'],
      source: 'sms:balance_estimate',
    });
  });

  it('still auto-posts salary income with structured proof', async () => {
    const body = 'Salary of Rs.30000 credited to your HDFC Bank account XX1234. Ref 777777777777.';

    await processSms({ sender: 'HDFCBK', body, timestamp: Date.now() });

    expect(insertedTransactions).toHaveLength(1);
    expect(insertedTransactions[0]).toEqual(expect.objectContaining({
      amount: 30000,
      type: 'income',
    }));
  });
});
