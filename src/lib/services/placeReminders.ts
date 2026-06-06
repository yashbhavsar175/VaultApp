import AsyncStorage from '@react-native-async-storage/async-storage';
import Geolocation from 'react-native-geolocation-service';
import notifee, { AndroidImportance } from '@notifee/react-native';
import { supabase } from '../core';
import { GeofencingNative, NativeGeofenceReminder } from './geofencingNative';

export type TriggerType = 'arriving' | 'leaving';
export type ScheduleType = 'today' | 'tomorrow' | 'always';

export interface PlaceReminder {
  id: string;
  user_id: string;
  title: string;
  note: string;
  address: string;
  latitude: number | null;
  longitude: number | null;
  radius_meters: number;
  trigger_type: TriggerType;
  schedule_type: ScheduleType;
  intensity?: 'normal' | 'important';
  is_one_time: boolean;
  is_enabled: boolean;
  created_at: string;
  last_triggered_at?: string | null;
}

const STORAGE_PREFIX = '@place_reminders_';
const COOLDOWN_MS = 30 * 60 * 1000; // 30 minutes cooldown

// Haversine formula
export function getDistanceMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371e3; // Earth radius in meters
  const φ1 = lat1 * Math.PI / 180;
  const φ2 = lat2 * Math.PI / 180;
  const Δφ = (lat2 - lat1) * Math.PI / 180;
  const Δλ = (lon2 - lon1) * Math.PI / 180;

  const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
            Math.cos(φ1) * Math.cos(φ2) *
            Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return R * c;
}

export async function getPlaceReminders(): Promise<PlaceReminder[]> {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      if (__DEV__) console.log('[PlaceReminders] getPlaceReminders: no user logged in');
      return [];
    }

    const key = `${STORAGE_PREFIX}${user.id}`;
    const stored = await AsyncStorage.getItem(key);
    if (!stored) {
      if (__DEV__) console.log('[PlaceReminders] getPlaceReminders: no stored data found');
      return [];
    }

    const parsed = JSON.parse(stored);
    if (__DEV__) console.log('[PlaceReminders] getPlaceReminders: loaded', { count: parsed.length });
    return parsed;
  } catch (error) {
    if (__DEV__) console.warn('[PlaceReminders] getPlaceReminders error', {
      errorCode: error instanceof Error ? error.name : 'unknown',
      message: error instanceof Error ? error.message : String(error),
    });
    return [];
  }
}

