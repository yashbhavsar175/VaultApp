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

export const showToastOverlay = (message: string) => {
  if (Platform.OS === 'android') {
    PorterModule.showToastOverlay(message);
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
    const data = await res.json();
    if (data.length > 0) return { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon) };
    return null;
  } catch {
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
    return { toPickup: 'Invalid Address', tripDistance: 'Invalid Address' };
  }

  if (GOOGLE_MAPS_API_KEY) {
    try {
      const origin = `${currentLat},${currentLng}`;
      const [toPickupResp, tripResp] = await Promise.all([
        fetch(`https://maps.googleapis.com/maps/api/distancematrix/json?origins=${encodeURIComponent(origin)}&destinations=${encodeURIComponent(pickup)}&mode=driving&key=${GOOGLE_MAPS_API_KEY}`),
        fetch(`https://maps.googleapis.com/maps/api/distancematrix/json?origins=${encodeURIComponent(pickup)}&destinations=${encodeURIComponent(drop)}&mode=driving&key=${GOOGLE_MAPS_API_KEY}`),
      ]);
      const [toPickupData, tripData] = await Promise.all([toPickupResp.json(), tripResp.json()]);
      return {
        toPickup: toPickupData.rows?.[0]?.elements?.[0]?.status === 'OK' ? toPickupData.rows[0].elements[0].distance.text : 'N/A',
        tripDistance: tripData.rows?.[0]?.elements?.[0]?.status === 'OK' ? tripData.rows[0].elements[0].distance.text : 'N/A',
      };
    } catch {
      return { toPickup: 'Error', tripDistance: 'Error' };
    }
  }

  const ROAD_FACTOR = 1.25;
  const [pickupCoords, dropCoords] = await Promise.all([geocode(pickup), geocode(drop)]);
  
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
 * Strategy: Parse all text parts and use multiple heuristics to identify addresses.
 * 
 * Porter driver app popup text typically contains:
 * - Price (₹191)
 * - "Pickup X.X km away" label  
 * - Pickup address (full text with area, city)
 * - Drop address (full text with area, city)
 * - Timer/buttons text
 */
