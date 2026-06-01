import { Transaction } from '../types';
import {
  computeDashboardReviewBreakdown,
  computeDashboardReviewPromptSummary,
  computeMonthlyTransactionTotals,
  getDashboardReviewMovement,
} from './financeSummary';

function tx(overrides: Partial<Transaction>): Transaction {
  return {
    id: overrides.id || `tx_${Math.random()}`,
    user_id: 'user_1',
    amount: overrides.amount ?? 0,
    type: overrides.type || 'expense',
    note: overrides.note || 'Test transaction',
    category: overrides.category || 'general',
    created_at: overrides.created_at || '2026-05-15T10:00:00.000Z',
    ...overrides,
  };
}

describe('computeMonthlyTransactionTotals', () => {
  it('keeps refunds out of income and reduces net expense', () => {
    const totals = computeMonthlyTransactionTotals([
      tx({ amount: 1000, type: 'income' }),
      tx({ amount: 700, type: 'expense' }),
      tx({ amount: 200, type: 'refund', refund_of_transaction_id: 'expense_1' }),
    ], new Date('2026-05-20T00:00:00.000Z'));

    expect(totals.totalIncome).toBe(1000);
    expect(totals.grossExpense).toBe(700);
    expect(totals.totalRefunds).toBe(200);
    expect(totals.netExpense).toBe(500);
    expect(totals.totalExpense).toBe(500);
    expect(totals.monthlyBalance).toBe(500);
  });

  it('does not let refunds affect investment, EMI, or transfer totals', () => {
    const totals = computeMonthlyTransactionTotals([
      tx({ amount: 1000, type: 'income' }),
      tx({ amount: 700, type: 'expense' }),
      tx({ amount: 200, type: 'refund', refund_of_transaction_id: 'expense_1' }),
      tx({ amount: 100, type: 'investment' }),
      tx({ amount: 50, type: 'emi' }),
      tx({ amount: 300, type: 'transfer' }),
    ], new Date('2026-05-20T00:00:00.000Z'));

    expect(totals.totalInvestment).toBe(100);
    expect(totals.totalEMI).toBe(50);
    expect(totals.monthlyBalance).toBe(350);
  });

  it('keeps transfer neutral and ignores transactions outside the selected month', () => {
    const totals = computeMonthlyTransactionTotals([
      tx({ amount: 500, type: 'transfer' }),
      tx({ amount: 1000, type: 'income', created_at: '2026-04-15T10:00:00.000Z' }),
      tx({ amount: 100, type: 'expense' }),
    ], new Date('2026-05-20T00:00:00.000Z'));

    expect(totals.totalIncome).toBe(0);
    expect(totals.grossExpense).toBe(100);
    expect(totals.totalRefunds).toBe(0);
    expect(totals.monthlyBalance).toBe(-100);
  });

  it('clamps net expense at zero when refunds exceed gross expense', () => {
    const totals = computeMonthlyTransactionTotals([
      tx({ amount: 100, type: 'expense' }),
      tx({ amount: 250, type: 'refund', refund_of_transaction_id: 'expense_1' }),
    ], new Date('2026-05-20T00:00:00.000Z'));

    expect(totals.grossExpense).toBe(100);
    expect(totals.totalRefunds).toBe(250);
    expect(totals.netExpense).toBe(0);
    expect(totals.monthlyBalance).toBe(0);
  });

  it('excludes personal transfers and cash deposits even when older rows were stored as income or expense', () => {
    const totals = computeMonthlyTransactionTotals([
      tx({ id: 'cash_deposit', amount: 11000, type: 'income', note: 'Cash deposit', sms_source: 'bank' }),
      tx({ id: 'bank_deposit', amount: 12000, type: 'income', note: 'Bank deposit', sms_source: 'bank' }),
      tx({ id: 'family_credit', amount: 11000, type: 'income', note: 'Brother transfer', sms_source: 'upi' }),
      tx({ id: 'family_debit', amount: 11000, type: 'expense', note: 'Sent to brother', sms_source: 'upi' }),
      tx({ id: 'cash_withdrawal', amount: 500, type: 'expense', category: 'Cash & ATM', note: 'ATM withdrawal', sms_source: 'bank' }),
      tx({ id: 'self_transfer', amount: 700, type: 'expense', note: 'Own account transfer', sms_source: 'bank' }),
    ], new Date('2026-05-20T00:00:00.000Z'));

    expect(totals.totalIncome).toBe(0);
    expect(totals.grossExpense).toBe(0);
    expect(totals.monthlyBalance).toBe(0);
  });

  it('keeps generic auto-detected credits and debits out until they have proof or review', () => {
    const totals = computeMonthlyTransactionTotals([
      tx({ id: 'generic_credit', amount: 1000, type: 'income', note: 'UPI credit', sms_source: 'upi' }),
      tx({ id: 'generic_debit', amount: 300, type: 'expense', note: 'UPI payment', sms_source: 'upi' }),
    ], new Date('2026-05-20T00:00:00.000Z'));

    expect(totals.totalIncome).toBe(0);
    expect(totals.grossExpense).toBe(0);
  });

  it('includes salary, gig payout, merchant expense, and explicitly reviewed income', () => {
    const totals = computeMonthlyTransactionTotals([
      tx({ id: 'salary', amount: 20000, type: 'income', category: 'Salary', note: 'Salary credited', sms_source: 'bank' }),
      tx({ id: 'gig', amount: 3000, type: 'income', category: 'Porter', note: 'Porter payout', sms_source: 'bank' }),
      tx({ id: 'merchant', amount: 500, type: 'expense', category: 'Groceries', note: 'Merchant purchase', sms_source: 'upi' }),
      tx({ id: 'reviewed', amount: 1200, type: 'income', note: 'UPI credit', sms_source: 'upi' }),
    ], new Date('2026-05-20T00:00:00.000Z'), {
      incomeReviewDecisions: [{
        transaction_id: 'reviewed',
        decision: 'count_as_income',
      }],
    });

    expect(totals.totalIncome).toBe(24200);
    expect(totals.grossExpense).toBe(500);
    expect(totals.monthlyBalance).toBe(23700);
  });

  it('honors explicit not-income review decisions', () => {
    const totals = computeMonthlyTransactionTotals([
      tx({ id: 'salary', amount: 20000, type: 'income', category: 'Salary', note: 'Salary credited', sms_source: 'bank' }),
    ], new Date('2026-05-20T00:00:00.000Z'), {
      incomeReviewDecisions: [{
        transaction_id: 'salary',
        decision: 'not_income',
      }],
    });

    expect(totals.totalIncome).toBe(0);
  });
});

