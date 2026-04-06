import { supabase } from './supabase';
import { PeopleLedger, PeopleLedgerPayment } from '../types';

export interface AddLedgerEntryData {
  person_name: string;
  type: 'lent' | 'borrowed';
  total_amount: number;
  repayment_type: 'one_time' | 'installment';
  due_date?: string;
  installment_amount?: number;
  installment_days?: string[];
  start_date?: string;
  notes?: string;
}

/**
 * Fetch all active (not settled) ledger entries for the current user
 */
export async function getPeopleLedger(includeSettled = false): Promise<PeopleLedger[]> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');

  let query = supabase
    .from('people_ledger')
    .select('*')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false });

  if (!includeSettled) {
    query = query.eq('is_settled', false);
  }

  const { data, error } = await query;

  if (error) throw error;
  return data || [];
}

/**
 * Get ledger entries by type
 */
export async function getLedgerByType(type: 'lent' | 'borrowed', includeSettled = false): Promise<PeopleLedger[]> {
  const entries = await getPeopleLedger(includeSettled);
  return entries.filter(entry => entry.type === type);
}

/**
 * Add a new ledger entry
 */
export async function addLedgerEntry(data: AddLedgerEntryData): Promise<PeopleLedger> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');

  const { data: ledger, error } = await supabase
    .from('people_ledger')
    .insert({
      user_id: user.id,
      ...data,
    })
    .select()
    .single();

  if (error) throw error;
  return ledger;
}

/**
 * Add a payment to a ledger entry
 */
export async function addPayment(
  ledgerId: string,
  amount: number,
  notes?: string,
  paidDate?: string
): Promise<PeopleLedgerPayment> {
  const { data: payment, error } = await supabase
    .from('people_ledger_payments')
    .insert({
      ledger_id: ledgerId,
      amount,
      notes,
      paid_date: paidDate || new Date().toISOString().split('T')[0],
    })
    .select()
    .single();

  if (error) throw error;
  return payment;
}

/**
 * Get all payments for a ledger entry
 */
export async function getPayments(ledgerId: string): Promise<PeopleLedgerPayment[]> {
  const { data, error } = await supabase
    .from('people_ledger_payments')
    .select('*')
    .eq('ledger_id', ledgerId)
    .order('paid_date', { ascending: false });

  if (error) throw error;
  return data || [];
}

/**
 * Mark a ledger entry as settled
 */
export async function markAsSettled(ledgerId: string): Promise<void> {
  const { error } = await supabase
    .from('people_ledger')
    .update({ is_settled: true })
    .eq('id', ledgerId);

  if (error) throw error;
}

/**
 * Delete a ledger entry
 */
export async function deleteLedgerEntry(ledgerId: string): Promise<void> {
  const { error } = await supabase
    .from('people_ledger')
    .delete()
    .eq('id', ledgerId);

  if (error) throw error;
}

/**
 * Calculate expected payment by today for installment type
 * Excludes Sundays or custom excluded days
 */
export function calculateExpectedByToday(entry: PeopleLedger): number {
  if (entry.repayment_type !== 'installment' || !entry.start_date || !entry.installment_amount) {
    return 0;
  }

  const startDate = new Date(entry.start_date);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  startDate.setHours(0, 0, 0, 0);

  if (today < startDate) {
    return 0;
  }

  const installmentDays = entry.installment_days || ['mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
  const dayMap: { [key: string]: number } = {
    sun: 0,
    mon: 1,
    tue: 2,
    wed: 3,
    thu: 4,
    fri: 5,
    sat: 6,
  };

  const includedDayNumbers = installmentDays.map(day => dayMap[day.toLowerCase()]);

  let count = 0;
  const currentDate = new Date(startDate);

  while (currentDate <= today) {
    const dayOfWeek = currentDate.getDay();
    if (includedDayNumbers.includes(dayOfWeek)) {
      count++;
    }
    currentDate.setDate(currentDate.getDate() + 1);
  }

  return count * entry.installment_amount;
}

/**
 * Get summary statistics
 */
export async function getLedgerSummary() {
  const entries = await getPeopleLedger(false);

  const lentEntries = entries.filter(e => e.type === 'lent');
  const borrowedEntries = entries.filter(e => e.type === 'borrowed');

  return {
    totalLent: lentEntries.reduce((sum, e) => sum + Number(e.remaining_amount), 0),
    totalBorrowed: borrowedEntries.reduce((sum, e) => sum + Number(e.remaining_amount), 0),
    lentCount: lentEntries.length,
    borrowedCount: borrowedEntries.length,
  };
}

/**
 * Check if entry is overdue
 */
export function isOverdue(entry: PeopleLedger): boolean {
  if (entry.is_settled || !entry.due_date) return false;

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const dueDate = new Date(entry.due_date);
  dueDate.setHours(0, 0, 0, 0);

  return today > dueDate && entry.remaining_amount > 0;
}

/**
 * Check if entry is due today
 */
export function isDueToday(entry: PeopleLedger): boolean {
  if (entry.is_settled || !entry.due_date) return false;

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const dueDate = new Date(entry.due_date);
  dueDate.setHours(0, 0, 0, 0);

  return today.getTime() === dueDate.getTime() && entry.remaining_amount > 0;
}

/**
 * Get days until due (negative if overdue)
 */
export function getDaysUntilDue(entry: PeopleLedger): number | null {
  if (!entry.due_date) return null;

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const dueDate = new Date(entry.due_date);
  dueDate.setHours(0, 0, 0, 0);

  const diffTime = dueDate.getTime() - today.getTime();
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

  return diffDays;
}
