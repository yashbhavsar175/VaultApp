/**
 * Encryption Utility for Vault Items
 * Uses AES-256-CBC encryption for sensitive data
 * 
 * IMPORTANT: This provides client-side encryption before storing in Supabase.
 * The encryption key is derived from the user's session.
 */

import Aes from 'react-native-aes-crypto';
import EncryptedStorage from 'react-native-encrypted-storage';
import { supabase } from '../lib/core';

const VAULT_TEXT_ENCRYPTION_PREFIX = 'vault:v1:';
const VAULT_DATA_KEY_PREFIX = 'vault:data-key:v2:';

// Version prefix written to every field value encrypted with the current random per-user key.
// Legacy (PBKDF2) values have no prefix — they are plain 'iv:ciphertext'.
// This distinction makes needsReEncryption() reliable and prevents infinite re-encryption loops.
const VAULT_FIELD_CURRENT_PREFIX = 'vault:v2:';

async function getAuthenticatedUserId(): Promise<string> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('User not authenticated');
  return user.id;
}

export function getVaultDataKeyStorageKey(userId: string): string {
  return `${VAULT_DATA_KEY_PREFIX}${userId}`;
}

export async function removeVaultDataKeyForUser(userId: string): Promise<void> {
  await EncryptedStorage.removeItem(getVaultDataKeyStorageKey(userId));
}

async function getOrCreateVaultDataKey(): Promise<string> {
  const userId = await getAuthenticatedUserId();
  const storageKey = getVaultDataKeyStorageKey(userId);
  const existing = await EncryptedStorage.getItem(storageKey);
  if (typeof existing === 'string' && existing.length >= 32) {
    return existing;
  }

  const key = await Aes.randomKey(32);
  await EncryptedStorage.setItem(storageKey, key);
  return key;
}

// Bug #C3 fix: named constants for PBKDF2 iteration counts.
// PBKDF2_ITERATIONS_LEGACY is FROZEN at 5 000 — DO NOT change it.
// Existing vault rows were encrypted with exactly this count; bumping it makes them unreadable.
// New data always uses the random per-user key from getOrCreateVaultDataKey() (no PBKDF2 needed).
const PBKDF2_ITERATIONS_LEGACY = 5_000;

// Legacy deterministic key retained only for decrypting rows encrypted before
// per-user random vault data keys were introduced.
async function getLegacyDerivedKey(): Promise<string> {
  const baseKey = await getAuthenticatedUserId();
  const key = await Aes.pbkdf2(baseKey, 'vault-salt-v1', PBKDF2_ITERATIONS_LEGACY, 256, 'sha256');
  return key;
}

/**
 * Re-encrypt a plaintext value with the current random per-user key.
 * Call this after a successful legacy-key decryption, then save the result
 * back to Supabase so the field is no longer protected by the weak legacy key.
 */
export async function reEncryptFieldWithCurrentKey(plaintext: string): Promise<string> {
  return encryptField(plaintext);
}

// Bug #7 fix: shared helper — split validate karo taaki undefined values AES mein na jaayen
// Export nahi — sirf is file ke andar use hoti hai
function parseEncryptedValue(encryptedValue: string): { iv: string; encrypted: string } {
  const parts = encryptedValue.split(':');
  if (parts.length !== 2) {
    throw new Error(
      `[Encryption] Invalid format: expected 'iv:ciphertext', got ${parts.length} parts`
    );
  }
  const [iv, encrypted] = parts;
  if (!iv || !encrypted) {
    throw new Error('[Encryption] Invalid format: IV or ciphertext is empty');
  }
  return { iv, encrypted };
}

