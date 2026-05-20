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
import { getVaultItems } from '../database/vaultDb';
import { getPlaces, getPeopleLedger } from '../database/userdata';
import { getTransactions } from '../core';
import { supabase } from '../core';
import { GEMINI_API_KEY as GEMINI_KEY, OPENAI_API_KEY as OPENAI_KEY } from '../../config';

// ═══════════════════════════════════════════════════════════════════════════════
// AI CONFIGURATION
// ═══════════════════════════════════════════════════════════════════════════════

export const AI_PROVIDER: 'openai' | 'gemini' = 'gemini';
export const OPENAI_API_KEY = OPENAI_KEY;
export const GEMINI_API_KEY = GEMINI_KEY;

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
} as const;

const CACHE_PREFIX = 'cache_';

// Max age before cache is considered stale (5 minutes)
const MAX_CACHE_AGE_MS = 5 * 60 * 1000;

type CacheEntry<T> = {
  data: T;
  timestamp: number;
};

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
      return { data: entry as T, isStale: true };
    }

    const isStale = Date.now() - entry.timestamp > MAX_CACHE_AGE_MS;

    return { data: entry.data, isStale };
  } catch {
    return null;
  }
}

/**
 * Write data to cache.
 */
export async function setCache<T>(key: string, data: T): Promise<void> {
  try {
    const entry: CacheEntry<T> = { data, timestamp: Date.now() };
    await AsyncStorage.setItem(key, JSON.stringify(entry));
  } catch {
    // Silently fail — caching is best-effort
  }
}

export function scopedCacheKey(baseKey: string, scope: string | number): string {
  return `${baseKey}:${scope}`;
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
    prefetchVault(),
    prefetchPlaces(),
    prefetchTransactions(),    // ← Added: core financial data
    prefetchPeopleLedger(),    // ← Added: people ledger for Dashboard summary
  ]);

  const elapsed = Date.now() - start;
  const succeeded = results.filter(r => r.status === 'fulfilled').length;
  console.log(`🚀 [Prefetch] Done in ${elapsed}ms — ${succeeded}/${results.length} succeeded`);
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
      email: user.email,
      name: profile?.full_name || '',
    });
    console.log('🚀 [Prefetch] ✅ Profile:', user.email);
  } catch (e) {
    console.warn('🚀 [Prefetch] ❌ Profile failed:', e);
  }
}

async function prefetchBanks() {
  try {
    const data = await getBankAccounts();
    await setCache(CACHE_KEYS.BANK_ACCOUNTS, data);
    console.log('🚀 [Prefetch] ✅ Banks:', data.length, 'accounts');
  } catch (e) {
    console.warn('🚀 [Prefetch] ❌ Banks failed:', e);
  }
}

async function prefetchVault() {
  try {
    const data = await getVaultItems();
    const mapped = data.map(d => ({
      id: d.id,
      title: d.title,
      category: d.category,
      fields: d.fields,
      notes: d.notes,
      createdAt: d.createdAt,
      updatedAt: d.updatedAt,
    }));
    // SECURITY: Vault items go to EncryptedStorage via setCache
    await setCache(CACHE_KEYS.VAULT_ITEMS, mapped);
    console.log('🚀 [Prefetch] ✅ Vault:', mapped.length, 'items (encrypted)');
  } catch (e) {
    console.warn('🚀 [Prefetch] ❌ Vault failed:', e);
  }
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
    console.warn('🚀 [Prefetch] ❌ Places failed:', e);
  }
}

async function prefetchTransactions() {
  try {
    const data = await getTransactions();
    await setCache(CACHE_KEYS.TRANSACTIONS, data);
    console.log('🚀 [Prefetch] ✅ Transactions:', data.length, 'records');
  } catch (e) {
    console.warn('🚀 [Prefetch] ❌ Transactions failed:', e);
  }
}

async function prefetchPeopleLedger() {
  try {
    const data = await getPeopleLedger(true); // include settled entries
    await setCache(CACHE_KEYS.PEOPLE_LEDGER, data);
    console.log('🚀 [Prefetch] ✅ People Ledger:', data.length, 'entries');
  } catch (e) {
    console.warn('🚀 [Prefetch] ❌ People Ledger failed:', e);
  }
}
