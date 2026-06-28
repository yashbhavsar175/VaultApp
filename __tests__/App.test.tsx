/**
 * @format
 */

import React from 'react';
import { Text } from 'react-native';
import ReactTestRenderer from 'react-test-renderer';
import AsyncStorage from '@react-native-async-storage/async-storage';
import AppIntroScreen from '../src/screens/intro/AppIntroScreen';
import App, {
  deferAuthStateChange,
  getCachedProfileRouteHint,
  AuthLoadingScreen,
  StartupRepairScreen,
  summarizeStartupError,
  withStartupTimeout,
} from '../App';

const mockGetSession = jest.fn();
const mockGetUser = jest.fn();
const mockOnAuthStateChange = jest.fn();
const mockUnsubscribe = jest.fn();
const mockFrom = jest.fn();
const mockMaybeSingle = jest.fn();
const mockClearCache = jest.fn(() => Promise.resolve());
const mockGetCached = jest.fn((_key?: string): Promise<any> => Promise.resolve(null));
const mockPrefetchAllData = jest.fn();
const mockSyncOfflineTransactions = jest.fn(() => Promise.resolve());
const mockStartLocationMonitoring = jest.fn();
const mockStopLocationMonitoring = jest.fn();
const mockNetInfoListeners: Array<(state: { isConnected: boolean }) => void> = [];

jest.mock('@react-native-community/netinfo', () => ({
  addEventListener: jest.fn((listener: (state: { isConnected: boolean }) => void) => {
    mockNetInfoListeners.push(listener);
    return jest.fn();
  }),
}));

jest.mock('@react-navigation/native', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    DefaultTheme: { colors: { background: '#000000' } },
    NavigationContainer: ({ children }: { children: React.ReactNode }) => React.createElement(View, null, children),
  };
});

jest.mock('react-native-safe-area-context', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    SafeAreaProvider: ({ children }: { children: React.ReactNode }) => React.createElement(View, null, children),
    SafeAreaView: ({ children }: { children: React.ReactNode }) => React.createElement(View, null, children),
    useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
  };
});

jest.mock('../src/lib/core', () => ({
  supabase: {
    auth: {
      getSession: () => mockGetSession(),
      getUser: () => mockGetUser(),
      onAuthStateChange: (callback: unknown) => mockOnAuthStateChange(callback),
    },
    from: (table: string) => mockFrom(table),
  },
  configureGoogleSignIn: jest.fn(),
  syncOfflineTransactions: () => mockSyncOfflineTransactions(),
}));

jest.mock('../src/navigation/RootNavigator', () => {
  const React = require('react');
  const { Text } = require('react-native');
  return function MockRootNavigator() {
    return React.createElement(Text, null, 'MainApp');
  };
});

jest.mock('../src/screens/auth/AuthScreens', () => {
  const React = require('react');
  const { Text } = require('react-native');
  return {
    LoginScreen: () => React.createElement(Text, null, 'Login'),
    SignupScreen: () => React.createElement(Text, null, 'Signup'),
  };
});

jest.mock('../src/screens/user/ProfileScreen', () => {
  const React = require('react');
  const { Text } = require('react-native');
  return function MockProfileScreen() {
    return React.createElement(Text, null, 'Profile Setup');
  };
});

jest.mock('../src/lib/services/cache', () => ({
  CACHE_KEYS: {
    USER_PROFILE: 'cache_user_profile',
  },
  clearCache: () => mockClearCache(),
  getCached: (key: string) => mockGetCached(key),
  prefetchAllData: () => mockPrefetchAllData(),
}));

jest.mock('../src/lib/services/placeReminders', () => ({
  startLocationMonitoring: () => mockStartLocationMonitoring(),
  stopLocationMonitoring: () => mockStopLocationMonitoring(),
}));

jest.mock('../src/lib/services/notifications', () => ({
  initializeForegroundListener: jest.fn(() => jest.fn()),
}));

