import { supabase } from '../core';
import {
  BalanceKind,
  BalanceOwnerType,
  BalanceSnapshot,
  CreditCardStatement,
  DebitCard,
  DetectedAccount,
} from '../../types';
import {
  BalanceParseResult,
  BalanceSignalSourceType,
  ParsedBalanceItem,
  parseBalanceSignal,
} from './balanceParser';
import {
  BalanceSourceMetadata,
  buildBalanceSnapshotInsert,
  normalizeLast4,
  sanitizeBalanceSourceMetadata,
} from './balanceSnapshots';
import { buildDetectedAccountInsert } from './detectedAccounts';
import { buildCreditCardStatementPayload } from './creditCardStatements';

interface RecordBalanceSignalInput {
  userId: string;
  text: string;
  senderOrPackage?: string | null;
  sourceType: BalanceSignalSourceType;
  timestamp?: number;
}

interface RecordEstimatedBankBalanceMovementInput {
  userId: string;
  bankAccountId: string;
  amount: number;
  direction: 'credit' | 'debit';
  sourceType: Extract<BalanceSignalSourceType, 'sms' | 'notification'>;
  timestamp?: number;
  sourceHash?: string | null;
  sourceLength?: number | null;
  senderOrPackage?: string | null;
}

export interface BalanceSignalRecordResult {
  parsed: BalanceParseResult;
  snapshots: BalanceSnapshot[];
  detectedCandidates: DetectedAccount[];
  debitCards: DebitCard[];
  creditCardStatements: CreditCardStatement[];
}

interface MatchedOwner {
  ownerType: BalanceOwnerType;
  ownerId: string;
  confidence: 'exact' | 'estimated' | 'low';
}

interface BankAccountMatch {
  id: string;
  bank_name?: string | null;
  account_type?: string | null;
}

interface BankAccountBalanceBasis {
  amount: number;
  balanceKind: Extract<BalanceKind, 'available_balance' | 'current_balance'>;
  accountLast4?: string | null;
  detectedBankName?: string | null;
}

interface CreditCardMatch {
  id: string;
  bank_name?: string | null;
  last_4_digits?: string | null;
}

const SNAPSHOT_DEDUPE_WINDOW_MS = 24 * 60 * 60 * 1000;

function toDetectedAt(timestamp?: number): string {
  if (!timestamp) return new Date().toISOString();
  const millis = timestamp < 1_000_000_000_000 ? timestamp * 1000 : timestamp;
  const date = new Date(millis);
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
}

function dedupeWindowStart(detectedAt: string): string {
  const time = new Date(detectedAt).getTime();
  const start = Number.isNaN(time) ? Date.now() : time;
  return new Date(start - SNAPSHOT_DEDUPE_WINDOW_MS).toISOString();
}

