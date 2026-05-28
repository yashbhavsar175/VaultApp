import {
  createLinkedRefundTransaction,
  findDuplicateLinkedRefundTransaction,
} from '../core';
import { markPosted, ReviewItem } from './autoTransactionReviewQueue';
import {
  buildRefundNote,
  findLocalDuplicateLinkedRefund,
  getRefundExpenseMatches,
  isRefundSchemaMissingError,
  recordReviewQueueRefund,
} from './reviewQueueRefunds';
import { Transaction } from '../../types';

jest.mock('../core', () => ({
  createLinkedRefundTransaction: jest.fn(),
  findDuplicateLinkedRefundTransaction: jest.fn(),
}));

jest.mock('./autoTransactionReviewQueue', () => ({
  markPosted: jest.fn(),
}));

const mockCreateLinkedRefundTransaction = createLinkedRefundTransaction as jest.Mock;
const mockFindDuplicateLinkedRefundTransaction = findDuplicateLinkedRefundTransaction as jest.Mock;
const mockMarkPosted = markPosted as jest.Mock;

const timestamp = Date.parse('2026-05-26T10:00:00.000Z');

const originalExpense: Transaction = {
  id: 'expense_1',
  user_id: 'user_1',
  amount: 100,
  type: 'expense',
  note: 'Task20E3OriginalExpense Store',
  category: 'Shopping',
  account_id: 'bank_1',
  account_last4: '1234',
  created_at: '2026-05-25T10:00:00.000Z',
};

function mockRefundItem(overrides: Partial<ReviewItem['candidate']> = {}): ReviewItem {
  return {
    id: `sig_${timestamp}_refund`,
    candidate: {
      signalId: `sig_${timestamp}_refund`,
      autoClass: 'refund',
      direction: 'credit',
      amount: 40,
      merchantOrPerson: 'Task20E3OriginalExpense',
      last4: '1234',
      reference: 'REFUND123',
      instrumentHint: 'bank_account',
      confidenceScore: 88,
      confidenceLevel: 'high',
      decision: 'review_required',
      duplicateFingerprints: [{ strategy: 'hash', value: 'hash_refund' }],
      redactedPreview: {
        amount: 40,
        detectedSource: 'Task20E3Refund',
        autoClass: 'refund',
        maskedLast4: 'XX1234',
        hashSummary: 'len=20 hash=refund',
      },
      ...overrides,
    },
    reasons: ['Refund requires original expense link'],
    status: 'pending',
    createdAt: timestamp,
  };
}

