/**
 * Cache Module
 * Consolidated: config.ts + dataCache.ts + prefetch.ts
 *
 * Handles:
 * - AI configuration (API keys, provider selection)
 * - Data caching (AsyncStorage for normal data, EncryptedStorage for secrets)
 * - Data prefetching (background data loading)
 * - SWR (Stale-While-Revalidate) — callers know if data is stale
 */

import { Image } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getBankAccounts } from '../database/financial';
import { getPlaces, getPeopleLedger } from '../database/userdata';
import { getTransactions } from '../core';
import { supabase } from '../core';
import { sanitizeTransactionRawSmsListForPrivacy } from '../privacy/rawText';
import {
  OFFLINE_DELETE_QUEUE_BASE_KEY,
  OFFLINE_TX_QUEUE_BASE_KEY,
  quarantineLegacyQueue,
} from './userScopedQueues';

// ═══════════════════════════════════════════════════════════════════════════════
// DATA CACHE
// ═══════════════════════════════════════════════════════════════════════════════

export const CACHE_KEYS = {
  TRANSACTIONS: 'cache_transactions',
  PEOPLE_LEDGER: 'cache_people_ledger',
  PLACES: 'cache_places',
  VAULT_ITEMS: 'cache_vault_items',
  BANK_ACCOUNTS: 'cache_bank_accounts',
  UNIQUE_CATEGORIES: 'cache_unique_categories',
  USER_PROFILE: 'cache_user_profile',
  LEDGER_PAYMENTS: 'cache_ledger_payments',
  DASHBOARD_SUMMARY: 'cache_dashboard_summary',
  BALANCE_VIEWS: 'cache_balance_views',
  INCOME_REVIEW_DECISIONS: 'cache_income_review_decisions',
} as const;

const CACHE_PREFIX = 'cache_';

// Max age before cache is considered stale (5 minutes)
const MAX_CACHE_AGE_MS = 5 * 60 * 1000;

type CacheEntry<T> = {
  data: T;
  timestamp: number;
};

function summarizeErrorForLog(error: unknown) {
  if (error && typeof error === 'object') {
    const maybeError = error as { code?: unknown; name?: unknown; status?: unknown };
    return {
      code: typeof maybeError.code === 'string' ? maybeError.code : null,
      name: typeof maybeError.name === 'string' ? maybeError.name : null,
      status: typeof maybeError.status === 'number' || typeof maybeError.status === 'string' ? maybeError.status : null,
    };
  }

  return {
    code: null,
    name: typeof error,
    status: null,
  };
}

function sanitizeCacheDataForPrivacy<T>(key: string, data: T): T {
  if (key === CACHE_KEYS.TRANSACTIONS && Array.isArray(data)) {
    return sanitizeTransactionRawSmsListForPrivacy(data as any[]) as T;
  }

  if (key === CACHE_KEYS.USER_PROFILE && data && typeof data === 'object' && !Array.isArray(data)) {
    const safeProfile = { ...(data as Record<string, unknown>) };
    delete safeProfile.email;
    delete safeProfile.phone;
    delete safeProfile.full_name;
    return safeProfile as T;
  }

  return data;
}

function didSanitizeData<T>(before: T, after: T): boolean {
  return before !== after && JSON.stringify(before) !== JSON.stringify(after);
}

// ─── SWR Return Type ─────────────────────────────────────────────────────────
export type CachedResult<T> = { data: T; isStale: boolean } | null;

/**
 * Get cached data with SWR support.
 * Returns { data, isStale: false } if fresh (< 5 min old) — UI can skip background refresh.
 * Returns { data, isStale: true } if stale — UI should silently re-fetch from Supabase.
 * Returns null if no cached entry exists.
 *
 * NOTE: All cache entries use AsyncStorage. Data security is enforced by Supabase RLS,
 * not by local cache encryption. The cache is a performance layer only.
 */
export async function getCached<T>(key: string): Promise<CachedResult<T>> {
  try {
    const raw = await AsyncStorage.getItem(key);
    if (!raw) return null;

    const entry = JSON.parse(raw) as CacheEntry<T> | T;
    if (!entry || typeof entry !== 'object' || !('data' in entry) || !('timestamp' in entry)) {
      const sanitizedData = sanitizeCacheDataForPrivacy(key, entry as T);
      if (didSanitizeData(entry as T, sanitizedData)) {
        await AsyncStorage.setItem(key, JSON.stringify(sanitizedData));
      }
      return { data: sanitizedData, isStale: true };
    }

    const isStale = Date.now() - entry.timestamp > MAX_CACHE_AGE_MS;
    const sanitizedData = sanitizeCacheDataForPrivacy(key, entry.data);
    if (didSanitizeData(entry.data, sanitizedData)) {
      await AsyncStorage.setItem(key, JSON.stringify({
        ...entry,
        data: sanitizedData,
      }));
    }

    return { data: sanitizedData, isStale };
  } catch {
    return null;
  }
}

