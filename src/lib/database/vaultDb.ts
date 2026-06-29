import { supabase } from '../core';
import {
  decryptField,
  decryptVaultFields,
  decryptVaultText,
  encryptVaultFields,
  encryptVaultText,
  needsReEncryption,
  reEncryptFieldWithCurrentKey,
} from '../../utils/encryption';

/**
 * Vault Items — Cloud-First Persistence (Supabase) with Client-Side Encryption
 * 
 * SECURITY: Secret fields (isSecret: true) and new notes are encrypted
 * client-side before storing in Supabase using AES-256-CBC encryption.
 * 
 * SQL to run in Supabase SQL Editor:
 * 
 * CREATE TABLE vault_items (
 *   id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
 *   user_id uuid REFERENCES auth.users NOT NULL,
 *   title text NOT NULL,
 *   category text NOT NULL,
 *   fields jsonb NOT NULL DEFAULT '[]'::jsonb,
 *   notes text DEFAULT '',
 *   created_at timestamptz DEFAULT now(),
 *   updated_at timestamptz DEFAULT now()
 * );
 * 
 * ALTER TABLE vault_items ENABLE ROW LEVEL SECURITY;
 * 
 * CREATE POLICY "Users can manage their own vault items"
 *   ON vault_items FOR ALL
 *   USING (auth.uid() = user_id)
 *   WITH CHECK (auth.uid() = user_id);
 */

export interface VaultItemDB {
  id: string;
  title: string;
  category: string;
  fields: { label: string; value: string; isSecret: boolean }[];
  notes: string;
  createdAt: string;
  updatedAt: string;
}

// Map DB row → frontend VaultItem (with decryption)
async function mapRow(row: any): Promise<VaultItemDB> {
  const fields = typeof row.fields === 'string' ? JSON.parse(row.fields) : row.fields;
  
  // Decryption uses the authenticated user's derived AES key; plaintext stays client-side.
  const decryptedFields = await decryptVaultFields(fields);
  const decryptedNotes = await decryptVaultText(row.notes || '');
  
  return {
    id: row.id,
    title: row.title,
    category: row.category,
    fields: decryptedFields,
    notes: decryptedNotes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// C3 migration: re-encrypt vault fields that are still protected by the weak legacy
// PBKDF2 key (5 000 iterations). Runs on raw DB rows so the new format is persisted
// to Supabase — subsequent loads skip the legacy decrypt path entirely.
async function migrateVaultItemsToCurrentKey(rawRows: any[], userId: string): Promise<void> {
  for (const row of rawRows) {
    const fields: { label: string; value: string; isSecret: boolean }[] =
      typeof row.fields === 'string' ? JSON.parse(row.fields) : (row.fields ?? []);

    const hasLegacyFields = fields.some(f => f.isSecret && needsReEncryption(f.value));
    if (!hasLegacyFields) continue;

    const migratedFields = await Promise.all(
      fields.map(async (field) => {
        if (!field.isSecret || !needsReEncryption(field.value)) return field;
        try {
          // decryptField handles legacy PBKDF2 key internally via its fallback path
          const plaintext = await decryptField(field.value);
          const reEncrypted = await reEncryptFieldWithCurrentKey(plaintext);
          return { ...field, value: reEncrypted };
        } catch {
          return field; // don't block migration of other fields on a single failure
        }
      })
    );

    const { error } = await supabase
      .from('vault_items')
      .update({ fields: migratedFields, updated_at: new Date().toISOString() })
      .eq('id', row.id)
      .eq('user_id', userId); // ✅ ownership filter on every write

    if (error && __DEV__) {
      console.warn('[VaultDb] Migration persist failed for item:', {
        itemId: row.id,
        error: error.message,
      });
    }
  }
}

export async function getVaultItems(): Promise<VaultItemDB[]> {
  try {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('User not authenticated');

  const { data, error } = await supabase
    .from('vault_items')
    .select('id, user_id, title, category, fields, notes, created_at, updated_at')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false });

  if (error) throw new Error(error.message);

  const rows = data || [];

  // Fire-and-forget: re-encrypt any legacy-key fields in the background.
  // Never blocks the UI — the first load still shows decrypted values via mapRow's
  // existing legacy fallback. On the next load, all fields will be vault:v2: format.
  migrateVaultItemsToCurrentKey(rows, user.id).catch(e => {
    if (__DEV__) {
      console.warn('[VaultDb] Background key migration failed (non-fatal):', {
        error: e instanceof Error ? e.message : String(e),
      });
    }
  });

  const decryptedItems = await Promise.all(rows.map(mapRow));
  return decryptedItems;

  } catch (err) {
    if (__DEV__) console.error('[API] vaultDb.ts:getVaultItems failed:', err);
    throw err;
  }}

export async function addVaultItem(
  item: Omit<VaultItemDB, 'id' | 'createdAt' | 'updatedAt'>
): Promise<VaultItemDB> {
  try {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('User not authenticated');

  // Encryption uses the authenticated user's derived AES key before any Supabase write.
  const encryptedFields = await encryptVaultFields(item.fields);
  const encryptedNotes = await encryptVaultText(item.notes);

  const { data, error } = await supabase
    .from('vault_items')
    .insert({
      user_id: user.id,
      title: item.title,
      category: item.category,
      fields: encryptedFields,
      notes: encryptedNotes,
    })
    .select()
    .single();

  if (error) throw new Error(error.message);
  return await mapRow(data);

  } catch (err) {
    if (__DEV__) console.error('[API] vaultDb.ts:addVaultItem failed:', err);
    throw err;
  }}

export async function updateVaultItem(
  id: string,
  updates: Partial<Omit<VaultItemDB, 'id' | 'createdAt' | 'updatedAt'>>
): Promise<VaultItemDB> {
  try {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('User not authenticated');

  const updatePayload: any = { updated_at: new Date().toISOString() };
  if (updates.title !== undefined) updatePayload.title = updates.title;
  if (updates.category !== undefined) updatePayload.category = updates.category;
  if (updates.notes !== undefined) {
    // Encryption uses the authenticated user's derived AES key before any Supabase write.
    updatePayload.notes = await encryptVaultText(updates.notes);
  }
  
  if (updates.fields !== undefined) {
    // Encryption uses the authenticated user's derived AES key before any Supabase write.
    updatePayload.fields = await encryptVaultFields(updates.fields);
  }

  const { data, error } = await supabase
    .from('vault_items')
    .update(updatePayload)
    .eq('id', id)
    .eq('user_id', user.id)
    .select()
    .single();

  if (error) throw new Error(error.message);
  return await mapRow(data);

  } catch (err) {
    if (__DEV__) console.error('[API] vaultDb.ts:updateVaultItem failed:', err);
    throw err;
  }}

export async function deleteVaultItem(id: string): Promise<void> {
  try {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('User not authenticated');

  const { error } = await supabase
    .from('vault_items')
    .delete()
    .eq('id', id)
    .eq('user_id', user.id);

  if (error) throw new Error(error.message);

  } catch (err) {
    if (__DEV__) console.error('[API] vaultDb.ts:deleteVaultItem failed:', err);
    throw err;
  }}
