/**
 * Transaction Decision Blackbox
 * ────────────────────────────────────────────────────────────────────────────
 * An on-device, append-only diagnostic store for the transaction-detection
 * pipeline. It exists so the detection logic can be improved week by week from
 * REAL data instead of guesswork.
 *
 * What it captures:
 *  1. Provenance — every SMS/notification signal that contributed to a saved (or
 *     deduped) transaction, with its full raw text and parse confidence. Grouped
 *     by the resolved transaction, this answers: "this transaction was built from
 *     which sources, and which source was the most confident?" — exactly the
 *     source we then want to harden in code.
 *  2. User notes — real-life problems / in-app errors the user writes down, so
 *     they can be triaged and fixed.
 *  3. Feature usage — lightweight counters so we can see which features are used
 *     (and which are ignored and may need better surfacing).
 *
 * Privacy posture:
 *  - This store is ON-DEVICE ONLY. It is never synced to Supabase or any server.
 *  - It intentionally keeps FULL raw message text (the user opted into this so
 *    parser/dedup bugs can actually be reproduced and fixed). Raw text never
 *    leaves the device except when the user explicitly shares a weekly export.
 *  - Retention + size caps below bound how much is kept.
 *
 * Pattern mirrors deliveryDebugBlackBox.ts (cached store, debounced write,
 * trim-on-read, versioned schema) for consistency with the codebase.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

// ─── Public types ─────────────────────────────────────────────────────────────

export type BlackBoxConfidence = 'exact' | 'high' | 'medium' | 'low' | 'unknown';
export type BlackBoxSourceKind = 'sms' | 'notification';

export interface TransactionSignalRecord {
  id: string;
  /** Capture time (ms epoch). */
  time: number;
  sourceKind: BlackBoxSourceKind;
  /** Human-readable source (e.g. "Super.money", "KOTAK", "Truecaller"). */
  sourceLabel: string;
  /** Stable source identity (package name or normalized sender token). */
  sourceIdentity: string;
  /** Full raw message text — on-device only. */
  rawText: string;
  textLen: number;
  /** Stable hash of the raw text — lets us correlate the same message across runs. */
  hash: string;
  amount: number | null;
  direction: 'debit' | 'credit' | 'unknown';
  referenceNumber: string | null;
  confidence: BlackBoxConfidence;
  /** Resolved transaction this signal mapped to (provenance key). Null if unlinked. */
  transactionId: string | null;
  linked: boolean;
  /** Evidence signal id — also used to dedupe repeated captures of one signal. */
  signalId: string;
}

export interface CaptureTransactionSignalInput {
  sourceKind: BlackBoxSourceKind;
  sourceLabel?: string | null;
  sourceIdentity?: string | null;
  rawText: string;
  hash?: string | null;
  amount?: number | null;
  direction?: 'debit' | 'credit' | 'unknown' | null;
  referenceNumber?: string | null;
  confidence?: BlackBoxConfidence | null;
  transactionId?: string | null;
  signalId: string;
  time?: number;
}

export type UserNoteKind = 'problem' | 'error' | 'idea' | 'other';
export type UserNoteStatus = 'open' | 'resolved';

export interface UserNote {
  id: string;
  time: number;
  kind: UserNoteKind;
  /** User's own words — stored verbatim, on-device only. */
  text: string;
  /** Optional screen/feature the note was written from. */
  context?: string;
  status: UserNoteStatus;
}

export interface FeatureUsageEntry {
  count: number;
  firstAt: number;
  lastAt: number;
}

export interface SignalContribution {
  sourceKind: BlackBoxSourceKind;
  sourceLabel: string;
  sourceIdentity: string;
  confidence: BlackBoxConfidence;
  amount: number | null;
  direction: 'debit' | 'credit' | 'unknown';
  referenceNumber: string | null;
  time: number;
  textLen: number;
  rawText: string;
}

export interface TransactionProvenanceGroup {
  transactionId: string;
  signalCount: number;
  contributions: SignalContribution[];
  /** Source that arrived with the highest confidence (the one to harden in code). */
  mostConfidentSource: {
    sourceLabel: string;
    sourceIdentity: string;
    sourceKind: BlackBoxSourceKind;
    confidence: BlackBoxConfidence;
  } | null;
  /** True when sources disagreed on amount — a parsing/correlation red flag. */
  amountDisagreement: boolean;
}

// ─── Internal store ─────────────────────────────────────────────────────────────

