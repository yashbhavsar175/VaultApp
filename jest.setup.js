/* eslint-env jest */

require('react-native-gesture-handler/jestSetup');

const { NativeModules } = require('react-native');

NativeModules.PorterModule = {
  addListener: jest.fn(),
  removeListeners: jest.fn(),
  startService: jest.fn(),
  stopService: jest.fn(),
  isServiceRunning: jest.fn(),
};

NativeModules.VaultSecurityModule = {
  setSecureWindow: jest.fn(() => Promise.resolve(true)),
};

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock')
);

jest.mock('@react-native-community/netinfo', () =>
  require('@react-native-community/netinfo/jest/netinfo-mock')
);

jest.mock('react-native-haptic-feedback', () => ({
  trigger: jest.fn(),
}));

jest.mock('react-native-config', () => ({
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_ANON_KEY: 'test-anon-key',
  GOOGLE_WEB_CLIENT_ID: 'test-google-client-id',
  APP_NAME: 'SpendSense',
  APP_VERSION: '1.0.0',
}));

jest.mock('@notifee/react-native', () => ({
  __esModule: true,
  default: {
    onForegroundEvent: jest.fn(() => jest.fn()),
    onBackgroundEvent: jest.fn(),
    requestPermission: jest.fn(),
    getNotificationSettings: jest.fn(() => Promise.resolve({ authorizationStatus: 1 })),
    createChannel: jest.fn(),
    displayNotification: jest.fn(),
  },
  EventType: {},
  AndroidImportance: { DEFAULT: 3, HIGH: 4 },
  AuthorizationStatus: { DENIED: 0, AUTHORIZED: 1, PROVISIONAL: 2 },
}));

jest.mock('react-native-android-notification-listener', () => ({
  getPermissionStatus: jest.fn(() => Promise.resolve('denied')),
  requestPermission: jest.fn(),
}));

jest.mock('@react-native-google-signin/google-signin', () => ({
  GoogleSignin: {
    configure: jest.fn(),
    hasPlayServices: jest.fn(),
    signIn: jest.fn(),
    signOut: jest.fn(),
  },
  statusCodes: {},
}));

jest.mock('react-native-vector-icons/MaterialCommunityIcons', () => 'Icon');

jest.mock('react-native-maps', () => {
  const React = require('react');
  const { View } = require('react-native');
  const MockMapView = props => React.createElement(View, props);
  const MockMarker = props => React.createElement(View, props);
  return {
    __esModule: true,
    default: MockMapView,
    Marker: MockMarker,
    PROVIDER_GOOGLE: 'google',
  };
});

jest.mock('react-native-geolocation-service', () => ({
  getCurrentPosition: jest.fn(),
  watchPosition: jest.fn(() => 1),
  clearWatch: jest.fn(),
  stopObserving: jest.fn(),
}));

jest.mock('@react-native-voice/voice', () => ({
  __esModule: true,
  default: {
    start: jest.fn(),
    stop: jest.fn(),
    destroy: jest.fn(() => Promise.resolve()),
    removeAllListeners: jest.fn(),
    onSpeechResults: jest.fn(),
    onSpeechError: jest.fn(),
  },
}));

jest.mock('react-native-gifted-charts', () => {
  const React = require('react');
  const { View } = require('react-native');
  const Chart = props => React.createElement(View, props);
  return {
    BarChart: Chart,
    PieChart: Chart,
    LineChart: Chart,
  };
});

jest.mock('@shopify/flash-list', () => {
  const { FlatList } = require('react-native');
  return {
    FlashList: FlatList,
  };
});
