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

import { NativeModules, NativeEventEmitter, Platform } from 'react-native';
import Geolocation from 'react-native-geolocation-service';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Config from 'react-native-config';

const { PorterModule } = NativeModules;
// SECURITY: Key loaded from .env via react-native-config — never hardcode in source
const GOOGLE_MAPS_API_KEY: string = Config.GOOGLE_MAPS_API_KEY || '';
const eventEmitter = new NativeEventEmitter(PorterModule);

let subscription: any = null;
let lastProcessedHash = 0;

// ─── Active Overlay State ──────────────────────────────────────────────────
let activeTripOverlay: {
  signature: string;
  message: string;
  firstShownAt: number;
  lastShownAt: number;
} | null = null;

// ─── Debug History Storage ──────────────────────────────────────────────────────
// Store last 50 events for offline debugging (Porter blocks screen during orders)
const MAX_DEBUG_HISTORY = 50;

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

async function saveDebugEvent(event: DebugEvent) {
  try {
    const historyJson = await AsyncStorage.getItem('debug_porter_history');
    const history: DebugEvent[] = historyJson ? JSON.parse(historyJson) : [];
    
    // Add new event at the beginning
    history.unshift(event);
    
    // Keep only last 10 events
    if (history.length > MAX_DEBUG_HISTORY) {
      history.splice(MAX_DEBUG_HISTORY);
    }
    
    await AsyncStorage.setItem('debug_porter_history', JSON.stringify(history));
  } catch (e) {
    console.error('[Porter] Failed to save debug history:', e);
  }
}

// ─── Location Cache ─────────────────────────────────────────────────────────────
// Avoids GPS call on every accessibility event — reuse if < 60 seconds old
let cachedLocation: { lat: number; lng: number; ts: number } | null = null;
const LOCATION_CACHE_TTL_MS = 60_000; // 60 seconds

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
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 60000 }
    );
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// BASIC PORTER MODULE FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════════

export const isAccessibilityServiceEnabled = async (): Promise<boolean> => {
  if (Platform.OS !== 'android') return false;
  return await PorterModule.isAccessibilityServiceEnabled();
};

export const openAccessibilitySettings = () => {
  if (Platform.OS === 'android') {
    PorterModule.openAccessibilitySettings();
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

// Geocode a location string using free OpenStreetMap Nominatim API
// Includes 8-second timeout to prevent hanging when rate-limited
async function geocode(location: string): Promise<{ lat: number; lng: number } | null> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 8000);
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
      console.log('[Porter] Nominatim geocoded:', location, '→', coords);
      return coords;
    }
    console.warn('[Porter] Nominatim: No results for', location);
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

