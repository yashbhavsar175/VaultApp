import AsyncStorage from '@react-native-async-storage/async-storage';
import { SmartCandidate } from './transactionIntelligence';
import { getTransactions, supabase } from '../core';
import { emitFinanceDataChanged } from './dataEvents';
import {
  REVIEW_QUEUE_BASE_KEY,
  USER_QUEUE_ACTIONS,
  getQueueOwnerId,
  loadUserScopedQueue,
  logUserQueueAction,
  saveUserScopedQueue,
} from './userScopedQueues';

const STORAGE_KEY = REVIEW_QUEUE_BASE_KEY;
const SELF_TRANSFER_PAIR_WINDOW_MS = 15 * 60 * 1000;
const AMOUNT_EPSILON = 0.01;

function emitReviewQueueChanged(): void {
  emitFinanceDataChanged({
    areas: ['review'],
    source: 'review_queue:changed',
  });
}

export interface ReviewItem {
  id: string;
  candidate: Omit<SmartCandidate, 'rawText'>;
  reasons: string[];
  status: 'pending' | 'posted' | 'ignored' | 'reviewed';
  createdAt: number;
  createdTransactionId?: string;
  user_id?: string;
  queueOwnerId?: string;
}

async function getCurrentUserId(): Promise<string | null> {
  const { data: { user } } = await supabase.auth.getUser();
  return user?.id || null;
}

function isValidReviewItem(item: unknown): item is ReviewItem {
  return Boolean(item && typeof item === 'object' && (item as ReviewItem).id);
}

function candidateTimestamp(candidate: Pick<SmartCandidate, 'signalId'>): number | null {
  const match = candidate.signalId?.match(/^sig_(\d+)_/);
  if (!match) return null;
  const timestamp = Number.parseInt(match[1], 10);
  return Number.isFinite(timestamp) ? timestamp : null;
}

function hasFingerprintOverlap(
  existing: Pick<SmartCandidate, 'duplicateFingerprints'>,
  incoming: Pick<SmartCandidate, 'duplicateFingerprints'>
): boolean {
  return existing.duplicateFingerprints.some(existingPrint =>
    incoming.duplicateFingerprints.some(newPrint =>
      existingPrint.strategy === newPrint.strategy && existingPrint.value === newPrint.value
    )
  );
}

function isCardPaymentCandidate(candidate: Pick<SmartCandidate, 'autoClass' | 'instrumentHint' | 'reference'>): boolean {
  return candidate.autoClass === 'credit_card_bill_payment' ||
    (candidate.instrumentHint === 'credit_card' && Boolean(candidate.reference));
}

function sameDefinedValue(left?: string | null, right?: string | null): boolean {
  return Boolean(left && right && left === right);
}

function isRelatedCardPaymentCandidate(
  existing: ReviewItem,
  incoming: Omit<SmartCandidate, 'rawText'>
): boolean {
  if (!isCardPaymentCandidate(existing.candidate) && !isCardPaymentCandidate(incoming)) {
    return false;
  }
  if (existing.candidate.amount !== incoming.amount) return false;

  if (sameDefinedValue(existing.candidate.reference, incoming.reference)) {
    return true;
  }

  const existingTime = candidateTimestamp(existing.candidate);
  const incomingTime = candidateTimestamp(incoming);
  const isNearTime = existingTime !== null && incomingTime !== null &&
    Math.abs(existingTime - incomingTime) <= 10 * 60 * 1000;
  if (!isNearTime) return false;

  return sameDefinedValue(existing.candidate.accountLast4, incoming.accountLast4) ||
    sameDefinedValue(existing.candidate.cardLast4, incoming.cardLast4) ||
    Boolean(existing.candidate.cardLast4 || incoming.cardLast4);
}

function isSameAmount(left?: number | null, right?: number | null): boolean {
  if (left == null || right == null) return false;
  return Math.abs(Number(left) - Number(right)) <= AMOUNT_EPSILON;
}

function isDebitLike(candidate: Pick<SmartCandidate, 'direction' | 'autoClass'>): boolean {
  return candidate.direction === 'debit' ||
    ['bank_debit', 'upi_payment', 'personal_transfer'].includes(candidate.autoClass);
}

