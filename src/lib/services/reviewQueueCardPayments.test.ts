import { addTransaction } from '../core';
import {
  addCCTransaction,
  getCardTransactions,
} from '../database/financial';
import { markPosted, ReviewItem } from './autoTransactionReviewQueue';
import {
  buildCardPaymentDescription,
  recordReviewQueueCardPayment,
  resolveCreditCardMatch,
} from './reviewQueueCardPayments';

jest.mock('../core', () => ({
  addTransaction: jest.fn(),
}));

jest.mock('../database/financial', () => ({
  addCCTransaction: jest.fn(),
  getCardTransactions: jest.fn(),
}));

jest.mock('./autoTransactionReviewQueue', () => ({
  markPosted: jest.fn(),
}));

const mockAddTransaction = addTransaction as jest.Mock;
const mockAddCCTransaction = addCCTransaction as jest.Mock;
const mockGetCardTransactions = getCardTransactions as jest.Mock;
const mockMarkPosted = markPosted as jest.Mock;

const testCard = {
  id: 'card_1',
  user_id: 'user_1',
  bank_name: 'Task Bank',
  card_name: 'Task Card',
  last_4_digits: '1234',
  credit_limit: 50000,
  current_outstanding: 1000,
  due_date: 10,
  billing_cycle_date: 1,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
};

function mockCardPaymentItem(overrides: Partial<ReviewItem['candidate']> = {}): ReviewItem {
  const timestamp = Date.now();
  return {
    id: `sig_${timestamp}_card_payment`,
    candidate: {
      signalId: `sig_${timestamp}_card_payment`,
      autoClass: 'credit_card_bill_payment',
      direction: 'neutral',
      amount: 100,
      merchantOrPerson: null,
      last4: '1234',
      reference: null,
      instrumentHint: 'credit_card',
      confidenceScore: 90,
      confidenceLevel: 'high',
      decision: 'review_required',
      duplicateFingerprints: [{ strategy: 'hash', value: 'hash_card_payment' }],
      redactedPreview: {
        amount: 100,
        detectedSource: 'Task20BCardPayment',
        autoClass: 'credit_card_bill_payment',
        maskedLast4: 'XX1234',
        hashSummary: 'len=22 hash=abc',
      },
      ...overrides,
    },
    reasons: ['Requires review before adding to database'],
    status: 'pending',
    createdAt: timestamp,
  };
}

describe('Review Queue card bill payments', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetCardTransactions.mockResolvedValue([]);
    mockAddCCTransaction.mockResolvedValue({
      id: 'cc_tx_1',
      card_id: 'card_1',
      amount: 100,
      type: 'payment',
      transaction_date: new Date().toISOString(),
    });
    mockMarkPosted.mockResolvedValue(true);
  });

  it('matches exactly one configured credit card by last4', () => {
    const item = mockCardPaymentItem();
    const duplicateLast4Card = { ...testCard, id: 'card_2', card_name: 'Second Card' };

    expect(resolveCreditCardMatch(item, [testCard]).status).toBe('matched');
    expect(resolveCreditCardMatch(item, []).status).toBe('needs_setup');
    expect(resolveCreditCardMatch(item, [testCard, duplicateLast4Card]).status)
      .toBe('needs_selection');
    expect(resolveCreditCardMatch(mockCardPaymentItem({ last4: null }), [testCard]).status)
      .toBe('needs_selection');
    expect(resolveCreditCardMatch(mockCardPaymentItem({ last4: '9999' }), [testCard]).status)
      .toBe('needs_selection');
  });

  it('requires a selected or matched card before posting', async () => {
    await expect(recordReviewQueueCardPayment(mockCardPaymentItem(), undefined))
      .rejects.toThrow('Credit card selection required');

    expect(mockAddCCTransaction).not.toHaveBeenCalled();
    expect(mockMarkPosted).not.toHaveBeenCalled();
  });

  it('records credit card bill payment without creating normal income or expense', async () => {
    const item = mockCardPaymentItem();

    await recordReviewQueueCardPayment(item, 'card_1');

    expect(mockAddTransaction).not.toHaveBeenCalled();
    expect(mockAddCCTransaction).toHaveBeenCalledWith(expect.objectContaining({
      card_id: 'card_1',
      amount: 100,
      type: 'payment',
      category: 'Credit Card Bill Payment',
    }));
    expect(mockMarkPosted).toHaveBeenCalledWith(item.id, 'cc_tx_1');
  });

  it('leaves candidate pending when card payment write fails', async () => {
    mockAddCCTransaction.mockRejectedValueOnce(new Error('Supabase write failed'));
    const item = mockCardPaymentItem();

    await expect(recordReviewQueueCardPayment(item, 'card_1'))
      .rejects.toThrow('Supabase write failed');

    expect(mockMarkPosted).not.toHaveBeenCalled();
  });

  it('blocks duplicate card payments for same card, amount, type, and close time', async () => {
    const item = mockCardPaymentItem();
    const timestamp = Number(item.id.match(/^sig_(\d+)_/)?.[1]);
    mockGetCardTransactions.mockResolvedValueOnce([{
      id: 'cc_tx_existing',
      card_id: 'card_1',
      amount: 100,
      type: 'payment',
      transaction_date: new Date(timestamp + 60 * 1000).toISOString(),
    }]);

    const result = await recordReviewQueueCardPayment(item, 'card_1');

    expect(result.status).toBe('duplicate');
    expect(mockAddCCTransaction).not.toHaveBeenCalled();
    expect(mockMarkPosted).toHaveBeenCalledWith(item.id, 'cc_tx_existing');
  });

  it('does not copy raw text into the card payment description', async () => {
    const item = {
      ...mockCardPaymentItem({ merchantOrPerson: null }),
      candidate: {
        ...mockCardPaymentItem({ merchantOrPerson: null }).candidate,
        rawText: 'OTP 123456 full raw sms should not be stored',
      },
    } as ReviewItem;

    expect(buildCardPaymentDescription(item)).toBe('Card payment from Task20BCardPayment');

    await recordReviewQueueCardPayment(item, 'card_1');

    expect(mockAddCCTransaction).toHaveBeenCalledWith(expect.objectContaining({
      description: 'Card payment from Task20BCardPayment',
    }));
    expect(JSON.stringify(mockAddCCTransaction.mock.calls[0][0])).not.toContain('OTP 123456');
  });

  it('falls back to safe source when merchant looks like raw card payment text', async () => {
    const item = mockCardPaymentItem({
      merchantOrPerson: 'Payment of Rs.5000 received towards your HDFC Credit Card ending 1234 OTP 123456 call 18003097986',
    });

    expect(buildCardPaymentDescription(item)).toBe('Card payment from Task20BCardPayment');

    await recordReviewQueueCardPayment(item, 'card_1');

    const payload = mockAddCCTransaction.mock.calls[0][0];
    expect(payload.description).toBe('Card payment from Task20BCardPayment');
    expect(JSON.stringify(payload)).not.toContain('OTP 123456');
    expect(JSON.stringify(payload)).not.toContain('18003097986');
  });
});
