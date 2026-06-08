/**
 * Porter Module
 * Consolidated: PorterModule.ts + PorterDistanceCalculator.ts
 * 
 * Handles Porter driver app integration:
 * - Accessibility service management
 * - Screen change detection
 * - Distance calculation for ride requests
 * - Toast overlay display
 */

import { AppState, NativeModules, NativeEventEmitter, Platform } from 'react-native';
import Geolocation from 'react-native-geolocation-service';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Config from 'react-native-config';
import {
  buildDeliveryDebugExport,
  clearDeliveryDebugBlackBoxStore,
  markDeliveryIssueInBlackBox,
  NativeDeliveryDebugSnapshot,
  recordDeliveryDebugEvent,
  redactedTextSummary,
} from './deliveryDebugBlackBox';

const { PorterModule } = NativeModules;
// SECURITY: Key loaded from .env via react-native-config — never hardcode in source.
// Read lazily so tests can toggle the configured provider without reloading this module.
function getGoogleMapsApiKey(): string {
  return Config.GOOGLE_MAPS_API_KEY || '';
}
const eventEmitter = new NativeEventEmitter(PorterModule);

const NATIVE_REBUILD_REQUIRED =
  'Native update required. Rebuild and reinstall the Android app with npm run android.';

function requirePorterNativeMethod(methodName: string) {
  const method = PorterModule?.[methodName];
  if (typeof method !== 'function') {
    throw new Error(NATIVE_REBUILD_REQUIRED);
  }
  return method;
}

let subscription: any = null;
let bubbleIssueSubscription: any = null;
let appStateSubscription: any = null;
let lastProcessedHash = 0;
let activeRideRunId = 0;
let activeRideSignature: string | null = null;
let latestPorterScreenState: PorterScreenState | null = null;

const LEGACY_PORTER_DEBUG_KEYS = [
  'debug_porter_last_raw_text',
  'debug_porter_api_response',
  'debug_porter_nominatim',
  'debug_porter_history',
];
let legacyDebugPurgeStarted = false;

// ─── Active Overlay State ──────────────────────────────────────────────────
let activeTripOverlay: PorterOverlayState | null = null;

// ─── Debug History Storage ──────────────────────────────────────────────────────
// Store a deeper history for offline debugging (Porter blocks screen during orders).

interface DebugEvent {
  timestamp: string;
  eventType: string;
  textContent: string;
  pickup: string;
  drop: string;
  status: string;
  apiError: string;
  nominatim: string;
  result: string;
  location: { ageBucket: string; accuracyBucket: string } | null;
}

function summarizeSensitiveValue(value: string): string {
  return redactedTextSummary(value || '');
}

function sanitizeNativeSnapshot(raw: unknown): NativeDeliveryDebugSnapshot | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  return raw as NativeDeliveryDebugSnapshot;
}

function hashString(value: string): number {
  return value.split('').reduce((hash: number, char: string) => {
    return ((hash << 5) - hash) + char.charCodeAt(0);
  }, 0);
}

function normalizeVolatilePorterText(text: string): string {
  return text
    .toLowerCase()
    .replace(/\baccept\s+in\s+\d+\s*s\b/g, 'accept in <timer>')
    .replace(/\b\d+\s*(?:sec|secs|second|seconds)\b/g, '<timer>')
    .replace(/\b\d{1,2}:\d{2}\b/g, '<timer>')
    .replace(/\b\d+%\b/g, '<percent>')
    .replace(/\s+/g, ' ')
    .trim();
}

function distanceReasonLabel(reason?: DistanceFailureReason): string {
  switch (reason) {
    case 'no_readable_text':
      return 'no readable text';
    case 'ocr_unsupported':
      return 'OCR unsupported';
    case 'js_context_inactive':
      return 'JS context inactive';
    case 'duplicate_suppressed':
      return 'duplicate suppressed';
    case 'distance_api_failed':
      return 'distance API failed';
    case 'geocode_failed':
      return 'geocode failed';
    case 'geocode_failed_but_ui_pickup_used':
      return 'geocode failed';
    case 'geocode_result_out_of_region':
      return 'location mismatch';
    case 'impossible_distance_suppressed':
      return 'pickup unavailable';
    case 'device_location_mismatch':
      return 'device location mismatch';
    case 'current_location_stale':
    case 'current_location_low_accuracy':
      return 'location weak';
    case 'invalid_address':
      return 'address unreadable';
    case 'address_unclear':
      return 'address unclear';
    case 'stale_order_result':
      return 'order changed';
    case 'stale_result_dropped':
      return 'order expired';
    case 'suspicious_trip_distance_suppressed':
      return 'suspicious trip distance';
    default:
      return 'unknown';
  }
}

function parseDisplayKm(pattern: RegExp, message: string): number | null {
  const match = message.match(pattern);
  if (!match) return null;
  const value = Number(match[1]);
  return Number.isFinite(value) ? value : null;
}

function buildPorterDisplayProfile(message: string): PorterDisplayProfile {
  return {
    pickupKm: (
      parseDisplayKm(/(?:Calc:\s*You\s*->\s*)?Pickup\s*:?\s*~?([0-9]+(?:\.[0-9]+)?)\s*km/i, message)
    ),
    tripKm: (
      parseDisplayKm(/(?:Calc:\s*Pickup\s*->\s*Drop|Trip)\s*:?\s*~?([0-9]+(?:\.[0-9]+)?)\s*km/i, message)
    ),
    tripUnavailableReason: (
      message.match(/SpendSense unavailable:\s*([^\n]+)/i)?.[1] ||
      message.match(/Calc trip unavailable:\s*([^\n]+)/i)?.[1] ||
      message.match(/Calc unavailable:\s*([^\n]+)/i)?.[1] ||
      message.match(/Trip unavailable:\s*([^\n]+)/i)?.[1] ||
      message.match(/Reason:\s*([^\n]+)/i)?.[1] ||
      null
    )?.trim().toLowerCase() || null,
  };
}

function getPorterOverlayKind(
  message: string,
  profile: PorterDisplayProfile = buildPorterDisplayProfile(message)
): PorterOverlayKind {
  if (/SpendSense calculating/i.test(message) || /Calculating SpendSense distance/i.test(message)) {
    return 'pending';
  }

  if (
    /SpendSense/i.test(message) ||
    /Calc:\s*You\s*->\s*Pickup/i.test(message) ||
    /Calc:\s*Pickup\s*->\s*Drop/i.test(message) ||
    /Porter:\s*(Pickup|Trip)/i.test(message) ||
    /Calc (?:trip )?unavailable:/i.test(message) ||
    /Trip unavailable:/i.test(message) ||
    profile.pickupKm !== null ||
    profile.tripKm !== null
  ) {
    return 'distance';
  }

  if (/Distance unavailable|Location unavailable/i.test(message)) {
    return 'fallback';
  }

  return 'pending';
}

function getPorterOverlayActiveUntil(current: PorterOverlayState): number {
  return current.activeUntil || current.firstShownAt + DISPLAY_ACTIVE_TTL_MS;
}

function hasMeaningfulPorterDisplayChange(
  previous: PorterDisplayProfile,
  next: PorterDisplayProfile
): boolean {
  if (previous.tripKm === null && next.tripKm !== null) return true;
  if (previous.tripUnavailableReason !== next.tripUnavailableReason) return true;
  if (previous.pickupKm === null && next.pickupKm !== null) return true;
  if (previous.pickupKm !== null && next.pickupKm !== null) {
    return Math.abs(next.pickupKm - previous.pickupKm) >= MEANINGFUL_PICKUP_DISTANCE_DELTA_KM;
  }
  return false;
}

function isUnavailableFollowUpOnly(
  previous: PorterDisplayProfile,
  next: PorterDisplayProfile
): boolean {
  return (
    previous.pickupKm !== null &&
    next.pickupKm !== null &&
    Math.abs(next.pickupKm - previous.pickupKm) < MEANINGFUL_PICKUP_DISTANCE_DELTA_KM &&
    previous.tripKm === null &&
    next.tripKm === null &&
    previous.tripUnavailableReason === 'calculating' &&
    next.tripUnavailableReason !== null &&
    next.tripUnavailableReason !== 'calculating'
  );
}

function decidePorterOverlayDisplay(
  signature: string,
  message: string,
  now: number = Date.now(),
  current: PorterOverlayState | null = activeTripOverlay
): { shouldShow: boolean; reason: PorterDisplayDecisionReason; detail?: PorterDisplayDecisionReason } {
  if (!current) {
    return { shouldShow: true, reason: 'display_updated_meaningful_change' };
  }

  if (current.signature !== signature) {
    return { shouldShow: true, reason: 'order_signature_changed' };
  }

  const nextProfile = buildPorterDisplayProfile(message);
  const nextKind = getPorterOverlayKind(message, nextProfile);
  if (now >= getPorterOverlayActiveUntil(current)) {
    return { shouldShow: true, reason: 'display_updated_meaningful_change' };
  }

  if (current.kind === 'pending' && nextKind !== 'pending') {
    return { shouldShow: true, reason: 'display_updated_meaningful_change' };
  }

  const isDuplicateWindow = now - current.lastShownAt < DISPLAY_DUPLICATE_SUPPRESS_MS;
  if (isDuplicateWindow && isUnavailableFollowUpOnly(current.profile, nextProfile)) {
    return { shouldShow: false, reason: 'display_throttled_duplicate', detail: 'toast_quota_avoided' };
  }

  if (message === current.message) {
    return isDuplicateWindow
      ? { shouldShow: false, reason: 'display_throttled_duplicate', detail: 'toast_quota_avoided' }
      : { shouldShow: true, reason: 'display_updated_meaningful_change' };
  }

  if (hasMeaningfulPorterDisplayChange(current.profile, nextProfile)) {
    return { shouldShow: true, reason: 'display_updated_meaningful_change' };
  }

  return isDuplicateWindow
    ? { shouldShow: false, reason: 'display_throttled_duplicate', detail: 'toast_quota_avoided' }
    : { shouldShow: true, reason: 'display_updated_meaningful_change' };
}

function shouldSkipDuplicateTripProcessing(
  signature: string,
  porterPickupDistance: string | null,
  now: number = Date.now(),
  current: PorterOverlayState | null = activeTripOverlay
): boolean {
  if (!current || current.signature !== signature) return false;
  if (now >= getPorterOverlayActiveUntil(current)) return false;
  if (current.kind === 'pending') {
    return now - current.lastShownAt < STALE_RESULT_GRACE_MS;
  }

  const nextPickupKm = parseDistanceKm(porterPickupDistance);
  if (current.profile.pickupKm !== null && nextPickupKm !== null) {
    return Math.abs(nextPickupKm - current.profile.pickupKm) < MEANINGFUL_PICKUP_DISTANCE_DELTA_KM;
  }

  return true;
}

function rememberPorterDisplayDecision(
  signature: string,
  message: string,
  decision: { shouldShow: boolean; reason: PorterDisplayDecisionReason; detail?: PorterDisplayDecisionReason },
  transport: PorterDisplayTransport = 'none'
): void {
  AsyncStorage.setItem('debug_porter_display_state', JSON.stringify({
    shown: decision.shouldShow,
    reason: decision.reason,
    detail: decision.detail || null,
    transport,
    signatureHash: hashString(signature).toString(16),
    messageSummary: summarizeSensitiveValue(message),
    at: new Date().toISOString(),
  })).catch(() => {
    // Debug-only storage should never affect Porter order handling.
  });
}

async function purgeLegacySensitivePorterDebugStorage(): Promise<void> {
  await AsyncStorage.multiRemove(LEGACY_PORTER_DEBUG_KEYS);
}

function scheduleLegacySensitivePorterDebugPurge(): void {
  if (legacyDebugPurgeStarted) return;
  legacyDebugPurgeStarted = true;
  purgeLegacySensitivePorterDebugStorage().catch((error) => {
    if (__DEV__) console.warn('[Porter] Failed to purge legacy debug storage:', error);
  });
}

interface DistanceResult {
  toPickup: string;
  tripDistance: string;
  failureReason?: DistanceFailureReason;
  detail?: string;
  pickupSource?: 'porter_distance_from_ui' | 'calculated' | 'unavailable';
  tripSource?: 'porter_distance_from_ui' | 'calculated' | 'unavailable';
  distanceProvider?: 'google_distance_matrix' | 'osrm_route' | 'haversine_approx';
  isApproximate?: boolean;
  calculationMs?: number;
  routeDiagnostics?: {
    events: string[];
    routeTimingMs?: number;
    provider?: string;
    routeMode?: string;
    pickupCandidateClass?: GoogleAddressCandidateClass;
    dropCandidateClass?: GoogleAddressCandidateClass;
    pickupCandidateHash?: string;
    dropCandidateHash?: string;
    pickupCandidateLength?: number;
    dropCandidateLength?: number;
    candidateScore?: number;
    confidence?: GoogleRouteConfidence;
    reason?: string;
    locationAgeBucket?: string;
    accuracyBucket?: string;
    differenceBucketVsPorterUi?: {
      pickup?: string | null;
      trip?: string | null;
    };
  };
}

type DistanceFailureReason =
  | 'no_readable_text'
  | 'ocr_unsupported'
  | 'js_context_inactive'
  | 'duplicate_suppressed'
  | 'invalid_address'
  | 'distance_api_failed'
  | 'geocode_failed'
  | 'geocode_failed_but_ui_pickup_used'
  | 'geocode_result_out_of_region'
  | 'impossible_distance_suppressed'
  | 'device_location_mismatch'
  | 'current_location_stale'
  | 'current_location_low_accuracy'
  | 'address_unclear'
  | 'stale_order_result'
  | 'stale_result_dropped'
  | 'suspicious_trip_distance_suppressed';

type PorterDisplayDecisionReason =
  | 'display_throttled_duplicate'
  | 'display_updated_meaningful_change'
  | 'toast_quota_avoided'
  | 'native_overlay_updated'
  | 'overlay_permission_missing'
  | 'toast_fallback_used'
  | 'order_signature_changed';

type PorterDisplayTransport = 'native_overlay' | 'toast_fallback' | 'none';

type PorterOverlayKind = 'pending' | 'distance' | 'fallback';

type PorterScreenType = 'offer' | 'accepted_trip' | 'unknown';

type PorterDisplayProfile = {
  pickupKm: number | null;
  tripKm: number | null;
  tripUnavailableReason: string | null;
};

type PorterOverlayState = {
  signature: string;
  message: string;
  firstShownAt: number;
  lastShownAt: number;
  activeUntil: number;
  profile: PorterDisplayProfile;
  kind: PorterOverlayKind;
};

type PorterScreenState = {
  signature: string | null;
  screenType: PorterScreenType;
  hasLiveOffer: boolean;
  seenAt: number;
};

type PorterResultContext = {
  runId: number;
  signature: string;
  startedAt: number;
  screenType: PorterScreenType;
};

type PorterScreenEvent = {
  packageName?: string;
  textContent?: string;
  textLength?: number;
  textSummary?: string;
  textContentAvailable?: boolean;
  eventType?: string;
  reason?: string;
};

type GeocodeCandidateType = 'exact_address' | 'full_cleaned' | 'locality' | 'landmark_area' | 'pincode_city';

type GeocodeCandidate = {
  query: string;
  type: GeocodeCandidateType;
  regionHint: 'ahmedabad' | 'india' | 'unknown';
  reasons: string[];
  score: number;
};

type GeocodeAttemptResult = {
  coords: { lat: number; lng: number } | null;
  reason?: DistanceFailureReason | 'geocode_candidate_success' | 'geocode_candidate_failed' | 'geocode_cache_hit';
  candidateType?: GeocodeCandidateType;
  score?: number;
  selectedReason?: string;
};

type LocationFix = { lat: number; lng: number; ts: number; accuracy?: number | null };

type GoogleAddressCandidateClass =
  | 'exact_address'
  | 'landmark_road'
  | 'road_area'
  | 'locality_only'
  | 'broad_city';

type GoogleRouteConfidence = 'high' | 'medium' | 'low' | 'too_weak';

type GoogleAddressCandidate = {
  query: string;
  type: GeocodeCandidateType;
  className: GoogleAddressCandidateClass;
  hash: string;
  length: number;
  score: number;
  reasons: string[];
};

