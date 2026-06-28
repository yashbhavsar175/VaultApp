import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  OFFLINE_TX_QUEUE_BASE_KEY,
  appendUserScopedQueueItem,
  getUserScopedQueueKey,
} from './userScopedQueues';

describe('user-scoped offline queues', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
    jest.clearAllMocks();
  });

  it('serializes concurrent appends for the same user queue', async () => {
    await Promise.all([
      appendUserScopedQueueItem(OFFLINE_TX_QUEUE_BASE_KEY, 'user_a', {
        amount: 100,
        note: 'first queued transaction',
      }),
      appendUserScopedQueueItem(OFFLINE_TX_QUEUE_BASE_KEY, 'user_a', {
        amount: 200,
        note: 'second queued transaction',
      }),
    ]);

    const raw = await AsyncStorage.getItem(getUserScopedQueueKey(OFFLINE_TX_QUEUE_BASE_KEY, 'user_a'));
    const queue = JSON.parse(raw || '[]');

    expect(queue).toHaveLength(2);
    expect(queue).toEqual(expect.arrayContaining([
      expect.objectContaining({ amount: 100, queueOwnerId: 'user_a', user_id: 'user_a' }),
      expect.objectContaining({ amount: 200, queueOwnerId: 'user_a', user_id: 'user_a' }),
    ]));
  });
});
