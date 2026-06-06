import React, { useState, useRef, useEffect } from 'react';
import { View, Text, StyleSheet, ActivityIndicator } from 'react-native';
import { useNavigation, useRoute, CommonActions } from '@react-navigation/native';
import MapView, { Region } from 'react-native-maps';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';
import Config from 'react-native-config';

import { useTheme } from '../../context/ThemeContext';
import { AppHeader, AppButton, ScreenWrapper } from '../../components';

const GOOGLE_MAPS_API_KEY = Config.GOOGLE_MAPS_API_KEY || '';

export default function PlaceReminderMapPickerScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const { colors, typography, spacing } = useTheme();

  const initialLat = route.params?.latitude || 28.6139; // Default to New Delhi or a sensible default
  const initialLng = route.params?.longitude || 77.2090;

  const [region, setRegion] = useState<Region>({
    latitude: initialLat,
    longitude: initialLng,
    latitudeDelta: 0.01,
    longitudeDelta: 0.01,
  });

  const [loadingAddress, setLoadingAddress] = useState(false);
  const [addressLabel, setAddressLabel] = useState('Move map to select location');

  const mapRef = useRef<MapView>(null);

  useEffect(() => {
    if (__DEV__) console.log('[PlaceReminderMapPicker] Picker opened');
  }, []);

  const reverseGeocode = async (lat: number, lng: number) => {
    if (!GOOGLE_MAPS_API_KEY) {
      setAddressLabel('Selected location');
      return;
    }
    
    setLoadingAddress(true);
    try {
      const response = await fetch(
        `https://maps.googleapis.com/maps/api/geocode/json?latlng=${lat},${lng}&key=${GOOGLE_MAPS_API_KEY}`
      );
      const data = await response.json();
      
      if (__DEV__) console.log('[PlaceReminderMapPicker] Geocode result status:', data.status);
      
      if (data.status === 'OK' && data.results && data.results.length > 0) {
        // Find a suitable short address. Usually first result is best.
        let formattedAddress = data.results[0].formatted_address;
        
        // If it's too long, try to truncate or pick a locality.
        if (formattedAddress.length > 50) {
          formattedAddress = formattedAddress.substring(0, 50) + '...';
        }
        setAddressLabel(formattedAddress);
      } else {
        setAddressLabel('Selected location');
      }
    } catch (error: any) {
      if (__DEV__) console.warn('[PlaceReminderMapPicker] Geocode error', { name: error?.name, message: error?.message });
      setAddressLabel('Selected location');
    } finally {
      setLoadingAddress(false);
    }
  };

  const handleRegionChangeComplete = (newRegion: Region) => {
    setRegion(newRegion);
    reverseGeocode(newRegion.latitude, newRegion.longitude);
  };

  const handleUseLocation = () => {
    if (__DEV__) console.log('[PlaceReminderMapPicker] Location selected, source: map_pin');
    const selectedLocation = {
      latitude: region.latitude,
      longitude: region.longitude,
      label: addressLabel,
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
            {loadingAddress ? (
              <ActivityIndicator size="small" color={colors.accent} />
            ) : (
              <MaterialCommunityIcons name="map-marker-outline" size={20} color={colors.text} />
            )}
            <Text style={[typography.body, { color: colors.text, marginLeft: 8, flex: 1 }]} numberOfLines={2}>
              {loadingAddress ? 'Finding address...' : addressLabel}
            </Text>
          </View>
          
          <AppButton 
            title="Use this location" 
            onPress={handleUseLocation} 
            disabled={loadingAddress}
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
