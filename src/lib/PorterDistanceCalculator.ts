import { NativeEventEmitter, NativeModules, Platform } from 'react-native';
import Geolocation from 'react-native-geolocation-service';
import AsyncStorage from '@react-native-async-storage/async-storage';

const { PorterModule } = NativeModules;
const GOOGLE_MAPS_API_KEY: string = 'AIzaSyBjw5hkphW59klyy4DO1lj5u5WJaCF_fFo';
const eventEmitter = new NativeEventEmitter(PorterModule);

let subscription: any = null;

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
async function geocode(location: string): Promise<{ lat: number; lng: number } | null> {
  try {
    const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(location)}&format=json&limit=1`;
    const res = await fetch(url, { headers: { 'User-Agent': 'SpendSense/1.0' } });
    const data = await res.json();
    if (data.length > 0) return { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon) };
    return null;
  } catch {
    return null;
  }
}

async function getDistancesKm(currentLat: number, currentLng: number, pickup: string, drop: string) {
  if (GOOGLE_MAPS_API_KEY !== 'YOUR_GOOGLE_MAPS_API_KEY') {
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

// Global variable to prevent processing the exact same trip text repeatedly
let lastProcessedText = '';

export const initPorterDistanceCalculator = () => {
  if (subscription) return; // Already initialized

  subscription = eventEmitter.addListener('onPorterScreenChange', async (event) => {
    try {
      const text = event.textContent || '';
      
      // Save every raw capture for debugging without dev mode
      await AsyncStorage.setItem('debug_porter_last_raw_text', text);
      await AsyncStorage.setItem('debug_porter_last_time', new Date().toISOString());

      // Basic check to see if this is a ride request screen
      if (!text.includes('Pickup') || text === lastProcessedText) {
        if (text !== lastProcessedText) {
          await AsyncStorage.setItem('debug_porter_status', 'Ignored: No Pickup keyword found');
        }
        return;
      }
      lastProcessedText = text;

      await AsyncStorage.setItem('debug_porter_status', 'Processing ride request...');

      // Extremely basic regex/string parsing for demo purposes
      // A robust parsing strategy should be implemented here to extract actual addresses
      // from the accessibility text node structure of the Porter App.
      // E.g., text might be "₹191 || Pickup 2.7 km away || BRTS J/132... || 5639/F, Vinzol..."
      
      const parts = text.split('||').map((s: string) => s.trim()).filter(Boolean);
      
      // Let's assume the longest text blocks are addresses, or we find them by index.
      // Usually index 2 is pickup, index 3 is dropoff in Porter driver app based on screenshot
      let pickupAddr = '';
      let dropAddr = '';
      
      for (const part of parts) {
        if (part.length > 20 && !part.includes('Pickup')) {
          if (!pickupAddr) pickupAddr = part;
          else if (!dropAddr) dropAddr = part;
        }
      }

      if (!pickupAddr || !dropAddr) {
        await AsyncStorage.setItem('debug_porter_status', 'Failed: Could not extract pickup/drop addresses');
        return; // Not enough info
      }

      await AsyncStorage.setItem('debug_porter_status', `Extracted Pickup: ${pickupAddr}\nDrop: ${dropAddr}`);

      Geolocation.getCurrentPosition(
        async (pos) => {
          const lat = pos.coords.latitude;
          const lng = pos.coords.longitude;
          const distances = await getDistancesKm(lat, lng, pickupAddr, dropAddr);
          
          await AsyncStorage.setItem('debug_porter_result', JSON.stringify(distances));

          if (distances.toPickup !== 'N/A' && Platform.OS === 'android') {
            PorterModule.showToastOverlay(`📍 You -> Pickup: ${distances.toPickup}\n🛣️ Pickup -> Drop: ${distances.tripDistance}`);
            await AsyncStorage.setItem('debug_porter_status', 'Success: Overlay shown');
          } else {
            await AsyncStorage.setItem('debug_porter_status', 'Failed: Distance calc returned N/A');
          }
        },
        async (error) => {
          console.log('Geolocation error in Porter calculator:', error);
          await AsyncStorage.setItem('debug_porter_status', `Geo Error: ${error.message}`);
        },
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 30000 }
      );
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
