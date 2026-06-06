import { getPlaceReminders, savePlaceReminder, deletePlaceReminder, PlaceReminder } from '../src/lib/services/placeReminders';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '../src/lib/core';

// Mock dependencies
jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(),
  setItem: jest.fn(),
  removeItem: jest.fn(),
}));

jest.mock('../src/lib/core', () => ({
  supabase: {
    auth: {
      getUser: jest.fn(),
    },
  },
}));

jest.mock('@notifee/react-native', () => ({
  createChannel: jest.fn().mockResolvedValue('channel-id'),
  displayNotification: jest.fn().mockResolvedValue('notification-id'),
  AndroidImportance: { HIGH: 4 },
}));

jest.mock('react-native-geolocation-service', () => ({
  getCurrentPosition: jest.fn(),
  watchPosition: jest.fn(),
  clearWatch: jest.fn(),
}));

describe('PlaceReminders Service', () => {
  const MOCK_USER_ID = 'test-user-123';
  const STORAGE_KEY = `@place_reminders_${MOCK_USER_ID}`;

  beforeEach(() => {
    jest.clearAllMocks();
    (supabase.auth.getUser as jest.Mock).mockResolvedValue({
      data: { user: { id: MOCK_USER_ID } },
    });
  });

  const createMockReminder = (id: string, is_one_time = true): PlaceReminder => ({
    id,
    user_id: MOCK_USER_ID,
    title: 'Test Reminder',
    note: 'Test Note',
    address: 'Test Address',
    latitude: 10.0,
    longitude: 20.0,
    radius_meters: 100,
    trigger_type: 'arriving',
    schedule_type: 'always',
    is_one_time,
    is_enabled: true,
    created_at: new Date().toISOString(),
  });

  describe('getPlaceReminders', () => {
    it('returns empty array if nothing in storage', async () => {
      (AsyncStorage.getItem as jest.Mock).mockResolvedValue(null);
      const result = await getPlaceReminders();
      expect(result).toEqual([]);
      expect(AsyncStorage.getItem).toHaveBeenCalledWith(STORAGE_KEY);
    });

    it('returns reminders from storage scoped to user', async () => {
      const mockData = [createMockReminder('r1')];
      (AsyncStorage.getItem as jest.Mock).mockResolvedValue(JSON.stringify(mockData));
      
      const result = await getPlaceReminders();
      expect(result).toEqual(mockData);
    });

    it('returns empty array if no user is logged in', async () => {
      (supabase.auth.getUser as jest.Mock).mockResolvedValue({ data: { user: null } });
      const result = await getPlaceReminders();
      expect(result).toEqual([]);
    });
  });

  describe('savePlaceReminder', () => {
    it('adds a new reminder', async () => {
      (AsyncStorage.getItem as jest.Mock).mockResolvedValue(JSON.stringify([]));
      const reminder = createMockReminder('r1');
      
      await savePlaceReminder(reminder);
      
      expect(AsyncStorage.setItem).toHaveBeenCalledWith(
        STORAGE_KEY,
        JSON.stringify([reminder])
      );
    });

    it('updates an existing reminder', async () => {
      const oldReminder = createMockReminder('r1');
      (AsyncStorage.getItem as jest.Mock).mockResolvedValue(JSON.stringify([oldReminder]));
      
      const updatedReminder = { ...oldReminder, title: 'Updated' };
      await savePlaceReminder(updatedReminder);
      
      expect(AsyncStorage.setItem).toHaveBeenCalledWith(
        STORAGE_KEY,
        JSON.stringify([updatedReminder])
      );
    });
  });

  describe('deletePlaceReminder', () => {
    it('removes the reminder from storage', async () => {
      const r1 = createMockReminder('r1');
      const r2 = createMockReminder('r2');
      (AsyncStorage.getItem as jest.Mock).mockResolvedValue(JSON.stringify([r1, r2]));
      
      await deletePlaceReminder('r1');
      
      expect(AsyncStorage.setItem).toHaveBeenCalledWith(
        STORAGE_KEY,
        JSON.stringify([r2])
      );
    });
  });
});