jest.mock('../src/lib/services/porter', () => ({
  initPorterDistanceCalculator: jest.fn(),
}));

beforeEach(() => {
  mockNetInfoListeners.length = 0;
  mockGetSession.mockResolvedValue({ data: { session: null } });
  mockGetUser.mockResolvedValue({ data: { user: null }, error: null });
  mockMaybeSingle.mockResolvedValue({ data: { full_name: 'Test User' }, error: null });
  mockFrom.mockImplementation(() => ({
    select: jest.fn(() => ({
      eq: jest.fn(() => ({
        maybeSingle: () => mockMaybeSingle(),
      })),
    })),
  }));
  mockOnAuthStateChange.mockReturnValue({
    data: {
      subscription: {
        unsubscribe: mockUnsubscribe,
      },
    },
  });
  mockUnsubscribe.mockClear();
  mockClearCache.mockClear();
  mockGetCached.mockClear();
  mockPrefetchAllData.mockClear();
  mockSyncOfflineTransactions.mockClear();
  mockStartLocationMonitoring.mockClear();
  mockStopLocationMonitoring.mockClear();
});

afterEach(async () => {
  await AsyncStorage.clear();
  mockGetSession.mockReset();
  mockGetUser.mockReset();
  mockFrom.mockReset();
  mockMaybeSingle.mockReset();
  mockOnAuthStateChange.mockReset();
});

const flushAuthBootstrap = async (cycles = 8) => {
  await ReactTestRenderer.act(async () => {
    for (let i = 0; i < cycles; i += 1) {
      await Promise.resolve();
    }
  });
};

const getRenderedText = (tree: ReactTestRenderer.ReactTestRenderer) =>
  tree.root.findAllByType(Text).map(node => String(node.props.children)).join(' ');

const waitForRenderedText = async (
  tree: ReactTestRenderer.ReactTestRenderer,
  expected: string,
  cycles = 12,
) => {
  for (let i = 0; i < cycles; i += 1) {
    if (getRenderedText(tree).includes(expected)) {
      return;
    }
    await flushAuthBootstrap(1);
  }
  expect(getRenderedText(tree)).toContain(expected);
};

test('renders correctly', async () => {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  await ReactTestRenderer.act(() => {
    tree = ReactTestRenderer.create(<App />);
  });
  await ReactTestRenderer.act(() => {
    tree.unmount();
  });
});

describe('cached profile route hints', () => {
  it('accepts a complete cached profile owned by the current user without requiring email', () => {
    expect(getCachedProfileRouteHint({
      userId: 'user-current',
      name: 'Current User',
    }, 'user-current')).toBe('complete');
  });

  it('rejects a complete cached profile owned by a different user', () => {
    expect(getCachedProfileRouteHint({
      userId: 'user-stale',
      name: 'Stale User',
    }, 'user-current')).toBeNull();
  });

  it('does not bypass profile setup when the cached name is missing', () => {
    expect(getCachedProfileRouteHint({
      userId: 'user-current',
      name: ' ',
    }, 'user-current')).toBeNull();
  });
});

describe('auth startup log privacy', () => {
  it('summarizes errors without retaining raw identity or session payloads', () => {
    expect(summarizeStartupError({
      code: 'PGRST123',
      name: 'PostgrestError',
      status: 400,
      message: 'failed for private@example.com',
      session: { access_token: 'raw-token' },
      profile: { full_name: 'Private Name' },
    })).toEqual({
      code: 'PGRST123',
      name: 'PostgrestError',
      status: 400,
    });
  });
});

