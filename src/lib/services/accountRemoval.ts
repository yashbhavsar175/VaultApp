import { supabase } from '../core';
import { emitFinanceDataChanged } from './dataEvents';
import { getBankAccounts, getCreditCards, CreditCard } from '../database/financial';
import { BankAccount } from '../../types';

export type RemovableOwnerType = 'bank_account' | 'credit_card' | 'debit_card';

export interface AccountRemovalImpact {
  canHardDelete: boolean;
  willArchive: boolean;
  counts: {
    transactions: number;
    transactionEvidence: number;
    balanceSnapshots: number;
    creditCardStatements: number;
    ccTransactions: number;
    debitCards: number;
    emiPayments: number;
    accountAppMappings: number;
    detectedAccounts: number;
    storedBalances: number;
  };
  warnings: string[];
}

export interface AccountRemovalResult {
  action: 'deleted' | 'archived';
  impact: AccountRemovalImpact;
}

export interface ArchivedFinancialOwners {
  bankAccounts: BankAccount[];
  creditCards: CreditCard[];
}

type OwnerInfo = {
  ownerType: RemovableOwnerType;
  ownerId: string;
  last4: string | null;
  canArchive: boolean;
  hasStoredBalance: boolean;
};

const ZERO_COUNTS: AccountRemovalImpact['counts'] = {
  transactions: 0,
  transactionEvidence: 0,
  balanceSnapshots: 0,
  creditCardStatements: 0,
  ccTransactions: 0,
  debitCards: 0,
  emiPayments: 0,
  accountAppMappings: 0,
  detectedAccounts: 0,
  storedBalances: 0,
};

const REMOVABLE_OWNER_TYPES: RemovableOwnerType[] = ['bank_account', 'credit_card', 'debit_card'];

function assertRemovableOwnerType(ownerType: string): asserts ownerType is RemovableOwnerType {
  if (!REMOVABLE_OWNER_TYPES.includes(ownerType as RemovableOwnerType)) {
    throw new Error('Unsupported account removal owner type');
  }
}

async function getCurrentUserId(): Promise<string> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user?.id) throw new Error('Not authenticated');
  return user.id;
}

async function countRows(
  table: string,
  applyFilters: (query: any) => any
): Promise<number> {
  const query = applyFilters(
    supabase.from(table).select('id', { count: 'exact', head: true })
  );
  const { count, error } = await query;
  if (error) throw error;
  return count || 0;
}

async function getOwnerInfo(
  ownerType: RemovableOwnerType,
  ownerId: string,
  userId: string
): Promise<OwnerInfo> {
  assertRemovableOwnerType(ownerType);

  if (ownerType === 'bank_account') {
    const { data, error } = await supabase
      .from('bank_accounts')
      .select('id,account_last4,balance,starting_balance')
      .eq('id', ownerId)
      .eq('user_id', userId)
      .maybeSingle();

    if (error) throw error;
    if (!data?.id) throw new Error('Account not found');
    return {
      ownerType,
      ownerId,
      last4: data.account_last4 || null,
      canArchive: true,
      hasStoredBalance:
        Number(data.balance ?? 0) !== 0
        || Number(data.starting_balance ?? 0) !== 0,
    };
  }

  if (ownerType === 'credit_card') {
    const { data, error } = await supabase
      .from('credit_cards')
      .select('id,last_4_digits,current_outstanding')
      .eq('id', ownerId)
      .eq('user_id', userId)
      .maybeSingle();

    if (error) throw error;
    if (!data?.id) throw new Error('Card not found');
    return {
      ownerType,
      ownerId,
      last4: data.last_4_digits || null,
      canArchive: true,
      hasStoredBalance: Number(data.current_outstanding ?? 0) !== 0,
    };
  }

  const { data, error } = await supabase
    .from('debit_cards')
    .select('id,card_last4,status')
    .eq('id', ownerId)
    .eq('user_id', userId)
    .maybeSingle();

  if (error) throw error;
  if (!data?.id) throw new Error('Debit card not found');
  return {
    ownerType,
    ownerId,
    last4: data.card_last4 || null,
    canArchive: true,
    hasStoredBalance: false,
  };
}

