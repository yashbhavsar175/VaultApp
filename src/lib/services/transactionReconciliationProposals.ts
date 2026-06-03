import { supabase } from '../core';
import {
  AccountAppMapping,
  DebitCard,
  EvidenceDirection,
  EvidenceInstrumentHint,
  EvidenceMatchStatus,
  EvidenceSourceType,
  Transaction,
  TransactionEvidence,
} from '../../types';
import {
  ExistingTransactionCandidate,
  KnownAccount,
  KnownMapping,
  ReconciliationConfidence,
  ReconciliationDecision,
  ReconciliationEvidence,
  ReconciliationMatchStatus,
  isAmountMatch,
  isCloseTime,
  isReferenceMatch,
  reconcileEvidenceSet,
} from './transactionReconciliation';

export interface TransactionReconciliationProposal {
  proposalId: string;
  transactionId?: string | null;
  evidenceIds: string[];
  decision: ReconciliationDecision;
  confidence: ReconciliationConfidence;
  matchStatus: ReconciliationMatchStatus;
  matchedOwnerType?: KnownAccount['ownerType'] | null;
  matchedOwnerId?: string | null;
  matchedOwnerLabel?: string | null;
  reasonCode: string;
  explanationTokens: string[];
  evidenceSummary: ReconciliationEvidenceSummary;
  score: number;
  createdAt: string;
}

export interface ReconciliationEvidenceSummary {
  sourceTypes: EvidenceSourceType[];
  direction: EvidenceDirection | null;
  amountPresent: boolean;
  referencePresent: boolean;
  bankProofCount: number;
  accountLast4s: string[];
  cardLast4s: string[];
  bankNames: string[];
  paymentAppHint: boolean;
}

export interface GetRecentReconciliationProposalsOptions {
  limit?: number;
  evidencePoolLimit?: number;
  transactionLimit?: number;
  windowMs?: number;
}

type CreditCardRow = {
  id: string;
  user_id: string;
  bank_name?: string | null;
  card_name?: string | null;
  last_4_digits?: string | null;
};

type BankAccountRow = {
  id: string;
  user_id: string;
  bank_name?: string | null;
  account_last4?: string | null;
  account_type?: string | null;
};

type TransactionEvidenceReadRow = Omit<TransactionEvidence, 'raw_source_metadata'> & {
  raw_source_metadata?: unknown;
};

type TransactionCandidateRow = Pick<
  Transaction,
  'id' | 'amount' | 'type' | 'created_at' | 'reference_number' | 'note' | 'category'
>;

interface KnownOwnerWithLabel extends KnownAccount {
  label: string | null;
}

interface ProposalWithSort extends TransactionReconciliationProposal {
  sortTime: number;
}

const DEFAULT_LIMIT = 50;
const DEFAULT_EVIDENCE_POOL_LIMIT = 120;
const DEFAULT_TRANSACTION_LIMIT = 120;
const DEFAULT_WINDOW_MS = 2 * 60 * 1000;
const PROPOSAL_MATCH_STATUSES: EvidenceMatchStatus[] = [
  'unlinked',
  'review_required',
  'ambiguous',
];
const SELECT_EVIDENCE_COLUMNS = [
  'id',
  'user_id',
  'signal_id',
  'transaction_id',
  'source_type',
  'source_package',
  'source_app',
  'sender',
  'amount',
  'direction',
  'captured_at',
  'reference_number',
  'merchant_or_person',
  'bank_name',
  'account_last4',
  'card_last4',
  'instrument_hint',
  'upi_id_masked',
  'upi_id_hash',
  'confidence_level',
  'match_status',
  'match_reason_code',
  'created_at',
  'updated_at',
].join(',');

function clampLimit(value: number | undefined, fallback: number, max: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(1, Math.min(Math.floor(Number(value)), max));
}

async function getCurrentUserId(): Promise<string> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user?.id) throw new Error('Not authenticated');
  return user.id;
}

async function executeRead<T>(query: any): Promise<T> {
  const { data, error } = await query;
  if (error) throw error;
  return data as T;
}

function toNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function toTimestamp(value?: string | null): number {
  const parsed = value ? Date.parse(value) : NaN;
  return Number.isFinite(parsed) ? parsed : 0;
}

function safeLast4(value?: string | null): string | null {
  const digits = (value || '').replace(/\D/g, '');
  return digits.length === 4 ? digits : null;
}

