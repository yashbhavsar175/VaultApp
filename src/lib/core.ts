// ═══════════════════════════════════════════════════════════════════════════════
// CORE UTILITIES MODULE
// Consolidated: supabase + aiParser + googleAuth + db
// ═══════════════════════════════════════════════════════════════════════════════

import 'react-native-url-polyfill/auto';
import { createClient } from '@supabase/supabase-js';
import AsyncStorage from '@react-native-async-storage/async-storage';
import EncryptedStorage from 'react-native-encrypted-storage';
import { GoogleSignin } from '@react-native-google-signin/google-signin';
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, GOOGLE_WEB_CLIENT_ID } from '../config';
import { Transaction, TransactionType } from '../types';
import { emitFinanceDataChanged } from './services/dataEvents';
import { GeofencingNative } from './services/geofencingNative';
import { sanitizeTransactionRawSmsForPrivacy } from './privacy/rawText';
import {
  OFFLINE_DELETE_QUEUE_BASE_KEY,
  OFFLINE_TX_QUEUE_BASE_KEY,

  getQueueOwnerId,
  loadUserScopedQueue,
  logUserQueueAction,
  quarantineLegacyQueue,
  saveUserScopedQueue,
  USER_QUEUE_ACTIONS,
  withUserScopedQueueLock,
} from './services/userScopedQueues';

// ═══════════════════════════════════════════════════════════════════════════════
// SUPABASE CLIENT
// ═══════════════════════════════════════════════════════════════════════════════

const secureStorageAdapter = {
  getItem: async (key: string) => {
    try {
      return await EncryptedStorage.getItem(key);
    } catch {
      return null;
    }
  },
  setItem: async (key: string, value: string) => {
    try {
      await EncryptedStorage.setItem(key, value);
    } catch {}
  },
  removeItem: async (key: string) => {
    try {
      await EncryptedStorage.removeItem(key);
    } catch {}
  },
};

export const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: {
    storage: secureStorageAdapter,
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

const AI_PARSE_TIMEOUT_MS = 15000;

export async function parseTransactionWithAI(text: string): Promise<ParsedTransaction> {
  try {
    const trimmedText = text.trim();
    if (!trimmedText) {
      throw new Error('Please describe your transaction first');
    }

    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => {
        reject(new Error('AI parsing timed out. Please use manual mode.'));
      }, AI_PARSE_TIMEOUT_MS);
    });

    const invokePromise = supabase.functions.invoke('parse-transaction', {
      body: { text: trimmedText },
    });

    const result = await Promise.race([invokePromise, timeoutPromise])
      .finally(() => {
        if (timeoutId) clearTimeout(timeoutId);
      });

    const { data, error } = result as any;

    if (error || !data) {
      if (__DEV__) console.log('[AIParser] Edge failed, using local parser');
      return parseTransaction(text);
    }

    const parsed = data as Partial<ParsedTransaction> | null;
    const amount = Number(parsed?.amount);
    if (!parsed || !Number.isFinite(amount) || amount <= 0 || !parsed.type || !parsed.note) {
      throw new Error('AI parsing returned an incomplete result. Please use manual mode.');
    }

    return {
      amount,
      type: parsed.type,
      note: String(parsed.note),
      category: String(parsed.category || parsed.type),
    };
  } catch (error) {
    console.error('[AIParser] parseTransactionWithAI failed:', error);
    // FINAL FALLBACK: local parser
    return parseTransaction(text);
  }
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
  
  // Detect type. Directional person payments should affect cashflow; only
  // self/account movements stay neutral transfers.
  let type: TransactionType = 'expense';
  const neutralTransferPattern = /cash deposit|bank deposit|cash withdrawal|atm withdrawal|withdrawal|withdrawn|self transfer|own account|reimburse|reimbursement|loan repayment|debt repayment/;
  const incomingPersonPattern = /give me|gave me|gives me|given me|sent me|received from|got from|mujhe diya|mujhe mila|mujhe aaya/;
  const outgoingPersonPattern = /\b(i|main|maine|mene|we|humne|hamne)\s+(gave|give|paid|pay|sent|send|spent|spend|bheja|diya)\b|\b(sent|send|gave|give|paid|pay)\b.*\bto\b.*\b(family|friend|brother|sister|bhai|behen|dost|mom|mother|mummy|dad|father|papa|parents?)\b/;

  if (/lent|udhar diya|lend/.test(lowerText)) {
    type = 'lent';
  } else if (/borrowed|liya|udhar liya|took from|borrow/.test(lowerText)) {
    type = 'borrowed';
  } else if (/refund|refunded/.test(lowerText)) {
    type = 'refund';
  } else if (neutralTransferPattern.test(lowerText)) {
    type = 'transfer';
  } else if (incomingPersonPattern.test(lowerText) || /salary|received|credited|income|got|earned/.test(lowerText)) {
    type = 'income';
  } else if (outgoingPersonPattern.test(lowerText)) {
    type = 'expense';
  } else if (/sip|mutual fund|stocks|zerodha|invest|shares|fd|nps/.test(lowerText)) {
    type = 'investment';
  } else if (/emi|loan|equated|hdfc loan|iciciloan/.test(lowerText)) {
    type = 'emi';
  }
  
  // Extract note — remove amount, keep rest
  const note = text.replace(/₹?\s*\d+(?:\.\d+)?/, '').trim() || text.slice(0, 30);
  
  const category = /\b(mom|mother|mummy|dad|father|papa|parents?|family|brother|sister|bhai|behen)\b/.test(lowerText)
    ? 'Family'
    : /\b(friend|dost|yaar)\b/.test(lowerText)
      ? 'Personal'
      : type;

  return { amount, type, note, category };
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