interface TransactionBlackBoxStore {
  version: 1;
  updatedAt: number;
  signals: TransactionSignalRecord[];
  notes: UserNote[];
  featureUsage: Record<string, FeatureUsageEntry>;
}

const STORE_KEY = 'transaction_black_box_v1';
// Bug-report key owned by notifications.ts (failed-parse diagnostics). Folded into
// the weekly export so failures and successes live in one place.
const BUG_REPORTS_KEY = 'debug_bug_reports';

const MAX_SIGNALS = 2000;
const MAX_NOTES = 200;
const MAX_RAW_TEXT_LEN = 2000;
const MAX_FEATURE_KEYS = 200;
const SIGNAL_RETENTION_MS = 60 * 24 * 60 * 60 * 1000; // 60 days
const WRITE_DEBOUNCE_MS = 1500;

const CONFIDENCE_RANK: Record<BlackBoxConfidence, number> = {
  exact: 4,
  high: 3,
  medium: 2,
  low: 1,
  unknown: 0,
};

const emptyStore = (): TransactionBlackBoxStore => ({
  version: 1,
  updatedAt: Date.now(),
  signals: [],
  notes: [],
  featureUsage: {},
});

function hashText(value: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function clampText(value: string, max: number): string {
  return value.length > max ? value.slice(0, max) : value;
}

function normalizeConfidence(value?: BlackBoxConfidence | null): BlackBoxConfidence {
  return value && value in CONFIDENCE_RANK ? value : 'unknown';
}

function normalizeDirection(value?: string | null): 'debit' | 'credit' | 'unknown' {
  return value === 'debit' || value === 'credit' ? value : 'unknown';
}

let cachedStore: TransactionBlackBoxStore | null = null;
let writeTimeout: ReturnType<typeof setTimeout> | null = null;

async function readStore(): Promise<TransactionBlackBoxStore> {
  if (cachedStore) return cachedStore;
  try {
    const raw = await AsyncStorage.getItem(STORE_KEY);
    if (!raw) {
      cachedStore = emptyStore();
      return cachedStore;
    }
    const parsed = JSON.parse(raw) as Partial<TransactionBlackBoxStore>;
    if (parsed.version !== 1) {
      cachedStore = emptyStore();
      return cachedStore;
    }
    cachedStore = {
      ...emptyStore(),
      ...parsed,
      signals: Array.isArray(parsed.signals) ? parsed.signals : [],
      notes: Array.isArray(parsed.notes) ? parsed.notes : [],
      featureUsage: parsed.featureUsage && typeof parsed.featureUsage === 'object' ? parsed.featureUsage : {},
    };
    return cachedStore;
  } catch {
    cachedStore = emptyStore();
    return cachedStore;
  }
}

function trimStore(store: TransactionBlackBoxStore): TransactionBlackBoxStore {
  const now = Date.now();
  const signals = store.signals
    .filter(signal => now - signal.time <= SIGNAL_RETENTION_MS)
    .slice(0, MAX_SIGNALS);
  const notes = store.notes.slice(0, MAX_NOTES);

  // Cap distinct feature keys (keep most-recently-used).
  let featureUsage = store.featureUsage;
  const featureKeys = Object.keys(featureUsage);
  if (featureKeys.length > MAX_FEATURE_KEYS) {
    featureUsage = Object.fromEntries(
      featureKeys
        .map(key => [key, featureUsage[key]] as const)
        .sort((a, b) => b[1].lastAt - a[1].lastAt)
        .slice(0, MAX_FEATURE_KEYS)
    );
  }

  return { version: 1, updatedAt: now, signals, notes, featureUsage };
}

async function writeStore(store: TransactionBlackBoxStore): Promise<void> {
  cachedStore = trimStore(store);
  if (writeTimeout) clearTimeout(writeTimeout);
  writeTimeout = setTimeout(() => {
    if (cachedStore) {
      AsyncStorage.setItem(STORE_KEY, JSON.stringify(cachedStore)).catch(error =>
        console.error('[TransactionBlackBox] Failed to persist store', error)
      );
    }
  }, WRITE_DEBOUNCE_MS);
}

// ─── Capture ─────────────────────────────────────────────────────────────────

/**
 * Record one ingested signal and the transaction it resolved to. Safe to call
 * fire-and-forget; it never throws (capture must not break the detection path).
 * Repeated captures of the same signalId+transactionId are deduped.
 */
export async function captureTransactionSignal(input: CaptureTransactionSignalInput): Promise<void> {
  try {
    const store = await readStore();
    const time = input.time ?? Date.now();
    const rawText = clampText(input.rawText ?? '', MAX_RAW_TEXT_LEN);

    const alreadyCaptured = store.signals.some(
      signal => signal.signalId === input.signalId && signal.transactionId === (input.transactionId ?? null)
    );
    if (alreadyCaptured) return;

    const record: TransactionSignalRecord = {
      id: `${time}-${Math.random().toString(36).slice(2, 8)}`,
      time,
      sourceKind: input.sourceKind,
      sourceLabel: (input.sourceLabel || input.sourceIdentity || input.sourceKind).slice(0, 64),
      sourceIdentity: (input.sourceIdentity || 'unknown').slice(0, 96),
      rawText,
      textLen: input.rawText?.length ?? 0,
      hash: (input.hash || hashText(rawText)).toLowerCase(),
      amount: typeof input.amount === 'number' && Number.isFinite(input.amount) ? input.amount : null,
      direction: normalizeDirection(input.direction),
      referenceNumber: input.referenceNumber?.slice(0, 64) || null,
      confidence: normalizeConfidence(input.confidence),
      transactionId: input.transactionId ?? null,
      linked: Boolean(input.transactionId),
      signalId: input.signalId,
    };

    store.signals.unshift(record);
    await writeStore(store);
  } catch (error) {
    if (__DEV__) console.warn('[TransactionBlackBox] captureTransactionSignal failed', error);
  }
}

// ─── User notes ────────────────────────────────────────────────────────────────

export async function recordUserNote(input: {
  text: string;
  kind?: UserNoteKind;
  context?: string;
}): Promise<UserNote | null> {
  try {
    const text = input.text?.trim();
    if (!text) return null;

    const store = await readStore();
    const note: UserNote = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      time: Date.now(),
      kind: input.kind || 'problem',
      text: text.slice(0, 4000),
      context: input.context?.slice(0, 120) || undefined,
      status: 'open',
    };
    store.notes.unshift(note);
    await writeStore(store);
    return note;
  } catch (error) {
    if (__DEV__) console.warn('[TransactionBlackBox] recordUserNote failed', error);
    return null;
  }
}

