import { supabase } from '../core';
import {
  decryptVaultFields,
  decryptVaultText,
  encryptVaultFields,
  encryptVaultText,
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

export async function getVaultItems(): Promise<VaultItemDB[]> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('User not authenticated');

  const { data, error } = await supabase
    .from('vault_items')
    .select('*')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false });

  if (error) throw new Error(error.message);
  
  // Decrypt all items
  const decryptedItems = await Promise.all((data || []).map(mapRow));
  return decryptedItems;
}

export async function addVaultItem(
  item: Omit<VaultItemDB, 'id' | 'createdAt' | 'updatedAt'>
): Promise<VaultItemDB> {
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
}

export async function updateVaultItem(
  id: string,
  updates: Partial<Omit<VaultItemDB, 'id' | 'createdAt' | 'updatedAt'>>
): Promise<VaultItemDB> {
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
}

export async function deleteVaultItem(id: string): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('User not authenticated');

  const { error } = await supabase
    .from('vault_items')
    .delete()
    .eq('id', id)
    .eq('user_id', user.id);

  if (error) throw new Error(error.message);
}
