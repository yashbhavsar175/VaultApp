import { Platform, Alert } from 'react-native';
import RNAndroidNotificationListener from 'react-native-android-notification-listener';

/**
 * Check if the app has Notification Listener permission
 */
export const checkNotificationPermission = async (): Promise<boolean> => {
  console.log('🔔 [NotificationPermission] Checking notification permission...');
  
  if (Platform.OS !== 'android') {
    console.log('⚠️ [NotificationPermission] Not Android, returning false');
    return false;
  }

  try {
    const status = await RNAndroidNotificationListener.getPermissionStatus();
    console.log('✅ [NotificationPermission] Permission status:', status);
    return status === 'authorized';
  } catch (error) {
    console.error('❌ [NotificationPermission] Failed to check permission:', error);
    return false;
  }
};

/**
 * Request Notification Listener permission
 * Directly opens the notification listener settings without showing a dialog
 */
export const requestNotificationPermission = (): void => {
  console.log('🔔 [NotificationPermission] Requesting notification permission...');
  
  if (Platform.OS !== 'android') {
    console.log('⚠️ [NotificationPermission] Not Android, skipping request');
    return;
  }

  try {
    console.log('📱 [NotificationPermission] Opening notification listener settings...');
    RNAndroidNotificationListener.requestPermission();
    console.log('✅ [NotificationPermission] Settings opened successfully');
  } catch (error) {
    console.error('❌ [NotificationPermission] Failed to open settings:', error);
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
