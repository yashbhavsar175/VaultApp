import { supabase } from '../core';
import {
  BalanceConfidence,
  BalanceKind,
  BalanceOwnerType,
  DetectedAccount,
} from '../../types';
import {
  BalanceSourceMetadata,
  normalizeLast4,
  sanitizeBalanceSourceMetadata,
} from './balanceSnapshots';

export interface CreateDetectedAccountCandidateInput {
  detection_type: DetectedAccount['detection_type'];
  detected_bank_name?: string | null;
  account_last4?: string | null;
  card_last4?: string | null;
  account_type_hint?: string | null;
  balance_amount?: number | null;
  balance_kind?: BalanceKind | null;
  source: DetectedAccount['source'];
  confidence: BalanceConfidence;
  source_sender_or_package?: string | null;
  raw_source_metadata?: BalanceSourceMetadata | null;
}

async function getCurrentUserId(): Promise<string> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user?.id) throw new Error('Not authenticated');
  return user.id;
}

export function buildDetectedAccountInsert(
  userId: string,
  input: CreateDetectedAccountCandidateInput
): Omit<DetectedAccount, 'id' | 'created_at' | 'updated_at' | 'first_seen_at' | 'last_seen_at'> {
  if (input.balance_amount !== undefined && input.balance_amount !== null && input.balance_amount < 0) {
    throw new Error('Detected balance amount must be non-negative');
  }

  return {
    user_id: userId,
    detection_type: input.detection_type,
    detected_bank_name: input.detected_bank_name?.trim() || null,
    account_last4: normalizeLast4(input.account_last4),
    card_last4: normalizeLast4(input.card_last4),
    account_type_hint: input.account_type_hint?.trim() || null,
    balance_amount: input.balance_amount ?? null,
    balance_kind: input.balance_kind || null,
    source: input.source,
    confidence: input.confidence,
    status: 'pending',
    matched_owner_type: null,
    matched_owner_id: null,
    source_sender_or_package: input.source_sender_or_package?.trim() || null,
    raw_source_metadata: sanitizeBalanceSourceMetadata(input.raw_source_metadata),
  };
}

export async function createDetectedAccountCandidate(
  input: CreateDetectedAccountCandidateInput
): Promise<DetectedAccount> {
  const userId = await getCurrentUserId();
  const payload = buildDetectedAccountInsert(userId, input);

  const { data, error } = await supabase
    .from('detected_accounts')
    .insert(payload)
    .select()
    .single();

  if (error) throw error;
  return data as DetectedAccount;
}

export async function getPendingDetectedAccounts(): Promise<DetectedAccount[]> {
  const userId = await getCurrentUserId();
  const { data, error } = await supabase
    .from('detected_accounts')
    .select('*')
    .eq('user_id', userId)
    .eq('status', 'pending')
    .order('last_seen_at', { ascending: false });

  if (error) throw error;
  return (data || []) as DetectedAccount[];
}

export async function markDetectedAccountIgnored(id: string): Promise<DetectedAccount> {
  const userId = await getCurrentUserId();
  const { data, error } = await supabase
    .from('detected_accounts')
    .update({ status: 'ignored', updated_at: new Date().toISOString() })
    .eq('id', id)
    .eq('user_id', userId)
    .select()
    .single();

  if (error) throw error;
  return data as DetectedAccount;
}

export async function markDetectedAccountConfirmed(
  id: string,
  ownerType: BalanceOwnerType,
  ownerId: string
): Promise<DetectedAccount> {
  const userId = await getCurrentUserId();
  const { data, error } = await supabase
    .from('detected_accounts')
    .update({
      status: 'confirmed',
      matched_owner_type: ownerType,
      matched_owner_id: ownerId,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
    .eq('user_id', userId)
    .select()
    .single();

  if (error) throw error;
  return data as DetectedAccount;
}
