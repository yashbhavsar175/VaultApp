import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  createLinkedRefundTransaction,
  createTransferTransaction,
  findDuplicateLinkedRefundTransaction,
  supabase,
} from './core';
import { emitFinanceDataChanged } from './services/dataEvents';

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