async function getDistancesKm(currentLat: number, currentLng: number, pickup: string, drop: string) {
  // API QUOTA PROTECTION: Reject clearly invalid addresses before making network calls
  if (!isValidAddressString(pickup) || !isValidAddressString(drop)) {
    console.warn('[Porter] Invalid address strings — skipping API call:', { pickup, drop });
    await AsyncStorage.setItem('debug_porter_api_error', 'Invalid address format');
    return { toPickup: 'Invalid Address', tripDistance: 'Invalid Address' };
  }

  if (GOOGLE_MAPS_API_KEY) {
    try {
      const origin = `${currentLat},${currentLng}`;
      console.log('[Porter] Calling Google Maps API with:', { origin, pickup, drop });
      
      const [toPickupResp, tripResp] = await Promise.all([
        fetch(`https://maps.googleapis.com/maps/api/distancematrix/json?origins=${encodeURIComponent(origin)}&destinations=${encodeURIComponent(pickup)}&mode=driving&key=${GOOGLE_MAPS_API_KEY}`),
        fetch(`https://maps.googleapis.com/maps/api/distancematrix/json?origins=${encodeURIComponent(pickup)}&destinations=${encodeURIComponent(drop)}&mode=driving&key=${GOOGLE_MAPS_API_KEY}`),
      ]);
      
      const [toPickupData, tripData] = await Promise.all([toPickupResp.json(), tripResp.json()]);
      
      console.log('[Porter] Google Maps API Response:', { 
        toPickupStatus: toPickupData.status,
        toPickupError: toPickupData.error_message,
        tripStatus: tripData.status,
        tripError: tripData.error_message,
      });
      
      // Save API response for debugging
      await AsyncStorage.setItem('debug_porter_api_response', JSON.stringify({
        toPickup: toPickupData,
        trip: tripData,
      }));
      
      // Check for API errors
      if (toPickupData.status !== 'OK' || tripData.status !== 'OK') {
        const errorMsg = toPickupData.error_message || tripData.error_message || `API Status: ${toPickupData.status}`;
        console.warn('[Porter] Google Maps API Error:', errorMsg);
        await AsyncStorage.setItem('debug_porter_api_error', errorMsg);
        // Fall through to Nominatim fallback
      } else {
        const toPickupStatus = toPickupData.rows?.[0]?.elements?.[0]?.status;
        const tripStatus = tripData.rows?.[0]?.elements?.[0]?.status;
        
        if (toPickupStatus === 'OK' && tripStatus === 'OK') {
          await AsyncStorage.setItem('debug_porter_api_error', 'Success');
          return {
            toPickup: toPickupData.rows[0].elements[0].distance.text,
            tripDistance: tripData.rows[0].elements[0].distance.text,
          };
        } else {
          const elementError = `Element status: toPickup=${toPickupStatus}, trip=${tripStatus}`;
          console.warn('[Porter] Google Maps element error:', elementError);
          await AsyncStorage.setItem('debug_porter_api_error', elementError);
          // Fall through to Nominatim fallback
        }
      }
    } catch (error: any) {
      console.error('[Porter] Google Maps API exception:', error);
      await AsyncStorage.setItem('debug_porter_api_error', `Exception: ${error.message}`);
      // Fall through to Nominatim fallback
    }
  } else {
    await AsyncStorage.setItem('debug_porter_api_error', 'No API key configured');
  }

  // Fallback: Free Nominatim geocoding + Haversine
  console.log('[Porter] Using Nominatim fallback for:', { pickup, drop });
  const ROAD_FACTOR = 1.25;
  const [pickupCoords, dropCoords] = await Promise.all([geocode(pickup), geocode(drop)]);
  
  console.log('[Porter] Nominatim results:', { pickupCoords, dropCoords });
  await AsyncStorage.setItem('debug_porter_nominatim', JSON.stringify({ pickupCoords, dropCoords }));
  
  const toPickup = pickupCoords ? `~${(haversineKm(currentLat, currentLng, pickupCoords.lat, pickupCoords.lng) * ROAD_FACTOR).toFixed(1)} km` : 'N/A';
  const tripDistance = pickupCoords && dropCoords ? `~${(haversineKm(pickupCoords.lat, pickupCoords.lng, dropCoords.lat, dropCoords.lng) * ROAD_FACTOR).toFixed(1)} km` : 'N/A';

  return { toPickup, tripDistance };
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
  if (text.length > 30 && lower.includes(',') && !lower.match(/^[\d₹\.\s]+$/)) return true;
  
  return false;
}

/**
 * Extract pickup and drop addresses from Porter popup text.
 * Based on real Porter App layout logs:
 * ₹105 || Pickup 2.2 km away || PICKUP || PICKUP || [Pickup Address] || DROP || DROP || [Drop Address]
 */
