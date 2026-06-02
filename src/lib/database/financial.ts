/**
 * Financial Database Module
 * Consolidated: bankDb.ts + creditCards.ts + loans.ts
 * 
 * Handles all financial account operations:
 * - Bank accounts (savings, checking, credit cards)
 * - Credit cards (tracking, transactions, utilization)
 * - Loans (EMI tracking, payments, progress)
 */

import { supabase } from '../core';
import { BankAccount } from '../../types';

type ArchiveListOptions = {
  includeArchived?: boolean;
  archivedOnly?: boolean;
};

const archiveFallbackWarnings = new Set<string>();
const monthlyEmiFallbackWarnings = new Set<string>();

function isMissingArchiveColumnError(error: any): boolean {
  const message = String(error?.message || '').toLowerCase();
  return error?.code === '42703'
    || message.includes('is_archived')
    || message.includes('archived_at');
}

function warnArchiveFallbackOnce(table: 'bank_accounts' | 'credit_cards', error: any): void {
  if (archiveFallbackWarnings.has(table)) return;
  archiveFallbackWarnings.add(table);
  console.warn('[Accounts] Archive fields unavailable; loading without archive filter', {
    table,
    code: error?.code || 'unknown',
  });
}

function isMissingMonthlyEmiColumnError(error: any): boolean {
  const message = String(error?.message || '').toLowerCase();
  return error?.code === '42703'
    || (
      (error?.code === 'PGRST204' || error?.code === 'PGRST205')
      && message.includes('monthly_emi_amount')
    );
}

function warnMonthlyEmiFallbackOnce(error: any): void {
  if (monthlyEmiFallbackWarnings.has('bank_accounts')) return;
  monthlyEmiFallbackWarnings.add('bank_accounts');
  console.warn('[Accounts] Monthly EMI field unavailable; saving account without EMI amount', {
    table: 'bank_accounts',
    code: error?.code || 'unknown',
  });
}

function normalizeMonthlyEmiAmount(value?: number | null): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function omitMonthlyEmiAmount<T extends { monthly_emi_amount?: number | null }>(
  payload: T
): Omit<T, 'monthly_emi_amount'> {
  const fallbackPayload = { ...payload };
  delete fallbackPayload.monthly_emi_amount;
  return fallbackPayload;
}

// ═══════════════════════════════════════════════════════════════════════════════
// BANK ACCOUNTS
// ═══════════════════════════════════════════════════════════════════════════════

export async function getBankAccounts(options: ArchiveListOptions = {}): Promise<BankAccount[]> {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('No user found');

    let query = supabase
      .from('bank_accounts')
      .select('*')
      .eq('user_id', user.id);

    if (options.archivedOnly) {
      query = query.eq('is_archived', true);
    } else if (!options.includeArchived) {
      query = query.eq('is_archived', false);
    }

    const { data, error } = await query.order('created_at', { ascending: true });

    if (error && isMissingArchiveColumnError(error)) {
      if (options.archivedOnly) return [];
      warnArchiveFallbackOnce('bank_accounts', error);
      const { data: fallbackData, error: fallbackError } = await supabase
        .from('bank_accounts')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: true });
      if (fallbackError) throw fallbackError;
      return fallbackData || [];
    }

    if (error) throw error;
    return data || [];
  } catch (error) {
    console.error('Error fetching bank accounts:', error);
    throw error;
  }
}

export async function addBankAccount(bank: Omit<BankAccount, 'id' | 'user_id' | 'created_at' | 'balance'>): Promise<void> {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('No user found');

    const accountType = bank.account_type || 'savings';
    const payload = {
      user_id: user.id,
      bank_name: bank.bank_name,
      account_last4: bank.account_last4,
      account_type: accountType,
      starting_balance: bank.starting_balance,
      balance: bank.starting_balance, // Initialize balance with starting_balance
      credit_limit: bank.credit_limit || 0,
      loan_total: bank.loan_total || 0,
      monthly_emi_amount: accountType === 'loan'
        ? normalizeMonthlyEmiAmount(bank.monthly_emi_amount)
        : null,
      upi_ids: bank.upi_ids,
    };

    const { error } = await supabase
      .from('bank_accounts')
      .insert(payload);

    if (error && isMissingMonthlyEmiColumnError(error)) {
      warnMonthlyEmiFallbackOnce(error);
      const { error: fallbackError } = await supabase
        .from('bank_accounts')
        .insert(omitMonthlyEmiAmount(payload));
      if (fallbackError) throw fallbackError;
      return;
    }

    if (error) throw error;
  } catch (error) {
    console.error('Error adding bank account:', error);
    throw error;
  }
}

