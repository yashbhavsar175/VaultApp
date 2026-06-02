import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  createLinkedRefundTransaction,
  createTransferTransaction,
  findDuplicateLinkedRefundTransaction,
  parseTransaction,
  syncOfflineTransactions,
  supabase,
} from './core';
import { emitFinanceDataChanged } from './services/dataEvents';
import { OFFLINE_TX_QUEUE_BASE_KEY, getUserScopedQueueKey } from './services/userScopedQueues';

jest.mock('./services/notifications', () => ({
  showTransactionConfirmation: jest.fn(),
}));

jest.mock('./services/dataEvents', () => ({
  emitFinanceDataChanged: jest.fn(),
}));

jest.mock('@supabase/supabase-js', () => {
  const mockOrder = jest.fn();
  const mockEq = jest.fn(() => ({ order: mockOrder }));
  const mockSingle = jest.fn();
  const mockSelect = jest.fn(() => ({ eq: mockEq, single: mockSingle }));
  const mockInsert = jest.fn(() => ({ select: mockSelect }));
  const mockFrom = jest.fn(() => ({ insert: mockInsert, select: mockSelect }));
  const mockGetUser = jest.fn();

  return {
    createClient: jest.fn(() => ({
      auth: {
        getUser: mockGetUser,
      },
      from: mockFrom,
      __mocks: {
        mockFrom,
        mockInsert,
        mockSelect,
        mockEq,
        mockOrder,
        mockSingle,
        mockGetUser,
      },
    })),
  };
});

describe('manual parser personal movement safety', () => {
  it('keeps personal transfers and deposits neutral', () => {
    expect(parseTransaction('brother gave me 11000').type).toBe('transfer');
    expect(parseTransaction('cash deposit 11000').type).toBe('transfer');
    expect(parseTransaction('cash withdrawal 500').type).toBe('transfer');
    expect(parseTransaction('loan repayment 11000').type).toBe('transfer');
  });

  it('keeps earned income and merchant expenses unchanged', () => {
    expect(parseTransaction('salary received 30000').type).toBe('income');
    expect(parseTransaction('grocery paid 500').type).toBe('expense');
  });
});

const mockSupabase = supabase as any;
const mockEmitFinanceDataChanged = emitFinanceDataChanged as jest.Mock;

describe('transfer transaction helper', () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    await AsyncStorage.clear();

    mockSupabase.__mocks.mockGetUser.mockResolvedValue({
      data: { user: { id: 'user_1' } },
    });
    mockSupabase.__mocks.mockSingle.mockResolvedValue({
      data: {
        id: 'transfer_1',
        user_id: 'user_1',
        amount: 500,
        type: 'transfer',
        note: 'Move to savings',
        category: 'Transfer',
        account_id: 'bank_from',
        from_account_id: 'bank_from',
        to_account_id: 'bank_to',
        reference_number: 'REF123',
        is_transfer_pending: false,
        created_at: '2026-05-26T00:00:00.000Z',
      },
      error: null,
    });
  });

  it('rejects non-positive transfer amounts', async () => {
    await expect(createTransferTransaction({
      amount: 0,
      from_account_id: 'bank_from',
      to_account_id: 'bank_to',
      note: 'Move to savings',
    })).rejects.toThrow('Valid transfer amount required');

    await expect(createTransferTransaction({
      amount: -1,
      from_account_id: 'bank_from',
      to_account_id: 'bank_to',
      note: 'Move to savings',
    })).rejects.toThrow('Valid transfer amount required');
  });

  it('rejects missing source or destination accounts', async () => {
    await expect(createTransferTransaction({
      amount: 500,
      from_account_id: '',
      to_account_id: 'bank_to',
      note: 'Move to savings',
    })).rejects.toThrow('Transfer source account required');

    await expect(createTransferTransaction({
      amount: 500,
      from_account_id: 'bank_from',
      to_account_id: '',
      note: 'Move to savings',
    })).rejects.toThrow('Transfer destination account required');
  });

  it('rejects same source and destination account', async () => {
    await expect(createTransferTransaction({
      amount: 500,
      from_account_id: 'bank_same',
      to_account_id: 'bank_same',
      note: 'Move to savings',
    })).rejects.toThrow('must be different accounts');
  });

  it('creates a neutral transfer transaction without raw SMS text', async () => {
    await createTransferTransaction({
      amount: 500,
      from_account_id: 'bank_from',
      to_account_id: 'bank_to',
      note: 'Move to savings',
      reference_number: '  REF123  ',
    });

    const payload = mockSupabase.__mocks.mockInsert.mock.calls[0][0];
    expect(payload).toEqual(expect.objectContaining({
      user_id: 'user_1',
      amount: 500,
      type: 'transfer',
      note: 'Move to savings',
      category: 'Transfer',
      account_id: 'bank_from',
      from_account_id: 'bank_from',
      to_account_id: 'bank_to',
      reference_number: 'REF123',
      is_transfer_pending: false,
    }));
    expect(payload.type).not.toBe('income');
    expect(payload.type).not.toBe('expense');
    expect(payload).not.toHaveProperty('raw_sms');
  });

  it('emits account refresh signal after creating a transfer', async () => {
    await createTransferTransaction({
      amount: 500,
      from_account_id: 'bank_from',
      to_account_id: 'bank_to',
      note: 'Move to savings',
    });

    expect(mockEmitFinanceDataChanged).toHaveBeenCalledWith(expect.objectContaining({
      areas: ['accounts'],
      source: 'transaction:transferBalance',
      transactionId: 'transfer_1',
    }));
  });
});

