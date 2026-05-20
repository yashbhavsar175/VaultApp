/**
 * Encryption Utility for Vault Items
 * Uses AES-256-CBC encryption for sensitive data
 * 
 * IMPORTANT: This provides client-side encryption before storing in Supabase.
 * The encryption key is derived from the user's session.
 */

import Aes from 'react-native-aes-crypto';
import { supabase } from '../lib/core';

// Generate a deterministic key from user ID
// NOTE: In production, consider using a user-provided master password
// or device-specific secure storage for better security
async function getDerivedKey(): Promise<string> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('User not authenticated');
  
  // Use user ID as base for key derivation
  // In production, combine with device-specific data or user password
  const baseKey = user.id;
  
  // Generate a 256-bit key using PBKDF2
  const key = await Aes.pbkdf2(baseKey, 'vault-salt-v1', 5000, 256, 'sha256');
  return key;
}

/**
 * Encrypt sensitive field value
 */
export async function encryptField(value: string): Promise<string> {
  if (!value) return value;
  
  try {
    const key = await getDerivedKey();
    const iv = await Aes.randomKey(16); // 128-bit IV for AES
    
    const encrypted = await Aes.encrypt(value, key, iv, 'aes-256-cbc');
    
    // Store IV with encrypted data (IV:encrypted)
    return `${iv}:${encrypted}`;
  } catch (error) {
    console.error('Encryption error:', error);
    throw new Error('Failed to encrypt field');
  }
}

/**
 * Decrypt sensitive field value
 */
export async function decryptField(encryptedValue: string): Promise<string> {
  if (!encryptedValue) return encryptedValue;
  
  try {
    // Check if value is encrypted (contains IV separator)
    if (!encryptedValue.includes(':')) {
      // Not encrypted, return as-is (backward compatibility)
      return encryptedValue;
    }
    
    const [iv, encrypted] = encryptedValue.split(':');
    const key = await getDerivedKey();
    
    const decrypted = await Aes.decrypt(encrypted, key, iv, 'aes-256-cbc');
    return decrypted;
  } catch (error) {
    console.error('Decryption error:', error);
    // Return masked value on error to prevent data loss
    return '••••••••';
  }
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
