import {
  addTransaction,
  createTransferTransaction,
  getTransactions,
} from '../core';
import { markPosted, ReviewItem } from './autoTransactionReviewQueue';
import {
  buildTransferNote,
  canRecordTransfer,
  getEligibleTransferAccounts,
  recordReviewQueueTransfer,
  resolveTransferSelection,
} from './reviewQueueTransfers';
import { BankAccount, Transaction } from '../../types';

jest.mock('../core', () => ({
  addTransaction: jest.fn(),
  createTransferTransaction: jest.fn(),
  getTransactions: jest.fn(),
}));

jest.mock('./autoTransactionReviewQueue', () => ({
  markPosted: jest.fn(),
}));

const mockAddTransaction = addTransaction as jest.Mock;
const mockCreateTransferTransaction = createTransferTransaction as jest.Mock;
const mockGetTransactions = getTransactions as jest.Mock;
const mockMarkPosted = markPosted as jest.Mock;

const savingsAccount: BankAccount = {
  id: 'bank_from',
  user_id: 'user_1',
  bank_name: 'Task From Bank',
  account_last4: '1111',
  account_type: 'savings',
  starting_balance: 1000,
  balance: 1000,
  credit_limit: 0,
  loan_total: 0,
  upi_ids: [],
  created_at: new Date().toISOString(),
};

const currentAccount: BankAccount = {
  ...savingsAccount,
  id: 'bank_to',
  bank_name: 'Task To Bank',
  account_last4: '2222',
  account_type: 'current',
  balance: 500,
};

const creditCardAccount: BankAccount = {
  ...savingsAccount,
  id: 'credit_card_account',
  account_last4: '3333',
  account_type: 'credit_card',
};

const loanAccount: BankAccount = {
  ...savingsAccount,
  id: 'loan_account',
  account_last4: '4444',
  account_type: 'loan',
};

function mockTransferItem(overrides: Partial<ReviewItem['candidate']> = {}): ReviewItem {
  const timestamp = Date.parse('2026-05-26T10:00:00.000Z');
  return {
    id: `sig_${timestamp}_transfer`,
    candidate: {
      signalId: `sig_${timestamp}_transfer`,
      autoClass: 'self_transfer',
      direction: 'neutral',
      amount: 100,
      merchantOrPerson: null,
      last4: null,
      reference: 'TRANSFERREF123',
      instrumentHint: 'bank_account',
      confidenceScore: 82,
      confidenceLevel: 'medium',
      decision: 'review_required',
      duplicateFingerprints: [{ strategy: 'hash', value: 'hash_transfer' }],
      redactedPreview: {
        amount: 100,
        detectedSource: 'Task20D2Transfer',
        autoClass: 'self_transfer',
        maskedLast4: undefined,
        hashSummary: 'len=20 hash=transfer',
      },
      ...overrides,
    },
    reasons: ['Requires review before adding to database'],
    status: 'pending',
    createdAt: timestamp,
  };
}

