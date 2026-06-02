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
  Clipboard,
  Share,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';
import Geolocation from 'react-native-geolocation-service';
import { useTheme } from '../../context/ThemeContext';
import { ScreenWrapper, AppHeader, Card } from '../../components';
import {
  clearPorterNativeDebugLogs,
  getPorterNativeDebugLogs,
  showToastOverlay,
} from '../../lib/services/porter';
import { redactedTextSummary } from '../../lib/services/deliveryDebugBlackBox';
import Config from 'react-native-config';

const { PorterModule } = NativeModules;

// SECURITY: API key sourced from .env via react-native-config — never hardcoded
// Set GOOGLE_MAPS_API_KEY in .env. If missing, falls back to Haversine estimation.
const GOOGLE_MAPS_API_KEY: string = Config.GOOGLE_MAPS_API_KEY || '';

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

function safeTextSummary(value: unknown): string {
  const text = typeof value === 'string' ? value.trim() : '';
  if (/^redacted len=\d+ hash=[a-f0-9]+$/i.test(text)) return text;
  return redactedTextSummary(text);
}

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
  if (!GOOGLE_MAPS_API_KEY) {
    // API Key missing — log warning and fall through to Haversine fallback
    console.warn('[PorterTestScreen] GOOGLE_MAPS_API_KEY not found in .env. Using Haversine fallback.');
  } else {
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


function PorterTestScreenContent() {
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
    eventType: '',
    apiError: '',
    nominatim: ''
  });
  const [debugHistory, setDebugHistory] = useState<any[]>([]);
  const [nativeInbox, setNativeInbox] = useState<any[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [showNativeInbox, setShowNativeInbox] = useState(true);

  const eventEmitter = useRef(new NativeEventEmitter(PorterModule)).current;

  useEffect(() => {
    // Listen for real accessibility events (when testing on actual Porter app)
    const subscription = eventEmitter.addListener('onPorterScreenChange', (event) => {
      setCapturedText(`[${event.eventType || 'unknown'}] ${safeTextSummary(event.textContent)}`);
      // Auto-refresh debug logs and history when new event arrives
      setTimeout(() => loadDebugLogs(), 500); // Small delay to ensure AsyncStorage is updated
    });
    requestLocation();
    loadDebugLogs();
    return () => subscription.remove();
  }, [eventEmitter]);

  const loadDebugLogs = async () => {
    try {
      const time = await AsyncStorage.getItem('debug_porter_last_time') || 'Never';
      const rawText = safeTextSummary(await AsyncStorage.getItem('debug_porter_last_raw_text'));
      const status = safeTextSummary(await AsyncStorage.getItem('debug_porter_status'));
      const result = await AsyncStorage.getItem('debug_porter_result') || '';
      const eventType = await AsyncStorage.getItem('debug_porter_last_event_type') || '';
      const apiError = await AsyncStorage.getItem('debug_porter_api_error') || '';
      const nominatimValue = await AsyncStorage.getItem('debug_porter_nominatim');
      const nominatim = nominatimValue ? safeTextSummary(nominatimValue) : '';
      
      setDebugLogs({ time, rawText, status, result, eventType, apiError, nominatim });
      
      // Load history
      const historyJson = await AsyncStorage.getItem('debug_porter_history');
      const history = historyJson ? JSON.parse(historyJson) : [];
      setDebugHistory(history);

      const nativeLogs = await getPorterNativeDebugLogs();
      setNativeInbox(nativeLogs);
    } catch {
      console.log('Failed to load debug logs');
    }
  };

  const clearDebugLogs = async () => {
    await AsyncStorage.multiRemove([
      'debug_porter_last_time',
      'debug_porter_last_raw_text',
      'debug_porter_status',
      'debug_porter_result',
      'debug_porter_last_event_type',
      'debug_porter_api_error',
      'debug_porter_nominatim',
      'debug_porter_api_response',
      'debug_porter_history'
    ]);
    await clearPorterNativeDebugLogs();
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
        {
          enableHighAccuracy: true,
          timeout: 5000,       // Reduced: fail fast, don't drain battery waiting for GPS
          maximumAge: 60000,   // Prefer cached location up to 60s old — significant battery saving
        }
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
    const startedAt = new Date().toISOString();
    const mockText = `Mock Porter Popup || Pickup || ${trip.pickup} || Drop || ${trip.drop}`;
    await AsyncStorage.multiSet([
      ['debug_porter_last_time', startedAt],
      ['debug_porter_last_raw_text', safeTextSummary(mockText)],
      ['debug_porter_last_event_type', 'MANUAL_SIMULATION'],
      ['debug_porter_status', 'Manual simulation: calculating distance'],
    ]);
    loadDebugLogs();

    const lat = currentLocation?.lat ?? 19.076;  // fallback: Mumbai
    const lng = currentLocation?.lng ?? 72.8777;

    const result = await getDistancesKm(lat, lng, trip.pickup, trip.drop);
    setDistances(result);
    setLoadingDistance(false);
    await AsyncStorage.multiSet([
      ['debug_porter_result', JSON.stringify(result)],
      ['debug_porter_status', 'Manual simulation: overlay shown'],
    ]);
    loadDebugLogs();

    // Show native toast overlay (same as it would appear over Porter)
    showToastOverlay(
      `📍 To Pickup: ${result.toPickup}  |  🛣️ Trip: ${result.tripDistance}`,
      true
    );
  };

  // Simulate a fake Porter event and add to history (for testing without real Porter app)
  const simulateHistoryEvent = async (trip: typeof MOCK_TRIPS[0], shouldFail: boolean = false) => {
    try {
      const lat = currentLocation?.lat ?? 22.9938;
      const lng = currentLocation?.lng ?? 72.6359;

      // Get API error and nominatim info
      const distances = await getDistancesKm(lat, lng, trip.pickup, trip.drop);
      const apiError = await AsyncStorage.getItem('debug_porter_api_error') || '';
      const nominatim = await AsyncStorage.getItem('debug_porter_nominatim') || '';

      // Create fake event
      const fakeEvent = {
        timestamp: new Date().toISOString(),
        eventType: 'TYPE_WINDOW_STATE_CHANGED',
        textSummary: safeTextSummary(`₹${Math.floor(Math.random() * 300 + 100)} || Pickup ${(Math.random() * 5 + 0.5).toFixed(1)} km away || PICKUP || ${trip.pickup} || DROP || ${trip.drop}`),
        pickup: safeTextSummary(trip.pickup),
        drop: safeTextSummary(trip.drop),
        status: shouldFail ? 'Failed: Distance calc returned N/A' : 'Success: Overlay shown',
        apiError: shouldFail ? 'Element status: toPickup=ZERO_RESULTS' : apiError,
        nominatim: nominatim,
        result: JSON.stringify(shouldFail ? { toPickup: 'N/A', tripDistance: 'N/A' } : distances),
      };

      // Load existing history
      const historyJson = await AsyncStorage.getItem('debug_porter_history');
      const history = historyJson ? JSON.parse(historyJson) : [];
      
      // Add new event
      history.unshift(fakeEvent);
      
      // Keep a deeper local history for diagnostics.
      if (history.length > 150) {
        history.splice(150);
      }
      
      await AsyncStorage.setItem('debug_porter_history', JSON.stringify(history));
      
      // Refresh UI
      loadDebugLogs();
      
      showToastOverlay(`✅ Fake event added to history (${shouldFail ? 'Failed' : 'Success'})`);
    } catch (e: any) {
      console.error('Failed to simulate event:', e);
    }
  };

  const exportHistory = async () => {
    try {
      if (debugHistory.length === 0) {
        showToastOverlay('⚠️ No history to export');
        return;
      }

      let exportText = `Porter Debug History Export\n`;
      exportText += `Generated: ${new Date().toLocaleString()}\n`;
      exportText += `Total Events: ${debugHistory.length}\n`;
      exportText += `Success: ${debugHistory.filter(e => e.status.includes('Success')).length}\n`;
      exportText += `Failed: ${debugHistory.filter(e => e.status.includes('Failed') || e.status.includes('Error')).length}\n`;
      exportText += `\n${'='.repeat(50)}\n\n`;

      debugHistory.forEach((event, index) => {
        exportText += `📦 Event #${index + 1}\n`;
        exportText += `⏱️ Time: ${new Date(event.timestamp).toLocaleString()}\n`;
        exportText += `⚙️ Type: ${event.eventType}\n`;
        exportText += `📏 Result: ${event.result || 'N/A'}\n`;
        exportText += `🔌 API Status Summary: ${safeTextSummary(event.apiError)}\n`;
        exportText += `📝 Status Summary: ${safeTextSummary(event.status)}\n`;
        exportText += `📄 Text Summary: ${safeTextSummary(event.textSummary || event.textContent)}\n`;
        exportText += `\n${'—'.repeat(50)}\n\n`;
      });

      Clipboard.setString(exportText);
      showToastOverlay('✅ History copied to clipboard');
    } catch {
      showToastOverlay('❌ Failed to export history');
    }
  };

  const buildAllPorterLogsReport = async () => {
    const nativeLogs = await getPorterNativeDebugLogs();
    const historyJson = await AsyncStorage.getItem('debug_porter_history');
    const latestHistory = historyJson ? JSON.parse(historyJson) : [];
    let report = `SpendSense Porter Diagnostics\n`;
    report += `Generated: ${new Date().toLocaleString()}\n`;
    report += `Platform: ${Platform.OS} ${Platform.Version}\n`;
    report += `Google Maps Key: ${GOOGLE_MAPS_API_KEY ? 'Configured' : 'Missing'}\n`;
    report += `Native Logs: ${nativeLogs.length}\n`;
    report += `Event History: ${latestHistory.length}\n`;
    report += `\n${'='.repeat(60)}\nCURRENT DEBUG STATE\n${'='.repeat(60)}\n`;
    report += `Last Event Time: ${debugLogs.time || 'Never'}\n`;
    report += `Event Type: ${debugLogs.eventType || 'N/A'}\n`;
    report += `Status Summary: ${safeTextSummary(debugLogs.status)}\n`;
    report += `API Error/Status Summary: ${safeTextSummary(debugLogs.apiError)}\n`;
    report += `Nominatim Summary: ${safeTextSummary(debugLogs.nominatim)}\n`;
    report += `Result: ${debugLogs.result || 'N/A'}\n`;
    report += `Text Summary: ${safeTextSummary(debugLogs.rawText)}\n`;

    report += `\n${'='.repeat(60)}\nNATIVE INBOX\n${'='.repeat(60)}\n`;
    if (nativeLogs.length === 0) {
      report += `No native logs collected.\n`;
    } else {
      nativeLogs.forEach((log: any, index: number) => {
        report += `\n#${index + 1} ${log.stage || 'log'}\n`;
        report += `Time: ${log.time ? new Date(log.time).toLocaleString() : 'N/A'}\n`;
        report += `Message: ${log.message || 'N/A'}\n`;
        report += `Package: ${log.packageName || 'N/A'}\n`;
        report += `Event Type: ${log.eventType || 'N/A'}\n`;
        report += `Text Length: ${log.textLength || 0}\n`;
        report += `Text Summary: ${safeTextSummary(log.sample)}\n`;
      });
    }

    report += `\n${'='.repeat(60)}\nEVENT HISTORY\n${'='.repeat(60)}\n`;
    if (latestHistory.length === 0) {
      report += `No JS event history collected.\n`;
    } else {
      latestHistory.forEach((event: any, index: number) => {
        report += `\n#${index + 1}\n`;
        report += `Time: ${event.timestamp ? new Date(event.timestamp).toLocaleString() : 'N/A'}\n`;
        report += `Event Type: ${event.eventType || 'N/A'}\n`;
        report += `Status Summary: ${safeTextSummary(event.status)}\n`;
        report += `Result: ${event.result || 'N/A'}\n`;
        report += `API Summary: ${safeTextSummary(event.apiError)}\n`;
        report += `Text Summary: ${safeTextSummary(event.textSummary || event.textContent)}\n`;
      });
    }

    return report;
  };

  const shareAllLogs = async () => {
    try {
      await loadDebugLogs();
      const report = await buildAllPorterLogsReport();
      Clipboard.setString(report);
      await Share.share({
        title: 'SpendSense Porter Diagnostics',
        message: report,
      });
      showToastOverlay(`✅ Full logs copied (${report.length} chars)`);
    } catch (error: any) {
      showToastOverlay(`❌ Failed to share logs: ${error?.message || 'Unknown error'}`);
    }
  };

  const deleteEvent = async (index: number) => {
    try {
      const historyJson = await AsyncStorage.getItem('debug_porter_history');
      const history = historyJson ? JSON.parse(historyJson) : [];
      
      // Remove the event at index
      history.splice(index, 1);
      
      await AsyncStorage.setItem('debug_porter_history', JSON.stringify(history));
      
      // Refresh UI
      loadDebugLogs();
      
      showToastOverlay('🗑️ Event deleted');
    } catch {
      showToastOverlay('❌ Failed to delete event');
    }
  };

  const deleteAllHistory = async () => {
    try {
      await AsyncStorage.setItem('debug_porter_history', JSON.stringify([]));
      loadDebugLogs();
      showToastOverlay('🗑️ All history deleted');
    } catch {
      showToastOverlay('❌ Failed to delete history');
    }
  };

  const copyOfflineDebugger = () => {
    let text = `Porter Offline Debugger\n`;
    text += `⏱️ Time: ${debugLogs.time ? new Date(debugLogs.time).toLocaleString() : 'Never'}\n`;
    if (debugLogs.eventType) text += `⚙️ Event Type: ${debugLogs.eventType}\n`;
    text += `📝 Status Summary: ${safeTextSummary(debugLogs.status)}\n`;
    if (debugLogs.apiError) text += `🔌 API Status Summary: ${safeTextSummary(debugLogs.apiError)}\n`;
    if (debugLogs.nominatim) text += `🌍 Nominatim Summary: ${safeTextSummary(debugLogs.nominatim)}\n`;
    if (debugLogs.result) text += `📏 Result: ${debugLogs.result}\n`;
    text += `\n📄 Text Summary:\n${safeTextSummary(debugLogs.rawText)}\n`;
    
    Clipboard.setString(text);
    showToastOverlay('✅ Debugger info copied');
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
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.sm }}>
          <Text style={[typography.caption, { color: colors.subtext, textTransform: 'uppercase', fontWeight: '600', letterSpacing: 1 }]}>
            Test With These Trips
          </Text>
          <TouchableOpacity
            onPress={async () => {
              // Generate 5 random events (mix of success and failures)
              for (let i = 0; i < 5; i++) {
                const randomTrip = MOCK_TRIPS[Math.floor(Math.random() * MOCK_TRIPS.length)];
                const shouldFail = Math.random() > 0.6; // 40% failure rate
                await simulateHistoryEvent(randomTrip, shouldFail);
                await new Promise<void>(resolve => setTimeout(() => resolve(), 100)); // Small delay
              }
              showToastOverlay('✅ Generated 5 test events');
            }}
            style={{
              backgroundColor: colors.accent + '20',
              borderColor: colors.accent,
              borderWidth: 1,
              borderRadius: 8,
              paddingHorizontal: 12,
              paddingVertical: 6,
            }}>
            <Text style={[typography.caption, { color: colors.accent, fontSize: 10, fontWeight: 'bold' }]}>
              🎲 BULK TEST (5x)
            </Text>
          </TouchableOpacity>
        </View>
        {MOCK_TRIPS.map((trip, i) => (
          <View key={i} style={{ marginBottom: spacing.sm }}>
            <TouchableOpacity
              onPress={() => simulateTripPopup(trip)}
              disabled={loadingDistance}
              style={[{
                backgroundColor: currentTrip === trip ? colors.accent + '20' : colors.card,
                borderColor: currentTrip === trip ? colors.accent : colors.border,
                borderWidth: 1,
                borderRadius: 12,
                padding: spacing.md,
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
            
            {/* Quick History Test Buttons */}
            <View style={{ flexDirection: 'row', gap: 8, marginTop: 6 }}>
              <TouchableOpacity
                onPress={() => simulateHistoryEvent(trip, false)}
                style={{
                  flex: 1,
                  backgroundColor: '#10b98120',
                  borderColor: '#10b981',
                  borderWidth: 1,
                  borderRadius: 8,
                  padding: 8,
                  alignItems: 'center',
                }}>
                <Text style={[typography.caption, { color: '#10b981', fontSize: 10, fontWeight: 'bold' }]}>
                  + Add Success Event
                </Text>
              </TouchableOpacity>
              
              <TouchableOpacity
                onPress={() => simulateHistoryEvent(trip, true)}
                style={{
                  flex: 1,
                  backgroundColor: '#ef444420',
                  borderColor: '#ef4444',
                  borderWidth: 1,
                  borderRadius: 8,
                  padding: 8,
                  alignItems: 'center',
                }}>
                <Text style={[typography.caption, { color: '#ef4444', fontSize: 10, fontWeight: 'bold' }]}>
                  + Add Failed Event
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        ))}

        {/* Redacted summary from real accessibility */}
        {capturedText && (
          <View style={{ marginTop: spacing.lg }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.sm }}>
              <Text style={[typography.caption, { color: colors.subtext, textTransform: 'uppercase', fontWeight: '600', letterSpacing: 1 }]}>
                Live Capture Summary (Foreground)
              </Text>
              <TouchableOpacity onPress={() => { 
                Clipboard.setString(capturedText); 
                showToastOverlay('✅ Live capture copied'); 
              }}>
                <MaterialCommunityIcons name="content-copy" size={16} color={colors.accent} />
              </TouchableOpacity>
            </View>
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
              <TouchableOpacity onPress={shareAllLogs}>
                <Text style={[typography.caption, { color: '#10b981', fontWeight: '600' }]}>SHARE ALL</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={copyOfflineDebugger}>
                <MaterialCommunityIcons name="content-copy" size={18} color={colors.accent} />
              </TouchableOpacity>
              <TouchableOpacity onPress={clearDebugLogs}>
                <Text style={[typography.caption, { color: '#ef4444', fontWeight: '600' }]}>CLEAR</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={loadDebugLogs}>
                <Text style={[typography.caption, { color: colors.accent, fontWeight: '600' }]}>REFRESH</Text>
              </TouchableOpacity>
            </View>
          </View>
          
          <Card style={{ borderColor: colors.accent + '40', borderWidth: 1 }}>
            {/* API Key Status Warning */}
            {!GOOGLE_MAPS_API_KEY && (
              <View style={{
                backgroundColor: '#f59e0b20',
                borderRadius: 8,
                padding: 10,
                marginBottom: spacing.sm,
                flexDirection: 'row',
                alignItems: 'center',
                borderWidth: 1,
                borderColor: '#f59e0b60',
              }}>
                <Text style={{ fontSize: 16, marginRight: 8 }}>⚠️</Text>
                <Text style={[typography.caption, { color: '#f59e0b', flex: 1, fontWeight: '600' }]}>
                  API Key Missing — GOOGLE_MAPS_API_KEY not found in .env.{'\n'}
                  Using free Haversine estimation (less accurate).
                </Text>
              </View>
            )}
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

            {debugLogs.apiError ? (
              <>
                <Text style={[typography.caption, { color: colors.subtext, marginBottom: 4 }]}>API ERROR / STATUS</Text>
                <Text style={[typography.caption, { 
                  color: debugLogs.apiError === 'Success' ? '#10b981' : '#ef4444', 
                  fontFamily: 'monospace', 
                  marginBottom: spacing.sm 
                }]}>
                  {debugLogs.apiError}
                </Text>
              </>
            ) : null}

            {debugLogs.nominatim ? (
              <>
                <Text style={[typography.caption, { color: colors.subtext, marginBottom: 4 }]}>NOMINATIM GEOCODING</Text>
                <Text style={[typography.caption, { color: colors.text, fontFamily: 'monospace', marginBottom: spacing.sm }]}>
                  {debugLogs.nominatim}
                </Text>
              </>
            ) : null}

            {debugLogs.result ? (
              <>
                <Text style={[typography.caption, { color: colors.subtext, marginBottom: 4 }]}>CALCULATION RESULT</Text>
                <Text style={[typography.caption, { color: colors.text, fontFamily: 'monospace', marginBottom: spacing.sm }]}>
                  {debugLogs.result}
                </Text>
              </>
            ) : null}

            <Text style={[typography.caption, { color: colors.subtext, marginBottom: 4 }]}>ACCESSIBILITY TEXT SUMMARY</Text>
            <View style={{ backgroundColor: colors.background, padding: 8, borderRadius: 8 }}>
              <Text style={[typography.caption, { color: colors.text, fontFamily: 'monospace' }]}>
                {debugLogs.rawText}
              </Text>
            </View>
          </Card>
        </View>

        {/* Native Diagnostics Inbox */}
        <View style={{ marginTop: spacing.lg }}>
          <TouchableOpacity
            onPress={() => setShowNativeInbox(!showNativeInbox)}
            style={{
              flexDirection: 'row',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: spacing.sm,
              padding: spacing.sm,
              backgroundColor: colors.card,
              borderRadius: 8,
              borderWidth: 1,
              borderColor: '#f59e0b60',
            }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', flex: 1 }}>
              <MaterialCommunityIcons
                name={showNativeInbox ? 'chevron-down' : 'chevron-right'}
                size={20}
                color="#f59e0b"
              />
              <Text style={[typography.caption, { color: '#f59e0b', textTransform: 'uppercase', fontWeight: '600', letterSpacing: 1, marginLeft: spacing.xs }]}>
                Native Inbox ({nativeInbox.length})
              </Text>
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
              <TouchableOpacity onPress={shareAllLogs}>
                <MaterialCommunityIcons name="share-variant-outline" size={18} color="#10b981" />
              </TouchableOpacity>
              <TouchableOpacity onPress={loadDebugLogs}>
                <MaterialCommunityIcons name="refresh" size={18} color={colors.accent} />
              </TouchableOpacity>
              <TouchableOpacity
                onPress={async () => {
                  await clearPorterNativeDebugLogs();
                  setNativeInbox([]);
                  loadDebugLogs();
                }}>
                <MaterialCommunityIcons name="delete-sweep-outline" size={18} color="#ef4444" />
              </TouchableOpacity>
            </View>
          </TouchableOpacity>

          {showNativeInbox && (
            <Card style={{ borderColor: '#f59e0b50', borderWidth: 1 }}>
              {nativeInbox.length === 0 ? (
                <Text style={[typography.caption, { color: colors.subtext }]}>
                  No native logs yet. Open real Porter app and wait for an order, then come back and tap refresh.
                </Text>
              ) : (
                nativeInbox.map((log, index) => (
                  <View
                    key={`${log.time}-${index}`}
                    style={{
                      paddingVertical: spacing.sm,
                      borderBottomWidth: index === nativeInbox.length - 1 ? 0 : 1,
                      borderBottomColor: colors.border,
                    }}>
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: spacing.sm }}>
                      <Text style={[typography.caption, { color: '#f59e0b', fontWeight: 'bold', flex: 1 }]}>
                        {log.stage || 'log'}
                      </Text>
                      <Text style={[typography.caption, { color: colors.subtext, fontSize: 10 }]}>
                        {log.time ? new Date(log.time).toLocaleTimeString() : ''}
                      </Text>
                    </View>
                    <Text style={[typography.caption, { color: colors.text, marginTop: 2 }]}>
                      {log.message || ''}
                    </Text>
                    {!!log.packageName && (
                      <Text style={[typography.caption, { color: colors.subtext, marginTop: 2, fontFamily: 'monospace', fontSize: 10 }]}>
                        {log.packageName} • {log.eventType || 'event'} • len {log.textLength || 0}
                      </Text>
                    )}
                    {!!log.sample && (
                      <Text style={[typography.caption, { color: colors.subtext, marginTop: 4, fontFamily: 'monospace', fontSize: 10 }]}>
                        {log.sample}
                      </Text>
                    )}
                  </View>
                ))
              )}
            </Card>
          )}
        </View>

        {/* Event History */}
        {debugHistory.length > 0 && (
          <View style={{ marginTop: spacing.lg }}>
            <TouchableOpacity 
              onPress={() => setShowHistory(!showHistory)}
              style={{ 
                flexDirection: 'row', 
                justifyContent: 'space-between', 
                alignItems: 'center', 
                marginBottom: spacing.sm,
                padding: spacing.sm,
                backgroundColor: colors.card,
                borderRadius: 8,
                borderWidth: 1,
                borderColor: colors.accent + '40'
              }}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <MaterialCommunityIcons 
                  name={showHistory ? "chevron-down" : "chevron-right"} 
                  size={20} 
                  color={colors.accent} 
                />
                <Text style={[typography.caption, { color: colors.accent, textTransform: 'uppercase', fontWeight: '600', letterSpacing: 1, marginLeft: spacing.xs }]}>
                  Event History ({debugHistory.length})
                </Text>
              </View>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                <TouchableOpacity onPress={exportHistory}>
                  <MaterialCommunityIcons name="export" size={18} color={colors.accent} />
                </TouchableOpacity>
                <TouchableOpacity 
                  onPress={deleteAllHistory}
                  onLongPress={deleteAllHistory}
                >
                  <MaterialCommunityIcons name="delete-sweep" size={18} color="#ef4444" />
                </TouchableOpacity>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                    <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: '#10b981', marginRight: 4 }} />
                    <Text style={[typography.caption, { color: colors.subtext, fontSize: 10 }]}>
                      {debugHistory.filter(e => e.status.includes('Success')).length}
                    </Text>
                  </View>
                  <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                    <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: '#ef4444', marginRight: 4 }} />
                    <Text style={[typography.caption, { color: colors.subtext, fontSize: 10 }]}>
                      {debugHistory.filter(e => e.status.includes('Failed') || e.status.includes('Error')).length}
                    </Text>
                  </View>
                </View>
              </View>
            </TouchableOpacity>

            {showHistory && (
              <View style={{ 
                backgroundColor: '#06b6d420', 
                borderRadius: 8, 
                padding: spacing.sm, 
                marginBottom: spacing.sm,
                flexDirection: 'row',
                alignItems: 'center',
                gap: 8
              }}>
                <MaterialCommunityIcons name="information-outline" size={14} color="#06b6d4" />
                <Text style={[typography.caption, { color: '#06b6d4', fontSize: 10, flex: 1 }]}>
                  Tap 🗑️ on any event to delete it. Tap 🗑️ above to delete all.
                </Text>
              </View>
            )}

            {showHistory && debugHistory.map((event, index) => (
              <Card key={index} style={{ 
                marginBottom: spacing.sm, 
                borderColor: event.status.includes('Success') ? '#10b98140' : 
                            event.status.includes('Failed') || event.status.includes('Error') ? '#ef444440' : 
                            colors.border,
                borderWidth: 1 
              }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.xs }}>
                  <Text style={[typography.caption, { 
                    color: event.status.includes('Success') ? '#10b981' : 
                           event.status.includes('Failed') || event.status.includes('Error') ? '#ef4444' : 
                           colors.accent,
                    fontWeight: 'bold' 
                  }]}>
                    #{index + 1} • {event.eventType}
                  </Text>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                    <Text style={[typography.caption, { color: colors.subtext, fontSize: 10 }]}>
                      {new Date(event.timestamp).toLocaleTimeString()}
                    </Text>
                    <TouchableOpacity 
                      onPress={() => deleteEvent(index)}
                      style={{ 
                        padding: 4,
                        backgroundColor: '#ef444420',
                        borderRadius: 4,
                      }}
                    >
                      <MaterialCommunityIcons name="delete-outline" size={14} color="#ef4444" />
                    </TouchableOpacity>
                  </View>
                </View>

                {event.pickup && event.drop && (
                  <View style={{ marginBottom: spacing.xs }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 2 }}>
                      <MaterialCommunityIcons name="map-marker" size={12} color="#10b981" />
                      <Text style={[typography.caption, { color: colors.text, marginLeft: 4, flex: 1 }]} numberOfLines={1}>
                        {event.pickup}
                      </Text>
                    </View>
                    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                      <MaterialCommunityIcons name="map-marker" size={12} color="#ef4444" />
                      <Text style={[typography.caption, { color: colors.text, marginLeft: 4, flex: 1 }]} numberOfLines={1}>
                        {event.drop}
                      </Text>
                    </View>
                  </View>
                )}

                {event.result && (
                  <View style={{ 
                    backgroundColor: colors.background, 
                    padding: 6, 
                    borderRadius: 6,
                    marginBottom: spacing.xs 
                  }}>
                    <Text style={[typography.caption, { color: colors.text, fontFamily: 'monospace', fontSize: 11 }]}>
                      {event.result}
                    </Text>
                  </View>
                )}

                {event.apiError && (
                  <Text style={[typography.caption, { 
                    color: event.apiError === 'Success' ? '#10b981' : '#f59e0b',
                    fontSize: 10,
                    marginBottom: spacing.xs 
                  }]}>
                    API: {event.apiError}
                  </Text>
                )}

                <Text style={[typography.caption, { color: colors.subtext, fontSize: 10 }]} numberOfLines={2}>
                  {event.status}
                </Text>
              </Card>
            ))}
          </View>
        )}

      </ScrollView>
    </ScreenWrapper>
  );
}

export default function PorterTestScreen() {
  if (!__DEV__) return null;
  return <PorterTestScreenContent />;
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