async function countLinkedTransactions(owner: OwnerInfo, userId: string): Promise<number> {
  if (owner.ownerType === 'bank_account') {
    const [account, from, to, matched] = await Promise.all([
      countRows('transactions', query => query.eq('user_id', userId).eq('account_id', owner.ownerId)),
      countRows('transactions', query => query.eq('user_id', userId).eq('from_account_id', owner.ownerId)),
      countRows('transactions', query => query.eq('user_id', userId).eq('to_account_id', owner.ownerId)),
      countRows('transactions', query => query
        .eq('user_id', userId)
        .eq('account_match_owner_type', owner.ownerType)
        .eq('account_match_owner_id', owner.ownerId)),
    ]);
    return account + from + to + matched;
  }

  return countRows('transactions', query => query
    .eq('user_id', userId)
    .eq('account_match_owner_type', owner.ownerType)
    .eq('account_match_owner_id', owner.ownerId));
}

async function countTransactionEvidence(owner: OwnerInfo, userId: string): Promise<number> {
  if (!owner.last4) return 0;

  if (owner.ownerType === 'bank_account') {
    return countRows('transaction_evidence', query => query
      .eq('user_id', userId)
      .eq('account_last4', owner.last4));
  }

  return countRows('transaction_evidence', query => query
    .eq('user_id', userId)
    .eq('card_last4', owner.last4));
}

async function buildImpact(owner: OwnerInfo, userId: string): Promise<AccountRemovalImpact> {
  const [
    transactions,
    transactionEvidence,
    balanceSnapshots,
    creditCardStatements,
    ccTransactions,
    debitCards,
    accountAppMappings,
    detectedAccounts,
  ] = await Promise.all([
    countLinkedTransactions(owner, userId),
    countTransactionEvidence(owner, userId),
    countRows('balance_snapshots', query => query
      .eq('user_id', userId)
      .eq('owner_type', owner.ownerType)
      .eq('owner_id', owner.ownerId)),
    owner.ownerType === 'credit_card'
      ? countRows('credit_card_statements', query => query.eq('user_id', userId).eq('credit_card_id', owner.ownerId))
      : Promise.resolve(0),
    owner.ownerType === 'credit_card'
      ? countRows('cc_transactions', query => query.eq('user_id', userId).eq('card_id', owner.ownerId))
      : Promise.resolve(0),
    owner.ownerType === 'bank_account'
      ? countRows('debit_cards', query => query.eq('user_id', userId).eq('bank_account_id', owner.ownerId))
      : Promise.resolve(0),
    countRows('account_app_mappings', query => query
      .eq('user_id', userId)
      .eq('owner_type', owner.ownerType)
      .eq('owner_id', owner.ownerId)),
    countRows('detected_accounts', query => query
      .eq('user_id', userId)
      .eq('matched_owner_type', owner.ownerType)
      .eq('matched_owner_id', owner.ownerId)),
  ]);

  const counts = {
    ...ZERO_COUNTS,
    transactions,
    transactionEvidence,
    balanceSnapshots,
    creditCardStatements,
    ccTransactions,
    debitCards,
    accountAppMappings,
    detectedAccounts,
    storedBalances: owner.hasStoredBalance ? 1 : 0,
  };
  const dependencyCount = Object.values(counts).reduce((sum, count) => sum + count, 0);
  const canHardDelete = dependencyCount === 0;
  const willArchive = !canHardDelete && owner.canArchive;
  const warnings: string[] = [];

  if (dependencyCount > 0) {
    warnings.push('History or a stored balance was found for this item.');
  }
  if (!canHardDelete && !willArchive) {
    warnings.push('This item cannot be permanently deleted because it has history or a stored balance.');
  }
  if (willArchive) {
    warnings.push(owner.ownerType === 'debit_card'
      ? 'This debit card will be marked inactive instead of deleted.'
      : 'This item will be hidden from active lists instead of deleted.');
  }

  return {
    canHardDelete,
    willArchive,
    counts,
    warnings,
  };
}

