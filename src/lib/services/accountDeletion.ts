import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '../core';
import {
  OFFLINE_DELETE_QUEUE_BASE_KEY,
  OFFLINE_TX_QUEUE_BASE_KEY,
  clearFinancialQueuesForUser,
} from './userScopedQueues';
import { GeofencingNative } from './geofencingNative';

export const PLACE_PHOTOS_BUCKET = 'place-photos';
export const AUTH_USER_DELETION_IMPLEMENTED = false;

export const ACCOUNT_DELETION_COPY = {
  confirmTitle: 'Delete App Data?',
  confirmMessage:
    'This permanently deletes your SpendSense app data and place photos, then signs you out. Your sign-in account is not deleted automatically. Contact support to remove the sign-in account. This cannot be undone.',
  confirmButton: 'Delete App Data',
  successTitle: 'App Data Deleted',
  successMessage:
    'Your SpendSense app data was deleted and you were signed out. Contact support to remove the remaining sign-in account.',
  failureTitle: 'Deletion Incomplete',
  failureMessage:
    'App data deletion did not finish. Some app data may already be deleted. Retry, or contact support before using this account again.',
  dangerButton: 'Delete App Data',
} as const;

export const ACCOUNT_DELETION_DIRECT_TABLES = [
  { table: 'income_review_decisions', filterColumn: 'user_id' },
  { table: 'transaction_evidence', filterColumn: 'user_id' },
  { table: 'transactions', filterColumn: 'user_id' },
  { table: 'account_app_mappings', filterColumn: 'user_id' },
  { table: 'credit_card_statements', filterColumn: 'user_id' },
  { table: 'balance_snapshots', filterColumn: 'user_id' },
  { table: 'detected_accounts', filterColumn: 'user_id' },
  { table: 'debit_cards', filterColumn: 'user_id' },
  { table: 'cc_transactions', filterColumn: 'user_id' },
  { table: 'emi_payments', filterColumn: 'user_id' },
  { table: 'people_ledger', filterColumn: 'user_id' },
  { table: 'places', filterColumn: 'user_id' },
  { table: 'vault_items', filterColumn: 'user_id' },
  { table: 'debt_freedom_settings', filterColumn: 'user_id' },
  { table: 'user_accounts', filterColumn: 'user_id' },
  { table: 'credit_cards', filterColumn: 'user_id' },
  { table: 'loans', filterColumn: 'user_id' },
  { table: 'bank_accounts', filterColumn: 'user_id' },
  { table: 'profiles', filterColumn: 'id' },
] as const;

export const ACCOUNT_DELETION_CASCADE_TABLES = [
  { table: 'people_ledger_payments', deletedWith: 'people_ledger' },
] as const;

export const ACCOUNT_DELETION_COVERED_TABLES = [
  ...ACCOUNT_DELETION_DIRECT_TABLES.map(step => step.table),
  ...ACCOUNT_DELETION_CASCADE_TABLES.map(step => step.table),
] as const;

export const ACCOUNT_DELETION_LOCAL_KEYS = [
  'app_user_id',
  'bank_auto_detection_result',
  'bank_auto_detection_date',
  'debug_bug_reports',
] as const;

const CACHE_PREFIX = 'cache_';
const STORAGE_PAGE_SIZE = 100;
const STORAGE_REMOVE_BATCH_SIZE = 100;
const LEGACY_QUEUE_BASE_KEYS = [
  OFFLINE_TX_QUEUE_BASE_KEY,
  OFFLINE_DELETE_QUEUE_BASE_KEY,

] as const;

export class AccountDataDeletionError extends Error {
  constructor(public readonly stage: string) {
    super('App data deletion did not finish.');
    this.name = 'AccountDataDeletionError';
  }
}

function isDeletionLocalKey(key: string): boolean {
  if (key.startsWith(CACHE_PREFIX)) return true;
  if ((ACCOUNT_DELETION_LOCAL_KEYS as readonly string[]).includes(key)) return true;

  return LEGACY_QUEUE_BASE_KEYS.some(baseKey => (
    key === baseKey || key.startsWith(`${baseKey}:legacy_quarantine:`)
  ));
}

export async function clearLocalAccountDataAfterDeletion(userId: string): Promise<void> {
  await clearFinancialQueuesForUser(userId);

  const keys = await AsyncStorage.getAllKeys();
  const keysToRemove = keys.filter(isDeletionLocalKey);
  if (keysToRemove.length > 0) {
    await AsyncStorage.multiRemove(keysToRemove);
  }
}

export async function deletePlacePhotosForUser(userId: string): Promise<void> {
  const storage = supabase.storage.from(PLACE_PHOTOS_BUCKET);
  const paths: string[] = [];
  let offset = 0;

  while (true) {
    const { data, error } = await storage.list(userId, {
      limit: STORAGE_PAGE_SIZE,
      offset,
    });
    if (error) throw new AccountDataDeletionError('storage-list');

    const photos = data || [];
    paths.push(...photos
      .filter(photo => Boolean(photo.name))
      .map(photo => `${userId}/${photo.name}`));

    if (photos.length < STORAGE_PAGE_SIZE) break;
    offset += photos.length;
  }

  for (let index = 0; index < paths.length; index += STORAGE_REMOVE_BATCH_SIZE) {
    const { error } = await storage.remove(paths.slice(index, index + STORAGE_REMOVE_BATCH_SIZE));
    if (error) throw new AccountDataDeletionError('storage-remove');
  }
}

export async function deleteCurrentUserAppData(): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new AccountDataDeletionError('session');

  await deletePlacePhotosForUser(user.id);

  for (const step of ACCOUNT_DELETION_DIRECT_TABLES) {
    const { error } = await supabase
      .from(step.table)
      .delete()
      .eq(step.filterColumn, user.id);

    if (error) throw new AccountDataDeletionError(`table:${step.table}`);
  }

  let localCleanupFailed = false;
  try {
    try {
      await GeofencingNative.clearGeofences();
    } catch (e) {
      console.warn('[AccountDeletion] Failed to clear geofences', e);
    }
    await clearLocalAccountDataAfterDeletion(user.id);
  } catch {
    localCleanupFailed = true;
  }

  const signOutResult = await supabase.auth.signOut();
  if (localCleanupFailed) throw new AccountDataDeletionError('local-cleanup');
  if (signOutResult?.error) throw new AccountDataDeletionError('sign-out');
}
