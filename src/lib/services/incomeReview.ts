import { supabase } from '../core';
import { IncomeEvent, IncomeSourceType as CoachIncomeSourceType } from './debtFreedom';
import { Transaction, TransactionEvidence } from '../../types';

export type IncomeReviewDecisionValue = 'count_as_income' | 'not_income' | 'needs_review';
export type IncomeReviewIncomeSourceType =
  | 'salary'
  | 'gig_work'
  | 'freelance'
  | 'business'
  | 'cash_deposit'
  | 'other';
export type IncomeReviewConfidence = 'user_confirmed' | 'system_suggested';

export interface IncomeReviewDecision {
  id: string;
  user_id: string;
  transaction_id: string | null;
  evidence_id: string | null;
  signal_hash: string | null;
  decision: IncomeReviewDecisionValue;
  income_source_type: IncomeReviewIncomeSourceType | null;
  confidence: IncomeReviewConfidence;
  reason_code: string | null;
  reviewed_at: string;
  created_at: string;
  updated_at: string;
}

export interface IncomeReviewCandidate {
  id: string;
  candidateType: 'transaction' | 'evidence' | 'signal';
  transactionId?: string | null;
  evidenceId?: string | null;
  signalHash?: string | null;
  amount: number;
  receivedAt: string;
  sourceHint:
    | 'upi_credit'
    | 'bank_credit'
    | 'gig_payout'
    | 'salary'
    | 'refund'
    | 'personal_transfer'
    | 'unknown';
  suggestedDecision: IncomeReviewDecisionValue;
  suggestedIncomeSourceType?: IncomeReviewIncomeSourceType | null;
  safeLabel: string;
  safeReason: string;
  confidence: 'high' | 'medium' | 'low' | 'needs_review';
  currentDecision?: IncomeReviewDecision | null;
}

export type IncomeReviewDecisionInput = Partial<{
  transaction_id: string | null;
  evidence_id: string | null;
  signal_hash: string | null;
  decision: IncomeReviewDecisionValue;
  income_source_type: IncomeReviewIncomeSourceType | null;
  confidence: IncomeReviewConfidence;
  reason_code: string | null;
}>;

export type IncomeReviewStorageStatus = 'ready' | 'missing';

export interface IncomeReviewScreenState {
  candidates: IncomeReviewCandidate[];
  storageStatus: IncomeReviewStorageStatus;
}

export interface GetIncomeReviewCandidatesOptions {
  transactions?: Transaction[];
  evidence?: TransactionEvidence[];
  decisions?: IncomeReviewDecision[];
  showExcluded?: boolean;
  limit?: number;
}

const DECISIONS = new Set<IncomeReviewDecisionValue>([
  'count_as_income',
  'not_income',
  'needs_review',
]);
const SOURCE_TYPES = new Set<IncomeReviewIncomeSourceType>([
  'salary',
  'gig_work',
  'freelance',
  'business',
  'cash_deposit',
  'other',
]);
const CONFIDENCES = new Set<IncomeReviewConfidence>(['user_confirmed', 'system_suggested']);
const DECISION_COLUMNS = [
  'id',
  'user_id',
  'transaction_id',
  'evidence_id',
  'signal_hash',
  'decision',
  'income_source_type',
  'confidence',
  'reason_code',
  'reviewed_at',
  'created_at',
  'updated_at',
].join(', ');
const TRANSACTION_COLUMNS = [
  'id',
  'user_id',
  'amount',
  'type',
  'note',
  'category',
  'created_at',
  'sms_source',
  'reference_number',
  'from_account_id',
  'to_account_id',
  'refund_of_transaction_id',
  'primary_evidence_id',
].join(', ');
const EVIDENCE_COLUMNS = [
  'id',
  'user_id',
  'signal_id',
  'transaction_id',
  'source_type',
  'source_package',
  'source_app',
  'amount',
  'direction',
  'captured_at',
  'merchant_or_person',
  'bank_name',
  'confidence_level',
  'match_status',
].join(', ');