/**
 * Write data to cache.
 */
export async function setCache<T>(key: string, data: T): Promise<void> {
  try {
    const entry: CacheEntry<T> = { data: sanitizeCacheDataForPrivacy(key, data), timestamp: Date.now() };
    await AsyncStorage.setItem(key, JSON.stringify(entry));
  } catch {
    // Silently fail — caching is best-effort
  }
}

export function scopedCacheKey(baseKey: string, scope: string | number): string {
  return `${baseKey}:${scope}`;
}

// Bug #H2 fix: user-scoped clear — ensures sign-out only removes the departing user's
// cache rather than relying on a global prefix sweep that could race with the next login.
// Full per-user key namespacing (getScopedUserCacheKey everywhere) is the follow-up step;
// this establishes the correct sign-out boundary today.
export async function clearUserCache(userId: string): Promise<void> {
  try {
    await Promise.all([
      quarantineLegacyQueue(OFFLINE_TX_QUEUE_BASE_KEY),
      quarantineLegacyQueue(OFFLINE_DELETE_QUEUE_BASE_KEY),
    ]);

    const keys = await AsyncStorage.getAllKeys();
    const cacheKeys = keys.filter(key => key.startsWith(CACHE_PREFIX));
    // Per-user scoped keys (future namespace — clear them too when they exist)
    const userScopedKeys = keys.filter(key =>
      Object.values(CACHE_KEYS).some(base =>
        key === `${base}:user:${userId}` || key.startsWith(`${base}:user:${userId}:`)
      )
    );
    const allUserKeys = [...new Set([...cacheKeys, ...userScopedKeys])];
    if (allUserKeys.length > 0) {
      await Promise.all(allUserKeys.map(key => AsyncStorage.removeItem(key)));
    }
  } catch {
    // Silently fail — sign-out must complete regardless of cache errors.
  }
}

export async function updateCache<T>(
  key: string,
  updater: (current: T | null) => T | null
): Promise<void> {
  try {
    const current = await getCached<T>(key);
    const next = updater(current?.data ?? null);

    if (next === null) {
      await AsyncStorage.removeItem(key);
      return;
    }

    await setCache(key, next);
  } catch {
    // Cache writes are best-effort only.
  }
}

export async function removeCache(key: string): Promise<void> {
  try {
    await AsyncStorage.removeItem(key);
  } catch {
    // Silently fail
  }
}

