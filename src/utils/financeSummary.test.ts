import { Transaction } from '../types';
import { computeMonthlyTransactionTotals } from './financeSummary';

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
});
