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
import { showTransactionConfirmation } from './services/notifications';
import { emitFinanceDataChanged } from './services/dataEvents';

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

const TRANSACTIONS_CACHE_KEY = 'cache_transactions';
const OFFLINE_TX_QUEUE_KEY = 'offline_tx_queue';
const OFFLINE_DELETE_QUEUE_KEY = 'offline_delete_queue';

async function updateTransactionsCache(
  updater: (current: Transaction[]) => Transaction[]
): Promise<void> {
  try {
    const raw = await AsyncStorage.getItem(TRANSACTIONS_CACHE_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    const current = Array.isArray(parsed?.data)
      ? parsed.data
      : Array.isArray(parsed)
        ? parsed
        : [];
    const next = updater(current);
    await AsyncStorage.setItem(TRANSACTIONS_CACHE_KEY, JSON.stringify({
      data: next,
      timestamp: Date.now(),
    }));
  } catch {
    // Cache is a best-effort performance layer.
  }
}

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

  const optionalFields: (keyof Omit<Transaction, 'id' | 'user_id' | 'created_at' | 'amount' | 'type' | 'note' | 'category'>)[] = [
    'account_id',
    'account_last4',
    'sms_source',
    'sms_sender',
    'upi_id',
    'reference_number',
    'raw_sms',
    'balance',
    'from_account_id',
    'to_account_id',
    'is_transfer_pending',
  ];
  const metadata = optionalFields.reduce<Record<string, unknown>>((fields, key) => {
    const value = tx[key];
    if (value !== undefined && value !== null && value !== '') {
      fields[key] = value;
    }
    return fields;
  }, {});

  const { data, error } = await supabase
    .from('transactions')
    .insert({
      user_id: user.id,
      amount: tx.amount,
      type: tx.type,
      note: tx.note.trim(),
      category: tx.category,
      ...metadata,
    })
    .select()
    .single();

  if (error) {
    throw new Error(error.message);
  }

  await updateTransactionsCache(current => [
    data as Transaction,
    ...current.filter(item => item.id !== data.id),
  ]);
  emitFinanceDataChanged({
    areas: ['transactions'],
    source: 'transaction:add',
    transactionId: data.id,
  });

  return data;
}

export interface CreateTransferTransactionInput {
  amount: number;
  from_account_id: string;
  to_account_id: string;
  note: string;
  reference_number?: string | null;
}

export async function createTransferTransaction(
  input: CreateTransferTransactionInput
): Promise<Transaction> {
  if (!input.amount || input.amount <= 0) {
    throw new Error('Valid transfer amount required');
  }

  if (!input.from_account_id) {
    throw new Error('Transfer source account required');
  }

  if (!input.to_account_id) {
    throw new Error('Transfer destination account required');
  }

  if (input.from_account_id === input.to_account_id) {
    throw new Error('Transfer source and destination must be different accounts');
  }

  if (!input.note?.trim()) {
    throw new Error('Transfer note required');
  }

  const tx = await addTransaction({
    amount: input.amount,
    type: 'transfer',
    note: input.note,
    category: 'Transfer',
    account_id: input.from_account_id,
    from_account_id: input.from_account_id,
    to_account_id: input.to_account_id,
    reference_number: input.reference_number?.trim() || undefined,
    is_transfer_pending: false,
  });

  emitFinanceDataChanged({
    areas: ['accounts'],
    source: 'transaction:transferBalance',
    transactionId: tx.id,
  });

  return tx;
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

  await updateTransactionsCache(current => current.filter(tx => tx.id !== id));
  emitFinanceDataChanged({
    areas: ['transactions'],
    source: 'transaction:delete',
    transactionId: id,
  });
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

  const idSet = new Set(ids);
  await updateTransactionsCache(current => current.filter(tx => !idSet.has(tx.id)));
  emitFinanceDataChanged({
    areas: ['transactions'],
    source: 'transaction:bulkDelete',
  });
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

  await updateTransactionsCache(current =>
    current.length > 0
      ? current.map(tx => tx.id === id ? data as Transaction : tx)
      : [data as Transaction]
  );
  emitFinanceDataChanged({
    areas: ['transactions'],
    source: 'transaction:update',
    transactionId: id,
  });

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

type OfflineQueueEntry = Record<string, any>;

function isDuplicateTransactionError(error: any): boolean {
  const message = String(error?.message || '');
  return (
    error?.code === '23505' ||
    message.includes('duplicate key value') ||
    message.includes('unique_transaction_identifier')
  );
}

async function syncOfflineDeleteQueue(raw: string | null, userId: string): Promise<void> {
  if (!raw) return;

  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed) || parsed.length === 0) return;

  const remainingQueue: unknown[] = [];
  const syncedIds = new Set<string>();

  for (const item of parsed) {
    const transactionId = typeof item === 'string' ? item.trim() : '';

    if (!transactionId) {
      console.warn('[OfflineSync] Invalid queued delete item, keeping item queued');
      remainingQueue.push(item);
      continue;
    }

    const { error } = await supabase
      .from('transactions')
      .delete()
      .eq('id', transactionId)
      .eq('user_id', userId);

    if (error) {
      console.warn('[OfflineSync] Delete failed, keeping item queued:', error.message);
      remainingQueue.push(item);
      continue;
    }

    syncedIds.add(transactionId);
  }

  if (syncedIds.size > 0) {
    await updateTransactionsCache(current => current.filter(tx => !syncedIds.has(tx.id)));
    emitFinanceDataChanged({
      areas: ['transactions'],
      source: 'offline:deleteSync',
    });
  }

  if (remainingQueue.length > 0) {
    await AsyncStorage.setItem(OFFLINE_DELETE_QUEUE_KEY, JSON.stringify(remainingQueue));
  } else {
    await AsyncStorage.removeItem(OFFLINE_DELETE_QUEUE_KEY);
  }

  console.log(
    `[OfflineSync] Synced ${syncedIds.size} queued delete(s), kept ${remainingQueue.length} queued`
  );
}