export async function listUserNotes(): Promise<UserNote[]> {
  const store = trimStore(await readStore());
  return [...store.notes];
}

export async function setUserNoteStatus(id: string, status: UserNoteStatus): Promise<void> {
  const store = await readStore();
  const note = store.notes.find(item => item.id === id);
  if (!note) return;
  note.status = status;
  await writeStore(store);
}

export async function deleteUserNote(id: string): Promise<void> {
  const store = await readStore();
  store.notes = store.notes.filter(item => item.id !== id);
  await writeStore(store);
}

// ─── Feature usage ─────────────────────────────────────────────────────────────

/** Increment a usage counter for a feature (e.g. "debt_freedom", "reminders"). */
export async function recordFeatureUsage(feature: string): Promise<void> {
  try {
    const key = feature?.trim().replace(/[^a-z0-9_.-]+/gi, '_').slice(0, 64);
    if (!key) return;
    const store = await readStore();
    const now = Date.now();
    const existing = store.featureUsage[key];
    store.featureUsage[key] = existing
      ? { count: existing.count + 1, firstAt: existing.firstAt, lastAt: now }
      : { count: 1, firstAt: now, lastAt: now };
    await writeStore(store);
  } catch (error) {
    if (__DEV__) console.warn('[TransactionBlackBox] recordFeatureUsage failed', error);
  }
}

export async function getFeatureUsageSummary(): Promise<Record<string, FeatureUsageEntry>> {
  const store = trimStore(await readStore());
  return { ...store.featureUsage };
}

// ─── Provenance analysis ─────────────────────────────────────────────────────

function toContribution(signal: TransactionSignalRecord): SignalContribution {
  return {
    sourceKind: signal.sourceKind,
    sourceLabel: signal.sourceLabel,
    sourceIdentity: signal.sourceIdentity,
    confidence: signal.confidence,
    amount: signal.amount,
    direction: signal.direction,
    referenceNumber: signal.referenceNumber,
    time: signal.time,
    textLen: signal.textLen,
    rawText: signal.rawText,
  };
}

/**
 * Group captured signals by the transaction they resolved to and rank the
 * contributing sources by confidence. This is the core "which source built this
 * transaction, and who was most confident" view the improvement loop runs on.
 */
