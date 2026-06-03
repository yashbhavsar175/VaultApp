import { addTransaction } from '../core';
import { getLatestBalanceSnapshot } from './balanceSnapshots';
import {
  addCreditCard,
  addCCTransaction,
  archiveBankAccountIfSupported,
  getCardTransactions,
} from '../database/financial';
import { markPosted, ReviewItem } from './autoTransactionReviewQueue';
import {
  buildCardPaymentDescription,
  inferLegacyCreditCardOutstanding,
  linkLegacyCreditCardAccount,
  recordReviewQueueCardPayment,
  resolveCreditCardMatch,
} from './reviewQueueCardPayments';

jest.mock('../core', () => ({
  addTransaction: jest.fn(),
}));

jest.mock('../database/financial', () => ({
  addCreditCard: jest.fn(),
  addCCTransaction: jest.fn(),
  archiveBankAccountIfSupported: jest.fn(),
  getCardTransactions: jest.fn(),
}));

jest.mock('./autoTransactionReviewQueue', () => ({
  markPosted: jest.fn(),
}));

jest.mock('./balanceSnapshots', () => ({
  getLatestBalanceSnapshot: jest.fn(),
}));

jest.mock('./dataEvents', () => ({
  emitFinanceDataChanged: jest.fn(),
}));

const mockAddTransaction = addTransaction as jest.Mock;
const mockAddCreditCard = addCreditCard as jest.Mock;
const mockAddCCTransaction = addCCTransaction as jest.Mock;
const mockArchiveBankAccountIfSupported = archiveBankAccountIfSupported as jest.Mock;
const mockGetCardTransactions = getCardTransactions as jest.Mock;
const mockGetLatestBalanceSnapshot = getLatestBalanceSnapshot as jest.Mock;
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

const legacyHdfcCardAccount = {
  id: 'legacy_card_bank_1',
  user_id: 'user_1',
  bank_name: 'HDFC Bank',
  account_last4: '2246',
  account_type: 'credit_card' as const,
  starting_balance: 1200,
  balance: 82410,
  credit_limit: 83000,
  loan_total: 0,
  upi_ids: [],
  created_at: new Date().toISOString(),
};

