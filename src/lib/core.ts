// ═══════════════════════════════════════════════════════════════════════════════
// CORE UTILITIES MODULE
// Consolidated: supabase + aiParser + googleAuth + db
// ═══════════════════════════════════════════════════════════════════════════════

import 'react-native-url-polyfill/auto';
import { createClient } from '@supabase/supabase-js';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { GoogleSignin } from '@react-native-google-signin/google-signin';
import { SUPABASE_URL, SUPABASE_ANON_KEY, GOOGLE_WEB_CLIENT_ID } from '../config';
import { Transaction, TransactionType } from '../types';

// ═══════════════════════════════════════════════════════════════════════════════
// SUPABASE CLIENT
// ═══════════════════════════════════════════════════════════════════════════════

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});

// ═══════════════════════════════════════════════════════════════════════════════
// AI PARSER
// ═══════════════════════════════════════════════════════════════════════════════

interface ParsedTransaction {
  amount: number;
  note: string;
  type: TransactionType;
  category: string;
}

export async function parseTransactionWithAI(text: string): Promise<ParsedTransaction> {
  return parseTransaction(text);
}

export const parseTransaction = (text: string): ParsedTransaction => {
  const lowerText = text.toLowerCase();
  
  // Extract amount
  const amountMatch = text.match(/₹?\s*(\d+(?:\.\d+)?)/);
  
  // Validate amount
  if (!amountMatch || parseFloat(amountMatch[1]) <= 0) {
    throw new Error('Valid amount not found. Please include an amount, e.g. "500 lunch"');
  }
  
  const amount = parseFloat(amountMatch[1]);
  
  // Detect type
  let type: TransactionType = 'expense';
  if (/salary|received|credited|income|got|earned|refund|give me|gave|given/.test(lowerText)) {
    type = 'income';
  } else if (/sip|mutual fund|stocks|zerodha|invest|shares|fd|nps/.test(lowerText)) {
    type = 'investment';
  } else if (/emi|loan|equated|hdfc loan|iciciloan/.test(lowerText)) {
    type = 'emi';
  } else if (/lent|diya|udhar diya|gave to|lend/.test(lowerText)) {
    type = 'lent';
  } else if (/borrowed|liya|udhar liya|took from|borrow/.test(lowerText)) {
    type = 'borrowed';
  }
  
  // Extract note — remove amount, keep rest
  const note = text.replace(/₹?\s*\d+(?:\.\d+)?/, '').trim() || text.slice(0, 30);
  
  return { amount, type, note, category: type };
};

// ═══════════════════════════════════════════════════════════════════════════════
// GOOGLE AUTH
// ═══════════════════════════════════════════════════════════════════════════════

export const configureGoogleSignIn = () => {
  GoogleSignin.configure({
    webClientId: GOOGLE_WEB_CLIENT_ID,
    offlineAccess: false,
  });
};

export const signInWithGoogle = async () => {
  try {
    await GoogleSignin.hasPlayServices();
    
    // Note: If you encounter "Current activity is null" errors on some devices,
    // it may indicate the Google Sign-In UI is being triggered before the activity
    // is fully ready. Consider adding error handling or user feedback instead of delays.
    
    const userInfo = await GoogleSignin.signIn();
    
    if (!userInfo.data?.idToken) {
      throw new Error('No ID token received from Google Sign-In');
    }

    const { data, error } = await supabase.auth.signInWithIdToken({
      provider: 'google',
      token: userInfo.data.idToken,
    });

    if (error) {
      throw error;
    }

    if (data.user && userInfo.data.user) {
      const googleUser = userInfo.data.user;
      const fullName = googleUser.name || googleUser.givenName || '';
      
      if (fullName) {
        const { data: existingProfile } = await supabase
          .from('profiles')
          .select('id, full_name')
          .eq('id', data.user.id)
          .single();

        if (!existingProfile || !existingProfile.full_name) {
          await supabase
            .from('profiles')
            .upsert({
              id: data.user.id,
              full_name: fullName,
              updated_at: new Date().toISOString(),
            });
        }
      }
    }

    // Supabase automatically stores session in AsyncStorage (configured in auth.storage)
    // No need to manually store tokens - it handles refresh automatically

    return { data, error: null };
  } catch (error) {
    console.error('Google Sign-In error:', error);
    
    if (error instanceof Error) {
      if (error.message.includes('Current activity is null')) {
        return { 
          data: null, 
          error: new Error('Please wait a moment and try again. The app is still initializing.')
        };
      }
    }
    
    return { data: null, error };
  }
};