describe('Review Queue refunds', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFindDuplicateLinkedRefundTransaction.mockResolvedValue(null);
    mockCreateLinkedRefundTransaction.mockResolvedValue({
      id: 'refund_tx_1',
      user_id: 'user_1',
      amount: 40,
      type: 'refund',
      note: 'Task20E3OriginalExpense',
      category: 'Refund',
      refund_of_transaction_id: 'expense_1',
      reference_number: 'REFUND123',
      created_at: new Date().toISOString(),
    });
    mockMarkPosted.mockResolvedValue(true);
  });

  it('orders likely original expenses first', () => {
    const olderExpense = {
      ...originalExpense,
      id: 'expense_older',
      note: 'Other merchant',
      account_last4: '9999',
      created_at: '2026-04-15T10:00:00.000Z',
    };

    const matches = getRefundExpenseMatches(mockRefundItem(), [
      olderExpense,
      originalExpense,
      { ...originalExpense, id: 'income_ignored', type: 'income' },
      { ...originalExpense, id: 'small_expense', amount: 10 },
    ] as Transaction[]);

    expect(matches.map(match => match.transaction.id)).toEqual(['expense_1', 'expense_older']);
    expect(matches[0].reasons).toContain('similar merchant');
    expect(matches[0].reasons).toContain('same account');
  });

  it('requires an original expense selection before posting', async () => {
    await expect(recordReviewQueueRefund(mockRefundItem(), undefined, []))
      .rejects.toThrow('Original expense selection required');

    expect(mockCreateLinkedRefundTransaction).not.toHaveBeenCalled();
    expect(mockMarkPosted).not.toHaveBeenCalled();
  });

  it('rejects non-expense originals and over-refunds', async () => {
    await expect(recordReviewQueueRefund(
      mockRefundItem(),
      { ...originalExpense, type: 'income' },
      []
    )).rejects.toThrow('Original transaction must be an expense');

    await expect(recordReviewQueueRefund(
      mockRefundItem({ amount: 140 }),
      originalExpense,
      []
    )).rejects.toThrow('Refund cannot exceed original expense');

    expect(mockCreateLinkedRefundTransaction).not.toHaveBeenCalled();
    expect(mockMarkPosted).not.toHaveBeenCalled();
  });

  it('creates a linked refund transaction and marks the candidate posted', async () => {
    const item = mockRefundItem();

    const result = await recordReviewQueueRefund(item, originalExpense, [originalExpense]);

    expect(result).toEqual({ status: 'posted', transactionId: 'refund_tx_1' });
    expect(mockCreateLinkedRefundTransaction).toHaveBeenCalledWith(expect.objectContaining({
      amount: 40,
      refundOfTransactionId: 'expense_1',
      note: 'Task20E3OriginalExpense',
      category: 'Refund',
      reference_number: 'REFUND123',
      account_id: 'bank_1',
      account_last4: '1234',
    }));
    expect(mockCreateLinkedRefundTransaction.mock.calls[0][0]).not.toHaveProperty('type', 'income');
    expect(mockCreateLinkedRefundTransaction.mock.calls[0][0]).not.toHaveProperty('type', 'expense');
    expect(mockMarkPosted).toHaveBeenCalledWith(item.id, 'refund_tx_1');
  });

  it('blocks duplicate linked refunds before a second write', async () => {
    const existingRefund = {
      ...originalExpense,
      id: 'refund_existing',
      type: 'refund',
      amount: 40,
      refund_of_transaction_id: 'expense_1',
      reference_number: 'REFUND123',
      created_at: '2026-05-26T10:01:00.000Z',
    } as Transaction;

    const item = mockRefundItem();
    const result = await recordReviewQueueRefund(
      item,
      originalExpense,
      [originalExpense, existingRefund]
    );

    expect(result).toEqual({ status: 'duplicate', transactionId: 'refund_existing' });
    expect(mockCreateLinkedRefundTransaction).not.toHaveBeenCalled();
    expect(mockMarkPosted).toHaveBeenCalledWith(item.id, 'refund_existing');
  });

  it('blocks duplicate replay by same original, amount, and close time without reference', () => {
    const item = mockRefundItem({ reference: null });
    const duplicate = {
      ...originalExpense,
      id: 'refund_close_window',
      type: 'refund',
      amount: 40,
      refund_of_transaction_id: 'expense_1',
      reference_number: null,
      created_at: '2026-05-26T10:05:00.000Z',
    } as Transaction;

    expect(findLocalDuplicateLinkedRefund(item, originalExpense, [duplicate])?.id)
      .toBe('refund_close_window');
  });

  it('leaves candidate pending when the refund write fails', async () => {
    mockCreateLinkedRefundTransaction.mockRejectedValueOnce(new Error('Supabase write failed'));

    await expect(recordReviewQueueRefund(mockRefundItem(), originalExpense, [originalExpense]))
      .rejects.toThrow('Supabase write failed');

    expect(mockMarkPosted).not.toHaveBeenCalled();
  });

  it('handles missing refund schema errors clearly', () => {
    expect(isRefundSchemaMissingError(new Error('Could not find the refund_of_transaction_id column')))
      .toBe(true);
    expect(isRefundSchemaMissingError(new Error('violates check constraint "transactions_type_check"')))
      .toBe(true);
    expect(isRefundSchemaMissingError(new Error('network timeout')))
      .toBe(false);
  });

  it('does not copy raw text into the refund payload or note', async () => {
    const item = {
      ...mockRefundItem({
        merchantOrPerson: 'Refund credited to account 1234567890 OTP 123456 call 9876543210',
      }),
      candidate: {
        ...mockRefundItem().candidate,
        merchantOrPerson: 'Refund credited to account 1234567890 OTP 123456 call 9876543210',
        rawText: 'OTP 123456 full raw sms should not be stored',
      },
    } as ReviewItem;

    expect(buildRefundNote(item)).toBe('Refund from Task20E3Refund');

    await recordReviewQueueRefund(item, originalExpense, [originalExpense]);

    const payload = JSON.stringify(mockCreateLinkedRefundTransaction.mock.calls[0][0]);
    expect(payload).not.toContain('OTP 123456');
    expect(payload).not.toContain('full raw sms');
    expect(payload).not.toContain('9876543210');
  });

  it('keeps other review classes outside refund routing', async () => {
    await expect(recordReviewQueueRefund({
      ...mockRefundItem(),
      candidate: {
        ...mockRefundItem().candidate,
        autoClass: 'bank_credit',
      },
    } as ReviewItem, originalExpense, [originalExpense]))
      .rejects.toThrow('Unsupported review item for refund');

    expect(mockCreateLinkedRefundTransaction).not.toHaveBeenCalled();
  });
});
