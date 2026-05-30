export type ReconciliationOwnerType = 'bank_account' | 'credit_card' | 'debit_card';
export type ReconciliationSourceType = 'sms' | 'notification' | 'accessibility' | 'manual' | 'imported';
export type ReconciliationDirection = 'debit' | 'credit' | 'transfer' | 'unknown';
export type ReconciliationInstrumentHint =
  | 'bank_account'
  | 'debit_card'
  | 'credit_card'
  | 'wallet'
  | 'loan'
  | 'unknown';
export type ReconciliationConfidence = 'exact' | 'high' | 'medium' | 'low';
export type ReconciliationDecision =
  | 'link_existing_transaction'
  | 'attach_account'
  | 'create_unknown_transaction'
  | 'review_required'
  | 'ignore';
export type ReconciliationMatchStatus = 'linked' | 'ambiguous' | 'review_required' | 'unlinked';
export type ReconciliationReasonCode =
  | 'same_reference_bank_evidence'
  | 'amount_time_single_bank_evidence'
  | 'user_mapping_hint'
  | 'payment_app_only'
  | 'upi_only_not_bank_proof'
  | 'multiple_bank_candidates'
  | 'conflicting_direction'
  | 'conflicting_reference'
  | 'missing_bank_evidence'
  | 'ambiguous_payment_method'
  | 'insufficient_evidence';

export interface ReconciliationEvidence {
  id: string;
  sourceType: ReconciliationSourceType;
  sourcePackage?: string | null;
  sourceApp?: string | null;
  amount?: number | null;
  direction?: ReconciliationDirection | null;
  capturedAt: number;
  referenceNumber?: string | null;
  merchantOrPerson?: string | null;
  bankName?: string | null;
  accountLast4?: string | null;
  cardLast4?: string | null;
  instrumentHint?: ReconciliationInstrumentHint | null;
  upiIdMasked?: string | null;
  upiIdHash?: string | null;
}

export interface KnownAccount {
  id: string;
  ownerType: ReconciliationOwnerType;
  bankName?: string | null;
  accountLast4?: string | null;
  cardLast4?: string | null;
}

export interface KnownMapping {
  id: string;
  appPackage: string;
  paymentMethodHash?: string | null;
  ownerType: ReconciliationOwnerType;
  ownerId: string;
  confidenceLevel: 'medium' | 'low';
  status: 'active' | 'disabled';
}

export interface ExistingTransactionCandidate {
  id: string;
  amount?: number | null;
  direction?: ReconciliationDirection | null;
  capturedAt?: number | null;
  referenceNumber?: string | null;
}

export interface ReconciliationResult {
  decision: ReconciliationDecision;
  confidence: ReconciliationConfidence;
  matchStatus: ReconciliationMatchStatus;
  matchedOwnerType?: ReconciliationOwnerType | null;
  matchedOwnerId?: string | null;
  matchedEvidenceIds: string[];
  reasonCode: ReconciliationReasonCode;
  explanationTokens: string[];
  score: number;
}

export interface ReconciliationInput {
  evidences?: ReconciliationEvidence[];
  paymentEvidence?: ReconciliationEvidence | null;
  bankEvidence?: ReconciliationEvidence | null;
  knownAccounts?: KnownAccount[];
  knownMappings?: KnownMapping[];
  existingTransactions?: ExistingTransactionCandidate[];
  windowMs?: number;
}

export interface ConfidenceClassificationInput {
  exactReference?: boolean;
  amountTimeSingleBankEvidence?: boolean;
  mappingConfidence?: 'medium' | 'low' | null;
  paymentAppOnly?: boolean;
}

export interface ReviewClassificationInput {
  multipleBankCandidates?: boolean;
  directionConflict?: boolean;
  referenceConflict?: boolean;
  missingBankEvidence?: boolean;
  upiOnly?: boolean;
  ambiguousPaymentMethod?: boolean;
  insufficientEvidence?: boolean;
  unsupportedRoute?: boolean;
}

const DEFAULT_TIME_WINDOW_MS = 2 * 60 * 1000;
const AMOUNT_TOLERANCE = 0.01;
const MIN_REFERENCE_LENGTH = 6;

function emptyResult(reasonCode: ReconciliationReasonCode, tokens: string[]): ReconciliationResult {
  return {
    decision: reasonCode === 'insufficient_evidence' ? 'ignore' : 'review_required',
    confidence: 'low',
    matchStatus: reasonCode === 'insufficient_evidence' ? 'unlinked' : 'review_required',
    matchedOwnerType: null,
    matchedOwnerId: null,
    matchedEvidenceIds: [],
    reasonCode,
    explanationTokens: tokens,
    score: 0,
  };
}

