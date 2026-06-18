import AsyncStorage from '@react-native-async-storage/async-storage';
import NetInfo from '@react-native-community/netinfo';

type MockRow = Record<string, any>;

const mockDb: Record<string, MockRow[]> = {
  transactions: [],
  bank_accounts: [],
  profiles: [{ id: 'user_1', full_name: 'YASH LALIT' }],
};
let mockAuthUser: { id: string } | null = { id: 'user_1' };
let mockIdCounter = 0;

function tableRows(table: string): MockRow[] {
  return mockDb[table] || [];
}

function createQueryBuilder(table: string) {
  const filters: Array<(row: MockRow) => boolean> = [];
  let insertRow: MockRow | null = null;
  let updatePatch: MockRow | null = null;
  let orderColumn: string | null = null;
  let orderAscending = true;

  const rows = () => {
    const filtered = tableRows(table).filter(row => filters.every(filter => filter(row)));
    if (orderColumn) {
      filtered.sort((left, right) => {
        const leftValue = Date.parse(left[orderColumn!] || '') || 0;
        const rightValue = Date.parse(right[orderColumn!] || '') || 0;
        return orderAscending ? leftValue - rightValue : rightValue - leftValue;
      });
    }
    return filtered;
  };

  const builder: any = {
    select: jest.fn(() => builder),
    eq: jest.fn((column: string, value: unknown) => {
      filters.push(row => row[column] === value);
      return builder;
    }),
    is: jest.fn((column: string, value: unknown) => {
      filters.push(row => value === null ? row[column] == null : row[column] === value);
      return builder;
    }),
    gte: jest.fn((column: string, value: string) => {
      const threshold = Date.parse(value);
      filters.push(row => (Date.parse(row[column] || '') || 0) >= threshold);
      return builder;
    }),
    order: jest.fn((column: string, options?: { ascending?: boolean }) => {
      orderColumn = column;
      orderAscending = options?.ascending !== false;
      return builder;
    }),
    limit: jest.fn(async (count: number) => ({
      data: rows().slice(0, count),
      error: null,
    })),
    insert: jest.fn((payload: MockRow) => {
      insertRow = {
        id: `tx_${++mockIdCounter}`,
        created_at: new Date().toISOString(),
        ...payload,
      };
      tableRows(table).unshift(insertRow);
      return builder;
    }),
    update: jest.fn((patch: MockRow) => {
      updatePatch = patch;
      return builder;
    }),
    single: jest.fn(async () => {
      if (updatePatch) {
        const target = rows()[0];
        if (!target) return { data: null, error: { code: 'PGRST116' } };
        Object.assign(target, updatePatch);
        return { data: target, error: null };
      }
      return { data: insertRow || rows()[0] || null, error: null };
    }),
  };

  return builder;
}

const mockSupabase = {
  auth: {
    getUser: jest.fn(async () => ({ data: { user: mockAuthUser }, error: null })),
  },
  from: jest.fn((table: string) => createQueryBuilder(table)),
};

jest.mock('../core', () => ({
  supabase: mockSupabase,
}));

jest.mock('../services/notifications', () => ({
  isSpamMessage: jest.fn(() => false),
  showFinancialEventNotification: jest.fn(() => Promise.resolve('sent')),
  showSmsFailedNotification: jest.fn(() => Promise.resolve()),
  showTransactionConfirmation: jest.fn(() => Promise.resolve()),
}));

jest.mock('../services/cache', () => ({
  CACHE_KEYS: {
    BANK_ACCOUNTS: 'bank_accounts',
    TRANSACTIONS: 'transactions',
  },
  updateCache: jest.fn((_key, updater) => Promise.resolve(updater([]))),
}));

jest.mock('../services/dataEvents', () => ({
  emitFinanceDataChanged: jest.fn(),
}));

jest.mock('../services/balanceSignalRecorder', () => ({
  recordBalanceSignalForUser: jest.fn(() => Promise.resolve({
    parsed: { isBalanceSignal: false, redactedSource: { hash: 'hash' } },
    snapshots: [],
    detectedCandidates: [],
    debitCards: [],
    creditCardStatements: [],
  })),
  recordEstimatedBankBalanceMovementForUser: jest.fn(() => Promise.resolve(null)),
}));

jest.mock('../services/runtimeTransactionEvidence', () => ({
  recordNotificationTransactionEvidence: jest.fn(() => Promise.resolve('inserted')),
  recordSmsTransactionEvidence: jest.fn(() => Promise.resolve('inserted')),
}));

jest.mock('../services/paymentAppAccountMappings', () => ({
  resolvePaymentAppBankAccountForUser: jest.fn(() => Promise.resolve(null)),
}));

