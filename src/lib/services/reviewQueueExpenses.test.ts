import { addTransaction, getTransactions } from '../core';
import { markPosted, ReviewItem } from './autoTransactionReviewQueue';
import { linkEvidenceToTransaction } from './transactionEvidence';
import {
  findDuplicateReviewedExpense,
  isReviewedDebitCandidate,
  recordReviewQueueExpense,
  REVIEWED_EXPENSE_CATEGORY,
  REVIEWED_EXPENSE_NOTE,
  sanitizeReviewedExpenseSourceToken,
} from './reviewQueueExpenses';
import { BankAccount, Transaction } from '../../types';

jest.mock('../core', () => ({
  addTransaction: jest.fn(),
  getTransactions: jest.fn(),
}));

jest.mock('./autoTransactionReviewQueue', () => ({
  markPosted: jest.fn(),
}));

jest.mock('./transactionEvidence', () => ({
  linkEvidenceToTransaction: jest.fn(),
}));

const mockAddTransaction = addTransaction as jest.Mock;
const mockGetTransactions = getTransactions as jest.Mock;
const mockMarkPosted = markPosted as jest.Mock;
const mockLinkEvidence = linkEvidenceToTransaction as jest.Mock;
const timestamp = Date.parse('2026-06-03T10:00:00.000Z');

const account: BankAccount = {
  id: 'bank_1',
  user_id: 'user_1',
  bank_name: 'Kotak Bank',
  account_last4: '1447',
  account_type: 'savings',
  starting_balance: 0,
  balance: 0,
  credit_limit: 0,
  loan_total: 0,
  upi_ids: [],
  created_at: '2026-01-01T00:00:00.000Z',
};

function item(overrides: Partial<ReviewItem['candidate']> = {}): ReviewItem {
  return {
    id: `sig_${timestamp}_codex41a`,
    candidate: {
      signalId: `sig_${timestamp}_codex41a`,
      sourceType: 'sms',
      autoClass: 'unknown_financial',
      direction: 'unknown',
      amount: 2,
      merchantOrPerson: null,
      last4: '1447',
      reference: '651916430927',
      instrumentHint: 'bank_account',
      confidenceScore: 70,
      confidenceLevel: 'medium',
      decision: 'review_required',
      duplicateFingerprints: [{ strategy: 'reference', value: '651916430927' }],
      redactedPreview: {
        amount: 2,
        detectedSource: 'AD-KOTAKB-S',
        autoClass: 'unknown_financial',
        maskedLast4: 'XX1447',
        hashSummary: 'len=80 hash=abcdef12',
      },
      ...overrides,
    },
    reasons: ['Debit needs confirmation before counting as an expense'],
    status: 'pending',
    createdAt: timestamp,
  };
}

