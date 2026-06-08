import React, { useState, useRef, useEffect } from 'react';
import { View, Text, StyleSheet, ActivityIndicator, PermissionsAndroid, Platform } from 'react-native';
import { useNavigation, useRoute, CommonActions } from '@react-navigation/native';
import MapView, { Region } from 'react-native-maps';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';
import Config from 'react-native-config';
import Geolocation from 'react-native-geolocation-service';

import { useTheme } from '../../context/ThemeContext';
import { AppHeader, AppButton, ScreenWrapper } from '../../components';

const GOOGLE_MAPS_API_KEY = Config.GOOGLE_MAPS_API_KEY || '';
const INDIA_FALLBACK_REGION: Region = {
  latitude: 20.5937,
  longitude: 78.9629,
  latitudeDelta: 18,
  longitudeDelta: 18,
};
const DETAIL_REGION_DELTA = {
  latitudeDelta: 0.01,
  longitudeDelta: 0.01,
};
const GEOCODE_DEBOUNCE_MS = 500;
const SAME_PLACE_THRESHOLD = 0.00005;

async function ensureForegroundLocationPermission(): Promise<boolean> {
  if (Platform.OS !== 'android') return true;

  try {
    const finePermission = PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION;
    const coarsePermission = PermissionsAndroid.PERMISSIONS.ACCESS_COARSE_LOCATION;
    const [hasFineLocation, hasCoarseLocation] = await Promise.all([
      PermissionsAndroid.check(finePermission),
      PermissionsAndroid.check(coarsePermission),
    ]);

    if (hasFineLocation || hasCoarseLocation) {
      return true;
    }

    const granted = await PermissionsAndroid.requestMultiple([
      finePermission,
      coarsePermission,
    ]);

    return (
      granted[finePermission] === PermissionsAndroid.RESULTS.GRANTED ||
      granted[coarsePermission] === PermissionsAndroid.RESULTS.GRANTED
    );
  } catch (error) {
    if (__DEV__) console.warn('[PlaceReminderMapPicker] Permission check failed', error);
    return false;
  }
}

export default function PlaceReminderMapPickerScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const { colors, typography, spacing } = useTheme();

  const hasInitialCoords =
    typeof route.params?.latitude === 'number' &&
    typeof route.params?.longitude === 'number';

  const [region, setRegion] = useState<Region>(hasInitialCoords
    ? {
        latitude: route.params.latitude,
        longitude: route.params.longitude,
        ...DETAIL_REGION_DELTA,
      }
    : INDIA_FALLBACK_REGION);

  const [loadingAddress, setLoadingAddress] = useState(false);
  const [loadingCurrentLocation, setLoadingCurrentLocation] = useState(!hasInitialCoords);
  const [hasResolvedAddress, setHasResolvedAddress] = useState(false);
  const [addressLabel, setAddressLabel] = useState(hasInitialCoords
    ? 'Move map to select location'
    : 'Finding current location...');

  const mapRef = useRef<MapView>(null);
  const geocodeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const geocodeRequestRef = useRef(0);
  const lastGeocodeTargetRef = useRef<{ latitude: number; longitude: number } | null>(null);

  useEffect(() => {
    if (__DEV__) console.log('[PlaceReminderMapPicker] Picker opened');
    if (hasInitialCoords) {
      reverseGeocode(region.latitude, region.longitude);
      return;
    }

    let isActive = true;

    const centerOnCurrentLocation = async () => {
      const hasLocationPermission = await ensureForegroundLocationPermission();
      if (!isActive) return;

      if (!hasLocationPermission) {
        setLoadingCurrentLocation(false);
        setAddressLabel('Location permission needed');
        return;
      }

      Geolocation.getCurrentPosition(
        position => {
          if (!isActive) return;

          const nextRegion = {
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
            ...DETAIL_REGION_DELTA,
          };
          setRegion(nextRegion);
          setLoadingCurrentLocation(false);
          mapRef.current?.animateToRegion(nextRegion, 350);
          reverseGeocode(nextRegion.latitude, nextRegion.longitude);
        },
        error => {
          if (!isActive) return;

          if (__DEV__) console.warn('[PlaceReminderMapPicker] Current location unavailable', {
            code: error.code,
            message: error.message,
          });
          setLoadingCurrentLocation(false);
          setAddressLabel('Move map to select location');
        },
        { enableHighAccuracy: true, timeout: 12000, maximumAge: 60000 }
      );
    };

    void centerOnCurrentLocation();

    return () => {
      isActive = false;
    };
    // Run only for the initially opened route. Region changes are handled by
    // onRegionChangeComplete.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    return () => {
      if (geocodeTimerRef.current) {
        clearTimeout(geocodeTimerRef.current);
      }
      geocodeRequestRef.current += 1;
    };
  }, []);

  const reverseGeocode = async (lat: number, lng: number) => {
    const lastTarget = lastGeocodeTargetRef.current;
    if (
      lastTarget &&
      Math.abs(lastTarget.latitude - lat) < SAME_PLACE_THRESHOLD &&
      Math.abs(lastTarget.longitude - lng) < SAME_PLACE_THRESHOLD
    ) {
      return;
    }

    lastGeocodeTargetRef.current = { latitude: lat, longitude: lng };
    const requestId = geocodeRequestRef.current + 1;
    geocodeRequestRef.current = requestId;

    if (!GOOGLE_MAPS_API_KEY) {
      setAddressLabel('Selected location');
      setHasResolvedAddress(true);
      return;
    }

    setLoadingAddress(true);
    try {
      const response = await fetch(
        `https://maps.googleapis.com/maps/api/geocode/json?latlng=${lat},${lng}&key=${GOOGLE_MAPS_API_KEY}`
      );
      const data = await response.json();
      if (requestId !== geocodeRequestRef.current) return;
      
      if (__DEV__) console.log('[PlaceReminderMapPicker] Geocode result status:', data.status);
      
      if (data.status === 'OK' && data.results && data.results.length > 0) {
        const formattedAddress = data.results[0].formatted_address;
        setAddressLabel(formattedAddress);
        setHasResolvedAddress(true);
      } else {
        setAddressLabel('Selected location');
        setHasResolvedAddress(true);
      }
    } catch (error: any) {
      if (requestId !== geocodeRequestRef.current) return;
      if (__DEV__) console.warn('[PlaceReminderMapPicker] Geocode error', { name: error?.name, message: error?.message });
      setAddressLabel('Selected location');
      setHasResolvedAddress(true);
    } finally {
      if (requestId === geocodeRequestRef.current) {
        setLoadingAddress(false);
      }
    }
  };

  const scheduleReverseGeocode = (lat: number, lng: number) => {
    if (geocodeTimerRef.current) {
      clearTimeout(geocodeTimerRef.current);
    }

    geocodeTimerRef.current = setTimeout(() => {
      reverseGeocode(lat, lng);
    }, GEOCODE_DEBOUNCE_MS);
  };

  const handleRegionChangeComplete = (newRegion: Region) => {
    setRegion(newRegion);
    setLoadingCurrentLocation(false);
    scheduleReverseGeocode(newRegion.latitude, newRegion.longitude);
  };

  const handleUseLocation = () => {
    if (__DEV__) console.log('[PlaceReminderMapPicker] Location selected, source: map_pin');
    const selectedLocation = {
      latitude: region.latitude,
      longitude: region.longitude,
      label: hasResolvedAddress && !loadingAddress ? addressLabel : 'Selected location',
      source: 'map_pin',
    };
    // Set selectedLocation params on the existing EditPlaceReminder screen
    // then goBack() to pop MapPicker off the stack cleanly
    const state = typeof navigation.getState === 'function' ? navigation.getState() : undefined;
    const editRoute = state?.routes?.find((r: any) => r.name === 'EditPlaceReminder');
    if (editRoute && typeof navigation.dispatch === 'function') {
      navigation.dispatch({
        ...CommonActions.setParams({
          selectedLocation,
        }),
        source: editRoute.key,
      });
      navigation.goBack();
      return;
    }
    navigation.navigate('EditPlaceReminder', { selectedLocation });
  };

  const selectedLocationLabel = loadingCurrentLocation
    ? 'Finding current location...'
    : loadingAddress && !hasResolvedAddress
    ? 'Finding address...'
    : addressLabel;

  return (
    <ScreenWrapper>
      <AppHeader title="Choose Location" showBack />
      
      <View style={styles.container}>
        <MapView
          ref={mapRef}
          style={styles.map}
          initialRegion={region}
          onRegionChangeComplete={handleRegionChangeComplete}
          showsUserLocation={true}
          showsMyLocationButton={true}
        />
        
        {/* Center Pin Overlay */}
        <View style={styles.pinContainer} pointerEvents="none">
          <MaterialCommunityIcons name="map-marker" size={40} color={colors.accent} style={styles.pinIcon} />
        </View>

        {/* Bottom Panel */}
        <View style={[styles.bottomPanel, { backgroundColor: colors.background, borderTopColor: colors.border }]}>
          <Text style={[typography.caption, { color: colors.subtext, marginBottom: 4 }]}>
            Selected Location
          </Text>
          <View style={styles.addressRow}>
            {loadingAddress && !hasResolvedAddress ? (
              <ActivityIndicator size="small" color={colors.accent} />
            ) : (
              <MaterialCommunityIcons name="map-marker-outline" size={20} color={colors.text} />
            )}
            <Text style={[typography.body, { color: colors.text, marginLeft: 8, flex: 1, flexWrap: 'wrap' }]}>
              {selectedLocationLabel}
            </Text>
          </View>
          
          <AppButton 
            title="Use this location" 
            onPress={handleUseLocation} 
            disabled={loadingCurrentLocation}
            style={{ marginTop: spacing.md }}
          />
        </View>
      </View>
    </ScreenWrapper>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  map: {
    ...StyleSheet.absoluteFillObject,
  },
  pinContainer: {
    position: 'absolute',
    top: '50%',
    left: '50%',
    marginLeft: -20,
    marginTop: -40, // offset to point exactly at center
    alignItems: 'center',
    justifyContent: 'center',
  },
  pinIcon: {
    textShadowColor: 'rgba(0, 0, 0, 0.5)',
    textShadowOffset: { width: 1, height: 1 },
    textShadowRadius: 2,
  },
  bottomPanel: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    padding: 20,
    borderTopWidth: 1,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    elevation: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
  },
  addressRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 4,
  },
});
