import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  NativeEventEmitter,
  NativeModules,
  ScrollView,
  ActivityIndicator,
  PermissionsAndroid,
  Platform,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';
import Geolocation from 'react-native-geolocation-service';
import { useTheme } from '../../context/ThemeContext';
import { ScreenWrapper, AppHeader, Card } from '../../components';
import { showToastOverlay } from '../../lib/porter';

const { PorterModule } = NativeModules;

// Google Maps API key — set to 'YOUR_GOOGLE_MAPS_API_KEY' to use free Haversine fallback
const GOOGLE_MAPS_API_KEY: string = 'AIzaSyBjw5hkphW59klyy4DO1lj5u5WJaCF_fFo';

const MOCK_TRIPS = [
  {
    pickup: 'Satellite, Ahmedabad, Gujarat',
    drop: 'Maninagar, Ahmedabad, Gujarat',
  },
  {
    pickup: 'Bopal, Ahmedabad, Gujarat',
    drop: 'Navrangpura, Ahmedabad, Gujarat',
  },
  {
    pickup: 'Gota, Ahmedabad, Gujarat',
    drop: 'Prahlad Nagar, Ahmedabad, Gujarat',
  },
];

type DistanceResult = {
  toPickup: string | null;
  tripDistance: string | null;
};

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
    const res = await fetch(url, {
      headers: { 'User-Agent': 'SpendSense/1.0' },
    });
    const data = await res.json();
    if (data.length > 0) {
      return { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon) };
    }
    return null;
  } catch {
    return null;
  }
}

