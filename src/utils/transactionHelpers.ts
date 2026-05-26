// ═══════════════════════════════════════════════════════════════════════════════
// TRANSACTION HELPER FUNCTIONS
// Shared utilities for transaction screens
// ═══════════════════════════════════════════════════════════════════════════════

export const getTransactionIcon = (type: string): string => {
  switch (type) {
    case 'income': return 'arrow-down-circle';
    case 'expense': return 'arrow-up-circle';
    case 'refund': return 'cash-refund';
    case 'investment': return 'chart-line';
    case 'emi': return 'credit-card';
    case 'transfer': return 'swap-horizontal';
    case 'lent': return 'hand-coin';
    case 'borrowed': return 'hand-heart';
    default: return 'cash';
  }
};

export const getTransactionColor = (type: string): string => {
  switch (type) {
    case 'income': return '#10b981';
    case 'expense': return '#ef4444';
    case 'refund': return '#14b8a6';
    case 'investment': return '#7c3aed';
    case 'emi': return '#f59e0b';
    case 'transfer': return '#f97316';
    case 'lent': return '#06b6d4';
    case 'borrowed': return '#ec4899';
    default: return '#999';
  }
};

export const getTransactionAmountPrefix = (type: string): string => {
  switch (type) {
    case 'income':
    case 'refund':
      return '+';
    case 'transfer':
      return '\u2194';
    default:
      return '-';
  }
};

export const getTransactionTypeLabel = (type: string): string => {
  switch (type) {
    case 'income': return 'Income';
    case 'expense': return 'Expense';
    case 'refund': return 'Refund';
    case 'investment': return 'Investment';
    case 'emi': return 'EMI';
    case 'transfer': return 'Transfer';
    case 'lent': return 'Lent';
    case 'borrowed': return 'Borrowed';
    default:
      return type
        .replace(/[_-]/g, ' ')
        .replace(/\b\w/g, char => char.toUpperCase());
  }
};

export const formatTransactionDate = (dateString: string): string => {
  const date = new Date(dateString);
  return date.toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
};

export const formatTransactionDateTime = (dateString: string): {
  date: string;
  time: string;
} => {
  const date = new Date(dateString);
  return {
    date: date.toLocaleDateString('en-IN', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    }),
    time: date.toLocaleTimeString('en-IN', {
      hour: '2-digit',
      minute: '2-digit',
    }),
  };
};
