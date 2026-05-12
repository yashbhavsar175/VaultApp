import { supabase } from './core';

/**
 * Vault Items — Cloud-First Persistence (Supabase)
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

// Map DB row → frontend VaultItem
function mapRow(row: any): VaultItemDB {
  return {
    id: row.id,
    title: row.title,
    category: row.category,
    fields: typeof row.fields === 'string' ? JSON.parse(row.fields) : row.fields,
    notes: row.notes || '',
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
  return (data || []).map(mapRow);
}

export async function addVaultItem(
  item: Omit<VaultItemDB, 'id' | 'createdAt' | 'updatedAt'>
): Promise<VaultItemDB> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('User not authenticated');

  const { data, error } = await supabase
    .from('vault_items')
    .insert({
      user_id: user.id,
      title: item.title,
      category: item.category,
      fields: item.fields,
      notes: item.notes,
    })
    .select()
    .single();

  if (error) throw new Error(error.message);
  return mapRow(data);
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
  if (updates.fields !== undefined) updatePayload.fields = updates.fields;
  if (updates.notes !== undefined) updatePayload.notes = updates.notes;

  const { data, error } = await supabase
    .from('vault_items')
    .update(updatePayload)
    .eq('id', id)
    .eq('user_id', user.id)
    .select()
    .single();

  if (error) throw new Error(error.message);
  return mapRow(data);
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
