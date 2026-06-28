import { processSms, processNotification } from './TransactionProcessors';
import type { SmsData, ProcessorResult } from './TransactionProcessors';
import { showTransactionConfirmation } from '../services/notifications';
import { parseTransactionAmount } from '../../utils/amountParsing';

// ═══════════════════════════════════════════════════════════════════════════════
// IN-BATCH DEDUP TRACKER
// Prevents duplicate processing when SMS + bank notification + UPI notification
// for the same real-world transaction arrive simultaneously in the same batch.
// ═══════════════════════════════════════════════════════════════════════════════

interface BatchProcessedEntry {
  amount: number;
  type: string;
  accountLast4?: string | null;
  transactionId: string | null;
  timestamp: number;
}

const IN_BATCH_DEDUP_WINDOW_MS = 60_000; // 1 minute

function isInBatchDuplicate(
  entry: BatchProcessedEntry,
  amount: number,
  type: string,
  accountLast4?: string | null,
  timestamp?: number,
): boolean {
  if (entry.amount !== amount) return false;

  // Same type = definite duplicate; opposing types (income vs expense) = potential
  // self-transfer, which should be handled by the processor (not suppressed here).
  if (entry.type !== type) return false;

  // If both have accountLast4 and they differ, it's a different account → not a duplicate.
  if (entry.accountLast4 && accountLast4 && entry.accountLast4 !== accountLast4) return false;

  // Timestamp proximity check
  if (timestamp && Math.abs(entry.timestamp - timestamp) > IN_BATCH_DEDUP_WINDOW_MS) return false;

  return true;
}

function extractSignalAmount(signal: QueuedSignal): number | null {
  let text = '';
  if (signal.type === 'sms') {
    text = signal.data?.body || '';
  } else {
    // Notification: try multiple fields
    if (typeof signal.data?.notification === 'string') {
      try { text = JSON.stringify(JSON.parse(signal.data.notification)); } catch { text = signal.data.notification; }
    } else {
      text = [signal.data?.title, signal.data?.text, signal.data?.bigText].filter(Boolean).join(' ');
    }
  }
  // Use the shared parser so this matches the stored amount (balance/limit excluded,
  // foreign-currency spends converted) — keeps in-batch dedup aligned with the processors.
  return parseTransactionAmount(text)?.amountInr ?? null;
}

interface QueuedSignal {
  id: string;
  type: 'sms' | 'notification';
  data: any;
  resolve: () => void;
  reject: (error: any) => void;
  timestamp: number;
}

let signalQueue: QueuedSignal[] = [];
let queueTimeout: ReturnType<typeof setTimeout> | null = null;
let queueStartedAt: number | null = null;
let activeQueueDrain: Promise<void> | null = null;
const QUEUE_DELAY_MS = 2000;
const QUEUE_MAX_WAIT_MS = 10000;

export function enqueueSms(data: SmsData): Promise<void> {
  return new Promise((resolve, reject) => {
    signalQueue.push({ id: Math.random().toString(), type: 'sms', data, resolve, reject, timestamp: Date.now() });
    startQueueTimer();
  });
}

export function enqueueNotification(data: any): Promise<void> {
  return new Promise((resolve, reject) => {
    signalQueue.push({ id: Math.random().toString(), type: 'notification', data, resolve, reject, timestamp: Date.now() });
    startQueueTimer();
  });
}

function startQueueTimer() {
  const now = Date.now();
  if (queueStartedAt === null) {
    queueStartedAt = now;
  }

  if (queueTimeout) {
    clearTimeout(queueTimeout);
  }

  const elapsedMs = now - queueStartedAt;
  const delayMs = elapsedMs >= QUEUE_MAX_WAIT_MS ? 0 : QUEUE_DELAY_MS;

  if (__DEV__) console.log('[TransactionQueue] Scheduling batch', {
    delayMs,
    queueSize: signalQueue.length,
  });

  queueTimeout = setTimeout(() => {
    queueTimeout = null;
    void processQueue();
  }, delayMs);
}

export async function processPendingSmsQueue(): Promise<void> {
  if (queueTimeout) {
    clearTimeout(queueTimeout);
    queueTimeout = null;
  }

  await processQueue();
}

export function getQueueLength(): number {
  return signalQueue.length;
}

