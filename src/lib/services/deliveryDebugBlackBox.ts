import AsyncStorage from '@react-native-async-storage/async-storage';

export type DeliveryDebugCategory =
  | 'accessibility'
  | 'porter_distance'
  | 'volume_guard'
  | 'audio_route'
  | 'delivery_app'
  | 'service_health'
  | 'incident'
  | 'error';

export interface DeliveryDebugEvent {
  id: string;
  time: number;
  category: DeliveryDebugCategory;
  feature: string;
  packageName?: string;
  eventType?: string;
  message: string;
  level?: 'info' | 'warn' | 'error';
  data?: Record<string, string | number | boolean | null>;
}

export interface NativeDeliveryDebugSnapshot {
  version?: number;
  generatedAt?: number;
  serviceRunning?: boolean;
  volumeGuardEnabled?: boolean;
  normalEvents?: unknown[];
  recentEvents?: unknown[];
  pinnedIncidents?: unknown[];
  limits?: Record<string, unknown>;
}

export interface DeliveryDebugSummary {
  normalSessionCount: number;
  rollingEventCount: number;
  incidentCount: number;
  nativeEventCount: number;
  nativeIncidentCount: number;
  distanceSuccessCount: number;
  parseFailureCount: number;
  volumeClampCount: number;
  realIncidentCount: number;
  lastUpdatedAt?: number;
  lastDeliveryApp?: string;
}

export interface DeliveryIncidentSummary {
  time?: number;
  reason: string;
  source?: 'manual' | 'auto';
}

export interface DeliveryDistanceSummary {
  status: 'success' | 'unavailable' | 'none';
  time?: number;
  reason?: string;
  detail?: string;
  app?: string;
  packageName?: string;
  toPickup?: string;
  tripDistance?: string;
}

interface DeliverySessionSummary {
  id: string;
  startedAt: number;
  lastEventAt: number;
  eventCount: number;
  errorCount: number;
  distanceSuccessCount: number;
  parseFailureCount: number;
  volumeClampCount: number;
  realIncidentCount: number;
  packages: string[];
  categories: Partial<Record<DeliveryDebugCategory, number>>;
  lastMessage: string;
}

interface DeliveryIncident {
  id: string;
  pinnedAt: number;
  source: 'manual' | 'auto';
  reason: string;
  captureUntil: number;
  events: DeliveryDebugEvent[];
  nativeSnapshot?: NativeDeliveryDebugSnapshot;
}

interface DeliveryBlackBoxStore {
  version: 1;
  updatedAt: number;
  rollingEvents: DeliveryDebugEvent[];
  normalSessions: DeliverySessionSummary[];
  pinnedIncidents: DeliveryIncident[];
  activeIncidentId?: string;
  activeIncidentUntil?: number;
}

const STORE_KEY = 'debug_delivery_black_box_v1';
const MAX_ROLLING_EVENTS = 500;
const MAX_NORMAL_SESSIONS = 50;
const MAX_PINNED_INCIDENTS = 10;
const MAX_INCIDENT_EVENTS = 220;
const ROLLING_WINDOW_MS = 10 * 60 * 1000;
const INCIDENT_CAPTURE_MS = 2 * 60 * 1000;
const STORE_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const MIRRORED_NATIVE_INCIDENT_WINDOW_MS = 5 * 1000;

const emptyStore = (): DeliveryBlackBoxStore => ({
  version: 1,
  updatedAt: Date.now(),
  rollingEvents: [],
  normalSessions: [],
  pinnedIncidents: [],
});

function hashText(value: string): string {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = ((hash << 5) - hash) + value.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash).toString(16);
}

export function redactedTextSummary(value: string): string {
  const normalized = value.trim();
  if (!normalized) return 'redacted len=0 hash=0';
  return `redacted len=${normalized.length} hash=${hashText(normalized)}`;
}