function safeLabelName(value?: string | null, fallback = 'Account'): string {
  const trimmed = (value || '').trim();
  if (!trimmed) return fallback;
  if (/[A-Za-z0-9._+-]{2,}@[A-Za-z][A-Za-z0-9.-]{1,}/.test(trimmed)) return fallback;
  if (/\b(?:\+?91[-\s]?)?[6-9]\d{9}\b/.test(trimmed)) return fallback;

  const cleaned = trimmed
    .replace(/\b\d(?:[ -]?\d){4,}\b/g, '')
    .replace(/[^A-Za-z0-9 .&-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 48);

  return cleaned || fallback;
}

function maskedLabel(name: string | null | undefined, last4: string | null, fallback: string): string | null {
  if (!last4) return null;
  return `${safeLabelName(name, fallback)} ••${last4}`;
}

export function buildKnownOwners(input: {
  bankAccounts?: BankAccountRow[];
  creditCards?: CreditCardRow[];
  debitCards?: DebitCard[];
}): KnownOwnerWithLabel[] {
  const owners: KnownOwnerWithLabel[] = [];

  for (const account of input.bankAccounts || []) {
    const accountLast4 = safeLast4(account.account_last4);
    if (!accountLast4) continue;
    if (account.account_type && !['savings', 'current'].includes(account.account_type)) continue;
    const bankName = safeLabelName(account.bank_name, 'Bank Account');

    owners.push({
      id: account.id,
      ownerType: 'bank_account',
      bankName,
      accountLast4,
      cardLast4: null,
      label: maskedLabel(bankName, accountLast4, 'Bank Account'),
    });
  }

  for (const card of input.creditCards || []) {
    const cardLast4 = safeLast4(card.last_4_digits);
    if (!cardLast4) continue;
    const bankName = safeLabelName(card.bank_name, 'Credit Card');
    const labelName = [card.bank_name, card.card_name]
      .filter(Boolean)
      .map(value => safeLabelName(value, 'Credit Card'))
      .join(' ')
      .trim();

    owners.push({
      id: card.id,
      ownerType: 'credit_card',
      bankName,
      accountLast4: null,
      cardLast4,
      label: maskedLabel(labelName || bankName, cardLast4, 'Credit Card'),
    });
  }

  for (const card of input.debitCards || []) {
    const cardLast4 = safeLast4(card.card_last4);
    if (!cardLast4) continue;
    const bankName = safeLabelName(card.bank_name, 'Debit Card');
    const baseName = bankName || safeLabelName(card.card_label, 'Debit Card');

    owners.push({
      id: card.id,
      ownerType: 'debit_card',
      bankName,
      accountLast4: null,
      cardLast4,
      label: maskedLabel(baseName, cardLast4, 'Debit Card'),
    });
  }

  return owners;
}

function isKnownMappingOwnerType(
  ownerType: AccountAppMapping['owner_type']
): ownerType is KnownMapping['ownerType'] {
  return ownerType === 'bank_account' || ownerType === 'credit_card' || ownerType === 'debit_card';
}

export function buildKnownMappings(rows: AccountAppMapping[] = []): KnownMapping[] {
  const mappings: KnownMapping[] = [];

  for (const row of rows) {
    if (row.status !== 'active') continue;
    if (!isKnownMappingOwnerType(row.owner_type)) continue;

    mappings.push({
      id: row.id,
      appPackage: row.app_package,
      paymentMethodHash: row.payment_method_hash || null,
      ownerType: row.owner_type,
      ownerId: row.owner_id,
      confidenceLevel: row.confidence_level === 'low' ? 'low' : 'medium',
      status: 'active',
    });
  }

  return mappings;
}

export function toReconciliationEvidence(row: TransactionEvidenceReadRow): ReconciliationEvidence {
  return {
    id: row.id,
    sourceType: row.source_type as EvidenceSourceType,
    sourcePackage: row.source_package || null,
    sourceApp: row.source_app || null,
    amount: toNumber(row.amount),
    direction: (row.direction || null) as EvidenceDirection | null,
    capturedAt: toTimestamp(row.captured_at),
    referenceNumber: row.reference_number || null,
    merchantOrPerson: row.merchant_or_person || null,
    bankName: row.bank_name || null,
    accountLast4: safeLast4(row.account_last4),
    cardLast4: safeLast4(row.card_last4),
    instrumentHint: (row.instrument_hint || null) as EvidenceInstrumentHint | null,
    upiIdMasked: row.upi_id_masked || null,
    upiIdHash: row.upi_id_hash || null,
  };
}

function hasBankProof(evidence: ReconciliationEvidence): boolean {
  return Boolean(safeLast4(evidence.accountLast4) || safeLast4(evidence.cardLast4));
}

function uniqueSafeValues(values: Array<string | null | undefined>, limit = 4): string[] {
  return Array.from(new Set(
    values
      .map(value => (value || '').trim())
      .filter(Boolean)
  )).slice(0, limit);
}

function buildEvidenceSummary(evidences: ReconciliationEvidence[]): ReconciliationEvidenceSummary {
  const bankProofs = evidences.filter(hasBankProof);
  const direction = uniqueSafeValues(evidences.map(evidence => evidence.direction))[0] as EvidenceDirection | undefined;

  return {
    sourceTypes: uniqueSafeValues(evidences.map(evidence => evidence.sourceType)) as EvidenceSourceType[],
    direction: direction || null,
    amountPresent: evidences.some(evidence => evidence.amount !== null),
    referencePresent: evidences.some(evidence => Boolean(evidence.referenceNumber)),
    bankProofCount: bankProofs.length,
    accountLast4s: uniqueSafeValues(evidences.map(evidence => safeLast4(evidence.accountLast4))),
    cardLast4s: uniqueSafeValues(evidences.map(evidence => safeLast4(evidence.cardLast4))),
    bankNames: uniqueSafeValues(evidences.map(evidence => evidence.bankName ? safeLabelName(evidence.bankName, 'Bank') : null), 3),
    paymentAppHint: evidences.some(evidence =>
      evidence.sourceType === 'notification' || Boolean(evidence.sourceApp || evidence.sourcePackage || evidence.upiIdHash)
    ),
  };
}

function evidenceRelated(
  a: TransactionEvidenceReadRow,
  b: TransactionEvidenceReadRow,
  windowMs: number
): boolean {
  if (a.id === b.id) return true;
  if (a.transaction_id && b.transaction_id && a.transaction_id === b.transaction_id) return true;
  if (isReferenceMatch(a.reference_number, b.reference_number)) return true;

  const evidenceA = toReconciliationEvidence(a);
  const evidenceB = toReconciliationEvidence(b);
  if (!hasBankProof(evidenceA) && !hasBankProof(evidenceB)) return false;

  return (
    isAmountMatch(evidenceA.amount, evidenceB.amount) &&
    isCloseTime(evidenceA.capturedAt, evidenceB.capturedAt, windowMs)
  );
}

function buildEvidenceCluster(
  seed: TransactionEvidenceReadRow,
  evidencePool: TransactionEvidenceReadRow[],
  windowMs: number
): TransactionEvidenceReadRow[] {
  const byId = new Map(evidencePool.map(row => [row.id, row]));
  byId.set(seed.id, seed);

  const cluster = new Map<string, TransactionEvidenceReadRow>([[seed.id, seed]]);
  let changed = true;

  while (changed) {
    changed = false;
    for (const candidate of byId.values()) {
      if (cluster.has(candidate.id)) continue;
      if (Array.from(cluster.values()).some(member => evidenceRelated(member, candidate, windowMs))) {
        cluster.set(candidate.id, candidate);
        changed = true;
      }
    }
  }

  return Array.from(cluster.values()).sort((a, b) => toTimestamp(b.captured_at) - toTimestamp(a.captured_at));
}

function transactionDirection(type?: Transaction['type'] | null): EvidenceDirection | null {
  if (type === 'income' || type === 'borrowed') return 'credit';
  if (type === 'transfer') return 'transfer';
  if (type === 'expense' || type === 'investment' || type === 'emi' || type === 'lent') return 'debit';
  return null;
}

function toExistingTransactionCandidate(row: TransactionCandidateRow): ExistingTransactionCandidate {
  return {
    id: row.id,
    amount: toNumber(row.amount),
    direction: transactionDirection(row.type),
    capturedAt: toTimestamp(row.created_at),
    referenceNumber: row.reference_number || null,
  };
}

function normalizeMerchantTokens(value?: string | null): string[] {
  return (value || '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, ' ')
    .split(/\s+/)
    .filter(token => token.length >= 3 && !['BANK', 'LIMITED', 'LTD', 'THE'].includes(token));
}

function merchantOverlap(...values: Array<string | null | undefined>): boolean {
  const tokenSets = values
    .map(normalizeMerchantTokens)
    .filter(tokens => tokens.length > 0)
    .map(tokens => new Set(tokens));

  if (tokenSets.length < 2) return false;

  const [first, ...rest] = tokenSets;
  return Array.from(first).some(token => rest.some(tokens => tokens.has(token)));
}

function directionsCompatible(
  transactionDirectionValue?: EvidenceDirection | null,
  evidenceDirectionValue?: EvidenceDirection | null
): boolean {
  if (!transactionDirectionValue || !evidenceDirectionValue) return true;
  if (transactionDirectionValue === 'unknown' || evidenceDirectionValue === 'unknown') return true;
  return transactionDirectionValue === evidenceDirectionValue;
}

function transactionMatchesEvidence(
  transaction: TransactionCandidateRow,
  evidence: ReconciliationEvidence,
  windowMs: number
): boolean {
  const candidate = toExistingTransactionCandidate(transaction);
  if (!directionsCompatible(candidate.direction, evidence.direction)) return false;
  if (isReferenceMatch(candidate.referenceNumber, evidence.referenceNumber)) return true;

  return (
    isAmountMatch(candidate.amount, evidence.amount) &&
    isCloseTime(candidate.capturedAt, evidence.capturedAt, windowMs) &&
    merchantOverlap(transaction.note, transaction.category, evidence.merchantOrPerson)
  );
}

function transactionCandidatesForCluster(
  transactions: TransactionCandidateRow[],
  cluster: TransactionEvidenceReadRow[],
  windowMs: number
): ExistingTransactionCandidate[] {
  const evidences = cluster.map(toReconciliationEvidence);
  return transactions
    .filter(transaction => evidences.some(evidence => transactionMatchesEvidence(transaction, evidence, windowMs)))
    .map(toExistingTransactionCandidate);
}

function findProposalTransactionId(
  cluster: TransactionEvidenceReadRow[],
  transactions: TransactionCandidateRow[],
  decision: ReconciliationDecision,
  windowMs: number
): string | null {
  if (decision === 'link_existing_transaction') {
    const evidences = cluster.map(toReconciliationEvidence);
    const matched = transactions.find(transaction =>
      evidences.some(evidence => transactionMatchesEvidence(transaction, evidence, windowMs))
    );
    return matched?.id || null;
  }

  return cluster.find(evidence => evidence.transaction_id)?.transaction_id || null;
}

function proposalGroup(proposal: ProposalWithSort): number {
  if (
    proposal.decision !== 'review_required' &&
    (proposal.confidence === 'exact' || proposal.confidence === 'high')
  ) {
    return 0;
  }
  if (proposal.decision === 'review_required' || proposal.matchStatus === 'ambiguous') return 1;
  if (proposal.confidence === 'medium') return 2;
  if (proposal.confidence === 'low') return 3;
  return 4;
}

function sortProposals(proposals: ProposalWithSort[]): TransactionReconciliationProposal[] {
  return proposals
    .sort((a, b) => proposalGroup(a) - proposalGroup(b) || b.sortTime - a.sortTime || b.score - a.score)
    .map(({ sortTime: _sortTime, ...proposal }) => proposal);
}

function proposalIdFor(evidenceIds: string[], reasonCode: string, transactionId: string | null): string {
  const evidencePart = [...evidenceIds].sort().join('.');
  return ['reconcile', transactionId || 'no_tx', reasonCode, evidencePart].join(':');
}

function buildProposal(
  cluster: TransactionEvidenceReadRow[],
  owners: KnownOwnerWithLabel[],
  mappings: KnownMapping[],
  transactions: TransactionCandidateRow[],
  windowMs: number
): ProposalWithSort {
  const reconciliationEvidences = cluster.map(toReconciliationEvidence);
  const transactionCandidates = transactionCandidatesForCluster(transactions, cluster, windowMs);
  const result = reconcileEvidenceSet({
    evidences: reconciliationEvidences,
    knownAccounts: owners,
    knownMappings: mappings,
    existingTransactions: transactionCandidates,
    windowMs,
  });
  const evidenceIds = Array.from(new Set(
    result.matchedEvidenceIds.length
      ? result.matchedEvidenceIds
      : reconciliationEvidences.map(evidence => evidence.id)
  ));
  const transactionId = findProposalTransactionId(cluster, transactions, result.decision, windowMs);
  const ownerLabel = owners.find(owner =>
    owner.ownerType === result.matchedOwnerType && owner.id === result.matchedOwnerId
  )?.label || null;
  const newestEvidenceTime = Math.max(...cluster.map(evidence => toTimestamp(evidence.captured_at)));

  return {
    proposalId: proposalIdFor(evidenceIds, result.reasonCode, transactionId),
    transactionId,
    evidenceIds,
    decision: result.decision,
    confidence: result.confidence,
    matchStatus: result.matchStatus,
    matchedOwnerType: result.matchedOwnerType || null,
    matchedOwnerId: result.matchedOwnerId || null,
    matchedOwnerLabel: ownerLabel,
    reasonCode: result.reasonCode,
    explanationTokens: result.explanationTokens,
    evidenceSummary: buildEvidenceSummary(reconciliationEvidences),
    score: result.score,
    createdAt: new Date().toISOString(),
    sortTime: newestEvidenceTime,
  };
}

function buildProposalsFromSeeds(
  seeds: TransactionEvidenceReadRow[],
  evidencePool: TransactionEvidenceReadRow[],
  owners: KnownOwnerWithLabel[],
  mappings: KnownMapping[],
  transactions: TransactionCandidateRow[],
  windowMs: number
): TransactionReconciliationProposal[] {
  const proposals = new Map<string, ProposalWithSort>();

  for (const seed of seeds) {
    const cluster = buildEvidenceCluster(seed, evidencePool, windowMs);
    const clusterKey = cluster.map(evidence => evidence.id).sort().join(':');
    if (proposals.has(clusterKey)) continue;
    proposals.set(clusterKey, buildProposal(cluster, owners, mappings, transactions, windowMs));
  }

  return sortProposals(Array.from(proposals.values()));
}

async function fetchRecentEvidence(userId: string, limit: number): Promise<TransactionEvidenceReadRow[]> {
  const query = supabase
    .from('transaction_evidence')
    .select(SELECT_EVIDENCE_COLUMNS)
    .eq('user_id', userId)
    .in('match_status', PROPOSAL_MATCH_STATUSES)
    .order('captured_at', { ascending: false })
    .limit(limit);

  return (await executeRead<TransactionEvidenceReadRow[]>(query)) || [];
}

async function fetchEvidenceById(userId: string, evidenceId: string): Promise<TransactionEvidenceReadRow | null> {
  const query = supabase
    .from('transaction_evidence')
    .select(SELECT_EVIDENCE_COLUMNS)
    .eq('user_id', userId)
    .eq('id', evidenceId)
    .maybeSingle();

  return await executeRead<TransactionEvidenceReadRow | null>(query);
}

async function fetchEvidenceForTransaction(
  userId: string,
  transactionId: string
): Promise<TransactionEvidenceReadRow[]> {
  const query = supabase
    .from('transaction_evidence')
    .select(SELECT_EVIDENCE_COLUMNS)
    .eq('user_id', userId)
    .eq('transaction_id', transactionId)
    .order('captured_at', { ascending: false });

  return (await executeRead<TransactionEvidenceReadRow[]>(query)) || [];
}

async function fetchTransactionById(userId: string, transactionId: string): Promise<TransactionCandidateRow | null> {
  const query = supabase
    .from('transactions')
    .select('id,user_id,amount,type,created_at,reference_number,note,category')
    .eq('user_id', userId)
    .eq('id', transactionId)
    .maybeSingle();

  return await executeRead<TransactionCandidateRow | null>(query);
}

async function fetchRecentTransactions(userId: string, limit: number): Promise<TransactionCandidateRow[]> {
  const query = supabase
    .from('transactions')
    .select('id,user_id,amount,type,created_at,reference_number,note,category')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(limit);

  return (await executeRead<TransactionCandidateRow[]>(query)) || [];
}

async function fetchKnownOwners(userId: string): Promise<KnownOwnerWithLabel[]> {
  const [bankAccounts, creditCards, debitCards] = await Promise.all([
    executeRead<BankAccountRow[]>(
      supabase
        .from('bank_accounts')
        .select('id,user_id,bank_name,account_last4,account_type')
        .eq('user_id', userId)
        .in('account_type', ['savings', 'current'])
    ),
    executeRead<CreditCardRow[]>(
      supabase
        .from('credit_cards')
        .select('id,user_id,bank_name,card_name,last_4_digits')
        .eq('user_id', userId)
    ),
    executeRead<DebitCard[]>(
      supabase
        .from('debit_cards')
        .select('id,user_id,bank_account_id,bank_name,card_last4,card_network,card_label,status,detected_confidence,source_sender_or_package,last_seen_at,created_at,updated_at')
        .eq('user_id', userId)
        .in('status', ['active', 'detected'])
    ),
  ]);

  return buildKnownOwners({
    bankAccounts: bankAccounts || [],
    creditCards: creditCards || [],
    debitCards: debitCards || [],
  });
}

async function fetchActiveMappings(userId: string): Promise<KnownMapping[]> {
  const query = supabase
    .from('account_app_mappings')
    .select('id,user_id,app_package,app_label,payment_method_hash,payment_method_masked,owner_type,owner_id,account_last4,card_last4,bank_name,confidence_level,use_count,last_confirmed_at,status,created_at,updated_at')
    .eq('user_id', userId)
    .eq('status', 'active');

  return buildKnownMappings((await executeRead<AccountAppMapping[]>(query)) || []);
}

export async function getRecentReconciliationProposals(
  options: GetRecentReconciliationProposalsOptions = {}
): Promise<TransactionReconciliationProposal[]> {
  const userId = await getCurrentUserId();
  const limit = clampLimit(options.limit, DEFAULT_LIMIT, 100);
  const evidencePoolLimit = clampLimit(options.evidencePoolLimit, DEFAULT_EVIDENCE_POOL_LIMIT, 200);
  const transactionLimit = clampLimit(options.transactionLimit, DEFAULT_TRANSACTION_LIMIT, 200);
  const windowMs = options.windowMs || DEFAULT_WINDOW_MS;

  const [seeds, evidencePool, owners, mappings, transactions] = await Promise.all([
    fetchRecentEvidence(userId, limit),
    fetchRecentEvidence(userId, evidencePoolLimit),
    fetchKnownOwners(userId),
    fetchActiveMappings(userId),
    fetchRecentTransactions(userId, transactionLimit),
  ]);

  return buildProposalsFromSeeds(seeds, evidencePool, owners, mappings, transactions, windowMs);
}

export async function getProposalsForTransaction(
  transactionId: string
): Promise<TransactionReconciliationProposal[]> {
  const userId = await getCurrentUserId();
  const [transaction, transactionEvidence, evidencePool, owners, mappings] = await Promise.all([
    fetchTransactionById(userId, transactionId),
    fetchEvidenceForTransaction(userId, transactionId),
    fetchRecentEvidence(userId, DEFAULT_EVIDENCE_POOL_LIMIT),
    fetchKnownOwners(userId),
    fetchActiveMappings(userId),
  ]);

  if (!transaction) return [];

  const transactionSeedEvidence = evidencePool.filter(evidence =>
    transactionMatchesEvidence(transaction, toReconciliationEvidence(evidence), DEFAULT_WINDOW_MS)
  );
  const seedsById = new Map(
    [...transactionEvidence, ...transactionSeedEvidence].map(evidence => [evidence.id, evidence])
  );

  return buildProposalsFromSeeds(
    Array.from(seedsById.values()),
    [...evidencePool, ...transactionEvidence],
    owners,
    mappings,
    [transaction],
    DEFAULT_WINDOW_MS
  );
}

export async function getProposalsForEvidence(
  evidenceId: string
): Promise<TransactionReconciliationProposal[]> {
  const userId = await getCurrentUserId();
  const [seed, evidencePool, owners, mappings, transactions] = await Promise.all([
    fetchEvidenceById(userId, evidenceId),
    fetchRecentEvidence(userId, DEFAULT_EVIDENCE_POOL_LIMIT),
    fetchKnownOwners(userId),
    fetchActiveMappings(userId),
    fetchRecentTransactions(userId, DEFAULT_TRANSACTION_LIMIT),
  ]);

  if (!seed) return [];

  return buildProposalsFromSeeds(
    [seed],
    [seed, ...evidencePool],
    owners,
    mappings,
    transactions,
    DEFAULT_WINDOW_MS
  );
}