const GIG_TOKENS = ['porter', 'swiggy', 'zomato', 'rapido', 'zepto', 'delivery', 'gig', 'payout', 'earning', 'earnings'];
const SALARY_TOKENS = ['salary'];
const FREELANCE_TOKENS = ['freelance', 'freelancing'];
const BUSINESS_TOKENS = ['business'];
const FAMILY_TRANSFER_TOKENS = ['family', 'friend', 'mom', 'dad', 'papa', 'mummy', 'mother', 'father', 'brother', 'sister', 'split'];
const PERSON_TRANSFER_TOKENS = ['person', 'personal transfer', 'upi from', 'received from', 'paid by'];
const CASH_DEPOSIT_TOKENS = ['cash deposit', 'cash deposited', 'bank deposit', 'deposit credited', 'deposited into'];
const REFUND_TOKENS = ['refund', 'reimbursement', 'reimburse'];
const BORROWED_TOKENS = ['borrowed', 'loan from friend'];
const TRANSFER_TOKENS = ['self transfer', 'own account', 'personal transfer'];

function normalizedText(...values: Array<string | null | undefined>): string {
  return values.filter(Boolean).join(' ').toLowerCase().replace(/\s+/g, ' ').trim();
}

function hasAnyToken(text: string, tokens: string[]): boolean {
  return tokens.some(token => text.includes(token));
}

function finitePositive(value?: number | null): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}

function isMissingTableError(error: unknown): boolean {
  const code = (error as { code?: string } | null)?.code;
  return code === '42P01' || code === '42703' || code === 'PGRST204' || code === 'PGRST205';
}

export function isIncomeReviewTableMissingError(error: unknown): boolean {
  return isMissingTableError(error);
}

function safeSignalHash(value?: string | null): string | null {
  const trimmed = value?.trim().toLowerCase();
  if (!trimmed) return null;
  return /^[a-f0-9]{8,128}$/.test(trimmed) ? trimmed : null;
}

function safeReasonCode(value?: string | null): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  return /^[a-z0-9_:-]{1,64}$/i.test(trimmed) ? trimmed : null;
}

function sanitizeDecisionInput(input: IncomeReviewDecisionInput) {
  if (!input.decision || !DECISIONS.has(input.decision)) {
    throw new Error('Invalid income review decision');
  }
  const incomeSourceType = input.income_source_type || null;
  if (incomeSourceType && !SOURCE_TYPES.has(incomeSourceType)) {
    throw new Error('Invalid income source type');
  }
  const confidence = input.confidence || 'user_confirmed';
  if (!CONFIDENCES.has(confidence)) {
    throw new Error('Invalid income review confidence');
  }

  const transactionId = input.transaction_id?.trim() || null;
  const evidenceId = input.evidence_id?.trim() || null;
  const signalHash = safeSignalHash(input.signal_hash);
  if (!transactionId && !evidenceId && !signalHash) {
    throw new Error('Income review decision needs a transaction, evidence, or signal hash');
  }

  return {
    transaction_id: transactionId,
    evidence_id: evidenceId,
    signal_hash: signalHash,
    decision: input.decision,
    income_source_type: input.decision === 'count_as_income' ? incomeSourceType : null,
    confidence,
    reason_code: safeReasonCode(input.reason_code),
    reviewed_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}

async function getCurrentUserId(): Promise<string> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user?.id) throw new Error('Not authenticated');
  return user.id;
}

async function ensureTransactionOwner(userId: string, transactionId: string): Promise<void> {
  const { error } = await supabase
    .from('transactions')
    .select('id')
    .eq('id', transactionId)
    .eq('user_id', userId)
    .single();
  if (error) throw error;
}

async function ensureEvidenceOwner(userId: string, evidenceId: string): Promise<void> {
  const { error } = await supabase
    .from('transaction_evidence')
    .select('id')
    .eq('id', evidenceId)
    .eq('user_id', userId)
    .single();
  if (error) throw error;
}

