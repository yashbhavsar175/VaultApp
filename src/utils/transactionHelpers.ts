// ═══════════════════════════════════════════════════════════════════════════════
// TRANSACTION HELPER FUNCTIONS
// Shared utilities for transaction screens
// ═══════════════════════════════════════════════════════════════════════════════

export const getTransactionIcon = (type: string): string => {
  switch (type) {
    case 'income': return 'arrow-down-circle';
    case 'expense': return 'arrow-up-circle';
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
    case 'investment': return '#7c3aed';
    case 'emi': return '#f59e0b';
    case 'transfer': return '#f97316';
    case 'lent': return '#06b6d4';
    case 'borrowed': return '#ec4899';
    default: return '#999';
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