async function getDistancesKm(
  currentLat: number,
  currentLng: number,
  pickup: string,
  drop: string
): Promise<DistanceResult> {
  if (GOOGLE_MAPS_API_KEY !== 'YOUR_GOOGLE_MAPS_API_KEY') {
    // Use Google Maps Distance Matrix API if key is set
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

  // Free mode: Nominatim geocoding + Haversine formula with road correction factor
  // Roads are ~1.25x longer than straight-line (globally accepted approximation)
  const ROAD_FACTOR = 1.25;

  const [pickupCoords, dropCoords] = await Promise.all([
    geocode(pickup),
    geocode(drop),
  ]);

  const toPickup = pickupCoords
    ? `~${(haversineKm(currentLat, currentLng, pickupCoords.lat, pickupCoords.lng) * ROAD_FACTOR).toFixed(1)} km`
    : 'N/A';

  const tripDistance =
    pickupCoords && dropCoords
      ? `~${(haversineKm(pickupCoords.lat, pickupCoords.lng, dropCoords.lat, dropCoords.lng) * ROAD_FACTOR).toFixed(1)} km`
      : 'N/A';

  return { toPickup, tripDistance };
}


export default function PorterTestScreen() {
  const { colors, typography, spacing } = useTheme();
  const [currentTrip, setCurrentTrip] = useState(MOCK_TRIPS[0]);
  const [distances, setDistances] = useState<DistanceResult>({ toPickup: null, tripDistance: null });
  const [loadingDistance, setLoadingDistance] = useState(false);
  const [capturedText, setCapturedText] = useState<string | null>(null);
  const [currentLocation, setCurrentLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [locationStatus, setLocationStatus] = useState<'idle' | 'loading' | 'ready' | 'denied'>('idle');
  
  // Debug state for offline debugging
  const [debugLogs, setDebugLogs] = useState({
    time: '',
    rawText: '',
    status: '',
    result: '',
    eventType: ''
  });

  const eventEmitter = useRef(new NativeEventEmitter(PorterModule)).current;

  useEffect(() => {
    // Listen for real accessibility events (when testing on actual Porter app)
    const subscription = eventEmitter.addListener('onPorterScreenChange', (event) => {
      setCapturedText(`[${event.eventType || '?'}] ${event.textContent?.slice(0, 800) || ''}`);
      loadDebugLogs(); // auto-refresh debug logs if open
    });
    requestLocation();
    loadDebugLogs();
    return () => subscription.remove();
  }, []);

  const loadDebugLogs = async () => {
    try {
      const time = await AsyncStorage.getItem('debug_porter_last_time') || 'Never';
      const rawText = await AsyncStorage.getItem('debug_porter_last_raw_text') || 'None';
      const status = await AsyncStorage.getItem('debug_porter_status') || 'Idle';
      const result = await AsyncStorage.getItem('debug_porter_result') || '';
      const eventType = await AsyncStorage.getItem('debug_porter_last_event_type') || '';
      
      setDebugLogs({ time, rawText, status, result, eventType });
    } catch (e) {
      console.log('Failed to load debug logs');
    }
  };

  const clearDebugLogs = async () => {
    await AsyncStorage.multiRemove([
      'debug_porter_last_time',
      'debug_porter_last_raw_text',
      'debug_porter_status',
      'debug_porter_result',
      'debug_porter_last_event_type'
    ]);
    loadDebugLogs();
  };

  const requestLocation = async () => {
    setLocationStatus('loading');
    try {
      if (Platform.OS === 'android') {
        const granted = await PermissionsAndroid.request(
          PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
          {
            title: 'Location Permission',
            message: 'SpendSense needs your location to calculate distance to pickup point.',
            buttonPositive: 'Allow',
          }
        );
        if (granted !== PermissionsAndroid.RESULTS.GRANTED) {
          setLocationStatus('denied');
          return;
        }
      }

      Geolocation.getCurrentPosition(
        (pos) => {
          setCurrentLocation({ lat: pos.coords.latitude, lng: pos.coords.longitude });
          setLocationStatus('ready');
        },
        () => setLocationStatus('denied'),
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 30000 }
      );
    } catch {
      setLocationStatus('denied');
    }
  };

  const simulateTripPopup = async (trip: typeof MOCK_TRIPS[0]) => {
    setCurrentTrip(trip);
    setDistances({ toPickup: null, tripDistance: null });
    setCapturedText(null);
    setLoadingDistance(true);

    const lat = currentLocation?.lat ?? 19.076;  // fallback: Mumbai
    const lng = currentLocation?.lng ?? 72.8777;

    const result = await getDistancesKm(lat, lng, trip.pickup, trip.drop);
    setDistances(result);
    setLoadingDistance(false);

    // Show native toast overlay (same as it would appear over Porter)
    showToastOverlay(
      `📍 To Pickup: ${result.toPickup}  |  🛣️ Trip: ${result.tripDistance}`
    );
  };

  return (
    <ScreenWrapper>
      <AppHeader title="Porter Trip Tester" showBack={true} />
      <ScrollView contentContainerStyle={{ padding: spacing.lg }}>

        {/* Location Status Bar */}
        <TouchableOpacity
          onPress={locationStatus === 'denied' ? requestLocation : undefined}
          activeOpacity={locationStatus === 'denied' ? 0.7 : 1}>
          <View style={[styles.locationBar, {
            backgroundColor:
              locationStatus === 'ready' ? '#10b981' + '20' :
                locationStatus === 'denied' ? '#ef4444' + '20' : colors.card,
            borderColor:
              locationStatus === 'ready' ? '#10b981' :
                locationStatus === 'denied' ? '#ef4444' : colors.border,
            borderWidth: 1,
            borderRadius: 12,
            padding: spacing.md,
            marginBottom: spacing.md,
            flexDirection: 'row',
            alignItems: 'center',
          }]}>
            {locationStatus === 'loading' && <ActivityIndicator size="small" color={colors.accent} style={{ marginRight: 8 }} />}
            {locationStatus !== 'loading' && (
              <MaterialCommunityIcons
                name={locationStatus === 'ready' ? 'crosshairs-gps' : locationStatus === 'denied' ? 'map-marker-off' : 'map-marker-question'}
                size={20}
                color={locationStatus === 'ready' ? '#10b981' : locationStatus === 'denied' ? '#ef4444' : colors.subtext}
                style={{ marginRight: 8 }}
              />
            )}
            <View style={{ flex: 1 }}>
              <Text style={[typography.caption, {
                fontWeight: '600',
                color: locationStatus === 'ready' ? '#10b981' : locationStatus === 'denied' ? '#ef4444' : colors.text,
              }]}>
                {locationStatus === 'loading' ? 'Getting your location...' :
                  locationStatus === 'ready' ? `📍 Location ready (${currentLocation?.lat.toFixed(4)}, ${currentLocation?.lng.toFixed(4)})` :
                    locationStatus === 'denied' ? 'Location denied — Tap to retry' :
                      'Location not fetched yet'}
              </Text>
              {locationStatus === 'ready' && (
                <Text style={[typography.caption, { color: colors.subtext, fontSize: 11 }]}>
                  Used to calculate distance from you to pickup point
                </Text>
              )}
            </View>
          </View>
        </TouchableOpacity>

        {/* Info Banner */}
        <View style={[styles.infoBanner, {
          backgroundColor: '#06b6d4' + '15',
          borderColor: '#06b6d4',
          borderWidth: 1,
          borderRadius: 12,
          padding: spacing.md,
          marginBottom: spacing.lg,
        }]}>
          <MaterialCommunityIcons name="information-outline" size={18} color="#06b6d4" />
          <Text style={[typography.caption, { color: '#06b6d4', flex: 1, marginLeft: spacing.sm, lineHeight: 18 }]}>
            Shows 2 distances: {'\n'}
            📍 <Text style={{ fontWeight: 'bold' }}>You → Pickup</Text> (to reach the pickup){'\n'}
            🛣️ <Text style={{ fontWeight: 'bold' }}>Pickup → Drop</Text> (actual trip distance)
          </Text>
        </View>

        {/* Mock Porter Popup Card */}
        <Text style={[typography.caption, { color: colors.subtext, textTransform: 'uppercase', fontWeight: '600', letterSpacing: 1, marginBottom: spacing.sm }]}>
          Mock Porter Popup
        </Text>
        <Card style={{ marginBottom: spacing.lg, borderWidth: 2, borderColor: colors.accent + '30' }}>
          {/* Porter-like header */}
          <View style={[styles.porterHeader, { backgroundColor: '#ff6b00' + '15', borderRadius: 8, padding: spacing.md, marginBottom: spacing.md }]}>
            <MaterialCommunityIcons name="truck-fast" size={24} color="#ff6b00" />
            <Text style={[typography.bodyBold, { color: '#ff6b00', marginLeft: spacing.sm }]}>New Trip Request</Text>
            <Text style={[typography.caption, { color: '#ff6b00', marginLeft: 'auto', fontWeight: 'bold' }]}>10s</Text>
          </View>

          {/* You → Pickup */}
          <View style={styles.locationRow}>
            <View style={[styles.locationDot, { backgroundColor: colors.accent }]} />
            <View style={{ flex: 1 }}>
              <Text style={[typography.caption, { color: colors.subtext }]}>YOUR LOCATION</Text>
              <Text style={[typography.bodyBold, { color: colors.text }]}>
                {locationStatus === 'ready' ? `${currentLocation?.lat.toFixed(4)}, ${currentLocation?.lng.toFixed(4)}` : 'Getting location...'}
              </Text>
            </View>
            {loadingDistance ? (
              <ActivityIndicator size="small" color={colors.accent} />
            ) : distances.toPickup ? (
              <View style={{ alignItems: 'flex-end' }}>
                <Text style={[typography.caption, { color: colors.subtext, fontSize: 10 }]}>TO PICKUP</Text>
                <Text style={[typography.bodyBold, { color: colors.accent }]}>{distances.toPickup}</Text>
              </View>
            ) : null}
          </View>

          <View style={[styles.locationLine, { backgroundColor: '#06b6d420' }]} />

          {/* Pickup */}
          <View style={styles.locationRow}>
            <View style={[styles.locationDot, { backgroundColor: '#10b981' }]} />
            <View style={{ flex: 1 }}>
              <Text style={[typography.caption, { color: colors.subtext }]}>PICKUP</Text>
              <Text style={[typography.bodyBold, { color: colors.text }]} numberOfLines={2}>
                {currentTrip.pickup}
              </Text>
            </View>
          </View>

          <View style={[styles.locationLine, { backgroundColor: colors.border }]} />

          {/* Drop */}
          <View style={styles.locationRow}>
            <View style={[styles.locationDot, { backgroundColor: '#ef4444' }]} />
            <View style={{ flex: 1 }}>
              <Text style={[typography.caption, { color: colors.subtext }]}>DROP</Text>
              <Text style={[typography.bodyBold, { color: colors.text }]} numberOfLines={2}>
                {currentTrip.drop}
              </Text>
            </View>
            {!loadingDistance && distances.tripDistance && (
              <View style={{ alignItems: 'flex-end' }}>
                <Text style={[typography.caption, { color: colors.subtext, fontSize: 10 }]}>TRIP</Text>
                <Text style={[typography.bodyBold, { color: '#ef4444' }]}>{distances.tripDistance}</Text>
              </View>
            )}
          </View>

          {/* Summary Row */}
          {!loadingDistance && distances.toPickup && distances.tripDistance && (
            <View style={[styles.summaryRow, { backgroundColor: colors.background, borderRadius: 10, padding: spacing.md, marginTop: spacing.md }]}>
              <View style={styles.summaryItem}>
                <MaterialCommunityIcons name="crosshairs-gps" size={18} color={colors.accent} />
                <Text style={[typography.caption, { color: colors.subtext, marginTop: 2 }]}>To Pickup</Text>
                <Text style={[typography.bodyBold, { color: colors.accent }]}>{distances.toPickup}</Text>
              </View>
              <View style={[styles.summaryDivider, { backgroundColor: colors.border }]} />
              <View style={styles.summaryItem}>
                <MaterialCommunityIcons name="map-marker-distance" size={18} color="#ef4444" />
                <Text style={[typography.caption, { color: colors.subtext, marginTop: 2 }]}>Trip Distance</Text>
                <Text style={[typography.bodyBold, { color: '#ef4444' }]}>{distances.tripDistance}</Text>
              </View>
            </View>
          )}

          {loadingDistance && (
            <View style={[styles.summaryRow, { backgroundColor: colors.background, borderRadius: 10, padding: spacing.md, marginTop: spacing.md, justifyContent: 'center' }]}>
              <ActivityIndicator size="small" color={colors.accent} />
              <Text style={[typography.caption, { color: colors.subtext, marginLeft: 8 }]}>Calculating distances...</Text>
            </View>
          )}
        </Card>

        {/* Test Trip Buttons */}
        <Text style={[typography.caption, { color: colors.subtext, textTransform: 'uppercase', fontWeight: '600', letterSpacing: 1, marginBottom: spacing.sm }]}>
          Test With These Trips
        </Text>
        {MOCK_TRIPS.map((trip, i) => (
          <TouchableOpacity
            key={i}
            onPress={() => simulateTripPopup(trip)}
            disabled={loadingDistance}
            style={[{
              backgroundColor: currentTrip === trip ? colors.accent + '20' : colors.card,
              borderColor: currentTrip === trip ? colors.accent : colors.border,
              borderWidth: 1,
              borderRadius: 12,
              padding: spacing.md,
              marginBottom: spacing.sm,
              opacity: loadingDistance ? 0.6 : 1,
            }]}>
            <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 4 }}>
              <MaterialCommunityIcons name="map-marker" size={15} color="#10b981" />
              <Text style={[typography.caption, { color: colors.text, marginLeft: 6, flex: 1 }]} numberOfLines={1}>{trip.pickup}</Text>
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <MaterialCommunityIcons name="map-marker" size={15} color="#ef4444" />
              <Text style={[typography.caption, { color: colors.text, marginLeft: 6, flex: 1 }]} numberOfLines={1}>{trip.drop}</Text>
            </View>
            <Text style={[typography.caption, { color: colors.accent, fontWeight: 'bold', marginTop: 8, textAlign: 'right' }]}>
              {loadingDistance && currentTrip === trip ? 'Calculating...' : 'Tap to Simulate →'}
            </Text>
          </TouchableOpacity>
        ))}

        {/* Captured text from real accessibility */}
        {capturedText && (
          <View style={{ marginTop: spacing.lg }}>
            <Text style={[typography.caption, { color: colors.subtext, textTransform: 'uppercase', fontWeight: '600', letterSpacing: 1, marginBottom: spacing.sm }]}>
              Live Capture (Foreground)
            </Text>
            <Card>
              <Text style={[typography.caption, { color: colors.text, fontFamily: 'monospace' }]}>
                {capturedText}
              </Text>
            </Card>
          </View>
        )}

        {/* Offline Debug Panel for Real World Testing */}
        <View style={{ marginTop: spacing.xl }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.sm }}>
            <Text style={[typography.caption, { color: colors.accent, textTransform: 'uppercase', fontWeight: '600', letterSpacing: 1 }]}>
              Offline Debugger
            </Text>
            <View style={{ flexDirection: 'row', gap: 12 }}>
              <TouchableOpacity onPress={clearDebugLogs}>
                <Text style={[typography.caption, { color: '#ef4444', fontWeight: '600' }]}>CLEAR</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={loadDebugLogs}>
                <Text style={[typography.caption, { color: colors.accent, fontWeight: '600' }]}>REFRESH</Text>
              </TouchableOpacity>
            </View>
          </View>
          
          <Card style={{ borderColor: colors.accent + '40', borderWidth: 1 }}>
            <Text style={[typography.caption, { color: colors.subtext, marginBottom: 4 }]}>LAST EVENT TIME</Text>
            <Text style={[typography.bodyBold, { color: colors.text, marginBottom: spacing.sm }]}>{debugLogs.time ? new Date(debugLogs.time).toLocaleString() : 'Never'}</Text>

            {debugLogs.eventType ? (
              <>
                <Text style={[typography.caption, { color: colors.subtext, marginBottom: 4 }]}>EVENT TYPE</Text>
                <Text style={[typography.caption, { color: '#06b6d4', fontFamily: 'monospace', marginBottom: spacing.sm }]}>
                  {debugLogs.eventType}
                </Text>
              </>
            ) : null}

            <Text style={[typography.caption, { color: colors.subtext, marginBottom: 4 }]}>STATUS</Text>
            <Text style={[typography.bodyBold, { color: debugLogs.status.includes('Failed') || debugLogs.status.includes('Error') ? '#ef4444' : '#10b981', marginBottom: spacing.sm }]}>
              {debugLogs.status}
            </Text>

            {debugLogs.result ? (
              <>
                <Text style={[typography.caption, { color: colors.subtext, marginBottom: 4 }]}>CALCULATION RESULT</Text>
                <Text style={[typography.caption, { color: colors.text, fontFamily: 'monospace', marginBottom: spacing.sm }]}>
                  {debugLogs.result}
                </Text>
              </>
            ) : null}

            <Text style={[typography.caption, { color: colors.subtext, marginBottom: 4 }]}>RAW ACCESSIBILITY TEXT (WHAT AI SAW)</Text>
            <View style={{ backgroundColor: colors.background, padding: 8, borderRadius: 8 }}>
              <Text style={[typography.caption, { color: colors.text, fontFamily: 'monospace' }]}>
                {debugLogs.rawText}
              </Text>
            </View>
          </Card>
        </View>

      </ScrollView>
    </ScreenWrapper>
  );
}

const styles = StyleSheet.create({
  infoBanner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  locationBar: {},
  porterHeader: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  locationRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginVertical: 4,
    gap: 8,
  },
  locationDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    marginTop: 5,
  },
  locationLine: {
    width: 2,
    height: 16,
    marginLeft: 5,
    marginVertical: 2,
  },
  summaryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
  },
  summaryItem: {
    alignItems: 'center',
    flex: 1,
  },
  summaryDivider: {
    width: 1,
    height: 40,
  },
});
