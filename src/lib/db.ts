import { supabase } from './supabase';
import { Transaction } from '../types';

export async function addTransaction(
  tx: Omit<Transaction, 'id' | 'user_id' | 'created_at'>
): Promise<Transaction> {
  const { data: { user } } = await supabase.auth.getUser();
  
  if (!user) {
    throw new Error('User not authenticated');
  }

  const { data, error } = await supabase
    .from('transactions')
    .insert({
      user_id: user.id,
      amount: tx.amount,
      type: tx.type,
      note: tx.note,
      category: tx.category,
    })
    .select()
    .single();

  if (error) {
    throw new Error(error.message);
  }

  return data;
}

export async function getTransactions(): Promise<Transaction[]> {
  const { data: { user } } = await supabase.auth.getUser();
  
  if (!user) {
    throw new Error('User not authenticated');
  }

  const { data, error } = await supabase
    .from('transactions')
    .select('*')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false });

  if (error) {
    throw new Error(error.message);
  }

  return data || [];
}

export async function deleteTransaction(id: string): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('User not authenticated');

  const { error } = await supabase
    .from('transactions')
    .delete()
    .eq('id', id)
    .eq('user_id', user.id);

  if (error) {
    throw new Error(error.message);
  }
}

// Bulk delete: single API call using .in() — deletes 100s of entries instantly
export async function bulkDeleteTransactions(ids: string[]): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('User not authenticated');

  if (ids.length === 0) return;

  // Supabase handles .in() efficiently — batch delete in chunks of 100
  // to avoid URL length limits
  const CHUNK_SIZE = 100;
  for (let i = 0; i < ids.length; i += CHUNK_SIZE) {
    const chunk = ids.slice(i, i + CHUNK_SIZE);
    const { error } = await supabase
      .from('transactions')
      .delete()
      .in('id', chunk)
      .eq('user_id', user.id);

    if (error) {
      throw new Error(error.message);
    }
  }
}

export async function updateTransaction(
  id: string,
  updates: Partial<Omit<Transaction, 'id' | 'user_id' | 'created_at'>>
): Promise<Transaction> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('User not authenticated');

  const { data, error } = await supabase
    .from('transactions')
    .update(updates)
    .eq('id', id)
    .eq('user_id', user.id)
    .select()
    .single();

  if (error) {
    throw new Error(error.message);
  }

  return data;
}

export async function getUniqueCategories(userId: string): Promise<string[]> {
  const { data, error } = await supabase
    .from('transactions')
    .select('category')
    .eq('user_id', userId)
    .not('category', 'is', null)
    .order('category');

  if (error) {
    throw new Error(error.message);
  }

  // Extract unique categories
  const categories = data?.map(item => item.category).filter(Boolean) || [];
  return Array.from(new Set(categories));
}
