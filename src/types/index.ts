export type TransactionType = 'income' | 'expense' | 'investment' | 'emi' | 'transfer' | 'lent' | 'borrowed';

export interface Transaction {
  id: string;
  user_id: string;
  amount: number;
  type: TransactionType;
  note: string;
  category: string;
  created_at: string;
  account_id?: string;
  account_last4?: string;
  sms_source?: string;
  sms_sender?: string;
  upi_id?: string;  // UPI ID used for transaction (e.g., user@paytm)
}

export interface BankAccount {
  id: string;
  user_id: string;
  bank_name: string;
  account_last4: string;
  account_type: 'savings' | 'current' | 'credit_card' | 'loan';
  starting_balance: number;
  balance: number;
  credit_limit: number;
  loan_total: number;
  upi_ids: string[];
  created_at: string;
}

export interface PeopleLedger {
  id: string;
  user_id: string;
  person_name: string;
  type: 'lent' | 'borrowed';
  total_amount: number;
  paid_amount: number;
  remaining_amount: number;
  repayment_type: 'one_time' | 'installment';
  due_date: string | null;
  installment_amount: number | null;
  installment_days: string[] | null;
  start_date: string | null;
  notes: string | null;
  is_settled: boolean;
  settled_at: string | null;
  created_at: string;
}

export interface PeopleLedgerPayment {
  id: string;
  ledger_id: string;
  amount: number;
  paid_date: string;
  notes: string | null;
  created_at: string;
}

export type PlaceCategory = 'shop' | 'ev_charging' | 'cafe' | 'atm' | 'mechanic' | 'other';

export interface Place {
  id: string;
  name: string;
  category: PlaceCategory;
  note: string;
  location?: {
    latitude: number;
    longitude: number;
    address?: string;
  };
  photo_uri?: string;
  created_at: string;
}
