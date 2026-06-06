import { BankAccount } from '../../types';
import { supabase } from '../core';
import { emitFinanceDataChanged } from './dataEvents';
import { recordEstimatedBankBalanceMovementForUser } from './balanceSignalRecorder';
import {
  createOrUpdateAccountAppMapping,
} from './transactionEvidence';

const PAYMENT_APP_LABELS: Record<string, string> = {
  'money.super.app': 'Super.money',
  'money.super.payments': 'Super.money',
  'tech.ula': 'Slice',
  'indwin.c3.shareapp': 'Slice',
  'com.google.android.apps.nbu.paisa.user': 'GPay',
  'com.phonepe.app': 'PhonePe',
  'net.one97.paytm': 'Paytm',
};

export interface PaymentAppBankHint {
  sourcePackage: string;
  sourceLabel: string;
  bankHint: string;
  bankHintLabel: string;
  bankHintHash: string;
}

export interface PaymentAppBankAccountMatch extends PaymentAppBankHint {
  mappingStatus: 'needs_review' | 'system_matched' | 'user_confirmed';
  mappedBankAccountId?: string;
  mappedBankAccountLast4?: string;
  mappedBankName?: string;
}

function stableHash(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function safePackage(value?: string | null): string | null {
  const normalized = value?.trim().toLowerCase();
  if (!normalized || !/^[a-z0-9._-]{2,96}$/.test(normalized)) return null;
  return normalized;
}

function safeHint(value?: string | null): string | null {
  const normalized = value?.trim().toLowerCase();
  if (!normalized || !/^[a-z][a-z0-9._-]{1,31}$/.test(normalized)) return null;
  return normalized;
}

function displayToken(value: string): string {
  return value
    .split(/[._-]+/)
    .filter(Boolean)
    .map(part => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(' ');
}

function safeLabel(value?: string | null, fallback = 'Payment app'): string {
  const sanitized = (value || '')
    .replace(/[^A-Za-z0-9 ._-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 64);
  return sanitized && !/\d{6,}/.test(sanitized) ? sanitized : fallback;
}

function appLabel(sourcePackage: string, explicit?: string | null): string {
  return PAYMENT_APP_LABELS[sourcePackage] ||
    safeLabel(explicit, displayToken(sourcePackage.split('.')[0]));
}

function safeLast4(value?: string | null): string | undefined {
  const digits = (value || '').replace(/\D/g, '');
  return digits.length === 4 ? digits : undefined;
}

function normalizedBankToken(value?: string | null): string {
  return (value || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function bankNameMatchesHint(account: BankAccount, bankHint: string): boolean {
  const accountToken = normalizedBankToken(account.bank_name);
  const hintToken = normalizedBankToken(bankHint);
  return Boolean(accountToken && hintToken && (
    accountToken === hintToken ||
    accountToken.includes(hintToken) ||
    hintToken.includes(accountToken)
  ));
}

export function bankHintHash(bankHint: string): string {
  return stableHash(`bank_hint:${bankHint}`);
}

export function extractPaymentAppBankHint(
  text: string,
  sourcePackage?: string | null
): PaymentAppBankHint | null {
  const safeSourcePackage = safePackage(sourcePackage);
  if (!safeSourcePackage) return null;

  const match = text.match(
    /\b(?:deposited|credited|received)\s+(?:in|into|to)\s+your\s+([a-z][a-z0-9._-]{1,31})\s+bank\b/i
  ) || text.match(/\bin\s+your\s+([a-z][a-z0-9._-]{1,31})\s+bank\b/i);
  const bankHint = safeHint(match?.[1]);
  if (!bankHint) return null;

  return {
    sourcePackage: safeSourcePackage,
    sourceLabel: appLabel(safeSourcePackage),
    bankHint,
    bankHintLabel: displayToken(bankHint),
    bankHintHash: bankHintHash(bankHint),
  };
}

async function getBankAccountForUser(userId: string, accountId: string): Promise<BankAccount | null> {
  try {
  const { data, error } = await supabase
    .from('bank_accounts')
    .select('*')
    .eq('user_id', userId)
    .eq('id', accountId)
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  const account = data as BankAccount | null;
  return account && (account.account_type === 'savings' || account.account_type === 'current')
    ? account
    : null;

  } catch (err) {
    if (__DEV__) console.error('[API] paymentAppAccountMappings.ts:getBankAccountForUser failed:', err);
    throw err;
  }}

async function getUniqueBankAccountForHint(userId: string, bankHint: string): Promise<BankAccount | null> {
  try {
  const { data, error } = await supabase
    .from('bank_accounts')
    .select('*')
    .eq('user_id', userId)
    .limit(50);

  if (error) throw error;
  const matches = ((data || []) as BankAccount[]).filter(account =>
    (account.account_type === 'savings' || account.account_type === 'current') &&
    !account.is_archived &&
    bankNameMatchesHint(account, bankHint)
  );

  return matches.length === 1 ? matches[0] : null;

  } catch (err) {
    if (__DEV__) console.error('[API] paymentAppAccountMappings.ts:getUniqueBankAccountForHint failed:', err);
    throw err;
  }}

export async function resolvePaymentAppBankAccountForUser(input: {
  userId: string;
  text: string;
  sourcePackage?: string | null;
}): Promise<PaymentAppBankAccountMatch | null> {
  try {
  const hint = extractPaymentAppBankHint(input.text, input.sourcePackage);
  if (!hint) return null;

  const { data, error } = await supabase
    .from('account_app_mappings')
    .select('*')
    .eq('user_id', input.userId)
    .eq('app_package', hint.sourcePackage)
    .eq('payment_method_hash', hint.bankHintHash)
    .eq('owner_type', 'bank_account')
    .eq('status', 'active')
    .limit(2);

  if (error) throw error;
  const mappings = data || [];
  if (mappings.length !== 1) {
    const hintedAccount = await getUniqueBankAccountForHint(input.userId, hint.bankHint);
    if (!hintedAccount) return { ...hint, mappingStatus: 'needs_review' };

    return {
      ...hint,
      mappingStatus: 'system_matched',
      mappedBankAccountId: hintedAccount.id,
      mappedBankAccountLast4: safeLast4(hintedAccount.account_last4),
      mappedBankName: hintedAccount.bank_name,
    };
  }

  const account = await getBankAccountForUser(input.userId, mappings[0].owner_id);
  if (!account) {
    const hintedAccount = await getUniqueBankAccountForHint(input.userId, hint.bankHint);
    if (!hintedAccount) return { ...hint, mappingStatus: 'needs_review' };

    return {
      ...hint,
      mappingStatus: 'system_matched',
      mappedBankAccountId: hintedAccount.id,
      mappedBankAccountLast4: safeLast4(hintedAccount.account_last4),
      mappedBankName: hintedAccount.bank_name,
    };
  }

  return {
    ...hint,
    mappingStatus: 'user_confirmed',
    mappedBankAccountId: account.id,
    mappedBankAccountLast4: safeLast4(account.account_last4),
    mappedBankName: account.bank_name,
  };

  } catch (err) {
    if (__DEV__) console.error('[API] paymentAppAccountMappings.ts:resolvePaymentAppBankAccountForUser failed:', err);
    throw err;
  }}

export async function confirmPaymentAppBankAccountMapping(input: {
  sourcePackage: string;
  sourceLabel: string;
  bankHint: string;
  bankAccountId: string;
}): Promise<PaymentAppBankAccountMatch> {
  try {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user?.id) throw new Error('Not authenticated');

  const sourcePackage = safePackage(input.sourcePackage);
  const bankHint = safeHint(input.bankHint);
  if (!sourcePackage || !bankHint) throw new Error('Safe payment app mapping context required');

  const account = await getBankAccountForUser(user.id, input.bankAccountId);
  if (!account) throw new Error('Choose one of your savings or current accounts');

  await createOrUpdateAccountAppMapping({
    app_package: sourcePackage,
    app_label: appLabel(sourcePackage, input.sourceLabel),
    payment_method_hash: bankHintHash(bankHint),
    payment_method_masked: `bank_hint:${bankHint}`,
    owner_type: 'bank_account',
    owner_id: account.id,
    account_last4: account.account_last4,
    bank_name: account.bank_name,
    confidence_level: 'medium',
  });

  return {
    sourcePackage,
    sourceLabel: appLabel(sourcePackage, input.sourceLabel),
    bankHint,
    bankHintLabel: displayToken(bankHint),
    bankHintHash: bankHintHash(bankHint),
    mappingStatus: 'user_confirmed',
    mappedBankAccountId: account.id,
    mappedBankAccountLast4: safeLast4(account.account_last4),
    mappedBankName: account.bank_name,
  };

  } catch (err) {
    if (__DEV__) console.error('[API] paymentAppAccountMappings.ts:confirmPaymentAppBankAccountMapping failed:', err);
    throw err;
  }}

export async function recordMappedPaymentAppBalanceEstimateForCurrentUser(input: {
  bankAccountId: string;
  amount: number | null;
  direction: 'credit' | 'debit' | 'neutral' | 'unknown';
  sourcePackage: string;
  sourceHash?: string | null;
  timestamp?: number;
}): Promise<boolean> {
  try {
  if (
    !Number.isFinite(input.amount) ||
    !input.amount ||
    input.amount <= 0 ||
    (input.direction !== 'credit' && input.direction !== 'debit')
  ) {
    return false;
  }

  const { data: { user } } = await supabase.auth.getUser();
  if (!user?.id) throw new Error('Not authenticated');

  const snapshot = await recordEstimatedBankBalanceMovementForUser({
    userId: user.id,
    bankAccountId: input.bankAccountId,
    amount: input.amount,
    direction: input.direction,
    sourceType: 'notification',
    sourceHash: input.sourceHash,
    senderOrPackage: safePackage(input.sourcePackage),
    reason: 'app_mapping',
    timestamp: input.timestamp,
  });

  if (!snapshot) return false;
  emitFinanceDataChanged({
    areas: ['balances'],
    source: 'review_queue:app_mapping_balance_estimate',
  });
  return true;

  } catch (err) {
    if (__DEV__) console.error('[API] paymentAppAccountMappings.ts:recordMappedPaymentAppBalanceEstimateForCurrentUser failed:', err);
    throw err;
  }}
