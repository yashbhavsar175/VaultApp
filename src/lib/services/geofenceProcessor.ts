import { getPlaceReminders, savePlaceReminder, syncAllGeofences, PlaceReminder } from './placeReminders';
import notifee, { AndroidImportance } from '@notifee/react-native';
import { getAndroidNotificationBase } from './androidNotificationConfig';

const COOLDOWN_MS = 30 * 60 * 1000; // 30 minutes

export const GeofenceProcessorTask = async (taskData: { geofenceIds?: string[], transitionType?: string }) => {
  try {
    const ids = taskData?.geofenceIds;
    const transitionType = taskData?.transitionType;
    if (__DEV__) console.log('[GeofenceProcessor] Task received:', { ids: ids?.map(id => id.slice(-6)), transitionType });

    if (!ids || ids.length === 0 || !transitionType) {
      if (__DEV__) console.log('[GeofenceProcessor] Task skipped: missing ids or transitionType');
      return;
    }

    const reminders = await getPlaceReminders();
    const now = Date.now();
    if (__DEV__) console.log('[GeofenceProcessor] Loaded reminders for matching:', { count: reminders.length });

    for (const id of ids) {
      const reminder = reminders.find(r => r.id === id);
      if (!reminder || !reminder.is_enabled) {
        if (__DEV__) console.log('[GeofenceProcessor] Skipping geofence:', { idSuffix: id.slice(-6), reason: !reminder ? 'not found' : 'disabled' });
        continue;
      }
      
      // Match transition type
      if (reminder.trigger_type !== transitionType) {
        if (__DEV__) console.log('[GeofenceProcessor] Skipping geofence (trigger mismatch):', { idSuffix: id.slice(-6), reminderTrigger: reminder.trigger_type, transitionType });
        continue;
      }

      // Check schedule
      const createdDate = new Date(reminder.created_at);
      const today = new Date(now);
      
      if (reminder.schedule_type === 'today') {
        if (createdDate.toDateString() !== today.toDateString()) {
          if (__DEV__) console.log('[GeofenceProcessor] Skipping geofence (schedule=today, not today):', { idSuffix: id.slice(-6) });
          continue;
        }
      } else if (reminder.schedule_type === 'tomorrow') {
        const tomorrow = new Date(createdDate);
        tomorrow.setDate(tomorrow.getDate() + 1);
        if (tomorrow.toDateString() !== today.toDateString()) {
          if (__DEV__) console.log('[GeofenceProcessor] Skipping geofence (schedule=tomorrow, not tomorrow):', { idSuffix: id.slice(-6) });
          continue;
        }
      }

      // Check cooldown
      if (reminder.last_triggered_at) {
        const lastTriggered = new Date(reminder.last_triggered_at).getTime();
        if (now - lastTriggered < COOLDOWN_MS) {
          if (__DEV__) console.log('[GeofenceProcessor] Skipping geofence (cooldown):', { idSuffix: id.slice(-6), cooldownRemainingSeconds: Math.round((COOLDOWN_MS - (now - lastTriggered)) / 1000) });
          continue; // In cooldown
        }
      }

      // Fire notification
      if (__DEV__) console.log('[GeofenceProcessor] All checks passed, firing notification:', { idSuffix: id.slice(-6) });
      await triggerBackgroundNotification(reminder);
    }
  } catch (error) {
    console.warn('[GeofenceProcessor] Error processing geofence trigger', {
      errorCode: error instanceof Error ? error.name : 'unknown',
      message: error instanceof Error ? error.message : String(error),
    });
  }
};

async function triggerBackgroundNotification(reminder: PlaceReminder) {
  try {
    const isImportant = reminder.intensity === 'important';
    if (__DEV__) console.log('[GeofenceProcessor] triggerBackgroundNotification:', { idSuffix: reminder.id.slice(-6), isImportant, isOneTime: reminder.is_one_time });
    
    // Alarm-style channel: always HIGH importance for heads-up display
    const channelId = await notifee.createChannel({
      id: isImportant ? 'place_alarm_v3_important' : 'place_alarm_v3',
      name: isImportant ? '📍 Important Place Alarms' : '📍 Place Alarms',
      importance: AndroidImportance.HIGH,
      vibration: true,
      vibrationPattern: isImportant ? [300, 400, 200, 400, 200, 400] : [300, 300, 200, 300],
      sound: 'alarm',
    });
    if (__DEV__) console.log('[GeofenceProcessor] Alarm channel created:', channelId);

    // Alarm-style notification: full-screen intent, ongoing, looping sound
    await notifee.displayNotification({
      title: isImportant ? '🔔 Place Reminder!' : '📍 Place Reminder',
      body: reminder.title,
      android: {
        ...getAndroidNotificationBase(channelId),
        sound: 'alarm',
        loopSound: true,
        ongoing: true,
        autoCancel: false,
        importance: AndroidImportance.HIGH,
        fullScreenAction: {
          id: 'default',
        },
        timestamp: Date.now(),
        showTimestamp: true,
      },
    });
    if (__DEV__) console.log('[GeofenceProcessor] 🔔 ALARM notification displayed successfully');

    // Update state using a copy to avoid mutating the in-memory array object
    const updatedReminder = { ...reminder, last_triggered_at: new Date().toISOString() };
    if (updatedReminder.is_one_time) {
      if (__DEV__) console.log('[GeofenceProcessor] One-time reminder, disabling after trigger');
      updatedReminder.is_enabled = false;
    }
    await savePlaceReminder(updatedReminder);

    if (__DEV__) console.log('[GeofenceProcessor] Background Alarm triggered', {
      reminderIdSuffix: updatedReminder.id.slice(-6),
    });
  } catch (error) {
    console.warn('[GeofenceProcessor] background notification error', {
      errorCode: error instanceof Error ? error.name : 'unknown',
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

export const BootProcessorTask = async () => {
  try {
    if (__DEV__) console.log('[BootProcessor] Syncing geofences after boot');
    await syncAllGeofences();
    if (__DEV__) console.log('[BootProcessor] Boot sync complete');
  } catch (error) {
    console.warn('[BootProcessor] Error syncing geofences', {
      errorCode: error instanceof Error ? error.name : 'unknown',
      message: error instanceof Error ? error.message : String(error),
    });
  }
};
