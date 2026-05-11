import { supabase } from './supabase';
import { Place } from '../types';

// atob is available globally in React Native (Hermes), but TS doesn't know about it
declare function atob(data: string): string;

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

export async function uploadPlacePhoto(base64Data?: string, localUri?: string): Promise<string> {
  console.log('📸 [Upload] Starting photo upload, hasBase64:', !!base64Data, 'URI:', localUri);
  
  // If we have a remote URL already (editing an existing place), just return it
  if (localUri && !localUri.startsWith('file://') && !localUri.startsWith('content://')) {
    console.log('📸 [Upload] Already a remote URL, skipping upload');
    return localUri;
  }

  // Must have base64 data to upload
  if (!base64Data) {
    throw new Error('No photo data available for upload');
  }
  
  console.log('📸 [Upload] Step 1: Getting user...');
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('User not authenticated');
  console.log('📸 [Upload] Step 1 ✅ User ID:', user.id);

  const fileName = `${user.id}/${Date.now()}-${Math.random().toString(36).substring(7)}.jpg`;
  
  console.log('📸 [Upload] Step 2: Converting base64 to Uint8Array...');
  // Decode base64 to binary
  const binaryString = atob(base64Data);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  console.log('📸 [Upload] Step 2 ✅ Uint8Array size:', bytes.length);

  console.log('📸 [Upload] Step 3: Uploading to Supabase storage, fileName:', fileName);
  const { data, error } = await supabase.storage
    .from('place-photos')
    .upload(fileName, bytes, {
      contentType: 'image/jpeg',
    });
    
  if (error) {
    console.error('📸 [Upload] Step 3 ❌ Supabase upload error:', error.message, error);
    throw new Error(`Upload failed: ${error.message}`);
  }
  console.log('📸 [Upload] Step 3 ✅ Upload success, path:', data.path);
  
  // Get public URL
  const { data: publicData } = supabase.storage
    .from('place-photos')
    .getPublicUrl(data.path);
  
  console.log('📸 [Upload] Step 4 ✅ Public URL:', publicData.publicUrl);
  return publicData.publicUrl;
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