function isCreditLike(candidate: Pick<SmartCandidate, 'direction' | 'autoClass'>): boolean {
  return candidate.direction === 'credit' ||
    ['bank_credit', 'upi_received'].includes(candidate.autoClass);
}

function isSelfTransferRelated(candidate: Pick<SmartCandidate, 'autoClass'>): boolean {
  return candidate.autoClass === 'self_transfer';
}

function isPaymentAppSource(candidate: Pick<SmartCandidate, 'sourceType' | 'redactedPreview'>): boolean {
  const source = candidate.redactedPreview?.detectedSource || '';
  return candidate.sourceType === 'notification' ||
    /gpay|google|phonepe|paytm|super|money\.super|com\.google\.android\.apps\.nbu\.paisa\.user|money\.super\.payments/i.test(source);
}

function isBankSmsSource(candidate: Pick<SmartCandidate, 'sourceType' | 'redactedPreview'>): boolean {
  const source = candidate.redactedPreview?.detectedSource || '';
  return candidate.sourceType === 'sms' ||
    /hdfc|icici|sbi|axis|kotak|pnb|bank/i.test(source);
}

function isRelatedSelfTransferCandidate(
  existing: ReviewItem,
  incoming: Omit<SmartCandidate, 'rawText'>
): boolean {
  if (!isSameAmount(existing.candidate.amount, incoming.amount)) return false;

  const existingTime = candidateTimestamp(existing.candidate);
  const incomingTime = candidateTimestamp(incoming);
  if (existingTime === null || incomingTime === null) return false;
  if (Math.abs(existingTime - incomingTime) > SELF_TRANSFER_PAIR_WINDOW_MS) return false;

  if (sameDefinedValue(existing.candidate.reference, incoming.reference)) return true;

  const hasSelfTransferHint = isSelfTransferRelated(existing.candidate) || isSelfTransferRelated(incoming);
  const hasOppositeEvidence =
    (isDebitLike(existing.candidate) && isCreditLike(incoming)) ||
    (isCreditLike(existing.candidate) && isDebitLike(incoming)) ||
    hasSelfTransferHint;
  const hasBankAndPaymentApp =
    (isBankSmsSource(existing.candidate) && isPaymentAppSource(incoming)) ||
    (isPaymentAppSource(existing.candidate) && isBankSmsSource(incoming));

  return hasOppositeEvidence && hasBankAndPaymentApp;
}

