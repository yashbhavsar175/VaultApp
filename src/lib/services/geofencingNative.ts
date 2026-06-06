import { NativeModules } from 'react-native';

export interface NativeGeofenceReminder {
  id: string;
  latitude: number;
  longitude: number;
  radius_meters: number;
  triggerType: string;
}

interface GeofenceModuleType {
  syncGeofences: (reminders: NativeGeofenceReminder[]) => Promise<boolean>;
  clearGeofences: () => Promise<boolean>;
}

const { GeofenceModule } = NativeModules;
const RawModule = GeofenceModule as GeofenceModuleType;

export const GeofencingNative: GeofenceModuleType = {
  async syncGeofences(reminders: NativeGeofenceReminder[]): Promise<boolean> {
    console.log('[GeofencingNative] syncGeofences called:', { count: reminders.length, ids: reminders.map(r => r.id.slice(-6)) });
    try {
      const result = await RawModule.syncGeofences(reminders);
      console.log('[GeofencingNative] syncGeofences result:', result);
      return result;
    } catch (error) {
      console.warn('[GeofencingNative] syncGeofences error:', {
        errorCode: error instanceof Error ? error.name : 'unknown',
        message: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  },

  async clearGeofences(): Promise<boolean> {
    console.log('[GeofencingNative] clearGeofences called');
    try {
      const result = await RawModule.clearGeofences();
      console.log('[GeofencingNative] clearGeofences result:', result);
      return result;
    } catch (error) {
      console.warn('[GeofencingNative] clearGeofences error:', {
        errorCode: error instanceof Error ? error.name : 'unknown',
        message: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  },
};
