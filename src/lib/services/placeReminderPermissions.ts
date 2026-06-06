import { Platform, PermissionsAndroid } from 'react-native';
import notifee, { AuthorizationStatus } from '@notifee/react-native';

export type PermissionStatus = 'granted' | 'denied' | 'blocked' | 'unknown';

export async function requestPlaceReminderPermissions(): Promise<{
  location: PermissionStatus;
  notification: PermissionStatus;
}> {
  let locationStatus: PermissionStatus = 'unknown';
  let notificationStatus: PermissionStatus = 'unknown';

  try {
    // 1. Request Location Permissions
    if (Platform.OS === 'android') {
      const granted = await PermissionsAndroid.requestMultiple([
        PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
        PermissionsAndroid.PERMISSIONS.ACCESS_COARSE_LOCATION,
      ]);

      const fineLocation = granted[PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION];
      const coarseLocation = granted[PermissionsAndroid.PERMISSIONS.ACCESS_COARSE_LOCATION];

      if (
        fineLocation === PermissionsAndroid.RESULTS.GRANTED ||
        coarseLocation === PermissionsAndroid.RESULTS.GRANTED
      ) {
        locationStatus = 'granted';
      } else if (
        fineLocation === PermissionsAndroid.RESULTS.NEVER_ASK_AGAIN ||
        coarseLocation === PermissionsAndroid.RESULTS.NEVER_ASK_AGAIN
      ) {
        locationStatus = 'blocked';
      } else {
        locationStatus = 'denied';
      }
    } else {
      // iOS handling if needed (react-native-geolocation-service has requestAuthorization)
      // We will assume location status handled via other modules for iOS or return unknown for now
      locationStatus = 'granted'; // Defaulting for iOS since MVP is mainly Android focused based on Geofence request
    }

    // 2. Request Notification Permissions via Notifee
    const settings = await notifee.requestPermission();
    if (settings.authorizationStatus === AuthorizationStatus.AUTHORIZED || settings.authorizationStatus === AuthorizationStatus.PROVISIONAL) {
      notificationStatus = 'granted';
    } else if (settings.authorizationStatus === AuthorizationStatus.DENIED) {
      notificationStatus = 'denied';
    }

    // Privacy-safe logging
    console.log('[PlaceReminders] Permissions requested:', {
      locationStatus,
      notificationStatus
    });

  } catch (error) {
    console.warn('[PlaceReminders] Error requesting permissions:', {
      errorCode: error instanceof Error ? error.name : 'unknown',
    });
  }

  return {
    location: locationStatus,
    notification: notificationStatus,
  };
}

export async function checkPlaceReminderPermissions(): Promise<{
  location: PermissionStatus;
  notification: PermissionStatus;
}> {
  let locationStatus: PermissionStatus = 'unknown';
  let notificationStatus: PermissionStatus = 'unknown';

  try {
    if (Platform.OS === 'android') {
      const fineGranted = await PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION);
      const coarseGranted = await PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.ACCESS_COARSE_LOCATION);

      if (fineGranted || coarseGranted) {
        locationStatus = 'granted';
      } else {
        locationStatus = 'denied'; // Check cannot determine "blocked", assume denied
      }
    } else {
      locationStatus = 'granted';
    }

    const settings = await notifee.getNotificationSettings();
    if (settings.authorizationStatus === AuthorizationStatus.AUTHORIZED || settings.authorizationStatus === AuthorizationStatus.PROVISIONAL) {
      notificationStatus = 'granted';
    } else if (settings.authorizationStatus === AuthorizationStatus.DENIED) {
      notificationStatus = 'denied';
    }

  } catch (error) {
    console.warn('[PlaceReminders] Error checking permissions:', {
      errorCode: error instanceof Error ? error.name : 'unknown',
    });
  }

  return {
    location: locationStatus,
    notification: notificationStatus,
  };
}
