import AsyncStorage from '@react-native-async-storage/async-storage';

const CACHE_KEYS = {
  TRANSACTIONS: 'cache_transactions',
  PEOPLE_LEDGER: 'cache_people_ledger',
  PLACES: 'cache_places',
  VAULT_ITEMS: 'cache_vault_items',
  BANK_ACCOUNTS: 'cache_bank_accounts',
} as const;

// Max age before cache is considered too stale (5 minutes)
const MAX_CACHE_AGE_MS = 5 * 60 * 1000;

type CacheEntry<T> = {
  data: T;
  timestamp: number;
};

export async function getCached<T>(key: string): Promise<T | null> {
  try {
    const raw = await AsyncStorage.getItem(key);
    if (!raw) return null;
    
    const entry: CacheEntry<T> = JSON.parse(raw);
    
    // Return cached data even if stale — caller will refresh in background
    return entry.data;
  } catch {
    return null;
  }
}

export async function setCache<T>(key: string, data: T): Promise<void> {
  try {
    const entry: CacheEntry<T> = {
      data,
      timestamp: Date.now(),
    };
    await AsyncStorage.setItem(key, JSON.stringify(entry));
  } catch {
    // Silently fail — caching is best-effort
  }
}

export async function clearCache(): Promise<void> {
  try {
    await Promise.all(
      Object.values(CACHE_KEYS).map(key => AsyncStorage.removeItem(key))
    );
  } catch {
    // Silently fail
  }
}

export { CACHE_KEYS };
