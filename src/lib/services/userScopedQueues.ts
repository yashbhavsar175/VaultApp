import AsyncStorage from '@react-native-async-storage/async-storage';

export const OFFLINE_TX_QUEUE_BASE_KEY = 'offline_tx_queue';
export const OFFLINE_DELETE_QUEUE_BASE_KEY = 'offline_delete_queue';

export const USER_QUEUE_ACTIONS = {
  quarantined: 'quarantined',
  skipped: 'skipped',
  cleared: 'cleared',
} as const;

type QueueAction = typeof USER_QUEUE_ACTIONS[keyof typeof USER_QUEUE_ACTIONS];

export type OwnedQueueEntry<T extends object = Record<string, unknown>> = T & {
  user_id?: string;
  queueOwnerId?: string;
};

const queueLocks = new Map<string, Promise<unknown>>();

export function getUserScopedQueueKey(baseKey: string, userId: string): string {
  return `${baseKey}:user:${userId}`;
}

export async function withUserScopedQueueLock<T>(
  baseKey: string,
  userId: string,
  operation: () => Promise<T>,
): Promise<T> {
  const key = getUserScopedQueueKey(baseKey, userId);
  const previous = queueLocks.get(key) || Promise.resolve();
  const current = previous.catch(() => undefined).then(operation);
  queueLocks.set(key, current);

  try {
    return await current;
  } finally {
    if (queueLocks.get(key) === current) {
      queueLocks.delete(key);
    }
  }
}

// Bug #14 fix: check trimmed value karta tha but raw return karta tha — whitespace ID mismatch cause karta tha
function normalizeId(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function getQueueOwnerId(entry: unknown): string | null {
  if (!entry || typeof entry !== 'object') return null;

  const record = entry as { queueOwnerId?: unknown; user_id?: unknown };
  return normalizeId(record.queueOwnerId) ?? normalizeId(record.user_id) ?? null;
}

export function withQueueOwner<T extends object>(
  entry: T,
  userId: string,
): OwnedQueueEntry<T> {
  return {
    ...entry,
    user_id: userId,
    queueOwnerId: userId,
  };
}

export function logUserQueueAction(queueName: string, action: QueueAction, count: number): void {
  console.warn('[UserScopedQueue]', {
    queueName,
    action,
    count,
  });
}

function getArrayCount(raw: string | null): number {
  if (!raw) return 0;

  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.length : 0;
  } catch {
    return 0;
  }
}

const MAX_QUARANTINE_KEYS = 3;

export async function quarantineLegacyQueue(baseKey: string): Promise<void> {
  const raw = await AsyncStorage.getItem(baseKey);
  if (!raw) return;

  const quarantinePrefix = `${baseKey}:legacy_quarantine:`;

  // Bug #H3 fix: purge old quarantine entries before adding a new one.
  // Previously these accumulated forever; AsyncStorage size limits could cause silent write failures.
  try {
    const allKeys = await AsyncStorage.getAllKeys();
    const existingKeys = allKeys
      .filter(k => k.startsWith(quarantinePrefix))
      .sort(); // timestamp-suffixed keys sort chronologically

    // Keep at most MAX_QUARANTINE_KEYS - 1 so the new entry fits within the cap.
    const keysToRemove = existingKeys.slice(
      0,
      Math.max(0, existingKeys.length - (MAX_QUARANTINE_KEYS - 1))
    );
    if (keysToRemove.length > 0) {
      await AsyncStorage.multiRemove(keysToRemove);
    }
  } catch {
    // GC is best-effort — proceed with the quarantine write regardless.
  }

  const count = getArrayCount(raw);
  await AsyncStorage.setItem(`${quarantinePrefix}${Date.now()}`, raw);
  await AsyncStorage.removeItem(baseKey);
  logUserQueueAction(baseKey, USER_QUEUE_ACTIONS.quarantined, count);
}

export async function loadUserScopedQueue<T extends object>(
  baseKey: string,
  userId: string,
): Promise<T[]> {
  await quarantineLegacyQueue(baseKey);

  const raw = await AsyncStorage.getItem(getUserScopedQueueKey(baseKey, userId));
  if (!raw) return [];

  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed as T[];
  } catch {
    // Handled below as invalid active queue data.
  }

  await AsyncStorage.removeItem(getUserScopedQueueKey(baseKey, userId));
  logUserQueueAction(baseKey, USER_QUEUE_ACTIONS.quarantined, 0);
  return [];
}

export async function saveUserScopedQueue<T extends object>(
  baseKey: string,
  userId: string,
  queue: T[],
): Promise<void> {
  const key = getUserScopedQueueKey(baseKey, userId);
  if (queue.length > 0) {
    await AsyncStorage.setItem(key, JSON.stringify(queue));
  } else {
    await AsyncStorage.removeItem(key);
  }
}

export async function appendUserScopedQueueItem<T extends object>(
  baseKey: string,
  userId: string,
  item: T,
): Promise<void> {
  await withUserScopedQueueLock(baseKey, userId, async () => {
    const queue = await loadUserScopedQueue<OwnedQueueEntry<T>>(baseKey, userId);
    queue.push(withQueueOwner(item, userId));
    await saveUserScopedQueue(baseKey, userId, queue);
  });
}

export async function clearUserScopedQueue(baseKey: string, userId: string): Promise<void> {
  const key = getUserScopedQueueKey(baseKey, userId);
  const raw = await AsyncStorage.getItem(key);
  const count = getArrayCount(raw);
  await AsyncStorage.removeItem(key);
  if (count > 0) {
    logUserQueueAction(baseKey, USER_QUEUE_ACTIONS.cleared, count);
  }
}

export async function clearFinancialQueuesForUser(userId: string): Promise<void> {
  await Promise.all([
    clearUserScopedQueue(OFFLINE_TX_QUEUE_BASE_KEY, userId),
    clearUserScopedQueue(OFFLINE_DELETE_QUEUE_BASE_KEY, userId),
  ]);
}