// Bug #9 fix: pehle single attempt thi aur fail pe geofences silently remain karte the
// Retry once — agar dono fail hote hain toh flag set karo, next launch pe clear hoga
const PENDING_GEOFENCE_CLEAR_KEY = 'cache_pending_geofence_clear';
const GEOFENCE_CLEAR_MAX_ATTEMPTS = 2;

async function clearGeofencesOnSignOut(): Promise<boolean> {
  for (let attempt = 1; attempt <= GEOFENCE_CLEAR_MAX_ATTEMPTS; attempt++) {
    try {
      await GeofencingNative.clearGeofences();
      console.log('[Core] Geofences cleared on sign out', { attempt });
      return true;
    } catch (e) {
      console.warn('[Core] Geofence clear attempt failed', {
        attempt,
        maxAttempts: GEOFENCE_CLEAR_MAX_ATTEMPTS,
        error: e instanceof Error ? e.message : String(e),
      });

      if (attempt === GEOFENCE_CLEAR_MAX_ATTEMPTS) {
        // Dono attempts fail — flag set karo taaki next launch pe retry ho
        try {
          await AsyncStorage.setItem(PENDING_GEOFENCE_CLEAR_KEY, 'true');
          console.warn('[Core] Geofence clear flagged for next launch — privacy fallback active');
        } catch (storageError) {
          console.error('[Core] Could not flag pending geofence clear:', {
            error: storageError instanceof Error ? storageError.message : String(storageError),
          });
        }
      }
    }
  }
  return false;
}

// App startup pe call karo — agar pichle session mein clear fail hua tha toh retry karo
export async function handlePendingGeofenceClear(): Promise<void> {
  try {
    const pending = await AsyncStorage.getItem(PENDING_GEOFENCE_CLEAR_KEY);
    if (pending !== 'true') return;

    console.log('[Core] Found pending geofence clear from previous session — retrying');
    await GeofencingNative.clearGeofences();
    await AsyncStorage.removeItem(PENDING_GEOFENCE_CLEAR_KEY);
    console.log('[Core] Pending geofence clear completed');
  } catch (e) {
    // Flag remains — will retry on next launch
    console.warn('[Core] Pending geofence clear failed — will retry next launch:', {
      error: e instanceof Error ? e.message : String(e),
    });
  }
}

