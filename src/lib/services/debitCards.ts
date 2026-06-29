import { supabase } from '../core';
import { BalanceConfidence, DebitCard } from '../../types';
import { normalizeLast4 } from './balanceSnapshots';

export interface CreateOrUpdateDebitCardInput {
  bank_account_id?: string | null;
  bank_name?: string | null;
  card_last4: string;
  card_network?: string | null;
  card_label?: string | null;
  status?: DebitCard['status'];
  detected_confidence?: BalanceConfidence;
  source_sender_or_package?: string | null;
  last_seen_at?: string | null;
}

async function getCurrentUserId(): Promise<string> {
  try {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user?.id) throw new Error('Not authenticated');
  return user.id;

  } catch (err) {
    if (__DEV__) console.error('[API] debitCards.ts:getCurrentUserId failed:', err);
    throw err;
  }}

async function assertBankAccountBelongsToUser(
  bankAccountId: string | null,
  userId: string
): Promise<void> {
  try {
  if (!bankAccountId) return;

  const { data, error } = await supabase
    .from('bank_accounts')
    .select('id')
    .eq('id', bankAccountId)
    .eq('user_id', userId)
    .maybeSingle();

  if (error) throw error;
  if (!data?.id) throw new Error('Debit card bank account must belong to the current user');

  } catch (err) {
    if (__DEV__) console.error('[API] debitCards.ts:assertBankAccountBelongsToUser failed:', err);
    throw err;
  }}

function buildDebitCardPayload(userId: string, input: CreateOrUpdateDebitCardInput) {
  const cardLast4 = normalizeLast4(input.card_last4);
  if (!cardLast4 || cardLast4.length !== 4) {
    throw new Error('Debit card last4 must be exactly four digits');
  }

  return {
    user_id: userId,
    bank_account_id: input.bank_account_id || null,
    bank_name: input.bank_name?.trim() || null,
    card_last4: cardLast4,
    card_network: input.card_network?.trim() || null,
    card_label: input.card_label?.trim() || null,
    status: input.status || 'active',
    detected_confidence: input.detected_confidence || 'low',
    source_sender_or_package: input.source_sender_or_package?.trim() || null,
    last_seen_at: input.last_seen_at || null,
    updated_at: new Date().toISOString(),
  };
}

export async function createOrUpdateDebitCard(
  input: CreateOrUpdateDebitCardInput
): Promise<DebitCard> {
  try {
  const userId = await getCurrentUserId();
  const payload = buildDebitCardPayload(userId, input);
  await assertBankAccountBelongsToUser(payload.bank_account_id, userId);

  // Only existing?.id is accessed — narrow to the single field actually needed.
  let existingQuery = supabase
    .from('debit_cards')
    .select('id')
    .eq('user_id', userId)
    .eq('card_last4', payload.card_last4);

  existingQuery = payload.bank_account_id
    ? existingQuery.eq('bank_account_id', payload.bank_account_id)
    : existingQuery.is('bank_account_id', null);

  const { data: existing, error: selectError } = await existingQuery.limit(1).maybeSingle();
  if (selectError) throw selectError;

  if (existing?.id) {
    const { data, error } = await supabase
      .from('debit_cards')
      .update(payload)
      .eq('id', existing.id)
      .eq('user_id', userId)
      .select()
      .single();

    if (error) throw error;
    return data as DebitCard;
  }

  const { data, error } = await supabase
    .from('debit_cards')
    .insert(payload)
    .select()
    .single();

  if (error) throw error;
  return data as DebitCard;

  } catch (err) {
    if (__DEV__) console.error('[API] debitCards.ts:createOrUpdateDebitCard failed:', err);
    throw err;
  }}

export async function getDebitCardsForBankAccount(bankAccountId: string): Promise<DebitCard[]> {
  try {
  const userId = await getCurrentUserId();
  const { data, error } = await supabase
    .from('debit_cards')
    .select('id, user_id, bank_account_id, bank_name, card_last4, card_network, card_label, status, detected_confidence, source_sender_or_package, last_seen_at, created_at, updated_at')
    .eq('user_id', userId)
    .eq('bank_account_id', bankAccountId)
    .order('created_at', { ascending: true });

  if (error) throw error;
  return (data || []) as DebitCard[];

  } catch (err) {
    if (__DEV__) console.error('[API] debitCards.ts:getDebitCardsForBankAccount failed:', err);
    throw err;
  }}

export async function getDebitCards(): Promise<DebitCard[]> {
  try {
  const userId = await getCurrentUserId();
  const { data, error } = await supabase
    .from('debit_cards')
    .select('id, user_id, bank_account_id, bank_name, card_last4, card_network, card_label, status, detected_confidence, source_sender_or_package, last_seen_at, created_at, updated_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: true });

  if (error) throw error;
  return (data || []) as DebitCard[];

  } catch (err) {
    if (__DEV__) console.error('[API] debitCards.ts:getDebitCards failed:', err);
    throw err;
  }}
