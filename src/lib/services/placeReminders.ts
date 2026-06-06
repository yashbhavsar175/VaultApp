import AsyncStorage from '@react-native-async-storage/async-storage';
import Geolocation from 'react-native-geolocation-service';
import notifee, { AndroidImportance } from '@notifee/react-native';
import { supabase } from '../core';

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
    if (!user) return [];

    const key = `${STORAGE_PREFIX}${user.id}`;
    const stored = await AsyncStorage.getItem(key);
    if (!stored) return [];

    return JSON.parse(stored);
  } catch (error) {
    console.warn('[PlaceReminders] getPlaceReminders error', {
      errorCode: error instanceof Error ? error.name : 'unknown',
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
    if (index >= 0) {
      existing[index] = reminder;
    } else {
      existing.push(reminder);
    }

    await AsyncStorage.setItem(key, JSON.stringify(existing));
    
    // Privacy log
    console.log('[PlaceReminders] Saved reminder', {
      reminderIdSuffix: reminder.id.slice(-6),
      radius: reminder.radius_meters,
      triggerType: reminder.trigger_type,
    });
  } catch (error) {
    console.warn('[PlaceReminders] savePlaceReminder error', {
      errorCode: error instanceof Error ? error.name : 'unknown',
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
    
    await AsyncStorage.setItem(key, JSON.stringify(filtered));
  } catch (error) {
    console.warn('[PlaceReminders] deletePlaceReminder error', {
      errorCode: error instanceof Error ? error.name : 'unknown',
    });
  }
}

async function triggerLocalNotification(reminder: PlaceReminder) {
  try {
    const channelId = await notifee.createChannel({
      id: 'place_reminders',
      name: 'Place Reminders',
      importance: AndroidImportance.HIGH,
    });

    await notifee.displayNotification({
      title: 'Place Reminder',
      body: reminder.title,
      android: {
        channelId,
        pressAction: {
          id: 'default',
        },
      },
    });

    // Update last_triggered_at and potentially disable if one_time
    reminder.last_triggered_at = new Date().toISOString();
    if (reminder.is_one_time) {
      reminder.is_enabled = false;
    }
    await savePlaceReminder(reminder);

    console.log('[PlaceReminders] Notification triggered', {
      reminderIdSuffix: reminder.id.slice(-6),
    });
  } catch (error) {
    console.warn('[PlaceReminders] triggerLocalNotification error', {
      errorCode: error instanceof Error ? error.name : 'unknown',
    });
  }
}

export async function evaluateReminders(lat: number, lon: number, now: number = Date.now()) {
  try {
    const reminders = await getPlaceReminders();

    for (const reminder of reminders) {
      if (!reminder.is_enabled || !reminder.latitude || !reminder.longitude) continue;

      // Check schedule
      const createdDate = new Date(reminder.created_at);
      const today = new Date(now);
      
      if (reminder.schedule_type === 'today') {
        if (createdDate.toDateString() !== today.toDateString()) continue;
      } else if (reminder.schedule_type === 'tomorrow') {
        const tomorrow = new Date(createdDate);
        tomorrow.setDate(tomorrow.getDate() + 1);
        if (tomorrow.toDateString() !== today.toDateString()) continue;
      }

      // Check cooldown
      if (reminder.last_triggered_at) {
        const lastTriggered = new Date(reminder.last_triggered_at).getTime();
        if (now - lastTriggered < COOLDOWN_MS) {
          continue; // In cooldown period
        }
      }

      const distance = getDistanceMeters(lat, lon, reminder.latitude, reminder.longitude);
      
      // Arriving logic MVP:
      // For this MVP, if within radius and 'arriving' trigger, we trigger. Cooldown prevents spam.
      if (reminder.trigger_type === 'arriving' && distance <= reminder.radius_meters) {
        await triggerLocalNotification(reminder);
      }
    }
  } catch (error) {
    console.warn('[PlaceReminders] Error evaluating reminders', {
      errorCode: error instanceof Error ? error.name : 'unknown',
    });
  }
}

let watchId: number | null = null;

export function startLocationMonitoring() {
  if (watchId !== null) return; // Already watching

  watchId = Geolocation.watchPosition(
    async (position) => {
      const lat = position.coords.latitude;
      const lon = position.coords.longitude;
      await evaluateReminders(lat, lon);
    },
    (error) => {
      console.warn('[PlaceReminders] Geolocation error', {
        errorCode: error.code,
      });
    },
    {
      enableHighAccuracy: false, // Save battery
      distanceFilter: 100, // Update every 100 meters
      interval: 60000, // Android only: 1 minute
      fastestInterval: 30000,
    }
  );

  console.log('[PlaceReminders] Location monitoring started');
}

export function stopLocationMonitoring() {
  if (watchId !== null) {
    Geolocation.clearWatch(watchId);
    watchId = null;
    console.log('[PlaceReminders] Location monitoring stopped');
  }
}
