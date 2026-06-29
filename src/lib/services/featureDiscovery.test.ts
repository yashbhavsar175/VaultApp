import AsyncStorage from '@react-native-async-storage/async-storage';
import { getNextFeatureTip, dismissTipForever, markTipShown, resetFeatureDiscovery } from './featureDiscovery';
import { recordFeatureUsage, clearTransactionBlackBoxStore, __resetTransactionBlackBoxCacheForTests } from './transactionBlackBox';

const DAY = 24 * 60 * 60 * 1000;

async function seedFirstSeen(msAgo: number) {
  await AsyncStorage.setItem(
    'feature_discovery_v1',
    JSON.stringify({ version: 1, firstSeenAt: Date.now() - msAgo, shown: {}, dismissedForever: [] })
  );
}

beforeEach(async () => {
  await AsyncStorage.clear();
  __resetTransactionBlackBoxCacheForTests();
  await clearTransactionBlackBoxStore();
});

describe('featureDiscovery eligibility', () => {
  it('returns nothing during the grace period', async () => {
    await seedFirstSeen(0); // just installed
    expect(await getNextFeatureTip()).toBeNull();
  });

  it('suggests an unused feature once past the grace period', async () => {
    await seedFirstSeen(5 * DAY);
    const tip = await getNextFeatureTip();
    expect(tip).not.toBeNull();
    expect(tip?.route).toBeTruthy();
  });

  it('skips a feature the user has already used', async () => {
    await seedFirstSeen(5 * DAY);
    const first = await getNextFeatureTip();
    expect(first).not.toBeNull();
    await recordFeatureUsage(first!.key);

    const next = await getNextFeatureTip();
    expect(next?.key).not.toBe(first!.key);
  });

  it('never suggests a feature dismissed forever', async () => {
    await seedFirstSeen(5 * DAY);
    const tip = await getNextFeatureTip();
    await dismissTipForever(tip!.key);

    // Exhaust the rest by dismissing whatever comes next until null.
    let guard = 0;
    let current = await getNextFeatureTip();
    while (current && guard < 10) {
      expect(current.key).not.toBe(tip!.key);
      await dismissTipForever(current.key);
      current = await getNextFeatureTip();
      guard += 1;
    }
    expect(current).toBeNull();
  });

  it('enforces the global cooldown after showing a tip', async () => {
    await seedFirstSeen(5 * DAY);
    const tip = await getNextFeatureTip();
    await markTipShown(tip!.key);
    // A tip was just shown -> within global cooldown, nothing else surfaces.
    expect(await getNextFeatureTip()).toBeNull();
  });

  it('resets cleanly', async () => {
    await seedFirstSeen(5 * DAY);
    await resetFeatureDiscovery();
    // After reset, firstSeenAt is now -> grace period blocks again.
    expect(await getNextFeatureTip()).toBeNull();
  });
});