export async function getAccountRemovalImpact(
  ownerType: RemovableOwnerType,
  ownerId: string
): Promise<AccountRemovalImpact> {
  const userId = await getCurrentUserId();
  const owner = await getOwnerInfo(ownerType, ownerId, userId);
  return buildImpact(owner, userId);
}

export async function canHardDeleteOwner(
  ownerType: RemovableOwnerType,
  ownerId: string
): Promise<boolean> {
  return (await getAccountRemovalImpact(ownerType, ownerId)).canHardDelete;
}

export async function archiveOwner(
  ownerType: RemovableOwnerType,
  ownerId: string
): Promise<AccountRemovalResult> {
  const userId = await getCurrentUserId();
  const owner = await getOwnerInfo(ownerType, ownerId, userId);
  const impact = await buildImpact(owner, userId);

  if (!impact.willArchive) {
    throw new Error('This item cannot be archived safely');
  }

  const now = new Date().toISOString();
  const table = ownerType === 'bank_account'
    ? 'bank_accounts'
    : ownerType === 'credit_card'
      ? 'credit_cards'
      : 'debit_cards';
  const payload = ownerType === 'debit_card'
    ? { status: 'inactive', updated_at: now }
    : { is_archived: true, archived_at: now };

  const { error } = await supabase
    .from(table)
    .update(payload)
    .eq('id', ownerId)
    .eq('user_id', userId);

  if (error) throw error;
  emitFinanceDataChanged({ areas: ['accounts'], source: 'account_archive:archive' });
  return { action: 'archived', impact };
}

export async function restoreArchivedOwner(
  ownerType: RemovableOwnerType,
  ownerId: string
): Promise<void> {
  const userId = await getCurrentUserId();
  assertRemovableOwnerType(ownerType);

  const now = new Date().toISOString();
  const table = ownerType === 'bank_account'
    ? 'bank_accounts'
    : ownerType === 'credit_card'
      ? 'credit_cards'
      : 'debit_cards';
  const payload = ownerType === 'debit_card'
    ? { status: 'active', updated_at: now }
    : { is_archived: false, archived_at: null };

  const { error } = await supabase
    .from(table)
    .update(payload)
    .eq('id', ownerId)
    .eq('user_id', userId);

  if (error) throw error;
  emitFinanceDataChanged({ areas: ['accounts'], source: 'account_archive:restore' });
}

export async function getArchivedOwners(): Promise<ArchivedFinancialOwners> {
  const [bankAccounts, creditCards] = await Promise.all([
    getBankAccounts({ archivedOnly: true }),
    getCreditCards({ archivedOnly: true }),
  ]);
  return { bankAccounts, creditCards };
}

export async function isOwnerArchivable(
  ownerType: RemovableOwnerType,
  ownerId: string
): Promise<boolean> {
  const userId = await getCurrentUserId();
  const owner = await getOwnerInfo(ownerType, ownerId, userId);
  return owner.canArchive;
}

export async function hardDeleteOwnerIfSafe(
  ownerType: RemovableOwnerType,
  ownerId: string
): Promise<AccountRemovalResult> {
  const userId = await getCurrentUserId();
  const owner = await getOwnerInfo(ownerType, ownerId, userId);
  const impact = await buildImpact(owner, userId);
  if (!impact.canHardDelete) {
    throw new Error('This item has history and cannot be permanently deleted');
  }

  const { error } = await supabase.rpc('hard_delete_financial_owner_if_safe', {
    p_owner_type: ownerType,
    p_owner_id: ownerId,
  });

  if (error) throw error;
  emitFinanceDataChanged({ areas: ['accounts'], source: 'account_removal:delete' });
  return { action: 'deleted', impact };
}

export async function removeOrArchiveOwner(
  ownerType: RemovableOwnerType,
  ownerId: string
): Promise<AccountRemovalResult> {
  const impact = await getAccountRemovalImpact(ownerType, ownerId);
  if (impact.canHardDelete) {
    return hardDeleteOwnerIfSafe(ownerType, ownerId);
  }
  if (impact.willArchive) {
    return archiveOwner(ownerType, ownerId);
  }
  throw new Error('This item has history and cannot be removed until archive support is added');
}
