import { Transaction } from '../types';
import {
  computeMonthlyTransactionTotals,
  isDashboardExpense,
  isDashboardIncome,
} from './financeSummary';

const baseTransaction = (overrides: Partial<Transaction>): Transaction => ({
  id: overrides.id || 'tx_1',
  user_id: 'user_1',
  amount: overrides.amount ?? 20,
  type: overrides.type || 'expense',
  note: overrides.note || 'Test transaction',
  category: overrides.category || 'Test',
  created_at: overrides.created_at || '2026-06-06T10:00:00.000Z',
  ...overrides,
});

describe('Dashboard transaction counting', () => {
  it('excludes generic review-required debit and credit rows until classification is confirmed', () => {
    const debit = baseTransaction({
      id: 'generic_debit',
      type: 'expense',
      account_match_status: 'review_required',
      account_match_reason: 'unverified_debit',
    });
    const credit = baseTransaction({
      id: 'generic_credit',
      type: 'income',
      account_match_status: 'review_required',
      account_match_reason: 'unverified_credit',
    });

    expect(isDashboardExpense(debit)).toBe(false);
    expect(isDashboardIncome(credit)).toBe(false);

    const totals = computeMonthlyTransactionTotals([debit, credit], new Date('2026-06-10T00:00:00.000Z'));
    expect(totals.totalIncome).toBe(0);
    expect(totals.grossExpense).toBe(0);
    expect(totals.monthlyBalance).toBe(0);
  });

  it('counts Transaction Detail confirmed income and expense rows immediately', () => {
    const expense = baseTransaction({
      id: 'confirmed_expense',
      amount: 20,
      type: 'expense',
      account_match_status: 'manual_confirmed',
      account_match_reason: 'review_detail_expense_confirmed',
    });
    const income = baseTransaction({
      id: 'confirmed_income',
      amount: 50,
      type: 'income',
      account_match_status: 'manual_confirmed',
      account_match_reason: 'review_detail_income_confirmed',
    });

    const totals = computeMonthlyTransactionTotals([expense, income], new Date('2026-06-10T00:00:00.000Z'));
    expect(totals.totalIncome).toBe(50);
    expect(totals.grossExpense).toBe(20);
    expect(totals.monthlyBalance).toBe(30);
  });
});
