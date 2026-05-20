import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  Modal,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  ActivityIndicator,
  PermissionsAndroid,
  Linking,
  Image,
} from 'react-native';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';
import Toast from 'react-native-toast-message';
import Geolocation from 'react-native-geolocation-service';
import { launchCamera } from 'react-native-image-picker';
import { useTheme } from '../../context/ThemeContext';
import { ScreenWrapper, AppHeader, AppConfirmModal, MapPickerModal } from '../../components';
import { Place, PlaceCategory } from '../../types';
import { getPlaces, addPlace, updatePlace, deletePlace, uploadPlacePhoto } from '../../lib/database/userdata';
import { getCached, setCache, updateCache, CACHE_KEYS } from '../../lib/services/cache';

const CATEGORY_MAP: Record<PlaceCategory, { label: string; icon: string; color: string }> = {
  shop: { label: 'Shop', icon: 'shopping', color: '#3b82f6' },
  ev_charging: { label: 'EV Charging', icon: 'ev-station', color: '#10b981' },
  cafe: { label: 'Cafe', icon: 'coffee', color: '#f59e0b' },
  atm: { label: 'ATM', icon: 'cash-multiple', color: '#8b5cf6' },
  mechanic: { label: 'Mechanic', icon: 'wrench', color: '#ef4444' },
  other: { label: 'Other', icon: 'map-marker', color: '#6b7280' },
};

const CATEGORIES = Object.keys(CATEGORY_MAP) as PlaceCategory[];

