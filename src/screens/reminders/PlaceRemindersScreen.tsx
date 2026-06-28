import React, { useState, useCallback, useEffect } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity, Alert, Linking, Platform, AppState, AppStateStatus } from 'react-native';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';
import { useTheme } from '../../context/ThemeContext';
import { ScreenWrapper, AppHeader, Card, AppButton } from '../../components';
import { getPlaceReminders, deletePlaceReminder, PlaceReminder, savePlaceReminder, syncAllGeofences } from '../../lib/services/placeReminders';
import {
  requestPlaceReminderPermissions,
  requestBackgroundLocationPermission,
  checkPlaceReminderPermissions,
  PermissionStatus,
} from '../../lib/services/placeReminderPermissions';

export default function PlaceRemindersScreen() {
  const navigation = useNavigation<any>();
  const { colors, typography, spacing, borderRadius } = useTheme();
  const [reminders, setReminders] = useState<PlaceReminder[]>([]);
  const [loading, setLoading] = useState(true);
  const [backgroundPermissionStatus, setBackgroundPermissionStatus] = useState<PermissionStatus>('unknown');
  const hasCheckedBackgroundPermission = backgroundPermissionStatus !== 'unknown';
  const hasBackgroundPermission = backgroundPermissionStatus === 'granted';

  const checkPermissionsSilently = useCallback(async () => {
    try {
      const status = await checkPlaceReminderPermissions();
      if (__DEV__) console.log('[PlaceRemindersScreen] Permission check result:', status);
      setBackgroundPermissionStatus(status.backgroundLocation);
    } catch (error) {
      if (__DEV__) console.warn('[PlaceRemindersScreen] Permission check error:', error);
      setBackgroundPermissionStatus('denied');
    }
  }, []);

  const loadReminders = useCallback(async () => {
    if (__DEV__) console.log('[PlaceRemindersScreen] loadReminders called');
    setLoading(true);
    try {
      const data = await getPlaceReminders();
      if (__DEV__) console.log('[PlaceRemindersScreen] Loaded reminders:', { count: data.length, ids: data.map(r => r.id.slice(-6)), enabledCount: data.filter(r => r.is_enabled).length });
      setReminders(data);
    } catch (e) {
      if (__DEV__) console.warn('[PlaceRemindersScreen] loadReminders error:', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      if (__DEV__) console.log('[PlaceRemindersScreen] Screen focused — reloading reminders & checking permissions');
      loadReminders();
      checkPermissionsSilently();
    }, [loadReminders, checkPermissionsSilently])
  );

  useEffect(() => {
    const handleAppStateChange = async (nextAppState: AppStateStatus) => {
      if (__DEV__) console.log('[PlaceRemindersScreen] AppState changed to:', nextAppState);
      if (nextAppState === 'active') {
        await checkPermissionsSilently();
      }
    };

    const subscription = AppState.addEventListener('change', handleAppStateChange);
    return () => {
      subscription.remove();
    };
  }, [checkPermissionsSilently]);

  const handleEnableBackground = async () => {
    if (__DEV__) console.log('[PlaceRemindersScreen] handleEnableBackground — requesting background location');
    await requestPlaceReminderPermissions();
    const status = await requestBackgroundLocationPermission();
    if (__DEV__) console.log('[PlaceRemindersScreen] Background location result:', status);
    if (status === 'granted') {
      setBackgroundPermissionStatus('granted');
      await syncAllGeofences();
      Alert.alert('Success', 'Background reminders are now active.');
    } else {
      setBackgroundPermissionStatus(status);
      Alert.alert(
        'Location Permission Needed',
        'To wake the app in the background, please tap "Open Settings" below, then go to:\n\n1. Permissions\n2. Location\n3. Select "Allow all the time"',
        [
          { text: 'Cancel', style: 'cancel' },
          { 
            text: 'Open Settings', 
            onPress: async () => {
              if (Platform.OS === 'android') {
                try {
                  await Linking.sendIntent('android.intent.action.MANAGE_APP_PERMISSIONS', [
                    { key: 'android.intent.extra.PACKAGE_NAME', value: 'com.spendsense' }
                  ]);
                } catch {
                  Linking.openSettings();
                }
              } else {
                Linking.openSettings();
              }
            } 
          }
        ]
      );
    }
  };

  const handleDelete = (id: string) => {
    if (__DEV__) console.log('[PlaceRemindersScreen] handleDelete tapped for id suffix:', id.slice(-6));
    Alert.alert('Delete Reminder', 'Are you sure you want to delete this reminder?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          if (__DEV__) console.log('[PlaceRemindersScreen] Deleting reminder:', id.slice(-6));
          // Optimistic removal
          const previousReminders = reminders;
          setReminders(prev => prev.filter(r => r.id !== id));
          try {
            await deletePlaceReminder(id);
            if (__DEV__) console.log('[PlaceRemindersScreen] Deleted successfully.');
          } catch (error) {
            if (__DEV__) console.warn('[PlaceRemindersScreen] Delete failed, reverting:', error);
            setReminders(previousReminders);
          }
        },
      },
    ]);
  };

  const handleToggle = async (reminder: PlaceReminder) => {
    const newState = !reminder.is_enabled;
    if (__DEV__) console.log('[PlaceRemindersScreen] handleToggle:', { idSuffix: reminder.id.slice(-6), from: reminder.is_enabled, to: newState });

    // ── Optimistic UI update: toggle immediately so user sees instant feedback ──
    setReminders(prev =>
      prev.map(r => r.id === reminder.id ? { ...r, is_enabled: newState } : r)
    );

    try {
      // Heavy async work runs after UI has already updated
      await savePlaceReminder({ ...reminder, is_enabled: newState });
      if (__DEV__) console.log('[PlaceRemindersScreen] Toggle saved successfully.');
    } catch (error) {
      // Revert on failure
      if (__DEV__) console.warn('[PlaceRemindersScreen] Toggle error, reverting UI:', {
        error: error instanceof Error ? error.name : 'unknown',
      });
      setReminders(prev =>
        prev.map(r => r.id === reminder.id ? { ...r, is_enabled: reminder.is_enabled } : r)
      );
    }
  };

  const renderItem = ({ item }: { item: PlaceReminder }) => (
    <Card style={styles.card}>
      <View style={styles.cardHeader}>
        <View style={styles.titleContainer}>
          <Text style={[typography.h3, { color: colors.text }]}>{item.title}</Text>
          <Text style={[typography.caption, { color: colors.subtext }]}>{item.note}</Text>
        </View>
        <TouchableOpacity onPress={() => handleToggle(item)}>
          <MaterialCommunityIcons
            name={item.is_enabled ? 'bell-ring' : 'bell-off-outline'}
            size={24}
            color={item.is_enabled ? colors.accent : colors.subtext}
          />
        </TouchableOpacity>
      </View>
      <View style={styles.detailsContainer}>
        <View style={styles.detailRow}>
          <MaterialCommunityIcons name="map-marker-outline" size={16} color={colors.subtext} />
          <Text style={[typography.caption, { color: colors.subtext, marginLeft: 4 }]} numberOfLines={1}>
            {item.address || 'Unknown address'}
          </Text>
        </View>
        <View style={styles.detailRow}>
          <MaterialCommunityIcons name="radius-outline" size={16} color={colors.subtext} />
          <Text style={[typography.caption, { color: colors.subtext, marginLeft: 4 }]}>
            {item.radius_meters}m • {item.trigger_type}
          </Text>
        </View>
      </View>
      <View style={styles.actions}>
        <TouchableOpacity style={styles.actionBtn} onPress={() => handleDelete(item.id)}>
          <MaterialCommunityIcons name="trash-can-outline" size={20} color={colors.error} />
        </TouchableOpacity>
        <TouchableOpacity style={styles.actionBtn} onPress={() => navigation.navigate('EditPlaceReminder', { reminder: item })}>
          <MaterialCommunityIcons name="pencil-outline" size={20} color={colors.text} />
        </TouchableOpacity>
      </View>
    </Card>
  );

  return (
    <ScreenWrapper>
      <AppHeader title="Place Reminders" showBack />
      
      <View style={{ backgroundColor: colors.accent + '20', padding: spacing.sm, marginHorizontal: spacing.md, marginTop: spacing.md, borderRadius: borderRadius.md, flexDirection: 'row', alignItems: 'center' }}>
        <MaterialCommunityIcons name="information-outline" size={20} color={colors.accent} style={{ marginRight: spacing.sm }} />
        <Text style={[typography.caption, { color: colors.text, flex: 1 }]}>
          {!hasCheckedBackgroundPermission
            ? 'Checking place reminder permissions...'
            : hasBackgroundPermission
            ? 'Note: Place reminders work when the app is closed (Background Mode Active).'
            : 'Note: Place reminders are currently in a foreground-only MVP phase and will only trigger while the app is open and active.'}
        </Text>
      </View>
      
      {hasCheckedBackgroundPermission && !hasBackgroundPermission && (
        <View style={{ paddingHorizontal: spacing.md, marginTop: spacing.sm }}>
          <AppButton 
            title="Enable Background Reminders" 
            variant="secondary" 
            onPress={handleEnableBackground} 
          />
        </View>
      )}
      
      {reminders.length === 0 && !loading ? (
        <View style={styles.emptyContainer}>
          <MaterialCommunityIcons name="map-marker-radius-outline" size={64} color={colors.subtext} />
          <Text style={[typography.h3, { color: colors.text, marginTop: spacing.md }]}>No Reminders</Text>
          <Text style={[typography.body, { color: colors.subtext, textAlign: 'center', marginTop: spacing.sm, marginHorizontal: spacing.xl }]}>
            Get notified when you reach or pass a specific place. Add your first place reminder to get started.
          </Text>
        </View>
      ) : (
        <FlatList
          data={reminders}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          contentContainerStyle={{ padding: spacing.md, paddingBottom: 100 }}
        />
      )}

      <View style={[styles.fabContainer, { padding: spacing.md }]}>
        <AppButton
          title="+ Add Reminder"
          onPress={() => navigation.navigate('EditPlaceReminder')}
        />
      </View>
    </ScreenWrapper>
  );
}

const styles = StyleSheet.create({
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  fabContainer: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
  },
  card: {
    marginBottom: 12,
    padding: 16,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  titleContainer: {
    flex: 1,
    marginRight: 12,
  },
  detailsContainer: {
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: 'rgba(150,150,150,0.2)',
  },
  detailRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 4,
  },
  actions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    marginTop: 12,
  },
  actionBtn: {
    padding: 8,
    marginLeft: 8,
  },
});
