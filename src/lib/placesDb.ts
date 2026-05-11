import { supabase } from './supabase';
import { Place } from '../types';

export async function getPlaces(): Promise<Place[]> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('User not authenticated');

  const { data, error } = await supabase
    .from('places')
    .select('*')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false });

  if (error) throw new Error(error.message);
  
  return (data || []).map(row => mapRowToPlace(row));
}

// Helper to map DB row to frontend Place type
function mapRowToPlace(row: any): Place {
  return {
    id: row.id,
    name: row.name,
    category: row.category,
    note: row.note,
    location: row.latitude && row.longitude ? {
      latitude: row.latitude,
      longitude: row.longitude,
      address: row.address || undefined,
    } : undefined,
    photo_uri: row.photo_uri || undefined,
    created_at: row.created_at,
  };
}

export async function addPlace(
  place: Omit<Place, 'id' | 'created_at'>
): Promise<Place> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('User not authenticated');

  const { data, error } = await supabase
    .from('places')
    .insert({
      user_id: user.id,
      name: place.name,
      category: place.category,
      note: place.note,
      latitude: place.location?.latitude ?? null,
      longitude: place.location?.longitude ?? null,
      address: place.location?.address ?? null,
      photo_uri: place.photo_uri ?? null,
    })
    .select()
    .single();

  if (error) throw new Error(error.message);
  return mapRowToPlace(data);
}

export async function updatePlace(
  id: string,
  updates: Partial<Omit<Place, 'id' | 'created_at'>>
): Promise<Place> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('User not authenticated');

  const updatePayload: any = {};
  if (updates.name !== undefined) updatePayload.name = updates.name;
  if (updates.category !== undefined) updatePayload.category = updates.category;
  if (updates.note !== undefined) updatePayload.note = updates.note;
  if (updates.location !== undefined) {
    updatePayload.latitude = updates.location?.latitude ?? null;
    updatePayload.longitude = updates.location?.longitude ?? null;
    updatePayload.address = updates.location?.address ?? null;
  }
  if (updates.photo_uri !== undefined) updatePayload.photo_uri = updates.photo_uri;

  const { data, error } = await supabase
    .from('places')
    .update(updatePayload)
    .eq('id', id)
    .eq('user_id', user.id)
    .select()
    .single();

  if (error) throw new Error(error.message);
  return mapRowToPlace(data);
}

export async function deletePlace(id: string): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('User not authenticated');

  const { error } = await supabase
    .from('places')
    .delete()
    .eq('id', id)
    .eq('user_id', user.id);

  if (error) throw new Error(error.message);
}
