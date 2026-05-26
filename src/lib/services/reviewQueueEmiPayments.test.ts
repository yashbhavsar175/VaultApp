import { addTransaction } from '../core';
import {
  addEMIPayment,
  getEMIPayments,
  Loan,
} from '../database/financial';
import { markPosted, ReviewItem } from './autoTransactionReviewQueue';
import {
  canRecordEMIWithLoan,
  recordReviewQueueEMIPayment,
  resolveLoanMatch,
} from './reviewQueueEmiPayments';

jest.mock('../core', () => ({
  addTransaction: jest.fn(),
}));

jest.mock('../database/financial', () => ({
  addEMIPayment: jest.fn(),
  getEMIPayments: jest.fn(),
}));

jest.mock('./autoTransactionReviewQueue', () => ({
  markPosted: jest.fn(),
}));

const mockAddTransaction = addTransaction as jest.Mock;
const mockAddEMIPayment = addEMIPayment as jest.Mock;
const mockGetEMIPayments = getEMIPayments as jest.Mock;
const mockMarkPosted = markPosted as jest.Mock;

const testLoan: Loan = {
  id: 'loan_1',
  user_id: 'user_1',
  loan_name: 'HDFC Home Loan',
  lender_name: 'HDFC Bank',
  principal_amount: 500000,
  current_outstanding: 400000,
  emi_amount: 100,
  emi_due_date: 25,
  interest_rate: 12,
  tenure_months: 60,
  start_date: '2026-01-01',
  loan_type: 'Home',
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
};

function mockEMIItem(overrides: Partial<ReviewItem['candidate']> = {}): ReviewItem {
  const timestamp = Date.parse('2026-05-25T10:00:00.000Z');
  return {
    id: `sig_${timestamp}_emi`,
    candidate: {
      signalId: `sig_${timestamp}_emi`,
      autoClass: 'loan_emi_payment',
      direction: 'debit',
      amount: 100,
      merchantOrPerson: 'HDFC Bank',
      last4: null,
      reference: 'EMIREF123',
      instrumentHint: 'loan_account',
      confidenceScore: 88,
      confidenceLevel: 'high',
      decision: 'review_required',
      duplicateFingerprints: [{ strategy: 'hash', value: 'hash_emi' }],
      redactedPreview: {
        amount: 100,
        detectedSource: 'Task20C2Emi',
        autoClass: 'loan_emi_payment',
        maskedLast4: undefined,
        hashSummary: 'len=20 hash=emi',
      },
      ...overrides,
    },
    reasons: ['Requires review before adding to database'],
    status: 'pending',
    createdAt: timestamp,
  };
}

