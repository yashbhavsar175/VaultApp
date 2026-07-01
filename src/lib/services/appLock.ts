import AsyncStorage from '@react-native-async-storage/async-storage';
import ReactNativeBiometrics from 'react-native-biometrics';

const APP_LOCK_KEY = 'app_lock_biometric_enabled';

export async function isAppLockEnabled(): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(APP_LOCK_KEY)) === '1';
  } catch {
    return false;
  }
}

export async function setAppLockEnabled(enabled: boolean): Promise<void> {
  await AsyncStorage.setItem(APP_LOCK_KEY, enabled ? '1' : '0');
}

export async function isBiometricsAvailable(): Promise<boolean> {
  try {
    const { available } = await new ReactNativeBiometrics().isSensorAvailable();
    return available;
  } catch {
    return false;
  }
}

export type BiometricResult = 'success' | 'cancelled' | 'error';

export async function promptBiometricUnlock(message: string): Promise<BiometricResult> {
  try {
    const biometricPromise = new ReactNativeBiometrics().simplePrompt({
      promptMessage: message,
      cancelButtonText: 'Cancel',
    });
    // Safety timeout — if the native dialog hangs (e.g. app foregrounding race),
    // treat it as cancelled so the overlay never gets stuck on "Verifying…"
    const timeoutPromise = new Promise<{ success: boolean }>(resolve =>
      setTimeout(() => resolve({ success: false }), 15000)
    );
    const { success } = await Promise.race([biometricPromise, timeoutPromise]);
    return success ? 'success' : 'cancelled';
  } catch (e: any) {
    const msg: string = (e?.message || '').toLowerCase();
    return msg.includes('cancel') ? 'cancelled' : 'error';
  }
}
