import React, { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Alert } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';

import Geolocation from 'react-native-geolocation-service';
import { useTheme } from '../../context/ThemeContext';
import { ScreenWrapper, AppHeader, Card, AppInput, AppButton } from '../../components';
import { PlaceReminder, savePlaceReminder, TriggerType, ScheduleType } from '../../lib/services/placeReminders';
import { supabase } from '../../lib/core';

export default function EditPlaceReminderScreen() {
  const navigation = useNavigation();
  const route = useRoute<any>();
  const { colors, typography, spacing } = useTheme();
  
  const existingReminder = route.params?.reminder as PlaceReminder | undefined;

  const [title, setTitle] = useState(existingReminder?.title || '');
  const [note, setNote] = useState(existingReminder?.note || '');
  const [address, setAddress] = useState(existingReminder?.address || '');
  const [radius, setRadius] = useState(existingReminder?.radius_meters.toString() || '100');
  const [triggerType, setTriggerType] = useState<TriggerType>(existingReminder?.trigger_type || 'arriving');
  const [scheduleType] = useState<ScheduleType>(existingReminder?.schedule_type || 'always');
  const [isOneTime, setIsOneTime] = useState(existingReminder ? existingReminder.is_one_time : true);
  const [latitude, setLatitude] = useState<number | null>(existingReminder?.latitude || null);
  const [longitude, setLongitude] = useState<number | null>(existingReminder?.longitude || null);
  const [loading, setLoading] = useState(false);

  const handleUseCurrentLocation = () => {
    Geolocation.getCurrentPosition(
      (position) => {
        setLatitude(position.coords.latitude);
        setLongitude(position.coords.longitude);
        if (!address) {
          setAddress('Current Location');
        }
        Alert.alert('Location Captured', 'Current location has been captured successfully.');
      },
      (error) => {
        console.warn(error.code, error.message);
        Alert.alert('Location Error', 'Unable to fetch current location. Please ensure location permissions are granted.');
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 10000 }
    );
  };

  const handleSave = async () => {
    if (!title.trim() || !address.trim() || !radius || !latitude || !longitude) {
      Alert.alert('Missing Fields', 'Please fill in title, address, and capture a location.');
      return;
    }

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
        radius_meters: parseInt(radius, 10),
        trigger_type: triggerType,
        schedule_type: scheduleType,
        is_one_time: isOneTime,
        is_enabled: existingReminder ? existingReminder.is_enabled : true,
        created_at: existingReminder?.created_at || new Date().toISOString(),
        last_triggered_at: existingReminder?.last_triggered_at,
      };

      await savePlaceReminder(reminder);
      navigation.goBack();
    } catch (error) {
      console.warn(error);
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
    <ScreenWrapper>
      <AppHeader title={existingReminder ? 'Edit Reminder' : 'New Place Reminder'} showBack />
      
      <ScrollView contentContainerStyle={{ padding: spacing.md, paddingBottom: 100 }}>
        <Card style={{ padding: spacing.md, marginBottom: spacing.md }}>
          <Text style={[typography.h3, { color: colors.text, marginBottom: spacing.md }]}>Details</Text>
          <AppInput
            placeholder="E.g., Hospital file, Buy milk"
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
            placeholder="Place name or address"
            value={address}
            onChangeText={setAddress}
            containerStyle={{ marginBottom: spacing.md }}
          />
          <View style={styles.locationCapture}>
            <View style={{ flex: 1, marginRight: spacing.md }}>
              <Text style={[typography.caption, { color: colors.subtext }]}>
                {latitude && longitude ? `Lat: ${latitude.toFixed(4)}, Lng: ${longitude.toFixed(4)}` : 'No coordinates captured'}
              </Text>
            </View>
            <AppButton
              title={latitude ? "Update" : "Capture Here"}
              variant="secondary"
              onPress={handleUseCurrentLocation}
              style={{ minWidth: 100 }}
            />
          </View>
        </Card>

        <Card style={{ padding: spacing.md, marginBottom: spacing.md }}>
          <Text style={[typography.h3, { color: colors.text, marginBottom: spacing.md }]}>Triggers</Text>
          
          <Text style={[typography.caption, { color: colors.text, marginBottom: 8 }]}>Radius (meters)</Text>
          <View style={styles.optionsRow}>
            {renderOption('100m', radius === '100', () => setRadius('100'))}
            {renderOption('500m', radius === '500', () => setRadius('500'))}
            {renderOption('1km', radius === '1000', () => setRadius('1000'))}
          </View>

          <Text style={[typography.caption, { color: colors.text, marginTop: 16, marginBottom: 8 }]}>When</Text>
          <View style={styles.optionsRow}>
            {renderOption('Arriving', triggerType === 'arriving', () => setTriggerType('arriving'))}
          </View>

          <Text style={[typography.caption, { color: colors.text, marginTop: 16, marginBottom: 8 }]}>Repeat</Text>
          <View style={styles.optionsRow}>
            {renderOption('Once', isOneTime, () => setIsOneTime(true))}
            {renderOption('Repeat', !isOneTime, () => setIsOneTime(false))}
          </View>
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
  },
});