export const signOutFromGoogle = async () => {
  try {
    await GoogleSignin.signOut();
    await supabase.auth.signOut();
  } catch (error) {
    console.error('Sign out error:', error);
  }
};

// ═══════════════════════════════════════════════════════════════════════════════
// DATABASE OPERATIONS
// ═══════════════════════════════════════════════════════════════════════════════

export async function addTransaction(
  tx: Omit<Transaction, 'id' | 'user_id' | 'created_at'>
): Promise<Transaction> {
  const { data: { user } } = await supabase.auth.getUser();
  
  if (!user) {
    throw new Error('User not authenticated');
  }

  // Validate transaction data
  if (!tx.amount || tx.amount <= 0) {
    throw new Error('Valid amount required');
  }
  
  if (!tx.type) {
    throw new Error('Transaction type required');
  }
  
  if (!tx.note?.trim()) {
    throw new Error('Note required');
  }

  const { data, error } = await supabase
    .from('transactions')
    .insert({
      user_id: user.id,
      amount: tx.amount,
      type: tx.type,
      note: tx.note.trim(),
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

export async function bulkDeleteTransactions(ids: string[]): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('User not authenticated');

  if (ids.length === 0) return;

  const CHUNK_SIZE = 100;
  const errors: string[] = [];
  
  for (let i = 0; i < ids.length; i += CHUNK_SIZE) {
    const chunk = ids.slice(i, i + CHUNK_SIZE);
    const { error } = await supabase
      .from('transactions')
      .delete()
      .in('id', chunk)
      .eq('user_id', user.id);

    if (error) {
      errors.push(`Chunk ${i + 1}-${i + chunk.length}: ${error.message}`);
    }
  }
  
  if (errors.length > 0) {
    throw new Error(`Some transactions could not be deleted:\n${errors.join('\n')}`);
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

export async function getUniqueCategories(): Promise<string[]> {
  const { data: { user } } = await supabase.auth.getUser();
  
  if (!user) {
    throw new Error('User not authenticated');
  }

  const { data, error } = await supabase
    .from('transactions')
    .select('category')
    .eq('user_id', user.id)
    .not('category', 'is', null)
    .order('category');

  if (error) {
    throw new Error(error.message);
  }

  const categories = data?.map(item => item.category).filter(Boolean) || [];
  return Array.from(new Set(categories));
}

// ═══════════════════════════════════════════════════════════════════════════════
// OFFLINE SYNC ENGINE
// Triggered on network reconnection or AppState change from background
// ═══════════════════════════════════════════════════════════════════════════════

export async function syncOfflineTransactions(): Promise<void> {
  try {
    const raw = await AsyncStorage.getItem('offline_tx_queue');
    if (!raw) return; // Nothing to sync

    const queue: any[] = JSON.parse(raw);
    if (!queue || queue.length === 0) return;

    // Get authenticated user
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      console.warn('[OfflineSync] No authenticated user — skipping sync');
      return;
    }

    // Append user_id to every queued transaction
    const records = queue.map(({ queued_at, ...tx }) => ({
      ...tx,
      user_id: user.id,
    }));

    // Bulk insert into Supabase
    const { error } = await supabase
      .from('transactions')
      .insert(records);

    if (error) {
      console.error('[OfflineSync] Bulk insert failed:', error.message);
      return; // Keep queue intact — will retry next time
    }

    // Success: clear the queue
    await AsyncStorage.removeItem('offline_tx_queue');
    console.log(`[OfflineSync] Synced ${records.length} offline transaction(s) successfully`);
  } catch (e) {
    // Never crash the app — this runs silently in the background
    console.error('[OfflineSync] Unexpected error:', e);
  }
}
