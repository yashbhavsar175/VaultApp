import { supabase } from './supabase';

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
  const { data, error } = await supabase
    .from('loans')
    .select('*')
    .eq('id', loanId)
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
  const updateData: any = { ...updates, updated_at: new Date().toISOString() };
  
  if (updates.start_date) {
    updateData.start_date = updates.start_date.toISOString().split('T')[0];
  }

  const { data, error } = await supabase
    .from('loans')
    .update(updateData)
    .eq('id', loanId)
    .select()
    .single();

  if (error) throw error;
  return data;
}

// Delete loan
export async function deleteLoan(loanId: string): Promise<void> {
  const { error } = await supabase
    .from('loans')
    .delete()
    .eq('id', loanId);

  if (error) throw error;
}

// Get EMI payments for a loan
export async function getEMIPayments(loanId: string): Promise<EMIPayment[]> {
  const { data, error } = await supabase
    .from('emi_payments')
    .select('*')
    .eq('loan_id', loanId)
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

  if (!principal_component || !interest_component) {
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
export async function getTotalOutstanding(): Promise<number> {
  const loans = await getLoans();
  return loans.reduce((sum, loan) => sum + loan.current_outstanding, 0);
}

// Get total EMI due this month
export async function getTotalEMIDueThisMonth(): Promise<number> {
  const loans = await getLoans();
  const today = new Date();
  const currentDay = today.getDate();

  // Sum EMIs for loans with due date >= today
  return loans
    .filter(loan => loan.emi_due_date >= currentDay)
    .reduce((sum, loan) => sum + loan.emi_amount, 0);
}

// Calculate days until next EMI
export function getDaysUntilEMI(emiDueDate: number): number {
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