export function groupSignalsByTransaction(signals: TransactionSignalRecord[]): TransactionProvenanceGroup[] {
  const byTxn = new Map<string, TransactionSignalRecord[]>();
  for (const signal of signals) {
    if (!signal.transactionId) continue;
    const list = byTxn.get(signal.transactionId) || [];
    list.push(signal);
    byTxn.set(signal.transactionId, list);
  }

  const groups: TransactionProvenanceGroup[] = [];
  for (const [transactionId, list] of byTxn) {
    const contributions = list
      .map(toContribution)
      .sort((a, b) => CONFIDENCE_RANK[b.confidence] - CONFIDENCE_RANK[a.confidence] || a.time - b.time);

    const top = contributions[0] || null;
    const amounts = contributions.map(c => c.amount).filter((a): a is number => a !== null);
    const amountDisagreement = new Set(amounts).size > 1;

    groups.push({
      transactionId,
      signalCount: list.length,
      contributions,
      mostConfidentSource: top
        ? {
            sourceLabel: top.sourceLabel,
            sourceIdentity: top.sourceIdentity,
            sourceKind: top.sourceKind,
            confidence: top.confidence,
          }
        : null,
      amountDisagreement,
    });
  }

  return groups.sort((a, b) => b.signalCount - a.signalCount);
}

// ─── Export ─────────────────────────────────────────────────────────────────

interface ParsedBugReport {
  id?: string;
  timestamp?: string;
  type?: string;
  sender?: string;
  rawSms?: string;
  logicLog?: string;
}

async function readBugReports(): Promise<ParsedBugReport[]> {
  try {
    const raw = await AsyncStorage.getItem(BUG_REPORTS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/**
 * Build the weekly diagnostic bundle the user hands over. Combines:
 *  - provenance groups (signals grouped by transaction + confidence ranking)
 *  - orphan signals (captured but never linked to a transaction)
 *  - source reliability (per-source confidence breakdown across all signals)
 *  - parse failures (from the existing bug-report log)
 *  - user notes + feature usage
 */
export async function buildTransactionBlackBoxExport(): Promise<string> {
  const store = trimStore(await readStore());
  const bugReports = await readBugReports();

  const groups = groupSignalsByTransaction(store.signals);
  const orphanSignals = store.signals.filter(signal => !signal.transactionId);

  // Per-source reliability: how often each source appears and at what confidence.
  const sourceReliability: Record<string, {
    total: number;
    linked: number;
    confidence: Record<BlackBoxConfidence, number>;
  }> = {};
  for (const signal of store.signals) {
    const key = signal.sourceLabel || signal.sourceIdentity;
    const entry = sourceReliability[key] || {
      total: 0,
      linked: 0,
      confidence: { exact: 0, high: 0, medium: 0, low: 0, unknown: 0 },
    };
    entry.total += 1;
    if (signal.linked) entry.linked += 1;
    entry.confidence[signal.confidence] += 1;
    sourceReliability[key] = entry;
  }

  const exportPayload = {
    product: 'VaultApp Transaction Decision Blackbox',
    generatedAt: new Date().toISOString(),
    privacy:
      'ON-DEVICE diagnostic bundle. Contains full raw message text the user chose to keep for debugging. Shared only by explicit user action. Not synced to any server.',
    limits: {
      maxSignals: MAX_SIGNALS,
      maxNotes: MAX_NOTES,
      retentionDays: SIGNAL_RETENTION_MS / (24 * 60 * 60 * 1000),
    },
    summary: {
      signalCount: store.signals.length,
      linkedSignalCount: store.signals.filter(s => s.linked).length,
      transactionCount: groups.length,
      orphanSignalCount: orphanSignals.length,
      multiSourceTransactionCount: groups.filter(g => g.signalCount > 1).length,
      amountDisagreementCount: groups.filter(g => g.amountDisagreement).length,
      parseFailureCount: bugReports.filter(r => r.type === 'sms_failed').length,
      openNoteCount: store.notes.filter(n => n.status === 'open').length,
    },
    provenance: groups,
    orphanSignals,
    sourceReliability,
    parseFailures: bugReports,
    notes: store.notes,
    featureUsage: store.featureUsage,
  };

  return JSON.stringify(exportPayload, null, 2);
}

export async function clearTransactionBlackBoxStore(): Promise<void> {
  cachedStore = null;
  if (writeTimeout) clearTimeout(writeTimeout);
  await AsyncStorage.removeItem(STORE_KEY);
}

/** Test-only: reset the in-memory cache so each test reads fresh from storage. */
export function __resetTransactionBlackBoxCacheForTests(): void {
  cachedStore = null;
  if (writeTimeout) clearTimeout(writeTimeout);
}