jest.mock('../services/userScopedQueues', () => ({
  OFFLINE_TX_QUEUE_BASE_KEY: 'offline_tx_queue',
  appendUserScopedQueueItem: jest.fn(() => Promise.resolve()),
}));

const { processNotification, processSms } = require('./TransactionProcessors') as typeof import('./TransactionProcessors');
const {
  showFinancialEventNotification,
  showTransactionConfirmation,
} = require('../services/notifications') as typeof import('../services/notifications');
const { emitFinanceDataChanged } = require('../services/dataEvents') as typeof import('../services/dataEvents');

describe('background transaction processors', () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    await AsyncStorage.clear();
    mockDb.transactions = [];
    mockDb.bank_accounts = [];
    mockDb.profiles = [{ id: 'user_1', full_name: 'YASH LALIT' }];
    mockAuthUser = { id: 'user_1' };
    mockIdCounter = 0;
    (NetInfo.fetch as jest.Mock).mockResolvedValue({ isConnected: true });
    await AsyncStorage.setItem('app_user_id', 'user_1');
  });

  it('does not process SMS or show app notifications without an active auth user', async () => {
    mockAuthUser = null;
    await AsyncStorage.setItem('app_user_id', 'stale_user');

    await processSms({
      sender: 'JK-BOBSMS-S',
      body: 'Rs.1.00 Dr. from A/C XXXXX5191 and Cr. to 6351300811. Ref:61565238943.',
      timestamp: Date.now(),
    });

    expect(mockDb.transactions).toHaveLength(0);
    expect(showTransactionConfirmation).not.toHaveBeenCalled();
    expect(showFinancialEventNotification).not.toHaveBeenCalled();
    await expect(AsyncStorage.getItem('app_user_id')).resolves.toBeNull();
  });

  it('does not process when Supabase session exists but local login marker is missing', async () => {
    await AsyncStorage.removeItem('app_user_id');

    await processSms({
      sender: 'JK-BOBSMS-S',
      body: 'Rs.1.00 Dr. from A/C XXXXX5191 and Cr. to 6351300811. Ref:61565238943.',
      timestamp: Date.now(),
    });

    expect(mockDb.transactions).toHaveLength(0);
    expect(showTransactionConfirmation).not.toHaveBeenCalled();
    expect(showFinancialEventNotification).not.toHaveBeenCalled();
  });

  it('collapses UPI credit, debit SMS, and bank credit SMS into one pending transfer row', async () => {
    const now = Date.now();
    mockDb.bank_accounts = [
      { id: 'bank_bob_5191', user_id: 'user_1', bank_name: 'Bank of Baroda', account_last4: '5191' },
      { id: 'bank_kotak_1447', user_id: 'user_1', bank_name: 'Kotak', account_last4: '1447' },
    ];

    const firstResult = await processNotification({
      app: 'com.google.android.apps.nbu.paisa.user',
      title: '₹1.00 received from YASH LALIT',
      text: 'Amount credited to XX1447. Check out details.',
      time: now,
    });
    await processSms({
      sender: 'JK-BOBSMS-S',
      body: 'Rs.1.00 Dr. from A/C XXXXX5191 and Cr. to 6351300811. Ref:61565238943.',
      timestamp: now + 1000,
    });
    await processSms({
      sender: 'AX-KOTAKB-S',
      body: 'Received Rs.1.00 in your Kotak Bank account XX1447 via UPI Ref:615682430826.',
      timestamp: now + 2000,
    });

    expect(mockDb.transactions).toHaveLength(1);
    expect(mockDb.transactions[0]).toEqual(expect.objectContaining({
      amount: 1,
      type: 'transfer',
      note: 'Bank of Baroda to Kotak',
      category: 'Transfers',
      from_account_id: 'bank_bob_5191',
      to_account_id: 'bank_kotak_1447',
      is_transfer_pending: true,
    }));
    expect(showTransactionConfirmation).not.toHaveBeenCalled();
    expect(firstResult).toEqual(expect.objectContaining({
      transactionId: mockDb.transactions[0].id,
      type: 'transfer',
      note: 'Bank to Bank',
      amount: 1,
      classificationOptions: expect.objectContaining({
        classificationReason: 'self_transfer',
        classificationStatus: 'ignored',
      }),
    }));
    expect(emitFinanceDataChanged).toHaveBeenCalledWith(expect.objectContaining({
      source: 'notification:transaction',
      transactionId: mockDb.transactions[0].id,
    }));
  });

  it('cleans the display name when mirror evidence converts an existing row to transfer', async () => {
    const now = Date.now();
    mockDb.bank_accounts = [
      { id: 'bank_bob_5191', user_id: 'user_1', bank_name: 'Bank of Baroda', account_last4: '5191' },
      { id: 'bank_kotak_1447', user_id: 'user_1', bank_name: 'Kotak', account_last4: '1447' },
    ];

    await processNotification({
      app: 'money.super.payments',
      title: '₹1.00 received from OTHER PERSON',
      text: 'Deposited into your Kotak Bank AC X1447. Tap to view details.',
      time: now,
    });
    const upgradeResult = await processSms({
      sender: 'JK-BOBSMS-S',
      body: 'Rs.1.00 Dr. from A/C XXXXX5191 and Cr. to 6351300811. Ref:61565238943.',
      timestamp: now + 1000,
    });

    expect(mockDb.transactions).toHaveLength(1);
    expect(mockDb.transactions[0]).toEqual(expect.objectContaining({
      amount: 1,
      type: 'transfer',
      note: 'Bank of Baroda to Kotak',
      category: 'Transfers',
      from_account_id: 'bank_bob_5191',
      to_account_id: 'bank_kotak_1447',
      is_transfer_pending: true,
    }));
    expect(showTransactionConfirmation).not.toHaveBeenCalled();
    expect(upgradeResult).toEqual(expect.objectContaining({
      transactionId: mockDb.transactions[0].id,
      type: 'transfer',
      note: 'Bank of Baroda to Kotak',
      amount: 1,
      accountLast4: '1447',
      classificationOptions: expect.objectContaining({
        classificationReason: 'self_transfer',
        classificationStatus: 'ignored',
      }),
    }));
  });

  it('classifies own-name payment credit notifications as self transfers', async () => {
    const now = Date.now();
    mockDb.profiles = [{ id: 'user_1', full_name: 'Yashbhavsar' }];
    mockDb.bank_accounts = [
      { id: 'bank_kotak_1447', user_id: 'user_1', bank_name: 'Kotak', account_last4: '1447' },
    ];

    const result = await processNotification({
      app: 'money.super.payments',
      title: '₹1.00 received from YASH LALITKUMAR BHAVSAR',
      text: 'Deposited into your Kotak Bank AC X1447. Tap to view details.',
      time: now,
    });

    expect(mockDb.transactions).toHaveLength(1);
    expect(mockDb.transactions[0]).toEqual(expect.objectContaining({
      amount: 1,
      type: 'transfer',
      note: 'Bank to Bank',
      category: 'Transfers',
      to_account_id: 'bank_kotak_1447',
      is_transfer_pending: true,
    }));
    expect(JSON.stringify(mockDb.transactions[0])).not.toContain('YASH LALITKUMAR BHAVSAR');
    expect(showTransactionConfirmation).not.toHaveBeenCalled();
    expect(result).toEqual(expect.objectContaining({
      transactionId: mockDb.transactions[0].id,
      type: 'transfer',
      note: 'Bank to Bank',
      amount: 1,
      accountLast4: '1447',
      classificationOptions: expect.objectContaining({
        classificationReason: 'self_transfer',
        classificationStatus: 'ignored',
      }),
    }));
  });

  it('saves a generic debit immediately but leaves it uncounted for detail classification', async () => {
    const result = await processSms({
      sender: 'AD-HDFCBK',
      body: 'Rs.20.00 debited from A/C XX0719. Ref 123456789.',
      timestamp: Date.now(),
    });

    expect(mockDb.transactions).toHaveLength(1);
    expect(mockDb.transactions[0]).toEqual(expect.objectContaining({
      amount: 20,
      type: 'expense',
      account_match_status: 'review_required',
      account_match_reason: 'unverified_debit',
    }));
    expect(showTransactionConfirmation).not.toHaveBeenCalled();
    expect(result).toEqual(expect.objectContaining({
      transactionId: mockDb.transactions[0].id,
      type: 'expense',
      amount: 20,
      accountLast4: '0719',
      classificationOptions: expect.objectContaining({
        classificationReason: 'unverified_debit',
        classificationStatus: 'review_required',
      }),
    }));
  });

  it('saves a generic credit immediately but leaves it uncounted for detail classification', async () => {
    await processSms({
      sender: 'AD-HDFCBK',
      body: 'Rs.20.00 credited to A/C XX0719. Ref 987654321.',
      timestamp: Date.now(),
    });

    expect(mockDb.transactions).toHaveLength(1);
    expect(mockDb.transactions[0]).toEqual(expect.objectContaining({
      amount: 20,
      type: 'income',
      account_match_status: 'review_required',
      account_match_reason: 'unverified_credit',
    }));
  });

  it('processes Kotak bank app notification as credit income', async () => {
    mockDb.bank_accounts = [
      { id: 'bank_kotak_1447', user_id: 'user_1', bank_name: 'Kotak', account_last4: '1447' },
    ];

    const result = await processNotification({
      app: 'com.kotak.mahindra.kotakbanking',
      title: '₹165.00 received',
      text: 'Amount credited to XX1447. Check out details.',
      time: Date.now(),
    });

    expect(mockDb.transactions).toHaveLength(1);
    expect(mockDb.transactions[0]).toEqual(expect.objectContaining({
      amount: 165,
      type: 'income',
      account_last4: '1447',
      sms_source: 'bank',
    }));
    expect(result).toEqual(expect.objectContaining({
      transactionId: mockDb.transactions[0].id,
      type: 'income',
      amount: 165,
      skipped: false,
    }));
  });

  it('deduplicates same-type bank and UPI reports of one incoming transaction', async () => {
    const now = Date.now();

    await processNotification({
      app: 'com.google.android.apps.nbu.paisa.user',
      title: '₹235 received from RAVI KUMAR',
      text: 'Amount credited to XX1447.',
      time: now,
    });
    await processSms({
      sender: 'AD-HDFCBK',
      body: 'Rs.235.00 credited to A/C XX1447. Ref 123456789.',
      timestamp: now + 500,
    });

    expect(mockDb.transactions).toHaveLength(1);
    expect(mockDb.transactions[0]).toEqual(expect.objectContaining({
      amount: 235,
      type: 'income',
    }));
  });

  it('saves a clear merchant debit as a counted expense', async () => {
    await processSms({
      sender: 'AD-HDFCBK',
      body: 'Rs.450.00 paid to Amazon via UPI from A/C XX0719. Ref 555555555.',
      timestamp: Date.now(),
    });

    expect(mockDb.transactions).toHaveLength(1);
    expect(mockDb.transactions[0]).toEqual(expect.objectContaining({
      amount: 450,
      type: 'expense',
      account_match_status: 'manual_confirmed',
      account_match_reason: 'auto_confirmed_expense',
    }));
  });

  it('parses completed transactions even when the text also contains offer copy', async () => {
    await processSms({
      sender: 'AD-SBIINB',
      body: 'Your SBI account debited Rs.500. Offer: Free YONO transfer enabled.',
      timestamp: Date.now(),
    });

    expect(mockDb.transactions).toHaveLength(1);
    expect(mockDb.transactions[0]).toEqual(expect.objectContaining({
      amount: 500,
      type: 'expense',
    }));
  });

  it('processes INDDEM investment payout SMS as income credit', async () => {
    await processSms({
      sender: 'AD-INDDEM-S',
      body: 'Hi Investor, Refund from INDstocks Wallet Balance initiated on 06-06-2026 to your registered bank account as part of MONTHLY PAYOUT settlement. Transaction ID:3e3d45c50040839 Amount: Rs.42.14',
      timestamp: Date.now(),
    });

    expect(mockDb.transactions).toHaveLength(1);
    expect(mockDb.transactions[0]).toEqual(expect.objectContaining({
      amount: 42.14,
      type: 'income',
    }));
  });

  it('processes Kotak Rs: format SMS correctly as credit', async () => {
    await processSms({
      sender: 'VK-KOTAKB-S',
      body: 'Rs: 38.55 has been transferred to your account XXXXXX1447 on 06-Jun-2026. From Kotak Bank',
      timestamp: Date.now(),
    });

    expect(mockDb.transactions).toHaveLength(1);
    expect(mockDb.transactions[0]).toEqual(expect.objectContaining({
      amount: 38.55,
      type: 'income',
    }));
  });

  it('processes super.money notification successfully', async () => {
    const result = await processNotification({
      app: 'money.super.payments',
      title: 'super.money',
      text: '₹88.00 received from RUSHIL SANJAYKUMAR BAROT Deposited in your Kotak bank on 17 June at 02:50 PM. Tap to view details',
      time: Date.now(),
    });
    
    expect(mockDb.transactions).toHaveLength(1);
    expect(mockDb.transactions[0].amount).toBe(88);
  });

  it('processes Kotak SMS successfully', async () => {
    const result = await processSms({
      sender: 'JD-KOTAKB-S',
      body: 'Received Rs.88.00 in your Kotak Bank AC X1447 from samir.rushil@okaxis on 17-06-26.UPI Ref:653405954864.',
      timestamp: Date.now(),
    });
    
    expect(mockDb.transactions).toHaveLength(1);
    expect(mockDb.transactions[0].amount).toBe(88);
  });
});