function mergeFingerprints(
  existing: SmartCandidate['duplicateFingerprints'],
  incoming: SmartCandidate['duplicateFingerprints']
): SmartCandidate['duplicateFingerprints'] {
  const seen = new Set<string>();
  return [...existing, ...incoming].filter(fingerprint => {
    const key = `${fingerprint.strategy}:${fingerprint.value}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function mergeReasons(existing: string[], incoming: string[]): string[] {
  return [...existing, ...incoming].filter((reason, index, all) => all.indexOf(reason) === index);
}

function mergeCardPaymentCandidate(
  existing: Omit<SmartCandidate, 'rawText'>,
  incoming: Omit<SmartCandidate, 'rawText'>
): Omit<SmartCandidate, 'rawText'> {
  const cardLast4 = existing.cardLast4 || incoming.cardLast4 || null;
  const accountLast4 = existing.accountLast4 || incoming.accountLast4 || null;
  const primaryLast4 = cardLast4 || existing.last4 || incoming.last4 || null;

  return {
    ...existing,
    ...incoming,
    signalId: existing.signalId,
    sourceType: existing.sourceType || incoming.sourceType,
    evidenceId: existing.evidenceId || incoming.evidenceId || null,
    paymentAppAccountMatch: existing.paymentAppAccountMatch || incoming.paymentAppAccountMatch || null,
    autoClass: 'credit_card_bill_payment',
    direction: 'neutral',
    amount: existing.amount ?? incoming.amount,
    merchantOrPerson: existing.merchantOrPerson || incoming.merchantOrPerson || null,
    last4: primaryLast4,
    accountLast4,
    cardLast4,
    reference: existing.reference || incoming.reference,
    instrumentHint: 'credit_card',
    confidenceScore: Math.max(existing.confidenceScore, incoming.confidenceScore),
    confidenceLevel: existing.confidenceLevel === 'high' || incoming.confidenceLevel === 'high'
      ? 'high'
      : existing.confidenceLevel === 'medium' || incoming.confidenceLevel === 'medium'
        ? 'medium'
        : 'low',
    decision: 'review_required',
    duplicateFingerprints: mergeFingerprints(existing.duplicateFingerprints, incoming.duplicateFingerprints),
    redactedPreview: {
      ...existing.redactedPreview,
      ...incoming.redactedPreview,
      autoClass: 'credit_card_bill_payment',
      maskedLast4: cardLast4 ? `XX${cardLast4}` : existing.redactedPreview.maskedLast4 || incoming.redactedPreview.maskedLast4,
    },
  };
}

function mergeSafeSourceToken(left?: string | null, right?: string | null): string {
  const tokens = [left, right]
    .map(value => (value || '').replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 48))
    .filter(Boolean);
  return [...new Set(tokens)].join('_') || 'paired_sources';
}

function mergeSelfTransferCandidate(
  existing: Omit<SmartCandidate, 'rawText'>,
  incoming: Omit<SmartCandidate, 'rawText'>
): Omit<SmartCandidate, 'rawText'> {
  const accountLast4 = existing.accountLast4 || incoming.accountLast4 || existing.last4 || incoming.last4 || null;
  const confidenceScore = Math.max(existing.confidenceScore, incoming.confidenceScore, 70);

  return {
    ...existing,
    ...incoming,
    signalId: existing.signalId,
    sourceType: existing.sourceType || incoming.sourceType,
    evidenceId: existing.evidenceId || incoming.evidenceId || null,
    paymentAppAccountMatch: existing.paymentAppAccountMatch || incoming.paymentAppAccountMatch || null,
    autoClass: 'self_transfer',
    direction: 'neutral',
    amount: existing.amount ?? incoming.amount,
    merchantOrPerson: null,
    last4: accountLast4,
    accountLast4,
    cardLast4: existing.cardLast4 || incoming.cardLast4 || null,
    reference: existing.reference || incoming.reference,
    instrumentHint: existing.instrumentHint === 'bank_account' || incoming.instrumentHint === 'bank_account'
      ? 'bank_account'
      : existing.instrumentHint || incoming.instrumentHint,
    confidenceScore,
    confidenceLevel: confidenceScore >= 85 ? 'high' : 'medium',
    decision: 'review_required',
    duplicateFingerprints: mergeFingerprints(existing.duplicateFingerprints, incoming.duplicateFingerprints),
    redactedPreview: {
      ...existing.redactedPreview,
      ...incoming.redactedPreview,
      amount: existing.amount ?? incoming.amount ?? undefined,
      detectedSource: mergeSafeSourceToken(
        existing.redactedPreview.detectedSource,
        incoming.redactedPreview.detectedSource,
      ),
      autoClass: 'self_transfer',
      maskedLast4: accountLast4 ? `XX${accountLast4}` : existing.redactedPreview.maskedLast4 || incoming.redactedPreview.maskedLast4,
      hashSummary: existing.redactedPreview.hashSummary || incoming.redactedPreview.hashSummary,
    },
  };
}

function omitUnsafeCandidateFields(candidate: SmartCandidate): Omit<SmartCandidate, 'rawText'> {
  const { ...safeCandidate } = candidate;
  if ('rawText' in safeCandidate) {
    delete (safeCandidate as any).rawText;
  }
  if ('rawSignalText' in safeCandidate) {
    delete (safeCandidate as any).rawSignalText;
  }
  return safeCandidate;
}

async function getReviewQueueForUser(userId: string): Promise<ReviewItem[]> {
  const parsed = await loadUserScopedQueue<ReviewItem>(STORAGE_KEY, userId);
  const validItems = parsed.filter(isValidReviewItem);
  let skippedOwnerMismatch = 0;

  const ownedItems = validItems.filter(item => {
    const ownerId = getQueueOwnerId(item);
    const isOwner = ownerId === userId;
    if (!isOwner) skippedOwnerMismatch++;
    return isOwner;
  });

  if (skippedOwnerMismatch > 0 || ownedItems.length !== parsed.length) {
    await saveUserScopedQueue(STORAGE_KEY, userId, ownedItems);
  }

  if (skippedOwnerMismatch > 0) {
    logUserQueueAction(STORAGE_KEY, USER_QUEUE_ACTIONS.skipped, skippedOwnerMismatch);
  }

  return ownedItems;
}

export function getReasonsForCandidate(candidate: SmartCandidate): string[] {
  const reasons: string[] = [];
  if (candidate.confidenceLevel === 'low') {
    reasons.push('Low confidence detection');
  } else if (candidate.confidenceLevel === 'medium') {
    reasons.push('Medium confidence detection');
  }
  if (candidate.autoClass === 'unknown_financial') {
    reasons.push('Unknown transaction category');
  }
  if (candidate.instrumentHint === 'unknown') {
    reasons.push('Could not verify bank account or credit card');
  }
  if (!candidate.reference) {
    reasons.push('No UTR/Reference ID found');
  }
  if (reasons.length === 0) {
    reasons.push('Requires review before adding to database');
  }
  return reasons;
}

export async function getReviewQueue(): Promise<ReviewItem[]> {
  try {
    const userId = await getCurrentUserId();
    if (!userId) return [];

    return getReviewQueueForUser(userId);
  } catch (e) {
    console.error('Failed to parse auto transaction review queue, fallback to empty:', e);
    return [];
  }
}

export async function enqueueReviewCandidate(
  candidate: SmartCandidate,
  customReasons?: string[],
  queueOwnerId?: string,
): Promise<boolean> {
  try {
    const userId = queueOwnerId || await getCurrentUserId();
    if (!userId) {
      logUserQueueAction(STORAGE_KEY, USER_QUEUE_ACTIONS.skipped, 1);
      return false;
    }

    const queue = await getReviewQueueForUser(userId);
    const safeCandidate = omitUnsafeCandidateFields(candidate);

    // 1. Set reasons
    const reasons = customReasons || getReasonsForCandidate(candidate);

    // 2. Dedupe and enrich related card-payment evidence instead of discarding later proof.
    const duplicateIndex = queue.findIndex(item =>
      hasFingerprintOverlap(item.candidate, safeCandidate) ||
      isRelatedCardPaymentCandidate(item, safeCandidate) ||
      isRelatedSelfTransferCandidate(item, safeCandidate)
    );

    if (duplicateIndex >= 0) {
      const duplicateItem = queue[duplicateIndex];
      if (isRelatedCardPaymentCandidate(duplicateItem, safeCandidate)) {
        queue[duplicateIndex] = {
          ...duplicateItem,
          candidate: mergeCardPaymentCandidate(duplicateItem.candidate, safeCandidate),
          reasons: mergeReasons(duplicateItem.reasons, reasons),
        };
        await saveUserScopedQueue(STORAGE_KEY, userId, queue);
        emitReviewQueueChanged();
      } else if (isRelatedSelfTransferCandidate(duplicateItem, safeCandidate)) {
        const existingTime = candidateTimestamp(duplicateItem.candidate);
        const incomingTime = candidateTimestamp(safeCandidate);
        queue[duplicateIndex] = {
          ...duplicateItem,
          candidate: mergeSelfTransferCandidate(duplicateItem.candidate, safeCandidate),
          reasons: mergeReasons(duplicateItem.reasons, [
            ...reasons,
            'Paired bank debit and payment-app credit need transfer review',
          ]),
        };
        await saveUserScopedQueue(STORAGE_KEY, userId, queue);
        emitReviewQueueChanged();
        console.log('[SelfTransferPairing] Review candidate merged', {
          pairedEvidenceFound: true,
          amount: safeCandidate.amount,
          timeWindowMs: existingTime !== null && incomingTime !== null
            ? Math.abs(existingTime - incomingTime)
            : null,
          routeDecision: 'review_queue',
          reasonCode: 'self_transfer',
          queueAction: 'merge',
        });
      }
      return false;
    }

    // 3. Create the new safe review item.
    const newItem: ReviewItem = {
      id: candidate.signalId || `sig_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      candidate: safeCandidate,
      reasons,
      status: 'pending',
      createdAt: Date.now(),
      user_id: userId,
      queueOwnerId: userId,
    };

    // 4. Max 200 bound check (Newest first, truncate to 200)
    let newQueue = [newItem, ...queue];
    if (newQueue.length > 200) {
      newQueue = newQueue.slice(0, 200);
    }

    await saveUserScopedQueue(STORAGE_KEY, userId, newQueue);
    return true;
  } catch (e) {
    console.error('Failed to enqueue review candidate:', e);
    return false;
  }
}

