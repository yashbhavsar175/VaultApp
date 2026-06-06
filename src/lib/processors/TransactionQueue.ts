import { processSms, processNotification } from './TransactionProcessors';
import type { SmsData } from './TransactionProcessors';

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
const QUEUE_DELAY_MS = 5000;

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
  if (queueTimeout) return;
  queueTimeout = setTimeout(() => {
    void processQueue();
  }, QUEUE_DELAY_MS);
}

async function processQueue() {
  const currentQueue = [...signalQueue];
  signalQueue = [];
  queueTimeout = null;

  console.log(`[TransactionQueue] Processing ${currentQueue.length} queued signals after 5s delay`);

  // We process them sequentially. 
  // To properly pair self-transfers and avoid double notifications, 
  // TransactionProcessors needs to be modified to handle the queue context,
  // or we pass a flag to suppress immediate notifications.
  
  // For now, we pass `true` as the second argument to processSms/processNotification
  // to indicate it's running from the queue and should handle notifications smartly.

  for (const signal of currentQueue) {
    try {
      if (signal.type === 'sms') {
        // @ts-ignore - we will add the second parameter
        await processSms(signal.data, true);
      } else {
        // @ts-ignore
        await processNotification(signal.data, true);
      }
      signal.resolve();
    } catch (e) {
      console.error('[TransactionQueue] Error processing signal:', e);
      signal.reject(e);
    }
  }

  console.log(`[TransactionQueue] Finished processing batch`);
}
