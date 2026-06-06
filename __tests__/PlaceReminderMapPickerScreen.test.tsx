import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import PlaceReminderMapPickerScreen from '../src/screens/reminders/PlaceReminderMapPickerScreen';
import { useNavigation, useRoute } from '@react-navigation/native';

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

  beforeEach(() => {
    jest.clearAllMocks();
    (useNavigation as jest.Mock).mockReturnValue({
      navigate: mockNavigate,
    });
    (useRoute as jest.Mock).mockReturnValue({
      params: { latitude: 10, longitude: 20 },
    });
    
    (globalThis as any).fetch = jest.fn(() =>
      Promise.resolve({
        json: () => Promise.resolve({ status: 'OK', results: [{ formatted_address: 'Test Address' }] }),
      })
    ) as jest.Mock;
  });

  it('renders correctly with default params', () => {
    let tree: ReactTestRenderer.ReactTestRenderer;
    ReactTestRenderer.act(() => {
      tree = ReactTestRenderer.create(<PlaceReminderMapPickerScreen />);
    });
    expect(tree!.root).toBeDefined();
  });

  it('updates label on region change and geocode success', async () => {
    let tree!: ReactTestRenderer.ReactTestRenderer;
    await ReactTestRenderer.act(async () => {
      tree = ReactTestRenderer.create(<PlaceReminderMapPickerScreen />);
    });

    const map = tree.root.findByProps({ testID: 'map' });
    
    await ReactTestRenderer.act(async () => {
      map.props.onChange({ latitude: 15, longitude: 25, latitudeDelta: 0.01, longitudeDelta: 0.01 });
    });

    expect((globalThis as any).fetch).toHaveBeenCalledWith(
      expect.stringContaining('latlng=15,25')
    );
  });

  it('handles geocode failure gracefully without crashing', async () => {
    (globalThis as any).fetch = jest.fn(() => Promise.reject(new Error('Network error'))) as jest.Mock;
    
    let tree!: ReactTestRenderer.ReactTestRenderer;
    await ReactTestRenderer.act(async () => {
      tree = ReactTestRenderer.create(<PlaceReminderMapPickerScreen />);
    });

    const map = tree.root.findByProps({ testID: 'map' });
    
    await ReactTestRenderer.act(async () => {
      map.props.onChange({ latitude: 15, longitude: 25, latitudeDelta: 0.01, longitudeDelta: 0.01 });
    });

    expect((globalThis as any).fetch).toHaveBeenCalled();
  });

  it('navigates back with selected location when "Use this location" is pressed', async () => {
    let tree!: ReactTestRenderer.ReactTestRenderer;
    await ReactTestRenderer.act(async () => {
      tree = ReactTestRenderer.create(<PlaceReminderMapPickerScreen />);
    });

    // Simulate region change to set address
    const map = tree.root.findByProps({ testID: 'map' });
    await ReactTestRenderer.act(async () => {
      map.props.onChange({ latitude: 15, longitude: 25, latitudeDelta: 0.01, longitudeDelta: 0.01 });
    });

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