export default function PlacesScreen() {
  const { colors, typography, spacing, borderRadius } = useTheme();
  const [places, setPlaces] = useState<Place[]>([]);
  const [loading, setLoading] = useState(true);
  const [isModalVisible, setModalVisible] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [fetchingLocation, setFetchingLocation] = useState(false);
  const [confirmDialog, setConfirmDialog] = useState<{
    visible: boolean;
    title: string;
    message: string;
    confirmText: string;
    isDestructive: boolean;
    onConfirm: () => void;
  } | null>(null);

  // Form state
  const [editId, setEditId] = useState('');
  const [name, setName] = useState('');
  const [category, setCategory] = useState<PlaceCategory>('other');
  const [note, setNote] = useState('');
  const [latitude, setLatitude] = useState<number | null>(null);
  const [longitude, setLongitude] = useState<number | null>(null);
  const [address, setAddress] = useState('');
  const [photoUri, setPhotoUri] = useState<string | undefined>(undefined);
  const [photoBase64, setPhotoBase64] = useState<string | undefined>(undefined);
  const [showMapPicker, setShowMapPicker] = useState(false);

  const loadPlaces = useCallback(async (forceFresh = false) => {
    try {
      // Show cached data instantly
      if (!forceFresh) {
        const cached = await getCached<Place[]>(CACHE_KEYS.PLACES);
        if (cached) {
          setPlaces(cached.data);
          setLoading(false);

          // Skip network call if cache is fresh
          if (!cached.isStale) return;
        }
      }

      // Then fetch from cloud
      const data = await getPlaces();
      setPlaces(data);
      setCache(CACHE_KEYS.PLACES, data);
    } catch (error) {
      console.error('Failed to load places:', error);
      Toast.show({ type: 'error', text1: 'Failed to load places' });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadPlaces();
  }, [loadPlaces]);

  const requestLocationPermission = async (): Promise<boolean> => {
    if (Platform.OS === 'android') {
      const granted = await PermissionsAndroid.request(
        PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
        {
          title: 'Location Permission',
          message: 'VaultApp needs your location to pin this place on the map.',
          buttonPositive: 'Allow',
          buttonNegative: 'Deny',
        }
      );
      return granted === PermissionsAndroid.RESULTS.GRANTED;
    }
    return true;
  };

  const getCurrentLocation = async () => {
    const hasPermission = await requestLocationPermission();
    if (!hasPermission) {
      Toast.show({ type: 'error', text1: 'Location permission denied' });
      return;
    }

    setFetchingLocation(true);
    Geolocation.getCurrentPosition(
      async (position) => {
        const { latitude: lat, longitude: lng } = position.coords;
        setLatitude(lat);
        setLongitude(lng);

        // Try reverse geocoding via Nominatim (free, no API key)
        try {
          const res = await fetch(
            `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json&addressdetails=1`,
            { headers: { 'User-Agent': 'VaultApp/1.0' } }
          );
          const json = await res.json();
          if (json.display_name) {
            setAddress(json.display_name);
          }
        } catch {
          // Silently fail — we still have coordinates
        }

        setFetchingLocation(false);
        Toast.show({ type: 'success', text1: 'Location pinned!' });
      },
      (error) => {
        setFetchingLocation(false);
        console.error('Location error:', error);
        Toast.show({ type: 'error', text1: 'Could not get location', text2: error.message });
      },
      { 
        enableHighAccuracy: true,
        accuracy: { android: 'high', ios: 'best' },
        timeout: 20000, 
        maximumAge: 10000
      }
    );
  };

  const takePhoto = async () => {
    try {
      if (Platform.OS === 'android') {
        const granted = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.CAMERA);
        if (granted !== PermissionsAndroid.RESULTS.GRANTED) {
          Toast.show({ type: 'error', text1: 'Camera permission denied' });
          return;
        }
      }
      const result = await launchCamera({ mediaType: 'photo', quality: 0.7, maxWidth: 1200, maxHeight: 1200, includeBase64: true });
      if (result.assets && result.assets[0]?.uri) {
        setPhotoUri(result.assets[0].uri);
        setPhotoBase64(result.assets[0].base64 || undefined);
        Toast.show({ type: 'success', text1: 'Photo captured! 📸' });
      }
    } catch (e: any) {
      Toast.show({ type: 'error', text1: 'Camera error', text2: e.message });
    }
  };

  const handleSave = async () => {
    if (!name.trim()) {
      Toast.show({ type: 'error', text1: 'Name is required' });
      return;
    }

    setSaving(true);
    try {
      let finalPhotoUri = photoUri;
      if (photoBase64) {
        Toast.show({ type: 'info', text1: 'Uploading photo...' });
        finalPhotoUri = await uploadPlacePhoto(photoBase64);
      } else if (photoUri && (photoUri.startsWith('file://') || photoUri.startsWith('content://'))) {
        Toast.show({ type: 'info', text1: 'Uploading photo...' });
        finalPhotoUri = await uploadPlacePhoto(undefined, photoUri);
      }

      const placeData = {
        name: name.trim(),
        category,
        note: note.trim(),
        location: latitude && longitude ? { latitude, longitude, address: address || undefined } : undefined,
        photo_uri: finalPhotoUri,
      };

      if (isEditing) {
        const updatedPlace = await updatePlace(editId, placeData);
        setPlaces(prev => prev.map(place => place.id === editId ? updatedPlace : place));
        await updateCache<Place[]>(CACHE_KEYS.PLACES, current =>
          current ? current.map(place => place.id === editId ? updatedPlace : place) : [updatedPlace]
        );
        Toast.show({ type: 'success', text1: 'Place updated!' });
      } else {
        const createdPlace = await addPlace(placeData);
        setPlaces(prev => [createdPlace, ...prev]);
        await updateCache<Place[]>(CACHE_KEYS.PLACES, current => [createdPlace, ...(current || [])]);
        Toast.show({ type: 'success', text1: 'Place saved to cloud! ☁️' });
      }

      loadPlaces(true).catch(error => console.error('Failed to refresh places after save:', error));
      closeModal();
    } catch (error: any) {
      console.error('Save error:', error);
      Toast.show({ type: 'error', text1: 'Failed to save', text2: error.message });
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = (placeId: string, placeName: string) => {
    setConfirmDialog({
      visible: true,
      title: 'Delete Place',
      message: `Delete "${placeName}"? This will remove it from the cloud permanently.`,
      confirmText: 'Delete',
      isDestructive: true,
      onConfirm: async () => {
        setConfirmDialog(null);
        try {
          setPlaces(prev => prev.filter(place => place.id !== placeId));
          await updateCache<Place[]>(CACHE_KEYS.PLACES, current =>
            current ? current.filter(place => place.id !== placeId) : current
          );
          await deletePlace(placeId);
          loadPlaces(true).catch(error => console.error('Failed to refresh places after delete:', error));
          Toast.show({ type: 'info', text1: 'Place removed' });
        } catch (error: any) {
          await loadPlaces(true);
          Toast.show({ type: 'error', text1: 'Delete failed', text2: error.message });
        }
      },
    });
  };

  const openModal = (place?: Place) => {
    if (place) {
      setIsEditing(true);
      setEditId(place.id);
      setName(place.name);
      setCategory(place.category);
      setNote(place.note);
      setLatitude(place.location?.latitude ?? null);
      setLongitude(place.location?.longitude ?? null);
      setAddress(place.location?.address ?? '');
      setPhotoUri(place.photo_uri);
      setPhotoBase64(undefined);
    } else {
      setIsEditing(false);
      setEditId('');
      setName('');
      setCategory('other');
      setNote('');
      setLatitude(null);
      setLongitude(null);
      setAddress('');
      setPhotoUri(undefined);
      setPhotoBase64(undefined);
    }
    setModalVisible(true);
  };

  const closeModal = () => {
    setModalVisible(false);
  };

  const openInMaps = (lat: number, lng: number, placeName: string) => {
    const url = Platform.select({
      android: `geo:${lat},${lng}?q=${lat},${lng}(${encodeURIComponent(placeName)})`,
      ios: `maps:?q=${encodeURIComponent(placeName)}&ll=${lat},${lng}`,
    });
    if (url) Linking.openURL(url);
  };

  const renderItem = ({ item }: { item: Place }) => {
    const cat = CATEGORY_MAP[item.category] || CATEGORY_MAP.other;
    const hasLocation = item.location?.latitude && item.location?.longitude;

    return (
      <View style={[styles.placeCard, { backgroundColor: colors.card, borderRadius: borderRadius.lg }]}>
        {/* Photo thumbnail if available */}
        {item.photo_uri && (
          <Image source={{ uri: item.photo_uri }} style={[styles.photoThumb, { borderRadius: borderRadius.md }]} />
        )}
        <TouchableOpacity
          activeOpacity={0.7}
          onPress={() => {
            if (hasLocation) {
              openInMaps(item.location!.latitude, item.location!.longitude, item.name);
            } else {
              Toast.show({ type: 'info', text1: 'No location saved', text2: 'Tap the edit icon to add a location.' });
            }
          }}
          style={{ flexDirection: 'row', flex: 1, alignItems: 'center' }}
        >
          <View style={[styles.iconCircle, { backgroundColor: cat.color + '18' }]}>  
            <MaterialCommunityIcons name={cat.icon} size={22} color={cat.color} />
          </View>
          <View style={styles.cardContent}>
            <Text style={[typography.bodyBold, { color: colors.text, fontSize: 15 }]}>{item.name}</Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 3, gap: 6 }}>
              <View style={[styles.categoryBadge, { backgroundColor: cat.color + '15' }]}>
                <Text style={{ color: cat.color, fontSize: 11, fontWeight: '600' }}>{cat.label}</Text>
              </View>
              {hasLocation && (
                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                  <MaterialCommunityIcons name="map-marker" size={13} color={colors.accent} />
                  <Text style={{ color: colors.accent, fontSize: 11, marginLeft: 2 }}>Map</Text>
                </View>
              )}
            </View>
            {item.note ? (
              <Text style={{ color: colors.subtext, fontSize: 12, marginTop: 4 }} numberOfLines={1}>
                {item.note}
              </Text>
            ) : null}
            {/* Street View link */}
            {hasLocation && (
              <TouchableOpacity
                onPress={() => {
                  const url = `https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${item.location!.latitude},${item.location!.longitude}`;
                  Linking.openURL(url);
                }}
                style={{ flexDirection: 'row', alignItems: 'center', marginTop: 4 }}
              >
                <MaterialCommunityIcons name="google-street-view" size={13} color="#f59e0b" />
                <Text style={{ color: '#f59e0b', fontSize: 11, marginLeft: 3 }}>Street View</Text>
              </TouchableOpacity>
            )}
          </View>
        </TouchableOpacity>
        <View style={{ flexDirection: 'column', alignItems: 'center', gap: 10 }}>
          <TouchableOpacity onPress={() => openModal(item)} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
            <MaterialCommunityIcons name="pencil-outline" size={18} color={colors.subtext} />
          </TouchableOpacity>
          <TouchableOpacity onPress={() => handleDelete(item.id, item.name)} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
            <MaterialCommunityIcons name="trash-can-outline" size={18} color="#ef4444" />
          </TouchableOpacity>
        </View>
      </View>
    );
  };

  return (
    <ScreenWrapper>
      <AppHeader title="My Places" showBack />

      {loading ? (
        <View style={styles.centerContainer}>
          <ActivityIndicator size="large" color={colors.accent} />
        </View>
      ) : places.length === 0 ? (
        <View style={styles.centerContainer}>
          <View style={[styles.emptyIcon, { backgroundColor: colors.accent + '15' }]}>
            <MaterialCommunityIcons name="map-marker-star" size={48} color={colors.accent} />
          </View>
          <Text style={[typography.h3, { color: colors.text, textAlign: 'center', marginTop: spacing.lg }]}>
            No places saved yet
          </Text>
          <Text style={{ color: colors.subtext, textAlign: 'center', marginTop: spacing.sm, paddingHorizontal: 32, lineHeight: 20 }}>
            Found a good EV charger, cheap shop, or hidden cafe? Tap + to save it so you never forget!
          </Text>
        </View>
      ) : (
        <FlatList
          data={places}
          keyExtractor={item => item.id}
          renderItem={renderItem}
          contentContainerStyle={{ padding: spacing.lg, paddingBottom: 100 }}
          showsVerticalScrollIndicator={false}
        />
      )}

      {/* FAB */}
      <TouchableOpacity
        style={[styles.fab, { backgroundColor: colors.accent }]}
        activeOpacity={0.8}
        onPress={() => openModal()}
      >
        <MaterialCommunityIcons name="plus" size={28} color="#fff" />
      </TouchableOpacity>

      {/* Add/Edit Modal */}
      <Modal visible={isModalVisible} animationType="slide" transparent statusBarTranslucent>
        <View style={styles.modalOverlay}>
          <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
            style={[styles.modalContent, { backgroundColor: colors.background }]}
          >
            {/* Header */}
            <View style={styles.modalHeader}>
              <Text style={[typography.h2, { color: colors.text }]}>
                {isEditing ? 'Edit Place' : 'Save New Place'}
              </Text>
              <TouchableOpacity onPress={closeModal}>
                <MaterialCommunityIcons name="close" size={24} color={colors.subtext} />
              </TouchableOpacity>
            </View>

            <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 40 }}>

              {/* Name input */}
              <TextInput
                style={[styles.input, { backgroundColor: colors.card, color: colors.text, borderColor: colors.border, borderRadius: borderRadius.md }]}
                placeholder="Place name (e.g., Sasta EV Charger)"
                placeholderTextColor={colors.subtext + '90'}
                value={name}
                onChangeText={setName}
              />

              {/* Category chips */}
              <Text style={{ color: colors.subtext, fontSize: 13, fontWeight: '500', marginTop: spacing.lg, marginBottom: spacing.sm }}>Category</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: spacing.md }}>
                {CATEGORIES.map(cat => {
                  const isSelected = category === cat;
                  const catData = CATEGORY_MAP[cat];
                  return (
                    <TouchableOpacity
                      key={cat}
                      onPress={() => setCategory(cat)}
                      style={[
                        styles.categoryChip,
                        {
                          backgroundColor: isSelected ? catData.color + '20' : colors.card,
                          borderColor: isSelected ? catData.color : colors.border,
                          borderRadius: borderRadius.full,
                        }
                      ]}
                    >
                      <MaterialCommunityIcons name={catData.icon} size={16} color={isSelected ? catData.color : colors.subtext} />
                      <Text style={{ color: isSelected ? catData.color : colors.subtext, marginLeft: 6, fontWeight: isSelected ? '600' : '400', fontSize: 13 }}>
                        {catData.label}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>

              {/* Location pin */}
              <Text style={{ color: colors.subtext, fontSize: 13, fontWeight: '500', marginBottom: spacing.sm }}>Location</Text>
              <TouchableOpacity
                onPress={getCurrentLocation}
                disabled={fetchingLocation}
                style={[styles.locationButton, { backgroundColor: colors.card, borderColor: latitude ? '#10b981' : colors.border, borderRadius: borderRadius.md }]}
              >
                {fetchingLocation ? (
                  <ActivityIndicator size="small" color={colors.accent} />
                ) : (
                  <MaterialCommunityIcons
                    name={latitude ? 'map-marker-check' : 'crosshairs-gps'}
                    size={22}
                    color={latitude ? '#10b981' : colors.accent}
                  />
                )}
                <View style={{ flex: 1, marginLeft: 12 }}>
                  {latitude ? (
                    <>
                      <Text style={{ color: '#10b981', fontSize: 13, fontWeight: '600' }}>Location Pinned ✓</Text>
                      <Text style={{ color: colors.subtext, fontSize: 11, marginTop: 2 }} numberOfLines={1}>
                        {address || `${latitude.toFixed(4)}, ${longitude?.toFixed(4)}`}
                      </Text>
                    </>
                  ) : (
                    <>
                      <Text style={{ color: colors.text, fontSize: 14, fontWeight: '500' }}>Pin Current Location</Text>
                      <Text style={{ color: colors.subtext, fontSize: 11, marginTop: 2 }}>Uses GPS to save where you are</Text>
                    </>
                  )}
                </View>
                {latitude && (
                  <TouchableOpacity onPress={() => { setLatitude(null); setLongitude(null); setAddress(''); }}>
                    <MaterialCommunityIcons name="close-circle" size={20} color={colors.subtext} />
                  </TouchableOpacity>
                )}
              </TouchableOpacity>

              {/* Adjust on Map button - only shown when location is pinned */}
              {latitude && longitude && (
                <TouchableOpacity
                  onPress={() => setShowMapPicker(true)}
                  style={[styles.locationButton, { backgroundColor: colors.card, borderColor: colors.accent, borderRadius: borderRadius.md, marginTop: 8 }]}
                >
                  <MaterialCommunityIcons name="map-search" size={22} color={colors.accent} />
                  <View style={{ flex: 1, marginLeft: 12 }}>
                    <Text style={{ color: colors.accent, fontSize: 14, fontWeight: '600' }}>Adjust on Map</Text>
                    <Text style={{ color: colors.subtext, fontSize: 11, marginTop: 2 }}>Drag pin to exact location — Satellite view available</Text>
                  </View>
                  <MaterialCommunityIcons name="chevron-right" size={20} color={colors.accent} />
                </TouchableOpacity>
              )}

              {/* Photo */}
              <Text style={{ color: colors.subtext, fontSize: 13, fontWeight: '500', marginTop: spacing.lg, marginBottom: spacing.sm }}>Photo</Text>
              {photoUri ? (
                <View style={{ borderRadius: borderRadius.md, overflow: 'hidden', marginBottom: 4 }}>
                  <Image source={{ uri: photoUri }} style={{ width: '100%', height: 160, borderRadius: borderRadius.md }} resizeMode="cover" />
                  <TouchableOpacity
                    onPress={() => { setPhotoUri(undefined); setPhotoBase64(undefined); }}
                    style={{ position: 'absolute', top: 8, right: 8, backgroundColor: 'rgba(0,0,0,0.6)', borderRadius: 14, width: 28, height: 28, justifyContent: 'center', alignItems: 'center' }}
                  >
                    <MaterialCommunityIcons name="close" size={16} color="#fff" />
                  </TouchableOpacity>
                </View>
              ) : (
                <TouchableOpacity
                  onPress={takePhoto}
                  style={[styles.locationButton, { backgroundColor: colors.card, borderColor: colors.border, borderRadius: borderRadius.md }]}
                >
                  <MaterialCommunityIcons name="camera-plus" size={22} color={colors.accent} />
                  <View style={{ flex: 1, marginLeft: 12 }}>
                    <Text style={{ color: colors.text, fontSize: 14, fontWeight: '500' }}>Take Photo</Text>
                    <Text style={{ color: colors.subtext, fontSize: 11, marginTop: 2 }}>Take a photo of the place for easy identification</Text>
                  </View>
                </TouchableOpacity>
              )}

              {/* Notes */}
              <TextInput
                style={[styles.input, styles.textArea, { backgroundColor: colors.card, color: colors.text, borderColor: colors.border, borderRadius: borderRadius.md, marginTop: spacing.lg }]}
                placeholder="Notes — why is this place special?"
                placeholderTextColor={colors.subtext + '90'}
                value={note}
                onChangeText={setNote}
                multiline
                textAlignVertical="top"
              />

              {/* Save button */}
              <TouchableOpacity
                onPress={handleSave}
                disabled={saving}
                style={[styles.saveButton, { backgroundColor: colors.accent, borderRadius: borderRadius.md, opacity: saving ? 0.7 : 1 }]}
              >
                {saving ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <>
                    <MaterialCommunityIcons name="cloud-upload" size={20} color="#fff" style={{ marginRight: 8 }} />
                    <Text style={{ color: '#fff', fontSize: 16, fontWeight: '700' }}>
                      {isEditing ? 'Update Place' : 'Save to Cloud'}
                    </Text>
                  </>
                )}
              </TouchableOpacity>
            </ScrollView>
          </KeyboardAvoidingView>
          <Toast autoHide visibilityTime={3000} swipeable={false} onPress={() => Toast.hide()} />
        </View>
      </Modal>

      {/* Confirm Dialog */}
      {confirmDialog && (
        <AppConfirmModal
          visible={confirmDialog.visible}
          title={confirmDialog.title}
          message={confirmDialog.message}
          confirmText={confirmDialog.confirmText}
          isDestructive={confirmDialog.isDestructive}
          onConfirm={confirmDialog.onConfirm}
          onCancel={() => setConfirmDialog(null)}
        />
      )}

      {/* Map Picker */}
      {showMapPicker && latitude && longitude && (
        <MapPickerModal
          visible={showMapPicker}
          initialLatitude={latitude}
          initialLongitude={longitude}
          placeName={name}
          onConfirm={async (lat, lng) => {
            setLatitude(lat);
            setLongitude(lng);
            setShowMapPicker(false);
            // Reverse geocode the new position
            try {
              const res = await fetch(
                `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json&addressdetails=1`,
                { headers: { 'User-Agent': 'VaultApp/1.0' } }
              );
              const json = await res.json();
              if (json.display_name) setAddress(json.display_name);
            } catch {}
            Toast.show({ type: 'success', text1: 'Location adjusted! ✓' });
          }}
          onCancel={() => setShowMapPicker(false)}
        />
      )}
    </ScreenWrapper>
  );
}

const styles = StyleSheet.create({
  centerContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
  },
  emptyIcon: {
    width: 96,
    height: 96,
    borderRadius: 48,
    justifyContent: 'center',
    alignItems: 'center',
  },
  placeCard: {
    flexDirection: 'row',
    padding: 14,
    marginBottom: 10,
    alignItems: 'center',
  },
  photoThumb: {
    width: 56,
    height: 56,
    marginRight: 10,
  },
  iconCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 14,
  },
  cardContent: {
    flex: 1,
  },
  categoryBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
  },
  fab: {
    position: 'absolute',
    bottom: 24,
    right: 20,
    width: 56,
    height: 56,
    borderRadius: 28,
    justifyContent: 'center',
    alignItems: 'center',
    elevation: 6,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 24,
    maxHeight: '92%',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
  },
  input: {
    borderWidth: 1,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 15,
  },
  textArea: {
    height: 90,
  },
  categoryChip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderWidth: 1,
    marginRight: 8,
  },
  locationButton: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 14,
    borderWidth: 1.5,
    borderStyle: 'dashed',
  },
  saveButton: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 16,
    marginTop: 20,
  },
});