function legacyCard(
  overrides: Partial<typeof legacyHdfcCardAccount> & Record<string, unknown> = {}
): typeof legacyHdfcCardAccount {
  return { ...legacyHdfcCardAccount, ...overrides };
}

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
    mockGetLatestBalanceSnapshot.mockResolvedValue(null);
    mockAddCreditCard.mockImplementation(async payload => ({
      ...testCard,
      id: 'card_linked_2246',
      user_id: 'user_1',
      bank_name: payload.bank_name,
      card_name: payload.card_name,
      last_4_digits: payload.last_4_digits,
      credit_limit: payload.credit_limit,
      current_outstanding: payload.current_outstanding ?? 0,
    }));
    mockAddCCTransaction.mockResolvedValue({
      id: 'cc_tx_1',
      card_id: 'card_1',
      amount: 100,
      type: 'payment',
      transaction_date: new Date().toISOString(),
    });
    mockArchiveBankAccountIfSupported.mockResolvedValue(true);
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

  it('matches configured credit card by parsed cardLast4 even when bank account last4 differs', () => {
    const item = mockCardPaymentItem({
      last4: '0719',
      accountLast4: '0719',
      cardLast4: '1234',
    });

    const result = resolveCreditCardMatch(item, [testCard]);

    expect(result.status).toBe('matched');
    if (result.status === 'matched') {
      expect(result.card.id).toBe('card_1');
    }
  });

  it('offers legacy credit-card setup link for HDFC card payment instead of setup prompt', () => {
    const item = mockCardPaymentItem({
      last4: '2246',
      cardLast4: '2246',
      redactedPreview: {
        amount: 100,
        detectedSource: 'HDFCBK',
        autoClass: 'credit_card_bill_payment',
        maskedLast4: 'XX2246',
        hashSummary: 'len=42 hash=abc',
      },
    });

    const result = resolveCreditCardMatch(item, [], [legacyHdfcCardAccount]);

    expect(result.status).toBe('needs_legacy_link');
    if (result.status === 'needs_legacy_link') {
      expect(result.last4).toBe('2246');
      expect(result.legacyAccount.id).toBe('legacy_card_bank_1');
    }
  });

  it('prefers a real credit_cards row over a matching legacy credit-card bank account', () => {
    const realCard2246 = { ...testCard, id: 'card_real_2246', last_4_digits: '2246' };
    const item = mockCardPaymentItem({ last4: '2246', cardLast4: '2246' });

    const result = resolveCreditCardMatch(item, [realCard2246], [legacyHdfcCardAccount]);

    expect(result.status).toBe('matched');
    if (result.status === 'matched') {
      expect(result.card.id).toBe('card_real_2246');
    }
  });

  it('links a legacy credit-card bank account and treats near-limit balance as available credit', async () => {
    const result = await linkLegacyCreditCardAccount(legacyHdfcCardAccount, []);

    expect(mockAddCreditCard).toHaveBeenCalledWith(expect.objectContaining({
      bank_name: 'HDFC Bank',
      card_name: 'HDFC Bank card 2246',
      last_4_digits: '2246',
      credit_limit: 83000,
      current_outstanding: 590,
      due_date: 1,
      billing_cycle_date: 1,
    }));
    expect(mockArchiveBankAccountIfSupported).toHaveBeenCalledWith('legacy_card_bank_1');
    expect(result).toEqual(expect.objectContaining({
      reusedExisting: false,
      archivedLegacy: true,
      card: expect.objectContaining({ id: 'card_linked_2246', last_4_digits: '2246' }),
      outstandingInference: expect.objectContaining({
        currentOutstanding: 590,
        source: 'available_credit',
        needsUserConfirmation: false,
      }),
    }));
  });

  it('infers near-zero outstanding from HDFC available limit evidence', () => {
    expect(inferLegacyCreditCardOutstanding(
      legacyCard({ balance: 82999.86, credit_limit: 83000 }),
      { balanceKind: 'available_limit' }
    )).toEqual({
      currentOutstanding: 0.14,
      source: 'available_credit',
      needsUserConfirmation: false,
    });
  });

  it('uses available-limit snapshot evidence when legacy balance is below the near-limit fallback', async () => {
    mockGetLatestBalanceSnapshot.mockImplementation(async (_ownerType, _ownerId, balanceKind) =>
      balanceKind === 'available_limit' ? { amount: 50000 } : null
    );

    const result = await linkLegacyCreditCardAccount(
      legacyCard({ balance: 50000, credit_limit: 83000 }),
      []
    );

    expect(mockGetLatestBalanceSnapshot).toHaveBeenCalledWith(
      'bank_account',
      'legacy_card_bank_1',
      'available_limit'
    );
    expect(mockAddCreditCard).toHaveBeenCalledWith(expect.objectContaining({
      credit_limit: 83000,
      current_outstanding: 33000,
    }));
    expect(result.outstandingInference).toEqual({
      currentOutstanding: 33000,
      source: 'available_credit',
      needsUserConfirmation: false,
    });
  });

  it('uses a small legacy balance as outstanding only when source semantics say outstanding', () => {
    expect(inferLegacyCreditCardOutstanding(
      legacyCard({ balance: 590, credit_limit: 83000 }),
      { balanceKind: 'outstanding' }
    )).toEqual({
      currentOutstanding: 590,
      source: 'explicit_outstanding',
      needsUserConfirmation: false,
    });
  });

  it('does not create a confident false debt from an ambiguous small legacy balance', () => {
    expect(inferLegacyCreditCardOutstanding(
      legacyCard({ balance: 590, credit_limit: 83000 })
    )).toEqual({
      currentOutstanding: 0,
      source: 'ambiguous_default',
      needsUserConfirmation: true,
    });
  });

  it('reuses an existing credit card during legacy link and does not create a duplicate card', async () => {
    const existingCard = { ...testCard, id: 'card_real_2246', last_4_digits: '2246' };

    const result = await linkLegacyCreditCardAccount(legacyHdfcCardAccount, [existingCard]);

    expect(mockAddCreditCard).not.toHaveBeenCalled();
    expect(mockArchiveBankAccountIfSupported).toHaveBeenCalledWith('legacy_card_bank_1');
    expect(result).toEqual(expect.objectContaining({
      reusedExisting: true,
      card: existingCard,
    }));
  });

  it('can post a card payment after legacy setup is linked', async () => {
    const item = mockCardPaymentItem({ last4: '2246', cardLast4: '2246' });
    const linked = await linkLegacyCreditCardAccount(legacyHdfcCardAccount, []);

    await recordReviewQueueCardPayment(item, linked.card.id);

    expect(mockAddCreditCard).toHaveBeenCalledWith(expect.objectContaining({
      current_outstanding: 590,
    }));
    expect(mockAddCCTransaction).toHaveBeenCalledWith(expect.objectContaining({
      card_id: 'card_linked_2246',
      amount: 100,
      type: 'payment',
    }));
    expect(mockMarkPosted).toHaveBeenCalledWith(item.id, 'cc_tx_1');
  });

  it('does not copy raw full card or account numbers while linking legacy setup', async () => {
    await linkLegacyCreditCardAccount(
      legacyCard({ account_last4: '4111 1111 1111 2246' }),
      []
    );

    const payload = mockAddCreditCard.mock.calls[0][0];
    expect(payload.last_4_digits).toBe('2246');
    expect(JSON.stringify(payload)).not.toContain('4111111111112246');
    expect(JSON.stringify(payload)).not.toContain('4111 1111 1111 2246');
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

  it('emits refresh areas after a card payment is posted', async () => {
    const { emitFinanceDataChanged } = require('./dataEvents');
    const item = mockCardPaymentItem();

    await recordReviewQueueCardPayment(item, 'card_1');

    expect(emitFinanceDataChanged).toHaveBeenCalledWith(expect.objectContaining({
      areas: ['transactions', 'accounts', 'balances', 'review'],
      source: 'review_card_payment:posted',
      transactionId: 'cc_tx_1',
    }));
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