describe('Review Queue reviewed expenses', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetTransactions.mockResolvedValue([]);
    mockAddTransaction.mockResolvedValue({
      id: 'expense_tx_1',
      user_id: 'user_1',
      amount: 2,
      type: 'expense',
      category: REVIEWED_EXPENSE_CATEGORY,
      note: REVIEWED_EXPENSE_NOTE,
      created_at: new Date(timestamp).toISOString(),
    });
    mockMarkPosted.mockResolvedValue(true);
    mockLinkEvidence.mockResolvedValue({});
  });

  it('allows a legacy ambiguous debit to be explicitly counted as expense', () => {
    expect(isReviewedDebitCandidate(item())).toBe(true);
  });

  it('allows an older debit review item that is missing autoClass metadata', () => {
    const legacyItem = item({ direction: 'debit' } as any);
    delete (legacyItem.candidate as any).autoClass;
    expect(isReviewedDebitCandidate(legacyItem)).toBe(true);
  });

  it('creates one privacy-safe reviewed expense and marks the review item posted', async () => {
    const reviewItem = item();

    await recordReviewQueueExpense(reviewItem, account);

    expect(mockAddTransaction).toHaveBeenCalledWith({
      amount: 2,
      type: 'expense',
      category: REVIEWED_EXPENSE_CATEGORY,
      note: REVIEWED_EXPENSE_NOTE,
      created_at: new Date(timestamp).toISOString(),
      account_id: 'bank_1',
      account_last4: '1447',
      reference_number: '651916430927',
      sms_source: 'sms',
      sms_sender: 'AD-KOTAKB-S',
      account_match_status: 'manual_confirmed',
      account_match_confidence: 'medium',
      account_match_reason: 'review_queue_expense_confirmed',
    });
    expect(mockMarkPosted).toHaveBeenCalledWith(reviewItem.id, 'expense_tx_1');
  });

  it('does not create a duplicate reviewed expense on retry', async () => {
    const reviewItem = item();
    mockGetTransactions.mockResolvedValueOnce([{
      id: 'expense_existing',
      user_id: 'user_1',
      amount: 2,
      type: 'expense',
      category: REVIEWED_EXPENSE_CATEGORY,
      note: REVIEWED_EXPENSE_NOTE,
      created_at: new Date(timestamp).toISOString(),
      account_last4: '1447',
      reference_number: '651916430927',
    } as Transaction]);

    const result = await recordReviewQueueExpense(reviewItem, account);

    expect(result).toEqual({ status: 'duplicate', transactionId: 'expense_existing' });
    expect(mockAddTransaction).not.toHaveBeenCalled();
    expect(mockMarkPosted).toHaveBeenCalledWith(reviewItem.id, 'expense_existing');
  });

  it('leaves the review item pending when transaction creation fails', async () => {
    mockAddTransaction.mockRejectedValueOnce(new Error('Supabase write failed'));

    await expect(recordReviewQueueExpense(item(), account)).rejects.toThrow('Supabase write failed');

    expect(mockMarkPosted).not.toHaveBeenCalled();
  });

  it('links available evidence without requiring it for durable posting', async () => {
    await recordReviewQueueExpense(item({ evidenceId: 'evidence_1' }), account);

    expect(mockLinkEvidence).toHaveBeenCalledWith(
      'evidence_1',
      'expense_tx_1',
      'linked',
      'medium',
      'review_queue_expense_confirmed',
    );
  });

  it('does not copy raw text, phone-like sender, or full account numbers into created rows', async () => {
    const privateItem = item({
      redactedPreview: {
        amount: 2,
        detectedSource: '9876543210',
        autoClass: 'unknown_financial',
        maskedLast4: 'XX1447',
        hashSummary: 'len=120 hash=abcdef12',
      },
      merchantOrPerson: 'OTP 123456 private raw text',
      reference: 'not safe reference with spaces',
      last4: '123456789012',
    });

    await recordReviewQueueExpense(privateItem);

    const payload = JSON.stringify(mockAddTransaction.mock.calls[0][0]);
    expect(payload).not.toContain('9876543210');
    expect(payload).not.toContain('OTP 123456');
    expect(payload).not.toContain('123456789012');
    expect(payload).not.toContain('not safe reference');
  });

  it('matches duplicates by amount, account last4, and safe time window', () => {
    const existing = {
      id: 'expense_existing',
      user_id: 'user_1',
      amount: 2,
      type: 'expense',
      category: REVIEWED_EXPENSE_CATEGORY,
      note: REVIEWED_EXPENSE_NOTE,
      created_at: new Date(timestamp + 1000).toISOString(),
      account_last4: '1447',
    } as Transaction;

    expect(findDuplicateReviewedExpense(item({ reference: null }), [existing], account)).toBe(existing);
  });

  it('redacts phone-like source tokens structurally', () => {
    expect(sanitizeReviewedExpenseSourceToken('AD-KOTAKB-S')).toBe('AD-KOTAKB-S');
    expect(sanitizeReviewedExpenseSourceToken('9876543210')).toBeUndefined();
    expect(sanitizeReviewedExpenseSourceToken('private raw sender')).toBeUndefined();
  });
});