describe('auth startup recovery', () => {
  it('routes to Auth screen when no restored session exists', async () => {
    let tree!: ReactTestRenderer.ReactTestRenderer;

    await ReactTestRenderer.act(async () => {
      tree = ReactTestRenderer.create(<App />);
    });
    await waitForRenderedText(tree, 'Login');

    const text = getRenderedText(tree);
    expect(text).toContain('Login');
    expect(text).not.toContain('MainApp');
    expect(mockPrefetchAllData).not.toHaveBeenCalled();
    expect(mockSyncOfflineTransactions).not.toHaveBeenCalled();

    await ReactTestRenderer.act(() => {
      tree.unmount();
    });
  });

  it('shows the auth loading screen while session restore is unresolved', async () => {
    let resolveSession!: (value: { data: { session: null } }) => void;
    mockGetSession.mockReturnValue(new Promise<{ data: { session: null } }>(resolve => {
      resolveSession = resolve;
    }));
    let tree!: ReactTestRenderer.ReactTestRenderer;

    await ReactTestRenderer.act(async () => {
      tree = ReactTestRenderer.create(<App />);
    });

    expect(tree.root.findByType(AuthLoadingScreen)).toBeTruthy();
    expect(tree.root.findByType(AppIntroScreen).props.readyToExit).toBe(false);
    expect(getRenderedText(tree)).toContain('Preparing your session');

    await ReactTestRenderer.act(async () => {
      resolveSession({ data: { session: null } });
      await Promise.resolve();
    });

    await ReactTestRenderer.act(() => {
      tree.unmount();
    });
  });

  it('renders MainApp and starts startup work only after session and user validate', async () => {
    const session = { user: { id: 'user-1' } };
    mockGetSession.mockResolvedValue({ data: { session } });
    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null });

    let tree!: ReactTestRenderer.ReactTestRenderer;
    await ReactTestRenderer.act(async () => {
      tree = ReactTestRenderer.create(<App />);
    });
    await waitForRenderedText(tree, 'MainApp');

    const text = getRenderedText(tree);
    expect(text).toContain('MainApp');
    expect(text).not.toContain('Login');
    expect(mockPrefetchAllData).toHaveBeenCalledTimes(1);
    expect(mockStartLocationMonitoring).toHaveBeenCalled();

    await ReactTestRenderer.act(() => {
      tree.unmount();
    });
  });

  it('uses offline-unverified app state when live user validation only fails because the network is unavailable', async () => {
    const session = { user: { id: 'user-1' } };
    await AsyncStorage.setItem('app_user_id', 'user-1');
    mockGetSession.mockResolvedValue({ data: { session } });
    mockGetUser.mockRejectedValue(new TypeError('Network request failed'));
    mockGetCached.mockResolvedValue({
      data: { userId: 'user-1', full_name: 'Cached User' },
      isStale: false,
    });

    let tree!: ReactTestRenderer.ReactTestRenderer;
    await ReactTestRenderer.act(async () => {
      tree = ReactTestRenderer.create(<App />);
    });
    await waitForRenderedText(tree, 'Offline mode');

    const text = getRenderedText(tree);
    expect(text).toContain('MainApp');
    expect(text).toContain('Offline mode. New transactions will sync when you are online.');
    expect(mockPrefetchAllData).not.toHaveBeenCalled();
    expect(mockClearCache).not.toHaveBeenCalled();

    await ReactTestRenderer.act(() => {
      tree.unmount();
    });
  });

  it('routes to Auth screen when restored session fails authenticated validation', async () => {
    const session = { user: { id: 'user-1' } };
    mockGetSession.mockResolvedValue({ data: { session } });
    mockGetUser.mockResolvedValue({
      data: { user: null },
      error: { message: 'JWT expired', status: 401 },
    });

    let tree!: ReactTestRenderer.ReactTestRenderer;
    await ReactTestRenderer.act(async () => {
      tree = ReactTestRenderer.create(<App />);
    });
    await waitForRenderedText(tree, 'Login');

    const text = getRenderedText(tree);
    expect(text).toContain('Login');
    expect(text).not.toContain('MainApp');
    expect(mockPrefetchAllData).not.toHaveBeenCalled();
    expect(mockClearCache).toHaveBeenCalled();

    await ReactTestRenderer.act(() => {
      tree.unmount();
    });
  });

  it('keeps Supabase auth callbacks synchronous to avoid auth-lock startup hangs', () => {
    jest.useFakeTimers();
    try {
      const callback = jest.fn();
      deferAuthStateChange(callback);

      expect(callback).not.toHaveBeenCalled();
      jest.advanceTimersByTime(0);
      expect(callback).toHaveBeenCalledTimes(1);
    } finally {
      jest.useRealTimers();
    }
  });

  it('verifies an offline-unverified user before syncing on network reconnect', async () => {
    const session = { user: { id: 'user-1' } };
    await AsyncStorage.setItem('app_user_id', 'user-1');
    mockGetSession.mockResolvedValue({ data: { session } });
    mockGetUser.mockRejectedValueOnce(new TypeError('Network request failed'));

    let tree!: ReactTestRenderer.ReactTestRenderer;
    await ReactTestRenderer.act(async () => {
      tree = ReactTestRenderer.create(<App />);
    });
    await waitForRenderedText(tree, 'Offline mode');
    expect(getRenderedText(tree)).toContain('Offline mode');
    expect(mockSyncOfflineTransactions).not.toHaveBeenCalled();

    mockGetUser.mockResolvedValueOnce({ data: { user: { id: 'user-1' } }, error: null });

    await ReactTestRenderer.act(async () => {
      mockNetInfoListeners[mockNetInfoListeners.length - 1]?.({ isConnected: true });
    });
    await flushAuthBootstrap();

    expect(mockGetUser).toHaveBeenCalledTimes(2);
    expect(mockSyncOfflineTransactions).toHaveBeenCalledTimes(1);

    await ReactTestRenderer.act(() => {
      tree.unmount();
    });
  });

  it('settles a hung startup promise with a bounded timeout', async () => {
    jest.useFakeTimers();
    try {
      const timeoutResult = expect(
        withStartupTimeout(new Promise(() => undefined), 25, 'Profile check')
      ).rejects.toThrow('Profile check timed out after 25ms');

      jest.advanceTimersByTime(25);
      await timeoutResult;
    } finally {
      jest.useRealTimers();
    }
  });

  it('renders retry and local startup-cache repair actions', async () => {
    const onRetry = jest.fn();
    const onClearLocalCache = jest.fn();
    let tree!: ReactTestRenderer.ReactTestRenderer;

    await ReactTestRenderer.act(() => {
      tree = ReactTestRenderer.create(
        <StartupRepairScreen onRetry={onRetry} onClearLocalCache={onClearLocalCache} />
      );
    });

    const text = tree.root.findAllByType(Text).map(node => node.props.children).join(' ');
    expect(text).toContain('Startup needs a retry');
    expect(text).toContain('Retry');
    expect(text).toContain('Clear local startup cache');

    await ReactTestRenderer.act(() => {
      tree.unmount();
    });
  });

  it('fails closed to Auth screen when session restore times out', async () => {
    jest.useFakeTimers();
    mockGetSession.mockReturnValue(new Promise(() => undefined));
    let tree!: ReactTestRenderer.ReactTestRenderer;

    try {
      await ReactTestRenderer.act(() => {
        tree = ReactTestRenderer.create(<App />);
      });

      await ReactTestRenderer.act(async () => {
        jest.advanceTimersByTime(4500);
        await Promise.resolve();
      });

      const text = getRenderedText(tree);
      expect(tree.root.findByType(AppIntroScreen).props.readyToExit).toBe(true);
      expect(text).toContain('Login');
      expect(text).not.toContain('MainApp');
      expect(mockPrefetchAllData).not.toHaveBeenCalled();
    } finally {
      await ReactTestRenderer.act(() => {
        tree?.unmount();
      });
      jest.useRealTimers();
    }
  });
});
