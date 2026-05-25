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
// SECURITY: Key loaded from .env via react-native-config — never hardcode in source
const GOOGLE_MAPS_API_KEY: string = Config.GOOGLE_MAPS_API_KEY || '';
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

const LEGACY_PORTER_DEBUG_KEYS = [
  'debug_porter_last_raw_text',
  'debug_porter_api_response',
  'debug_porter_nominatim',
  'debug_porter_history',
];
let legacyDebugPurgeStarted = false;

// ─── Active Overlay State ──────────────────────────────────────────────────
let activeTripOverlay: {
  signature: string;
  message: string;
  firstShownAt: number;
  lastShownAt: number;
} | null = null;

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
  location: { lat: number; lng: number } | null;
}

function summarizeSensitiveValue(value: string): string {
  return redactedTextSummary(value || '');
}

function summarizeLocationLookup(value: unknown): string {
  if (!value) return 'missing';
  if (Array.isArray(value)) return `array len=${value.length}`;
  if (typeof value === 'object') return 'object';
  return typeof value;
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
    case 'invalid_address':
      return 'address unreadable';
    case 'stale_order_result':
      return 'order changed';
    default:
      return 'unknown';
  }
}

async function purgeLegacySensitivePorterDebugStorage(): Promise<void> {
  await AsyncStorage.multiRemove(LEGACY_PORTER_DEBUG_KEYS);
}

function scheduleLegacySensitivePorterDebugPurge(): void {
  if (legacyDebugPurgeStarted) return;
  legacyDebugPurgeStarted = true;
  purgeLegacySensitivePorterDebugStorage().catch((error) => {
    console.warn('[Porter] Failed to purge legacy debug storage:', error);
  });
}

interface DistanceResult {
  toPickup: string;
  tripDistance: string;
  failureReason?: DistanceFailureReason;
  detail?: string;
}

type DistanceFailureReason =
  | 'no_readable_text'
  | 'ocr_unsupported'
  | 'js_context_inactive'
  | 'duplicate_suppressed'
  | 'invalid_address'
  | 'distance_api_failed'
  | 'geocode_failed'
  | 'stale_order_result';

type PorterScreenEvent = {
  packageName?: string;
  textContent?: string;
  textLength?: number;
  textSummary?: string;
  textContentAvailable?: boolean;
  eventType?: string;
  reason?: string;
};

// ─── Location Cache ─────────────────────────────────────────────────────────────
// Avoids GPS call on every accessibility event — reuse if < 60 seconds old
let cachedLocation: { lat: number; lng: number; ts: number } | null = null;
const LOCATION_CACHE_TTL_MS = 60_000; // 60 seconds
const STALE_RESULT_GRACE_MS = 3500;
const RESULT_STALE_LIMIT_MS = 12_000;