describe('linked refund transaction helper', () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    await AsyncStorage.clear();

    mockSupabase.__mocks.mockGetUser.mockResolvedValue({
      data: { user: { id: 'user_1' } },
    });
    mockSupabase.__mocks.mockSingle.mockResolvedValue({
      data: {
        id: 'refund_1',
        user_id: 'user_1',
        amount: 250,
        type: 'refund',
        note: 'Amazon refund',
        category: 'Refund',
        refund_of_transaction_id: 'expense_1',
        account_id: 'bank_1',
        account_last4: '1234',
        reference_number: 'REFUND123',
        created_at: '2026-05-26T00:00:00.000Z',
      },
      error: null,
    });
    mockSupabase.__mocks.mockOrder.mockResolvedValue({
      data: [],
      error: null,
    });
  });

  it('rejects missing original expense link', async () => {
    await expect(createLinkedRefundTransaction({
      amount: 250,
      refundOfTransactionId: '',
      note: 'Amazon refund',
    })).rejects.toThrow('Original expense transaction required');
  });

  it('rejects non-positive refund amounts', async () => {
    await expect(createLinkedRefundTransaction({
      amount: 0,
      refundOfTransactionId: 'expense_1',
      note: 'Amazon refund',
    })).rejects.toThrow('Valid refund amount required');

    await expect(createLinkedRefundTransaction({
      amount: -1,
      refundOfTransactionId: 'expense_1',
      note: 'Amazon refund',
    })).rejects.toThrow('Valid refund amount required');
  });

  it('creates a linked refund transaction without income, expense, or raw text fields', async () => {
    await createLinkedRefundTransaction({
      amount: 250,
      refundOfTransactionId: ' expense_1 ',
      note: ' Amazon refund ',
      category: null,
      reference_number: ' REFUND123 ',
      account_id: ' bank_1 ',
      account_last4: ' 1234 ',
      raw_sms: 'Full refund SMS body should not be accepted',
    } as any);

    const payload = mockSupabase.__mocks.mockInsert.mock.calls[0][0];
    expect(payload).toEqual(expect.objectContaining({
      user_id: 'user_1',
      amount: 250,
      type: 'refund',
      note: 'Amazon refund',
      category: 'Refund',
      refund_of_transaction_id: 'expense_1',
      account_id: 'bank_1',
      account_last4: '1234',
      reference_number: 'REFUND123',
    }));
    expect(payload.type).not.toBe('income');
    expect(payload.type).not.toBe('expense');
    expect(payload).not.toHaveProperty('raw_sms');
    expect(payload).not.toHaveProperty('rawSignalText');
  });

  it('finds duplicate linked refunds by original expense, amount, and reference', async () => {
    mockSupabase.__mocks.mockOrder.mockResolvedValueOnce({
      data: [
        {
          id: 'refund_1',
          user_id: 'user_1',
          amount: 250,
          type: 'refund',
          note: 'Amazon refund',
          category: 'Refund',
          refund_of_transaction_id: 'expense_1',
          reference_number: ' Refund123 ',
          created_at: '2026-05-26T00:00:00.000Z',
        },
        {
          id: 'expense_1',
          user_id: 'user_1',
          amount: 250,
          type: 'expense',
          note: 'Amazon',
          category: 'Shopping',
          created_at: '2026-05-25T00:00:00.000Z',
        },
      ],
      error: null,
    });

    const duplicate = await findDuplicateLinkedRefundTransaction({
      amount: 250,
      refundOfTransactionId: 'expense_1',
      reference_number: 'refund123',
    });

    expect(duplicate?.id).toBe('refund_1');
  });
});

