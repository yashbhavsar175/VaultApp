import { PermissionsAndroid, Platform } from 'react-native';

/**
 * Request SMS permissions from user
 */
export async function requestSmsPermissions(): Promise<boolean> {
  if (Platform.OS !== 'android') {
    return false;
  }

  try {
    const granted = await PermissionsAndroid.requestMultiple([
      PermissionsAndroid.PERMISSIONS.RECEIVE_SMS,
      PermissionsAndroid.PERMISSIONS.READ_SMS,
    ]);

    const receiveSmsGranted = granted['android.permission.RECEIVE_SMS'] === PermissionsAndroid.RESULTS.GRANTED;
    const readSmsGranted = granted['android.permission.READ_SMS'] === PermissionsAndroid.RESULTS.GRANTED;

    return receiveSmsGranted && readSmsGranted;
  } catch (error) {
    console.error('Error requesting SMS permissions:', error);
    return false;
  }
}

/**
 * Check if SMS permissions are granted
 */
export async function checkSmsPermissions(): Promise<boolean> {
  if (Platform.OS !== 'android') {
    return false;
  }

  try {
    const receiveSmsGranted = await PermissionsAndroid.check(
      PermissionsAndroid.PERMISSIONS.RECEIVE_SMS
    );
    const readSmsGranted = await PermissionsAndroid.check(
      PermissionsAndroid.PERMISSIONS.READ_SMS
    );

    return receiveSmsGranted && readSmsGranted;
  } catch (error) {
    console.error('Error checking SMS permissions:', error);
    return false;
  }
}
