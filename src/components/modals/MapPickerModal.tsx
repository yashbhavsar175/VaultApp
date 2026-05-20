import React, { useState, useRef, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TouchableOpacity,
  ActivityIndicator,
  Platform,
} from 'react-native';
import MapView, { Marker, PROVIDER_GOOGLE, MapType } from 'react-native-maps';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';
import { useTheme } from '../../context/ThemeContext';

interface MapPickerModalProps {
  visible: boolean;
  initialLatitude: number;
  initialLongitude: number;
  placeName?: string;
  onConfirm: (latitude: number, longitude: number) => void;
  onCancel: () => void;
}

export default function MapPickerModal({
  visible,
  initialLatitude,
  initialLongitude,
  placeName,
  onConfirm,
  onCancel,
}: MapPickerModalProps) {
  const { colors, borderRadius } = useTheme();
  const mapRef = useRef<MapView>(null);
  const [markerCoord, setMarkerCoord] = useState({
    latitude: initialLatitude,
    longitude: initialLongitude,
  });
  const [mapType, setMapType] = useState<MapType>('standard');
  const [mapReady, setMapReady] = useState(false);

  // Reset state when modal opens with new coords
  React.useEffect(() => {
    if (visible) {
      setMarkerCoord({
        latitude: initialLatitude,
        longitude: initialLongitude,
      });
      setMapReady(false);
    }
  }, [visible, initialLatitude, initialLongitude]);

  const handleMapPress = useCallback((e: any) => {
    const { latitude, longitude } = e.nativeEvent.coordinate;
    setMarkerCoord({ latitude, longitude });
  }, []);

  const handleMarkerDragEnd = useCallback((e: any) => {
    const { latitude, longitude } = e.nativeEvent.coordinate;
    setMarkerCoord({ latitude, longitude });
  }, []);

  const cycleMapType = () => {
    const types: MapType[] = ['standard', 'satellite', 'hybrid'];
    const currentIndex = types.indexOf(mapType);
    setMapType(types[(currentIndex + 1) % types.length]);
  };

  const getMapTypeIcon = () => {
    switch (mapType) {
      case 'satellite': return 'satellite-variant';
      case 'hybrid': return 'layers';
      default: return 'map';
    }
  };

  const getMapTypeLabel = () => {
    switch (mapType) {
      case 'satellite': return 'Satellite';
      case 'hybrid': return 'Hybrid';
      default: return 'Standard';
    }
  };

  const recenterMap = () => {
    mapRef.current?.animateToRegion({
      latitude: markerCoord.latitude,
      longitude: markerCoord.longitude,
      latitudeDelta: 0.002,
      longitudeDelta: 0.002,
    }, 500);
  };

  return (
    <Modal visible={visible} animationType="slide" statusBarTranslucent onRequestClose={onCancel}>
      <View style={styles.container}>
        {/* Map */}
        <MapView
          ref={mapRef}
          style={styles.map}
          provider={PROVIDER_GOOGLE}
          mapType={mapType}
          customMapStyle={[
            {
              featureType: "poi",
              elementType: "labels",
              stylers: [{ visibility: "on" }]
            },
            {
              featureType: "poi.business",
              stylers: [{ visibility: "on" }]
            }
          ]}
          initialRegion={{
            latitude: initialLatitude,
            longitude: initialLongitude,
            latitudeDelta: 0.004,
            longitudeDelta: 0.004,
          }}
          showsUserLocation
          showsMyLocationButton={false}
          showsCompass
          showsPointsOfInterests={true}
          showsBuildings={true}
          onPress={handleMapPress}
          onMapReady={() => setMapReady(true)}
        >
          <Marker
            coordinate={markerCoord}
            draggable
            onDragEnd={handleMarkerDragEnd}
            title={placeName || 'Selected Location'}
            description="Drag to adjust"
          />
        </MapView>

        {/* Loading overlay */}
        {!mapReady && (
          <View style={styles.loadingOverlay}>
            <ActivityIndicator size="large" color={colors.accent} />
            <Text style={{ color: colors.text, marginTop: 12, fontSize: 14 }}>Loading map...</Text>
          </View>
        )}

        {/* Top bar */}
        <View style={[styles.topBar, { backgroundColor: 'rgba(0,0,0,0.6)' }]}>
          <TouchableOpacity onPress={onCancel} style={styles.topButton}>
            <MaterialCommunityIcons name="arrow-left" size={24} color="#fff" />
          </TouchableOpacity>
          <View style={styles.topTitleContainer}>
            <Text style={styles.topTitle}>Adjust Pin</Text>
            <Text style={styles.topSubtitle}>Tap map or drag marker</Text>
          </View>
          <View style={{ width: 40 }} />
        </View>

        {/* Right side controls */}
        <View style={styles.controlsContainer}>
          {/* Map type toggle */}
          <TouchableOpacity
            style={[styles.controlButton, { backgroundColor: colors.card }]}
            onPress={cycleMapType}
            activeOpacity={0.8}
          >
            <MaterialCommunityIcons name={getMapTypeIcon()} size={22} color={colors.accent} />
            <Text style={[styles.controlLabel, { color: colors.text }]}>{getMapTypeLabel()}</Text>
          </TouchableOpacity>

          {/* Recenter */}
          <TouchableOpacity
            style={[styles.controlButton, { backgroundColor: colors.card }]}
            onPress={recenterMap}
            activeOpacity={0.8}
          >
            <MaterialCommunityIcons name="crosshairs-gps" size={22} color={colors.accent} />
          </TouchableOpacity>
        </View>

        {/* Bottom confirm bar */}
        <View style={[styles.bottomBar, { backgroundColor: colors.background }]}>
          <View style={styles.coordInfo}>
            <MaterialCommunityIcons name="map-marker" size={18} color={colors.accent} />
            <Text style={{ color: colors.subtext, fontSize: 12, marginLeft: 6, flex: 1 }} numberOfLines={1}>
              {markerCoord.latitude.toFixed(6)}, {markerCoord.longitude.toFixed(6)}
            </Text>
          </View>
          <TouchableOpacity
            style={[styles.confirmButton, { backgroundColor: colors.accent, borderRadius: borderRadius.md }]}
            onPress={() => onConfirm(markerCoord.latitude, markerCoord.longitude)}
            activeOpacity={0.8}
          >
            <MaterialCommunityIcons name="check" size={20} color="#fff" style={{ marginRight: 6 }} />
            <Text style={styles.confirmText}>Confirm Location</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  map: {
    ...StyleSheet.absoluteFillObject,
  },
  loadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 10,
  },
  topBar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    paddingTop: Platform.OS === 'android' ? 36 : 56,
    paddingBottom: 14,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    zIndex: 5,
  },
  topButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.15)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  topTitleContainer: {
    flex: 1,
    alignItems: 'center',
  },
  topTitle: {
    color: '#fff',
    fontSize: 17,
    fontWeight: '700',
  },
  topSubtitle: {
    color: 'rgba(255,255,255,0.7)',
    fontSize: 12,
    marginTop: 2,
  },
  controlsContainer: {
    position: 'absolute',
    right: 14,
    top: '35%',
    gap: 10,
    zIndex: 5,
  },
  controlButton: {
    width: 48,
    height: 48,
    borderRadius: 24,
    justifyContent: 'center',
    alignItems: 'center',
    elevation: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
  },
  controlLabel: {
    fontSize: 8,
    fontWeight: '600',
    marginTop: 2,
  },
  bottomBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    padding: 16,
    paddingBottom: Platform.OS === 'android' ? 20 : 36,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    elevation: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
  },
  coordInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  confirmButton: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 15,
  },
  confirmText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
  },
});
