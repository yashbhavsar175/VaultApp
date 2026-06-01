/**
 * @format
 */

import React from 'react';
import { Text } from 'react-native';
import ReactTestRenderer from 'react-test-renderer';
import AppIntroScreen from '../src/screens/intro/AppIntroScreen';
import App, {
  deferAuthStateChange,
  getCachedProfileRouteHint,
  StartupRepairScreen,
  summarizeStartupError,
  withStartupTimeout,
} from '../App';

const mockGetSession = jest.fn();
const mockOnAuthStateChange = jest.fn();
const mockUnsubscribe = jest.fn();

jest.mock('../src/lib/core', () => ({
  supabase: {
    auth: {
      getSession: (...args: unknown[]) => mockGetSession(...args),
      onAuthStateChange: (...args: unknown[]) => mockOnAuthStateChange(...args),
    },
  },
  configureGoogleSignIn: jest.fn(),
  syncOfflineTransactions: jest.fn(() => Promise.resolve()),
}));

beforeEach(() => {
  mockGetSession.mockResolvedValue({ data: { session: null } });
  mockOnAuthStateChange.mockReturnValue({
    data: {
      subscription: {
        unsubscribe: mockUnsubscribe,
      },
    },
  });
  mockUnsubscribe.mockClear();
});

afterEach(() => {
  mockGetSession.mockReset();
  mockOnAuthStateChange.mockReset();
});

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

  it('keeps startup pending after session-load timeout until the repair watchdog takes over', async () => {
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

      let text = tree.root.findAllByType(Text).map(node => node.props.children).join(' ');
      expect(text).toContain('Preparing your session');
      expect(text).not.toContain('Startup needs a retry');

      await ReactTestRenderer.act(async () => {
        jest.advanceTimersByTime(3500);
        await Promise.resolve();
      });

      expect(tree.root.findByType(AppIntroScreen).props.readyToExit).toBe(true);
      text = tree.root.findAllByType(Text).map(node => node.props.children).join(' ');
      expect(text).toContain('Preparing your session');
      expect(text).not.toContain('Login');
    } finally {
      await ReactTestRenderer.act(() => {
        tree?.unmount();
      });
      jest.useRealTimers();
    }
  });
});
