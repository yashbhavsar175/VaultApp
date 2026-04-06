import { supabase } from './supabase';

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
export async function getCreditCards(): Promise<CreditCard[]> {
  const { data: userData } = await supabase.auth.getUser();
  if (!userData?.user) throw new Error('Not authenticated');

  const { data, error } = await supabase
    .from('credit_cards')
    .select('*')
    .eq('user_id', userData.user.id)
    .order('created_at', { ascending: false });

  if (error) throw error;
  return data || [];
}

// Get single credit card
export async function getCreditCard(cardId: string): Promise<CreditCard | null> {
  const { data, error } = await supabase
    .from('credit_cards')
    .select('*')
    .eq('id', cardId)
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
  const { data, error } = await supabase
    .from('credit_cards')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('id', cardId)
    .select()
    .single();

  if (error) throw error;
  return data;
}

// Delete credit card
export async function deleteCreditCard(cardId: string): Promise<void> {
  const { error } = await supabase
    .from('credit_cards')
    .delete()
    .eq('id', cardId);

  if (error) throw error;
}

// Get transactions for a card
export async function getCardTransactions(cardId: string): Promise<CCTransaction[]> {
  const { data, error } = await supabase
    .from('cc_transactions')
    .select('*')
    .eq('card_id', cardId)
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
export async function getTotalOutstanding(): Promise<number> {
  const cards = await getCreditCards();
  return cards.reduce((sum, card) => sum + card.current_outstanding, 0);
}

// Calculate days until due date
export function getDaysUntilDue(dueDate: number): number {
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