export const signOutFromGoogle = async () => {
  try {
    await clearGeofencesOnSignOut();
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
const INCOME_REVIEW_REASON = 'income_review_confirmed';
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
let activeOfflineSyncPromise: Promise<void> | null = null;
// Bug #H1 fix: promise-chain lock — prevents concurrent read-modify-write races.
// Pattern mirrors withUserScopedQueueLock in userScopedQueues.ts.
let _transactionCacheWriteLock: Promise<void> = Promise.resolve();

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
  // Bug #H1 fix: serialise all reads+writes through a promise chain so concurrent callers
  // (addTransaction, syncOfflineTransactions, AppState change, network reconnect) cannot
  // interleave and overwrite each other's work with a stale read.
  _transactionCacheWriteLock = _transactionCacheWriteLock
    .catch(() => undefined) // a previous failure must not block the next write
    .then(async () => {
      try {
        const raw = await AsyncStorage.getItem(TRANSACTIONS_CACHE_KEY);
        const parsed = raw ? JSON.parse(raw) : null;
        const current = Array.isArray(parsed?.data)
          ? parsed.data
          : Array.isArray(parsed)
            ? parsed
            : [];
        const next = updater(current).map(tx => sanitizeTransactionRawSmsForPrivacy(tx));
        await AsyncStorage.setItem(TRANSACTIONS_CACHE_KEY, JSON.stringify({
          data: next,
          timestamp: Date.now(),
        }));
        await invalidateDashboardSummaryCache();
      } catch {
        // Cache is a best-effort performance layer.
      }
    });

  await _transactionCacheWriteLock;
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
  tx: AddTransactionInput,
  userId?: string
): Promise<Transaction> {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    
    if (!user) {
      throw new Error('User not authenticated');
    }

    if (userId && userId !== user.id) {
      throw new Error('User ownership mismatch');
    }

    const ownerId = userId || user.id;

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
        user_id: ownerId,
        amount: tx.amount,
        type: tx.type,
        note: tx.note.trim(),
        category: tx.category,
        ...metadata,
        ...(createdAt ? { created_at: createdAt } : {}),
      })
      .select()
      .eq('user_id', ownerId)
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
  } catch (error) {
    console.error('[DB] addTransaction failed:', error);
    throw error;
  }
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

const TRANSACTION_COLUMNS = [
  'id',
  'user_id',
  'amount',
  'type',
  'note',
  'category',
  'created_at',
  'account_id',
  'from_account_id',
  'to_account_id',
  'is_transfer_pending',
  'refund_of_transaction_id',
  'sms_source',
  'sms_sender',
  'raw_sms',
  'merchant',
  'account_last4',
  'balance',
  'upi_id',
  'reference_number',
  'primary_evidence_id',
  'account_match_status',
  'account_match_confidence',
  'account_match_reason',
].join(',');

export async function getTransactions(
  userId?: string,
  page?: number,
  pageSize: number = 30
): Promise<Transaction[]> {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    
    if (!user) {
      throw new Error('User not authenticated');
    }

    if (userId && userId !== user.id) {
      throw new Error('User ownership mismatch');
    }

    const ownerId = userId || user.id;

    let query = supabase
      .from('transactions')
      .select(TRANSACTION_COLUMNS)
      .eq('user_id', ownerId)
      .order('created_at', { ascending: false });

    if (page !== undefined) {
      const from = page * pageSize;
      const to = from + pageSize - 1;
      query = query.range(from, to);
    }

    const { data, error } = await query;

    if (error) {
      throw new Error(error.message);
    }

    return (data || []).map(tx => sanitizeTransactionRawSmsForPrivacy(tx as unknown as Transaction));
  } catch (error) {
    console.error('[DB] getTransactions failed:', error);
    throw error;
  }
}

export async function findDuplicateLinkedRefundTransaction(
  input: FindDuplicateLinkedRefundTransactionInput
): Promise<Transaction | null> {
  // Bug #C4 fix: replaced getTransactions() full-scan with a targeted DB query.
  // Before: fetched up to 1 000 rows into memory + linear JS scan (O(n), wrong for >1 000 tx).
  // After: DB filters to 0–1 rows, never fetches unrelated transactions.
  if (!input.amount || input.amount <= 0) {
    throw new Error('Valid refund amount required');
  }

  const refundOfTransactionId = cleanTransactionText(input.refundOfTransactionId);
  if (!refundOfTransactionId) {
    throw new Error('Original expense transaction required');
  }

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('User not authenticated');

  const reference = cleanTransactionText(input.reference_number)?.toLowerCase() ?? null;

  // Narrow query: ownership + type + parent + amount — DB handles all heavy lifting.
  const { data, error } = await supabase
    .from('transactions')
    .select('id, user_id, amount, type, note, category, created_at, refund_of_transaction_id, reference_number, client_idempotency_key')
    .eq('user_id', user.id)
    .eq('type', 'refund')
    .eq('refund_of_transaction_id', refundOfTransactionId)
    .eq('amount', input.amount)
    .limit(10); // at most a handful of refunds for the same amount — JS filter below is O(1)

  if (error) {
    console.error('[Core] Duplicate refund check failed:', {
      error: error.message,
      code: safeErrorCode(error),
    });
    return null; // non-fatal — allow refund to proceed rather than blocking on query failure
  }

  if (!data || data.length === 0) return null;

  // If no reference provided, any matching row is a duplicate.
  if (!reference) return data[0] as Transaction;

  // Reference provided — match case-insensitively within the tiny result set.
  return (data.find(tx => tx.reference_number?.trim().toLowerCase() === reference) ?? null) as Transaction | null;
}