function extractAddresses(text: string): { pickup: string; drop: string } | null {
  const parts = text.split('||').map((s: string) => s.trim()).filter(Boolean);
  
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

// ═══════════════════════════════════════════════════════════════════════════════
// PORTER DISTANCE CALCULATOR (EVENT LISTENER)
// ═══════════════════════════════════════════════════════════════════════════════

export const initPorterDistanceCalculator = () => {
  if (subscription) return; // Already initialized

  console.log('🚛 [Porter] Distance calculator initialized');

  subscription = eventEmitter.addListener('onPorterScreenChange', async (event) => {
    const debugEvent: DebugEvent = {
      timestamp: new Date().toISOString(),
      eventType: event.eventType || 'unknown',
      textContent: event.textContent || '',
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
      const text = event.textContent || '';
      const eventType = event.eventType || 'unknown';
      
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
      await AsyncStorage.setItem('debug_porter_last_raw_text', text);
      await AsyncStorage.setItem('debug_porter_last_time', debugEvent.timestamp);
      await AsyncStorage.setItem('debug_porter_last_event_type', eventType);

      // Check if text has changed (by hash)
      const textHash = text.split('').reduce((hash: number, char: string) => {
        return ((hash << 5) - hash) + char.charCodeAt(0);
      }, 0);
      
      if (textHash === lastProcessedHash) {
        debugEvent.status = 'Skipped: Duplicate text';
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
        await AsyncStorage.setItem('debug_porter_status', debugEvent.status);
        return;
      }
      
      lastProcessedHash = textHash;
      debugEvent.status = 'Processing ride request...';
      await AsyncStorage.setItem('debug_porter_status', debugEvent.status);

      // Smart address extraction
      const addresses = extractAddresses(text);
      
      if (!addresses) {
        debugEvent.status = `Failed: Could not extract addresses.\nParts found: ${text.split('||').length}\nRaw text (first 500): ${text.slice(0, 500)}`;
        await AsyncStorage.setItem('debug_porter_status', debugEvent.status);
        return;
      }

      const tripSig = `${addresses.pickup}|${addresses.drop}`;
      
      // 2. DEDUPLICATE TRIPS (Save API Quota & Battery)
      if (activeTripOverlay && activeTripOverlay.signature === tripSig) {
        debugEvent.status = 'Skipped: Trip already processed and currently showing';
        return;
      }

      debugEvent.pickup = addresses.pickup;
      debugEvent.drop = addresses.drop;
      debugEvent.status = `Extracted:\nPickup: ${addresses.pickup}\nDrop: ${addresses.drop}`;
      await AsyncStorage.setItem('debug_porter_status', debugEvent.status);

      // BATTERY OPTIMIZATION: use cached GPS coordinates (re-fetched only if > 60s old)
      try {
        const { lat, lng } = await getCachedOrFreshLocation();
        debugEvent.location = { lat, lng };
        
        const distances = await getDistancesKm(lat, lng, addresses.pickup, addresses.drop);

        debugEvent.result = JSON.stringify(distances);
        await AsyncStorage.setItem('debug_porter_result', debugEvent.result);

        // Get API error and Nominatim info from AsyncStorage
        debugEvent.apiError = await AsyncStorage.getItem('debug_porter_api_error') || '';
        debugEvent.nominatim = await AsyncStorage.getItem('debug_porter_nominatim') || '';

        if (distances.toPickup !== 'N/A' && distances.toPickup !== 'Invalid Address' && Platform.OS === 'android') {
          const message = `📍 You -> Pickup: ${distances.toPickup}\n🛣️ Pickup -> Drop: ${distances.tripDistance}`;
          showToastOverlay(message, false); // False because activeTripOverlay will handle the background refresh
          
          activeTripOverlay = {
            signature: tripSig,
            message: message,
            firstShownAt: Date.now(),
            lastShownAt: Date.now()
          };

          debugEvent.status = 'Success: Overlay shown';
          await AsyncStorage.setItem('debug_porter_status', debugEvent.status);
        } else {
          debugEvent.status = `Failed: Distance calc returned N/A or invalid address\nPickup: ${addresses.pickup}\nDrop: ${addresses.drop}`;
          await AsyncStorage.setItem('debug_porter_status', debugEvent.status);
        }
      } catch (geoError: any) {
        console.log('Geolocation error in Porter calculator:', geoError);
        debugEvent.status = `Geo Error: ${geoError.message}`;
        await AsyncStorage.setItem('debug_porter_status', debugEvent.status);
      }
    } catch (e: any) {
      console.error('Error in Porter distance calculation:', e);
      debugEvent.status = `Critical Error: ${e.message}`;
      AsyncStorage.setItem('debug_porter_status', debugEvent.status);
    } finally {
      // Only save to history if it's a success or a real failure (not ignored/skipped)
      if (!debugEvent.status.startsWith('Ignored') && !debugEvent.status.startsWith('Skipped')) {
        await saveDebugEvent(debugEvent);
      }
    }
  });
};

export const stopPorterDistanceCalculator = () => {
  if (subscription) {
    subscription.remove();
    subscription = null;
  }
};