describe('Review Queue self transfers', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetTransactions.mockResolvedValue([]);
    mockCreateTransferTransaction.mockResolvedValue({
      id: 'transfer_tx_1',
      user_id: 'user_1',
      amount: 100,
      type: 'transfer',
      note: 'Transfer from Task20D2Transfer',
      category: 'Transfer',
      from_account_id: 'bank_from',
      to_account_id: 'bank_to',
      reference_number: 'TRANSFERREF123',
      created_at: new Date().toISOString(),
    });
    mockMarkPosted.mockResolvedValue(true);
  });

  it('uses only savings and current accounts for transfer selection', () => {
    const cashAccount = {
      ...savingsAccount,
      id: 'cash_account',
      bank_name: 'Cash',
      account_type: 'cash',
    } as unknown as BankAccount;

    expect(getEligibleTransferAccounts([
      savingsAccount,
      currentAccount,
      creditCardAccount,
      loanAccount,
      cashAccount,
    ])).toEqual([savingsAccount, currentAccount]);
  });

  it('does not allow credit card or loan accounts as transfer endpoints', async () => {
    const accounts = [savingsAccount, currentAccount, creditCardAccount, loanAccount];

    expect(canRecordTransfer(mockTransferItem(), accounts, 'credit_card_account', 'bank_to'))
      .toBe(false);
    expect(canRecordTransfer(mockTransferItem(), accounts, 'bank_from', 'loan_account'))
      .toBe(false);

    await expect(recordReviewQueueTransfer(
      mockTransferItem(),
      'credit_card_account',
      'bank_to',
      accounts
    )).rejects.toThrow('Eligible bank account selection required');

    expect(mockCreateTransferTransaction).not.toHaveBeenCalled();
  });

  it('preselects one safe last4 hint without guessing both accounts', () => {
    const result = resolveTransferSelection(
      mockTransferItem({ last4: '1111' }),
      [savingsAccount, currentAccount]
    );

    expect(result).toEqual({
      status: 'needs_selection',
      fromAccountId: 'bank_from',
    });
  });

  it('preselects both sides only when explicit distinct side hints exist', () => {
    const item = mockTransferItem({
      from_account_last4: '1111',
      to_account_last4: '2222',
    } as Partial<ReviewItem['candidate']>);

    expect(resolveTransferSelection(item, [savingsAccount, currentAccount])).toEqual({
      status: 'ready',
      fromAccountId: 'bank_from',
      toAccountId: 'bank_to',
    });
  });

  it('requires at least two eligible bank accounts', () => {
    const item = mockTransferItem();

    expect(resolveTransferSelection(item, [savingsAccount]).status).toBe('needs_setup');
    expect(canRecordTransfer(item, [savingsAccount], 'bank_from', 'bank_to')).toBe(false);
  });

  it('does not post when fewer than two eligible bank accounts are supplied', async () => {
    await expect(recordReviewQueueTransfer(
      mockTransferItem(),
      'bank_from',
      'bank_to',
      [savingsAccount]
    )).rejects.toThrow('Eligible bank account selection required');

    expect(mockCreateTransferTransaction).not.toHaveBeenCalled();
    expect(mockMarkPosted).not.toHaveBeenCalled();
  });

  it('requires From and To account selections', async () => {
    await expect(recordReviewQueueTransfer(
      mockTransferItem(),
      undefined,
      'bank_to',
      [savingsAccount, currentAccount]
    )).rejects.toThrow('From account selection required');

    await expect(recordReviewQueueTransfer(
      mockTransferItem(),
      'bank_from',
      undefined,
      [savingsAccount, currentAccount]
    )).rejects.toThrow('To account selection required');

    expect(mockCreateTransferTransaction).not.toHaveBeenCalled();
    expect(mockMarkPosted).not.toHaveBeenCalled();
  });

  it('rejects non-positive transfer amounts', async () => {
    await expect(recordReviewQueueTransfer(
      mockTransferItem({ amount: 0 }),
      'bank_from',
      'bank_to',
      [savingsAccount, currentAccount]
    )).rejects.toThrow('Valid amount required');

    expect(mockCreateTransferTransaction).not.toHaveBeenCalled();
    expect(mockMarkPosted).not.toHaveBeenCalled();
  });

  it('rejects same From and To account', async () => {
    expect(canRecordTransfer(mockTransferItem(), [savingsAccount, currentAccount], 'bank_from', 'bank_from'))
      .toBe(false);

    await expect(recordReviewQueueTransfer(
      mockTransferItem(),
      'bank_from',
      'bank_from',
      [savingsAccount, currentAccount]
    )).rejects.toThrow('must be different accounts');

    expect(mockCreateTransferTransaction).not.toHaveBeenCalled();
    expect(mockMarkPosted).not.toHaveBeenCalled();
  });

  it('records one neutral transfer without creating income or expense', async () => {
    const item = mockTransferItem();

    await recordReviewQueueTransfer(item, 'bank_from', 'bank_to', [savingsAccount, currentAccount]);

    expect(mockAddTransaction).not.toHaveBeenCalled();
    expect(mockCreateTransferTransaction).toHaveBeenCalledWith(expect.objectContaining({
      amount: 100,
      from_account_id: 'bank_from',
      to_account_id: 'bank_to',
      note: 'Transfer from Task20D2Transfer',
      reference_number: 'TRANSFERREF123',
    }));
    expect(JSON.stringify(mockCreateTransferTransaction.mock.calls[0][0])).not.toContain('income');
    expect(JSON.stringify(mockCreateTransferTransaction.mock.calls[0][0])).not.toContain('expense');
    expect(mockMarkPosted).toHaveBeenCalledWith(item.id, 'transfer_tx_1');
  });

  it('leaves candidate pending when transfer write fails', async () => {
    mockCreateTransferTransaction.mockRejectedValueOnce(new Error('Supabase write failed'));

    await expect(recordReviewQueueTransfer(
      mockTransferItem(),
      'bank_from',
      'bank_to',
      [savingsAccount, currentAccount]
    )).rejects.toThrow('Supabase write failed');

    expect(mockMarkPosted).not.toHaveBeenCalled();
  });

  it('blocks duplicate transfer by amount and reference', async () => {
    const item = mockTransferItem();
    mockGetTransactions.mockResolvedValueOnce([{
      id: 'transfer_existing',
      user_id: 'user_1',
      amount: 100,
      type: 'transfer',
      note: 'Existing transfer',
      category: 'Transfer',
      from_account_id: 'bank_from',
      to_account_id: 'bank_to',
      reference_number: 'TRANSFERREF123',
      created_at: '2026-05-26T10:01:00.000Z',
    } as Transaction]);

    const result = await recordReviewQueueTransfer(item, 'bank_from', 'bank_to', [savingsAccount, currentAccount]);

    expect(result.status).toBe('duplicate');
    expect(mockCreateTransferTransaction).not.toHaveBeenCalled();
    expect(mockMarkPosted).toHaveBeenCalledWith(item.id, 'transfer_existing');
  });

  it('blocks duplicate transfer by exact pair, amount, and close time window', async () => {
    const item = mockTransferItem({ reference: null });
    mockGetTransactions.mockResolvedValueOnce([{
      id: 'transfer_existing_pair',
      user_id: 'user_1',
      amount: 100,
      type: 'transfer',
      note: 'Existing transfer',
      category: 'Transfer',
      from_account_id: 'bank_from',
      to_account_id: 'bank_to',
      reference_number: null,
      created_at: '2026-05-26T10:01:00.000Z',
    } as Transaction]);

    const result = await recordReviewQueueTransfer(item, 'bank_from', 'bank_to', [savingsAccount, currentAccount]);

    expect(result.status).toBe('duplicate');
    expect(mockCreateTransferTransaction).not.toHaveBeenCalled();
    expect(mockMarkPosted).toHaveBeenCalledWith(item.id, 'transfer_existing_pair');
  });

  it('does not treat reversed pair as duplicate without stronger source evidence', async () => {
    const item = mockTransferItem({ reference: null });
    mockGetTransactions.mockResolvedValueOnce([{
      id: 'transfer_reversed_pair',
      user_id: 'user_1',
      amount: 100,
      type: 'transfer',
      note: 'Existing reversed transfer',
      category: 'Transfer',
      from_account_id: 'bank_to',
      to_account_id: 'bank_from',
      reference_number: null,
      created_at: '2026-05-26T10:01:00.000Z',
    } as Transaction]);

    const result = await recordReviewQueueTransfer(item, 'bank_from', 'bank_to', [savingsAccount, currentAccount]);

    expect(result.status).toBe('posted');
    expect(mockCreateTransferTransaction).toHaveBeenCalled();
  });

  it('does not copy raw text into transfer payload or note', async () => {
    const item = {
      ...mockTransferItem(),
      candidate: {
        ...mockTransferItem().candidate,
        merchantOrPerson: 'Transferred from account 1111 to account 2222 OTP 123456 call 9999999999',
        rawText: 'OTP 123456 full raw sms should not be stored',
      },
    } as ReviewItem;

    expect(buildTransferNote(item)).toBe('Transfer from Task20D2Transfer');

    await recordReviewQueueTransfer(item, 'bank_from', 'bank_to', [savingsAccount, currentAccount]);

    const payload = JSON.stringify(mockCreateTransferTransaction.mock.calls[0][0]);
    expect(payload).not.toContain('OTP 123456');
    expect(payload).not.toContain('full raw sms');
    expect(payload).not.toContain('9999999999');
  });

  it('keeps other review classes outside self-transfer routing', async () => {
    await expect(recordReviewQueueTransfer({
      ...mockTransferItem(),
      candidate: {
        ...mockTransferItem().candidate,
        autoClass: 'loan_emi_payment',
      },
    } as ReviewItem, 'bank_from', 'bank_to', [savingsAccount, currentAccount]))
      .rejects.toThrow('Unsupported review item for transfer');

    expect(mockCreateTransferTransaction).not.toHaveBeenCalled();
  });
});
