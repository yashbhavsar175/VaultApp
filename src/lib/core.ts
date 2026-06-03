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
import { sanitizeTransactionRawSmsForPrivacy } from './privacy/rawText';
import {
  OFFLINE_DELETE_QUEUE_BASE_KEY,
  OFFLINE_TX_QUEUE_BASE_KEY,
  REVIEW_QUEUE_BASE_KEY,
  getQueueOwnerId,
  loadUserScopedQueue,
  logUserQueueAction,
  quarantineLegacyQueue,
  saveUserScopedQueue,
  USER_QUEUE_ACTIONS,
} from './services/userScopedQueues';

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
  if (/lent|udhar diya|gave to|lend/.test(lowerText)) {
    type = 'lent';
  } else if (/borrowed|liya|udhar liya|took from|borrow/.test(lowerText)) {
    type = 'borrowed';
  } else if (/refund|refunded/.test(lowerText)) {
    type = 'refund';
  } else if (/family|friend|brother|sister|bhai|dost|mom|dad|papa|mummy|cash deposit|bank deposit|cash withdrawal|atm withdrawal|withdrawal|withdrawn|self transfer|own account|reimburse|loan repayment|debt repayment/.test(lowerText)) {
    type = 'transfer';
  } else if (/salary|received|credited|income|got|earned|give me|gave|given/.test(lowerText)) {
    type = 'income';
  } else if (/sip|mutual fund|stocks|zerodha|invest|shares|fd|nps/.test(lowerText)) {
    type = 'investment';
  } else if (/emi|loan|equated|hdfc loan|iciciloan/.test(lowerText)) {
    type = 'emi';
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
const DASHBOARD_SUMMARY_CACHE_PREFIX = 'cache_dashboard_summary';
const REVIEWED_INCOME_NOTE = 'Reviewed income';
const REVIEWED_INCOME_CATEGORY = 'Reviewed Income';
const REVIEWED_EXPENSE_REASON = 'review_queue_expense_confirmed';
const INCOME_REVIEW_REASON = 'income_review_confirmed';

async function invalidateDashboardSummaryCache(): Promise<void> {
  try {
    const keys = await AsyncStorage.getAllKeys();
    await Promise.all(
      keys
        .filter(key => key === DASHBOARD_SUMMARY_CACHE_PREFIX || key.startsWith(`${DASHBOARD_SUMMARY_CACHE_PREFIX}:`))
        .map(key => AsyncStorage.removeItem(key))
    );
  } catch {
    // Cache invalidation is best-effort; Supabase remains the source of truth.
  }
}

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
    await invalidateDashboardSummaryCache();
  } catch {
    // Cache is a best-effort performance layer.
  }
}

type DeletedReviewSource = Pick<Transaction,
  'id' |
  'type' |
  'amount' |
  'note' |
  'category' |
  'created_at' |
  'primary_evidence_id' |
  'account_match_reason'
>;

type IncomeReviewTombstoneTarget = {
  evidenceId: string | null;
  signalHash: string | null;
};

function isReviewedIncomeTransaction(tx: DeletedReviewSource): boolean {
  return tx.type === 'income' && Boolean(
    tx.primary_evidence_id ||
    tx.account_match_reason === INCOME_REVIEW_REASON ||
    (tx.note === REVIEWED_INCOME_NOTE && tx.category === REVIEWED_INCOME_CATEGORY)
  );
}

function isReviewedExpenseTransaction(tx: DeletedReviewSource): boolean {
  return tx.type === 'expense' && Boolean(
    tx.primary_evidence_id ||
    tx.account_match_reason === REVIEWED_EXPENSE_REASON
  );
}

async function fetchOwnedTransactionsForDelete(
  userId: string,
  ids: string[]
): Promise<DeletedReviewSource[]> {
  if (ids.length === 0) return [];

  const { data, error } = await supabase
    .from('transactions')
    .select('id,type,amount,note,category,created_at,primary_evidence_id,account_match_reason')
    .eq('user_id', userId)
    .in('id', ids);

  if (error) {
    console.warn('[TransactionDelete] Could not inspect review source before delete', {
      inspected: false,
    });
    return [];
  }

  return (data || []) as unknown as DeletedReviewSource[];
}