function normalizeBankName(value?: string | null): string {
  return (value || '')
    .toLowerCase()
    .replace(/\b(?:bank|limited|ltd|mahindra|first|of|the)\b/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function bankNamesMatch(detected?: string | null, existing?: string | null): boolean {
  const detectedName = normalizeBankName(detected);
  const existingName = normalizeBankName(existing);
  if (!detectedName || !existingName) return true;
  return detectedName === existingName ||
    detectedName.includes(existingName) ||
    existingName.includes(detectedName);
}

function firstBalance(parsed: BalanceParseResult): ParsedBalanceItem | null {
  return parsed.balances[0] || null;
}

function sourceMetadata(parsed: BalanceParseResult): BalanceSourceMetadata {
  const senderOrPackage = parsed.redactedSource.senderOrPackage || undefined;
  return sanitizeBalanceSourceMetadata({
    len: parsed.redactedSource.len,
    hash: parsed.redactedSource.hash,
    source: parsed.sourceType,
    kind: 'balance_signal',
    sender: parsed.sourceType === 'sms' ? senderOrPackage : undefined,
    package: parsed.sourceType === 'notification' ? senderOrPackage : undefined,
    reasons: parsed.reasons,
  });
}

async function fetchBankAccountMatches(
  userId: string,
  accountLast4?: string | null
): Promise<BankAccountMatch[]> {
  const last4 = normalizeLast4(accountLast4);
  if (!last4) return [];

  const { data, error } = await supabase
    .from('bank_accounts')
    .select('id, bank_name, account_type')
    .eq('user_id', userId)
    .eq('account_last4', last4)
    .limit(10);

  if (error) throw error;
  return ((data || []) as BankAccountMatch[])
    .filter(account => account.account_type === 'savings' || account.account_type === 'current');
}

async function matchBankAccount(
  userId: string,
  parsed: BalanceParseResult
): Promise<MatchedOwner | null> {
  const matches = await fetchBankAccountMatches(userId, parsed.accountLast4);
  const bankMatches = matches.filter(account => bankNamesMatch(parsed.detectedBankName, account.bank_name));
  const candidates = parsed.detectedBankName ? bankMatches : matches;

  if (candidates.length === 1) {
    return {
      ownerType: 'bank_account',
      ownerId: candidates[0].id,
      confidence: bankMatches.length === 1 || !parsed.detectedBankName ? 'exact' : 'estimated',
    };
  }

  return null;
}

async function fetchCreditCardMatches(
  userId: string,
  cardLast4?: string | null
): Promise<CreditCardMatch[]> {
  const last4 = normalizeLast4(cardLast4);
  if (!last4) return [];

  const { data, error } = await supabase
    .from('credit_cards')
    .select('id, bank_name, last_4_digits')
    .eq('user_id', userId)
    .eq('last_4_digits', last4)
    .limit(10);

  if (error) throw error;
  return (data || []) as CreditCardMatch[];
}

async function matchCreditCard(
  userId: string,
  parsed: BalanceParseResult
): Promise<MatchedOwner | null> {
  const matches = await fetchCreditCardMatches(userId, parsed.cardLast4);
  const bankMatches = matches.filter(card => bankNamesMatch(parsed.detectedBankName, card.bank_name));
  const candidates = parsed.detectedBankName ? bankMatches : matches;

  if (candidates.length === 1) {
    return {
      ownerType: 'credit_card',
      ownerId: candidates[0].id,
      confidence: bankMatches.length === 1 || !parsed.detectedBankName ? 'exact' : 'estimated',
    };
  }

  return null;
}

async function findExistingDetectedCandidate(
  userId: string,
  parsed: BalanceParseResult,
  detectionType: DetectedAccount['detection_type'],
  detectedAt: string
): Promise<DetectedAccount | null> {
  const accountLast4 = normalizeLast4(parsed.accountLast4);
  const cardLast4 = normalizeLast4(parsed.cardLast4 || parsed.debitCardLast4);
  const hasStableIdentifier = Boolean(accountLast4 || cardLast4);

  let query = supabase
    .from('detected_accounts')
    .select('*')
    .eq('user_id', userId)
    .eq('status', 'pending')
    .eq('detection_type', detectionType);

  query = accountLast4 ? query.eq('account_last4', accountLast4) : query.is('account_last4', null);
  query = cardLast4 ? query.eq('card_last4', cardLast4) : query.is('card_last4', null);

  if (hasStableIdentifier) {
    const { data, error } = await query
      .order('last_seen_at', { ascending: false })
      .limit(10);

    if (error) throw error;
    return ((data || []) as DetectedAccount[])
      .find(candidate => bankNamesMatch(parsed.detectedBankName, candidate.detected_bank_name)) || null;
  }

  query = query
    .eq('source', parsed.sourceType)
    .eq('raw_source_metadata->>hash', parsed.redactedSource.hash)
    .gte('last_seen_at', dedupeWindowStart(detectedAt));

  const { data, error } = await query
    .order('last_seen_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return (data as DetectedAccount | null) || null;
}

async function createOrReuseDetectedCandidate(
  userId: string,
  parsed: BalanceParseResult,
  detectionType: DetectedAccount['detection_type'],
  detectedAt: string,
  confidenceOverride?: 'exact' | 'estimated' | 'low'
): Promise<DetectedAccount> {
  const existing = await findExistingDetectedCandidate(userId, parsed, detectionType, detectedAt);
  if (existing?.id) {
    const { data, error } = await supabase
      .from('detected_accounts')
      .update({ last_seen_at: detectedAt, updated_at: new Date().toISOString() })
      .eq('id', existing.id)
      .eq('user_id', userId)
      .select()
      .single();

    if (error) throw error;
    return data as DetectedAccount;
  }

  const balance = firstBalance(parsed);
  const payload = {
    ...buildDetectedAccountInsert(userId, {
      detection_type: detectionType,
      detected_bank_name: parsed.detectedBankName,
      account_last4: parsed.accountLast4,
      card_last4: detectionType === 'debit_card' ? parsed.debitCardLast4 : parsed.cardLast4,
      account_type_hint: parsed.accountTypeHint,
      balance_amount: balance?.amount ?? null,
      balance_kind: balance?.balanceKind as BalanceKind | undefined,
      source: parsed.sourceType,
      confidence: confidenceOverride || parsed.confidence,
      source_sender_or_package: parsed.redactedSource.senderOrPackage,
      raw_source_metadata: sourceMetadata(parsed),
    }),
    first_seen_at: detectedAt,
    last_seen_at: detectedAt,
  };

  const { data, error } = await supabase
    .from('detected_accounts')
    .insert(payload)
    .select()
    .single();

  if (error) throw error;
  return data as DetectedAccount;
}

async function findRecentSimilarSnapshot(
  userId: string,
  parsed: BalanceParseResult,
  balance: ParsedBalanceItem,
  ownerType: BalanceOwnerType,
  ownerId: string | null,
  detectedAt: string
): Promise<BalanceSnapshot | null> {
  let query = supabase
    .from('balance_snapshots')
    .select('*')
    .eq('user_id', userId)
    .eq('owner_type', ownerType)
    .eq('balance_kind', balance.balanceKind)
    .eq('amount', balance.amount)
    .eq('source', parsed.sourceType)
    .eq('raw_source_metadata->>hash', parsed.redactedSource.hash)
    .gte('detected_at', dedupeWindowStart(detectedAt));

  query = ownerId ? query.eq('owner_id', ownerId) : query.is('owner_id', null);

  const accountLast4 = normalizeLast4(parsed.accountLast4);
  const cardLast4 = normalizeLast4(parsed.cardLast4 || parsed.debitCardLast4);
  query = accountLast4 ? query.eq('account_last4', accountLast4) : query.is('account_last4', null);
  query = cardLast4 ? query.eq('card_last4', cardLast4) : query.is('card_last4', null);

  const { data, error } = await query
    .order('detected_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return (data as BalanceSnapshot | null) || null;
}

async function createSnapshotIfNew(
  userId: string,
  parsed: BalanceParseResult,
  balance: ParsedBalanceItem,
  ownerType: BalanceOwnerType,
  ownerId: string | null,
  detectedAt: string
): Promise<BalanceSnapshot | null> {
  const existing = await findRecentSimilarSnapshot(userId, parsed, balance, ownerType, ownerId, detectedAt);
  if (existing?.id) return existing;

  const payload = buildBalanceSnapshotInsert(userId, {
    owner_type: ownerType,
    owner_id: ownerId,
    detected_bank_name: parsed.detectedBankName,
    account_last4: parsed.accountLast4,
    card_last4: parsed.cardLast4 || parsed.debitCardLast4,
    balance_kind: balance.balanceKind as BalanceKind,
    amount: balance.amount,
    source: parsed.sourceType,
    confidence: balance.confidence,
    detected_at: detectedAt,
    source_sender_or_package: parsed.redactedSource.senderOrPackage,
    raw_source_metadata: sourceMetadata(parsed),
  });

  const { data, error } = await supabase
    .from('balance_snapshots')
    .insert(payload)
    .select()
    .single();

  if (error) throw error;
  return data as BalanceSnapshot;
}

async function createOrUpdateDetectedDebitCard(
  userId: string,
  parsed: BalanceParseResult,
  bankAccountId: string,
  detectedAt: string
): Promise<DebitCard | null> {
  const cardLast4 = normalizeLast4(parsed.debitCardLast4);
  if (!cardLast4) return null;

  const { data: existing, error: selectError } = await supabase
    .from('debit_cards')
    .select('*')
    .eq('user_id', userId)
    .eq('bank_account_id', bankAccountId)
    .eq('card_last4', cardLast4)
    .limit(1)
    .maybeSingle();

  if (selectError) throw selectError;

  const payload = {
    user_id: userId,
    bank_account_id: bankAccountId,
    bank_name: parsed.detectedBankName || null,
    card_last4: cardLast4,
    status: 'detected',
    detected_confidence: parsed.confidence,
    source_sender_or_package: parsed.redactedSource.senderOrPackage || null,
    last_seen_at: detectedAt,
    updated_at: new Date().toISOString(),
  };

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
}

async function findExistingCreditCardStatement(
  userId: string,
  creditCardId: string,
  parsed: BalanceParseResult
): Promise<CreditCardStatement | null> {
  let query = supabase
    .from('credit_card_statements')
    .select('*')
    .eq('user_id', userId)
    .eq('credit_card_id', creditCardId)
    .eq('raw_source_metadata->>hash', parsed.redactedSource.hash);

  if (parsed.statement?.paymentDueDate) {
    query = query.eq('payment_due_date', parsed.statement.paymentDueDate);
  } else if (parsed.statement?.statementDate) {
    query = query.eq('statement_date', parsed.statement.statementDate);
  }

  const { data, error } = await query
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return (data as CreditCardStatement | null) || null;
}

async function createOrUpdateStatementIfNeeded(
  userId: string,
  parsed: BalanceParseResult,
  creditCardId: string,
  sourceSnapshotId: string | null
): Promise<CreditCardStatement | null> {
  if (!parsed.statement) return null;

  const existing = await findExistingCreditCardStatement(userId, creditCardId, parsed);
  const payload = buildCreditCardStatementPayload(userId, {
    credit_card_id: creditCardId,
    statement_date: parsed.statement.statementDate,
    total_due: parsed.statement.totalDue,
    minimum_due: parsed.statement.minimumDue,
    payment_due_date: parsed.statement.paymentDueDate,
    statement_balance: parsed.statement.statementBalance,
    source_snapshot_id: sourceSnapshotId,
    source: parsed.sourceType,
    confidence: parsed.statement.confidence,
    raw_source_metadata: sourceMetadata(parsed),
  });

  if (existing?.id) {
    const { data, error } = await supabase
      .from('credit_card_statements')
      .update({ ...payload, updated_at: new Date().toISOString() })
      .eq('id', existing.id)
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
}

async function resolveOwner(
  userId: string,
  parsed: BalanceParseResult,
  detectedAt: string,
  detectedCandidates: DetectedAccount[]
): Promise<MatchedOwner | null> {
  if (parsed.instrumentHint === 'credit_card') {
    const match = await matchCreditCard(userId, parsed);
    if (match) return match;

    const candidate = await createOrReuseDetectedCandidate(userId, parsed, 'credit_card', detectedAt, 'low');
    detectedCandidates.push(candidate);
    return { ownerType: 'detected_card', ownerId: candidate.id, confidence: 'low' };
  }

  if (parsed.instrumentHint === 'loan') {
    const candidate = await createOrReuseDetectedCandidate(userId, parsed, 'loan', detectedAt, 'low');
    detectedCandidates.push(candidate);
    return { ownerType: 'detected_account', ownerId: candidate.id, confidence: 'low' };
  }

  const bankMatch = await matchBankAccount(userId, parsed);
  if (bankMatch) return bankMatch;

  const candidate = await createOrReuseDetectedCandidate(userId, parsed, 'bank_account', detectedAt, 'low');
  detectedCandidates.push(candidate);
  return { ownerType: 'detected_account', ownerId: candidate.id, confidence: 'low' };
}

export async function recordBalanceSignalForUser(
  input: RecordBalanceSignalInput
): Promise<BalanceSignalRecordResult> {
  const parsed = parseBalanceSignal({
    text: input.text,
    senderOrPackage: input.senderOrPackage,
    sourceType: input.sourceType,
    timestamp: input.timestamp,
  });

  const result: BalanceSignalRecordResult = {
    parsed,
    snapshots: [],
    detectedCandidates: [],
    debitCards: [],
    creditCardStatements: [],
  };

  if (!parsed.isBalanceSignal) return result;

  const detectedAt = toDetectedAt(input.timestamp);
  const shouldResolveOwner = parsed.balances.length > 0 ||
    parsed.instrumentHint === 'credit_card' ||
    parsed.instrumentHint === 'loan';
  const owner = shouldResolveOwner
    ? await resolveOwner(input.userId, parsed, detectedAt, result.detectedCandidates)
    : null;

  if (parsed.debitCardLast4) {
    if (owner?.ownerType === 'bank_account') {
      const debitCard = await createOrUpdateDetectedDebitCard(input.userId, parsed, owner.ownerId, detectedAt);
      if (debitCard) result.debitCards.push(debitCard);
    } else {
      const candidate = await createOrReuseDetectedCandidate(input.userId, parsed, 'debit_card', detectedAt, 'low');
      if (!result.detectedCandidates.some(item => item.id === candidate.id)) {
        result.detectedCandidates.push(candidate);
      }
    }
  }

  for (const balance of parsed.balances) {
    if (!owner) continue;
    const snapshot = await createSnapshotIfNew(
      input.userId,
      parsed,
      balance,
      owner.ownerType,
      owner.ownerId,
      detectedAt
    );
    if (snapshot && !result.snapshots.some(item => item.id === snapshot.id)) {
      result.snapshots.push(snapshot);
    }
  }

  if (owner?.ownerType === 'credit_card') {
    const statement = await createOrUpdateStatementIfNeeded(
      input.userId,
      parsed,
      owner.ownerId,
      result.snapshots[0]?.id || null
    );
    if (statement) result.creditCardStatements.push(statement);
  }

  return result;
}

function isBankBalanceKind(kind: BalanceKind): kind is Extract<BalanceKind, 'available_balance' | 'current_balance'> {
  return kind === 'available_balance' || kind === 'current_balance';
}

async function fetchLatestKnownBankBalance(
  userId: string,
  bankAccountId: string
): Promise<BankAccountBalanceBasis | null> {
  const { data: snapshots, error: snapshotError } = await supabase
    .from('balance_snapshots')
    .select('balance_kind, amount, account_last4, detected_bank_name')
    .eq('user_id', userId)
    .eq('owner_type', 'bank_account')
    .eq('owner_id', bankAccountId)
    .order('detected_at', { ascending: false })
    .limit(10);

  if (snapshotError) throw snapshotError;

  const snapshotRows = (snapshots || []) as Array<{
    balance_kind: BalanceKind;
    amount: number;
    account_last4?: string | null;
    detected_bank_name?: string | null;
  }>;
  const snapshot = snapshotRows.find(row =>
    isBankBalanceKind(row.balance_kind) && Number.isFinite(Number(row.amount))
  );

  if (snapshot) {
    const balanceKind = isBankBalanceKind(snapshot.balance_kind)
      ? snapshot.balance_kind
      : 'current_balance';
    return {
      amount: Number(snapshot.amount),
      balanceKind,
      accountLast4: snapshot.account_last4,
      detectedBankName: snapshot.detected_bank_name,
    };
  }

  const { data: accounts, error: accountError } = await supabase
    .from('bank_accounts')
    .select('bank_name, account_last4, balance')
    .eq('user_id', userId)
    .eq('id', bankAccountId)
    .limit(1);

  if (accountError) throw accountError;
  const account = (accounts || [])[0] as {
    bank_name?: string | null;
    account_last4?: string | null;
    balance?: number | null;
  } | undefined;

  const balance = Number(account?.balance);
  if (!account || account.balance === null || account.balance === undefined || !Number.isFinite(balance)) {
    return null;
  }

  return {
    amount: balance,
    balanceKind: 'current_balance',
    accountLast4: account.account_last4,
    detectedBankName: account.bank_name,
  };
}

async function findExistingEstimatedMovementSnapshot(
  userId: string,
  bankAccountId: string,
  sourceHash?: string | null
): Promise<BalanceSnapshot | null> {
  const hash = sourceHash?.trim().toLowerCase();
  if (!hash || !/^[a-f0-9]{8,64}$/.test(hash)) return null;

  const { data, error } = await supabase
    .from('balance_snapshots')
    .select('*')
    .eq('user_id', userId)
    .eq('owner_type', 'bank_account')
    .eq('owner_id', bankAccountId)
    .eq('source', 'calculated')
    .eq('raw_source_metadata->>hash', hash)
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return (data as BalanceSnapshot | null) || null;
}

export async function recordEstimatedBankBalanceMovementForUser(
  input: RecordEstimatedBankBalanceMovementInput
): Promise<BalanceSnapshot | null> {
  if (!input.bankAccountId?.trim()) return null;
  if (!Number.isFinite(input.amount) || input.amount <= 0) return null;

  const existing = await findExistingEstimatedMovementSnapshot(input.userId, input.bankAccountId, input.sourceHash);
  if (existing) return existing;

  const previous = await fetchLatestKnownBankBalance(input.userId, input.bankAccountId);
  if (!previous) return null;

  const delta = input.direction === 'credit' ? input.amount : -input.amount;
  const nextAmount = previous.amount + delta;
  if (!Number.isFinite(nextAmount) || nextAmount < 0) return null;

  const detectedAt = toDetectedAt(input.timestamp);
  const senderOrPackage = input.senderOrPackage?.trim() || null;
  const payload = buildBalanceSnapshotInsert(input.userId, {
    owner_type: 'bank_account',
    owner_id: input.bankAccountId,
    detected_bank_name: previous.detectedBankName,
    account_last4: previous.accountLast4,
    balance_kind: previous.balanceKind,
    amount: nextAmount,
    source: 'calculated',
    confidence: 'estimated',
    detected_at: detectedAt,
    source_sender_or_package: senderOrPackage,
    raw_source_metadata: sanitizeBalanceSourceMetadata({
      len: input.sourceLength ?? undefined,
      hash: input.sourceHash ?? undefined,
      source: input.sourceType,
      kind: 'transaction_balance_estimate',
      sender: input.sourceType === 'sms' ? senderOrPackage || undefined : undefined,
      package: input.sourceType === 'notification' ? senderOrPackage || undefined : undefined,
    }),
    note: 'Estimated from transaction alert',
  });

  const { data, error } = await supabase
    .from('balance_snapshots')
    .insert(payload)
    .select()
    .single();

  if (error) throw error;
  return data as BalanceSnapshot;
}
