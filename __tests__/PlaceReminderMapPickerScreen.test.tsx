import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import PlaceReminderMapPickerScreen from '../src/screens/reminders/PlaceReminderMapPickerScreen';
import { useNavigation, useRoute } from '@react-navigation/native';
import { PermissionsAndroid } from 'react-native';
import Geolocation from 'react-native-geolocation-service';

jest.mock('@react-navigation/native', () => ({
  useNavigation: jest.fn(),
  useRoute: jest.fn(),
}));

jest.mock('react-native-maps', () => {
  const React = require('react');
  return {
    __esModule: true,
    default: ({ onRegionChangeComplete, children, ...props }: any) => {
      // Expose a way to manually trigger region change for tests
      return React.createElement('MapView', { ...props, testID: 'map', onChange: onRegionChangeComplete }, children);
    },
  };
});

jest.mock('react-native-vector-icons/MaterialCommunityIcons', () => 'Icon');

jest.mock('react-native-config', () => ({
  GOOGLE_MAPS_API_KEY: 'test_key',
}));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

jest.mock('../src/context/ThemeContext', () => ({
  useTheme: () => ({
    colors: {
      background: '#fff',
      surface: '#fff',
      text: '#000',
      subtext: '#666',
      accent: '#007bff',
      border: '#eee',
    },
    typography: {
      caption: {},
      body: {},
    },
    spacing: { md: 16, lg: 24 },
    borderRadius: { md: 8 },
  }),
}));

jest.mock('../src/lib/core', () => ({
  supabase: {
    auth: {
      getUser: jest.fn(),
    },
  },
}));