export async function markReviewed(id: string): Promise<boolean> {
  try {
    const userId = await getCurrentUserId();
    if (!userId) return false;

    const queue = await getReviewQueueForUser(userId);
    const index = queue.findIndex(item => item.id === id);
    if (index === -1) return false;

    queue[index].status = 'reviewed';
    await saveUserScopedQueue(STORAGE_KEY, userId, queue);
    emitReviewQueueChanged();
    return true;
  } catch (e) {
    console.error('Failed to mark item reviewed:', e);
    return false;
  }
}

export async function markIgnored(id: string): Promise<boolean> {
  try {
    const userId = await getCurrentUserId();
    if (!userId) return false;

    const queue = await getReviewQueueForUser(userId);
    const index = queue.findIndex(item => item.id === id);
    if (index === -1) return false;

    queue[index].status = 'ignored';
    await saveUserScopedQueue(STORAGE_KEY, userId, queue);
    emitReviewQueueChanged();
    return true;
  } catch (e) {
    console.error('Failed to mark item ignored:', e);
    return false;
  }
}

export async function getPendingCount(): Promise<number> {
  try {
    const queue = await getReviewQueue();
    return queue.filter(item => item.status === 'pending').length;
  } catch (e) {
    console.error('Failed to get pending count:', e);
    return 0;
  }
}

