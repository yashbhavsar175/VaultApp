// ═══════════════════════════════════════════════════════════════════════════════
// CORE UTILITIES MODULE
// Consolidated: supabase + aiParser + googleAuth + db
// ═══════════════════════════════════════════════════════════════════════════════

import 'react-native-url-polyfill/auto';
import { createClient } from '@supabase/supabase-js';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { GoogleSignin } from '@react-native-google-signin/google-signin';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from '../config';
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
  const amount = amountMatch ? parseFloat(amountMatch[1]) : 0;
  
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
    webClientId: '1067695067282-vuh6jki8rl2ao8k4vnjo3t2v2hlm003p.apps.googleusercontent.com',
    offlineAccess: false,
  });
};

export const signInWithGoogle = async () => {
  try {
    await GoogleSignin.hasPlayServices();
    await new Promise(resolve => setTimeout(() => resolve(undefined), 300));
    
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

    if (data.session) {
      await AsyncStorage.setItem('supabase.auth.token', JSON.stringify({
        access_token: data.session.access_token,
        refresh_token: data.session.refresh_token,
      }));
    }

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

export async function bulkDeleteTransactions(ids: string[]): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('User not authenticated');

  if (ids.length === 0) return;

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

  const categories = data?.map(item => item.category).filter(Boolean) || [];
  return Array.from(new Set(categories));
}
