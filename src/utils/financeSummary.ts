import { Transaction } from '../types';

export interface MonthlyTransactionTotals {
  totalIncome: number;
  grossExpense: number;
  totalRefunds: number;
  netExpense: number;
  totalExpense: number;
  totalInvestment: number;
  totalEMI: number;
  monthlyBalance: number;
}

export function isDashboardIncome(
  transaction: Transaction
): boolean {
  return transaction.type === 'income';
}

export function isDashboardExpense(transaction: Transaction): boolean {
  if (transaction.type !== 'expense') return false;
  
  if (transaction.account_match_status === 'ignored') {
    return false;
  }
  
  return true;
}

export function computeMonthlyTransactionTotals(
  transactions: Transaction[],
  selectedDate: Date
): MonthlyTransactionTotals {
  const year = selectedDate.getFullYear();
  const month = selectedDate.getMonth();

  const totals = transactions.reduce(
    (summary, transaction) => {
      const txDate = new Date(transaction.created_at);
      if (txDate.getFullYear() !== year || txDate.getMonth() !== month) {
        return summary;
      }

      const amount = Number(transaction.amount);
      if (!Number.isFinite(amount)) {
        return summary;
      }

      if (isDashboardIncome(transaction)) {
        summary.totalIncome += amount;
      } else if (isDashboardExpense(transaction)) {
        summary.grossExpense += amount;
      } else if (transaction.type === 'refund') {
        summary.totalRefunds += amount;
      } else if (transaction.type === 'investment') {
        summary.totalInvestment += amount;
      } else if (transaction.type === 'emi') {
        summary.totalEMI += amount;
      }

      return summary;
    },
    {
      totalIncome: 0,
      grossExpense: 0,
      totalRefunds: 0,
      totalInvestment: 0,
      totalEMI: 0,
    }
  );

  const netExpense = Math.max(0, totals.grossExpense - totals.totalRefunds);

  return {
    ...totals,
    netExpense,
    totalExpense: netExpense,
    monthlyBalance: totals.totalIncome - netExpense - totals.totalInvestment - totals.totalEMI,
  };
}