describe('PlaceReminderMapPickerScreen', () => {
  const mockNavigate = jest.fn();
  const mockDispatch = jest.fn();
  const mockGoBack = jest.fn();
  const flushAsyncWork = async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  };
  const runDebouncedGeocode = async () => {
    await ReactTestRenderer.act(async () => {
      jest.advanceTimersByTime(500);
      await flushAsyncWork();
    });
  };

  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    (useNavigation as jest.Mock).mockReturnValue({
      navigate: mockNavigate,
      dispatch: mockDispatch,
      getState: jest.fn(() => undefined),
      goBack: mockGoBack,
    });
    (useRoute as jest.Mock).mockReturnValue({
      params: { latitude: 10, longitude: 20 },
    });
    jest.spyOn(PermissionsAndroid, 'check').mockResolvedValue(true);
    jest.spyOn(PermissionsAndroid, 'requestMultiple').mockResolvedValue({
      [PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION]: PermissionsAndroid.RESULTS.GRANTED,
      [PermissionsAndroid.PERMISSIONS.ACCESS_COARSE_LOCATION]: PermissionsAndroid.RESULTS.GRANTED,
    } as any);
    (Geolocation.getCurrentPosition as jest.Mock).mockImplementation((_success, error) => {
      error?.({ code: 1, message: 'No location' });
    });
    
    (globalThis as any).fetch = jest.fn(() =>
      Promise.resolve({
        json: () => Promise.resolve({ status: 'OK', results: [{ formatted_address: 'Test Address' }] }),
      })
    ) as jest.Mock;
  });

  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  it('renders correctly with default params', async () => {
    let tree: ReactTestRenderer.ReactTestRenderer;
    await ReactTestRenderer.act(async () => {
      tree = ReactTestRenderer.create(<PlaceReminderMapPickerScreen />);
      await flushAsyncWork();
    });
    expect(tree!.root).toBeDefined();
  });

  it('updates label on region change and geocode success', async () => {
    let tree!: ReactTestRenderer.ReactTestRenderer;
    await ReactTestRenderer.act(async () => {
      tree = ReactTestRenderer.create(<PlaceReminderMapPickerScreen />);
      await flushAsyncWork();
    });

    const map = tree.root.findByProps({ testID: 'map' });
    
    await ReactTestRenderer.act(async () => {
      map.props.onChange({ latitude: 15, longitude: 25, latitudeDelta: 0.01, longitudeDelta: 0.01 });
      await flushAsyncWork();
    });
    await runDebouncedGeocode();

    expect((globalThis as any).fetch).toHaveBeenCalledWith(
      expect.stringContaining('latlng=15,25')
    );
  });

  it('keeps long reverse-geocoded addresses intact', async () => {
    const longAddress = 'A56/6, New Vatva Rd, Ekta Park Society, Varahi Nagar, Ahmedabad, Gujarat 382440, India';
    (globalThis as any).fetch = jest.fn(() =>
      Promise.resolve({
        json: () => Promise.resolve({ status: 'OK', results: [{ formatted_address: longAddress }] }),
      })
    ) as jest.Mock;

    let tree!: ReactTestRenderer.ReactTestRenderer;
    await ReactTestRenderer.act(async () => {
      tree = ReactTestRenderer.create(<PlaceReminderMapPickerScreen />);
      await flushAsyncWork();
    });

    const map = tree.root.findByProps({ testID: 'map' });
    await ReactTestRenderer.act(async () => {
      map.props.onChange({ latitude: 15, longitude: 25, latitudeDelta: 0.01, longitudeDelta: 0.01 });
      await flushAsyncWork();
    });
    await runDebouncedGeocode();

    const buttons = tree.root.findAllByProps({ title: 'Use this location' });
    await ReactTestRenderer.act(async () => {
      buttons[0].props.onPress();
    });

    expect(mockNavigate).toHaveBeenCalledWith('EditPlaceReminder', {
      selectedLocation: {
        latitude: 15,
        longitude: 25,
        label: longAddress,
        source: 'map_pin',
      }
    });
  });

  it('centers on current location when opened without existing coordinates', async () => {
    (useRoute as jest.Mock).mockReturnValue({ params: {} });
    (Geolocation.getCurrentPosition as jest.Mock).mockImplementation(success => {
      success({
        coords: {
          latitude: 22.969722,
          longitude: 72.609018,
          accuracy: 20,
        },
      });
    });

    let tree!: ReactTestRenderer.ReactTestRenderer;
    await ReactTestRenderer.act(async () => {
      tree = ReactTestRenderer.create(<PlaceReminderMapPickerScreen />);
      await flushAsyncWork();
    });

    await ReactTestRenderer.act(async () => {
      await flushAsyncWork();
    });

    const map = tree.root.findByProps({ testID: 'map' });
    expect(map.props.initialRegion.latitude).toBeCloseTo(22.969722);
    expect(map.props.initialRegion.longitude).toBeCloseTo(72.609018);
    expect((globalThis as any).fetch).toHaveBeenCalledWith(
      expect.stringContaining('latlng=22.969722,72.609018')
    );
  });

  it('handles geocode failure gracefully without crashing', async () => {
    (globalThis as any).fetch = jest.fn(() => Promise.reject(new Error('Network error'))) as jest.Mock;
    
    let tree!: ReactTestRenderer.ReactTestRenderer;
    await ReactTestRenderer.act(async () => {
      tree = ReactTestRenderer.create(<PlaceReminderMapPickerScreen />);
      await flushAsyncWork();
    });

    const map = tree.root.findByProps({ testID: 'map' });
    
    await ReactTestRenderer.act(async () => {
      map.props.onChange({ latitude: 15, longitude: 25, latitudeDelta: 0.01, longitudeDelta: 0.01 });
      await flushAsyncWork();
    });
    await runDebouncedGeocode();

    expect((globalThis as any).fetch).toHaveBeenCalled();
  });

  it('navigates back with selected location when "Use this location" is pressed', async () => {
    let tree!: ReactTestRenderer.ReactTestRenderer;
    await ReactTestRenderer.act(async () => {
      tree = ReactTestRenderer.create(<PlaceReminderMapPickerScreen />);
      await flushAsyncWork();
    });

    // Simulate region change to set address
    const map = tree.root.findByProps({ testID: 'map' });
    await ReactTestRenderer.act(async () => {
      map.props.onChange({ latitude: 15, longitude: 25, latitudeDelta: 0.01, longitudeDelta: 0.01 });
      await flushAsyncWork();
    });
    await runDebouncedGeocode();

    // Find "Use this location" button
    const buttons = tree.root.findAllByProps({ title: 'Use this location' });
    expect(buttons.length).toBeGreaterThan(0);
    
    await ReactTestRenderer.act(async () => {
      buttons[0].props.onPress();
    });

    expect(mockNavigate).toHaveBeenCalledWith('EditPlaceReminder', {
      selectedLocation: {
        latitude: 15,
        longitude: 25,
        label: 'Test Address',
        source: 'map_pin',
      }
    });
  });
});
