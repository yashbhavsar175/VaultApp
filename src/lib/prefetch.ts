import { Image } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getBankAccounts } from './bankDb';
import { getVaultItems } from './vaultDb';
import { getPlaces } from './placesDb';
import { supabase } from './supabase';
import { setCache, CACHE_KEYS } from './dataCache';

/**
 * Prefetch all app data on startup (after login).
 * Each fetch runs independently — if one fails, others continue.
 * Cached data makes screens load instantly on first navigate.
 */
export async function prefetchAllData(): Promise<void> {
  console.log('🚀 [Prefetch] Starting background data prefetch...');
  const start = Date.now();

  const results = await Promise.allSettled([
    prefetchProfile(),
    prefetchBanks(),
    prefetchVault(),
    prefetchPlaces(),
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

    await AsyncStorage.setItem('cache_user_profile', JSON.stringify({
      email: user.email,
      name: profile?.full_name || '',
    }));
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
    await setCache(CACHE_KEYS.VAULT_ITEMS, mapped);
    console.log('🚀 [Prefetch] ✅ Vault:', mapped.length, 'items');
  } catch (e) {
    console.warn('🚀 [Prefetch] ❌ Vault failed:', e);
  }
}

async function prefetchPlaces() {
  try {
    const data = await getPlaces();
    await setCache(CACHE_KEYS.PLACES, data);
    console.log('🚀 [Prefetch] ✅ Places:', data.length, 'places');

    // Prefetch place photos into image cache
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