// ─── Location Cache ─────────────────────────────────────────────────────────────
// Avoids GPS call on every accessibility event, but only reuses a recent and reasonably accurate fix.
let cachedLocation: LocationFix | null = null;
const LOCATION_CACHE_TTL_MS = 10_000;
const LOCATION_MAX_AGE_MS = 30_000;
const LOCATION_MAX_ACCURACY_M = 200;
const STALE_RESULT_GRACE_MS = 3500;
const RESULT_STALE_LIMIT_MS = 12_000;
const OFFER_RESULT_STALE_LIMIT_MS = 4_500;
const MAX_REASONABLE_PORTER_PICKUP_KM = 500;
const MIN_REASONABLE_PORTER_TRIP_KM = 0.2;
const DISPLAY_ACTIVE_TTL_MS = 12_000;
const DISPLAY_DUPLICATE_SUPPRESS_MS = 10_000;
const MEANINGFUL_PICKUP_DISTANCE_DELTA_KM = 0.2;
const PICKUP_DISTANCE_MATCH_MIN_TOLERANCE_KM = 0.2;
const PICKUP_DISTANCE_MATCH_RATIO_TOLERANCE = 0.1;
const GEOCODE_TIMEOUT_MS = 1200;
const GEOCODE_MAX_CANDIDATES = 3;
const GEOCODE_PARALLEL_CANDIDATES = 3;
const GEOCODE_CACHE_TTL_MS = 30 * 60_000;
const ROUTE_TIMEOUT_MS = 1400;
const ROUTE_CACHE_TTL_MS = 10 * 60_000;
const UNAVAILABLE_OVERLAY_STALE_AFTER_MS = 3_400;
const AHMEDABAD_CONTEXT = 'Ahmedabad, Gujarat, India';
const AHMEDABAD_AREA_NAMES = [
  'Ambawadi', 'Asarwa', 'Bapunagar', 'Bhadra', 'Bodakdev', 'Bopal',
  'Chandkheda', 'Ghatlodia', 'Gota', 'Isanpur', 'Jamalpur', 'Jivraj Park',
  'Kankaria', 'Khadia', 'Khanpur', 'Ellisbridge', 'Maninagar', 'Memnagar', 'Motera',
  'Naroda', 'Narol', 'Navrangpura', 'Nikol', 'Paldi', 'Prahladnagar',
  'Ranip', 'Sabarmati', 'Sanand', 'Satellite', 'Shahibaug', 'Sola',
  'Thaltej', 'Vastral', 'Vastrapur', 'Vatva', 'Vejalpur',
];
const GUJARAT_BOUNDS = { minLat: 20.0, maxLat: 24.9, minLng: 68.0, maxLng: 74.8 };
const INDIA_BOUNDS = { minLat: 6.0, maxLat: 37.5, minLng: 68.0, maxLng: 98.5 };
let unavailableOverlayShownSignature: string | null = null;
let geocodeCache = new Map<string, { coords: { lat: number; lng: number }; ts: number; score: number; candidateType: GeocodeCandidateType }>();
let routeCache = new Map<string, { km: number; ts: number }>();
let googleRouteCache = new Map<string, { km: number; ts: number }>();

function getCurrentLocationIssue(location: LocationFix, now: number = Date.now()): DistanceFailureReason | null {
  if (now - location.ts > LOCATION_MAX_AGE_MS) return 'current_location_stale';
  if (typeof location.accuracy === 'number' && location.accuracy > LOCATION_MAX_ACCURACY_M) {
    return 'current_location_low_accuracy';
  }
  if (!isCoordsInBounds(location, INDIA_BOUNDS)) return 'device_location_mismatch';
  return null;
}

function isReusableLocation(location: LocationFix, now: number = Date.now()): boolean {
  return now - location.ts < LOCATION_CACHE_TTL_MS && getCurrentLocationIssue(location, now) === null;
}

function getCachedOrFreshLocation(): Promise<LocationFix> {
  return new Promise((resolve, reject) => {
    const now = Date.now();
    if (cachedLocation && isReusableLocation(cachedLocation, now)) {
      // Reuse cached coordinates — no GPS radio wake-up
      resolve(cachedLocation);
      return;
    }
    Geolocation.getCurrentPosition(
      (pos) => {
        cachedLocation = {
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          ts: typeof pos.timestamp === 'number' ? pos.timestamp : Date.now(),
          accuracy: typeof pos.coords.accuracy === 'number' ? pos.coords.accuracy : null,
        };
        resolve(cachedLocation);
      },
      (err) => reject(err),
      { enableHighAccuracy: true, timeout: 2500, maximumAge: 5000 }
    );
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// BASIC PORTER MODULE FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════════

export const isAccessibilityServiceEnabled = async (): Promise<boolean> => {
  if (Platform.OS !== 'android') return false;
  return await requirePorterNativeMethod('isAccessibilityServiceEnabled')();
};

export const openAccessibilitySettings = () => {
  if (Platform.OS === 'android') {
    PorterModule.openAccessibilitySettings();
  }
};

export const isVolumeGuardEnabled = async (): Promise<boolean> => {
  if (Platform.OS !== 'android') return false;
  if (typeof PorterModule?.isVolumeGuardEnabled !== 'function') return false;
  return await PorterModule.isVolumeGuardEnabled();
};

export const setVolumeGuardEnabled = async (enabled: boolean): Promise<void> => {
  if (Platform.OS !== 'android') return;
  await requirePorterNativeMethod('setVolumeGuardEnabled')(enabled);
};

export const refreshVolumeGuardCaps = async (): Promise<void> => {
  if (Platform.OS !== 'android') return;
  await requirePorterNativeMethod('refreshVolumeGuardCaps')();
};

export const getPorterNativeDebugLogs = async (): Promise<any[]> => {
  if (Platform.OS !== 'android') return [];
  if (typeof PorterModule?.getPorterNativeDebugLogs !== 'function') return [];
  const raw = await PorterModule.getPorterNativeDebugLogs();
  if (typeof raw !== 'string') return [];
  try {
    return JSON.parse(raw);
  } catch {
    return [];
  }
};

export const clearPorterNativeDebugLogs = async (): Promise<void> => {
  if (Platform.OS !== 'android') return;
  if (typeof PorterModule?.clearPorterNativeDebugLogs !== 'function') return;
  await PorterModule.clearPorterNativeDebugLogs();
};

export const getDeliveryDebugBlackBox = async (): Promise<NativeDeliveryDebugSnapshot | undefined> => {
  if (Platform.OS !== 'android') return undefined;
  if (typeof PorterModule?.getDeliveryDebugBlackBox !== 'function') return undefined;
  const raw = await PorterModule.getDeliveryDebugBlackBox();
  if (typeof raw !== 'string') return undefined;
  try {
    return sanitizeNativeSnapshot(JSON.parse(raw));
  } catch {
    return undefined;
  }
};

export const markDeliveryIssue = async (): Promise<void> => {
  await purgeLegacySensitivePorterDebugStorage();
  let nativeSnapshot: NativeDeliveryDebugSnapshot | undefined;
  if (Platform.OS === 'android' && typeof PorterModule?.markDeliveryIssue === 'function') {
    const raw = await PorterModule.markDeliveryIssue();
    if (typeof raw === 'string') {
      try {
        nativeSnapshot = sanitizeNativeSnapshot(JSON.parse(raw));
      } catch {
        nativeSnapshot = undefined;
      }
    }
  }

  await markDeliveryIssueInBlackBox('User marked delivery issue', nativeSnapshot, 'manual');
};

export const exportDeliveryDebugLogs = async (): Promise<string> => {
  await purgeLegacySensitivePorterDebugStorage();
  const nativeSnapshot = await getDeliveryDebugBlackBox();
  return buildDeliveryDebugExport(nativeSnapshot);
};

export const clearDeliveryDebugLogs = async (): Promise<void> => {
  await clearDeliveryDebugBlackBoxStore();
  await AsyncStorage.multiRemove([
    'debug_porter_last_time',
    'debug_porter_status',
    'debug_porter_result',
    'debug_porter_last_event_type',
    'debug_porter_api_error',
    ...LEGACY_PORTER_DEBUG_KEYS,
  ]);
  if (Platform.OS === 'android' && typeof PorterModule?.clearDeliveryDebugBlackBox === 'function') {
    await PorterModule.clearDeliveryDebugBlackBox();
  } else {
    await clearPorterNativeDebugLogs();
  }
};

export const showToastOverlay = (message: string, longDuration: boolean = false) => {
  if (Platform.OS === 'android') {
    PorterModule.showToastOverlay(message);
    
    // Native Android Toasts disappear after ~3 seconds. 
    // Porter's popup stays for 10 seconds. To match it, we re-trigger the toast.
    if (longDuration) {
      setTimeout(() => PorterModule.showToastOverlay(message), 3000);
      setTimeout(() => PorterModule.showToastOverlay(message), 6000);
      setTimeout(() => PorterModule.showToastOverlay(message), 9000);
    }
  }
};

async function showPorterDistanceDisplay(
  signature: string,
  message: string,
  decision: { shouldShow: boolean; reason: PorterDisplayDecisionReason; detail?: PorterDisplayDecisionReason }
): Promise<PorterDisplayTransport> {
  if (Platform.OS !== 'android') return 'none';

  if (typeof PorterModule?.showOrUpdatePorterDistanceOverlay === 'function') {
    try {
      await PorterModule.showOrUpdatePorterDistanceOverlay(message, DISPLAY_ACTIVE_TTL_MS);
      rememberPorterDisplayDecision(signature, message, {
        ...decision,
        detail: 'native_overlay_updated',
      }, 'native_overlay');
      return 'native_overlay';
    } catch (error: any) {
      const reason = error?.code === 'PERMISSION_DENIED'
        ? 'overlay_permission_missing'
        : 'toast_fallback_used';
      showToastOverlay(message, false);
      rememberPorterDisplayDecision(signature, message, {
        ...decision,
        detail: reason,
      }, 'toast_fallback');
      return 'toast_fallback';
    }
  }

  showToastOverlay(message, false);
  rememberPorterDisplayDecision(signature, message, {
    ...decision,
    detail: 'toast_fallback_used',
  }, 'toast_fallback');
  return 'toast_fallback';
}

async function hidePorterDistanceDisplay(): Promise<void> {
  if (Platform.OS !== 'android') return;
  if (typeof PorterModule?.hidePorterDistanceOverlay === 'function') {
    try {
      await PorterModule.hidePorterDistanceOverlay();
    } catch {
      // Display cleanup should not affect app shutdown.
    }
  }
}

// ─── Floating Issue Bubble ──────────────────────────────────────────────────
export const canDrawOverlays = async (): Promise<boolean> => {
  if (Platform.OS !== 'android') return false;
  if (typeof PorterModule?.canDrawOverlays !== 'function') return false;
  return await PorterModule.canDrawOverlays();
};

export const openOverlaySettings = async (): Promise<void> => {
  if (Platform.OS !== 'android') return;
  if (typeof PorterModule?.openOverlaySettings !== 'function') return;
  await PorterModule.openOverlaySettings();
};

export const showIssueBubble = async (): Promise<boolean> => {
  if (Platform.OS !== 'android') return false;
  if (typeof PorterModule?.showIssueBubble !== 'function') return false;
  try {
    return await PorterModule.showIssueBubble();
  } catch {
    return false;
  }
};

export const hideIssueBubble = async (): Promise<boolean> => {
  if (Platform.OS !== 'android') return false;
  if (typeof PorterModule?.hideIssueBubble !== 'function') return false;
  try {
    return await PorterModule.hideIssueBubble();
  } catch {
    return false;
  }
};

function showActivePorterOverlay(signature: string, message: string, now: number = Date.now()) {
  if (Platform.OS !== 'android') return undefined;

  const decision = decidePorterOverlayDisplay(signature, message, now);
  rememberPorterDisplayDecision(signature, message, decision);
  if (!decision.shouldShow) return { decision, displayPromise: Promise.resolve<PorterDisplayTransport>('none') };

  const displayPromise = showPorterDistanceDisplay(signature, message, decision);
  const profile = buildPorterDisplayProfile(message);
  const previous = activeTripOverlay && activeTripOverlay.signature === signature
    ? activeTripOverlay
    : null;
  activeTripOverlay = {
    signature,
    message,
    firstShownAt: previous?.firstShownAt || now,
    lastShownAt: now,
    activeUntil: now + DISPLAY_ACTIVE_TTL_MS,
    profile,
    kind: getPorterOverlayKind(message, profile),
  };
  return { decision, displayPromise };
}

function hideActivePorterOverlay(reason: DistanceFailureReason | 'offer_expired_overlay_hidden'): void {
  activeTripOverlay = null;
  activeRideSignature = null;
  activeRideRunId += 1;
  unavailableOverlayShownSignature = null;
  void hidePorterDistanceDisplay();
  AsyncStorage.setItem('debug_porter_display_state', JSON.stringify({
    shown: false,
    reason,
    transport: 'native_overlay',
    at: new Date().toISOString(),
  })).catch(() => {
    // Debug-only storage should never affect Porter order handling.
  });
}

function hideCurrentPorterOverlayDisplay(reason: DistanceFailureReason | 'unavailable_overlay_suppressed_stale'): void {
  activeTripOverlay = null;
  void hidePorterDistanceDisplay();
  AsyncStorage.setItem('debug_porter_display_state', JSON.stringify({
    shown: false,
    reason,
    transport: 'native_overlay',
    at: new Date().toISOString(),
  })).catch(() => {
    // Debug-only storage should never affect Porter order handling.
  });
}

function buildPendingDistanceMessage(_porterPickupDistance?: string | null, _porterTripDistance?: string | null): string {
  return 'SpendSense calculating...';
}

function isUsableCalculatedDistance(value?: string | null): boolean {
  return !!value && value !== 'N/A' && value !== 'Invalid Address';
}

function buildCalculatedDistanceMessage(
  distances: DistanceResult,
  _porterPickupDistance?: string | null,
  _porterTripDistance?: string | null
): string {
  const lines: string[] = [];
  const pickupCalculated = distances.pickupSource === 'calculated' && isUsableCalculatedDistance(distances.toPickup);
  const pickupEstimated = distances.pickupSource === 'porter_distance_from_ui' && isUsableCalculatedDistance(distances.toPickup);
  const tripCalculated = distances.tripSource === 'calculated' && isUsableCalculatedDistance(distances.tripDistance);

  if (!pickupCalculated && !pickupEstimated && !tripCalculated) {
    if (distances.failureReason === 'address_unclear') {
      return `SpendSense unavailable\n${distanceReasonLabel(distances.failureReason)}`;
    }
    return `SpendSense unavailable: ${distanceReasonLabel(distances.failureReason)}`;
  }

  lines.push(distances.isApproximate || pickupEstimated ? 'SpendSense approx' : 'SpendSense');
  if (pickupCalculated) {
    lines.push(`Pickup: ${distances.toPickup}`);
  } else if (pickupEstimated) {
    lines.push(`Pickup: ~${distances.toPickup.replace(/^~/, '')}`);
  } else {
    lines.push(`Pickup: ${distanceReasonLabel(distances.failureReason)}`);
  }

  if (tripCalculated) {
    lines.push(`Trip: ${distances.tripDistance}`);
  } else if (!distances.failureReason || distances.failureReason === 'stale_order_result') {
    lines.push('Trip: calculating...');
  } else {
    lines.push('Trip unavailable');
  }

  return lines.join('\n');
}

function hasAnyCalculatedDistance(distances: DistanceResult): boolean {
  return (
    (distances.pickupSource === 'calculated' && isUsableCalculatedDistance(distances.toPickup)) ||
    (distances.pickupSource === 'porter_distance_from_ui' && isUsableCalculatedDistance(distances.toPickup)) ||
    (distances.tripSource === 'calculated' && isUsableCalculatedDistance(distances.tripDistance))
  );
}

function decideUnavailableOverlay(
  signature: string,
  distances: DistanceResult,
  startedAt: number,
  screenType: PorterScreenType,
  now: number = Date.now()
): { shouldShow: boolean; reason: 'calculated_distance_displayed' | 'unavailable_overlay_shown_once' | 'unavailable_overlay_suppressed_stale' | 'display_throttled_duplicate' } {
  if (hasAnyCalculatedDistance(distances)) {
    return { shouldShow: true, reason: 'calculated_distance_displayed' };
  }

  if (screenType === 'offer' && now - startedAt >= UNAVAILABLE_OVERLAY_STALE_AFTER_MS) {
    return { shouldShow: false, reason: 'unavailable_overlay_suppressed_stale' };
  }

  if (unavailableOverlayShownSignature === signature) {
    return { shouldShow: false, reason: 'display_throttled_duplicate' };
  }

  return { shouldShow: true, reason: 'unavailable_overlay_shown_once' };
}

function markLatestPorterScreenState(
  signature: string | null,
  screenType: PorterScreenType,
  hasLiveOffer: boolean,
  seenAt: number
): void {
  latestPorterScreenState = { signature, screenType, hasLiveOffer, seenAt };
}

function isCurrentPorterResult(
  context: PorterResultContext,
  latestState: PorterScreenState | null = latestPorterScreenState,
  now: number = Date.now()
): boolean {
  if (context.runId !== activeRideRunId || activeRideSignature !== context.signature) return false;
  if (context.screenType === 'accepted_trip') return false;

  const ageMs = now - context.startedAt;
  if (context.screenType === 'offer') {
    return (
      ageMs <= OFFER_RESULT_STALE_LIMIT_MS &&
      latestState?.signature === context.signature &&
      latestState.hasLiveOffer &&
      now - latestState.seenAt <= OFFER_RESULT_STALE_LIMIT_MS
    );
  }

  return ageMs <= RESULT_STALE_LIMIT_MS + STALE_RESULT_GRACE_MS;
}

async function fetchJsonWithTimeout(url: string, timeoutMs: number) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, { signal: controller.signal });
    return await response.json();
  } finally {
    clearTimeout(timeoutId);
  }
}