function reviewResult(
  reasonCode: ReconciliationReasonCode,
  matchedEvidenceIds: string[],
  tokens: string[],
  score = 20
): ReconciliationResult {
  return {
    decision: 'review_required',
    confidence: 'low',
    matchStatus: reasonCode === 'multiple_bank_candidates' ? 'ambiguous' : 'review_required',
    matchedOwnerType: null,
    matchedOwnerId: null,
    matchedEvidenceIds,
    reasonCode,
    explanationTokens: tokens,
    score,
  };
}

function linkedResult(
  confidence: ReconciliationConfidence,
  reasonCode: ReconciliationReasonCode,
  matchedEvidenceIds: string[],
  owner: KnownAccount,
  tokens: string[],
  score: number,
  hasExistingTransactionCandidate: boolean
): ReconciliationResult {
  return {
    decision: hasExistingTransactionCandidate ? 'link_existing_transaction' : 'attach_account',
    confidence,
    matchStatus: 'linked',
    matchedOwnerType: owner.ownerType,
    matchedOwnerId: owner.id,
    matchedEvidenceIds,
    reasonCode,
    explanationTokens: tokens,
    score,
  };
}

function normalizeToken(value?: string | null): string {
  return (value || '').trim().toUpperCase().replace(/[^A-Z0-9]+/g, '');
}

