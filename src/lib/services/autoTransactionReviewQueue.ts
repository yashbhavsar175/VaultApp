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
    
    // 1. Dedupe by duplicateFingerprints
    const isDuplicate = queue.some(item => 
      item.candidate.duplicateFingerprints.some(existingPrint => 
        candidate.duplicateFingerprints.some(newPrint => 
          existingPrint.strategy === newPrint.strategy && existingPrint.value === newPrint.value
        )
      )
    );
    
    if (isDuplicate) {
      return false; // Silently deduplicated
    }

    // 2. Safely omit rawText (ensure no raw SMS body is stored in queue)
    const { ...safeCandidate } = candidate;
    // Remove any hidden rawText properties that could have leaked from custom input
    if ('rawText' in safeCandidate) {
      delete (safeCandidate as any).rawText;
    }
    if ('rawSignalText' in safeCandidate) {
      delete (safeCandidate as any).rawSignalText;
    }

    // 3. Set reasons
    const reasons = customReasons || getReasonsForCandidate(candidate);

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
