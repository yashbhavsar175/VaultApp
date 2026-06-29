/**
 * Feature Discovery
 * ────────────────────────────────────────────────────────────────────────────
 * Surfaces a polite, professional tip for a feature the user has NOT been using,
 * so powerful-but-hidden features get discovered. Eligibility is driven by the
 * on-device feature-usage counters ([transactionBlackBox.ts] recordFeatureUsage).
 *
 * Rules (deliberately non-naggy):
 *  - Only suggest features the user has never opened.
 *  - At most one tip per cooldown window, max a few times total per feature.
 *  - Respect a "don't show again" dismissal per feature.
 *  - Give the app a short grace period after first use before suggesting anything.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getFeatureUsageSummary } from './transactionBlackBox';

export interface FeatureTip {
  /** Must match the key passed to recordFeatureUsage() when the feature is opened. */
  key: string;
  title: string;
  /** One-line user benefit — why this is worth their time. */
  benefit: string;
  /** MaterialCommunityIcons name. */
  icon: string;
  /** Navigation route to open the feature. Must be a real registered route. */
  route: string;
  /** CTA label. */
  routeLabel: string;
}

// Routes below are confirmed-registered (see Settings navigation targets).
const FEATURE_CATALOG: FeatureTip[] = [
  {
    key: 'debt_freedom_coach',
    title: 'Debt Freedom Coach',
    benefit: 'Get a clear, read-only payoff plan and see exactly when you can be debt-free.',
    icon: 'target-account',
    route: 'DebtFreedomCoach',
    routeLabel: 'Open Coach',
  },
  {
    key: 'place_reminders',
    title: 'Place Reminders',
    benefit: 'Get reminded about money tasks the moment you reach or pass a place.',
    icon: 'map-marker-radius',
    route: 'PlaceReminders',
    routeLabel: 'Set one up',
  },
  {
    key: 'accounts_cards',
    title: 'Accounts & Cards',
    benefit: 'Track balances across banks and cards, with automatic detection from your alerts.',
    icon: 'credit-card-multiple-outline',
    route: 'Banks',
    routeLabel: 'Add an account',
  },
];

interface FeatureDiscoveryState {
  version: 1;
  firstSeenAt: number;
  shown: Record<string, { count: number; lastAt: number }>;
  dismissedForever: string[];
}

const STATE_KEY = 'feature_discovery_v1';
const GRACE_PERIOD_MS = 2 * 24 * 60 * 60 * 1000; // 2 days after first launch
const COOLDOWN_MS = 3 * 24 * 60 * 60 * 1000; // at most one tip / feature per 3 days
const MAX_SHOWS_PER_FEATURE = 3;
const GLOBAL_COOLDOWN_MS = 24 * 60 * 60 * 1000; // at most one tip across all features per day

function emptyState(): FeatureDiscoveryState {
  return { version: 1, firstSeenAt: Date.now(), shown: {}, dismissedForever: [] };
}

async function readState(): Promise<FeatureDiscoveryState> {
  try {
    const raw = await AsyncStorage.getItem(STATE_KEY);
    if (!raw) {
      const fresh = emptyState();
      await AsyncStorage.setItem(STATE_KEY, JSON.stringify(fresh));
      return fresh;
    }
    const parsed = JSON.parse(raw) as Partial<FeatureDiscoveryState>;
    if (parsed.version !== 1) return emptyState();
    return {
      version: 1,
      firstSeenAt: typeof parsed.firstSeenAt === 'number' ? parsed.firstSeenAt : Date.now(),
      shown: parsed.shown && typeof parsed.shown === 'object' ? parsed.shown : {},
      dismissedForever: Array.isArray(parsed.dismissedForever) ? parsed.dismissedForever : [],
    };
  } catch {
    return emptyState();
  }
}

async function writeState(state: FeatureDiscoveryState): Promise<void> {
  try {
    await AsyncStorage.setItem(STATE_KEY, JSON.stringify(state));
  } catch (error) {
    if (__DEV__) console.warn('[FeatureDiscovery] persist failed', error);
  }
}

/**
 * Pick the next feature worth suggesting, or null if nothing is eligible right
 * now. Pure of side effects — call markTipShown() once the tip is displayed.
 */
export async function getNextFeatureTip(): Promise<FeatureTip | null> {
  try {
    const [state, usage] = await Promise.all([readState(), getFeatureUsageSummary()]);
    const now = Date.now();

    if (now - state.firstSeenAt < GRACE_PERIOD_MS) return null;

    const lastShownAt = Object.values(state.shown).reduce((max, entry) => Math.max(max, entry.lastAt), 0);
    if (now - lastShownAt < GLOBAL_COOLDOWN_MS) return null;

    for (const tip of FEATURE_CATALOG) {
      if (usage[tip.key]?.count) continue; // already used
      if (state.dismissedForever.includes(tip.key)) continue;
      const shown = state.shown[tip.key];
      if (shown && (shown.count >= MAX_SHOWS_PER_FEATURE || now - shown.lastAt < COOLDOWN_MS)) continue;
      return tip;
    }
    return null;
  } catch (error) {
    if (__DEV__) console.warn('[FeatureDiscovery] getNextFeatureTip failed', error);
    return null;
  }
}

export async function markTipShown(key: string): Promise<void> {
  const state = await readState();
  const existing = state.shown[key];
  state.shown[key] = { count: (existing?.count || 0) + 1, lastAt: Date.now() };
  await writeState(state);
}

export async function dismissTipForever(key: string): Promise<void> {
  const state = await readState();
  if (!state.dismissedForever.includes(key)) state.dismissedForever.push(key);
  await writeState(state);
}

export async function resetFeatureDiscovery(): Promise<void> {
  await AsyncStorage.removeItem(STATE_KEY);
}