export async function updateBankAccount(
  id: string,
  bank: Partial<Omit<BankAccount, 'id' | 'user_id' | 'created_at'>>
): Promise<void> {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('No user found');

    const payload = { ...bank };
    const hasMonthlyEmiAmount = Object.prototype.hasOwnProperty.call(bank, 'monthly_emi_amount');

    if (bank.account_type === 'loan' && hasMonthlyEmiAmount) {
      payload.monthly_emi_amount = normalizeMonthlyEmiAmount(bank.monthly_emi_amount);
    } else if (bank.account_type && bank.account_type !== 'loan') {
      payload.monthly_emi_amount = null;
    } else if (hasMonthlyEmiAmount) {
      payload.monthly_emi_amount = normalizeMonthlyEmiAmount(bank.monthly_emi_amount);
    }
    const payloadHasMonthlyEmiAmount = Object.prototype.hasOwnProperty.call(payload, 'monthly_emi_amount');

    const { error } = await supabase
      .from('bank_accounts')
      .update(payload)
      .eq('id', id)
      .eq('user_id', user.id);

    if (error && isMissingMonthlyEmiColumnError(error) && payloadHasMonthlyEmiAmount) {
      warnMonthlyEmiFallbackOnce(error);
      const { error: fallbackError } = await supabase
        .from('bank_accounts')
        .update(omitMonthlyEmiAmount(payload))
        .eq('id', id)
        .eq('user_id', user.id);
      if (fallbackError) throw fallbackError;
      return;
    }

    if (error) throw error;
  } catch (error) {
    console.error('Error updating bank account:', error);
    throw error;
  }
}