export async function markPosted(id: string, transactionId?: string): Promise<boolean> {
  try {
    const userId = await getCurrentUserId();
    if (!userId) return false;

    const queue = await getReviewQueueForUser(userId);
    const index = queue.findIndex(item => item.id === id);
    if (index === -1) return false;

    queue[index].status = 'posted';
    if (transactionId) {
      queue[index].createdTransactionId = transactionId;
    }
    await saveUserScopedQueue(STORAGE_KEY, userId, queue);
    emitReviewQueueChanged();
    return true;
  } catch (e) {
    console.error('Failed to mark item posted:', e);
    return false;
  }
}

export async function updateReviewCandidatePaymentAppMatch(
  id: string,
  paymentAppAccountMatch: NonNullable<SmartCandidate['paymentAppAccountMatch']>
): Promise<boolean> {
  try {
    const userId = await getCurrentUserId();
    if (!userId) return false;

    const queue = await getReviewQueueForUser(userId);
    const index = queue.findIndex(item => item.id === id);
    if (index === -1 || queue[index].status !== 'pending') return false;

    queue[index].candidate.paymentAppAccountMatch = paymentAppAccountMatch;
    await saveUserScopedQueue(STORAGE_KEY, userId, queue);
    emitReviewQueueChanged();
    return true;
  } catch (e) {
    console.error('Failed to update payment app account match:', e);
    return false;
  }
}

export async function checkForDuplicateTransaction(candidate: Omit<SmartCandidate, 'rawText'>): Promise<boolean> {
  try {
    const transactions = await getTransactions();
    
    // 1. Match by reference_number if candidate has a reference
    if (candidate.reference) {
      const found = transactions.some(tx => 
        tx.reference_number && 
        tx.reference_number.toLowerCase() === candidate.reference!.toLowerCase()
      );
      if (found) return true;
    }

    // 2. Fallback: amount + type + time (within 10 minutes)
    const match = candidate.signalId.match(/^sig_(\d+)_/);
    const candidateTime = match ? parseInt(match[1], 10) : Date.now();
    
    const mappedType = candidate.direction === 'credit' ? 'income' : 'expense';

    return transactions.some(tx => {
      if (tx.amount !== candidate.amount) return false;
      if (tx.type !== mappedType) return false;
      
      const txTime = new Date(tx.created_at).getTime();
      const diffMs = Math.abs(txTime - candidateTime);
      if (diffMs > 10 * 60 * 1000) return false;

      return true;
    });
  } catch (e) {
    console.error('Error checking for duplicate transaction:', e);
    return false;
  }
}

export async function clearReviewQueue(): Promise<void> {
  try {
    const userId = await getCurrentUserId();
    if (!userId) return;

    await AsyncStorage.removeItem(`${STORAGE_KEY}:user:${userId}`);
  } catch (e) {
    console.error('Failed to clear review queue:', e);
  }
}