describe('computeDashboardReviewPromptSummary', () => {
  it.each([
    ['bank deposit', tx({ id: 'bank_deposit', amount: 12000, type: 'income', note: 'Bank deposit', sms_source: 'bank' })],
    ['cash deposit', tx({ id: 'cash_deposit', amount: 11000, type: 'income', note: 'Cash deposit', sms_source: 'bank' })],
    ['person credit', tx({ id: 'family_credit', amount: 11000, type: 'income', note: 'Brother transfer', sms_source: 'upi' })],
    ['person debit', tx({ id: 'family_debit', amount: 11000, type: 'expense', note: 'Sent to brother', sms_source: 'upi' })],
    ['cash withdrawal', tx({ id: 'cash_withdrawal', amount: 500, type: 'expense', category: 'Cash & ATM', note: 'ATM withdrawal', sms_source: 'bank' })],
  ])('%s is excluded and increments the review count', (_label, transaction) => {
    const summary = computeDashboardReviewPromptSummary([transaction], new Date('2026-05-20T00:00:00.000Z'));

    expect(summary.count).toBe(1);
    expect(summary.items[0].transactionId).toBe(transaction.id);
  });

  it('keeps merchant expense and salary out of the review prompt', () => {
    const summary = computeDashboardReviewPromptSummary([
      tx({ id: 'merchant', amount: 500, type: 'expense', category: 'Groceries', note: 'Merchant purchase', sms_source: 'upi' }),
      tx({ id: 'salary', amount: 20000, type: 'income', category: 'Salary', note: 'Salary credited', sms_source: 'bank' }),
      tx({ id: 'gig', amount: 3000, type: 'income', category: 'Porter', note: 'Porter payout', sms_source: 'bank' }),
    ], new Date('2026-05-20T00:00:00.000Z'));

    expect(summary.count).toBe(0);
    expect(summary.route).toBeNull();
  });

  it('removes reviewed income from the review prompt and counts it as income', () => {
    const transaction = tx({ id: 'reviewed', amount: 1200, type: 'income', note: 'UPI credit', sms_source: 'upi' });
    const incomeReviewDecisions = [{
      transaction_id: 'reviewed',
      decision: 'count_as_income' as const,
    }];

    const reviewSummary = computeDashboardReviewPromptSummary([transaction], new Date('2026-05-20T00:00:00.000Z'), {
      incomeReviewDecisions,
    });
    const totals = computeMonthlyTransactionTotals([transaction], new Date('2026-05-20T00:00:00.000Z'), {
      incomeReviewDecisions,
    });

    expect(reviewSummary.count).toBe(0);
    expect(totals.totalIncome).toBe(1200);
  });

  it('routes credit-only prompts to Income Review and mixed prompts to Review Queue', () => {
    expect(computeDashboardReviewPromptSummary([
      tx({ id: 'credit', amount: 1000, type: 'income', note: 'UPI credit', sms_source: 'upi' }),
    ], new Date('2026-05-20T00:00:00.000Z')).route).toBe('income_review');

    expect(computeDashboardReviewPromptSummary([
      tx({ id: 'credit', amount: 1000, type: 'income', note: 'UPI credit', sms_source: 'upi' }),
      tx({ id: 'debit', amount: 400, type: 'expense', note: 'Sent to brother', sms_source: 'upi' }),
    ], new Date('2026-05-20T00:00:00.000Z')).route).toBe('review_queue');
  });
});