export async function deleteBankAccount(id: string): Promise<void> {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('No user found');

    // Use atomic database function to ensure both account and transactions
    // are deleted together (all or nothing) to prevent partial state
    const { error } = await supabase.rpc('delete_bank_account_cascade', {
      p_account_id: id,
      p_user_id: user.id,
    });

    if (error) throw error;
  } catch (error) {
    console.error('Error deleting bank account:', error);
    throw error;
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// CREDIT CARDS
// ═══════════════════════════════════════════════════════════════════════════════

export interface CreditCard {
  id: string;
  user_id: string;
  bank_name: string;
  card_name?: string;
  last_4_digits: string;
  credit_limit: number;
  current_outstanding: number;
  due_date: number;
  billing_cycle_date: number;
  is_archived?: boolean;
  archived_at?: string | null;
  created_at: string;
  updated_at: string;
}

export interface CCTransaction {
  id: string;
  user_id: string;
  card_id: string;
  amount: number;
  description?: string;
  category?: string;
  transaction_date: string;
  type: 'spend' | 'payment' | 'cashback' | 'reversal';
  created_at: string;
}

export interface AddCardData {
  bank_name: string;
  card_name?: string;
  last_4_digits: string;
  credit_limit: number;
  current_outstanding?: number;
  due_date: number;
  billing_cycle_date: number;
}

export interface AddCCTransactionData {
  card_id: string;
  amount: number;
  description?: string;
  category?: string;
  type: 'spend' | 'payment' | 'cashback' | 'reversal';
  transaction_date?: Date;
}

// Get all credit cards for user
export async function getCreditCards(options: ArchiveListOptions = {}): Promise<CreditCard[]> {
  const { data: userData } = await supabase.auth.getUser();
  if (!userData?.user) throw new Error('Not authenticated');

  let query = supabase
    .from('credit_cards')
    .select('*')
    .eq('user_id', userData.user.id);

  if (options.archivedOnly) {
    query = query.eq('is_archived', true);
  } else if (!options.includeArchived) {
    query = query.eq('is_archived', false);
  }

  const { data, error } = await query.order('created_at', { ascending: false });

  if (error && isMissingArchiveColumnError(error)) {
    if (options.archivedOnly) return [];
    warnArchiveFallbackOnce('credit_cards', error);
    const { data: fallbackData, error: fallbackError } = await supabase
      .from('credit_cards')
      .select('*')
      .eq('user_id', userData.user.id)
      .order('created_at', { ascending: false });
    if (fallbackError) throw fallbackError;
    return fallbackData || [];
  }

  if (error) throw error;
  return data || [];
}

// Get single credit card
export async function getCreditCard(cardId: string): Promise<CreditCard | null> {
  const { data: userData } = await supabase.auth.getUser();
  if (!userData?.user) throw new Error('Not authenticated');

  const { data, error } = await supabase
    .from('credit_cards')
    .select('*')
    .eq('id', cardId)
    .eq('user_id', userData.user.id)
    .single();

  if (error) throw error;
  return data;
}

// Add new credit card
export async function addCreditCard(cardData: AddCardData): Promise<CreditCard> {
  const { data: userData } = await supabase.auth.getUser();
  if (!userData?.user) throw new Error('Not authenticated');

  const { data, error } = await supabase
    .from('credit_cards')
    .insert({
      user_id: userData.user.id,
      ...cardData,
      current_outstanding: cardData.current_outstanding || 0,
    })
    .select()
    .single();

  if (error) throw error;
  return data;
}

// Update credit card
export async function updateCreditCard(
  cardId: string,
  updates: Partial<AddCardData>
): Promise<CreditCard> {
  const { data: userData } = await supabase.auth.getUser();
  if (!userData?.user) throw new Error('Not authenticated');

  const { data, error } = await supabase
    .from('credit_cards')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('id', cardId)
    .eq('user_id', userData.user.id)
    .select()
    .single();

  if (error) throw error;
  return data;
}

// Delete credit card
export async function deleteCreditCard(cardId: string): Promise<void> {
  const { data: userData } = await supabase.auth.getUser();
  if (!userData?.user) throw new Error('Not authenticated');

  const { error } = await supabase
    .from('credit_cards')
    .delete()
    .eq('id', cardId)
    .eq('user_id', userData.user.id);

  if (error) throw error;
}

// Get transactions for a card
export async function getCardTransactions(cardId: string): Promise<CCTransaction[]> {
  const { data: userData } = await supabase.auth.getUser();
  if (!userData?.user) throw new Error('Not authenticated');

  const { data, error } = await supabase
    .from('cc_transactions')
    .select('*')
    .eq('card_id', cardId)
    .eq('user_id', userData.user.id)
    .order('transaction_date', { ascending: false });

  if (error) throw error;
  return data || [];
}

// Add credit card transaction
export async function addCCTransaction(
  transactionData: AddCCTransactionData
): Promise<CCTransaction> {
  const { data: userData } = await supabase.auth.getUser();
  if (!userData?.user) throw new Error('Not authenticated');

  const { data, error } = await supabase
    .from('cc_transactions')
    .insert({
      user_id: userData.user.id,
      ...transactionData,
      transaction_date: transactionData.transaction_date?.toISOString() || new Date().toISOString(),
    })
    .select()
    .single();

  if (error) throw error;
  return data;
}

// Get total outstanding across all cards
export async function getTotalCCOutstanding(): Promise<number> {
  const cards = await getCreditCards();
  return cards.reduce((sum, card) => sum + card.current_outstanding, 0);
}

// Calculate days until due date
export function getCCDaysUntilDue(dueDate: number): number {
  const today = new Date();
  const currentDay = today.getDate();
  const currentMonth = today.getMonth();
  const currentYear = today.getFullYear();

  let dueMonth = currentMonth;
  let dueYear = currentYear;

  // If due date has passed this month, calculate for next month
  if (currentDay > dueDate) {
    dueMonth++;
    if (dueMonth > 11) {
      dueMonth = 0;
      dueYear++;
    }
  }

  const dueDateObj = new Date(dueYear, dueMonth, dueDate);
  const diffTime = dueDateObj.getTime() - today.getTime();
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

  return diffDays;
}

// Calculate available credit
export function getAvailableCredit(card: CreditCard): number {
  return Math.max(card.credit_limit - card.current_outstanding, 0);
}

// Calculate credit utilization percentage
export function getCreditUtilization(card: CreditCard): number {
  if (card.credit_limit === 0) return 0;
  return (card.current_outstanding / card.credit_limit) * 100;
}

// Find card by last 4 digits
export async function findCardByLast4Digits(last4: string): Promise<CreditCard | null> {
  const { data: userData } = await supabase.auth.getUser();
  if (!userData?.user) return null;

  const { data, error } = await supabase
    .from('credit_cards')
    .select('*')
    .eq('user_id', userData.user.id)
    .eq('last_4_digits', last4)
    .single();

  if (error) return null;
  return data;
}

// Get monthly spend for a card
export async function getMonthlySpend(
  cardId: string,
  month: number,
  year: number
): Promise<number> {
  const startDate = new Date(year, month, 1);
  const endDate = new Date(year, month + 1, 0, 23, 59, 59);

  const { data, error } = await supabase
    .from('cc_transactions')
    .select('amount')
    .eq('card_id', cardId)
    .eq('type', 'spend')
    .gte('transaction_date', startDate.toISOString())
    .lte('transaction_date', endDate.toISOString());

  if (error) return 0;
  return data.reduce((sum, txn) => sum + txn.amount, 0);
}

// ═══════════════════════════════════════════════════════════════════════════════
// LOANS
// ═══════════════════════════════════════════════════════════════════════════════

export type LoanType = 'Home' | 'Car' | 'Personal' | 'Education' | 'Other';

export interface Loan {
  id: string;
  user_id: string;
  loan_name: string;
  lender_name: string;
  principal_amount: number;
  current_outstanding: number;
  emi_amount: number;
  emi_due_date: number;
  interest_rate?: number;
  tenure_months: number;
  start_date: string;
  loan_type: LoanType;
  created_at: string;
  updated_at: string;
}

export interface EMIPayment {
  id: string;
  loan_id: string;
  user_id: string;
  amount_paid: number;
  payment_date: string;
  principal_component?: number;
  interest_component?: number;
  reference_number?: string;
  created_at: string;
}

export interface AddLoanData {
  loan_name: string;
  lender_name: string;
  principal_amount: number;
  current_outstanding?: number;
  emi_amount: number;
  emi_due_date: number;
  interest_rate?: number;
  tenure_months: number;
  start_date: Date;
  loan_type: LoanType;
}

export interface AddEMIPaymentData {
  loan_id: string;
  amount_paid: number;
  payment_date?: Date;
  principal_component?: number;
  interest_component?: number;
  reference_number?: string;
}

// Get all loans for user
export async function getLoans(): Promise<Loan[]> {
  const { data: userData } = await supabase.auth.getUser();
  if (!userData?.user) throw new Error('Not authenticated');

  const { data, error } = await supabase
    .from('loans')
    .select('*')
    .eq('user_id', userData.user.id)
    .order('created_at', { ascending: false });

  if (error) throw error;
  return data || [];
}

// Get single loan
export async function getLoan(loanId: string): Promise<Loan | null> {
  const { data: userData } = await supabase.auth.getUser();
  if (!userData?.user) throw new Error('Not authenticated');

  const { data, error } = await supabase
    .from('loans')
    .select('*')
    .eq('id', loanId)
    .eq('user_id', userData.user.id)
    .single();

  if (error) throw error;
  return data;
}

// Add new loan
export async function addLoan(loanData: AddLoanData): Promise<Loan> {
  const { data: userData } = await supabase.auth.getUser();
  if (!userData?.user) throw new Error('Not authenticated');

  const { data, error } = await supabase
    .from('loans')
    .insert({
      user_id: userData.user.id,
      ...loanData,
      current_outstanding: loanData.current_outstanding || loanData.principal_amount,
      start_date: loanData.start_date.toISOString().split('T')[0],
    })
    .select()
    .single();

  if (error) throw error;
  return data;
}

// Update loan
export async function updateLoan(
  loanId: string,
  updates: Partial<AddLoanData>
): Promise<Loan> {
  const { data: userData } = await supabase.auth.getUser();
  if (!userData?.user) throw new Error('Not authenticated');

  const updateData: any = { ...updates, updated_at: new Date().toISOString() };
  
  if (updates.start_date) {
    updateData.start_date = updates.start_date.toISOString().split('T')[0];
  }

  const { data, error } = await supabase
    .from('loans')
    .update(updateData)
    .eq('id', loanId)
    .eq('user_id', userData.user.id)
    .select()
    .single();

  if (error) throw error;
  return data;
}

// Delete loan
export async function deleteLoan(loanId: string): Promise<void> {
  const { data: userData } = await supabase.auth.getUser();
  if (!userData?.user) throw new Error('Not authenticated');

  const { error } = await supabase
    .from('loans')
    .delete()
    .eq('id', loanId)
    .eq('user_id', userData.user.id);

  if (error) throw error;
}

// Get EMI payments for a loan
export async function getEMIPayments(loanId: string): Promise<EMIPayment[]> {
  const { data: userData } = await supabase.auth.getUser();
  if (!userData?.user) throw new Error('Not authenticated');

  const { data, error } = await supabase
    .from('emi_payments')
    .select('*')
    .eq('loan_id', loanId)
    .eq('user_id', userData.user.id)
    .order('payment_date', { ascending: false });

  if (error) throw error;
  return data || [];
}

// Add EMI payment
export async function addEMIPayment(
  paymentData: AddEMIPaymentData
): Promise<EMIPayment> {
  const { data: userData } = await supabase.auth.getUser();
  if (!userData?.user) throw new Error('Not authenticated');

  // Get loan details to calculate components if not provided
  let principal_component = paymentData.principal_component;
  let interest_component = paymentData.interest_component;

  if (principal_component == null || interest_component == null) {
    const loan = await getLoan(paymentData.loan_id);
    if (loan && loan.interest_rate) {
      const components = calculateEMIComponents(
        loan.current_outstanding,
        loan.interest_rate,
        paymentData.amount_paid
      );
      principal_component = components.principal;
      interest_component = components.interest;
    }
  }

  const { data, error } = await supabase
    .from('emi_payments')
    .insert({
      user_id: userData.user.id,
      loan_id: paymentData.loan_id,
      amount_paid: paymentData.amount_paid,
      payment_date: paymentData.payment_date?.toISOString().split('T')[0] || new Date().toISOString().split('T')[0],
      principal_component,
      interest_component,
      reference_number: paymentData.reference_number?.trim() || undefined,
    })
    .select()
    .single();

  if (error) throw error;
  return data;
}

// Calculate EMI components (principal vs interest)
export function calculateEMIComponents(
  outstanding: number,
  interestRate: number,
  emiAmount: number
): { principal: number; interest: number } {
  const monthlyRate = interestRate / 12 / 100;
  const interest = outstanding * monthlyRate;
  let principal = emiAmount - interest;

  // Ensure principal doesn't exceed outstanding
  if (principal > outstanding) {
    principal = outstanding;
  }

  return {
    principal: Math.max(principal, 0),
    interest: Math.max(interest, 0),
  };
}

// Get total outstanding across all loans
export async function getTotalLoanOutstanding(): Promise<number> {
  const loans = await getLoans();
  return loans.reduce((sum, loan) => sum + loan.current_outstanding, 0);
}

// Get total EMI due this month
// Returns ALL active loans' EMI amounts for this month.
// Paid/unpaid filtering should be handled separately in the UI if needed.
export async function getTotalEMIDueThisMonth(): Promise<number> {
  const loans = await getLoans();
  // Count ALL loans' EMIs — a 10th-due EMI on the 25th is still this month's EMI
  return loans.reduce((sum, loan) => sum + loan.emi_amount, 0);
}

// Calculate days until next EMI
export function getLoanDaysUntilEMI(emiDueDate: number): number {
  const today = new Date();
  const currentDay = today.getDate();
  const currentMonth = today.getMonth();
  const currentYear = today.getFullYear();

  let dueMonth = currentMonth;
  let dueYear = currentYear;

  // If due date has passed this month, calculate for next month
  if (currentDay > emiDueDate) {
    dueMonth++;
    if (dueMonth > 11) {
      dueMonth = 0;
      dueYear++;
    }
  }

  const dueDateObj = new Date(dueYear, dueMonth, emiDueDate);
  const diffTime = dueDateObj.getTime() - today.getTime();
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

  return diffDays;
}

// Calculate loan progress percentage
export function getLoanProgress(loan: Loan): number {
  const paidAmount = loan.principal_amount - loan.current_outstanding;
  return (paidAmount / loan.principal_amount) * 100;
}

// Calculate months elapsed
export function getMonthsElapsed(startDate: string): number {
  const start = new Date(startDate);
  const today = new Date();
  
  const months = (today.getFullYear() - start.getFullYear()) * 12 +
                 (today.getMonth() - start.getMonth());
  
  return Math.max(months, 0);
}

// Calculate remaining months
export function getRemainingMonths(loan: Loan): number {
  const elapsed = getMonthsElapsed(loan.start_date);
  return Math.max(loan.tenure_months - elapsed, 0);
}

// Find loan by lender name
export async function findLoanByLender(lenderName: string): Promise<Loan | null> {
  const { data: userData } = await supabase.auth.getUser();
  if (!userData?.user) return null;

  const { data, error } = await supabase
    .from('loans')
    .select('*')
    .eq('user_id', userData.user.id)
    .ilike('lender_name', `%${lenderName}%`)
    .single();

  if (error) return null;
  return data;
}