async function processQueue(): Promise<void> {
  if (activeQueueDrain) {
    return activeQueueDrain;
  }

  activeQueueDrain = drainQueue().finally(() => {
    activeQueueDrain = null;
    if (signalQueue.length > 0 && !queueTimeout) {
      startQueueTimer();
    }
  });

  return activeQueueDrain;
}

async function drainQueue(): Promise<void> {
  const currentQueue = [...signalQueue];
  signalQueue = [];
  queueStartedAt = signalQueue.length > 0 ? Date.now() : null;

  if (currentQueue.length === 0) {
    if (__DEV__) console.log('[TransactionQueue] Drain requested with empty queue');
    return;
  }

  if (__DEV__) console.log('[TransactionQueue] Processing batch', {
    batchSize: currentQueue.length,
  });

  const results: ProcessorResult[] = [];
  const batchProcessed: BatchProcessedEntry[] = [];
  let resolveCount = 0;
  let rejectCount = 0;
  let inBatchDeduped = 0;

  for (const signal of currentQueue) {
    try {
      // ── In-batch dedup: check if we already processed this transaction ──
      const signalAmount = extractSignalAmount(signal);
      if (signalAmount !== null && batchProcessed.length > 0) {
        const batchMatch = batchProcessed.find(entry =>
          isInBatchDuplicate(entry, signalAmount, entry.type, undefined, signal.timestamp)
        );
        if (batchMatch) {
          if (__DEV__) console.log('[TransactionQueue] In-batch duplicate suppressed', {
            amount: signalAmount,
            signalType: signal.type,
            matchedTransactionId: batchMatch.transactionId,
          });
          // Mark as resolved but produce a skipped result to maintain consistent accounting
          if (batchMatch.transactionId) {
            results.push({
              transactionId: batchMatch.transactionId,
              type: batchMatch.type,
              note: '',
              amount: signalAmount,
              skipped: true,
            });
          }
          signal.resolve();
          resolveCount++;
          inBatchDeduped++;
          continue;
        }
      }

      let result: ProcessorResult | void;
      if (signal.type === 'sms') {
        result = await processSms(signal.data);
      } else {
        result = await processNotification(signal.data);
      }
      if (result) {
        results.push(result);
        // Register non-skipped results in the batch tracker for future in-batch dedup
        if (!result.skipped && result.transactionId) {
          batchProcessed.push({
            amount: result.amount,
            type: result.type,
            accountLast4: result.accountLast4,
            transactionId: result.transactionId,
            timestamp: signal.timestamp,
          });
        }
      }
      signal.resolve();
      resolveCount++;
    } catch (error) {
      if (__DEV__) console.error('[TransactionQueue] Signal processing failed:', error);
      signal.reject(error);
      rejectCount++;
    }
  }

  // Build final map: for each transactionId, keep the LATEST result
  // (later results are more accurate — e.g. transfer upgrade overwrites income)
  const finalResults = new Map<string, ProcessorResult>();
  for (const res of results) {
    if (!res.transactionId) continue;
    if (res.skipped) {
      // Skipped means it's a duplicate of something already in the map.
      // Do not overwrite a real result with a skipped one.
      if (!finalResults.has(res.transactionId)) {
        finalResults.set(res.transactionId, res);
      }
      continue;
    }
    // Non-skipped always overwrites (upgrade wins over original).
    finalResults.set(res.transactionId, res);
  }

  let saved = 0;
  let upgraded = 0;
  let skipped = 0;
  for (const res of finalResults.values()) {
    if (res.skipped) {
      skipped++;
      continue;
    }
    if (res.type === 'transfer') upgraded++;
    else saved++;
  }

  if (__DEV__) {
    console.log('[TransactionQueue] Batch complete', {
      batchSize: currentQueue.length,
      saved,
      upgraded,
      skipped,
      inBatchDeduped,
      notificationsFired: saved + upgraded,
      resolveCount,
      rejectCount,
    });
  }

  await BatchNotifier(finalResults);
}


async function BatchNotifier(finalResults: Map<string, ProcessorResult>) {
  for (const res of finalResults.values()) {
    if (res.skipped) continue;
    if (!res.transactionId || !res.note) continue;
    try {
      await showTransactionConfirmation(
        res.transactionId,
        res.type as any,
        res.note,
        res.amount,
        res.accountLast4,
        res.rawSms,
        undefined,
        undefined,
        res.classificationOptions
      );
    } catch (error) {
      if (__DEV__) console.error('[TransactionQueue] Notification failed (non-critical):', error);
    }
  }
}