function sanitizeMessage(value: string): string {
  return value
    .replace(/\b\d{10,}\b/g, '[number]')
    .replace(/\b(?:otp|code|pin)\s*[:#-]?\s*\d+\b/gi, '[code]')
    .slice(0, 240);
}

function sanitizeData(data?: DeliveryDebugEvent['data']): DeliveryDebugEvent['data'] {
  if (!data) return undefined;
  const safe: NonNullable<DeliveryDebugEvent['data']> = {};
  Object.entries(data).forEach(([key, value]) => {
    if (typeof value === 'string') {
      safe[key] = sanitizeMessage(value);
    } else {
      safe[key] = value;
    }
  });
  return safe;
}

function sanitizePackageName(packageName?: string): string | undefined {
  if (!packageName) return undefined;
  return packageName.replace(/[^a-zA-Z0-9._-]/g, '').slice(0, 80);
}

let cachedStore: DeliveryBlackBoxStore | null = null;
let writeTimeout: ReturnType<typeof setTimeout> | null = null;

async function readStore(): Promise<DeliveryBlackBoxStore> {
  if (cachedStore) return cachedStore;
  try {
    const raw = await AsyncStorage.getItem(STORE_KEY);
    if (!raw) {
      cachedStore = emptyStore();
      return cachedStore;
    }
    const parsed = JSON.parse(raw) as DeliveryBlackBoxStore;
    if (parsed.version !== 1) {
      cachedStore = emptyStore();
      return cachedStore;
    }
    cachedStore = {
      ...emptyStore(),
      ...parsed,
      rollingEvents: Array.isArray(parsed.rollingEvents) ? parsed.rollingEvents : [],
      normalSessions: Array.isArray(parsed.normalSessions) ? parsed.normalSessions : [],
      pinnedIncidents: Array.isArray(parsed.pinnedIncidents) ? parsed.pinnedIncidents : [],
    };
    return cachedStore;
  } catch {
    cachedStore = emptyStore();
    return cachedStore;
  }
}

async function writeStore(store: DeliveryBlackBoxStore): Promise<void> {
  cachedStore = trimStore(store);
  if (writeTimeout) clearTimeout(writeTimeout);
  writeTimeout = setTimeout(() => {
    if (cachedStore) {
      AsyncStorage.setItem(STORE_KEY, JSON.stringify(cachedStore)).catch(e => 
        console.error('Failed to write delivery debug black box', e)
      );
    }
  }, 2000);
}

function trimStore(store: DeliveryBlackBoxStore): DeliveryBlackBoxStore {
  const now = Date.now();
  const rollingEvents = store.rollingEvents
    .filter(event => now - event.time <= ROLLING_WINDOW_MS)
    .slice(0, MAX_ROLLING_EVENTS);

  const normalSessions = store.normalSessions
    .filter(session => now - session.lastEventAt <= STORE_RETENTION_MS)
    .slice(0, MAX_NORMAL_SESSIONS);

  const pinnedIncidents = store.pinnedIncidents
    .slice(0, MAX_PINNED_INCIDENTS)
    .map(incident => ({
      ...incident,
      events: incident.events.slice(0, MAX_INCIDENT_EVENTS),
    }));

  const activeIncidentStillOpen =
    store.activeIncidentId && store.activeIncidentUntil && store.activeIncidentUntil > now;

  return {
    version: 1,
    updatedAt: now,
    rollingEvents,
    normalSessions,
    pinnedIncidents,
    activeIncidentId: activeIncidentStillOpen ? store.activeIncidentId : undefined,
    activeIncidentUntil: activeIncidentStillOpen ? store.activeIncidentUntil : undefined,
  };
}

function createEvent(input: Omit<DeliveryDebugEvent, 'id' | 'time'> & { time?: number }): DeliveryDebugEvent {
  const time = input.time ?? Date.now();
  return {
    id: `${time}-${Math.random().toString(36).slice(2, 8)}`,
    time,
    category: input.category,
    feature: sanitizeMessage(input.feature),
    packageName: sanitizePackageName(input.packageName),
    eventType: input.eventType ? sanitizeMessage(input.eventType) : undefined,
    message: sanitizeMessage(input.message),
    level: input.level ?? 'info',
    data: sanitizeData(input.data),
  };
}

function updateNormalSession(store: DeliveryBlackBoxStore, event: DeliveryDebugEvent) {
  const sessionDate = new Date(event.time);
  const sessionId = `${sessionDate.toISOString().slice(0, 13)}:delivery`;
  let session = store.normalSessions.find(item => item.id === sessionId);

  if (!session) {
    session = {
      id: sessionId,
      startedAt: event.time,
      lastEventAt: event.time,
      eventCount: 0,
      errorCount: 0,
      distanceSuccessCount: 0,
      parseFailureCount: 0,
      volumeClampCount: 0,
      realIncidentCount: 0,
      packages: [],
      categories: {},
      lastMessage: '',
    };
    store.normalSessions.unshift(session);
  }

  session.lastEventAt = Math.max(session.lastEventAt, event.time);
  session.eventCount += 1;
  session.errorCount += event.level === 'error' ? 1 : 0;
  session.distanceSuccessCount += isDistanceSuccessEvent(event) ? 1 : 0;
  session.parseFailureCount += isParseFailureEvent(event) ? 1 : 0;
  session.volumeClampCount += isVolumeClampEvent(event) ? 1 : 0;
  session.realIncidentCount += isRealIncidentEvent(event) ? 1 : 0;
  session.lastMessage = event.message;
  session.categories[event.category] = (session.categories[event.category] || 0) + 1;
  if (event.packageName && !session.packages.includes(event.packageName)) {
    session.packages.push(event.packageName);
  }
}

function appendToActiveIncident(store: DeliveryBlackBoxStore, event: DeliveryDebugEvent) {
  if (!store.activeIncidentId || !store.activeIncidentUntil || store.activeIncidentUntil <= Date.now()) {
    return;
  }

  const incident = store.pinnedIncidents.find(item => item.id === store.activeIncidentId);
  if (!incident) return;
  incident.events.unshift(event);
  incident.events = incident.events.slice(0, MAX_INCIDENT_EVENTS);
}

function sanitizeNativeSnapshot(snapshot?: NativeDeliveryDebugSnapshot): NativeDeliveryDebugSnapshot | undefined {
  if (!snapshot) return undefined;
  return {
    version: snapshot.version,
    generatedAt: snapshot.generatedAt,
    serviceRunning: snapshot.serviceRunning,
    volumeGuardEnabled: snapshot.volumeGuardEnabled,
    limits: snapshot.limits,
    normalEvents: Array.isArray(snapshot.normalEvents) ? snapshot.normalEvents.slice(0, 400) : [],
    recentEvents: Array.isArray(snapshot.recentEvents) ? snapshot.recentEvents.slice(0, 120) : [],
    pinnedIncidents: Array.isArray(snapshot.pinnedIncidents) ? snapshot.pinnedIncidents.slice(0, 10) : [],
  };
}

function isDistanceSuccessEvent(event: DeliveryDebugEvent): boolean {
  return event.category === 'porter_distance' &&
    event.feature === 'distance_result' &&
    event.message.toLowerCase().startsWith('success:');
}

function isParseFailureEvent(event: DeliveryDebugEvent): boolean {
  return event.category === 'porter_distance' &&
    event.feature === 'address_parse' &&
    (event.level === 'warn' || event.message.toLowerCase().includes('could not extract'));
}

function isVolumeClampEvent(event: DeliveryDebugEvent): boolean {
  return event.category === 'volume_guard' && event.feature === 'volume_clamp';
}

function isRealIncidentEvent(event: DeliveryDebugEvent): boolean {
  const feature = event.feature.toLowerCase();
  const message = event.message.toLowerCase();

  return (event.category === 'incident' && (
      message.includes('user marked') ||
      message.includes('manual')
    )) ||
    feature.includes('service_disabled') ||
    feature.includes('service_crash') ||
    feature.includes('crash') ||
    feature.includes('route_anomaly') ||
    message.includes('service disabled') ||
    message.includes('crash') ||
    message.includes('route anomaly');
}

function shouldAutoPinIncident(event: DeliveryDebugEvent): boolean {
  if (event.level !== 'error') return false;
  return isRealIncidentEvent(event);
}

function isNativeEvent(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object');
}

function getNativeString(value: Record<string, unknown>, key: string): string {
  const raw = value[key];
  return typeof raw === 'string' ? raw : '';
}

function getNativeNumber(value: Record<string, unknown>, key: string): number | undefined {
  const raw = value[key];
  return typeof raw === 'number' ? raw : undefined;
}

function isNativeVolumeClamp(value: unknown): boolean {
  if (!isNativeEvent(value)) return false;
  return getNativeString(value, 'stage') === 'volume_clamp';
}

function isNativeRealIncident(value: unknown): boolean {
  if (!isNativeEvent(value)) return false;
  const reason = getNativeString(value, 'reason').toLowerCase();
  const stage = getNativeString(value, 'stage').toLowerCase();
  const source = getNativeString(value, 'source').toLowerCase();

  return source === 'manual' ||
    reason === 'manual' ||
    reason.includes('user marked') ||
    reason.includes('service_disabled') ||
    reason.includes('service_crash') ||
    reason.includes('crash') ||
    reason.includes('route_anomaly') ||
    stage === 'service_disabled' ||
    stage === 'service_crash' ||
    stage === 'audio_route_anomaly' ||
    stage === 'volume_route_anomaly' ||
    stage.includes('crash');
}

function getNativeIncidentTime(value: unknown): number | undefined {
  if (!isNativeEvent(value)) return undefined;
  return getNativeNumber(value, 'time') || getNativeNumber(value, 'pinnedAt');
}

function getNativeIncidentReason(value: unknown): string {
  if (!isNativeEvent(value)) return 'Native incident';
  return sanitizeMessage(getNativeString(value, 'reason') || 'Native incident');
}

function getNativeIncidentSource(value: unknown): 'manual' | 'auto' | undefined {
  if (!isNativeEvent(value)) return undefined;
  const source = getNativeString(value, 'source');
  return source === 'manual' || source === 'auto' ? source : undefined;
}

function isJsRealIncident(incident: DeliveryIncident): boolean {
  return incident.source === 'manual' ||
    isRealIncidentEvent({
      id: incident.id,
      time: incident.pinnedAt,
      category: 'incident',
      feature: incident.source,
      message: incident.reason,
    });
}

function getMergedIncidentCounts(
  store: DeliveryBlackBoxStore,
  nativeSnapshot?: NativeDeliveryDebugSnapshot
) {
  const merged: Array<{
    time?: number;
    reason: string;
    source?: 'manual' | 'auto';
    real: boolean;
  }> = store.pinnedIncidents.map(incident => ({
    time: incident.pinnedAt,
    reason: incident.reason,
    source: incident.source,
    real: isJsRealIncident(incident),
  }));

  const nativeIncidents = Array.isArray(nativeSnapshot?.pinnedIncidents)
    ? nativeSnapshot.pinnedIncidents
    : [];

  for (const nativeIncident of nativeIncidents) {
    if (!isNativeEvent(nativeIncident)) continue;
    const time = getNativeIncidentTime(nativeIncident);
    const reason = getNativeIncidentReason(nativeIncident);
    const source = getNativeIncidentSource(nativeIncident);
    const normalizedReason = reason.toLowerCase();
    const hasMatchingJsMirror = merged.some(item => {
      const normalizedItemReason = item.reason.toLowerCase();
      const sameReason = normalizedItemReason === normalizedReason ||
        (normalizedItemReason.includes('user marked') && normalizedReason.includes('user marked')) ||
        ((item.source === 'manual' || normalizedItemReason.includes('user marked')) &&
          normalizedReason === 'manual');
      const sameSource = !item.source || !source || item.source === source;
      return sameReason &&
        sameSource &&
        typeof item.time === 'number' &&
        typeof time === 'number' &&
        Math.abs(item.time - time) <= MIRRORED_NATIVE_INCIDENT_WINDOW_MS;
    });

    if (!hasMatchingJsMirror) {
      merged.push({
        time,
        reason,
        source,
        real: isNativeRealIncident(nativeIncident),
      });
    }
  }

  return {
    totalCount: merged.length,
    realCount: merged.filter(item => item.real).length,
  };
}

function buildExportSummary(
  store: DeliveryBlackBoxStore,
  nativeSnapshot?: NativeDeliveryDebugSnapshot
) {
  const nativeEvents = Array.isArray(nativeSnapshot?.normalEvents) ? nativeSnapshot.normalEvents : [];

  const sessionTotals = store.normalSessions.reduce(
    (totals, session) => ({
      distanceSuccessCount: totals.distanceSuccessCount + (session.distanceSuccessCount || 0),
      parseFailureCount: totals.parseFailureCount + (session.parseFailureCount || 0),
      volumeClampCount: totals.volumeClampCount + (session.volumeClampCount || 0),
      realIncidentCount: totals.realIncidentCount + (session.realIncidentCount || 0),
    }),
    {
      distanceSuccessCount: 0,
      parseFailureCount: 0,
      volumeClampCount: 0,
      realIncidentCount: 0,
    }
  );

  const mergedIncidentCounts = getMergedIncidentCounts(store, nativeSnapshot);

  return {
    distanceSuccessCount: sessionTotals.distanceSuccessCount,
    parseFailureCount: sessionTotals.parseFailureCount,
    volumeClampCount: sessionTotals.volumeClampCount + nativeEvents.filter(isNativeVolumeClamp).length,
    realIncidentCount: Math.max(sessionTotals.realIncidentCount, mergedIncidentCounts.realCount),
  };
}

function deliveryAppFromPackage(packageName?: string): string | undefined {
  const normalized = (packageName || '').toLowerCase();
  if (!normalized) return undefined;
  if (normalized.includes('porter')) return 'Porter';
  if (normalized.includes('swiggy')) return 'Swiggy';
  if (normalized.includes('zomato')) return 'Zomato';
  return undefined;
}

function safeDataString(
  data: DeliveryDebugEvent['data'],
  key: string
): string | undefined {
  const raw = data?.[key];
  return typeof raw === 'string' && raw.trim() ? raw : undefined;
}

function findLastDeliveryApp(
  store: DeliveryBlackBoxStore,
  nativeSnapshot?: NativeDeliveryDebugSnapshot
): string | undefined {
  const fromRolling = store.rollingEvents
    .map(event => deliveryAppFromPackage(event.packageName))
    .find(Boolean);
  if (fromRolling) return fromRolling;

  const nativeEvents = [
    ...(Array.isArray(nativeSnapshot?.recentEvents) ? nativeSnapshot.recentEvents : []),
    ...(Array.isArray(nativeSnapshot?.normalEvents) ? nativeSnapshot.normalEvents : []),
  ];
  for (const item of nativeEvents) {
    if (!isNativeEvent(item)) continue;
    const app = deliveryAppFromPackage(getNativeString(item, 'packageName'));
    if (app) return app;
  }
  return undefined;
}

export async function getDeliveryDebugSummary(
  nativeSnapshot?: NativeDeliveryDebugSnapshot
): Promise<DeliveryDebugSummary> {
  const store = trimStore(await readStore());
  const exportSummary = buildExportSummary(store, nativeSnapshot);
  const nativeEventCount = Array.isArray(nativeSnapshot?.normalEvents)
    ? nativeSnapshot.normalEvents.length
    : 0;
  const nativeIncidentCount = Array.isArray(nativeSnapshot?.pinnedIncidents)
    ? nativeSnapshot.pinnedIncidents.length
    : 0;
  const mergedIncidentCounts = getMergedIncidentCounts(store, nativeSnapshot);

  return {
    normalSessionCount: store.normalSessions.length,
    rollingEventCount: store.rollingEvents.length,
    incidentCount: mergedIncidentCounts.totalCount,
    nativeEventCount,
    nativeIncidentCount,
    distanceSuccessCount: exportSummary.distanceSuccessCount,
    parseFailureCount: exportSummary.parseFailureCount,
    volumeClampCount: exportSummary.volumeClampCount,
    realIncidentCount: exportSummary.realIncidentCount,
    lastUpdatedAt: store.updatedAt || nativeSnapshot?.generatedAt,
    lastDeliveryApp: findLastDeliveryApp(store, nativeSnapshot),
  };
}

export async function getLastIncidentSummary(
  nativeSnapshot?: NativeDeliveryDebugSnapshot
): Promise<DeliveryIncidentSummary | undefined> {
  const store = trimStore(await readStore());
  const jsIncident = store.pinnedIncidents[0];
  const nativeIncidents = Array.isArray(nativeSnapshot?.pinnedIncidents)
    ? nativeSnapshot.pinnedIncidents
    : [];
  const nativeIncident = nativeIncidents.find(isNativeEvent);
  const nativeIncidentTime = nativeIncident
    ? getNativeNumber(nativeIncident, 'time') || getNativeNumber(nativeIncident, 'pinnedAt')
    : undefined;

  if (nativeIncident && nativeIncidentTime && (!jsIncident || nativeIncidentTime > jsIncident.pinnedAt)) {
    const nativeSource = getNativeString(nativeIncident, 'source');
    return {
      time: nativeIncidentTime,
      reason: sanitizeMessage(getNativeString(nativeIncident, 'reason') || 'Native incident'),
      source: nativeSource === 'auto' || nativeSource === 'manual' ? nativeSource : undefined,
    };
  }

  if (!jsIncident) return undefined;
  return {
    time: jsIncident.pinnedAt,
    reason: jsIncident.reason,
    source: jsIncident.source,
  };
}

export async function getLastDistanceSummary(): Promise<DeliveryDistanceSummary> {
  const store = trimStore(await readStore());
  const event = store.rollingEvents.find(item =>
    item.category === 'porter_distance' &&
    (
      item.feature === 'distance_result' ||
      item.feature === 'readable_text' ||
      item.feature === 'address_parse' ||
      item.feature === 'duplicate_guard' ||
      item.feature === 'native_event_recovered'
    )
  );

  if (!event) {
    return { status: 'none' };
  }

  const reason =
    safeDataString(event.data, 'reason') ||
    (event.level === 'warn' || event.level === 'error' ? event.message : undefined);

  return {
    status: isDistanceSuccessEvent(event) ? 'success' : 'unavailable',
    time: event.time,
    reason: reason ? sanitizeMessage(reason) : undefined,
    detail: safeDataString(event.data, 'detail'),
    app: deliveryAppFromPackage(event.packageName),
    packageName: event.packageName,
    toPickup: safeDataString(event.data, 'toPickup'),
    tripDistance: safeDataString(event.data, 'tripDistance'),
  };
}

export async function recordDeliveryDebugEvent(
  input: Omit<DeliveryDebugEvent, 'id' | 'time'> & { time?: number }
): Promise<void> {
  const store = await readStore();
  const event = createEvent(input);

  store.rollingEvents.unshift(event);
  updateNormalSession(store, event);
  appendToActiveIncident(store, event);

  if (shouldAutoPinIncident(event)) {
    await writeStore(store);
    await markDeliveryIssueInBlackBox(`Auto pinned ${event.feature}`, undefined, 'auto', event);
    return;
  }

  await writeStore(store);
}

export async function markDeliveryIssueInBlackBox(
  reason: string,
  nativeSnapshot?: NativeDeliveryDebugSnapshot,
  source: 'manual' | 'auto' = 'manual',
  triggerEvent?: DeliveryDebugEvent
): Promise<DeliveryIncident> {
  const store = await readStore();
  const now = Date.now();
  const recentEvents = store.rollingEvents
    .filter(event => now - event.time <= ROLLING_WINDOW_MS)
    .slice(0, MAX_INCIDENT_EVENTS - (triggerEvent ? 1 : 0));

  const incident: DeliveryIncident = {
    id: `${source}-${now}`,
    pinnedAt: now,
    source,
    reason: sanitizeMessage(reason),
    captureUntil: now + INCIDENT_CAPTURE_MS,
    events: triggerEvent ? [triggerEvent, ...recentEvents] : recentEvents,
    nativeSnapshot: sanitizeNativeSnapshot(nativeSnapshot),
  };

  store.pinnedIncidents.unshift(incident);
  store.activeIncidentId = incident.id;
  store.activeIncidentUntil = incident.captureUntil;
  await writeStore(store);
  return incident;
}

export async function buildDeliveryDebugExport(nativeSnapshot?: NativeDeliveryDebugSnapshot): Promise<string> {
  const store = trimStore(await readStore());
  const exportPayload = {
    product: 'SpendSense Delivery Debug Black Box',
    generatedAt: new Date().toISOString(),
    privacy:
      'Contains compact diagnostics only. Customer names, phone numbers, addresses, OTPs, and full screen text are intentionally not stored.',
    limits: {
      rollingWindowMinutes: ROLLING_WINDOW_MS / 60000,
      incidentCaptureMinutes: INCIDENT_CAPTURE_MS / 60000,
      maxRollingEvents: MAX_ROLLING_EVENTS,
      maxNormalSessions: MAX_NORMAL_SESSIONS,
      maxPinnedIncidents: MAX_PINNED_INCIDENTS,
      maxIncidentEvents: MAX_INCIDENT_EVENTS,
      retentionDays: STORE_RETENTION_MS / (24 * 60 * 60 * 1000),
    },
    summary: buildExportSummary(store, nativeSnapshot),
    normalSessions: store.normalSessions,
    rollingEvents: store.rollingEvents,
    pinnedIncidents: store.pinnedIncidents,
    native: sanitizeNativeSnapshot(nativeSnapshot),
  };

  return JSON.stringify(exportPayload, null, 2);
}

export async function clearDeliveryDebugBlackBoxStore() {
  cachedStore = null;
  if (writeTimeout) clearTimeout(writeTimeout);
  await AsyncStorage.removeItem(STORE_KEY);
}