function googleRouteCacheKey(origin: string, destination: string): string {
  return `${origin.toLowerCase().replace(/\s+/g, ' ').trim()}>${destination.toLowerCase().replace(/\s+/g, ' ').trim()}`;
}

function googleDistanceText(element: any): string | null {
  const meters = element?.distance?.value;
  if (typeof meters === 'number' && Number.isFinite(meters) && meters > 0) {
    return formatDistanceKm(meters / 1000);
  }
  return typeof element?.distance?.text === 'string' ? element.distance.text : null;
}

async function getGoogleDistanceMatrixKm(
  origin: string,
  destination: string,
  timeoutMs: number
): Promise<{ distanceText: string | null; status: string; error?: string; cacheHit?: boolean }> {
  const key = googleRouteCacheKey(origin, destination);
  const cached = googleRouteCache.get(key);
  if (cached && Date.now() - cached.ts <= ROUTE_CACHE_TTL_MS) {
    return { distanceText: formatDistanceKm(cached.km), status: 'OK', cacheHit: true };
  }

  const apiKey = getGoogleMapsApiKey();
  const data = await fetchJsonWithTimeout(
    `https://maps.googleapis.com/maps/api/distancematrix/json?origins=${encodeURIComponent(origin)}&destinations=${encodeURIComponent(destination)}&mode=driving&key=${apiKey}`,
    timeoutMs
  );
  if (data?.status !== 'OK') {
    return {
      distanceText: null,
      status: data?.status || 'UNKNOWN',
      error: data?.error_message || undefined,
    };
  }

  const element = data?.rows?.[0]?.elements?.[0];
  const status = element?.status || 'MISSING_ELEMENT';
  if (status !== 'OK') {
    return { distanceText: null, status };
  }

  const distanceText = googleDistanceText(element);
  const km = parseDistanceKm(distanceText);
  if (distanceText && km !== null) {
    googleRouteCache.set(key, { km, ts: Date.now() });
  }
  return { distanceText, status: distanceText ? 'OK' : 'MISSING_DISTANCE' };
}

// ═══════════════════════════════════════════════════════════════════════════════
// DISTANCE CALCULATION
// ═══════════════════════════════════════════════════════════════════════════════

// Haversine formula — real straight-line distance between two GPS coordinates
function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371; // Earth radius in km
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
    Math.cos((lat2 * Math.PI) / 180) *
    Math.sin(dLng / 2) *
    Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

// Geocode a location string using free OpenStreetMap Nominatim API.
// Keep this very short because Porter request popups disappear quickly.
function stripPorterDistanceMarkers(value: string): string {
  return value
    .replace(/\([^)]*\b[0-9]+(?:\.[0-9]+)?\s*(?:km|kms|kilometers?|m|meters?)\b[^)]*\)/gi, ' ')
    .replace(/\bpickup\s*:?\s*[0-9]+(?:\.[0-9]+)?\s*(?:km|kms|kilometers?|m|meters?)\s*(?:away)?\b/gi, ' ')
    .replace(/\bdrop\s*:?\s*[0-9]+(?:\.[0-9]+)?\s*(?:km|kms|kilometers?|m|meters?)\b/gi, ' ')
    .replace(/\b[0-9]+(?:\.[0-9]+)?\s*(?:km|kms|kilometers?|m|meters?)\s*(?:away)?\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function deduplicateAddressSegments(address: string): string {
  const parts = address.split(',').map(p => p.trim()).filter(Boolean);
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const part of parts) {
    const key = part.toLowerCase().replace(/\s+/g, ' ');
    if (!seen.has(key)) {
      seen.add(key);
      unique.push(part);
    }
  }
  // Strip trailing Porter accessibility repeat after "India"
  // Pattern: "..., India, SomeLocality, SomeCity, SomeState" → "..., India"
  const joined = unique.join(', ');
  return joined.replace(/,\s*India\s*(?:,\s*[^,]+){1,3}\s*$/i, ', India').trim();
}

function normalizeGeocodeText(value: string): string {
  const cleaned = stripPorterDistanceMarkers(
    cleanAddressCandidate(value)
      .replace(/…|\.\.\.+/g, ' ')
      .replace(/[₹]/g, ' ')
  )
    .replace(/\b(?:accept|reject|decline)\s+in\s+\d+\s*s\b/gi, ' ')
    .replace(/\s*,\s*,+/g, ', ')
    .replace(/\s+/g, ' ')
    .replace(/^,\s*|\s*,$/g, '')
    .trim();
  return deduplicateAddressSegments(cleaned);
}

function hasTruncatedAddress(value: string): boolean {
  return /…|\.\.\.+/.test(value);
}