function getCachedOrFreshLocation(): Promise<{ lat: number; lng: number }> {
  return new Promise((resolve, reject) => {
    const now = Date.now();
    if (cachedLocation && now - cachedLocation.ts < LOCATION_CACHE_TTL_MS) {
      // Reuse cached coordinates — no GPS radio wake-up
      resolve({ lat: cachedLocation.lat, lng: cachedLocation.lng });
      return;
    }
    Geolocation.getCurrentPosition(
      (pos) => {
        cachedLocation = { lat: pos.coords.latitude, lng: pos.coords.longitude, ts: Date.now() };
        resolve({ lat: cachedLocation.lat, lng: cachedLocation.lng });
      },
      (err) => reject(err),
      { enableHighAccuracy: true, timeout: 3000, maximumAge: 60000 }
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

function showActivePorterOverlay(signature: string, message: string) {
  if (Platform.OS !== 'android') return;

  showToastOverlay(message, false);
  activeTripOverlay = {
    signature,
    message,
    firstShownAt: Date.now(),
    lastShownAt: Date.now(),
  };
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
async function geocode(location: string): Promise<{ lat: number; lng: number } | null> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 1800);
    const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(location)}&format=json&limit=1`;
    const res = await fetch(url, {
      headers: { 'User-Agent': 'SpendSense/1.0' },
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    
    if (!res.ok) {
      console.warn('[Porter] Nominatim HTTP error:', res.status);
      return null;
    }
    
    const data = await res.json();
    if (data.length > 0) {
      const coords = { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon) };
      console.log('[Porter] Nominatim geocoded an address →', coords);
      return coords;
    }
    console.warn('[Porter] Nominatim: No results for an address');
    return null;
  } catch (error: any) {
    console.warn('[Porter] Nominatim error:', error.message);
    return null;
  }
}

// Strict regex: address must be min 5 chars, contain at least one letter, not be just digits/symbols
const VALID_ADDRESS_RE = /[a-zA-Z]{3,}/;
function isValidAddressString(s: string): boolean {
  return typeof s === 'string' && s.trim().length >= 5 && VALID_ADDRESS_RE.test(s);
}

async function getDistancesKm(
  currentLat: number,
  currentLng: number,
  pickup: string,
  drop: string,
  porterPickupDistance?: string | null,
  deadlineAt?: number
): Promise<DistanceResult> {
  // API QUOTA PROTECTION: Reject clearly invalid addresses before making network calls
  if (!isValidAddressString(pickup) || !isValidAddressString(drop)) {
    console.warn('[Porter] Invalid address strings — skipping API call:', {
      pickup: summarizeSensitiveValue(pickup),
      drop: summarizeSensitiveValue(drop),
    });
    await AsyncStorage.setItem('debug_porter_api_error', 'Invalid address format');
    return {
      toPickup: porterPickupDistance || 'Invalid Address',
      tripDistance: 'Invalid Address',
      failureReason: 'invalid_address',
      detail: 'address validation failed',
    };
  }

  let distanceApiFailed = false;
  let distanceApiDetail = '';

  if (GOOGLE_MAPS_API_KEY) {
    try {
      const origin = `${currentLat},${currentLng}`;
      console.log('[Porter] Calling Google Maps API with:', {
        origin: summarizeSensitiveValue(origin),
        pickup: summarizeSensitiveValue(pickup),
        drop: summarizeSensitiveValue(drop),
      });

      const tripData = await fetchJsonWithTimeout(
        `https://maps.googleapis.com/maps/api/distancematrix/json?origins=${encodeURIComponent(pickup)}&destinations=${encodeURIComponent(drop)}&mode=driving&key=${GOOGLE_MAPS_API_KEY}`,
        2400
      );

      const toPickupData = porterPickupDistance
        ? null
        : await fetchJsonWithTimeout(
          `https://maps.googleapis.com/maps/api/distancematrix/json?origins=${encodeURIComponent(origin)}&destinations=${encodeURIComponent(pickup)}&mode=driving&key=${GOOGLE_MAPS_API_KEY}`,
          2400
        );
      
      console.log('[Porter] Google Maps API Response:', { 
        toPickupStatus: toPickupData?.status || 'SKIPPED',
        toPickupError: toPickupData?.error_message,
        tripStatus: tripData.status,
        tripError: tripData.error_message,
      });
      
      // Save API response for debugging
      await AsyncStorage.setItem('debug_porter_api_response', JSON.stringify({
        toPickupStatus: toPickupData?.status || 'SKIPPED',
        tripStatus: tripData.status,
        toPickupRows: summarizeLocationLookup(toPickupData?.rows),
        tripRows: summarizeLocationLookup(tripData.rows),
      }));
      
      // Check for API errors
      if ((!porterPickupDistance && toPickupData?.status !== 'OK') || tripData.status !== 'OK') {
        const errorMsg = toPickupData?.error_message || tripData.error_message || `API Status: ${toPickupData?.status || tripData.status}`;
        console.warn('[Porter] Google Maps API Error:', errorMsg);
        await AsyncStorage.setItem('debug_porter_api_error', errorMsg);
        distanceApiFailed = true;
        distanceApiDetail = errorMsg;
        // Fall through to Nominatim fallback
      } else {
        const toPickupStatus = porterPickupDistance ? 'OK' : toPickupData?.rows?.[0]?.elements?.[0]?.status;
        const tripStatus = tripData.rows?.[0]?.elements?.[0]?.status;
        
        if (toPickupStatus === 'OK' && tripStatus === 'OK') {
          await AsyncStorage.setItem('debug_porter_api_error', 'Success');
          return {
            toPickup: porterPickupDistance || toPickupData!.rows[0].elements[0].distance.text,
            tripDistance: tripData.rows[0].elements[0].distance.text,
          };
        } else {
          const elementError = `Element status: toPickup=${toPickupStatus}, trip=${tripStatus}`;
          console.warn('[Porter] Google Maps element error:', elementError);
          await AsyncStorage.setItem('debug_porter_api_error', elementError);
          distanceApiFailed = true;
          distanceApiDetail = elementError;
          // Fall through to Nominatim fallback
        }
      }
    } catch (error: any) {
      console.error('[Porter] Google Maps API exception:', error);
      await AsyncStorage.setItem('debug_porter_api_error', `Exception: ${error.message}`);
      distanceApiFailed = true;
      distanceApiDetail = error.message || 'Google Maps exception';
      // Fall through to Nominatim fallback
    }
  } else {
    await AsyncStorage.setItem('debug_porter_api_error', 'No API key configured');
  }

  if (deadlineAt && Date.now() > deadlineAt) {
    return {
      toPickup: porterPickupDistance || 'N/A',
      tripDistance: 'N/A',
      failureReason: 'stale_order_result',
      detail: 'deadline reached before fallback',
    };
  }

  // Fallback: Free Nominatim geocoding + Haversine
  console.log('[Porter] Using Nominatim fallback for:', {
    pickup: summarizeSensitiveValue(pickup),
    drop: summarizeSensitiveValue(drop),
  });
  const ROAD_FACTOR = 1.25;
  const [pickupCoords, dropCoords] = await Promise.all([geocode(pickup), geocode(drop)]);
  
  console.log('[Porter] Nominatim results:', {
    pickupFound: !!pickupCoords,
    dropFound: !!dropCoords,
  });
  await AsyncStorage.setItem('debug_porter_nominatim', JSON.stringify({
    pickupFound: !!pickupCoords,
    dropFound: !!dropCoords,
  }));
  
  const toPickup = porterPickupDistance || (pickupCoords ? `~${(haversineKm(currentLat, currentLng, pickupCoords.lat, pickupCoords.lng) * ROAD_FACTOR).toFixed(1)} km` : 'N/A');
  const tripDistance = pickupCoords && dropCoords ? `~${(haversineKm(pickupCoords.lat, pickupCoords.lng, dropCoords.lat, dropCoords.lng) * ROAD_FACTOR).toFixed(1)} km` : 'N/A';

  const geocodeFailed = !pickupCoords || !dropCoords;
  return {
    toPickup,
    tripDistance,
    failureReason: geocodeFailed ? 'geocode_failed' : (distanceApiFailed ? 'distance_api_failed' : undefined),
    detail: geocodeFailed
      ? `pickupFound=${!!pickupCoords},dropFound=${!!dropCoords}`
      : distanceApiDetail || undefined,
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

function extractPorterPickupDistance(text: string): string | null {
  const match = text.match(/pickup\s+([0-9]+(?:\.[0-9]+)?)\s*km\s+away/i);
  return match ? `${match[1]} km` : null;
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
    pickup = parts[lastPickupIndex + 1];
  }
  
  if (lastDropIndex !== -1 && lastDropIndex + 1 < parts.length) {
    drop = parts[lastDropIndex + 1];
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
      if (parts[i].length > 10 && !parts[i].toLowerCase().includes('drop') && !parts[i].match(/^[\d₹]/)) {
        pickup = parts[i];
        break;
      }
    }
  }

  if (!isValidAddress(drop) && firstDropIndex !== -1) {
    const startAfter = Math.max(firstDropIndex + 1, parts.indexOf(pickup) + 1);
    for (let i = startAfter; i < parts.length; i++) {
      if (parts[i].length > 10 && parts[i] !== pickup && !parts[i].match(/^[\d₹]/)) {
        drop = parts[i];
        break;
      }
    }
  }

  if (isValidAddress(pickup) && isValidAddress(drop) && pickup !== drop) {
    return { pickup, drop };
  }

  // 3. Address-Like Strategy (Last Resort)
  // Filter for parts that have address keywords or commas
  const addressParts = parts.filter(part => {
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
        if (now - activeTripOverlay.firstShownAt > 12000) {
          activeTripOverlay = null; // Expire after 12 seconds
        } else if (now - activeTripOverlay.lastShownAt > 2500) {
          showToastOverlay(activeTripOverlay.message, false);
          activeTripOverlay.lastShownAt = now;
        }
      }

      // Save every raw capture for debugging
      await AsyncStorage.setItem('debug_porter_last_raw_text', textSummary);
      await AsyncStorage.setItem('debug_porter_last_time', debugEvent.timestamp);
      await AsyncStorage.setItem('debug_porter_last_event_type', eventType);

      const stableText = normalizeVolatilePorterText(text);
      const textHash = hashString(stableText);
      
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
      const lowerText = text.toLowerCase();
            
      // Self-exclusion: Ignore our own app screens to prevent false positives
      if (lowerText.includes('spendsense') || lowerText.includes('porter trip tester') || lowerText.includes('porter debug history export')) {
        debugEvent.status = `Ignored: Self app detected or debug export`;
        return;
      }

      // Stronger check for ride request to avoid false positives (like WhatsApp messages)
      const hasPickup = lowerText.includes('pickup') || lowerText.includes('pick up');
      const hasDrop = lowerText.includes('drop') || lowerText.includes('destination');
      const hasCurrency = lowerText.includes('₹') || lowerText.includes('rs');
      
      const isRideRequest = (hasPickup && hasDrop) || (hasPickup && hasCurrency);
      
      if (!isRideRequest) {
        debugEvent.status = `Ignored: No ride keywords found (event: ${eventType})`;
        if (isPorterHomeOrIdleText(lowerText)) {
          activeRideSignature = null;
          activeRideRunId += 1;
          activeTripOverlay = null;
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
          'Porter order detected\nReading pickup/drop...'
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
      
      // 2. DEDUPLICATE TRIPS (Save API Quota & Battery)
      if (activeTripOverlay && activeTripOverlay.signature === tripSig) {
        debugEvent.status = 'Skipped: Trip already processed and currently showing';
        return;
      }

      const rideRunId = activeRideRunId + 1;
      activeRideRunId = rideRunId;
      activeRideSignature = tripSig;
      const resultHardDeadlineAt = now + RESULT_STALE_LIMIT_MS;

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
        },
      });
      showActivePorterOverlay(
        tripSig,
        porterPickupDistance
          ? 'Porter order detected\nCalculating trip distance...'
          : 'Porter order detected\nCalculating distance...'
      );

      // BATTERY OPTIMIZATION: use cached GPS coordinates (re-fetched only if > 60s old)
      try {
        const { lat, lng } = porterPickupDistance
          ? { lat: cachedLocation?.lat || 0, lng: cachedLocation?.lng || 0 }
          : await getCachedOrFreshLocation();
        debugEvent.location = { lat, lng };
        
        const distances = await getDistancesKm(
          lat,
          lng,
          addresses.pickup,
          addresses.drop,
          porterPickupDistance,
          resultHardDeadlineAt
        );

        const isStillCurrentOrder =
          rideRunId === activeRideRunId &&
          activeRideSignature === tripSig &&
          Date.now() <= resultHardDeadlineAt + STALE_RESULT_GRACE_MS;

        if (!isStillCurrentOrder) {
          debugEvent.status = 'Skipped: Late distance result after order popup disappeared';
          await AsyncStorage.setItem('debug_porter_status', debugEvent.status);
          await recordDeliveryDebugEvent({
            category: 'porter_distance',
            feature: 'distance_result',
            packageName: event.packageName,
            eventType,
            level: 'warn',
            message: 'stale_order_result',
            data: {
              reason: 'stale_order_result',
              sameRun: rideRunId === activeRideRunId,
              sameSignature: activeRideSignature === tripSig,
              ageMs: Date.now() - now,
            },
          });
          return;
        }

        debugEvent.result = JSON.stringify(distances);
        await AsyncStorage.setItem('debug_porter_result', debugEvent.result);

        // Get API error and Nominatim info from AsyncStorage
        debugEvent.apiError = await AsyncStorage.getItem('debug_porter_api_error') || '';
        debugEvent.nominatim = await AsyncStorage.getItem('debug_porter_nominatim') || '';

        if (distances.toPickup !== 'N/A' && distances.toPickup !== 'Invalid Address' && Platform.OS === 'android') {
          const message = distances.tripDistance !== 'N/A' && distances.tripDistance !== 'Invalid Address'
            ? `📍 You -> Pickup: ${distances.toPickup}\n🛣️ Pickup -> Drop: ${distances.tripDistance}`
            : `📍 You -> Pickup: ${distances.toPickup}\n🛣️ Trip unavailable: ${distanceReasonLabel(distances.failureReason)}`;
          showActivePorterOverlay(tripSig, message);

          debugEvent.status = distances.tripDistance !== 'N/A' && distances.tripDistance !== 'Invalid Address'
            ? 'Success: Overlay shown'
            : 'Partial: Pickup distance shown, trip distance unavailable';
          await AsyncStorage.setItem('debug_porter_status', debugEvent.status);
          await recordDeliveryDebugEvent({
            category: 'porter_distance',
            feature: 'distance_result',
            packageName: event.packageName,
            eventType,
            message: debugEvent.status,
            data: {
              reason: distances.failureReason || null,
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
              pickup: debugEvent.pickup,
              drop: debugEvent.drop,
              detail: distances.detail || null,
            },
          });
        }
      } catch (geoError: any) {
        console.log('Geolocation error in Porter calculator:', geoError);
        const fallbackMessage = 'Porter order detected\nLocation unavailable';
        showActivePorterOverlay(tripSig, fallbackMessage);
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
            reason: 'geocode_failed',
            detail: geoError.message || 'location unavailable',
          },
        });
      }
    } catch (e: any) {
      console.error('Error in Porter distance calculation:', e);
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

  console.log('🚛 [Porter] Distance calculator initialized');

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
    console.warn('[Porter] Failed to pull buffered native event:', error);
  });
  appStateSubscription = AppState.addEventListener('change', (state) => {
    if (state === 'active') {
      consumeBufferedPorterEvent().catch((error) => {
        console.warn('[Porter] Failed to pull buffered native event on resume:', error);
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
};
