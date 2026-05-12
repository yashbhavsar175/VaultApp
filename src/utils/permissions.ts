/**
 * Permissions — Consolidated
 * Merged from: smsPermissions.ts, notificationPermissions.ts
 * 
 * All Android permission helpers in one place.
 */

import { PermissionsAndroid, Platform, Alert } from 'react-native';
import RNAndroidNotificationListener from 'react-native-android-notification-listener';

// ─── SMS Permissions ────────────────────────────────────────────────────────────

/**
 * Request SMS permissions from user
 */
export async function requestSmsPermissions(): Promise<boolean> {
  if (Platform.OS !== 'android') return false;

  try {
    const granted = await PermissionsAndroid.requestMultiple([
      PermissionsAndroid.PERMISSIONS.RECEIVE_SMS,
      PermissionsAndroid.PERMISSIONS.READ_SMS,
    ]);

    return (
      granted['android.permission.RECEIVE_SMS'] === PermissionsAndroid.RESULTS.GRANTED &&
      granted['android.permission.READ_SMS'] === PermissionsAndroid.RESULTS.GRANTED
    );
  } catch (error) {
    console.error('Error requesting SMS permissions:', error);
    return false;
  }
}

/**
 * Check if SMS permissions are granted
 */
export async function checkSmsPermissions(): Promise<boolean> {
  if (Platform.OS !== 'android') return false;

  try {
    const receiveSmsGranted = await PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.RECEIVE_SMS);
    const readSmsGranted = await PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.READ_SMS);
    return receiveSmsGranted && readSmsGranted;
  } catch (error) {
    console.error('Error checking SMS permissions:', error);
    return false;
  }
}

// ─── Notification Listener Permissions ──────────────────────────────────────────

/**
 * Check if the app has Notification Listener permission
 */
export const checkNotificationPermission = async (): Promise<boolean> => {
  if (Platform.OS !== 'android') return false;

  try {
    const status = await RNAndroidNotificationListener.getPermissionStatus();
    return status === 'authorized';
  } catch (error) {
    console.error('Failed to check notification permission:', error);
    return false;
  }
};

/**
 * Request Notification Listener permission
 * Opens the notification listener settings directly
 */
export const requestNotificationPermission = (): void => {
  if (Platform.OS !== 'android') return;

  try {
    RNAndroidNotificationListener.requestPermission();
  } catch (error) {
    console.error('Failed to open notification settings:', error);
  }
};

/**
 * Show information about notification tracking
 */
export const showNotificationInfo = (): void => {
  Alert.alert(
    'Automatic Transaction Tracking',
    'Enable notification access to automatically capture transactions from:\n\n' +
    '• Slice (tech.ula)\n' +
    '• CRED\n' +
    '• Google Pay\n' +
    '• PhonePe\n' +
    '• Paytm\n' +
    '• Amazon Pay\n' +
    '• WhatsApp UPI\n\n' +
    'Some apps only send push notifications (not SMS), so this feature ensures you never miss a transaction.\n\n' +
    'Your data stays private and secure on your device.',
    [{ text: 'Got it' }]
  );
};