function uniqueValues(values: string[]): string[] {
  const seen = new Set<string>();
  return values.filter(value => {
    const key = value.toLowerCase().replace(/\s+/g, ' ').trim();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function getAhmedabadLocalityCandidates(value: string): string[] {
  const lower = value.toLowerCase();
  return AHMEDABAD_AREA_NAMES.filter(area => {
    const escaped = area.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
    return new RegExp(`(^|[^a-z])${escaped}([^a-z]|$)`, 'i').test(lower);
  });
}

function hasAhmedabadContext(value: string): boolean {
  const lower = value.toLowerCase();
  return (
    lower.includes('ahmedabad') ||
    lower.includes('gujarat') ||
    /\b38\d{4}\b/.test(lower) ||
    getAhmedabadLocalityCandidates(value).length > 0
  );
}

function appendAhmedabadContext(value: string): string {
  const cleaned = value.trim();
  if (!cleaned) return cleaned;
  if (/ahmedabad|gujarat|india/i.test(cleaned)) return cleaned;
  return `${cleaned}, ${AHMEDABAD_CONTEXT}`;
}

function privacyHash(value: string): string {
  return (hashString(value) >>> 0).toString(16);
}

function hasRoadToken(value: string): boolean {
  return /\b(?:road|rd|marg|street|st|lane|highway|ashram|vivekanand|bridge|circle)\b/i.test(value);
}

function hasHouseOrPlotNumber(value: string): boolean {
  return /\b(?:house|shop|flat|plot|block|no\.?)?\s*\d{1,4}[a-z]?\b/i.test(value);
}

function hasBuildingOrLandmarkToken(value: string): boolean {
  return /\b(?:house|hospital|clinic|complex|tower|building|society|park|garden|mall|plaza|arcade|apartment|apartments|residency|residence|floor|ground floor|restaurant|hotel|cafe|samrat|darbar|palace|bhavan|nagar|mandir|temple|school|college|institute|bank|petrol|pump|station|market|bazar|bazaar|chowk|square|point|corner|gate|naka)\b/i.test(value);
}

function hasExactAddressDetail(value: string): boolean {
  return hasHouseOrPlotNumber(value) || /\b(?:floor|ground floor|first floor|shop|flat|block|tower|building)\b/i.test(value);
}

function googleCandidateClassRank(className: GoogleAddressCandidateClass): number {
  switch (className) {
    case 'exact_address':
      return 5;
    case 'landmark_road':
      return 4;
    case 'road_area':
      return 3;
    case 'locality_only':
      return 2;
    case 'broad_city':
      return 1;
    default:
      return 0;
  }
}

function classifyGoogleAddressCandidate(query: string, context: string = ''): GoogleAddressCandidateClass {
  const localities = getAhmedabadLocalityCandidates(`${query} ${context}`);
  const hasLocality = localities.length > 0;
  const hasRoad = hasRoadToken(query);
  const hasLandmark = hasBuildingOrLandmarkToken(query);
  const hasExact = hasExactAddressDetail(query);
  const hasOnlyCityContext = /ahmedabad|gujarat|india/i.test(query) && !hasLocality && !hasRoad && !hasLandmark && !hasExact;

  if (hasExact && hasLandmark && hasLocality) return 'exact_address';
  if (hasExact && hasRoad && hasLocality) return 'exact_address';
  if (hasRoad && hasLocality) return 'road_area';
  if (hasLandmark && hasLocality) return 'landmark_road';
  if (hasLocality) return 'locality_only';
  if (hasOnlyCityContext) return 'broad_city';
  if (hasRoad || hasLandmark || hasExact) return 'road_area';
  return 'broad_city';
}

function scoreGoogleAddressCandidate(query: string, className: GoogleAddressCandidateClass, context: string): { score: number; reasons: string[] } {
  const reasons: string[] = [className];
  let score = googleCandidateClassRank(className) * 100;
  const localityCount = getAhmedabadLocalityCandidates(`${query} ${context}`).length;
  if (hasExactAddressDetail(query)) {
    score += 30;
    reasons.push('exact_detail');
  }
  if (hasBuildingOrLandmarkToken(query)) {
    score += 24;
    reasons.push('landmark_detail');
  }
  if (hasRoadToken(query)) {
    score += 22;
    reasons.push('road_detail');
  }
  if (localityCount > 0) {
    score += 12;
    reasons.push('locality_detail');
  }
  if (/ahmedabad/i.test(query)) score += 6;
  if (/gujarat/i.test(query)) score += 4;
  if (/\b38\d{4}\b/.test(query)) {
    score += 10;
    reasons.push('pincode_detail');
  }
  if (/\b(?:pickup|drop|accept|reject|cancel|fare|cash|customer|phone|call)\b/i.test(query)) {
    score -= 80;
    reasons.push('action_text_penalty');
  }
  return { score, reasons: uniqueValues(reasons) };
}

function googleRouteConfidence(
  pickupClass?: GoogleAddressCandidateClass,
  dropClass?: GoogleAddressCandidateClass
): GoogleRouteConfidence {
  if (!pickupClass || !dropClass || pickupClass === 'broad_city' || dropClass === 'broad_city') return 'too_weak';
  const strong = new Set<GoogleAddressCandidateClass>(['exact_address', 'landmark_road']);
  if (strong.has(pickupClass) && strong.has(dropClass)) return 'high';
  if (pickupClass === 'locality_only' || dropClass === 'locality_only') return 'low';
  return 'medium';
}

function locationAgeBucket(location: LocationFix, now: number = Date.now()): string {
  const ageMs = Math.max(0, now - location.ts);
  if (ageMs <= 5_000) return 'fresh_under_5s';
  if (ageMs <= LOCATION_MAX_AGE_MS) return 'recent_5s_to_30s';
  return 'stale_over_30s';
}

function locationAccuracyBucket(location: LocationFix): string {
  const accuracy = location.accuracy;
  if (typeof accuracy !== 'number') return 'unknown';
  if (accuracy <= 50) return 'good_under_50m';
  if (accuracy <= LOCATION_MAX_ACCURACY_M) return 'usable_50m_to_200m';
  if (accuracy <= 500) return 'weak_200m_to_500m';
  return 'poor_over_500m';
}

function candidateBaseScore(type: GeocodeCandidateType): number {
  switch (type) {
    case 'exact_address':
      return 90;
    case 'full_cleaned':
      return 70;
    case 'pincode_city':
      return 58;
    case 'landmark_area':
      return 52;
    case 'locality':
      return 28;
    default:
      return 20;
  }
}

function scoreCandidateQuery(query: string, type: GeocodeCandidateType, context: string): { score: number; reasons: string[] } {
  const reasons: string[] = [];
  let score = candidateBaseScore(type);
  if (hasHouseOrPlotNumber(query)) {
    score += 12;
    reasons.push('exact_address_candidate_selected');
  }
  if (hasRoadToken(query)) {
    score += 14;
    reasons.push('road_match');
  }
  if (getAhmedabadLocalityCandidates(`${query} ${context}`).length > 0) {
    score += 10;
    reasons.push('locality_match');
  }
  if (/\b38\d{4}\b/.test(query)) {
    score += 12;
    reasons.push('pincode_match');
  }
  if (/ahmedabad/i.test(query)) score += 6;
  if (/gujarat/i.test(query)) score += 4;
  return { score, reasons };
}

function isExactAddressCandidate(value: string): boolean {
  return hasRoadToken(value) && (hasHouseOrPlotNumber(value) || getAhmedabadLocalityCandidates(value).length > 0);
}

function addGeocodeCandidate(
  candidates: GeocodeCandidate[],
  query: string,
  type: GeocodeCandidateType,
  context: string,
  reasons: string[]
): void {
  const cleaned = normalizeGeocodeText(query);
  if (cleaned.length < 3 || !/[a-zA-Z]{3,}/.test(cleaned)) return;
  const shouldUseAhmedabad = hasAhmedabadContext(`${cleaned} ${context}`);
  const withContext = shouldUseAhmedabad ? appendAhmedabadContext(cleaned) : cleaned;
  if (!isValidAddressString(withContext)) return;
  const key = withContext.toLowerCase().replace(/\s+/g, ' ').trim();
  if (candidates.some(candidate => candidate.query.toLowerCase().replace(/\s+/g, ' ').trim() === key)) return;
  const scored = scoreCandidateQuery(withContext, type, context);
  const truncatedAdjustment = reasons.includes('truncated_address_candidate_used')
    ? (type === 'locality' ? 60 : -20)
    : 0;
  candidates.push({
    query: withContext,
    type,
    regionHint: shouldUseAhmedabad ? 'ahmedabad' : 'unknown',
    reasons: uniqueValues([...reasons, ...scored.reasons]),
    score: scored.score + truncatedAdjustment,
  });
}

function buildGeocodeCandidates(address: string, contextText: string = ''): GeocodeCandidate[] {
  const context = `${address} ${contextText}`;
  const cleaned = normalizeGeocodeText(address);
  const truncated = hasTruncatedAddress(address);
  const candidates: GeocodeCandidate[] = [];
  const localities = uniqueValues(getAhmedabadLocalityCandidates(address));
  const pincodeMatches = Array.from(address.matchAll(/\b(38\d{4})\b/g)).map(match => match[1]);
  const segments = uniqueValues(
    cleaned
      .split(',')
      .map(segment => normalizeGeocodeText(segment))
      .filter(segment => segment.length >= 4 && /[a-zA-Z]{3,}/.test(segment))
      .filter(segment => !/^(pickup|drop|destination)$/i.test(segment))
  );

  const truncatedReason = truncated ? ['truncated_address_candidate_used'] : [];

  if (cleaned && isExactAddressCandidate(cleaned)) {
    addGeocodeCandidate(candidates, cleaned, 'exact_address', context, ['exact_address_candidate_selected']);
  }

  if (truncated) {
    localities.forEach(area => addGeocodeCandidate(
      candidates,
      area,
      'locality',
      context,
      ['locality_candidate_used', ...truncatedReason]
    ));
  }

  if (cleaned && !isExactAddressCandidate(cleaned)) {
    addGeocodeCandidate(candidates, cleaned, 'full_cleaned', context, truncatedReason);
  }

  localities.forEach(area => addGeocodeCandidate(
    candidates,
    area,
    'locality',
    context,
    ['locality_candidate_used', ...truncatedReason]
  ));

  pincodeMatches.forEach(pin => addGeocodeCandidate(
    candidates,
    `${pin}, Ahmedabad`,
    'pincode_city',
    context,
    ['locality_candidate_used']
  ));

  segments
    .filter(segment => segment.length <= 60)
    .forEach(segment => addGeocodeCandidate(
      candidates,
      segment,
      localities.some(area => segment.toLowerCase().includes(area.toLowerCase())) ? 'locality' : 'landmark_area',
      context,
      [localities.length ? 'locality_candidate_used' : 'landmark_candidate_used', ...truncatedReason]
    ));

  if (!truncated && localities.length === 0 && hasAhmedabadContext(context)) {
    segments.slice(0, 2).forEach(segment => addGeocodeCandidate(
      candidates,
      segment,
      'landmark_area',
      context,
      ['locality_candidate_used']
    ));
  }

  return candidates
    .sort((a, b) => b.score - a.score)
    .slice(0, GEOCODE_MAX_CANDIDATES);
}

function truncateAddressForGoogle(address: string, maxLen: number = 150): string {
  // Remove Porter accessibility trailing repeat: ", India, Locality, City, State"
  let cleaned = address.replace(/,\s*India\s*(?:,\s*[^,]{2,40}){1,3}\s*$/i, ', India');
  // Remove trailing partial word (truncated accessibility text)
  cleaned = cleaned.replace(/,\s*[A-Z][a-z]+\.\.\.\s*$/i, '');
  if (cleaned.length <= maxLen) return cleaned;
  const cutPoint = cleaned.lastIndexOf(',', maxLen);
  if (cutPoint > maxLen * 0.5) return cleaned.slice(0, cutPoint).trim();
  return cleaned.slice(0, maxLen).trim();
}

function addGoogleAddressCandidate(
  candidates: GoogleAddressCandidate[],
  query: string,
  context: string,
  forcedClass?: GoogleAddressCandidateClass
): void {
  const cleaned = normalizeGeocodeText(query);
  if (cleaned.length < 3 || !/[a-zA-Z]{3,}/.test(cleaned)) return;
  let withContext = hasAhmedabadContext(`${cleaned} ${context}`)
    ? appendAhmedabadContext(cleaned)
    : cleaned;
  withContext = truncateAddressForGoogle(withContext);
  if (!isValidAddressString(withContext)) return;
  const key = withContext.toLowerCase().replace(/\s+/g, ' ').trim();
  if (candidates.some(candidate => candidate.query.toLowerCase().replace(/\s+/g, ' ').trim() === key)) return;
  const className = forcedClass || classifyGoogleAddressCandidate(withContext, context);
  const scored = scoreGoogleAddressCandidate(withContext, className, context);
  const type: GeocodeCandidateType =
    className === 'exact_address'
      ? 'exact_address'
      : className === 'locality_only'
        ? 'locality'
        : 'landmark_area';
  candidates.push({
    query: withContext,
    type,
    className,
    hash: privacyHash(withContext),
    length: withContext.length,
    score: scored.score,
    reasons: scored.reasons,
  });
}

function buildGoogleAddressCandidates(address: string, contextText: string = ''): GoogleAddressCandidate[] {
  const cleaned = normalizeGeocodeText(address);
  const context = `${address} ${contextText}`;
  const candidates: GoogleAddressCandidate[] = [];
  const localities = uniqueValues([
    ...getAhmedabadLocalityCandidates(address),
    ...getAhmedabadLocalityCandidates(contextText),
  ]);
  const segments = uniqueValues(
    cleaned
      .split(',')
      .map(segment => normalizeGeocodeText(segment))
      .filter(segment => segment.length >= 3 && /[a-zA-Z]{3,}/.test(segment))
      .filter(segment => !/^(pickup|drop|destination)$/i.test(segment))
  );

  addGoogleAddressCandidate(
    candidates,
    cleaned,
    context
  );

  const locality = localities[0];
  const landmarkSegments = segments.filter(segment => {
    const lower = segment.toLowerCase();
    if (localities.some(area => lower === area.toLowerCase())) return false;
    return /\b(?:house|hospital|clinic|complex|tower|building|society|park|garden|road|rd|marg|highway|circle)\b/i.test(segment);
  });
  const nearSegments = segments.filter(segment => /\bnear\b/i.test(segment));

  if (landmarkSegments.length > 0 && locality) {
    const primaryLandmark = landmarkSegments[0];
    const near = nearSegments.find(segment => segment !== primaryLandmark);
    addGoogleAddressCandidate(
      candidates,
      near ? `${primaryLandmark}, ${near}, ${locality}` : `${primaryLandmark}, ${locality}`,
      context,
      hasExactAddressDetail(primaryLandmark) ? 'exact_address' : 'landmark_road'
    );
  }

  segments
    .filter(segment => /\b(?:road|rd|marg|highway|society)\b/i.test(segment))
    .forEach(segment => addGoogleAddressCandidate(
      candidates,
      locality && !segment.toLowerCase().includes(locality.toLowerCase())
        ? `${segment}, ${locality}`
        : segment,
      context,
      'road_area'
    ));

  localities.forEach(area => addGoogleAddressCandidate(
    candidates,
    area,
    context,
    'locality_only'
  ));

  if (hasAhmedabadContext(context)) {
    addGoogleAddressCandidate(candidates, 'Ahmedabad, Gujarat, India', context, 'broad_city');
  }

  return candidates
    .sort((a, b) => {
      const rankDelta = googleCandidateClassRank(b.className) - googleCandidateClassRank(a.className);
      if (rankDelta !== 0) return rankDelta;
      return b.score - a.score;
    })
    .slice(0, GEOCODE_MAX_CANDIDATES);
}

function summarizeGeocodeCandidates(candidates: GeocodeCandidate[]): Array<{ type: string; summary: string; score: number; reasons: string }> {
  return candidates.map(candidate => ({
    type: candidate.type,
    summary: summarizeSensitiveValue(candidate.query),
    score: candidate.score,
    reasons: candidate.reasons.join(','),
  }));
}

function geocodeCacheKey(candidate: GeocodeCandidate): string {
  return candidate.query.toLowerCase().replace(/\s+/g, ' ').trim();
}

function isCoordsInBounds(coords: { lat: number; lng: number }, bounds: { minLat: number; maxLat: number; minLng: number; maxLng: number }): boolean {
  return coords.lat >= bounds.minLat && coords.lat <= bounds.maxLat && coords.lng >= bounds.minLng && coords.lng <= bounds.maxLng;
}

function isGeocodeResultInExpectedRegion(coords: { lat: number; lng: number }, candidate: GeocodeCandidate): boolean {
  if (candidate.regionHint === 'ahmedabad') return isCoordsInBounds(coords, GUJARAT_BOUNDS);
  if (candidate.regionHint === 'india') return isCoordsInBounds(coords, INDIA_BOUNDS);
  return true;
}

function responseTextForScoring(raw: any): string {
  const address = raw?.address && typeof raw.address === 'object'
    ? Object.values(raw.address).filter(Boolean).join(' ')
    : '';
  return `${raw?.display_name || ''} ${address}`.toLowerCase();
}

function scoreGeocodeResponse(candidate: GeocodeCandidate, raw: any): { score: number; selectedReason: string } {
  const responseText = responseTextForScoring(raw);
  let score = candidate.score;
  const reasons: string[] = ['candidate_score_selected'];

  const queryLocalities = getAhmedabadLocalityCandidates(candidate.query);
  if (queryLocalities.some(area => responseText.includes(area.toLowerCase()))) {
    score += 16;
    reasons.push('locality_match');
  }
  if (hasRoadToken(candidate.query) && /\b(?:road|rd|marg|street|lane|highway|ashram|vivekanand)\b/i.test(responseText)) {
    score += 18;
    reasons.push('road_match');
  }
  const pincode = candidate.query.match(/\b38\d{4}\b/)?.[0];
  if (pincode && responseText.includes(pincode)) {
    score += 18;
    reasons.push('pincode_match');
  }
  if (responseText.includes('ahmedabad')) score += 8;
  if (responseText.includes('gujarat')) score += 6;
  if (candidate.type === 'locality') {
    score -= 18;
    reasons.push('broad_locality_candidate_rejected');
  }
  if (candidate.type === 'exact_address') {
    reasons.push('exact_address_candidate_selected');
  }

  return { score, selectedReason: uniqueValues(reasons).join(',') };
}

async function geocodeCandidate(candidate: GeocodeCandidate, timeoutMs: number = GEOCODE_TIMEOUT_MS): Promise<GeocodeAttemptResult> {
  const cacheKey = geocodeCacheKey(candidate);
  const cached = geocodeCache.get(cacheKey);
  if (cached && Date.now() - cached.ts <= GEOCODE_CACHE_TTL_MS) {
    return {
      coords: cached.coords,
      reason: 'geocode_cache_hit',
      candidateType: cached.candidateType,
      score: cached.score,
      selectedReason: 'geocode_cache_hit',
    };
  }

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(candidate.query)}&format=json&limit=1&countrycodes=in&addressdetails=1`;
    const res = await fetch(url, {
      headers: { 'User-Agent': 'SpendSense/1.0' },
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    
    if (!res) {
      return { coords: null, reason: 'geocode_candidate_failed', candidateType: candidate.type };
    }
    if (!res.ok) {
      if (__DEV__) console.warn('[Porter] Nominatim HTTP error:', res.status);
      return { coords: null, reason: 'geocode_candidate_failed', candidateType: candidate.type };
    }
    
    const data = await res.json();
    if (data.length > 0) {
      const coords = { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon) };
      if (!isGeocodeResultInExpectedRegion(coords, candidate)) {
        if (__DEV__) console.warn('[Porter] Nominatim rejected out-of-region result:', {
          type: candidate.type,
          regionHint: candidate.regionHint,
        });
        return { coords: null, reason: 'geocode_result_out_of_region', candidateType: candidate.type };
      }
      const scored = scoreGeocodeResponse(candidate, data[0]);
      geocodeCache.set(cacheKey, {
        coords,
        ts: Date.now(),
        score: scored.score,
        candidateType: candidate.type,
      });
      if (__DEV__) console.log('[Porter] Nominatim geocoded candidate →', {
        type: candidate.type,
        regionHint: candidate.regionHint,
        score: scored.score,
      });
      return {
        coords,
        reason: candidate.reasons.includes('locality_candidate_used') ? 'geocode_candidate_success' : undefined,
        candidateType: candidate.type,
        score: scored.score,
        selectedReason: scored.selectedReason,
      };
    }
    if (__DEV__) console.warn('[Porter] Nominatim: No results for candidate:', { type: candidate.type });
    return { coords: null, reason: 'geocode_candidate_failed', candidateType: candidate.type };
  } catch (error: any) {
    if (__DEV__) console.warn('[Porter] Nominatim candidate error:', {
      type: candidate.type,
      message: error.message,
    });
    return { coords: null, reason: 'geocode_candidate_failed', candidateType: candidate.type };
  }
}

async function geocodeFromCandidates(
  candidates: GeocodeCandidate[],
  deadlineAt?: number
): Promise<{ coords: { lat: number; lng: number } | null; reason?: string; candidateType?: GeocodeCandidateType; attempts: number; score?: number; selectedReason?: string }> {
  if (deadlineAt && Date.now() > deadlineAt - 150) {
    return { coords: null, reason: 'stale_order_result', attempts: 0 };
  }

  const limited = candidates.slice(0, GEOCODE_PARALLEL_CANDIDATES);
  const remaining = deadlineAt ? Math.max(300, Math.min(GEOCODE_TIMEOUT_MS, deadlineAt - Date.now() - 150)) : GEOCODE_TIMEOUT_MS;
  const results = await Promise.all(limited.map(candidate => geocodeCandidate(candidate, remaining)));
  const successful = results
    .filter(result => result.coords)
    .sort((a, b) => (b.score || 0) - (a.score || 0));

  if (successful.length > 0) {
    const selected = successful[0];
    const broadLocalityRejected =
      selected.candidateType === 'exact_address' &&
      successful.some(result => result !== selected && result.candidateType === 'locality');
    return {
      coords: selected.coords,
      reason: selected.reason || 'geocode_candidate_success',
      candidateType: selected.candidateType,
      attempts: limited.length,
      score: selected.score,
      selectedReason: broadLocalityRejected
        ? `${selected.selectedReason || 'candidate_score_selected'},broad_locality_candidate_rejected`
        : selected.selectedReason || 'candidate_score_selected',
    };
  }

  const last = results[results.length - 1];
  return {
    coords: null,
    reason: results.find(result => result.reason === 'geocode_result_out_of_region')?.reason || last?.reason,
    candidateType: last?.candidateType,
    attempts: limited.length,
  };
}

// Strict regex: address must be min 5 chars, contain at least one letter, not be just digits/symbols
const VALID_ADDRESS_RE = /[a-zA-Z]{3,}/;
function isValidAddressString(s: string): boolean {
  return typeof s === 'string' && s.trim().length >= 5 && VALID_ADDRESS_RE.test(s);
}

function parseDistanceKm(value?: string | null): number | null {
  if (!value) return null;
  const normalized = value.replace(/,/g, ' ');
  const match = normalized.match(/([0-9]+(?:\.[0-9]+)?)\s*(km|kms|kilometers?|m|meters?)\b/i);
  if (!match) return null;
  const numeric = Number(match[1]);
  if (!Number.isFinite(numeric)) return null;
  const unit = match[2].toLowerCase();
  return unit.startsWith('m') && !unit.startsWith('mi') ? numeric / 1000 : numeric;
}

function formatDistanceKm(km: number): string {
  const rounded = Math.round(km * 10) / 10;
  return `${Number.isInteger(rounded) ? rounded.toFixed(0) : rounded.toFixed(1)} km`;
}

function routeCacheKey(from: { lat: number; lng: number }, to: { lat: number; lng: number }): string {
  return `${from.lat.toFixed(5)},${from.lng.toFixed(5)}>${to.lat.toFixed(5)},${to.lng.toFixed(5)}`;
}

function isReasonableRouteKm(routeKm: number, straightKm: number): boolean {
  if (!Number.isFinite(routeKm) || routeKm <= 0) return false;
  if (straightKm <= 0.05) return routeKm < 2;
  return routeKm >= straightKm * 0.65 && routeKm <= Math.max(straightKm * 3.5, straightKm + 15);
}

async function getOsrmRouteDistanceKm(
  from: { lat: number; lng: number },
  to: { lat: number; lng: number },
  deadlineAt?: number
): Promise<number | null> {
  if (deadlineAt && Date.now() > deadlineAt - 150) return null;
  const key = routeCacheKey(from, to);
  const cached = routeCache.get(key);
  if (cached && Date.now() - cached.ts <= ROUTE_CACHE_TTL_MS) return cached.km;

  try {
    const timeoutMs = deadlineAt
      ? Math.max(300, Math.min(ROUTE_TIMEOUT_MS, deadlineAt - Date.now() - 150))
      : ROUTE_TIMEOUT_MS;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    const url = `https://router.project-osrm.org/route/v1/driving/${from.lng},${from.lat};${to.lng},${to.lat}?overview=false&alternatives=false&steps=false`;
    const res = await fetch(url, {
      headers: { 'User-Agent': 'SpendSense/1.0' },
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    if (!res.ok) return null;
    const data = await res.json();
    const meters = data?.routes?.[0]?.distance;
    const routeKm = typeof meters === 'number' ? meters / 1000 : null;
    if (routeKm === null) return null;
    const straightKm = haversineKm(from.lat, from.lng, to.lat, to.lng);
    if (!isReasonableRouteKm(routeKm, straightKm)) return null;
    routeCache.set(key, { km: routeKm, ts: Date.now() });
    return routeKm;
  } catch {
    return null;
  }
}

function normalizePorterPickupDistance(text?: string | null): string | null {
  if (!text) return null;
  const km = parseDistanceKm(text);
  if (km === null || km <= 0 || km > MAX_REASONABLE_PORTER_PICKUP_KM) return null;
  return formatDistanceKm(km);
}

function normalizePorterTripDistance(text?: string | null): string | null {
  if (!text) return null;
  const km = parseDistanceKm(text);
  if (km === null || km <= 0 || km > MAX_REASONABLE_PORTER_PICKUP_KM) return null;
  return formatDistanceKm(km);
}

function compactLocationKey(value: string): string {
  return value
    .toLowerCase()
    .replace(/\b(?:pickup|drop|destination|gujarat|india)\b/g, ' ')
    .replace(/\b\d{5,}\b/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function areDistinctPorterLocations(pickup: string, drop: string): boolean {
  const pickupKey = compactLocationKey(pickup);
  const dropKey = compactLocationKey(drop);
  if (!pickupKey || !dropKey) return false;
  if (pickupKey === dropKey) return false;
  const pickupTokens = new Set(pickupKey.split(' ').filter(token => token.length >= 4));
  const dropTokens = dropKey.split(' ').filter(token => token.length >= 4);
  const sharedTokens = dropTokens.filter(token => pickupTokens.has(token)).length;
  return sharedTokens < Math.min(2, Math.max(1, Math.min(pickupTokens.size, dropTokens.length)));
}

function normalizeTripDistance(
  calculatedDistance: string | null,
  pickup: string,
  drop: string
): { tripDistance: string; failureReason?: DistanceFailureReason; detail?: string; tripSource: DistanceResult['tripSource'] } {
  const calculatedKm = parseDistanceKm(calculatedDistance);
  if (
    calculatedKm !== null &&
    calculatedKm >= 0 &&
    calculatedKm < MIN_REASONABLE_PORTER_TRIP_KM &&
    areDistinctPorterLocations(pickup, drop)
  ) {
    return {
      tripDistance: 'N/A',
      failureReason: 'suspicious_trip_distance_suppressed',
      detail: 'distinct_locations_tiny_trip',
      tripSource: 'unavailable',
    };
  }

  return {
    tripDistance: calculatedDistance || 'N/A',
    tripSource: calculatedDistance ? 'calculated' : 'unavailable',
  };
}

function normalizeCalculatedPickupDistance(
  text: string | null
): { toPickup: string; failureReason?: DistanceFailureReason; detail?: string; pickupSource: DistanceResult['pickupSource'] } {
  const km = parseDistanceKm(text);
  if (km !== null && km > MAX_REASONABLE_PORTER_PICKUP_KM) {
    return {
      toPickup: 'N/A',
      failureReason: 'impossible_distance_suppressed',
      detail: 'device_location_mismatch',
      pickupSource: 'unavailable',
    };
  }

  return {
    toPickup: text || 'N/A',
    pickupSource: text ? 'calculated' : 'unavailable',
  };
}

function pickupDistanceToleranceKm(referenceKm: number): number {
  return Math.max(PICKUP_DISTANCE_MATCH_MIN_TOLERANCE_KM, referenceKm * PICKUP_DISTANCE_MATCH_RATIO_TOLERANCE);
}

function pickupDistanceDisagreesWithPorter(calculatedText?: string | null, porterText?: string | null): boolean {
  const calculatedKm = parseDistanceKm(calculatedText);
  const porterKm = parseDistanceKm(porterText);
  if (calculatedKm === null || porterKm === null || porterKm <= 0) return false;
  return Math.abs(calculatedKm - porterKm) > pickupDistanceToleranceKm(porterKm);
}

function normalizeEstimatedPorterPickupDistance(porterText?: string | null): string | null {
  return normalizePorterPickupDistance(porterText);
}

function estimatedPorterPickupDistanceResult(
  porterPickupDistance?: string | null,
  failureReason?: DistanceFailureReason,
  detail: string = 'porter_visible_pickup_estimate'
): { toPickup: string; failureReason?: DistanceFailureReason; detail?: string; pickupSource: DistanceResult['pickupSource'] } | null {
  const normalizedPorterPickup = normalizeEstimatedPorterPickupDistance(porterPickupDistance);
  if (!normalizedPorterPickup) return null;
  return {
    toPickup: normalizedPorterPickup,
    failureReason,
    detail,
    pickupSource: 'porter_distance_from_ui',
  };
}

function resolvePickupDistanceResult(
  calculatedResult: ReturnType<typeof normalizeCalculatedPickupDistance>,
  porterPickupDistance: string | null | undefined,
  routeConfidence?: GoogleRouteConfidence,
  locationIssue?: DistanceFailureReason,
  diagnostics?: string[]
): ReturnType<typeof normalizeCalculatedPickupDistance> {
  if (locationIssue === 'device_location_mismatch' || locationIssue === 'impossible_distance_suppressed') {
    return {
      toPickup: 'N/A',
      failureReason: locationIssue,
      detail: locationIssue,
      pickupSource: 'unavailable',
    };
  }

  if (locationIssue === 'current_location_stale' || locationIssue === 'current_location_low_accuracy') {
    const estimated = estimatedPorterPickupDistanceResult(porterPickupDistance, locationIssue, locationIssue);
    if (estimated) {
      diagnostics?.push('pickup_porter_estimate_used');
      return estimated;
    }
  }

  if (
    calculatedResult.pickupSource === 'calculated' &&
    routeConfidence === 'low' &&
    pickupDistanceDisagreesWithPorter(calculatedResult.toPickup, porterPickupDistance)
  ) {
    const estimated = estimatedPorterPickupDistanceResult(porterPickupDistance, undefined, 'pickup_disagreed_with_porter_ui');
    if (estimated) {
      diagnostics?.push('pickup_google_low_confidence_mismatch');
      diagnostics?.push('pickup_porter_estimate_used');
      return estimated;
    }
  }

  if (
    calculatedResult.pickupSource === 'unavailable' &&
    calculatedResult.failureReason !== 'device_location_mismatch' &&
    calculatedResult.failureReason !== 'impossible_distance_suppressed'
  ) {
    const estimated = estimatedPorterPickupDistanceResult(
      porterPickupDistance,
      calculatedResult.failureReason || 'geocode_failed_but_ui_pickup_used',
      calculatedResult.detail || 'calculated_pickup_unavailable'
    );
    if (estimated) {
      diagnostics?.push('pickup_porter_estimate_used');
      return estimated;
    }
  }

  return calculatedResult;
}

function differenceBucket(calculatedText?: string | null, porterText?: string | null): string | null {
  const calculatedKm = parseDistanceKm(calculatedText);
  const porterKm = parseDistanceKm(porterText);
  if (calculatedKm === null || porterKm === null) return null;
  const diffKm = Math.abs(calculatedKm - porterKm);
  const pct = porterKm > 0 ? diffKm / porterKm : 0;
  if (diffKm < 0.5 && pct < 0.25) return 'close_under_0_5km';
  if (diffKm < 2) return 'moderate_0_5_to_2km';
  if (pct >= 0.5) return 'large_over_50_percent';
  return 'large_over_2km';
}

function routeDiagnostics(
  events: string[],
  startedAt: number,
  pickupText?: string | null,
  tripText?: string | null,
  porterPickupText?: string | null,
  porterTripText?: string | null,
  metadata: Partial<NonNullable<DistanceResult['routeDiagnostics']>> = {}
): DistanceResult['routeDiagnostics'] {
  return {
    events: uniqueValues(events),
    routeTimingMs: Date.now() - startedAt,
    ...metadata,
    differenceBucketVsPorterUi: {
      pickup: differenceBucket(pickupText, porterPickupText),
      trip: differenceBucket(tripText, porterTripText),
    },
  };
}

function googleCandidateDiagnostics(
  pickupCandidate?: GoogleAddressCandidate,
  dropCandidate?: GoogleAddressCandidate,
  confidence?: GoogleRouteConfidence,
  locationFix?: LocationFix,
  reason?: string
): Partial<NonNullable<DistanceResult['routeDiagnostics']>> {
  return {
    provider: 'google_distance_matrix',
    routeMode: 'address_string',
    pickupCandidateClass: pickupCandidate?.className,
    dropCandidateClass: dropCandidate?.className,
    pickupCandidateHash: pickupCandidate?.hash,
    dropCandidateHash: dropCandidate?.hash,
    pickupCandidateLength: pickupCandidate?.length,
    dropCandidateLength: dropCandidate?.length,
    candidateScore: (pickupCandidate?.score || 0) + (dropCandidate?.score || 0),
    confidence,
    reason,
    locationAgeBucket: locationFix ? locationAgeBucket(locationFix) : undefined,
    accuracyBucket: locationFix ? locationAccuracyBucket(locationFix) : undefined,
  };
}

function googleRouteCandidatePairs(
  pickupCandidates: GoogleAddressCandidate[],
  dropCandidates: GoogleAddressCandidate[]
): Array<{ pickup: GoogleAddressCandidate; drop: GoogleAddressCandidate; confidence: GoogleRouteConfidence; score: number }> {
  return pickupCandidates
    .slice(0, GEOCODE_MAX_CANDIDATES)
    .flatMap(pickupCandidate => dropCandidates.slice(0, GEOCODE_MAX_CANDIDATES).map(dropCandidate => ({
      pickup: pickupCandidate,
      drop: dropCandidate,
      confidence: googleRouteConfidence(pickupCandidate.className, dropCandidate.className),
      score: pickupCandidate.score + dropCandidate.score,
    })))
    .sort((a, b) => {
      const confidenceRank: Record<GoogleRouteConfidence, number> = {
        high: 4,
        medium: 3,
        low: 2,
        too_weak: 1,
      };
      const confidenceDelta = confidenceRank[b.confidence] - confidenceRank[a.confidence];
      if (confidenceDelta !== 0) return confidenceDelta;
      return b.score - a.score;
    });
}

function mergeFailureReason(...reasons: Array<DistanceFailureReason | undefined>): DistanceFailureReason | undefined {
  return reasons.find(Boolean);
}

async function getDistancesKm(
  currentLat: number,
  currentLng: number,
  pickup: string,
  drop: string,
  porterPickupDistance?: string | null,
  deadlineAt?: number,
  porterTripDistance?: string | null,
  sourceText?: string,
  currentLocation?: Partial<LocationFix>
): Promise<DistanceResult> {
  const startedAt = Date.now();
  const locationFix: LocationFix = {
    lat: currentLat,
    lng: currentLng,
    ts: typeof currentLocation?.ts === 'number' ? currentLocation.ts : Date.now(),
    accuracy: typeof currentLocation?.accuracy === 'number' ? currentLocation.accuracy : null,
  };
  const locationIssue = getCurrentLocationIssue(locationFix);
  const pickupCandidates = buildGeocodeCandidates(pickup, sourceText || drop);
  const dropCandidates = buildGeocodeCandidates(drop, sourceText || pickup);
  const googlePickupCandidates = buildGoogleAddressCandidates(pickup, sourceText || drop);
  const googleDropCandidates = buildGoogleAddressCandidates(drop, sourceText || pickup);
  const primaryPickupQuery = googlePickupCandidates[0]?.query || pickupCandidates[0]?.query || normalizeGeocodeText(pickup);
  const primaryDropQuery = googleDropCandidates[0]?.query || dropCandidates[0]?.query || normalizeGeocodeText(drop);
  const diagnostics: string[] = [];
  if (locationIssue) diagnostics.push('current_location_weak');

  // API QUOTA PROTECTION: Reject clearly invalid addresses before making network calls
  if (!pickupCandidates.length || !dropCandidates.length) {
    if (__DEV__) console.warn('[Porter] Invalid address strings — skipping API call:', {
      pickup: summarizeSensitiveValue(pickup),
      drop: summarizeSensitiveValue(drop),
    });
    await AsyncStorage.setItem('debug_porter_api_error', 'Invalid address format');
    return {
      toPickup: 'Invalid Address',
      tripDistance: 'Invalid Address',
      failureReason: 'invalid_address',
      detail: 'address validation failed',
      pickupSource: 'unavailable',
      tripSource: 'unavailable',
    };
  }

  let distanceApiFailed = false;
  let distanceApiDetail = '';
  const googleApiKey = getGoogleMapsApiKey();

  const googlePairs = googleRouteCandidatePairs(googlePickupCandidates, googleDropCandidates);

  if (googleApiKey && googlePairs.length) {
    try {
      const origin = `${currentLat},${currentLng}`;
      const usablePairs = googlePairs.filter(pair => pair.confidence !== 'too_weak');
      if (!usablePairs.length) {
        diagnostics.push('address_string_route_failed');
        await AsyncStorage.setItem('debug_porter_api_error', 'address unclear');
        await AsyncStorage.setItem('debug_porter_api_response', JSON.stringify({
          provider: 'google_distance_matrix',
          routeMode: 'address_string',
          reason: 'address_unclear',
          confidence: 'too_weak',
          pickupCandidateClass: googlePairs[0]?.pickup.className || null,
          dropCandidateClass: googlePairs[0]?.drop.className || null,
          pickupCandidateHash: googlePairs[0]?.pickup.hash || null,
          dropCandidateHash: googlePairs[0]?.drop.hash || null,
          pickupCandidateLength: googlePairs[0]?.pickup.length || null,
          dropCandidateLength: googlePairs[0]?.drop.length || null,
          candidateScore: googlePairs[0]?.score || null,
          locationAgeBucket: locationAgeBucket(locationFix),
          accuracyBucket: locationAccuracyBucket(locationFix),
        }));
        return {
          toPickup: 'N/A',
          tripDistance: 'N/A',
          failureReason: 'address_unclear',
          detail: 'google_address_candidates_too_weak',
          pickupSource: 'unavailable',
          tripSource: 'unavailable',
          distanceProvider: 'google_distance_matrix',
          isApproximate: true,
          calculationMs: Date.now() - startedAt,
          routeDiagnostics: routeDiagnostics(
            diagnostics,
            startedAt,
            null,
            null,
            porterPickupDistance,
            porterTripDistance,
            googleCandidateDiagnostics(googlePairs[0]?.pickup, googlePairs[0]?.drop, 'too_weak', locationFix, 'address_unclear')
          ),
        };
      }

      let elementError = '';
      const candidateAttempts = usablePairs[0].confidence === 'low' ? usablePairs.slice(0, 2) : usablePairs.slice(0, 1);
      for (const pair of candidateAttempts) {
        if (__DEV__) console.log('[Porter] Calling Google Maps API with:', {
          origin: summarizeSensitiveValue(origin),
          pickup: summarizeSensitiveValue(pair.pickup.query),
          drop: summarizeSensitiveValue(pair.drop.query),
          pickupCandidateClass: pair.pickup.className,
          dropCandidateClass: pair.drop.className,
          confidence: pair.confidence,
          candidateScore: pair.score,
        });

        const timeoutMs = deadlineAt
          ? Math.max(500, Math.min(1800, deadlineAt - Date.now() - 200))
          : 1800;
        const [tripRoute, pickupRoute] = await Promise.all([
          getGoogleDistanceMatrixKm(pair.pickup.query, pair.drop.query, timeoutMs),
          locationIssue
            ? Promise.resolve({ distanceText: null, status: locationIssue })
            : getGoogleDistanceMatrixKm(origin, pair.pickup.query, timeoutMs),
        ]);

        if (__DEV__) console.log('[Porter] Google Maps API Response:', {
          toPickupStatus: pickupRoute.status,
          tripStatus: tripRoute.status,
          confidence: pair.confidence,
        });

        const responseDiagnostics = {
          provider: 'google_distance_matrix',
          routeMode: 'address_string',
          toPickupStatus: pickupRoute.status,
          tripStatus: tripRoute.status,
          pickupCandidateClass: pair.pickup.className,
          dropCandidateClass: pair.drop.className,
          pickupCandidateHash: pair.pickup.hash,
          dropCandidateHash: pair.drop.hash,
          pickupCandidateLength: pair.pickup.length,
          dropCandidateLength: pair.drop.length,
          candidateScore: pair.score,
          routeTimingMs: Date.now() - startedAt,
          confidence: pair.confidence,
          reason: pair.confidence === 'low' ? 'candidate_low_confidence' : 'candidate_selected',
          locationAgeBucket: locationAgeBucket(locationFix),
          accuracyBucket: locationAccuracyBucket(locationFix),
        };
        await AsyncStorage.setItem('debug_porter_api_response', JSON.stringify(responseDiagnostics));

        const tripResult = normalizeTripDistance(tripRoute.distanceText, pair.pickup.query, pair.drop.query);
        const calculatedPickupResult = locationIssue
          ? {
              toPickup: 'N/A',
              failureReason: locationIssue,
              detail: locationIssue,
              pickupSource: 'unavailable' as const,
            }
          : normalizeCalculatedPickupDistance(pickupRoute.distanceText);
        const pickupResult = resolvePickupDistanceResult(
          calculatedPickupResult,
          porterPickupDistance,
          pair.confidence,
          locationIssue || undefined,
          diagnostics
        );

        if (
          tripRoute.status === 'OK' &&
          (locationIssue || pickupRoute.status === 'OK') &&
          (tripResult.tripSource === 'calculated' || pickupResult.pickupSource === 'calculated')
        ) {
          diagnostics.push('google_address_route_used');
          await AsyncStorage.setItem('debug_porter_api_error', 'Success');
          const failureReason = mergeFailureReason(
            pickupResult.failureReason,
            tripResult.failureReason,
            locationIssue || undefined
          );
          return {
            toPickup: pickupResult.toPickup,
            tripDistance: tripResult.tripDistance,
            failureReason,
            detail: pickupResult.detail || tripResult.detail || locationIssue || (pair.confidence === 'low' ? 'candidate_low_confidence' : undefined),
            pickupSource: pickupResult.pickupSource,
            tripSource: tripResult.tripSource,
            distanceProvider: 'google_distance_matrix',
            isApproximate: pair.confidence === 'low',
            calculationMs: Date.now() - startedAt,
            routeDiagnostics: routeDiagnostics(
              diagnostics,
              startedAt,
              pickupResult.toPickup,
              tripResult.tripDistance,
              porterPickupDistance,
              porterTripDistance,
              googleCandidateDiagnostics(
                pair.pickup,
                pair.drop,
                pair.confidence,
                locationFix,
                pair.confidence === 'low' ? 'candidate_low_confidence' : 'candidate_selected'
              )
            ),
          };
        }

        elementError = `Element status: toPickup=${pickupRoute.status}, trip=${tripRoute.status}`;
      }

      if (__DEV__) console.warn('[Porter] Google Maps element error:', elementError);
      await AsyncStorage.setItem('debug_porter_api_error', elementError);
      diagnostics.push('address_string_route_failed');
      distanceApiFailed = true;
      distanceApiDetail = elementError;
    } catch (error: any) {
      if (__DEV__) console.error('[Porter] Google Maps API exception:', error);
      await AsyncStorage.setItem('debug_porter_api_error', `Exception: ${error.message}`);
      diagnostics.push('address_string_route_failed');
      distanceApiFailed = true;
      distanceApiDetail = error.message || 'Google Maps exception';
    }
  } else {
    await AsyncStorage.setItem('debug_porter_api_error', googleApiKey ? 'Invalid address format' : 'No API key configured');
  }

  if (deadlineAt && Date.now() > deadlineAt) {
    return {
      toPickup: 'N/A',
      tripDistance: 'N/A',
      failureReason: 'stale_order_result',
      detail: 'deadline reached before fallback',
      pickupSource: 'unavailable',
      tripSource: 'unavailable',
    };
  }

  // Fallback: Free Nominatim geocoding + Haversine
  if (__DEV__) console.log('[Porter] Using Nominatim fallback for:', {
    pickup: summarizeSensitiveValue(pickup),
    drop: summarizeSensitiveValue(drop),
    pickupCandidates: pickupCandidates.length,
    dropCandidates: dropCandidates.length,
  });
  const ROAD_FACTOR = 1.12;
  const [pickupLookup, dropLookup] = await Promise.all([
    geocodeFromCandidates(pickupCandidates, deadlineAt),
    geocodeFromCandidates(dropCandidates, deadlineAt),
  ]);
  const pickupCoords = pickupLookup.coords;
  const dropCoords = dropLookup.coords;
  
  if (__DEV__) console.log('[Porter] Nominatim results:', {
    pickupFound: !!pickupCoords,
    dropFound: !!dropCoords,
    pickupCandidateType: pickupLookup.candidateType,
    dropCandidateType: dropLookup.candidateType,
    pickupScore: pickupLookup.score,
    dropScore: dropLookup.score,
  });
  await AsyncStorage.setItem('debug_porter_nominatim', JSON.stringify({
    pickupFound: !!pickupCoords,
    dropFound: !!dropCoords,
    pickupCandidates: summarizeGeocodeCandidates(pickupCandidates),
    dropCandidates: summarizeGeocodeCandidates(dropCandidates),
    pickupCandidateType: pickupLookup.candidateType || null,
    dropCandidateType: dropLookup.candidateType || null,
    pickupReason: pickupLookup.reason || null,
    dropReason: dropLookup.reason || null,
    pickupSelectedReason: pickupLookup.selectedReason || null,
    dropSelectedReason: dropLookup.selectedReason || null,
    pickupScore: pickupLookup.score || null,
    dropScore: dropLookup.score || null,
    pickupSource: 'calculated',
    tripSource: 'calculated',
  }));

  if (googleApiKey && pickupCoords && dropCoords) {
    try {
      const pickupOrigin = `${currentLat},${currentLng}`;
      const pickupDestination = `${pickupCoords.lat},${pickupCoords.lng}`;
      const tripOrigin = pickupDestination;
      const tripDestination = `${dropCoords.lat},${dropCoords.lng}`;
      const timeoutMs = deadlineAt
        ? Math.max(500, Math.min(1600, deadlineAt - Date.now() - 200))
        : 1600;
      const [tripRoute, pickupRoute] = await Promise.all([
        getGoogleDistanceMatrixKm(tripOrigin, tripDestination, timeoutMs),
        locationIssue
          ? Promise.resolve({ distanceText: null, status: locationIssue })
          : getGoogleDistanceMatrixKm(pickupOrigin, pickupDestination, timeoutMs),
      ]);
      const tripResult = normalizeTripDistance(tripRoute.distanceText, primaryPickupQuery, primaryDropQuery);
      const calculatedPickupResult = locationIssue
        ? {
            toPickup: 'N/A',
            failureReason: locationIssue,
            detail: locationIssue,
            pickupSource: 'unavailable' as const,
          }
        : normalizeCalculatedPickupDistance(pickupRoute.distanceText);
      const pickupResult = resolvePickupDistanceResult(
        calculatedPickupResult,
        porterPickupDistance,
        undefined,
        locationIssue || undefined,
        diagnostics
      );

      if (
        tripRoute.status === 'OK' &&
        (locationIssue || pickupRoute.status === 'OK') &&
        (tripResult.tripSource === 'calculated' || pickupResult.pickupSource === 'calculated')
      ) {
        diagnostics.push('google_coordinate_route_used');
        await AsyncStorage.setItem('debug_porter_api_response', JSON.stringify({
          provider: 'google_distance_matrix',
          routeMode: 'geocoded_coordinate',
          toPickupStatus: pickupRoute.status,
          tripStatus: tripRoute.status,
          pickupCandidateType: pickupLookup.candidateType || null,
          dropCandidateType: dropLookup.candidateType || null,
        }));
        await AsyncStorage.setItem('debug_porter_api_error', 'Success');
        return {
          toPickup: pickupResult.toPickup,
          tripDistance: tripResult.tripDistance,
          failureReason: mergeFailureReason(
            pickupResult.failureReason,
            tripResult.failureReason,
            locationIssue || undefined
          ),
          detail: pickupResult.detail || tripResult.detail || locationIssue || undefined,
          pickupSource: pickupResult.pickupSource,
          tripSource: tripResult.tripSource,
          distanceProvider: 'google_distance_matrix',
          isApproximate: false,
          calculationMs: Date.now() - startedAt,
          routeDiagnostics: routeDiagnostics(
            diagnostics,
            startedAt,
            pickupResult.toPickup,
            tripResult.tripDistance,
            porterPickupDistance,
            porterTripDistance,
            {
              provider: 'google_distance_matrix',
              routeMode: 'geocoded_coordinate',
              locationAgeBucket: locationAgeBucket(locationFix),
              accuracyBucket: locationAccuracyBucket(locationFix),
              reason: 'coordinate_route_selected',
            }
          ),
        };
      }
      diagnostics.push('address_string_route_failed');
      distanceApiFailed = true;
      distanceApiDetail = `Coordinate element status: toPickup=${pickupRoute.status}, trip=${tripRoute.status}`;
    } catch (error: any) {
      diagnostics.push('address_string_route_failed');
      distanceApiFailed = true;
      distanceApiDetail = error.message || 'Google coordinate route exception';
    }
  }

  const [pickupRouteKm, tripRouteKm] = pickupCoords
    ? await Promise.all([
        locationIssue ? Promise.resolve(null) : getOsrmRouteDistanceKm(locationFix, pickupCoords, deadlineAt),
        dropCoords ? getOsrmRouteDistanceKm(pickupCoords, dropCoords, deadlineAt) : Promise.resolve(null),
      ])
    : [null, null];

  const pickupApproxKm = pickupCoords
    ? haversineKm(currentLat, currentLng, pickupCoords.lat, pickupCoords.lng) * ROAD_FACTOR
    : null;
  const tripApproxKm = pickupCoords && dropCoords
    ? haversineKm(pickupCoords.lat, pickupCoords.lng, dropCoords.lat, dropCoords.lng) * ROAD_FACTOR
    : null;
  const calculatedPickup = locationIssue
    ? null
    : (pickupRouteKm !== null
      ? formatDistanceKm(pickupRouteKm)
      : (pickupApproxKm !== null ? `~${formatDistanceKm(pickupApproxKm)}` : null));
  const pickupResult = resolvePickupDistanceResult(
    normalizeCalculatedPickupDistance(calculatedPickup),
    porterPickupDistance,
    undefined,
    locationIssue || undefined,
    diagnostics
  );
  const calculatedTripDistance = tripRouteKm !== null
    ? formatDistanceKm(tripRouteKm)
    : (tripApproxKm !== null ? `~${formatDistanceKm(tripApproxKm)}` : null);
  const tripResult = normalizeTripDistance(calculatedTripDistance, primaryPickupQuery, primaryDropQuery);
  const distanceProvider = (pickupRouteKm !== null || tripRouteKm !== null) ? 'osrm_route' : 'haversine_approx';
  const isApproximate = distanceProvider === 'haversine_approx';
  diagnostics.push(distanceProvider === 'osrm_route' ? 'osrm_route_used' : 'approximate_route_used');

  const geocodeFailed = !pickupCoords || !dropCoords;
  const failureReason =
    locationIssue ||
    pickupResult.failureReason ||
    tripResult.failureReason ||
    (pickupLookup.reason === 'geocode_result_out_of_region' || dropLookup.reason === 'geocode_result_out_of_region'
      ? 'geocode_result_out_of_region'
      : undefined) ||
    (geocodeFailed
      ? 'geocode_failed'
      : (distanceApiFailed ? 'distance_api_failed' : undefined));

  return {
    toPickup: pickupResult.toPickup,
    tripDistance: tripResult.tripDistance,
    failureReason,
    pickupSource: pickupResult.pickupSource,
    tripSource: tripResult.tripSource,
    distanceProvider,
    isApproximate,
    calculationMs: Date.now() - startedAt,
    routeDiagnostics: routeDiagnostics(
      diagnostics,
      startedAt,
      pickupResult.toPickup,
      tripResult.tripDistance,
      porterPickupDistance,
      porterTripDistance,
      {
        provider: distanceProvider,
        routeMode: distanceProvider === 'osrm_route' ? 'geocoded_coordinate' : 'haversine',
        locationAgeBucket: locationAgeBucket(locationFix),
        accuracyBucket: locationAccuracyBucket(locationFix),
        reason: distanceProvider === 'osrm_route' ? 'osrm_route_selected' : 'haversine_approx_selected',
      }
    ),
    detail: locationIssue || pickupResult.detail || tripResult.detail || (geocodeFailed
      ? `pickupFound=${!!pickupCoords},dropFound=${!!dropCoords},pickupReason=${pickupLookup.reason || 'none'},dropReason=${dropLookup.reason || 'none'}`
      : distanceApiDetail || undefined),
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// SMART ADDRESS EXTRACTION
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Checks if a text part looks like an address (contains street/area/city indicators).
 * Porter addresses typically contain: numbers, commas, area names, road/nagar/marg etc.
 */
function looksLikeAddress(text: string): boolean {
  const lower = text.toLowerCase();
  
  // Must be reasonably long to be an address
  if (text.length < 10) return false;
  
  // Skip if it's a UI element (button text, labels, etc.)
  const uiKeywords = [
    'accept', 'decline', 'reject', 'cancel', 'confirm', 'navigate',
    'call', 'chat', 'help', 'support', 'timer', 'sec', 'min',
    'tap to', 'click', 'swipe', 'slide', 'view details',
    'earning', 'incentive', 'bonus', 'surge',
    'accept ride', 'decline ride', 'new trip request',
  ];
  if (uiKeywords.some(kw => lower.includes(kw))) return false;
  
  // Positive indicators for addresses
  const addressIndicators = [
    // Common Indian address keywords
    'nagar', 'marg', 'road', 'rd', 'street', 'st', 'lane',
    'colony', 'society', 'park', 'garden', 'tower', 'building',
    'floor', 'block', 'sector', 'phase', 'plot', 'near',
    'opposite', 'opp', 'behind', 'beside', 'next to',
    'chowk', 'circle', 'cross', 'main', 'highway',
    'market', 'bazaar', 'mall', 'complex', 'center', 'centre',
    'station', 'bridge', 'flyover', 'underpass',
    // City/area names (common Gujarat/India)
    'ahmedabad', 'gujarat', 'mumbai', 'delhi', 'bangalore', 'pune',
    'surat', 'vadodara', 'rajkot', 'gandhinagar',
    ',', // Addresses almost always have commas
  ];
  
  const matchCount = addressIndicators.filter(ind => lower.includes(ind)).length;
  
  // If it has at least 1 address indicator AND has a comma or is fairly long, it's probably an address
  if (matchCount >= 1 && (lower.includes(',') || text.length > 25)) return true;
  
  // If it has multiple address indicators, definitely an address
  if (matchCount >= 2) return true;
  
  // If it contains digits (like house numbers, pin codes) AND is long, it's likely an address
  const hasDigits = /\d/.test(text);
  if (hasDigits && text.length > 15 && lower.includes(',')) return true;
  
  // Fallback: if it's long enough, has a comma, and doesn't look like a price/time
  if (text.length > 30 && lower.includes(',') && !lower.match(/^[\d₹.\s]+$/)) return true;
  
  return false;
}

function isAddressUiNoise(part: string): boolean {
  const lower = part.toLowerCase().trim();
  if (!lower) return true;
  if (/^(pickup|pick up|pick-up|drop|dropoff|drop-off|drop off)$/i.test(lower)) return true;
  if (/^(call|call customer|chat|help|support|navigate|start trip|end trip|cancel trip)$/i.test(lower)) return true;
  if (/^(cash to collect|trip fare|fare|hire by|payment|collect cash|paid online)\b/i.test(lower)) return true;
  if (/^(accept|decline|reject|swipe|slide|tap)\b/i.test(lower)) return true;
  if (/^\+?91?[-\s]?[6-9]\d{9}$/.test(lower.replace(/\s+/g, ''))) return true;
  return false;
}

function cleanAddressCandidate(raw: string): string {
  const seen = new Set<string>();
  const cleanedParts = raw
    .split(/\|\||[\r\n]+|•/g)
    .map(part => part
      .replace(/\b(?:call customer|cash to collect|trip fare|hire by|cancel trip)\b.*$/i, '')
      .replace(/^(pickup|pick up|pick-up|drop|dropoff|drop-off|drop off)\s*[:\-]?\s*/i, '')
      .replace(/\b(?:\+?91[-\s]?)?[6-9]\d{9}\b/g, '')
      .replace(/\s+/g, ' ')
      .trim()
    )
    .filter(part => part && !isAddressUiNoise(part))
    .filter(part => {
      const key = part.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

  return cleanedParts.join(', ').replace(/\s*,\s*,+/g, ', ').replace(/^,\s*|\s*,$/g, '').trim();
}

function extractPorterPickupDistance(text: string): string | null {
  const patterns = [
    /pickup\s*:?\s*([0-9]+(?:\.[0-9]+)?)\s*(km|kms|kilometers?|m|meters?)\s*(?:away)?/i,
    /([0-9]+(?:\.[0-9]+)?)\s*(km|kms|kilometers?|m|meters?)\s+away/i,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (!match) continue;
    const unitText = `${match[1]} ${match[2]}`;
    const normalized = normalizePorterPickupDistance(unitText);
    if (normalized) return normalized;
  }

  return null;
}

function extractPorterTripDistance(text: string, porterPickupDistance?: string | null): string | null {
  const directPatterns = [
    /pickup\s*(?:->|to)\s*drop\s*:?\s*([0-9]+(?:\.[0-9]+)?)\s*(km|kms|kilometers?|m|meters?)\b/i,
    /drop\s*:?\s*([0-9]+(?:\.[0-9]+)?)\s*(km|kms|kilometers?|m|meters?)\b/i,
    /destination\s*:?\s*([0-9]+(?:\.[0-9]+)?)\s*(km|kms|kilometers?|m|meters?)\b/i,
  ];

  for (const pattern of directPatterns) {
    const match = text.match(pattern);
    if (!match) continue;
    const normalized = normalizePorterTripDistance(`${match[1]} ${match[2]}`);
    if (normalized) return normalized;
  }

  const pickupKm = parseDistanceKm(porterPickupDistance);
  const parentheticalMatches = Array.from(
    text.matchAll(/\(([0-9]+(?:\.[0-9]+)?)\s*(km|kms|kilometers?|m|meters?)\)/gi)
  );
  const normalizedCandidates = parentheticalMatches
    .map(match => normalizePorterTripDistance(`${match[1]} ${match[2]}`))
    .filter((value): value is string => !!value);

  if (normalizedCandidates.length === 0) return null;

  const distinctCandidates = normalizedCandidates.filter(candidate => {
    const candidateKm = parseDistanceKm(candidate);
    return pickupKm === null || candidateKm === null || Math.abs(candidateKm - pickupKm) >= 0.05;
  });

  return distinctCandidates[distinctCandidates.length - 1] || normalizedCandidates[normalizedCandidates.length - 1] || null;
}

function detectPorterScreenType(text: string): PorterScreenType {
  const lower = text.toLowerCase();
  const hasAcceptCountdown = /\baccept\s+in\s+\d+\s*s\b/i.test(text);
  const hasAcceptAction = /\b(?:accept|swipe\s+to\s+accept)\b/i.test(text);
  const hasFare = /(?:₹|rs\.?\s*)\s*\d+/i.test(text);
  const hasPickupDistance = !!extractPorterPickupDistance(text);
  const hasOfferAddressMarkers = lower.includes('pickup') && (lower.includes('drop') || lower.includes('destination'));
  if (
    lower.includes('cancel trip') ||
    lower.includes('cash to collect') ||
    lower.includes('trip fare') ||
    lower.includes('call customer') ||
    lower.includes('navigate') ||
    lower.includes('start trip') ||
    lower.includes('end trip') ||
    lower.includes('complete trip') ||
    lower.includes('swipe to start') ||
    lower.includes('swipe to end') ||
    lower.includes('arrived at pickup')
  ) {
    return 'accepted_trip';
  }
  if (hasPickupDistance && (hasAcceptCountdown || hasAcceptAction || (hasFare && hasOfferAddressMarkers))) {
    return 'offer';
  }
  return 'unknown';
}

function hasLiveOfferIndicators(text: string): boolean {
  return detectPorterScreenType(text) === 'offer';
}

function shouldHideOverlayForScreenText(text: string, overlay: PorterOverlayState | null = activeTripOverlay): boolean {
  if (!overlay) return false;
  const screenType = detectPorterScreenType(text);
  if (screenType === 'offer') return false;
  if (screenType === 'accepted_trip') return true;
  return isPorterHomeOrIdleText(text.toLowerCase()) || !text.toLowerCase().includes('pickup');
}

function isPorterHomeOrIdleText(lowerText: string): boolean {
  return (
    lowerText.includes('go offline') ||
    lowerText.includes('view profile') ||
    lowerText.includes('wallet balance') ||
    lowerText.includes("today's earning") ||
    lowerText.includes('preferred app language')
  );
}

/**
 * Extract pickup and drop addresses from Porter popup text.
 * Based on real Porter App layout logs:
 * ₹105 || Pickup 2.2 km away || PICKUP || PICKUP || [Pickup Address] || DROP || DROP || [Drop Address]
 */
function extractAddresses(text: string): { pickup: string; drop: string } | null {
  const parts = text.split(/\|\||[\r\n]+|•/).map((s: string) => s.trim()).filter(Boolean);
  
  let pickup = '';
  let drop = '';

  // 1. Exact Match Strategy (Highest Confidence)
  // Look for the exact "PICKUP" and "DROP" labels and grab the part immediately following the last one
  let lastPickupIndex = -1;
  let lastDropIndex = -1;

  for (let i = 0; i < parts.length; i++) {
    const lower = parts[i].toLowerCase();
    // Exact match for the labels used in the Porter UI
    if (lower === 'pickup' || lower === 'pick up' || lower === 'pick-up') {
      lastPickupIndex = i;
    }
    if (lower === 'drop' || lower === 'dropoff' || lower === 'drop-off' || lower === 'drop off') {
      lastDropIndex = i;
    }
  }

  // The address is typically the part immediately after the exact label
  if (lastPickupIndex !== -1 && lastPickupIndex + 1 < parts.length) {
    pickup = cleanAddressCandidate(parts[lastPickupIndex + 1]);
  }
  
  if (lastDropIndex !== -1 && lastDropIndex + 1 < parts.length) {
    drop = cleanAddressCandidate(parts[lastDropIndex + 1]);
  }

  // Validate exact match results
  const isValidAddress = (addr: string) => addr && addr.length > 5 && !addr.toLowerCase().match(/^(pickup|drop|accept|decline)/);
  
  if (isValidAddress(pickup) && isValidAddress(drop) && pickup !== drop) {
    return { pickup, drop };
  }

  // 2. Keyword Index Strategy (Fallback)
  // If exact match failed, try finding the first long string after the first keyword occurrence
  const firstPickupIndex = parts.findIndex(p => p.toLowerCase().includes('pickup'));
  const firstDropIndex = parts.findIndex(p => p.toLowerCase().includes('drop') && !p.toLowerCase().includes('dropoff'));

  if (!isValidAddress(pickup) && firstPickupIndex !== -1) {
    for (let i = firstPickupIndex + 1; i < parts.length; i++) {
      const candidate = cleanAddressCandidate(parts[i]);
      if (candidate.length > 10 && !candidate.toLowerCase().includes('drop') && !candidate.match(/^[\d₹]/)) {
        pickup = candidate;
        break;
      }
    }
  }

  if (!isValidAddress(drop) && firstDropIndex !== -1) {
    const startAfter = Math.max(firstDropIndex + 1, parts.indexOf(pickup) + 1);
    for (let i = startAfter; i < parts.length; i++) {
      const candidate = cleanAddressCandidate(parts[i]);
      if (candidate.length > 10 && candidate !== pickup && !candidate.match(/^[\d₹]/)) {
        drop = candidate;
        break;
      }
    }
  }

  if (isValidAddress(pickup) && isValidAddress(drop) && pickup !== drop) {
    return { pickup, drop };
  }

  // 3. Address-Like Strategy (Last Resort)
  // Filter for parts that have address keywords or commas
  const addressParts = parts.map(cleanAddressCandidate).filter(part => {
    if (part === pickup || part === drop) return false; // Already tried
    return looksLikeAddress(part);
  });

  if (!isValidAddress(pickup) && addressParts.length >= 1) pickup = addressParts.shift() || pickup;
  if (!isValidAddress(drop) && addressParts.length >= 1) drop = addressParts.shift() || drop;

  if (isValidAddress(pickup) && isValidAddress(drop)) {
    return { pickup, drop };
  }

  return null;
}

async function processPorterScreenEvent(event: PorterScreenEvent): Promise<void> {
    const rawText = event.textContent || '';
    const textSummary = summarizeSensitiveValue(rawText);
    const debugEvent: DebugEvent = {
      timestamp: new Date().toISOString(),
      eventType: event.eventType || 'unknown',
      textContent: textSummary,
      pickup: '',
      drop: '',
      status: '',
      apiError: '',
      nominatim: '',
      result: '',
      location: null,
    };

    try {
      const now = Date.now();
      const text = rawText;
      const eventType = event.eventType || 'unknown';

      await recordDeliveryDebugEvent({
        category: 'delivery_app',
        feature: 'porter_accessibility_event',
        packageName: event.packageName,
        eventType,
        message: 'Porter screen event reached JS',
        data: {
          reason: event.reason || null,
          textLength: text.length,
          textSummary,
        },
      });

      if (!text.trim()) {
        if (activeTripOverlay) {
          hideActivePorterOverlay('offer_expired_overlay_hidden');
          markLatestPorterScreenState(null, 'unknown', false, now);
        }
        debugEvent.status = 'Ignored: no_readable_text';
        await AsyncStorage.setItem('debug_porter_status', debugEvent.status);
        await recordDeliveryDebugEvent({
          category: 'porter_distance',
          feature: 'readable_text',
          packageName: event.packageName,
          eventType,
          level: 'warn',
          message: 'no_readable_text',
          data: { reason: 'no_readable_text' },
        });
        return;
      }
      
      // 1. KEEPALIVE TOAST OVERLAY (Background Safe)
      // React Native background timers pause when app is minimized.
      // We use incoming accessibility events (Porter timer ticking) to naturally refresh the toast!
      if (activeTripOverlay) {
        if (now >= getPorterOverlayActiveUntil(activeTripOverlay)) {
          activeTripOverlay = null; // Expire after 12 seconds
          void hidePorterDistanceDisplay();
        } else if (
          activeTripOverlay.kind !== 'pending' &&
          now - activeTripOverlay.lastShownAt > DISPLAY_DUPLICATE_SUPPRESS_MS
        ) {
          showActivePorterOverlay(activeTripOverlay.signature, activeTripOverlay.message);
        }
      }

      // Save every raw capture for debugging
      await AsyncStorage.setItem('debug_porter_last_raw_text', textSummary);
      await AsyncStorage.setItem('debug_porter_last_time', debugEvent.timestamp);
      await AsyncStorage.setItem('debug_porter_last_event_type', eventType);

      const stableText = normalizeVolatilePorterText(text);
      const textHash = hashString(stableText);

      const lowerText = text.toLowerCase();
      const screenType = detectPorterScreenType(text);
      if ((screenType === 'offer' || screenType === 'accepted_trip') && activeRideSignature) {
        markLatestPorterScreenState(activeRideSignature, screenType, screenType === 'offer', now);
      }
      if (screenType === 'accepted_trip') {
        if (activeTripOverlay) {
          hideActivePorterOverlay('offer_expired_overlay_hidden');
        }
        markLatestPorterScreenState(activeRideSignature, screenType, false, now);
        debugEvent.status = 'Ignored: Porter active trip screen';
        await AsyncStorage.setItem('debug_porter_status', debugEvent.status);
        await recordDeliveryDebugEvent({
          category: 'porter_distance',
          feature: 'overlay_lifecycle',
          packageName: event.packageName,
          eventType,
          message: 'active_trip_overlay_suppressed',
          data: {
            reason: 'active_trip_overlay_suppressed',
            screenType,
            textLength: text.length,
            textSummary,
          },
        });
        return;
      }
      if (shouldHideOverlayForScreenText(text)) {
        hideActivePorterOverlay('offer_expired_overlay_hidden');
        markLatestPorterScreenState(null, 'unknown', false, now);
        await recordDeliveryDebugEvent({
          category: 'porter_distance',
          feature: 'overlay_lifecycle',
          packageName: event.packageName,
          eventType,
          message: 'offer_expired_overlay_hidden',
          data: { reason: 'offer_expired_overlay_hidden' },
        });
      }

      if (textHash === lastProcessedHash) {
        debugEvent.status = 'Skipped: Duplicate text';
        await recordDeliveryDebugEvent({
          category: 'porter_distance',
          feature: 'duplicate_guard',
          packageName: event.packageName,
          eventType,
          message: 'duplicate_suppressed',
          data: { reason: 'duplicate_suppressed', textLength: text.length, textSummary },
        });
        return; // Same text, skip
      }

      // Check if this is a ride request screen (case-insensitive)

      // Self-exclusion: Ignore our own app screens to prevent false positives
      if (lowerText.includes('spendsense') || lowerText.includes('porter trip tester') || lowerText.includes('porter debug history export')) {
        debugEvent.status = `Ignored: Self app detected or debug export`;
        return;
      }

      // Stronger check for ride request to avoid false positives (like WhatsApp messages)
      const hasPickup = lowerText.includes('pickup') || lowerText.includes('pick up');
      const hasDrop = lowerText.includes('drop') || lowerText.includes('destination');
      const hasCurrency = lowerText.includes('₹') || lowerText.includes('rs');
      
      const isRideRequest = screenType !== 'unknown' || (hasPickup && hasDrop) || (hasPickup && hasCurrency);
      
      if (!isRideRequest) {
        debugEvent.status = `Ignored: No ride keywords found (event: ${eventType})`;
        if (isPorterHomeOrIdleText(lowerText)) {
          hideActivePorterOverlay('offer_expired_overlay_hidden');
          markLatestPorterScreenState(null, 'unknown', false, now);
          await AsyncStorage.setItem('debug_porter_status', debugEvent.status);
        }
        return;
      }
      
      lastProcessedHash = textHash;
      debugEvent.status = 'Processing ride request...';
      await AsyncStorage.setItem('debug_porter_status', debugEvent.status);

      // Smart address extraction
      const addresses = extractAddresses(text);
      
      if (!addresses) {
        showActivePorterOverlay(
          `unparsed:${textHash}`,
          buildPendingDistanceMessage()
        );
        debugEvent.status = `Failed: Could not extract addresses. Parts found: ${text.split(/\|\||[\r\n]+|•/).length}. ${textSummary}`;
        await AsyncStorage.setItem('debug_porter_status', debugEvent.status);
        await recordDeliveryDebugEvent({
          category: 'porter_distance',
          feature: 'address_parse',
          packageName: event.packageName,
          eventType,
          level: 'warn',
          message: 'Could not extract pickup/drop from Porter text',
          data: {
            reason: 'address_parse_failed',
            parts: text.split(/\|\||[\r\n]+|•/).length,
            textLength: text.length,
            textSummary,
          },
        });
        return;
      }

      const tripSig = `${addresses.pickup}|${addresses.drop}`;
      const porterPickupDistance = extractPorterPickupDistance(text);
      const porterTripDistance = extractPorterTripDistance(text, porterPickupDistance);
      const pickupGeocodeCandidates = buildGeocodeCandidates(addresses.pickup, text);
      const dropGeocodeCandidates = buildGeocodeCandidates(addresses.drop, text);
      markLatestPorterScreenState(tripSig, screenType, screenType === 'offer', now);
      
      // 2. DEDUPLICATE TRIPS (Save API Quota & Battery)
      if (shouldSkipDuplicateTripProcessing(tripSig, porterPickupDistance, now)) {
        debugEvent.status = 'Skipped: Trip already processed and currently showing';
        return;
      }

      const rideRunId = activeRideRunId + 1;
      activeRideRunId = rideRunId;
      if (activeRideSignature !== tripSig) {
        unavailableOverlayShownSignature = null;
      }
      activeRideSignature = tripSig;
      const resultHardDeadlineAt = now + (screenType === 'offer' ? OFFER_RESULT_STALE_LIMIT_MS : RESULT_STALE_LIMIT_MS);

      debugEvent.pickup = summarizeSensitiveValue(addresses.pickup);
      debugEvent.drop = summarizeSensitiveValue(addresses.drop);
      debugEvent.status = `Order detected, calculating distance. Pickup ${debugEvent.pickup}. Drop ${debugEvent.drop}`;
      await AsyncStorage.setItem('debug_porter_status', debugEvent.status);
      await recordDeliveryDebugEvent({
        category: 'porter_distance',
        feature: 'address_parse',
        packageName: event.packageName,
        eventType,
        message: 'Pickup/drop extracted from Porter order',
        data: {
          pickup: debugEvent.pickup,
          drop: debugEvent.drop,
          pickupDistance: porterPickupDistance || null,
          pickupDistanceSource: porterPickupDistance ? 'porter_distance_from_ui' : null,
          tripDistance: porterTripDistance || null,
          tripDistanceSource: porterTripDistance ? 'porter_distance_from_ui' : null,
          pickupCandidateCount: pickupGeocodeCandidates.length,
          dropCandidateCount: dropGeocodeCandidates.length,
          pickupCandidateTypes: pickupGeocodeCandidates.map(candidate => candidate.type).join(','),
          dropCandidateTypes: dropGeocodeCandidates.map(candidate => candidate.type).join(','),
          addressCleanup: 'address_cleaned',
          screenType,
          visibleOverlayDistanceSource: 'spendsense_calculated_only',
          visibleOverlayReason: 'porter_distance_hidden_from_ui',
          reasons: [
            screenType === 'offer' ? 'live_offer_detected' : null,
            porterPickupDistance ? 'ui_pickup_distance_used' : null,
            porterTripDistance ? 'ui_trip_distance_used' : null,
            'porter_distance_hidden_from_ui',
          ].filter(Boolean).join(','),
        },
      });
      showActivePorterOverlay(tripSig, buildPendingDistanceMessage(porterPickupDistance, porterTripDistance));

      // BATTERY OPTIMIZATION: use cached GPS coordinates (re-fetched only if > 60s old)
      try {
        const location = await getCachedOrFreshLocation();
        const { lat, lng } = location;
        debugEvent.location = {
          ageBucket: locationAgeBucket(location),
          accuracyBucket: locationAccuracyBucket(location),
        };
        
        const distances = await getDistancesKm(
          lat,
          lng,
          addresses.pickup,
          addresses.drop,
          porterPickupDistance,
          resultHardDeadlineAt,
          porterTripDistance,
          text,
          location
        );

        const isStillCurrentOrder = isCurrentPorterResult({
          runId: rideRunId,
          signature: tripSig,
          startedAt: now,
          screenType,
        });

        if (!isStillCurrentOrder) {
          debugEvent.status = 'Skipped: Late distance result after order popup disappeared';
          await AsyncStorage.setItem('debug_porter_status', debugEvent.status);
          await recordDeliveryDebugEvent({
            category: 'porter_distance',
            feature: 'distance_result',
            packageName: event.packageName,
            eventType,
            level: 'warn',
            message: 'stale_result_dropped',
            data: {
              reason: 'stale_result_dropped',
              sameRun: rideRunId === activeRideRunId,
              sameSignature: activeRideSignature === tripSig,
              ageMs: Date.now() - now,
              screenType,
            },
          });
          return;
        }

        debugEvent.result = JSON.stringify(distances);
        await AsyncStorage.setItem('debug_porter_result', debugEvent.result);

        // Get API error and Nominatim info from AsyncStorage
        debugEvent.apiError = await AsyncStorage.getItem('debug_porter_api_error') || '';
        debugEvent.nominatim = await AsyncStorage.getItem('debug_porter_nominatim') || '';

        if (Platform.OS === 'android') {
          const message = buildCalculatedDistanceMessage(distances, porterPickupDistance, porterTripDistance);
          const unavailableDecision = decideUnavailableOverlay(tripSig, distances, now, screenType);
          if (unavailableDecision.shouldShow) {
            if (unavailableDecision.reason === 'unavailable_overlay_shown_once') {
              unavailableOverlayShownSignature = tripSig;
            }
            showActivePorterOverlay(tripSig, message);
          } else if (unavailableDecision.reason === 'unavailable_overlay_suppressed_stale') {
            hideCurrentPorterOverlayDisplay('unavailable_overlay_suppressed_stale');
          }

          debugEvent.status = isUsableCalculatedDistance(distances.toPickup) || isUsableCalculatedDistance(distances.tripDistance)
            ? 'Success: Overlay shown'
            : 'Partial: SpendSense calculation unavailable; Porter UI values kept separate';
          await AsyncStorage.setItem('debug_porter_status', debugEvent.status);
          await recordDeliveryDebugEvent({
            category: 'porter_distance',
            feature: 'distance_result',
            packageName: event.packageName,
            eventType,
            message: debugEvent.status,
            data: {
              reason: unavailableDecision.reason === 'calculated_distance_displayed'
                ? (distances.failureReason || 'calculated_distance_displayed')
                : unavailableDecision.reason,
              overlayDecision: unavailableDecision.reason,
              detail: distances.detail || null,
              pickupSource: distances.pickupSource || null,
              tripSource: distances.tripSource || null,
              distanceProvider: distances.distanceProvider || null,
              isApproximate: distances.isApproximate || false,
              calculationMs: distances.calculationMs || null,
              route_timing_ms: distances.routeDiagnostics?.routeTimingMs || distances.calculationMs || null,
              provider: distances.routeDiagnostics?.provider || distances.distanceProvider || null,
              routeMode: distances.routeDiagnostics?.routeMode || null,
              pickupCandidateClass: distances.routeDiagnostics?.pickupCandidateClass || null,
              dropCandidateClass: distances.routeDiagnostics?.dropCandidateClass || null,
              pickupCandidateHash: distances.routeDiagnostics?.pickupCandidateHash || null,
              dropCandidateHash: distances.routeDiagnostics?.dropCandidateHash || null,
              pickupCandidateLength: distances.routeDiagnostics?.pickupCandidateLength || null,
              dropCandidateLength: distances.routeDiagnostics?.dropCandidateLength || null,
              candidateScore: distances.routeDiagnostics?.candidateScore || null,
              confidence: distances.routeDiagnostics?.confidence || null,
              candidateReason: distances.routeDiagnostics?.reason || null,
              locationAgeBucket: distances.routeDiagnostics?.locationAgeBucket || null,
              accuracyBucket: distances.routeDiagnostics?.accuracyBucket || null,
              routeDiagnostics: distances.routeDiagnostics?.events.join(',') || null,
              difference_bucket_vs_porter_ui: distances.routeDiagnostics?.differenceBucketVsPorterUi
                ? JSON.stringify(distances.routeDiagnostics.differenceBucketVsPorterUi)
                : null,
              visibleOverlayDistanceSource: 'spendsense_calculated_only',
              hiddenPorterDistanceReason: 'porter_distance_hidden_from_ui',
              toPickup: distances.toPickup,
              tripDistance: distances.tripDistance,
            },
          });
        } else {
          const reason = distances.failureReason || 'geocode_failed';
          const fallbackMessage = `Porter order detected\nDistance unavailable\nReason: ${distanceReasonLabel(reason)}`;
          showActivePorterOverlay(tripSig, fallbackMessage);
          debugEvent.status = `Partial: Order popup shown, but distance calc returned N/A or invalid address. Pickup ${debugEvent.pickup}. Drop ${debugEvent.drop}`;
          await AsyncStorage.setItem('debug_porter_status', debugEvent.status);
          await recordDeliveryDebugEvent({
            category: 'porter_distance',
            feature: 'distance_result',
            packageName: event.packageName,
            eventType,
            level: 'warn',
            message: reason,
            data: {
              reason,
              pickupSource: distances.pickupSource || null,
              tripSource: distances.tripSource || null,
              pickup: debugEvent.pickup,
              drop: debugEvent.drop,
              detail: distances.detail || null,
            },
          });
        }
      } catch (geoError: any) {
        if (__DEV__) console.log('Geolocation error in Porter calculator:', geoError);
        if (!isCurrentPorterResult({
          runId: rideRunId,
          signature: tripSig,
          startedAt: now,
          screenType,
        })) {
          debugEvent.status = 'Skipped: Late location error after order popup disappeared';
          await AsyncStorage.setItem('debug_porter_status', debugEvent.status);
          await recordDeliveryDebugEvent({
            category: 'porter_distance',
            feature: 'distance_result',
            packageName: event.packageName,
            eventType,
            level: 'warn',
            message: 'stale_result_dropped',
            data: { reason: 'stale_result_dropped', screenType, ageMs: Date.now() - now },
          });
          return;
        }
        const locationFailure: DistanceResult = {
          toPickup: 'N/A',
          tripDistance: 'N/A',
          failureReason: 'geocode_failed',
          detail: geoError.message || 'location unavailable',
          pickupSource: 'unavailable',
          tripSource: 'unavailable',
        };
        const fallbackMessage = buildCalculatedDistanceMessage(
          locationFailure,
          porterPickupDistance,
          porterTripDistance
        );
        const unavailableDecision = decideUnavailableOverlay(tripSig, locationFailure, now, screenType);
        if (unavailableDecision.shouldShow) {
          unavailableOverlayShownSignature = tripSig;
          showActivePorterOverlay(tripSig, fallbackMessage);
        } else if (unavailableDecision.reason === 'unavailable_overlay_suppressed_stale') {
          hideCurrentPorterOverlayDisplay('unavailable_overlay_suppressed_stale');
        }
        debugEvent.status = `Geo Error: ${geoError.message}. Order popup still shown.`;
        await AsyncStorage.setItem('debug_porter_status', debugEvent.status);
        await recordDeliveryDebugEvent({
          category: 'error',
          feature: 'porter_location',
          packageName: event.packageName,
          eventType,
          level: 'error',
          message: 'geocode_failed',
          data: {
            reason: unavailableDecision.reason === 'display_throttled_duplicate' ? 'unavailable_overlay_shown_once' : unavailableDecision.reason,
            detail: geoError.message || 'location unavailable',
          },
        });
      }
    } catch (e: any) {
      if (__DEV__) console.error('Error in Porter distance calculation:', e);
      debugEvent.status = `Critical Error: ${e.message}`;
      AsyncStorage.setItem('debug_porter_status', debugEvent.status);
      await recordDeliveryDebugEvent({
        category: 'error',
        feature: 'porter_distance',
        packageName: event.packageName,
        eventType: event.eventType || 'unknown',
        level: 'error',
        message: `Critical Porter distance error: ${e.message}`,
      });
    } finally {
      // Legacy saveDebugEvent removed in favor of Black Box
    }
}

async function consumeBufferedPorterEvent(): Promise<void> {
  if (Platform.OS !== 'android' || typeof PorterModule?.consumeBufferedPorterEvent !== 'function') return;
  try {
    const raw = await PorterModule.consumeBufferedPorterEvent();
    if (typeof raw !== 'string' || !raw.trim()) return;
    const event = JSON.parse(raw) as PorterScreenEvent;
    const hasTextContent = typeof event.textContent === 'string' && event.textContent.trim().length > 0;
    const textLength = hasTextContent ? event.textContent!.length : (event.textLength || 0);
    const textSummary = hasTextContent
      ? summarizeSensitiveValue(event.textContent || '')
      : (event.textSummary || (textLength ? `redacted len=${textLength}` : ''));
    await recordDeliveryDebugEvent({
      category: 'porter_distance',
      feature: 'native_event_recovered',
      packageName: event.packageName,
      eventType: event.eventType || 'unknown',
      message: event.reason === 'js_context_inactive' ? 'js_context_inactive' : 'dispatch_failed',
      data: {
        reason: event.reason || 'js_context_inactive',
        textAvailable: hasTextContent,
        textLength,
        textSummary,
      },
    });
    if (!hasTextContent) return;
    await processPorterScreenEvent(event);
  } catch (error: any) {
    await recordDeliveryDebugEvent({
      category: 'error',
      feature: 'native_event_recovered',
      level: 'error',
      message: `Failed to consume buffered Porter event: ${error.message}`,
    });
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// PORTER DISTANCE CALCULATOR (EVENT LISTENER)
// ═══════════════════════════════════════════════════════════════════════════════

export const initPorterDistanceCalculator = () => {
  if (subscription) return; // Already initialized
  scheduleLegacySensitivePorterDebugPurge();

  if (__DEV__) console.log('🚛 [Porter] Distance calculator initialized');

  bubbleIssueSubscription = eventEmitter.addListener('onDeliveryIssueBubbleTap', async (event) => {
    let nativeSnapshot: NativeDeliveryDebugSnapshot | undefined;
    if (typeof event?.nativeSnapshot === 'string') {
      try {
        nativeSnapshot = sanitizeNativeSnapshot(JSON.parse(event.nativeSnapshot));
      } catch {
        nativeSnapshot = undefined;
      }
    }

    await markDeliveryIssueInBlackBox('User marked delivery issue', nativeSnapshot, 'manual');
  });

  subscription = eventEmitter.addListener('onPorterScreenChange', processPorterScreenEvent);
  consumeBufferedPorterEvent().catch((error) => {
    if (__DEV__) console.warn('[Porter] Failed to pull buffered native event:', error);
  });
  appStateSubscription = AppState.addEventListener('change', (state) => {
    if (state === 'active') {
      consumeBufferedPorterEvent().catch((error) => {
        if (__DEV__) console.warn('[Porter] Failed to pull buffered native event on resume:', error);
      });
    }
  });
};

export const stopPorterDistanceCalculator = () => {
  if (subscription) {
    subscription.remove();
    subscription = null;
  }
  if (bubbleIssueSubscription) {
    bubbleIssueSubscription.remove();
    bubbleIssueSubscription = null;
  }
  if (appStateSubscription) {
    appStateSubscription.remove();
    appStateSubscription = null;
  }
  activeTripOverlay = null;
  latestPorterScreenState = null;
  void hidePorterDistanceDisplay();
};

export const __porterTestUtils = {
  buildCalculatedDistanceMessage,
  buildGeocodeCandidates,
  buildGoogleAddressCandidates,
  buildPendingDistanceMessage,
  buildPorterDisplayProfile,
  classifyGoogleAddressCandidate,
  cleanAddressCandidate,
  decidePorterOverlayDisplay,
  detectPorterScreenType,
  extractAddresses,
  extractPorterPickupDistance,
  extractPorterTripDistance,
  getPorterOverlayKind,
  getDistancesKm,
  hasMeaningfulPorterDisplayChange,
  hasLiveOfferIndicators,
  isCurrentPorterResult,
  decideUnavailableOverlay,
  geocodeCacheKey,
  geocodeFromCandidates,
  getCurrentLocationIssue,
  googleRouteConfidence,
  normalizeCalculatedPickupDistance,
  normalizeGeocodeText,
  normalizePorterPickupDistance,
  normalizeTripDistance,
  parseDistanceKm,
  processPorterScreenEventForTest: processPorterScreenEvent,
  resetActivePorterOverlayForTest: () => {
    activeTripOverlay = null;
    latestPorterScreenState = null;
    activeRideSignature = null;
    activeRideRunId = 0;
    unavailableOverlayShownSignature = null;
    geocodeCache = new Map<string, { coords: { lat: number; lng: number }; ts: number; score: number; candidateType: GeocodeCandidateType }>();
    routeCache = new Map<string, { km: number; ts: number }>();
    googleRouteCache = new Map<string, { km: number; ts: number }>();
  },
  markUnavailableOverlayShownForTest: (signature: string | null) => {
    unavailableOverlayShownSignature = signature;
  },
  setActivePorterResultForTest: (
    runId: number,
    signature: string,
    latestState: PorterScreenState | null
  ) => {
    activeRideRunId = runId;
    activeRideSignature = signature;
    latestPorterScreenState = latestState;
  },
  shouldHideOverlayForScreenText,
  showActivePorterOverlay,
  shouldSkipDuplicateTripProcessing,
};