function summarizeCryptoError(error: unknown) {
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

/**
 * Check whether a field value needs re-encryption to the current key.
 * Returns true for legacy 'iv:ciphertext' values (no version prefix).
 * Returns false for already-migrated 'vault:v2:iv:ciphertext' values.
 */
export function needsReEncryption(value: string | null | undefined): boolean {
  if (!value || !value.includes(':')) return false;
  // vault:v1: is the notes/text prefix — handled separately by encryptVaultText
  if (value.startsWith(VAULT_TEXT_ENCRYPTION_PREFIX)) return false;
  // vault:v2: is the current field prefix — already on the strong key
  if (value.startsWith(VAULT_FIELD_CURRENT_PREFIX)) return false;
  // Anything else with ':' is legacy 'iv:ciphertext' — needs migration
  return true;
}

/**
 * Encrypt sensitive field value.
 * Output format: 'vault:v2:iv:ciphertext' — the prefix distinguishes these values
 * from legacy 'iv:ciphertext' (PBKDF2 5k-iter key) so needsReEncryption() is reliable.
 */
export async function encryptField(value: string): Promise<string> {
  if (!value) return value;

  try {
    const key = await getOrCreateVaultDataKey();
    const iv = await Aes.randomKey(16); // 128-bit IV for AES

    const encrypted = await Aes.encrypt(value, key, iv, 'aes-256-cbc');

    return `${VAULT_FIELD_CURRENT_PREFIX}${iv}:${encrypted}`;
  } catch (error) {
    console.error('Encryption error:', summarizeCryptoError(error));
    throw new Error('Failed to encrypt field');
  }
}

/**
 * Decrypt sensitive field value.
 * Handles three formats:
 *   'vault:v2:iv:ciphertext' — current random per-user key, no legacy fallback
 *   'iv:ciphertext'          — legacy format (tries random key first, then PBKDF2 fallback)
 *   'plaintext'              — unencrypted (backward compat)
 */
export async function decryptField(encryptedValue: string): Promise<string> {
  if (!encryptedValue) return encryptedValue;

  // Current-key fast path: 'vault:v2:iv:ciphertext'
  // No legacy fallback — this was definitely encrypted with the random per-user key.
  if (encryptedValue.startsWith(VAULT_FIELD_CURRENT_PREFIX)) {
    const raw = encryptedValue.slice(VAULT_FIELD_CURRENT_PREFIX.length);
    const { iv, encrypted } = parseEncryptedValue(raw);
    const key = await getOrCreateVaultDataKey();
    return await Aes.decrypt(encrypted, key, iv, 'aes-256-cbc');
  }

  try {
    // Not encrypted — backward compatibility ke liye as-is return karo
    if (!encryptedValue.includes(':')) {
      return encryptedValue;
    }

    // Bug #7 fix: pehle raw split hota tha bina validation — encrypted undefined hota agar format galat tha
    const { iv, encrypted } = parseEncryptedValue(encryptedValue);
    const key = await getOrCreateVaultDataKey();
    return await Aes.decrypt(encrypted, key, iv, 'aes-256-cbc');

  } catch (primaryError) {
    console.warn('[Encryption] Primary key decryption failed, trying legacy key:', {
      error: primaryError instanceof Error ? primaryError.message : String(primaryError),
    });

    try {
      // Bug #7 fix (legacy path): same validated helper — duplicate raw split hata diya
      const { iv, encrypted } = parseEncryptedValue(encryptedValue);
      const legacyKey = await getLegacyDerivedKey();
      const legacyDecrypted = await Aes.decrypt(encrypted, legacyKey, iv, 'aes-256-cbc');

      // Bug #C3 fix: console.log → console.warn (visible in production monitoring)
      // Fire-and-forget: caller should call reEncryptFieldWithCurrentKey(result) and save
      // the new encrypted value so this field is no longer protected by the weak legacy key.
      console.warn('[Encryption] Legacy key decryption succeeded — field should be re-encrypted', {
        hint: 'Call reEncryptFieldWithCurrentKey(plaintext) and persist the result to Supabase.',
      });
      return legacyDecrypted;

    } catch (legacyError) {
      // Bug #8 fix: pehle '••••••••' silently return hota tha — user ko pata nahi chalta data corrupt tha
      // Financial app mein masked value = silent data corruption = serious trust issue
      console.error('[Encryption] Both primary and legacy decryption failed:', {
        primaryError: primaryError instanceof Error ? primaryError.message : String(primaryError),
        legacyError: legacyError instanceof Error ? legacyError.message : String(legacyError),
        hint: summarizeCryptoError(legacyError),
      });
      throw new Error('[Encryption] Decryption failed: data may be corrupted or key mismatch');
    }
  }
}

/**
 * Emergency Vault text encryption for fields like notes.
 */
export async function encryptVaultText(value: string): Promise<string> {
  if (!value) return value;
  if (value.startsWith(VAULT_TEXT_ENCRYPTION_PREFIX)) return value;

  return `${VAULT_TEXT_ENCRYPTION_PREFIX}${await encryptField(value)}`;
}

export async function decryptVaultText(value: string): Promise<string> {
  if (!value) return value;
  if (!value.startsWith(VAULT_TEXT_ENCRYPTION_PREFIX)) {
    return value;
  }

  return decryptField(value.slice(VAULT_TEXT_ENCRYPTION_PREFIX.length));
}

/**
 * Encrypt all secret fields in vault item
 */
export async function encryptVaultFields(
  fields: { label: string; value: string; isSecret: boolean }[]
): Promise<{ label: string; value: string; isSecret: boolean }[]> {
  const encryptedFields = await Promise.all(
    fields.map(async (field) => {
      if (field.isSecret && field.value) {
        return {
          ...field,
          value: await encryptField(field.value),
        };
      }
      return field;
    })
  );
  
  return encryptedFields;
}

/**
 * Decrypt all secret fields in vault item
 */
export async function decryptVaultFields(
  fields: { label: string; value: string; isSecret: boolean }[]
): Promise<{ label: string; value: string; isSecret: boolean }[]> {
  const decryptedFields = await Promise.all(
    fields.map(async (field) => {
      if (field.isSecret && field.value) {
        return {
          ...field,
          value: await decryptField(field.value),
        };
      }
      return field;
    })
  );
  
  return decryptedFields;
}