export async function clearCache(): Promise<void> {
  try {
    await Promise.all([
      quarantineLegacyQueue(OFFLINE_TX_QUEUE_BASE_KEY),
      quarantineLegacyQueue(OFFLINE_DELETE_QUEUE_BASE_KEY),
    ]);

    const keys = await AsyncStorage.getAllKeys();
    await Promise.all(keys.filter(key => key.startsWith(CACHE_PREFIX)).map(key => AsyncStorage.removeItem(key)));
  } catch {
    // Silently fail
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// DATA PREFETCH
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Prefetch all app data on startup (after login).
 * Each fetch runs independently — if one fails, others continue.
 * Now includes Transactions + PeopleLedger for instant Dashboard/People screen loads.
 */
export async function prefetchAllData(): Promise<void> {
  console.log('🚀 [Prefetch] Starting background data prefetch...');
  const start = Date.now();

  const results = await Promise.allSettled([
    prefetchProfile(),
    prefetchBanks(),
    purgeVaultCache(),
    prefetchPlaces(),
    prefetchTransactions(),    // ← Added: core financial data
    prefetchPeopleLedger(),    // ← Added: people ledger for Dashboard summary
    prefetchBalanceViews(),    // ← Added: balance views for instant screen loading
    prefetchIncomeReviewDecisions(),
  ]);

  const elapsed = Date.now() - start;
  const succeeded = results.filter(r => r.status === 'fulfilled').length;
  console.log(`🚀 [Prefetch] Done in ${elapsed}ms — ${succeeded}/${results.length} succeeded`);
}

async function prefetchBalanceViews() {
  try {
    const {
      getAccountBalanceViewModels,
      getCreditCardBalanceViewModels,
      getPendingDetectedBalanceSummary,
    } = require('./balanceViewModel');
    
    const [accountViews, cardViews, pendingSummary] = await Promise.all([
      getAccountBalanceViewModels(),
      getCreditCardBalanceViewModels(),
      getPendingDetectedBalanceSummary(),
    ]);

    if (!Array.isArray(accountViews) || !Array.isArray(cardViews) || !pendingSummary) {
      throw new Error('Invalid balance view payload');
    }
    
    await setCache(CACHE_KEYS.BALANCE_VIEWS, { accountViews, cardViews, pendingSummary });
    console.log('🚀 [Prefetch] ✅ Balance Views cached');
  } catch (e) {
    // Bug #M1 fix: Toast removed from background prefetch. This fired immediately on app
    // open — before users could even see the balance screen — causing new users with no
    // accounts to see an alarming error on first login. Contextual error handling now
    // belongs to the screen that actually needs the balance data.
    if (__DEV__) {
      console.warn('[Cache] Balance prefetch failed (silent in prod):', {
        error: e instanceof Error ? e.message : String(e),
      });
    }
    // Don't re-throw: prefetchAllData uses Promise.allSettled, so other fetches still run.
  }
}

async function prefetchIncomeReviewDecisions() {
  try {
    const { getIncomeReviewDecisions } = require('./incomeReview');
    const decisions = await getIncomeReviewDecisions();
    await setCache(CACHE_KEYS.INCOME_REVIEW_DECISIONS, decisions);
    console.log('🚀 [Prefetch] ✅ Income Review Decisions cached');
  } catch (e) {
    console.warn('🚀 [Prefetch] ❌ Income Review Decisions failed', {
      error: summarizeErrorForLog(e),
    });
  }
}

async function prefetchProfile() {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user?.email) return;

    const { data: profile } = await supabase
      .from('profiles')
      .select('full_name')
      .eq('id', user.id)
      .single();

    await setCache(CACHE_KEYS.USER_PROFILE, {
      name: profile?.full_name || '',
      userId: user.id,
    });
    console.log('🚀 [Prefetch] ✅ Profile', {
      hasUser: Boolean(user.id),
      userIdSuffix: user.id ? user.id.slice(-6) : null,
      profileNamePresent: Boolean(profile?.full_name?.trim()),
    });
  } catch (e) {
    console.warn('🚀 [Prefetch] ❌ Profile failed', {
      operation: 'prefetchProfile',
      error: summarizeErrorForLog(e),
    });
  }
}

async function prefetchBanks() {
  try {
    const data = await getBankAccounts();
    await setCache(CACHE_KEYS.BANK_ACCOUNTS, data);
    console.log('🚀 [Prefetch] ✅ Banks:', data.length, 'accounts');
  } catch (e) {
    console.warn('🚀 [Prefetch] ❌ Banks failed', {
      error: summarizeErrorForLog(e),
    });
  }
}

async function purgeVaultCache() {
  await removeCache(CACHE_KEYS.VAULT_ITEMS);
  console.log('🚀 [Prefetch] ✅ Vault cache purged');
}

async function prefetchPlaces() {
  try {
    const data = await getPlaces();
    await setCache(CACHE_KEYS.PLACES, data);
    console.log('🚀 [Prefetch] ✅ Places:', data.length, 'places');

    const photoUrls = data
      .filter(p => p.photo_uri && p.photo_uri.startsWith('http'))
      .map(p => p.photo_uri!);

    if (photoUrls.length > 0) {
      await Promise.allSettled(photoUrls.map(url => Image.prefetch(url)));
      console.log('🚀 [Prefetch] ✅ Photos:', photoUrls.length, 'images cached');
    }
  } catch (e) {
    console.warn('🚀 [Prefetch] ❌ Places failed', {
      error: summarizeErrorForLog(e),
    });
  }
}

async function prefetchTransactions() {
  try {
    const data = await getTransactions();
    await setCache(CACHE_KEYS.TRANSACTIONS, data);
    console.log('🚀 [Prefetch] ✅ Transactions:', data.length, 'records');
  } catch (e) {
    console.warn('🚀 [Prefetch] ❌ Transactions failed', {
      error: summarizeErrorForLog(e),
    });
  }
}

async function prefetchPeopleLedger() {
  try {
    const data = await getPeopleLedger(true); // include settled entries
    await setCache(CACHE_KEYS.PEOPLE_LEDGER, data);
    console.log('🚀 [Prefetch] ✅ People Ledger:', data.length, 'entries');
  } catch (e) {
    console.warn('🚀 [Prefetch] ❌ People Ledger failed', {
      error: summarizeErrorForLog(e),
    });
  }
}
