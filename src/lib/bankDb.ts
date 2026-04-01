import { supabase } from './supabase';
import { BankAccount } from '../types';

export async function getBankAccounts(): Promise<BankAccount[]> {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('No user found');

    const { data, error } = await supabase
      .from('bank_accounts')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false });

    if (error) throw error;
    return data || [];
  } catch (error) {
    console.error('Error fetching bank accounts:', error);
    throw error;
  }
}

export async function addBankAccount(bank: Omit<BankAccount, 'id' | 'user_id' | 'created_at'>): Promise<void> {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('No user found');

    const { error } = await supabase
      .from('bank_accounts')
      .insert({
        user_id: user.id,
        bank_name: bank.bank_name,
        account_last4: bank.account_last4,
        account_type: bank.account_type || 'savings',
        starting_balance: bank.starting_balance,
        credit_limit: bank.credit_limit || 0,
        loan_total: bank.loan_total || 0,
        upi_ids: bank.upi_ids,
      });

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
    const { error } = await supabase
      .from('bank_accounts')
      .update(bank)
      .eq('id', id);

    if (error) throw error;
  } catch (error) {
    console.error('Error updating bank account:', error);
    throw error;
  }
}

export async function deleteBankAccount(id: string): Promise<void> {
  try {
    const { error } = await supabase
      .from('bank_accounts')
      .delete()
      .eq('id', id);

    if (error) throw error;
  } catch (error) {
    console.error('Error deleting bank account:', error);
    throw error;
  }
}