function extractAddresses(text: string): { pickup: string; drop: string } | null {
  const parts = text.split('||').map((s: string) => s.trim()).filter(Boolean);
  
  // Strategy 1: Find parts that look like addresses
  const addressParts: string[] = [];
  const pickupKeywordIndex: number[] = [];
  const dropKeywordIndex: number[] = [];
  
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    const lower = part.toLowerCase();
    
    // Track pickup/drop labels
    if (lower.includes('pickup') || lower.includes('pick up') || lower.includes('pick-up')) {
      pickupKeywordIndex.push(i);
    }
    if (lower.includes('drop') || lower.includes('dropoff') || lower.includes('drop-off') || lower.includes('destination')) {
      dropKeywordIndex.push(i);
    }
    
    // Check if this looks like an address
    if (looksLikeAddress(part)) {
      addressParts.push(part);
    }
  }
  
  // If we found exactly 2 address-like parts, use them as pickup and drop
  if (addressParts.length >= 2) {
    return { pickup: addressParts[0], drop: addressParts[1] };
  }
  
  // Strategy 2: Use pickup/drop keyword positions to find addresses
  // The address is usually the text part right AFTER the "Pickup" or "Drop" label
  if (pickupKeywordIndex.length > 0) {
    let pickup = '';
    let drop = '';
    
    // Get the first long text after pickup keyword
    for (let i = pickupKeywordIndex[0] + 1; i < parts.length; i++) {
      if (parts[i].length > 10 && !parts[i].toLowerCase().includes('drop') && !parts[i].match(/^[\d₹]/)) {
        pickup = parts[i];
        break;
      }
    }
    
    // Get the first long text after drop keyword (or after pickup address)
    const startAfter = dropKeywordIndex.length > 0 
      ? dropKeywordIndex[0] + 1 
      : parts.indexOf(pickup) + 1;
    
    for (let i = startAfter; i < parts.length; i++) {
      if (parts[i].length > 10 && parts[i] !== pickup && !parts[i].match(/^[\d₹]/)) {
        drop = parts[i];
        break;
      }
    }
    
    if (pickup && drop) {
      return { pickup, drop };
    }
  }
  
  // Strategy 3: Fallback - grab the two longest text parts (ignoring prices, short labels)
  const candidates = parts
    .filter(p => p.length > 15)
    .filter(p => !p.match(/^[\d₹\.\s]+$/)) // Not just numbers/prices
    .filter(p => !p.toLowerCase().match(/^(pickup|drop|accept|decline|navigate|timer)/))
    .sort((a, b) => b.length - a.length);
  
  if (candidates.length >= 2) {
    // Re-order by original position (first one is pickup, second is drop)
    const sorted = candidates.slice(0, 2).sort((a, b) => parts.indexOf(a) - parts.indexOf(b));
    return { pickup: sorted[0], drop: sorted[1] };
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
    try {
      const text = event.textContent || '';
      const eventType = event.eventType || 'unknown';
      
      // Save every raw capture for debugging
      await AsyncStorage.setItem('debug_porter_last_raw_text', text);
      await AsyncStorage.setItem('debug_porter_last_time', new Date().toISOString());
      await AsyncStorage.setItem('debug_porter_last_event_type', eventType);

      // Check if text has changed (by hash)
      const textHash = text.split('').reduce((hash: number, char: string) => {
        return ((hash << 5) - hash) + char.charCodeAt(0);
      }, 0);
      
      if (textHash === lastProcessedHash) {
        return; // Same text, skip
      }

      // Check if this is a ride request screen (case-insensitive)
      const lowerText = text.toLowerCase();
      const isRideRequest = lowerText.includes('pickup') || 
                            lowerText.includes('pick up') || 
                            lowerText.includes('drop') ||
                            (lowerText.includes('km') && lowerText.includes('away'));
      
      if (!isRideRequest) {
        await AsyncStorage.setItem('debug_porter_status', `Ignored: No ride keywords found (event: ${eventType})`);
        return;
      }
      
      lastProcessedHash = textHash;
      await AsyncStorage.setItem('debug_porter_status', 'Processing ride request...');

      // Smart address extraction
      const addresses = extractAddresses(text);
      
      if (!addresses) {
        await AsyncStorage.setItem('debug_porter_status', 
          `Failed: Could not extract addresses.\nParts found: ${text.split('||').length}\nRaw text (first 500): ${text.slice(0, 500)}`);
        return;
      }

      await AsyncStorage.setItem('debug_porter_status',
        `Extracted:\nPickup: ${addresses.pickup}\nDrop: ${addresses.drop}`);

      // BATTERY OPTIMIZATION: use cached GPS coordinates (re-fetched only if > 60s old)
      try {
        const { lat, lng } = await getCachedOrFreshLocation();
        const distances = await getDistancesKm(lat, lng, addresses.pickup, addresses.drop);

        await AsyncStorage.setItem('debug_porter_result', JSON.stringify(distances));

        if (distances.toPickup !== 'N/A' && distances.toPickup !== 'Invalid Address' && Platform.OS === 'android') {
          PorterModule.showToastOverlay(`📍 You -> Pickup: ${distances.toPickup}\n🛣️ Pickup -> Drop: ${distances.tripDistance}`);
          await AsyncStorage.setItem('debug_porter_status', 'Success: Overlay shown');
        } else {
          await AsyncStorage.setItem('debug_porter_status', `Failed: Distance calc returned N/A or invalid address\nPickup: ${addresses.pickup}\nDrop: ${addresses.drop}`);
        }
      } catch (geoError: any) {
        console.log('Geolocation error in Porter calculator:', geoError);
        await AsyncStorage.setItem('debug_porter_status', `Geo Error: ${geoError.message}`);
      }
    } catch (e: any) {
      console.error('Error in Porter distance calculation:', e);
      AsyncStorage.setItem('debug_porter_status', `Critical Error: ${e.message}`);
    }
  });
};

export const stopPorterDistanceCalculator = () => {
  if (subscription) {
    subscription.remove();
    subscription = null;
  }
};