describe('Review Queue EMI payments', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetEMIPayments.mockResolvedValue([]);
    mockAddEMIPayment.mockResolvedValue({
      id: 'emi_payment_1',
      loan_id: 'loan_1',
      user_id: 'user_1',
      amount_paid: 100,
      payment_date: '2026-05-25',
      principal_component: 99,
      interest_component: 1,
      reference_number: 'EMIREF123',
      created_at: new Date().toISOString(),
    });
    mockMarkPosted.mockResolvedValue(true);
  });

  it('matches exactly one configured loan by source and EMI amount', () => {
    const item = mockEMIItem();
    const result = resolveLoanMatch(item, [testLoan]);

    expect(result.status).toBe('matched');
    expect(result.status === 'matched' ? result.loan.id : null).toBe('loan_1');
  });

  it('requires selection when no loan or multiple confident loans are present', () => {
    const item = mockEMIItem();
    const secondLoan = { ...testLoan, id: 'loan_2', loan_name: 'HDFC Personal Loan' };

    expect(resolveLoanMatch(item, []).status).toBe('needs_setup');
    expect(resolveLoanMatch(mockEMIItem({ merchantOrPerson: null }), [testLoan]).status)
      .toBe('needs_selection');
    expect(resolveLoanMatch(item, [testLoan, secondLoan]).status).toBe('needs_selection');
  });

  it('requires a selected or matched loan before posting', async () => {
    await expect(recordReviewQueueEMIPayment(mockEMIItem(), undefined))
      .rejects.toThrow('Loan selection required');

    expect(mockAddEMIPayment).not.toHaveBeenCalled();
    expect(mockMarkPosted).not.toHaveBeenCalled();
  });

  it('records EMI without creating normal income, expense, or transaction rows', async () => {
    const item = mockEMIItem();

    await recordReviewQueueEMIPayment(item, testLoan);

    expect(mockAddTransaction).not.toHaveBeenCalled();
    expect(mockAddEMIPayment).toHaveBeenCalledWith(expect.objectContaining({
      loan_id: 'loan_1',
      amount_paid: 100,
      reference_number: 'EMIREF123',
    }));
    expect(mockMarkPosted).toHaveBeenCalledWith(item.id, 'emi_payment_1');
  });

  it('passes explicit principal and interest split when candidate includes it', async () => {
    const item = mockEMIItem({
      principal_component: 80,
      interest_component: 20,
    } as Partial<ReviewItem['candidate']>);

    await recordReviewQueueEMIPayment(item, { ...testLoan, interest_rate: undefined });

    expect(mockAddEMIPayment).toHaveBeenCalledWith(expect.objectContaining({
      principal_component: 80,
      interest_component: 20,
    }));
  });

  it('allows addEMIPayment to calculate split when loan has interest settings', async () => {
    await recordReviewQueueEMIPayment(mockEMIItem(), testLoan);

    expect(mockAddEMIPayment).toHaveBeenCalledWith(expect.objectContaining({
      principal_component: undefined,
      interest_component: undefined,
    }));
  });

  it('blocks posting when loan has no interest settings and candidate has no split', async () => {
    const loanWithoutRate = { ...testLoan, interest_rate: undefined };

    expect(canRecordEMIWithLoan(mockEMIItem(), loanWithoutRate)).toBe(false);
    await expect(recordReviewQueueEMIPayment(mockEMIItem(), loanWithoutRate))
      .rejects.toThrow('Loan interest rate or EMI split required');

    expect(mockAddEMIPayment).not.toHaveBeenCalled();
    expect(mockMarkPosted).not.toHaveBeenCalled();
  });

  it('leaves candidate pending when EMI write fails', async () => {
    mockAddEMIPayment.mockRejectedValueOnce(new Error('Supabase write failed'));
    const item = mockEMIItem();

    await expect(recordReviewQueueEMIPayment(item, testLoan))
      .rejects.toThrow('Supabase write failed');

    expect(mockMarkPosted).not.toHaveBeenCalled();
  });

  it('blocks duplicate EMI payments by loan, amount, and reference', async () => {
    const item = mockEMIItem();
    mockGetEMIPayments.mockResolvedValueOnce([{
      id: 'emi_existing',
      loan_id: 'loan_1',
      user_id: 'user_1',
      amount_paid: 100,
      payment_date: '2026-05-25',
      reference_number: 'EMIREF123',
      created_at: new Date().toISOString(),
    }]);

    const result = await recordReviewQueueEMIPayment(item, testLoan);

    expect(result.status).toBe('duplicate');
    expect(mockAddEMIPayment).not.toHaveBeenCalled();
    expect(mockMarkPosted).toHaveBeenCalledWith(item.id, 'emi_existing');
  });

  it('blocks duplicate EMI payments by loan, amount, and close payment date', async () => {
    const item = mockEMIItem({ reference: null });
    mockGetEMIPayments.mockResolvedValueOnce([{
      id: 'emi_existing_date',
      loan_id: 'loan_1',
      user_id: 'user_1',
      amount_paid: 100,
      payment_date: '2026-05-25',
      reference_number: null,
      created_at: new Date().toISOString(),
    }]);

    const result = await recordReviewQueueEMIPayment(item, testLoan);

    expect(result.status).toBe('duplicate');
    expect(mockAddEMIPayment).not.toHaveBeenCalled();
    expect(mockMarkPosted).toHaveBeenCalledWith(item.id, 'emi_existing_date');
  });

  it('does not copy raw text into EMI payment payload', async () => {
    const item = {
      ...mockEMIItem(),
      candidate: {
        ...mockEMIItem().candidate,
        rawText: 'OTP 123456 full raw sms should not be stored',
      },
    } as ReviewItem;

    await recordReviewQueueEMIPayment(item, testLoan);

    expect(JSON.stringify(mockAddEMIPayment.mock.calls[0][0])).not.toContain('OTP 123456');
    expect(JSON.stringify(mockAddEMIPayment.mock.calls[0][0])).not.toContain('full raw sms');
  });

  it('keeps credit card bill payment behavior outside EMI routing', async () => {
    await expect(recordReviewQueueEMIPayment({
      ...mockEMIItem(),
      candidate: {
        ...mockEMIItem().candidate,
        autoClass: 'credit_card_bill_payment',
      },
    } as ReviewItem, testLoan)).rejects.toThrow('Unsupported review item for EMI payment');

    expect(mockAddEMIPayment).not.toHaveBeenCalled();
  });
});