async function resolveIncomeReviewTombstoneTarget(
  userId: string,
  tx: DeletedReviewSource
): Promise<IncomeReviewTombstoneTarget | null> {
  if (!isReviewedIncomeTransaction(tx)) return null;

  let evidenceId = tx.primary_evidence_id || null;
  let signalHash: string | null = null;

  const { data: decision } = await supabase
    .from('income_review_decisions')
    .select('evidence_id,signal_hash')
    .eq('user_id', userId)
    .eq('transaction_id', tx.id)
    .maybeSingle();

  if (decision) {
    evidenceId = (decision as { evidence_id?: string | null }).evidence_id || evidenceId;
    signalHash = (decision as { signal_hash?: string | null }).signal_hash || null;
  }

  if (evidenceId && !signalHash) {
    const { data: evidence } = await supabase
      .from('transaction_evidence')
      .select('signal_id')
      .eq('user_id', userId)
      .eq('id', evidenceId)
      .maybeSingle();
    signalHash = (evidence as { signal_id?: string | null } | null)?.signal_id || null;
  }

  if (!evidenceId && !signalHash) return null;
  return { evidenceId, signalHash };
}

async function writeIncomeReviewDeletionTombstone(
  userId: string,
  target: IncomeReviewTombstoneTarget
): Promise<boolean> {
  const lookups: Array<[string, string | null]> = [
    ['evidence_id', target.evidenceId],
    ['signal_hash', target.signalHash],
  ];

  let existingId: string | null = null;
  for (const [column, value] of lookups) {
    if (!value) continue;
    const { data } = await supabase
      .from('income_review_decisions')
      .select('id')
      .eq('user_id', userId)
      .eq(column, value)
      .maybeSingle();
    existingId = (data as { id?: string } | null)?.id || null;
    if (existingId) break;
  }

  const payload = {
    transaction_id: null,
    evidence_id: target.evidenceId,
    signal_hash: target.signalHash,
    decision: 'not_income',
    income_source_type: null,
    confidence: 'user_confirmed',
    reviewed_at: new Date().toISOString(),
  };

  const mutation = existingId
    ? supabase
        .from('income_review_decisions')
        .update(payload)
        .eq('id', existingId)
        .eq('user_id', userId)
    : supabase
        .from('income_review_decisions')
        .insert({ ...payload, user_id: userId });

  const { error } = await mutation;
  if (error) {
    console.warn('[TransactionDelete] Could not tombstone reviewed income source', {
      tombstoneWritten: false,
    });
    return false;
  }

  return true;
}

async function markDeletedReviewQueueSources(
  userId: string,
  transactions: DeletedReviewSource[]
): Promise<boolean> {
  const reviewSourceIds = new Set(transactions
    .filter(isReviewedExpenseTransaction)
    .map(tx => tx.id));
  const evidenceIds = new Set(transactions
    .filter(isReviewedExpenseTransaction)
    .map(tx => tx.primary_evidence_id)
    .filter((id): id is string => Boolean(id)));

  if (reviewSourceIds.size === 0 && evidenceIds.size === 0) return false;

  const queue = await loadUserScopedQueue<Record<string, any>>(REVIEW_QUEUE_BASE_KEY, userId);
  let changed = false;
  const nextQueue = queue.map(item => {
    const candidate = item.candidate || {};
    const matchesTransaction = typeof item.createdTransactionId === 'string' &&
      reviewSourceIds.has(item.createdTransactionId);
    const matchesEvidence = typeof candidate.evidenceId === 'string' &&
      evidenceIds.has(candidate.evidenceId);

    if (!matchesTransaction && !matchesEvidence) return item;
    if (item.status === 'reviewed' || item.status === 'ignored') return item;

    changed = true;
    return {
      ...item,
      status: 'reviewed',
      deletedTransactionId: matchesTransaction ? item.createdTransactionId : undefined,
    };
  });

  if (!changed) return false;

  await saveUserScopedQueue(REVIEW_QUEUE_BASE_KEY, userId, nextQueue);
  return true;
}

async function markDeletedReviewSources(
  userId: string,
  transactions: DeletedReviewSource[]
): Promise<void> {
  if (transactions.length === 0) return;

  let changedReviewState = false;
  for (const tx of transactions) {
    const target = await resolveIncomeReviewTombstoneTarget(userId, tx);
    if (target) {
      changedReviewState = (await writeIncomeReviewDeletionTombstone(userId, target)) || changedReviewState;
    }
  }

  changedReviewState = (await markDeletedReviewQueueSources(userId, transactions)) || changedReviewState;

  if (changedReviewState) {
    emitFinanceDataChanged({
      areas: ['review'],
      source: 'transaction:delete_review_source',
    });
  }
}

export type AddTransactionInput = Omit<Transaction, 'id' | 'user_id' | 'created_at'> & {
  created_at?: string;
};