async function fetchTransactionsForUser(userId: string, limit: number): Promise<Transaction[]> {
  const { data, error } = await supabase
    .from('transactions')
    .select(TRANSACTION_COLUMNS)
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data || []) as unknown as Transaction[];
}

async function fetchEvidenceForUser(userId: string, limit: number): Promise<TransactionEvidence[]> {
  const { data, error } = await supabase
    .from('transaction_evidence')
    .select(EVIDENCE_COLUMNS)
    .eq('user_id', userId)
    .eq('direction', 'credit')
    .order('captured_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data || []) as unknown as TransactionEvidence[];
}

function decisionMatchesCandidate(
  decision: IncomeReviewDecision,
  candidate: Pick<IncomeReviewCandidate, 'transactionId' | 'evidenceId' | 'signalHash'>
): boolean {
  return Boolean(
    (candidate.transactionId && decision.transaction_id === candidate.transactionId)
    || (candidate.evidenceId && decision.evidence_id === candidate.evidenceId)
    || (candidate.signalHash && decision.signal_hash === candidate.signalHash)
  );
}

function decisionForCandidate(
  decisions: IncomeReviewDecision[],
  candidate: Pick<IncomeReviewCandidate, 'transactionId' | 'evidenceId' | 'signalHash'>
): IncomeReviewDecision | null {
  return decisions.find(decision => decisionMatchesCandidate(decision, candidate)) || null;
}

function candidateFromTransaction(tx: Transaction, decisions: IncomeReviewDecision[]): IncomeReviewCandidate | null {
  const amount = finitePositive(tx.amount);
  if (!amount) return null;

  const text = normalizedText(tx.category, tx.note, tx.sms_source);
  const base = {
    id: `transaction:${tx.id}`,
    candidateType: 'transaction' as const,
    transactionId: tx.id,
    evidenceId: tx.primary_evidence_id || null,
    signalHash: null,
    amount,
    receivedAt: tx.created_at,
  };

  let candidate: Omit<IncomeReviewCandidate, 'currentDecision'> | null = null;
  if (tx.refund_of_transaction_id || tx.type === 'refund' || hasAnyToken(text, REFUND_TOKENS)) {
    candidate = {
      ...base,
      sourceHint: 'refund',
      suggestedDecision: 'not_income',
      suggestedIncomeSourceType: null,
      safeLabel: 'Refund',
      safeReason: 'Refunds are not counted as income.',
      confidence: 'high',
    };
  } else if (tx.type === 'borrowed' || hasAnyToken(text, BORROWED_TOKENS)) {
    candidate = {
      ...base,
      sourceHint: 'personal_transfer',
      suggestedDecision: 'not_income',
      suggestedIncomeSourceType: null,
      safeLabel: 'Personal transfer',
      safeReason: 'Borrowed money is not counted as income.',
      confidence: 'high',
    };
  } else if (tx.type === 'transfer' || tx.from_account_id || tx.to_account_id || hasAnyToken(text, TRANSFER_TOKENS)) {
    candidate = {
      ...base,
      sourceHint: 'personal_transfer',
      suggestedDecision: 'not_income',
      suggestedIncomeSourceType: null,
      safeLabel: 'Personal transfer',
      safeReason: 'Self transfers are not counted as income.',
      confidence: 'high',
    };
  } else if (hasAnyToken(text, FAMILY_TRANSFER_TOKENS) || hasAnyToken(text, REFUND_TOKENS)) {
    candidate = {
      ...base,
      sourceHint: 'personal_transfer',
      suggestedDecision: 'not_income',
      suggestedIncomeSourceType: null,
      safeLabel: 'Personal transfer',
      safeReason: 'Family or friend transfers are not counted automatically.',
      confidence: 'medium',
    };
  } else if (hasAnyToken(text, CASH_DEPOSIT_TOKENS)) {
    candidate = {
      ...base,
      sourceHint: 'bank_credit',
      suggestedDecision: 'not_income',
      suggestedIncomeSourceType: null,
      safeLabel: 'Bank credit',
      safeReason: 'Cash deposits are not counted as income unless you review them.',
      confidence: 'medium',
    };
  } else if (tx.type === 'income' && hasAnyToken(text, SALARY_TOKENS)) {
    candidate = {
      ...base,
      sourceHint: 'salary',
      suggestedDecision: 'count_as_income',
      suggestedIncomeSourceType: 'salary',
      safeLabel: 'Possible salary',
      safeReason: 'This credit looks like salary, but you can override it.',
      confidence: 'high',
    };
  } else if (tx.type === 'income' && hasAnyToken(text, FREELANCE_TOKENS)) {
    candidate = {
      ...base,
      sourceHint: 'unknown',
      suggestedDecision: 'count_as_income',
      suggestedIncomeSourceType: 'freelance',
      safeLabel: 'Possible freelance income',
      safeReason: 'This credit looks like freelance income, but you can override it.',
      confidence: 'medium',
    };
  } else if (tx.type === 'income' && hasAnyToken(text, BUSINESS_TOKENS)) {
    candidate = {
      ...base,
      sourceHint: 'unknown',
      suggestedDecision: 'count_as_income',
      suggestedIncomeSourceType: 'business',
      safeLabel: 'Possible business income',
      safeReason: 'This credit looks like business income, but you can override it.',
      confidence: 'medium',
    };
  } else if (tx.type === 'income' && hasAnyToken(text, GIG_TOKENS)) {
    candidate = {
      ...base,
      sourceHint: 'gig_payout',
      suggestedDecision: 'count_as_income',
      suggestedIncomeSourceType: 'gig_work',
      safeLabel: 'Possible gig payout',
      safeReason: 'This credit looks like a gig payout, but you can override it.',
      confidence: 'medium',
    };
  } else if (tx.type === 'income') {
    const looksLikePersonCredit = hasAnyToken(text, PERSON_TRANSFER_TOKENS);
    candidate = {
      ...base,
      sourceHint: looksLikePersonCredit
        ? 'personal_transfer'
        : text.includes('upi') ? 'upi_credit' : text.includes('bank') ? 'bank_credit' : 'unknown',
      suggestedDecision: 'needs_review',
      suggestedIncomeSourceType: null,
      safeLabel: looksLikePersonCredit ? 'Person transfer' : text.includes('bank') ? 'Bank credit' : 'UPI credit',
      safeReason: 'Credit needs review before it can count as income.',
      confidence: 'needs_review',
    };
  }

  if (!candidate) return null;
  return {
    ...candidate,
    currentDecision: decisionForCandidate(decisions, candidate),
  };
}

function candidateFromEvidence(evidence: TransactionEvidence, decisions: IncomeReviewDecision[]): IncomeReviewCandidate | null {
  const amount = finitePositive(evidence.amount);
  if (!amount || evidence.direction !== 'credit') return null;
  const text = normalizedText(evidence.source_app, evidence.source_package, evidence.merchant_or_person, evidence.bank_name);
  const signalHash = safeSignalHash(evidence.signal_id);
  const base = {
    id: `evidence:${evidence.id}`,
    candidateType: 'evidence' as const,
    transactionId: evidence.transaction_id || null,
    evidenceId: evidence.id,
    signalHash,
    amount,
    receivedAt: evidence.captured_at,
  };

  const hasCounterpartyHint = Boolean(evidence.merchant_or_person?.trim());
  const candidate: Omit<IncomeReviewCandidate, 'currentDecision'> = hasAnyToken(text, GIG_TOKENS)
    ? {
        ...base,
        sourceHint: 'gig_payout',
        suggestedDecision: 'count_as_income',
        suggestedIncomeSourceType: 'gig_work',
        safeLabel: 'Possible gig payout',
        safeReason: 'This credit signal looks like a gig payout, but you can override it.',
        confidence: 'medium',
      }
    : hasAnyToken(text, FAMILY_TRANSFER_TOKENS)
      ? {
          ...base,
          sourceHint: 'personal_transfer',
          suggestedDecision: 'not_income',
          suggestedIncomeSourceType: null,
          safeLabel: 'Personal transfer',
          safeReason: 'Family or friend transfers are not counted automatically.',
          confidence: 'medium',
        }
    : hasAnyToken(text, CASH_DEPOSIT_TOKENS)
      ? {
          ...base,
          sourceHint: 'bank_credit',
          suggestedDecision: 'not_income',
          suggestedIncomeSourceType: null,
          safeLabel: 'Bank credit',
          safeReason: 'Cash deposits are not counted as income unless you review them.',
          confidence: 'medium',
        }
    : hasCounterpartyHint
      ? {
          ...base,
          sourceHint: 'personal_transfer',
          suggestedDecision: 'needs_review',
          suggestedIncomeSourceType: null,
          safeLabel: 'Person transfer',
          safeReason: 'Credit needs review before it can count as income.',
          confidence: 'needs_review',
        }
    : {
        ...base,
        sourceHint: evidence.source_type === 'sms' ? 'bank_credit' : 'upi_credit',
        suggestedDecision: 'needs_review',
        suggestedIncomeSourceType: null,
        safeLabel: evidence.source_type === 'sms' ? 'Bank credit' : 'UPI credit',
        safeReason: 'Credit needs review before it can count as income.',
        confidence: 'needs_review',
      };

  return {
    ...candidate,
    currentDecision: decisionForCandidate(decisions, candidate),
  };
}

function candidateIdentityKeys(candidate: IncomeReviewCandidate): string[] {
  return [
    candidate.transactionId ? `tx:${candidate.transactionId}` : null,
    candidate.evidenceId ? `ev:${candidate.evidenceId}` : null,
    candidate.signalHash ? `sig:${candidate.signalHash}` : null,
  ].filter((key): key is string => Boolean(key));
}

function candidateRank(candidate: IncomeReviewCandidate): number {
  if (candidate.candidateType === 'transaction') return 3;
  if (candidate.transactionId) return 2;
  if (candidate.candidateType === 'evidence') return 1;
  return 0;
}

function betterCandidate(
  current: IncomeReviewCandidate,
  next: IncomeReviewCandidate
): IncomeReviewCandidate {
  const rankDelta = candidateRank(next) - candidateRank(current);
  if (rankDelta > 0) return next;
  if (rankDelta < 0) return current;
  return new Date(next.receivedAt).getTime() > new Date(current.receivedAt).getTime() ? next : current;
}

function mergeCandidateCluster(cluster: IncomeReviewCandidate[]): IncomeReviewCandidate {
  const selected = cluster.reduce(betterCandidate);
  const transactionId = selected.transactionId || cluster.find(candidate => candidate.transactionId)?.transactionId || null;
  const evidenceId = selected.evidenceId || cluster.find(candidate => candidate.evidenceId)?.evidenceId || null;
  const signalHash = selected.signalHash || cluster.find(candidate => candidate.signalHash)?.signalHash || null;
  const currentDecision = selected.currentDecision || cluster.find(candidate => candidate.currentDecision)?.currentDecision || null;

  return {
    ...selected,
    id: transactionId ? `transaction:${transactionId}` : signalHash ? `signal:${signalHash}` : selected.id,
    transactionId,
    evidenceId,
    signalHash,
    currentDecision,
  };
}

function dedupeIncomeReviewCandidates(candidates: IncomeReviewCandidate[]): IncomeReviewCandidate[] {
  const clusters: IncomeReviewCandidate[][] = [];

  for (const candidate of candidates) {
    const keys = candidateIdentityKeys(candidate);
    const matchingIndexes = clusters
      .map((cluster, index) => (
        cluster.some(member => candidateIdentityKeys(member).some(key => keys.includes(key))) ? index : -1
      ))
      .filter(index => index >= 0);

    if (matchingIndexes.length === 0) {
      clusters.push([candidate]);
      continue;
    }

    const [firstIndex, ...restIndexes] = matchingIndexes;
    clusters[firstIndex].push(candidate);
    for (const index of restIndexes.reverse()) {
      clusters[firstIndex].push(...clusters[index]);
      clusters.splice(index, 1);
    }
  }

  return clusters.map(mergeCandidateCluster);
}

export function buildIncomeReviewCandidatesFromRows(
  rows: {
    transactions?: Transaction[];
    evidence?: TransactionEvidence[];
    decisions?: IncomeReviewDecision[];
  },
  options: Pick<GetIncomeReviewCandidatesOptions, 'showExcluded' | 'limit'> = {}
): IncomeReviewCandidate[] {
  const decisions = rows.decisions || [];
  const candidates = dedupeIncomeReviewCandidates([
    ...(rows.transactions || []).map(tx => candidateFromTransaction(tx, decisions)),
    ...(rows.evidence || []).map(evidence => candidateFromEvidence(evidence, decisions)),
  ]
    .filter((candidate): candidate is IncomeReviewCandidate => Boolean(candidate))
  )
    .filter(candidate => options.showExcluded || candidate.suggestedDecision !== 'not_income' || candidate.currentDecision)
    .sort((a, b) => new Date(b.receivedAt).getTime() - new Date(a.receivedAt).getTime());

  return candidates.slice(0, Math.max(1, Math.min(options.limit || 50, 200)));
}

export async function getIncomeReviewDecisions(): Promise<IncomeReviewDecision[]> {
  const userId = await getCurrentUserId();
  const { data, error } = await supabase
    .from('income_review_decisions')
    .select(DECISION_COLUMNS)
    .eq('user_id', userId)
    .order('reviewed_at', { ascending: false });

  if (error) {
    if (isMissingTableError(error)) return [];
    throw error;
  }
  return (data || []) as unknown as IncomeReviewDecision[];
}

async function getIncomeReviewDecisionsWithStatus(userId: string): Promise<{
  decisions: IncomeReviewDecision[];
  storageStatus: IncomeReviewStorageStatus;
}> {
  const { data, error } = await supabase
    .from('income_review_decisions')
    .select(DECISION_COLUMNS)
    .eq('user_id', userId)
    .order('reviewed_at', { ascending: false });

  if (error) {
    if (isMissingTableError(error)) return { decisions: [], storageStatus: 'missing' };
    throw error;
  }
  return { decisions: (data || []) as unknown as IncomeReviewDecision[], storageStatus: 'ready' };
}

export async function getIncomeReviewCandidates(
  options: GetIncomeReviewCandidatesOptions = {}
): Promise<IncomeReviewCandidate[]> {
  if (options.transactions || options.evidence || options.decisions) {
    return buildIncomeReviewCandidatesFromRows({
      transactions: options.transactions || [],
      evidence: options.evidence || [],
      decisions: options.decisions || [],
    }, options);
  }

  const userId = await getCurrentUserId();
  const { decisions } = await getIncomeReviewDecisionsWithStatus(userId);
  const limit = Math.max(1, Math.min(options.limit || 50, 200));
  const [transactions, evidence] = await Promise.all([
    fetchTransactionsForUser(userId, limit),
    fetchEvidenceForUser(userId, limit),
  ]);
  return buildIncomeReviewCandidatesFromRows({ transactions, evidence, decisions }, options);
}

export async function getIncomeReviewScreenState(
  options: GetIncomeReviewCandidatesOptions = {}
): Promise<IncomeReviewScreenState> {
  if (options.transactions || options.evidence || options.decisions) {
    return {
      candidates: buildIncomeReviewCandidatesFromRows({
        transactions: options.transactions || [],
        evidence: options.evidence || [],
        decisions: options.decisions || [],
      }, options),
      storageStatus: 'ready',
    };
  }

  const userId = await getCurrentUserId();
  const { decisions, storageStatus } = await getIncomeReviewDecisionsWithStatus(userId);
  const limit = Math.max(1, Math.min(options.limit || 50, 200));
  const [transactions, evidence] = await Promise.all([
    fetchTransactionsForUser(userId, limit),
    fetchEvidenceForUser(userId, limit),
  ]);

  return {
    candidates: buildIncomeReviewCandidatesFromRows({ transactions, evidence, decisions }, options),
    storageStatus,
  };
}

async function findExistingDecision(
  userId: string,
  payload: ReturnType<typeof sanitizeDecisionInput>
): Promise<IncomeReviewDecision | null> {
  const lookups: Array<[string, string | null]> = [
    ['transaction_id', payload.transaction_id],
    ['evidence_id', payload.evidence_id],
    ['signal_hash', payload.signal_hash],
  ];

  for (const [column, value] of lookups) {
    if (!value) continue;
    const { data, error } = await supabase
      .from('income_review_decisions')
      .select(DECISION_COLUMNS)
      .eq('user_id', userId)
      .eq(column, value)
      .maybeSingle();
    if (error) throw error;
    if (data) return data as unknown as IncomeReviewDecision;
  }

  return null;
}

export async function upsertIncomeReviewDecision(
  input: IncomeReviewDecisionInput
): Promise<IncomeReviewDecision> {
  const userId = await getCurrentUserId();
  const payload = sanitizeDecisionInput(input);

  if (payload.transaction_id) await ensureTransactionOwner(userId, payload.transaction_id);
  if (payload.evidence_id) await ensureEvidenceOwner(userId, payload.evidence_id);

  const existing = await findExistingDecision(userId, payload);
  const mutation = existing?.id
    ? supabase
        .from('income_review_decisions')
        .update(payload)
        .eq('id', existing.id)
        .eq('user_id', userId)
    : supabase
        .from('income_review_decisions')
        .insert({ ...payload, user_id: userId });

  const { data, error } = await mutation
    .select(DECISION_COLUMNS)
    .single();

  if (error) throw error;
  return data as unknown as IncomeReviewDecision;
}

export async function deleteIncomeReviewDecision(id: string): Promise<void> {
  const userId = await getCurrentUserId();
  const { error } = await supabase
    .from('income_review_decisions')
    .delete()
    .eq('id', id)
    .eq('user_id', userId);
  if (error) throw error;
}

function coachSourceType(sourceType: IncomeReviewIncomeSourceType | null): CoachIncomeSourceType {
  switch (sourceType) {
    case 'salary':
    case 'gig_work':
    case 'freelance':
    case 'business':
    case 'cash_deposit':
      return sourceType;
    default:
      return 'unknown';
  }
}

export function applyIncomeReviewDecisionsToIncomeEvents(
  incomeEvents: IncomeEvent[],
  decisions: IncomeReviewDecision[]
): IncomeEvent[] {
  return incomeEvents.map(event => {
    const decision = decisions.find(item => (
      item.transaction_id === event.id
      || item.evidence_id === event.id
      || item.signal_hash === event.metadata?.source
    ));
    if (!decision) return event;

    if (decision.decision === 'count_as_income') {
      return {
        ...event,
        sourceType: coachSourceType(decision.income_source_type),
        label: 'Reviewed income',
        confidence: 'confirmed',
        includeInIncome: true,
        exclusionReason: null,
      };
    }

    if (decision.decision === 'not_income') {
      return {
        ...event,
        label: 'Reviewed not income',
        confidence: 'excluded',
        includeInIncome: false,
        exclusionReason: 'unknown_credit',
        counterpartyLabel: null,
      };
    }

    return {
      ...event,
      label: 'Income needs review',
      confidence: 'needs_review',
      includeInIncome: false,
      exclusionReason: 'unknown_credit',
      counterpartyLabel: null,
    };
  });
}