describe('offline transaction queue user isolation', () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    await AsyncStorage.clear();

    mockSupabase.__mocks.mockGetUser.mockResolvedValue({
      data: { user: { id: 'user_a' } },
    });
    mockSupabase.__mocks.mockSingle.mockResolvedValue({
      data: {
        id: 'tx_synced_1',
        user_id: 'user_a',
        amount: 125,
        type: 'expense',
        note: 'Scoped queued transaction',
        category: 'general',
        created_at: '2026-06-02T00:00:00.000Z',
      },
      error: null,
    });
  });

  const queuedTransaction = (ownerId: string, overrides: Record<string, any> = {}) => ({
    user_id: ownerId,
    queueOwnerId: ownerId,
    amount: 125,
    type: 'expense',
    note: 'Scoped queued transaction',
    category: 'general',
    _localId: `local_${ownerId}`,
    _queued_at: '2026-06-02T00:00:00.000Z',
    ...overrides,
  });

  it('does not sync user A queued transactions while user B is authenticated', async () => {
    await AsyncStorage.setItem(
      getUserScopedQueueKey(OFFLINE_TX_QUEUE_BASE_KEY, 'user_a'),
      JSON.stringify([queuedTransaction('user_a')]),
    );
    mockSupabase.__mocks.mockGetUser.mockResolvedValue({
      data: { user: { id: 'user_b' } },
    });

    await syncOfflineTransactions();

    expect(mockSupabase.__mocks.mockInsert).not.toHaveBeenCalled();
    const userAQueue = JSON.parse(await AsyncStorage.getItem(getUserScopedQueueKey(OFFLINE_TX_QUEUE_BASE_KEY, 'user_a')) || '[]');
    expect(userAQueue).toHaveLength(1);
  });

  it('quarantines the legacy global queue and does not post orphaned transactions', async () => {
    await AsyncStorage.setItem(OFFLINE_TX_QUEUE_BASE_KEY, JSON.stringify([
      {
        amount: 777,
        note: 'Legacy orphaned note should not sync',
        type: 'expense',
        category: 'general',
      },
    ]));

    await syncOfflineTransactions();

    expect(mockSupabase.__mocks.mockInsert).not.toHaveBeenCalled();
    expect(await AsyncStorage.getItem(OFFLINE_TX_QUEUE_BASE_KEY)).toBeNull();
    const keys = await AsyncStorage.getAllKeys();
    expect(keys.some(key => key.startsWith(`${OFFLINE_TX_QUEUE_BASE_KEY}:legacy_quarantine:`))).toBe(true);
  });

  it('syncs a user-scoped queue item for the same owner', async () => {
    await AsyncStorage.setItem(
      getUserScopedQueueKey(OFFLINE_TX_QUEUE_BASE_KEY, 'user_a'),
      JSON.stringify([queuedTransaction('user_a')]),
    );

    await syncOfflineTransactions();

    expect(mockSupabase.__mocks.mockInsert).toHaveBeenCalledWith(expect.objectContaining({
      user_id: 'user_a',
      amount: 125,
      type: 'expense',
      note: 'Scoped queued transaction',
    }));
    expect(await AsyncStorage.getItem(getUserScopedQueueKey(OFFLINE_TX_QUEUE_BASE_KEY, 'user_a'))).toBeNull();
  });

  it('skips owner-mismatched scoped queue entries with privacy-safe structural logs only', async () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    await AsyncStorage.setItem(
      getUserScopedQueueKey(OFFLINE_TX_QUEUE_BASE_KEY, 'user_b'),
      JSON.stringify([queuedTransaction('user_a', {
        amount: 98765,
        note: 'Sensitive offline note',
        raw_sms: 'Sensitive SMS body',
      })]),
    );
    mockSupabase.__mocks.mockGetUser.mockResolvedValue({
      data: { user: { id: 'user_b', email: 'userb@example.com' } },
    });

    try {
      await syncOfflineTransactions();

      expect(mockSupabase.__mocks.mockInsert).not.toHaveBeenCalled();
      const logs = JSON.stringify(warnSpy.mock.calls);
      expect(logs).toContain('offline_tx_queue');
      expect(logs).toContain('skipped');
      expect(logs).toContain('count');
      expect(logs).not.toContain('98765');
      expect(logs).not.toContain('Sensitive offline note');
      expect(logs).not.toContain('Sensitive SMS body');
      expect(logs).not.toContain('userb@example.com');
    } finally {
      warnSpy.mockRestore();
    }
  });
});
