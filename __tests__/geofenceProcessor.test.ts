import { GeofenceProcessorTask } from '../src/lib/services/geofenceProcessor';
import { getPlaceReminders, PlaceReminder } from '../src/lib/services/placeReminders';
import notifee from '@notifee/react-native';

jest.mock('../src/lib/services/placeReminders', () => ({
  getPlaceReminders: jest.fn(),
  savePlaceReminder: jest.fn(),
  syncAllGeofences: jest.fn(),
}));

jest.mock('@notifee/react-native', () => ({
  createChannel: jest.fn().mockResolvedValue('channel-id'),
  displayNotification: jest.fn().mockResolvedValue('notification-id'),
  AndroidImportance: { HIGH: 4, DEFAULT: 3 },
}));

describe('GeofenceProcessorTask', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  const getMockReminder = (): PlaceReminder => ({
    id: 'r1',
    user_id: 'u1',
    title: 'Test Arriving',
    note: '',
    address: 'Addr',
    latitude: 10,
    longitude: 20,
    radius_meters: 100,
    trigger_type: 'arriving',
    schedule_type: 'always',
    intensity: 'normal',
    is_one_time: true,
    is_enabled: true,
    created_at: new Date().toISOString(),
  });

  it('triggers on arriving when transitionType matches', async () => {
    (getPlaceReminders as jest.Mock).mockResolvedValue([getMockReminder()]);

    await GeofenceProcessorTask({ geofenceIds: ['r1'], transitionType: 'arriving' });

    expect(notifee.createChannel).toHaveBeenCalledWith(
      expect.objectContaining({ importance: 4 }) // HIGH alarm channel
    );
    expect(notifee.displayNotification).toHaveBeenCalled();
  });

  it('ignores arriving transition if reminder is set to leaving', async () => {
    (getPlaceReminders as jest.Mock).mockResolvedValue([{ ...getMockReminder(), trigger_type: 'leaving' }]);

    await GeofenceProcessorTask({ geofenceIds: ['r1'], transitionType: 'arriving' });

    expect(notifee.displayNotification).not.toHaveBeenCalled();
  });

  it('triggers on leaving when transitionType matches', async () => {
    (getPlaceReminders as jest.Mock).mockResolvedValue([{ ...getMockReminder(), trigger_type: 'leaving' }]);

    await GeofenceProcessorTask({ geofenceIds: ['r1'], transitionType: 'leaving' });

    expect(notifee.displayNotification).toHaveBeenCalled();
  });

  it('uses HIGH importance channel for important reminders', async () => {
    (getPlaceReminders as jest.Mock).mockResolvedValue([{ ...getMockReminder(), intensity: 'important' }]);

    await GeofenceProcessorTask({ geofenceIds: ['r1'], transitionType: 'arriving' });

    expect(notifee.createChannel).toHaveBeenCalledWith(
      expect.objectContaining({ importance: 4, vibration: true }) // HIGH
    );
  });
});
