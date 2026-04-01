export type TransactionType = 'income' | 'expense' | 'investment' | 'emi' | 'transfer';

export interface Transaction {
  id: string;
  user_id: string;
  amount: number;
  type: TransactionType;
  note: string;
  category: string;
  created_at: string;
}

export interface BankAccount {
  id: string;
  user_id: string;
  bank_name: string;
  account_last4: string;
  account_type: 'savings' | 'current' | 'credit_card' | 'loan';
  starting_balance: number;
  credit_limit: number;
  loan_total: number;
  upi_ids: string[];
  created_at: string;
}