function normalizeName(value?: string | null): string[] {
  return (value || '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, ' ')
    .split(/\s+/)
    .filter(token => token.length >= 3 && !['BANK', 'LIMITED', 'LTD', 'THE'].includes(token));
}

export function normalizeReference(reference?: string | null): string | null {
  if (!reference) return null;

  let normalized = reference.trim().toUpperCase();
  normalized = normalized.replace(
    /^(?:UPI\s*)?(?:REF(?:ERENCE)?\s*NO|REF(?:ERENCE)?|UTR|TXN\s*ID|TXN|TRANSACTION|RRN)[:#\-\s]*/i,
    ''
  );
  normalized = normalized.replace(/[^A-Z0-9]/g, '');

  if (normalized.length < MIN_REFERENCE_LENGTH) return null;
  if (/^(?:91)?[6-9]\d{9}$/.test(normalized)) return null;

  return normalized;
}

export function isReferenceMatch(a?: string | null, b?: string | null): boolean {
  const normalizedA = normalizeReference(a);
  const normalizedB = normalizeReference(b);
  return Boolean(normalizedA && normalizedB && normalizedA === normalizedB);
}

export function isCloseTime(
  a?: number | null,
  b?: number | null,
  windowMs = DEFAULT_TIME_WINDOW_MS
): boolean {
  if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
  return Math.abs(Number(a) - Number(b)) <= windowMs;
}

export function isAmountMatch(a?: number | null, b?: number | null): boolean {
  if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
  return Math.abs(Number(a) - Number(b)) <= AMOUNT_TOLERANCE;
}

export function classifyAccountMatchConfidence(
  input: ConfidenceClassificationInput
): ReconciliationConfidence {
  if (input.exactReference) return 'exact';
  if (input.amountTimeSingleBankEvidence) return 'high';
  if (input.mappingConfidence === 'medium') return 'medium';
  if (input.mappingConfidence === 'low') return 'low';
  return 'low';
}

export function shouldRequireReview(input: ReviewClassificationInput): boolean {
  return Boolean(
    input.multipleBankCandidates ||
    input.directionConflict ||
    input.referenceConflict ||
    input.missingBankEvidence ||
    input.upiOnly ||
    input.ambiguousPaymentMethod ||
    input.insufficientEvidence ||
    input.unsupportedRoute
  );
}

function uniqueEvidences(input: ReconciliationInput): ReconciliationEvidence[] {
  const all = [
    ...(input.evidences || []),
    ...(input.paymentEvidence ? [input.paymentEvidence] : []),
    ...(input.bankEvidence ? [input.bankEvidence] : []),
  ];
  const byId = new Map<string, ReconciliationEvidence>();
  for (const evidence of all) {
    byId.set(evidence.id, evidence);
  }
  return Array.from(byId.values());
}

function safeLast4(value?: string | null): string | null {
  const digits = (value || '').replace(/\D/g, '');
  return digits.length === 4 ? digits : null;
}

function hasBankProof(evidence: ReconciliationEvidence): boolean {
  return Boolean(safeLast4(evidence.accountLast4) || safeLast4(evidence.cardLast4));
}

function isPaymentAppSignal(evidence: ReconciliationEvidence): boolean {
  return Boolean(
    !hasBankProof(evidence) &&
    (evidence.sourceType === 'notification' ||
      evidence.sourceType === 'accessibility' ||
      evidence.sourcePackage ||
      evidence.upiIdHash ||
      evidence.upiIdMasked)
  );
}

function directionsConflict(evidences: ReconciliationEvidence[]): boolean {
  const directions = new Set(
    evidences
      .map(evidence => evidence.direction)
      .filter((direction): direction is ReconciliationDirection =>
        Boolean(direction && direction !== 'unknown')
      )
  );

  return directions.size > 1;
}

function referencesConflict(evidences: ReconciliationEvidence[]): boolean {
  const paymentReferences = evidences
    .filter(isPaymentAppSignal)
    .map(evidence => normalizeReference(evidence.referenceNumber))
    .filter((reference): reference is string => Boolean(reference));
  const bankReferences = evidences
    .filter(hasBankProof)
    .map(evidence => normalizeReference(evidence.referenceNumber))
    .filter((reference): reference is string => Boolean(reference));

  if (!paymentReferences.length || !bankReferences.length) return false;

  return new Set([...paymentReferences, ...bankReferences]).size > 1;
}

function bankNameCompatible(evidenceName?: string | null, accountName?: string | null): boolean {
  const evidenceTokens = normalizeName(evidenceName);
  const accountTokens = normalizeName(accountName);
  if (!evidenceTokens.length || !accountTokens.length) return true;

  return evidenceTokens.some(token => accountTokens.includes(token));
}

function accountMatchesEvidence(account: KnownAccount, evidence: ReconciliationEvidence): boolean {
  if (!bankNameCompatible(evidence.bankName, account.bankName)) return false;

  const accountLast4 = safeLast4(evidence.accountLast4);
  const cardLast4 = safeLast4(evidence.cardLast4);

  if (account.ownerType === 'bank_account') {
    return Boolean(
      accountLast4 &&
      safeLast4(account.accountLast4) === accountLast4 &&
      (!evidence.instrumentHint ||
        evidence.instrumentHint === 'bank_account' ||
        evidence.instrumentHint === 'unknown')
    );
  }

  if (account.ownerType === 'credit_card') {
    return Boolean(
      cardLast4 &&
      safeLast4(account.cardLast4) === cardLast4 &&
      (!evidence.instrumentHint ||
        evidence.instrumentHint === 'credit_card' ||
        evidence.instrumentHint === 'unknown')
    );
  }

  return Boolean(
    cardLast4 &&
    safeLast4(account.cardLast4) === cardLast4 &&
    (!evidence.instrumentHint ||
      evidence.instrumentHint === 'debit_card' ||
      evidence.instrumentHint === 'unknown')
  );
}

function matchingOwners(evidence: ReconciliationEvidence, knownAccounts: KnownAccount[]): KnownAccount[] {
  const matches = knownAccounts.filter(account => accountMatchesEvidence(account, evidence));
  const byOwner = new Map(matches.map(account => [`${account.ownerType}:${account.id}`, account]));
  return Array.from(byOwner.values());
}

function referencePairs(evidences: ReconciliationEvidence[]): Array<{
  payment: ReconciliationEvidence;
  bank: ReconciliationEvidence;
}> {
  const payments = evidences.filter(isPaymentAppSignal);
  const banks = evidences.filter(hasBankProof);
  const pairs = [];

  for (const payment of payments) {
    for (const bank of banks) {
      if (isReferenceMatch(payment.referenceNumber, bank.referenceNumber)) {
        pairs.push({ payment, bank });
      }
    }
  }

  return pairs;
}

function amountTimePairs(
  evidences: ReconciliationEvidence[],
  windowMs: number
): Array<{ payment: ReconciliationEvidence; bank: ReconciliationEvidence }> {
  const payments = evidences.filter(isPaymentAppSignal);
  const banks = evidences.filter(hasBankProof);
  const pairs = [];

  for (const payment of payments) {
    for (const bank of banks) {
      if (
        isAmountMatch(payment.amount, bank.amount) &&
        isCloseTime(payment.capturedAt, bank.capturedAt, windowMs)
      ) {
        pairs.push({ payment, bank });
      }
    }
  }

  return pairs;
}

function hasExistingTransactionCandidate(
  evidences: ReconciliationEvidence[],
  candidates: ExistingTransactionCandidate[],
  windowMs: number
): boolean {
  return candidates.some(candidate =>
    evidences.some(evidence =>
      isReferenceMatch(candidate.referenceNumber, evidence.referenceNumber) ||
      (
        isAmountMatch(candidate.amount, evidence.amount) &&
        isCloseTime(candidate.capturedAt, evidence.capturedAt, windowMs)
      )
    )
  );
}

function merchantOverlap(a?: string | null, b?: string | null): boolean {
  const aTokens = normalizeName(a);
  const bTokens = normalizeName(b);
  if (!aTokens.length || !bTokens.length) return false;
  return aTokens.some(token => bTokens.includes(token));
}

function hasMerchantOverlap(pair: { payment: ReconciliationEvidence; bank: ReconciliationEvidence }): boolean {
  return merchantOverlap(pair.payment.merchantOrPerson, pair.bank.merchantOrPerson);
}

function activeMappingsForEvidence(
  evidence: ReconciliationEvidence,
  knownMappings: KnownMapping[]
): KnownMapping[] {
  const sourcePackage = (evidence.sourcePackage || '').trim();
  if (!sourcePackage) return [];

  return knownMappings.filter(mapping => {
    if (mapping.status !== 'active') return false;
    if (mapping.appPackage !== sourcePackage) return false;

    const mappingHash = normalizeToken(mapping.paymentMethodHash);
    const evidenceHash = normalizeToken(evidence.upiIdHash);
    if (mappingHash && evidenceHash) return mappingHash === evidenceHash;
    if (mappingHash && !evidenceHash) return false;

    return true;
  });
}

function resultFromMapping(
  evidences: ReconciliationEvidence[],
  knownMappings: KnownMapping[]
): ReconciliationResult | null {
  const payments = evidences.filter(isPaymentAppSignal);
  const matches = payments.flatMap(evidence =>
    activeMappingsForEvidence(evidence, knownMappings).map(mapping => ({ evidence, mapping }))
  );

  if (!matches.length) return null;

  const owners = new Map(matches.map(match => [
    `${match.mapping.ownerType}:${match.mapping.ownerId}`,
    match,
  ]));

  if (owners.size > 1) {
    return reviewResult(
      'ambiguous_payment_method',
      matches.map(match => match.evidence.id),
      ['mapping_ambiguous', 'review_required'],
      35
    );
  }

  const { evidence, mapping } = Array.from(owners.values())[0];
  const confidence = classifyAccountMatchConfidence({ mappingConfidence: mapping.confidenceLevel });

  return {
    decision: 'attach_account',
    confidence,
    matchStatus: 'linked',
    matchedOwnerType: mapping.ownerType,
    matchedOwnerId: mapping.ownerId,
    matchedEvidenceIds: [evidence.id],
    reasonCode: 'user_mapping_hint',
    explanationTokens: ['user_mapping_hint', `mapping_${confidence}`],
    score: confidence === 'medium' ? 55 : 45,
  };
}

function hasUpiOnlyEvidence(evidences: ReconciliationEvidence[]): boolean {
  return evidences.some(evidence =>
    isPaymentAppSignal(evidence) &&
    Boolean(evidence.upiIdHash || evidence.upiIdMasked) &&
    !hasBankProof(evidence)
  );
}

function hasUnsupportedRouteAmbiguity(evidences: ReconciliationEvidence[]): boolean {
  return evidences.some(evidence => {
    const text = `${evidence.instrumentHint || ''} ${evidence.merchantOrPerson || ''} ${evidence.sourceApp || ''}`
      .toLowerCase();

    return (
      text.includes('credit_card_bill_payment') ||
      text.includes('credit card bill') ||
      /\bemi\b/.test(text) ||
      /\bloan\b/.test(text) ||
      /\brefund\b/.test(text) ||
      text.includes('self_transfer') ||
      text.includes('self transfer') ||
      evidence.instrumentHint === 'loan'
    );
  });
}

function applyBankPairMatch(
  pairs: Array<{ payment: ReconciliationEvidence; bank: ReconciliationEvidence }>,
  knownAccounts: KnownAccount[],
  existingTransactions: ExistingTransactionCandidate[],
  windowMs: number,
  exact: boolean
): ReconciliationResult | null {
  if (!pairs.length) return null;

  const candidates = pairs.flatMap(pair =>
    matchingOwners(pair.bank, knownAccounts).map(owner => ({ pair, owner }))
  );

  if (!candidates.length) {
    return reviewResult(
      'missing_bank_evidence',
      pairs.flatMap(pair => [pair.payment.id, pair.bank.id]),
      ['bank_evidence_unmatched', 'review_required'],
      exact ? 60 : 45
    );
  }

  const uniqueOwners = new Map(candidates.map(candidate => [
    `${candidate.owner.ownerType}:${candidate.owner.id}`,
    candidate,
  ]));

  if (uniqueOwners.size > 1 || pairs.length > 1) {
    return reviewResult(
      'multiple_bank_candidates',
      candidates.flatMap(candidate => [candidate.pair.payment.id, candidate.pair.bank.id]),
      ['multiple_bank_candidates', 'review_required'],
      exact ? 70 : 50
    );
  }

  const candidate = Array.from(uniqueOwners.values())[0];
  const confidence = classifyAccountMatchConfidence({
    exactReference: exact,
    amountTimeSingleBankEvidence: !exact,
  });
  const merchantBoost = hasMerchantOverlap(candidate.pair);
  const tokens = exact
    ? ['reference_match', 'bank_evidence', 'owner_unique']
    : ['amount_match', 'time_close', 'bank_evidence', 'owner_unique'];
  if (merchantBoost) tokens.push('merchant_overlap');

  return linkedResult(
    confidence,
    exact ? 'same_reference_bank_evidence' : 'amount_time_single_bank_evidence',
    [candidate.pair.payment.id, candidate.pair.bank.id],
    candidate.owner,
    tokens,
    exact ? 100 : merchantBoost ? 86 : 80,
    hasExistingTransactionCandidate(
      [candidate.pair.payment, candidate.pair.bank],
      existingTransactions,
      windowMs
    )
  );
}

export function reconcileEvidenceSet(input: ReconciliationInput): ReconciliationResult {
  const evidences = uniqueEvidences(input);
  const knownAccounts = input.knownAccounts || [];
  const knownMappings = input.knownMappings || [];
  const existingTransactions = input.existingTransactions || [];
  const windowMs = input.windowMs || DEFAULT_TIME_WINDOW_MS;

  if (!evidences.length) {
    return emptyResult('insufficient_evidence', ['no_evidence']);
  }

  if (evidences.some(evidence => !Number.isFinite(evidence.amount))) {
    return reviewResult(
      'insufficient_evidence',
      evidences.map(evidence => evidence.id),
      ['amount_missing', 'review_required']
    );
  }

  if (directionsConflict(evidences)) {
    return reviewResult(
      'conflicting_direction',
      evidences.map(evidence => evidence.id),
      ['direction_conflict', 'review_required'],
      30
    );
  }

  if (referencesConflict(evidences)) {
    return reviewResult(
      'conflicting_reference',
      evidences.map(evidence => evidence.id),
      ['reference_conflict', 'review_required'],
      30
    );
  }

  const exactResult = applyBankPairMatch(
    referencePairs(evidences),
    knownAccounts,
    existingTransactions,
    windowMs,
    true
  );
  if (exactResult) return exactResult;

  if (hasUnsupportedRouteAmbiguity(evidences)) {
    return reviewResult(
      'ambiguous_payment_method',
      evidences.map(evidence => evidence.id),
      ['special_route', 'review_required'],
      35
    );
  }

  const highResult = applyBankPairMatch(
    amountTimePairs(evidences, windowMs),
    knownAccounts,
    existingTransactions,
    windowMs,
    false
  );
  if (highResult) return highResult;

  const mappingResult = resultFromMapping(evidences, knownMappings);
  if (mappingResult) return mappingResult;

  const paymentSignals = evidences.filter(isPaymentAppSignal);
  if (paymentSignals.length) {
    if (hasUpiOnlyEvidence(paymentSignals)) {
      return reviewResult(
        'upi_only_not_bank_proof',
        paymentSignals.map(evidence => evidence.id),
        ['upi_only_not_bank_proof', 'review_required'],
        15
      );
    }

    return reviewResult(
      'payment_app_only',
      paymentSignals.map(evidence => evidence.id),
      ['payment_app_only', 'missing_bank_evidence', 'review_required'],
      15
    );
  }

  return reviewResult(
    'insufficient_evidence',
    evidences.map(evidence => evidence.id),
    ['insufficient_evidence', 'review_required']
  );
}

export function scoreEvidenceMatch(input: ReconciliationInput): ReconciliationResult {
  return reconcileEvidenceSet(input);
}