export async function syncOfflineTransactions(): Promise<void> {
  try {
    const raw = await AsyncStorage.getItem(OFFLINE_TX_QUEUE_KEY);
    const deleteRaw = await AsyncStorage.getItem(OFFLINE_DELETE_QUEUE_KEY);
    if (!raw && !deleteRaw) return; // Nothing to sync

    const parsedQueue = raw ? JSON.parse(raw) : [];
    const queue: OfflineQueueEntry[] = Array.isArray(parsedQueue) ? parsedQueue : [];
    if (raw && !Array.isArray(parsedQueue)) {
      console.warn('[OfflineSync] Transaction queue is invalid, skipping transaction inserts');
    }

    // Get authenticated user
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      console.warn('[OfflineSync] No authenticated user — skipping sync');
      return;
    }

    if (queue.length > 0) {
      // Append user_id to every queued transaction and keep local metadata out of DB rows.
      const queueItems = queue.map(({ _localId, _queued_at, queued_at, id, created_at, ...tx }) => {
        const record: OfflineQueueEntry = {
          ...tx,
          user_id: user.id,
        };

        if (record.sms_source === 'manual') {
          delete record.sms_source;
        }

        return {
          record,
          queuedAt: _queued_at || queued_at || null,
          original: { _localId, _queued_at, queued_at, id, created_at, ...tx },
        };
      });

      const remainingQueue: OfflineQueueEntry[] = [];
      const syncedRecords: { tx: any; queuedAt: string | null }[] = [];
      let duplicateCount = 0;

      for (const item of queueItems) {
        const { data: insertedRecord, error } = await supabase
          .from('transactions')
          .insert(item.record)
          .select()
          .single();

        if (error) {
          if (isDuplicateTransactionError(error)) {
            duplicateCount++;
            continue; // Already synced earlier; remove it from the local queue.
          }

          console.error('[OfflineSync] Insert failed, keeping item queued:', error.message);
          remainingQueue.push(item.original);
          continue;
        }

        syncedRecords.push({ tx: insertedRecord || item.record, queuedAt: item.queuedAt });
      }

      // Success: Show notifications for transactions that might have missed them
      // We assume that if a transaction was queued, it should have gotten a notification
      // when it was originally processed. If it didn't, we should show one now.
      for (const { tx, queuedAt } of syncedRecords) {
        try {
          await showTransactionConfirmation(
            tx.id, // The actual DB ID from the insert
            tx.type as any, // Cast to match the expected type
            tx.note || 'Transaction',
            tx.amount,
            tx.account_last4,
            `Synced from offline queue (originally queued at: ${queuedAt || 'unknown'})`
          );
        } catch (notifyError) {
          console.error('[OfflineSync] Failed to show notification for synced transaction:', notifyError);
          // Don't fail the whole sync for notification issues
        }
      }

      if (syncedRecords.length > 0) {
        const syncedTransactions = syncedRecords.map(({ tx }) => tx as Transaction);
        const syncedIds = new Set(syncedTransactions.map(tx => tx.id));
        await updateTransactionsCache(current => [
          ...syncedTransactions,
          ...current.filter(tx => !syncedIds.has(tx.id)),
        ]);
        emitFinanceDataChanged({
          areas: ['transactions'],
          source: 'offline:transactionSync',
        });
      }

      if (remainingQueue.length > 0) {
        await AsyncStorage.setItem(OFFLINE_TX_QUEUE_KEY, JSON.stringify(remainingQueue));
      } else {
        await AsyncStorage.removeItem(OFFLINE_TX_QUEUE_KEY);
      }

      console.log(
        `[OfflineSync] Synced ${syncedRecords.length} transaction(s), skipped ${duplicateCount} duplicate(s), kept ${remainingQueue.length} queued`
      );
    }

    await syncOfflineDeleteQueue(deleteRaw, user.id);
  } catch (e) {
    // Never crash the app — this runs silently in the background
    console.error('[OfflineSync] Unexpected error:', e);
  }
}
