import React, { useState, useEffect, useRef } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Alert } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';

import Geolocation from 'react-native-geolocation-service';
import { useTheme } from '../../context/ThemeContext';
import { ScreenWrapper, AppHeader, Card, AppInput, AppButton } from '../../components';
import { PlaceReminder, savePlaceReminder, TriggerType, ScheduleType } from '../../lib/services/placeReminders';
import { supabase } from '../../lib/core';

export default function EditPlaceReminderScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const { colors, typography, spacing } = useTheme();
  
  const existingReminder = route.params?.reminder as PlaceReminder | undefined;
  if (__DEV__) console.log('[EditPlaceReminderScreen] Rendered', {
    existingReminderId: existingReminder?.id, 
    hasSelectedLocation: !!route.params?.selectedLocation,
    params: route.params 
  });

  const [title, setTitle] = useState(existingReminder?.title || '');
  const [note, setNote] = useState(existingReminder?.note || '');
  const [address, setAddress] = useState(existingReminder?.address || '');
  const [radiusOption, setRadiusOption] = useState<string>(existingReminder ? existingReminder.radius_meters.toString() : '100');
  const [customRadius, setCustomRadius] = useState<string>('');
  const [triggerType, setTriggerType] = useState<TriggerType>(existingReminder?.trigger_type || 'arriving');
  const [scheduleType] = useState<ScheduleType>(existingReminder?.schedule_type || 'always');
  const [intensity, setIntensity] = useState<'normal' | 'important'>(existingReminder?.intensity || 'normal');
  const [isOneTime, setIsOneTime] = useState(existingReminder ? existingReminder.is_one_time : true);
  const [latitude, setLatitude] = useState<number | null>(existingReminder?.latitude || null);
  const [longitude, setLongitude] = useState<number | null>(existingReminder?.longitude || null);
  const [locationAccuracy, setLocationAccuracy] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const appliedLocationRef = useRef<string | null>(null);

  useEffect(() => {
    const loc = route.params?.selectedLocation;
    if (!loc) return;

    // Deduplicate: skip if we already applied this exact location
    const locationKey = `${loc.latitude},${loc.longitude}`;
    if (appliedLocationRef.current === locationKey) return;
    appliedLocationRef.current = locationKey;

    if (__DEV__) console.log('[EditPlaceReminderScreen] 📍 REMINDER LOCATION SET (from map):', {
      lat: loc.latitude.toFixed(6),
      lon: loc.longitude.toFixed(6),
      label: loc.label,
    });
    setLatitude(loc.latitude);
    setLongitude(loc.longitude);
    setLocationAccuracy(null); // Map pins don't have accuracy
    if (loc.label && loc.label !== 'Selected location') {
      setAddress(loc.label);
    }
  }, [route.params?.selectedLocation]);

  const handleUseCurrentLocation = () => {
    if (__DEV__) console.log('[EditPlaceReminderScreen] handleUseCurrentLocation called');
    Geolocation.getCurrentPosition(
      (position) => {
        const userLat = position.coords.latitude;
        const userLon = position.coords.longitude;
        const acc = position.coords.accuracy;
        if (__DEV__) console.log('[EditPlaceReminderScreen] 📍 USER CURRENT LOCATION captured:', {
          lat: userLat.toFixed(6),
          lon: userLon.toFixed(6),
          accuracy: Math.round(acc) + 'm',
        });
        setLatitude(userLat);
        setLongitude(userLon);
        setLocationAccuracy(acc);
        if (!address) {
          setAddress('Current Location');
        }
        Alert.alert('Location Captured', 'Current location has been captured successfully.');
      },
      (error) => {
        if (__DEV__) console.warn('[EditPlaceReminderScreen] Location fetch error:', error.code, error.message);
        Alert.alert('Location Error', 'Unable to fetch current location. Please ensure location permissions are granted.');
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 10000 }
    );
  };

  const handleSave = async () => {
    if (__DEV__) console.log('[EditPlaceReminderScreen] handleSave called with state:', { title, address, latitude, longitude, radiusOption, customRadius, triggerType, intensity, isOneTime });
    let finalRadius = parseInt(radiusOption, 10);
    if (radiusOption === 'custom') {
      finalRadius = parseInt(customRadius, 10);
    }
    if (__DEV__) console.log('[EditPlaceReminderScreen] Calculated finalRadius:', finalRadius);

    if (!title.trim()) {
      Alert.alert('Missing Field', 'Add a reminder title.');
      return;
    }
    if (!latitude || !longitude) {
      Alert.alert('Missing Field', 'Choose or capture a location.');
      return;
    }
    if (isNaN(finalRadius) || finalRadius < 50 || finalRadius > 50000) {
      Alert.alert('Invalid Radius', 'Radius must be between 50 m and 50 km.');
      return;
    }

    if (__DEV__) console.log('[EditPlaceReminderScreen] Validation passed. Starting save...');
    setLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not logged in');

      const reminder: PlaceReminder = {
        id: existingReminder?.id || Date.now().toString(),
        user_id: user.id,
        title: title.trim(),
        note: note.trim(),
        address: address.trim(),
        latitude,
        longitude,
        radius_meters: finalRadius,
        trigger_type: triggerType,
        schedule_type: scheduleType,
        intensity,
        is_one_time: isOneTime,
        is_enabled: existingReminder ? existingReminder.is_enabled : true,
        created_at: existingReminder?.created_at || new Date().toISOString(),
        last_triggered_at: existingReminder?.last_triggered_at,
      };

      await savePlaceReminder(reminder);
      if (__DEV__) console.log('[EditPlaceReminderScreen] ✅ Reminder saved! Target location:', {
        reminderLat: latitude?.toFixed(6),
        reminderLon: longitude?.toFixed(6),
        radius: finalRadius + 'm',
        triggerType,
      });
      // Fetch user's current GPS to compare with reminder location
      Geolocation.getCurrentPosition(
        (pos) => {
          const userLat = pos.coords.latitude;
          const userLon = pos.coords.longitude;
          if (__DEV__) console.log('[EditPlaceReminderScreen] 📍 USER vs REMINDER location at save time:', {
            userLat: userLat.toFixed(6),
            userLon: userLon.toFixed(6),
            reminderLat: latitude?.toFixed(6),
            reminderLon: longitude?.toFixed(6),
            radius: finalRadius + 'm',
            approxDistanceNote: 'Check evaluateReminders logs for exact distance',
          });
        },
        () => { /* ignore error, this is just a debug log */ },
        { enableHighAccuracy: true, timeout: 5000, maximumAge: 0 }
      );
      navigation.goBack();
    } catch (error) {
      if (__DEV__) console.warn('[EditPlaceReminderScreen] Save error:', error);
      Alert.alert('Error', 'Failed to save reminder.');
    } finally {
      setLoading(false);
    }
  };

  const renderOption = (label: string, isSelected: boolean, onPress: () => void) => (
    <TouchableOpacity
      style={[
        styles.optionButton,
        {
          borderColor: isSelected ? colors.accent : colors.border,
          backgroundColor: isSelected ? `${colors.accent}15` : 'transparent'
        }
      ]}
      onPress={onPress}
    >
      <Text style={[typography.caption, { color: isSelected ? colors.accent : colors.subtext }]}>{label}</Text>
    </TouchableOpacity>
  );

  return (
    <ScreenWrapper keyboardAvoiding>
      <AppHeader title={existingReminder ? 'Edit Reminder' : 'New Place Reminder'} showBack />
      
      <ScrollView contentContainerStyle={{ padding: spacing.md, paddingBottom: 100 }}>
        <Card style={{ padding: spacing.md, marginBottom: spacing.md }}>
          <Text style={[typography.h3, { color: colors.text, marginBottom: spacing.md }]}>Details</Text>
          
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: spacing.md }}>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              {renderOption('Take something', title === 'Take ', () => setTitle('Take '))}
              {renderOption('Buy something', title === 'Buy ', () => setTitle('Buy '))}
              {renderOption('Do something', title === 'Do ', () => setTitle('Do '))}
              {renderOption('Custom', title === '', () => setTitle(''))}
            </View>
          </ScrollView>

          <AppInput
            placeholder="E.g., Take hospital file, Buy milk"
            value={title}
            onChangeText={setTitle}
            containerStyle={{ marginBottom: spacing.md }}
          />
          <AppInput
            placeholder="Extra notes (optional)"
            value={note}
            onChangeText={setNote}
            multiline
            containerStyle={{ marginBottom: spacing.md }}
          />
        </Card>

        <Card style={{ padding: spacing.md, marginBottom: spacing.md }}>
          <Text style={[typography.h3, { color: colors.text, marginBottom: spacing.md }]}>Location</Text>
          <AppInput
            placeholder="Place name or address (Optional)"
            value={address}
            onChangeText={setAddress}
            containerStyle={{ marginBottom: spacing.md }}
          />
          <View style={styles.locationCapture}>
            <View style={{ flex: 1, marginRight: spacing.md }}>
              <Text style={[typography.caption, { color: colors.text }]}>
                {latitude && longitude ? 'Location saved' : 'No coordinates captured'}
              </Text>
              {locationAccuracy && (
                <Text style={[typography.caption, { color: colors.subtext, fontSize: 10 }]}>
                  Accuracy: approx. {Math.round(locationAccuracy)} m
                </Text>
              )}
            </View>
            <View style={{ gap: spacing.sm }}>
              <AppButton
                title={latitude ? "Update current" : "Use current"}
                variant="secondary"
                onPress={handleUseCurrentLocation}
                style={{ minWidth: 140 }}
              />
              <AppButton
                title="Choose on map"
                variant="secondary"
                onPress={() => navigation.navigate('PlaceReminderMapPicker', { latitude, longitude })}
                style={{ minWidth: 140 }}
              />
            </View>
          </View>
        </Card>

        <Card style={{ padding: spacing.md, marginBottom: spacing.md }}>
          <Text style={[typography.h3, { color: colors.text, marginBottom: spacing.md }]}>Triggers</Text>
          
          <Text style={[typography.caption, { color: colors.text, marginBottom: 8 }]}>Radius (meters)</Text>
          <View style={styles.optionsRow}>
            {renderOption('100m', radiusOption === '100', () => setRadiusOption('100'))}
            {renderOption('500m', radiusOption === '500', () => setRadiusOption('500'))}
            {renderOption('1km', radiusOption === '1000', () => setRadiusOption('1000'))}
            {renderOption('Custom', radiusOption === 'custom', () => setRadiusOption('custom'))}
          </View>
          
          {radiusOption === 'custom' && (
            <AppInput
              placeholder="Custom radius (50 to 50000 meters)"
              value={customRadius}
              onChangeText={setCustomRadius}
              keyboardType="numeric"
              containerStyle={{ marginTop: spacing.sm }}
            />
          )}

          <Text style={[typography.caption, { color: colors.subtext, marginTop: 8, fontSize: 11 }]}>
            Smaller radius is useful for home or office. Larger radius is better for shops or areas.
          </Text>

          <Text style={[typography.caption, { color: colors.text, marginTop: 16, marginBottom: 8 }]}>When</Text>
          <View style={styles.optionsRow}>
            {renderOption('Arriving near this place', triggerType === 'arriving', () => setTriggerType('arriving'))}
            {renderOption('Leaving this place', triggerType === 'leaving', () => setTriggerType('leaving'))}
          </View>

          <Text style={[typography.caption, { color: colors.text, marginTop: 16, marginBottom: 8 }]}>Intensity</Text>
          <View style={styles.optionsRow}>
            {renderOption('Normal', intensity === 'normal', () => setIntensity('normal'))}
            {renderOption('Important', intensity === 'important', () => setIntensity('important'))}
          </View>

          <Text style={[typography.caption, { color: colors.text, marginTop: 16, marginBottom: 8 }]}>Repeat</Text>
          <View style={styles.optionsRow}>
            {renderOption('Once', isOneTime, () => setIsOneTime(true))}
            {renderOption('Repeat', !isOneTime, () => setIsOneTime(false))}
          </View>
          
          {!isOneTime && (
            <Text style={[typography.caption, { color: colors.subtext, marginTop: 8, fontSize: 11 }]}>
              Won't repeat for 30 minutes after alert.
            </Text>
          )}
        </Card>
      </ScrollView>

      <View style={[styles.footer, { padding: spacing.md, backgroundColor: colors.background, borderTopColor: colors.border }]}>
        <AppButton title="Save Reminder" onPress={handleSave} loading={loading} />
      </View>
    </ScreenWrapper>
  );
}

const styles = StyleSheet.create({
  optionsRow: {
    flexDirection: 'row',
    gap: 8,
  },
  optionButton: {
    flex: 1,
    paddingVertical: 8,
    borderWidth: 1,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  locationCapture: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  footer: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    borderTopWidth: 1,
    elevation: 10,
    zIndex: 10,
  },
});