export async function addTransaction(
  tx: AddTransactionInput
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
    'refund_of_transaction_id',
    'account_match_status',
    'account_match_confidence',
    'account_match_reason',
    'account_match_owner_type',
    'account_match_owner_id',
    'primary_evidence_id',
  ];
  const metadata = optionalFields.reduce<Record<string, unknown>>((fields, key) => {
    const value = tx[key];
    if (value !== undefined && value !== null && value !== '') {
      fields[key] = value;
    }
    return fields;
  }, {});
  const createdAt = tx.created_at?.trim();

  const { data, error } = await supabase
    .from('transactions')
    .insert({
      user_id: user.id,
      amount: tx.amount,
      type: tx.type,
      note: tx.note.trim(),
      category: tx.category,
      ...metadata,
      ...(createdAt ? { created_at: createdAt } : {}),
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

export interface CreateLinkedRefundTransactionInput {
  amount: number;
  refundOfTransactionId: string;
  note: string;
  category?: string | null;
  reference_number?: string | null;
  account_id?: string | null;
  account_last4?: string | null;
}

function cleanTransactionText(value?: string | null): string | undefined {
  const cleaned = value?.replace(/\s+/g, ' ').trim();
  return cleaned || undefined;
}

export async function createLinkedRefundTransaction(
  input: CreateLinkedRefundTransactionInput
): Promise<Transaction> {
  if (!input.amount || input.amount <= 0) {
    throw new Error('Valid refund amount required');
  }

  const refundOfTransactionId = cleanTransactionText(input.refundOfTransactionId);
  if (!refundOfTransactionId) {
    throw new Error('Original expense transaction required');
  }

  const note = cleanTransactionText(input.note);
  if (!note) {
    throw new Error('Refund note required');
  }

  return addTransaction({
    amount: input.amount,
    type: 'refund',
    note,
    category: cleanTransactionText(input.category) || 'Refund',
    refund_of_transaction_id: refundOfTransactionId,
    reference_number: cleanTransactionText(input.reference_number),
    account_id: cleanTransactionText(input.account_id),
    account_last4: cleanTransactionText(input.account_last4),
  });
}

export interface FindDuplicateLinkedRefundTransactionInput {
  amount: number;
  refundOfTransactionId: string;
  reference_number?: string | null;
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

  return (data || []).map(tx => sanitizeTransactionRawSmsForPrivacy(tx as Transaction));
}

export async function findDuplicateLinkedRefundTransaction(
  input: FindDuplicateLinkedRefundTransactionInput
): Promise<Transaction | null> {
  if (!input.amount || input.amount <= 0) {
    throw new Error('Valid refund amount required');
  }

  const refundOfTransactionId = cleanTransactionText(input.refundOfTransactionId);
  if (!refundOfTransactionId) {
    throw new Error('Original expense transaction required');
  }

  const reference = cleanTransactionText(input.reference_number)?.toLowerCase();
  const transactions = await getTransactions();

  return transactions.find(tx => {
    if (tx.type !== 'refund') return false;
    if (tx.refund_of_transaction_id !== refundOfTransactionId) return false;
    if (tx.amount !== input.amount) return false;
    if (!reference) return true;

    return tx.reference_number?.trim().toLowerCase() === reference;
  }) || null;
}

export async function deleteTransaction(id: string): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('User not authenticated');

  const transactionsForReviewDisposition = await fetchOwnedTransactionsForDelete(user.id, [id]);

  const { error } = await supabase
    .from('transactions')
    .delete()
    .eq('id', id)
    .eq('user_id', user.id);

  if (error) {
    throw new Error(error.message);
  }

  await markDeletedReviewSources(user.id, transactionsForReviewDisposition);
  await updateTransactionsCache(current => current.filter(tx => tx.id !== id));
  emitFinanceDataChanged({
    areas: ['transactions', 'review'],
    source: 'transaction:delete',
    transactionId: id,
  });
}

export async function bulkDeleteTransactions(ids: string[]): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('User not authenticated');

  if (ids.length === 0) return;

  const transactionsForReviewDisposition = await fetchOwnedTransactionsForDelete(user.id, ids);

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
  await markDeletedReviewSources(user.id, transactionsForReviewDisposition);
  await updateTransactionsCache(current => current.filter(tx => !idSet.has(tx.id)));
  emitFinanceDataChanged({
    areas: ['transactions', 'review'],
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
type OfflineDeleteQueueEntry = OfflineQueueEntry | string;

function isDuplicateTransactionError(error: any): boolean {
  const message = String(error?.message || '');
  return (
    error?.code === '23505' ||
    message.includes('duplicate key value') ||
    message.includes('unique_transaction_identifier')
  );
}

function getQueuedDeleteTransactionId(item: OfflineDeleteQueueEntry): string | null {
  if (typeof item === 'string') {
    return item.trim() || null;
  }

  const transactionId = item.transactionId ?? item.id;
  return typeof transactionId === 'string' && transactionId.trim()
    ? transactionId.trim()
    : null;
}

async function syncOfflineDeleteQueue(userId: string): Promise<void> {
  const queue = await loadUserScopedQueue<OfflineQueueEntry>(OFFLINE_DELETE_QUEUE_BASE_KEY, userId);
  if (queue.length === 0) return;

  const remainingQueue: OfflineQueueEntry[] = [];
  const syncedIds = new Set<string>();
  let skippedOwnerMismatch = 0;

  for (const item of queue) {
    const ownerId = getQueueOwnerId(item);
    if (ownerId !== userId) {
      skippedOwnerMismatch++;
      continue;
    }

    const transactionId = getQueuedDeleteTransactionId(item);

    if (!transactionId) {
      console.warn('[OfflineSync] Invalid queued delete item, keeping item queued');
      remainingQueue.push(item as OfflineQueueEntry);
      continue;
    }

    const transactionsForReviewDisposition = await fetchOwnedTransactionsForDelete(userId, [transactionId]);

    const { error } = await supabase
      .from('transactions')
      .delete()
      .eq('id', transactionId)
      .eq('user_id', userId);

    if (error) {
      console.warn('[OfflineSync] Delete failed, keeping item queued:', error.message);
      remainingQueue.push(item as OfflineQueueEntry);
      continue;
    }

    syncedIds.add(transactionId);
    await markDeletedReviewSources(userId, transactionsForReviewDisposition);
  }

  if (syncedIds.size > 0) {
    await updateTransactionsCache(current => current.filter(tx => !syncedIds.has(tx.id)));
    emitFinanceDataChanged({
      areas: ['transactions', 'review'],
      source: 'offline:deleteSync',
    });
  }

  if (skippedOwnerMismatch > 0) {
    logUserQueueAction(OFFLINE_DELETE_QUEUE_BASE_KEY, USER_QUEUE_ACTIONS.skipped, skippedOwnerMismatch);
  }
  await saveUserScopedQueue(OFFLINE_DELETE_QUEUE_BASE_KEY, userId, remainingQueue);

  console.log(
    `[OfflineSync] Synced ${syncedIds.size} queued delete(s), skipped ${skippedOwnerMismatch} owner mismatch item(s), kept ${remainingQueue.length} queued`
  );
}

export async function syncOfflineTransactions(): Promise<void> {
  try {
    await Promise.all([
      quarantineLegacyQueue(OFFLINE_TX_QUEUE_BASE_KEY),
      quarantineLegacyQueue(OFFLINE_DELETE_QUEUE_BASE_KEY),
    ]);

    // Get authenticated user
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      console.warn('[OfflineSync] No authenticated user — skipping sync');
      return;
    }

    const queue = await loadUserScopedQueue<OfflineQueueEntry>(OFFLINE_TX_QUEUE_BASE_KEY, user.id);

    if (queue.length > 0) {
      // Keep local metadata out of DB rows and reject entries not owned by this user.
      const queueItems = queue.map(({ _localId, _queued_at, queued_at, id, created_at, queueOwnerId, ...tx }) => {
        const ownerId = getQueueOwnerId({ ...tx, queueOwnerId });
        if (ownerId !== user.id) {
          return {
            record: null,
            queuedAt: _queued_at || queued_at || null,
            original: { _localId, _queued_at, queued_at, id, created_at, queueOwnerId, ...tx },
            ownerMismatch: true,
          };
        }

        const record: OfflineQueueEntry = {
          ...tx,
          user_id: ownerId,
        };

        if (record.sms_source === 'manual') {
          delete record.sms_source;
        }

        return {
          record,
          queuedAt: _queued_at || queued_at || null,
          original: { _localId, _queued_at, queued_at, id, created_at, ...tx },
          ownerMismatch: false,
        };
      });

      const remainingQueue: OfflineQueueEntry[] = [];
      const syncedRecords: { tx: any; queuedAt: string | null }[] = [];
      let duplicateCount = 0;
      let skippedOwnerMismatch = 0;

      for (const item of queueItems) {
        if (item.ownerMismatch || !item.record) {
          skippedOwnerMismatch++;
          continue;
        }

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
        await saveUserScopedQueue(OFFLINE_TX_QUEUE_BASE_KEY, user.id, remainingQueue);
      } else {
        await saveUserScopedQueue(OFFLINE_TX_QUEUE_BASE_KEY, user.id, []);
      }

      if (skippedOwnerMismatch > 0) {
        logUserQueueAction(OFFLINE_TX_QUEUE_BASE_KEY, USER_QUEUE_ACTIONS.skipped, skippedOwnerMismatch);
      }

      console.log(
        `[OfflineSync] Synced ${syncedRecords.length} transaction(s), skipped ${duplicateCount} duplicate(s), skipped ${skippedOwnerMismatch} owner mismatch item(s), kept ${remainingQueue.length} queued`
      );
    }

    await syncOfflineDeleteQueue(user.id);
  } catch (e) {
    // Never crash the app — this runs silently in the background
    console.error('[OfflineSync] Unexpected error:', e);
  }
}