export async function deleteTransaction(id: string): Promise<void> {
  try {
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
  } catch (error) {
    console.error('[DB] deleteTransaction failed:', error);
    throw error;
  }
}

export async function bulkDeleteTransactions(ids: string[]): Promise<void> {
  try {
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
  } catch (error) {
    console.error('[DB] bulkDeleteTransactions failed:', error);
    throw error;
  }
}

export async function updateTransaction(
  id: string,
  updates: Partial<Omit<Transaction, 'id' | 'user_id' | 'created_at'>>
): Promise<Transaction> {
  try {
    if (updates.amount !== undefined && updates.amount <= 0) {
      throw new Error('Amount must be greater than zero');
    }
    if (updates.type === 'transfer') {
      throw new Error('Cannot update transaction type to transfer');
    }

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
  } catch (error) {
    console.error('[DB] updateTransaction failed:', error);
    throw error;
  }
}

export async function getUniqueCategories(): Promise<string[]> {
  try {
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
  } catch (error) {
    console.error('[DB] getUniqueCategories failed:', error);
    throw error;
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// OFFLINE SYNC ENGINE
// Triggered on network reconnection or AppState change from background
// ═══════════════════════════════════════════════════════════════════════════════

// Bug #M6 fix: typed offline queue entries — no more Record<string, any>.
// [key: string]: unknown allows extension without breaking existing spread/destructure usage.
interface OfflineTransactionQueueEntry {
  _localId?: string;
  _queued_at?: string;
  queued_at?: string;
  queueOwnerId?: string;
  user_id?: string;
  client_idempotency_key?: string;
  id?: string;
  created_at?: string;
  amount?: number;
  type?: TransactionType;
  note?: string;
  category?: string;
  account_id?: string | null;
  sms_source?: string | null;
  [key: string]: unknown;
}

// Delete queue entries can be either a plain transaction ID string (legacy) or a structured object.
interface OfflineDeleteQueueEntryObject {
  transactionId?: string;
  id?: string;
  _queued_at?: string;
  queueOwnerId?: string;
  user_id?: string;
  [key: string]: unknown;
}

type OfflineQueueEntry = OfflineTransactionQueueEntry;
type OfflineDeleteQueueEntry = OfflineDeleteQueueEntryObject | string;

function isDuplicateTransactionError(error: any): boolean {
  const message = String(error?.message || '');
  return (
    error?.code === '23505' ||
    message.includes('duplicate key value') ||
    message.includes('unique_transaction_identifier')
  );
}

function safeErrorCode(error: unknown): string | null {
  if (!error || typeof error !== 'object') return null;
  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' ? code : null;
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
  await withUserScopedQueueLock(OFFLINE_DELETE_QUEUE_BASE_KEY, userId, async () => {
    const queue = await loadUserScopedQueue<OfflineQueueEntry>(OFFLINE_DELETE_QUEUE_BASE_KEY, userId);
    if (queue.length === 0) return;

    const remainingQueue: OfflineQueueEntry[] = [];
    const syncedDeleteKeys = new Set<string>();
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

      if (syncedDeleteKeys.has(transactionId)) {
        continue;
      }

      const removedPendingLocal = await removePendingOfflineTransaction(userId, transactionId);
      if (removedPendingLocal) {
        syncedDeleteKeys.add(transactionId);
        continue;
      }

      const transactionsForReviewDisposition = await fetchOwnedTransactionsForDelete(userId, [transactionId]);

      const deleteQuery = supabase
        .from('transactions')
        .delete()
        .eq('user_id', userId);

      const scopedDeleteQuery = UUID_PATTERN.test(transactionId)
        ? deleteQuery.eq('id', transactionId)
        : deleteQuery.eq('client_idempotency_key', transactionId);

      const { error } = await scopedDeleteQuery;

      if (error) {
        console.warn('[OfflineSync] Delete failed, keeping item queued:', error.message);
        remainingQueue.push(item as OfflineQueueEntry);
        continue;
      }

      syncedDeleteKeys.add(transactionId);
      await markDeletedReviewSources(userId, transactionsForReviewDisposition);
    }

    if (syncedDeleteKeys.size > 0) {
      await updateTransactionsCache(current => current.filter(tx =>
        !syncedDeleteKeys.has(tx.id) && !syncedDeleteKeys.has(String((tx as any).client_idempotency_key || ''))
      ));
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
      `[OfflineSync] Synced ${syncedDeleteKeys.size} queued delete(s), skipped ${skippedOwnerMismatch} owner mismatch item(s), kept ${remainingQueue.length} queued`
    );
  });
}

export async function syncOfflineTransactions(): Promise<void> {
  if (activeOfflineSyncPromise) {
    return activeOfflineSyncPromise;
  }

  activeOfflineSyncPromise = syncOfflineTransactionsInner().finally(() => {
    activeOfflineSyncPromise = null;
  });
  return activeOfflineSyncPromise;
}

async function removePendingOfflineTransaction(userId: string, transactionId: string): Promise<boolean> {
  return withUserScopedQueueLock(OFFLINE_TX_QUEUE_BASE_KEY, userId, async () => {
    const queue = await loadUserScopedQueue<OfflineQueueEntry>(OFFLINE_TX_QUEUE_BASE_KEY, userId);
    if (queue.length === 0) return false;

    const nextQueue = queue.filter(item => {
      const localId = typeof item._localId === 'string' ? item._localId : null;
      const idempotencyKey = typeof item.client_idempotency_key === 'string' ? item.client_idempotency_key : null;
      const id = typeof item.id === 'string' ? item.id : null;
      return localId !== transactionId && idempotencyKey !== transactionId && id !== transactionId;
    });

    if (nextQueue.length === queue.length) return false;
    await saveUserScopedQueue(OFFLINE_TX_QUEUE_BASE_KEY, userId, nextQueue);
    return true;
  });
}

async function syncOfflineTransactionsInner(): Promise<void> {
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

    await syncOfflineDeleteQueue(user.id);

    await withUserScopedQueueLock(OFFLINE_TX_QUEUE_BASE_KEY, user.id, async () => {
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
          client_idempotency_key: typeof _localId === 'string' && _localId.trim()
            ? _localId
            : tx.client_idempotency_key,
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
      const syncedRecords: any[] = [];
      let duplicateCount = 0;
      let skippedOwnerMismatch = 0;

      for (const item of queueItems) {
        if (item.ownerMismatch || !item.record) {
          skippedOwnerMismatch++;
          continue;
        }

        const writeQuery = item.record.client_idempotency_key
          ? supabase
            .from('transactions')
            .upsert(item.record, { onConflict: 'user_id,client_idempotency_key' })
          : supabase
            .from('transactions')
            .insert(item.record);

        const { data: insertedRecord, error } = await writeQuery
          .select()
          .eq('user_id', user.id)
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

        syncedRecords.push(insertedRecord || item.record);
      }

      if (syncedRecords.length > 0) {
        const syncedTransactions = syncedRecords.map(tx => tx as Transaction);
        const syncedIds = new Set(syncedTransactions.map(tx => tx.id));
        const syncedClientKeys = new Set(
          syncedTransactions
            .map(tx => tx.client_idempotency_key)
            .filter((key): key is string => Boolean(key))
        );
        await updateTransactionsCache(current => [
          ...syncedTransactions,
          ...current.filter(tx =>
            !syncedIds.has(tx.id) &&
            !(tx.client_idempotency_key && syncedClientKeys.has(tx.client_idempotency_key))
          ),
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
    });
  } catch (e) {
    // Never crash the app — this runs silently in the background
    console.error('[OfflineSync] Unexpected error:', e);
  }
}
