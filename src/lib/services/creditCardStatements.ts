import { supabase } from '../core';
import {
  BalanceConfidence,
  CreditCardStatement,
} from '../../types';
import {
  BalanceSourceMetadata,
  sanitizeBalanceSourceMetadata,
} from './balanceSnapshots';

export interface CreateOrUpdateCreditCardStatementInput {
  id?: string;
  credit_card_id: string;
  statement_date?: string | null;
  period_start?: string | null;
  period_end?: string | null;
  total_due?: number | null;
  minimum_due?: number | null;
  payment_due_date?: string | null;
  statement_balance?: number | null;
  source_snapshot_id?: string | null;
  status?: CreditCardStatement['status'];
  source?: CreditCardStatement['source'];
  confidence?: BalanceConfidence | null;
  raw_source_metadata?: BalanceSourceMetadata | null;
}

async function getCurrentUserId(): Promise<string> {
  try {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user?.id) throw new Error('Not authenticated');
  return user.id;

  } catch (err) {
    if (__DEV__) console.error('[API] creditCardStatements.ts:getCurrentUserId failed:', err);
    throw err;
  }}

async function assertCreditCardBelongsToUser(
  creditCardId: string,
  userId: string
): Promise<void> {
  try {
  const { data, error } = await supabase
    .from('credit_cards')
    .select('id')
    .eq('id', creditCardId)
    .eq('user_id', userId)
    .maybeSingle();

  if (error) throw error;
  if (!data?.id) throw new Error('Credit card statement card must belong to the current user');

  } catch (err) {
    if (__DEV__) console.error('[API] creditCardStatements.ts:assertCreditCardBelongsToUser failed:', err);
    throw err;
  }}

async function assertBalanceSnapshotBelongsToUser(
  sourceSnapshotId: string | null,
  userId: string
): Promise<void> {
  try {
  if (!sourceSnapshotId) return;

  const { data, error } = await supabase
    .from('balance_snapshots')
    .select('id')
    .eq('id', sourceSnapshotId)
    .eq('user_id', userId)
    .maybeSingle();

  if (error) throw error;
  if (!data?.id) throw new Error('Credit card statement snapshot must belong to the current user');

  } catch (err) {
    if (__DEV__) console.error('[API] creditCardStatements.ts:assertBalanceSnapshotBelongsToUser failed:', err);
    throw err;
  }}

function assertNonNegative(value: number | null | undefined, field: string) {
  if (value !== undefined && value !== null && value < 0) {
    throw new Error(`${field} must be non-negative`);
  }
}

export function buildCreditCardStatementPayload(
  userId: string,
  input: CreateOrUpdateCreditCardStatementInput
): Omit<CreditCardStatement, 'id' | 'created_at' | 'updated_at'> {
  assertNonNegative(input.total_due, 'total_due');
  assertNonNegative(input.minimum_due, 'minimum_due');
  assertNonNegative(input.statement_balance, 'statement_balance');

  return {
    user_id: userId,
    credit_card_id: input.credit_card_id,
    statement_date: input.statement_date || null,
    period_start: input.period_start || null,
    period_end: input.period_end || null,
    total_due: input.total_due ?? null,
    minimum_due: input.minimum_due ?? null,
    payment_due_date: input.payment_due_date || null,
    statement_balance: input.statement_balance ?? null,
    source_snapshot_id: input.source_snapshot_id || null,
    status: input.status || 'open',
    source: input.source || null,
    confidence: input.confidence || null,
    raw_source_metadata: sanitizeBalanceSourceMetadata(input.raw_source_metadata),
  };
}

export async function createOrUpdateCreditCardStatement(
  input: CreateOrUpdateCreditCardStatementInput
): Promise<CreditCardStatement> {
  try {
  const userId = await getCurrentUserId();
  const payload = buildCreditCardStatementPayload(userId, input);
  await assertCreditCardBelongsToUser(payload.credit_card_id, userId);
  await assertBalanceSnapshotBelongsToUser(payload.source_snapshot_id, userId);

  if (input.id) {
    const { data, error } = await supabase
      .from('credit_card_statements')
      .update({ ...payload, updated_at: new Date().toISOString() })
      .eq('id', input.id)
      .eq('user_id', userId)
      .select()
      .single();

    if (error) throw error;
    return data as CreditCardStatement;
  }

  const { data, error } = await supabase
    .from('credit_card_statements')
    .insert(payload)
    .select()
    .single();

  if (error) throw error;
  return data as CreditCardStatement;

  } catch (err) {
    if (__DEV__) console.error('[API] creditCardStatements.ts:createOrUpdateCreditCardStatement failed:', err);
    throw err;
  }}

export async function getCreditCardStatements(creditCardId: string): Promise<CreditCardStatement[]> {
  try {
  const userId = await getCurrentUserId();
  const { data, error } = await supabase
    .from('credit_card_statements')
    .select('*')
    .eq('user_id', userId)
    .eq('credit_card_id', creditCardId)
    .order('payment_due_date', { ascending: false });

  if (error) throw error;
  return (data || []) as CreditCardStatement[];

  } catch (err) {
    if (__DEV__) console.error('[API] creditCardStatements.ts:getCreditCardStatements failed:', err);
    throw err;
  }}
