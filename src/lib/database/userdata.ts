/**
 * User Data Database Module
 * Consolidated: peopleLedger.ts + placesDb.ts
 * 
 * Handles user-specific data operations:
 * - People Ledger (lent/borrowed tracking, payments, settlements)
 * - Places (saved locations, photos, categories)
 */

import { supabase } from '../core';
import { PeopleLedger, PeopleLedgerPayment, Place } from '../../types';

// atob is available globally in React Native (Hermes), but TS doesn't know about it
declare function atob(data: string): string;

// ═══════════════════════════════════════════════════════════════════════════════
// PEOPLE LEDGER
// ═══════════════════════════════════════════════════════════════════════════════

export interface AddLedgerEntryData {
  person_name: string;
  type: 'lent' | 'borrowed';
  total_amount: number;
  repayment_type: 'one_time' | 'installment';
  due_date?: string;
  installment_amount?: number;
  installment_days?: string[];
  start_date?: string;
  notes?: string;
}

/**
 * Fetch all active (not settled) ledger entries for the current user
 */
export async function getPeopleLedger(includeSettled = false): Promise<PeopleLedger[]> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');

  let query = supabase
    .from('people_ledger')
    .select('*')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false });

  if (!includeSettled) {
    query = query.eq('is_settled', false);
  }

  const { data, error } = await query;

  if (error) throw error;
  return data || [];
}

/**
 * Get ledger entries by type
 */
export async function getLedgerByType(type: 'lent' | 'borrowed', includeSettled = false): Promise<PeopleLedger[]> {
  const entries = await getPeopleLedger(includeSettled);
  return entries.filter(entry => entry.type === type);
}

/**
 * Add a new ledger entry
 */
export async function addLedgerEntry(data: AddLedgerEntryData): Promise<PeopleLedger> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');

  const { data: ledger, error } = await supabase
    .from('people_ledger')
    .insert({
      user_id: user.id,
      ...data,
    })
    .select()
    .single();

  if (error) throw error;
  return ledger;
}

/**
 * Add a payment to a ledger entry
 */
export async function addPayment(
  ledgerId: string,
  amount: number,
  notes?: string,
  paidDate?: string
): Promise<PeopleLedgerPayment> {
  const { data: payment, error } = await supabase
    .from('people_ledger_payments')
    .insert({
      ledger_id: ledgerId,
      amount,
      notes,
      paid_date: paidDate || new Date().toISOString().split('T')[0],
    })
    .select()
    .single();

  if (error) throw error;
  return payment;
}

/**
 * Get all payments for a ledger entry
 */
export async function getPayments(ledgerId: string): Promise<PeopleLedgerPayment[]> {
  const { data, error } = await supabase
    .from('people_ledger_payments')
    .select('*')
    .eq('ledger_id', ledgerId)
    .order('paid_date', { ascending: false });

  if (error) throw error;
  return data || [];
}

/**
 * Mark a ledger entry as settled
 */
export async function markAsSettled(ledgerId: string): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');

  const { error } = await supabase
    .from('people_ledger')
    .update({ 
      is_settled: true,
      settled_at: new Date().toISOString()
    })
    .eq('id', ledgerId)
    .eq('user_id', user.id);

  if (error) throw error;
}

/**
 * Delete a ledger entry
 */
export async function deleteLedgerEntry(ledgerId: string): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');

  const { error } = await supabase
    .from('people_ledger')
    .delete()
    .eq('id', ledgerId)
    .eq('user_id', user.id);

  if (error) throw error;
}

/**
 * Calculate expected payment by today for installment type
 * Excludes Sundays or custom excluded days
 */
export function calculateExpectedByToday(entry: PeopleLedger): number {
  if (entry.repayment_type !== 'installment' || !entry.start_date || !entry.installment_amount) {
    return 0;
  }

  const startDate = new Date(entry.start_date);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  startDate.setHours(0, 0, 0, 0);

  if (today < startDate) {
    return 0;
  }

  const installmentDays = entry.installment_days || ['mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
  const dayMap: { [key: string]: number } = {
    sun: 0,
    mon: 1,
    tue: 2,
    wed: 3,
    thu: 4,
    fri: 5,
    sat: 6,
  };

  const includedDayNumbers = installmentDays.map(day => dayMap[day.toLowerCase()]);

  let count = 0;
  const currentDate = new Date(startDate);

  while (currentDate <= today) {
    const dayOfWeek = currentDate.getDay();
    if (includedDayNumbers.includes(dayOfWeek)) {
      count++;
    }
    currentDate.setDate(currentDate.getDate() + 1);
  }

  return count * entry.installment_amount;
}

/**
 * Get summary statistics
 */
export async function getLedgerSummary() {
  const entries = await getPeopleLedger(false);

  const lentEntries = entries.filter(e => e.type === 'lent');
  const borrowedEntries = entries.filter(e => e.type === 'borrowed');

  return {
    totalLent: lentEntries.reduce((sum, e) => sum + Number(e.remaining_amount), 0),
    totalBorrowed: borrowedEntries.reduce((sum, e) => sum + Number(e.remaining_amount), 0),
    lentCount: lentEntries.length,
    borrowedCount: borrowedEntries.length,
  };
}

/**
 * Check if entry is overdue
 */
export function isOverdue(entry: PeopleLedger): boolean {
  if (entry.is_settled || !entry.due_date) return false;

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const dueDate = new Date(entry.due_date);
  dueDate.setHours(0, 0, 0, 0);

  return today > dueDate && entry.remaining_amount > 0;
}

/**
 * Check if entry is due today
 */
export function isDueToday(entry: PeopleLedger): boolean {
  if (entry.is_settled || !entry.due_date) return false;

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const dueDate = new Date(entry.due_date);
  dueDate.setHours(0, 0, 0, 0);

  return today.getTime() === dueDate.getTime() && entry.remaining_amount > 0;
}

/**
 * Get days until due (negative if overdue)
 */
export function getDaysUntilDue(entry: PeopleLedger): number | null {
  if (!entry.due_date) return null;

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const dueDate = new Date(entry.due_date);
  dueDate.setHours(0, 0, 0, 0);

  const diffTime = dueDate.getTime() - today.getTime();
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

  return diffDays;
}

// ═══════════════════════════════════════════════════════════════════════════════
// PLACES
// ═══════════════════════════════════════════════════════════════════════════════

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
