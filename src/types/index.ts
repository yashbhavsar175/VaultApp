export type TransactionType = 'income' | 'expense' | 'investment' | 'emi' | 'transfer' | 'lent' | 'borrowed' | 'refund';

export type AccountMatchStatus =
  | 'unlinked'
  | 'linked'
  | 'ambiguous'
  | 'review_required'
  | 'ignored'
  | 'manual_confirmed';

export type AccountMatchConfidence = 'exact' | 'high' | 'medium' | 'low';
export type AccountMatchOwnerType = 'bank_account' | 'credit_card' | 'debit_card';

export interface Transaction {
  id: string;
  user_id: string;
  amount: number;
  type: TransactionType;
  note: string;
  category: string;
  created_at: string;
  account_id?: string | null;
  account_last4?: string | null;
  sms_source?: string | null;
  sms_sender?: string | null;
  upi_id?: string | null;  // UPI ID used for transaction (e.g., user@paytm)
  reference_number?: string | null;
  raw_sms?: string | null;
  balance?: number | null;
  from_account_id?: string | null;
  to_account_id?: string | null;
  is_transfer_pending?: boolean | null;
  is_seed?: boolean | null;
  refund_of_transaction_id?: string | null;
  account_match_status?: AccountMatchStatus | null;
  account_match_confidence?: AccountMatchConfidence | null;
  account_match_reason?: string | null;
  account_match_owner_type?: AccountMatchOwnerType | null;
  account_match_owner_id?: string | null;
  primary_evidence_id?: string | null;
}

export type EvidenceSourceType = 'sms' | 'notification' | 'accessibility' | 'manual' | 'imported';

export type EvidenceDirection = 'debit' | 'credit' | 'transfer' | 'unknown';

export type EvidenceInstrumentHint =
  | 'bank_account'
  | 'debit_card'
  | 'credit_card'
  | 'wallet'
  | 'loan'
  | 'unknown';

export type EvidenceConfidenceLevel = 'exact' | 'high' | 'medium' | 'low';

export type EvidenceMatchStatus = 'unlinked' | 'linked' | 'ambiguous' | 'review_required' | 'ignored';

export interface TransactionEvidence {
  id: string;
  user_id: string;
  signal_id: string;
  transaction_id: string | null;
  source_type: EvidenceSourceType;
  source_package: string | null;
  source_app: string | null;
  sender: string | null;
  amount: number | null;
  direction: EvidenceDirection | null;
  captured_at: string;
  reference_number: string | null;
  merchant_or_person: string | null;
  bank_name: string | null;
  account_last4: string | null;
  card_last4: string | null;
  instrument_hint: EvidenceInstrumentHint | null;
  upi_id_masked: string | null;
  upi_id_hash: string | null;
  confidence_level: EvidenceConfidenceLevel;
  match_status: EvidenceMatchStatus;
  match_reason_code: string | null;
  raw_source_metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface AccountAppMapping {
  id: string;
  user_id: string;
  app_package: string;
  app_label: string | null;
  payment_method_hash: string | null;
  payment_method_masked: string | null;
  owner_type: 'bank_account' | 'credit_card' | 'debit_card' | 'wallet';
  owner_id: string;
  account_last4: string | null;
  card_last4: string | null;
  bank_name: string | null;
  confidence_level: 'medium' | 'low';
  use_count: number;
  last_confirmed_at: string | null;
  status: 'active' | 'disabled';
  created_at: string;
  updated_at: string;
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
  monthly_emi_amount?: number | null;
  upi_ids: string[];
  is_archived?: boolean;
  archived_at?: string | null;
  created_at: string;
}

export type BalanceOwnerType =
  | 'bank_account'
  | 'credit_card'
  | 'debit_card'
  | 'loan'
  | 'cash'
  | 'detected_account'
  | 'detected_card';

export type BalanceKind =
  | 'available_balance'
  | 'current_balance'
  | 'outstanding'
  | 'available_limit'
  | 'credit_limit'
  | 'due_amount'
  | 'minimum_due'
  | 'loan_outstanding';

export type BalanceSource = 'sms' | 'notification' | 'calculated' | 'manual' | 'review' | 'import';

export type BalanceConfidence = 'exact' | 'estimated' | 'low';

export interface BalanceSnapshot {
  id: string;
  user_id: string;
  owner_type: BalanceOwnerType;
  owner_id: string | null;
  detected_bank_name: string | null;
  account_last4: string | null;
  card_last4: string | null;
  balance_kind: BalanceKind;
  amount: number;
  currency: string;
  source: BalanceSource;
  confidence: BalanceConfidence;
  detected_at: string;
  source_sender_or_package: string | null;
  raw_source_metadata: Record<string, unknown>;
  note: string | null;
  created_at: string;
}

export interface DebitCard {
  id: string;
  user_id: string;
  bank_account_id: string | null;
  bank_name: string | null;
  card_last4: string;
  card_network: string | null;
  card_label: string | null;
  status: 'active' | 'inactive' | 'replaced' | 'detected';
  detected_confidence: BalanceConfidence;
  source_sender_or_package: string | null;
  last_seen_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface DetectedAccount {
  id: string;
  user_id: string;
  detection_type: 'bank_account' | 'credit_card' | 'debit_card' | 'loan';
  detected_bank_name: string | null;
  account_last4: string | null;
  card_last4: string | null;
  account_type_hint: string | null;
  balance_amount: number | null;
  balance_kind: BalanceKind | null;
  source: Exclude<BalanceSource, 'calculated' | 'review'>;
  confidence: BalanceConfidence;
  status: 'pending' | 'confirmed' | 'merged' | 'ignored';
  matched_owner_type: BalanceOwnerType | null;
  matched_owner_id: string | null;
  source_sender_or_package: string | null;
  raw_source_metadata: Record<string, unknown>;
  first_seen_at: string;
  last_seen_at: string;
  created_at: string;
  updated_at: string;
}

export interface CreditCardStatement {
  id: string;
  user_id: string;
  credit_card_id: string;
  statement_date: string | null;
  period_start: string | null;
  period_end: string | null;
  total_due: number | null;
  minimum_due: number | null;
  payment_due_date: string | null;
  statement_balance: number | null;
  source_snapshot_id: string | null;
  status: 'open' | 'paid' | 'partial' | 'overdue' | 'unknown';
  source: Exclude<BalanceSource, 'calculated' | 'review'> | null;
  confidence: BalanceConfidence | null;
  raw_source_metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
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
