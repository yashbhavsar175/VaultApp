import { processSms, processNotification } from './TransactionProcessors';
import type { SmsData, ProcessorResult } from './TransactionProcessors';
import { showTransactionConfirmation } from '../services/notifications';

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
  let resolveCount = 0;
  let rejectCount = 0;

  for (const signal of currentQueue) {
    try {
      let result: ProcessorResult | void;
      if (signal.type === 'sms') {
        result = await processSms(signal.data);
      } else {
        result = await processNotification(signal.data);
      }
      if (result) results.push(result);
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