export async function savePlaceReminder(reminder: PlaceReminder): Promise<void> {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('No user logged in');

    const key = `${STORAGE_PREFIX}${user.id}`;
    const existing = await getPlaceReminders();
    
    const index = existing.findIndex(r => r.id === reminder.id);
    const isUpdate = index >= 0;
    if (isUpdate) {
      if (__DEV__) console.log('[PlaceReminders] savePlaceReminder: updating existing', { idSuffix: reminder.id.slice(-6), isEnabled: reminder.is_enabled });
      existing[index] = reminder;
    } else {
      if (__DEV__) console.log('[PlaceReminders] savePlaceReminder: creating new', { idSuffix: reminder.id.slice(-6), isEnabled: reminder.is_enabled });
      existing.push(reminder);
    }

    await AsyncStorage.setItem(key, JSON.stringify(existing));
    
    // Sync with native geofencing
    if (__DEV__) console.log('[PlaceReminders] savePlaceReminder: syncing geofences after save...');
    await syncAllGeofences();
    
    // Privacy log
    if (__DEV__) console.log('[PlaceReminders] Saved reminder', {
      reminderIdSuffix: reminder.id.slice(-6),
      radius: reminder.radius_meters,
      triggerType: reminder.trigger_type,
    });
  } catch (error) {
    if (__DEV__) console.warn('[PlaceReminders] savePlaceReminder error', {
      errorCode: error instanceof Error ? error.name : 'unknown',
      message: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

export async function deletePlaceReminder(id: string): Promise<void> {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const key = `${STORAGE_PREFIX}${user.id}`;
    const existing = await getPlaceReminders();
    const filtered = existing.filter(r => r.id !== id);
    if (__DEV__) console.log('[PlaceReminders] deletePlaceReminder:', { idSuffix: id.slice(-6), before: existing.length, after: filtered.length });
    
    await AsyncStorage.setItem(key, JSON.stringify(filtered));
    if (__DEV__) console.log('[PlaceReminders] deletePlaceReminder: syncing geofences after delete...');
    await syncAllGeofences();
  } catch (error) {
    if (__DEV__) console.warn('[PlaceReminders] deletePlaceReminder error', {
      errorCode: error instanceof Error ? error.name : 'unknown',
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

export async function syncAllGeofences() {
  try {
    const reminders = await getPlaceReminders();
    const activeGeofences: NativeGeofenceReminder[] = reminders
      .filter(r => r.is_enabled && r.latitude && r.longitude)
      .map(r => ({
        id: r.id,
        latitude: r.latitude!,
        longitude: r.longitude!,
        radius_meters: r.radius_meters,
        triggerType: r.trigger_type
      }));

    if (__DEV__) console.log('[PlaceReminders] syncAllGeofences:', { totalReminders: reminders.length, activeGeofences: activeGeofences.length, activeIds: activeGeofences.map(g => g.id.slice(-6)) });

    if (activeGeofences.length > 0) {
      await GeofencingNative.syncGeofences(activeGeofences);
      if (__DEV__) console.log('[PlaceReminders] syncAllGeofences: native sync done (registered)');
    } else {
      await GeofencingNative.clearGeofences();
      if (__DEV__) console.log('[PlaceReminders] syncAllGeofences: native sync done (cleared all)');
    }
  } catch (error) {
    if (__DEV__) console.warn('[PlaceReminders] syncAllGeofences error', {
      errorCode: error instanceof Error ? error.name : 'unknown',
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

async function triggerLocalNotification(reminder: PlaceReminder) {
  try {
    const isImportant = reminder.intensity === 'important';
    if (__DEV__) console.log('[PlaceReminders] triggerLocalNotification: firing ALARM for', { idSuffix: reminder.id.slice(-6), title: reminder.title, intensity: reminder.intensity });
    
    // Alarm-style channel: always HIGH importance for heads-up display
    const channelId = await notifee.createChannel({
      id: isImportant ? 'place_alarm_v3_important' : 'place_alarm_v3',
      name: isImportant ? '📍 Important Place Alarms' : '📍 Place Alarms',
      importance: AndroidImportance.HIGH,
      vibration: true,
      vibrationPattern: isImportant ? [300, 400, 200, 400, 200, 400] : [300, 300, 200, 300],
      sound: 'alarm',
    });

    // Alarm-style notification: full-screen intent, ongoing, looping sound
    await notifee.displayNotification({
      title: isImportant ? '🔔 Place Reminder!' : '📍 Place Reminder',
      body: reminder.title,
      android: {
        channelId,
        sound: 'alarm',
        loopSound: true,
        ongoing: true,
        autoCancel: false,
        importance: AndroidImportance.HIGH,
        pressAction: {
          id: 'default',
        },
        fullScreenAction: {
          id: 'default',
        },
        timestamp: Date.now(),
        showTimestamp: true,
      },
    });
    if (__DEV__) console.log('[PlaceReminders] 🔔 ALARM notification displayed successfully');

    // Update last_triggered_at and potentially disable if one_time
    reminder.last_triggered_at = new Date().toISOString();
    if (reminder.is_one_time) {
      if (__DEV__) console.log('[PlaceReminders] triggerLocalNotification: one-time reminder, disabling after trigger');
      reminder.is_enabled = false;
    }
    await savePlaceReminder(reminder);

    if (__DEV__) console.log('[PlaceReminders] Alarm triggered', {
      reminderIdSuffix: reminder.id.slice(-6),
    });
  } catch (error) {
    if (__DEV__) console.warn('[PlaceReminders] triggerLocalNotification error', {
      errorCode: error instanceof Error ? error.name : 'unknown',
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

export async function evaluateReminders(lat: number, lon: number, now: number = Date.now()) {
  try {
    const reminders = await getPlaceReminders();
    const activeReminders = reminders.filter(r => r.is_enabled && r.latitude && r.longitude);
    if (__DEV__) console.log('[PlaceReminders] evaluateReminders:', {
      userLat: lat.toFixed(6),
      userLon: lon.toFixed(6),
      totalReminders: reminders.length,
      activeReminders: activeReminders.length,
    });

    for (const reminder of reminders) {
      if (!reminder.is_enabled || !reminder.latitude || !reminder.longitude) {
        continue;
      }

      // Check schedule
      const createdDate = new Date(reminder.created_at);
      const today = new Date(now);
      
      if (reminder.schedule_type === 'today') {
        if (createdDate.toDateString() !== today.toDateString()) {
          if (__DEV__) console.log('[PlaceReminders] evaluateReminders: skipping (schedule=today, not today)', { idSuffix: reminder.id.slice(-6) });
          continue;
        }
      } else if (reminder.schedule_type === 'tomorrow') {
        const tomorrow = new Date(createdDate);
        tomorrow.setDate(tomorrow.getDate() + 1);
        if (tomorrow.toDateString() !== today.toDateString()) {
          if (__DEV__) console.log('[PlaceReminders] evaluateReminders: skipping (schedule=tomorrow, not tomorrow)', { idSuffix: reminder.id.slice(-6) });
          continue;
        }
      }

      // Check cooldown
      if (reminder.last_triggered_at) {
        const lastTriggered = new Date(reminder.last_triggered_at).getTime();
        if (now - lastTriggered < COOLDOWN_MS) {
          if (__DEV__) console.log('[PlaceReminders] evaluateReminders: skipping (cooldown active)', { idSuffix: reminder.id.slice(-6), cooldownRemaining: Math.round((COOLDOWN_MS - (now - lastTriggered)) / 1000) + 's' });
          continue; // In cooldown period
        }
      }

      const distance = getDistanceMeters(lat, lon, reminder.latitude, reminder.longitude);
      const isInside = distance <= reminder.radius_meters;
      if (__DEV__) console.log('[PlaceReminders] 📍 LOCATION COMPARISON:', {
        idSuffix: reminder.id.slice(-6),
        title: reminder.title,
        userLocation: { lat: lat.toFixed(6), lon: lon.toFixed(6) },
        reminderLocation: { lat: reminder.latitude.toFixed(6), lon: reminder.longitude.toFixed(6) },
        distance: Math.round(distance) + 'm',
        radius: reminder.radius_meters + 'm',
        status: isInside ? '🟢 INSIDE RADIUS' : '🔴 OUTSIDE RADIUS (' + Math.round(distance - reminder.radius_meters) + 'm away)',
        triggerType: reminder.trigger_type,
      });
      
      // Arriving: trigger when user enters the radius
      if (reminder.trigger_type === 'arriving' && isInside) {
        if (__DEV__) console.log('[PlaceReminders] 🔔 TRIGGERING ARRIVING reminder!', { idSuffix: reminder.id.slice(-6), title: reminder.title, distance: Math.round(distance) + 'm' });
        await triggerLocalNotification(reminder);
      }
      
      // Leaving: trigger when user exits the radius
      if (reminder.trigger_type === 'leaving' && !isInside) {
        if (__DEV__) console.log('[PlaceReminders] 🔔 TRIGGERING LEAVING reminder!', { idSuffix: reminder.id.slice(-6), title: reminder.title, distance: Math.round(distance) + 'm' });
        await triggerLocalNotification(reminder);
      }
    }
  } catch (error) {
    if (__DEV__) console.warn('[PlaceReminders] Error evaluating reminders', {
      errorCode: error instanceof Error ? error.name : 'unknown',
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

let watchId: number | null = null;
let positionUpdateCount = 0;
let lastUserLat: number | null = null;
let lastUserLon: number | null = null;

export function startLocationMonitoring() {
  if (watchId !== null) {
    if (__DEV__) console.log('[PlaceReminders] startLocationMonitoring: already watching, skipping');
    return; // Already watching
  }

  watchId = Geolocation.watchPosition(
    async (position) => {
      const lat = position.coords.latitude;
      const lon = position.coords.longitude;
      const acc = position.coords.accuracy;
      positionUpdateCount++;

      // Calculate movement from last position
      let movementInfo = 'first update';
      if (lastUserLat !== null && lastUserLon !== null) {
        const moved = getDistanceMeters(lastUserLat, lastUserLon, lat, lon);
        movementInfo = `moved ${Math.round(moved)}m from last`;
      }
      lastUserLat = lat;
      lastUserLon = lon;

      if (__DEV__) console.log('[PlaceReminders] 📍 USER POSITION UPDATE #' + positionUpdateCount + ':', {
        lat: lat.toFixed(6),
        lon: lon.toFixed(6),
        accuracy: Math.round(acc) + 'm',
        movement: movementInfo,
      });
      await evaluateReminders(lat, lon);
    },
    (error) => {
      if (__DEV__) console.warn('[PlaceReminders] Geolocation error', {
        errorCode: error.code,
        message: error.message,
      });
    },
    {
      enableHighAccuracy: true, // Improved for testing
      distanceFilter: 10, // Update every 10 meters
      interval: 10000, // Android only: 10 seconds
      fastestInterval: 5000,
    }
  );

  if (__DEV__) console.log('[PlaceReminders] Location monitoring started');
}

export function stopLocationMonitoring() {
  if (watchId !== null) {
    Geolocation.clearWatch(watchId);
    watchId = null;
    if (__DEV__) console.log('[PlaceReminders] Location monitoring stopped');
  }
}