describe('computeDashboardReviewBreakdown', () => {
  const selectedDate = new Date('2026-05-20T00:00:00.000Z');
  const queuedCredit = {
    status: 'pending' as const,
    candidate: {
      signalId: `sig_${new Date('2026-05-14T15:20:00.000Z').getTime()}_abcd`,
      direction: 'credit' as const,
      amount: 5000,
    },
  };

  it('keeps historical excluded rows out of the actionable CTA count', () => {
    const historical = computeDashboardReviewPromptSummary([
      tx({ id: 'old_debit', type: 'expense', amount: 500, note: 'Sent to brother', sms_source: 'upi' }),
    ], selectedDate);

    expect(computeDashboardReviewBreakdown(historical, [], [])).toEqual({
      totalReviewableCount: 0,
      incomeReviewCount: 0,
      transactionReviewCount: 0,
      historicalCorrectionCount: 1,
    });
  });

  it('counts unresolved income candidates and pending Review Queue cards separately', () => {
    const breakdown = computeDashboardReviewBreakdown(
      computeDashboardReviewPromptSummary([], selectedDate),
      [{
        amount: 1200,
        receivedAt: '2026-05-15T10:00:00.000Z',
        suggestedDecision: 'needs_review',
      }],
      [{
        status: 'pending',
        candidate: {
          signalId: 'sig_1778810400000_debit',
          direction: 'debit',
          amount: 400,
        },
      }]
    );

    expect(breakdown).toEqual({
      totalReviewableCount: 2,
      incomeReviewCount: 1,
      transactionReviewCount: 1,
      historicalCorrectionCount: 0,
    });
  });

  it.each(['count_as_income', 'not_income'] as const)(
    'removes %s decisions from the actionable income count',
    decision => {
      const breakdown = computeDashboardReviewBreakdown(
        computeDashboardReviewPromptSummary([], selectedDate),
        [{
          amount: 1200,
          receivedAt: '2026-05-15T10:00:00.000Z',
          suggestedDecision: 'needs_review',
          currentDecision: { decision },
        }],
        []
      );

      expect(breakdown.incomeReviewCount).toBe(0);
      expect(breakdown.totalReviewableCount).toBe(0);
    }
  );

  it('does not double count an evidence-backed credit already represented in Review Queue', () => {
    const breakdown = computeDashboardReviewBreakdown(
      computeDashboardReviewPromptSummary([], selectedDate),
      [{
        amount: 5000,
        receivedAt: '2026-05-14T15:20:00.000Z',
        suggestedDecision: 'needs_review',
      }],
      [queuedCredit]
    );

    expect(breakdown.incomeReviewCount).toBe(0);
    expect(breakdown.transactionReviewCount).toBe(1);
    expect(breakdown.totalReviewableCount).toBe(1);
  });
});

describe('getDashboardReviewMovement', () => {
  it('returns safe labels without raw transaction text', () => {
    const movement = getDashboardReviewMovement(tx({
      id: 'private_person',
      amount: 11000,
      type: 'expense',
      note: 'Sent to Rahul 9876543210 rahul@oksbi private note',
      sms_source: 'upi',
    }));

    expect(movement).toEqual(expect.objectContaining({
      label: 'Personal transfer',
      route: 'review_queue',
    }));
    expect(JSON.stringify(movement)).not.toContain('Rahul');
    expect(JSON.stringify(movement)).not.toContain('9876543210');
    expect(JSON.stringify(movement)).not.toContain('@oksbi');
  });
});
