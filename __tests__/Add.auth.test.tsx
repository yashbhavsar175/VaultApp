import React from 'react';
import { Text, TextInput, TouchableOpacity } from 'react-native';
import ReactTestRenderer from 'react-test-renderer';
import Toast from 'react-native-toast-message';
import Add from '../src/screens/transactions/Add';

const mockNavigate = jest.fn();
const mockGetSession = jest.fn();
const mockGetUser = jest.fn();
const mockSignOut = jest.fn(() => Promise.resolve());
const mockAddTransaction = jest.fn();
const mockClearCache = jest.fn(() => Promise.resolve());
const mockGetCached = jest.fn((_key?: string): Promise<any> => Promise.resolve(null));
const mockSetCache = jest.fn((_key?: string, _data?: unknown) => Promise.resolve());
const mockUpdateCache = jest.fn((_key?: string, _updater?: unknown) => Promise.resolve());
const mockGetBankAccounts = jest.fn(() => Promise.resolve([]));
const mockAppendQueueItem = jest.fn((_baseKey?: string, _userId?: string, _item?: unknown) => Promise.resolve());
const mockNetInfoFetch = jest.fn(() => Promise.resolve({ isConnected: true }));

jest.mock('@react-native-community/netinfo', () => ({
  fetch: () => mockNetInfoFetch(),
}));

jest.mock('react-native-toast-message', () => ({
  __esModule: true,
  default: {
    show: jest.fn(),
    hide: jest.fn(),
  },
}));

jest.mock('@react-navigation/native', () => {
  const React = require('react');
  return {
    useNavigation: () => ({ navigate: mockNavigate }),
    useFocusEffect: (callback: () => void | (() => void)) => {
      React.useEffect(() => callback(), [callback]);
    },
  };
});

jest.mock('../src/lib/core', () => ({
  supabase: {
    auth: {
      getSession: () => mockGetSession(),
      getUser: () => mockGetUser(),
      signOut: () => mockSignOut(),
    },
  },
  addTransaction: (transaction: unknown) => mockAddTransaction(transaction),
  getUniqueCategories: jest.fn(() => Promise.resolve([])),
  parseTransactionWithAI: jest.fn(),
}));

jest.mock('../src/lib/services/cache', () => ({
  CACHE_KEYS: {
    BANK_ACCOUNTS: 'cache_bank_accounts',
    TRANSACTIONS: 'cache_transactions',
    UNIQUE_CATEGORIES: 'cache_unique_categories',
  },
  clearCache: () => mockClearCache(),
  getCached: (key: string) => mockGetCached(key),
  setCache: (key: string, data: unknown) => mockSetCache(key, data),
  updateCache: (key: string, updater: unknown) => mockUpdateCache(key, updater),
}));

jest.mock('../src/lib/database/financial', () => ({
  getBankAccounts: () => mockGetBankAccounts(),
}));

jest.mock('../src/lib/services/userScopedQueues', () => ({
  OFFLINE_TX_QUEUE_BASE_KEY: 'offline_transactions',
  appendUserScopedQueueItem: (baseKey: string, userId: string, item: unknown) => mockAppendQueueItem(baseKey, userId, item),
}));

jest.mock('../src/lib/services/dataEvents', () => ({
  emitFinanceDataChanged: jest.fn(),
}));

jest.mock('../src/utils/runWhenIdle', () => ({
  runWhenIdle: (callback: () => void) => {
    callback();
    return { cancel: jest.fn() };
  },
}));

jest.mock('../src/context/ThemeContext', () => ({
  useTheme: () => ({
    colors: {
      accent: '#8b5cf6',
      background: '#050509',
      border: '#27272a',
      card: '#111827',
      error: '#ef4444',
      subtext: '#94a3b8',
      text: '#ffffff',
    },
    typography: {
      body: {},
      bodyBold: {},
      caption: {},
      h3: {},
    },
    spacing: {
      xs: 4,
      sm: 8,
      md: 12,
      lg: 16,
    },
    borderRadius: {
      sm: 6,
      md: 8,
      full: 999,
    },
  }),
}));

jest.mock('../src/components', () => {
  const React = require('react');
  const { Text, TouchableOpacity, View } = require('react-native');
  return {
    ScreenWrapper: ({ children }: { children: React.ReactNode }) => React.createElement(View, null, children),
    Card: ({ children }: { children: React.ReactNode }) => React.createElement(View, null, children),
    AppHeader: ({ title }: { title: string }) => React.createElement(Text, null, title),
    AppButton: ({
      title,
      onPress,
      disabled,
    }: {
      title: string;
      onPress: () => void;
      disabled?: boolean;
    }) => React.createElement(TouchableOpacity, { onPress, disabled }, React.createElement(Text, null, title)),
  };
});

const mockedToastShow = Toast.show as jest.Mock;

beforeEach(() => {
  mockNavigate.mockClear();
  mockGetSession.mockResolvedValue({ data: { session: null } });
  mockGetUser.mockResolvedValue({ data: { user: null }, error: null });
  mockSignOut.mockClear();
  mockAddTransaction.mockClear();
  mockClearCache.mockClear();
  mockGetCached.mockClear();
  mockSetCache.mockClear();
  mockUpdateCache.mockClear();
  mockGetBankAccounts.mockClear();
  mockAppendQueueItem.mockClear();
  mockNetInfoFetch.mockReset();
  mockNetInfoFetch.mockResolvedValue({ isConnected: true });
  mockedToastShow.mockClear();
});

const flush = async () => {
  await ReactTestRenderer.act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
};

const findButtonByText = (tree: ReactTestRenderer.ReactTestRenderer, label: string) =>
  tree.root.findAllByType(TouchableOpacity).find(node =>
    node.findAllByType(Text).some(textNode => textNode.props.children === label)
  );

it('blocks manual save without an authenticated Supabase user', async () => {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  await ReactTestRenderer.act(async () => {
    tree = ReactTestRenderer.create(<Add />);
  });
  await flush();

  const inputs = tree.root.findAllByType(TextInput);
  await ReactTestRenderer.act(async () => {
    inputs[0].props.onChangeText('100');
    inputs[1].props.onChangeText('Lunch');
  });

  const saveButton = findButtonByText(tree, 'Save');
  expect(saveButton).toBeTruthy();

  await ReactTestRenderer.act(async () => {
    saveButton?.props.onPress();
    await Promise.resolve();
  });

  expect(mockAddTransaction).not.toHaveBeenCalled();
  expect(mockAppendQueueItem).not.toHaveBeenCalled();
  expect(mockClearCache).toHaveBeenCalled();
  expect(mockSignOut).toHaveBeenCalled();
  expect(mockedToastShow).toHaveBeenCalledWith(expect.objectContaining({
    type: 'error',
    text1: 'Login required',
  }));
});

it('saves manual transactions to the user-scoped offline queue when session validation fails due to network', async () => {
  mockGetSession.mockResolvedValue({ data: { session: { user: { id: 'user-offline' } } } });
  mockGetUser.mockRejectedValue(new TypeError('Network request failed'));
  mockGetCached.mockResolvedValue(null);
  mockNetInfoFetch.mockResolvedValue({ isConnected: false });

  let tree!: ReactTestRenderer.ReactTestRenderer;
  await ReactTestRenderer.act(async () => {
    tree = ReactTestRenderer.create(<Add />);
  });
  await flush();

  const inputs = tree.root.findAllByType(TextInput);
  await ReactTestRenderer.act(async () => {
    inputs[0].props.onChangeText('250');
    inputs[1].props.onChangeText('Offline lunch');
  });

  const saveButton = findButtonByText(tree, 'Save');
  expect(saveButton).toBeTruthy();

  await ReactTestRenderer.act(async () => {
    saveButton?.props.onPress();
    await Promise.resolve();
    await Promise.resolve();
  });

  expect(mockAppendQueueItem).toHaveBeenCalledWith(
    'offline_transactions',
    'user-offline',
    expect.objectContaining({
      amount: 250,
      note: 'Offline lunch',
      type: 'expense',
      category: 'general',
      client_idempotency_key: expect.any(String),
    }),
  );
  expect(mockUpdateCache).toHaveBeenCalledWith(
    'cache_transactions',
    expect.any(Function),
  );
  const transactionCacheUpdate = mockUpdateCache.mock.calls.find(([key]) => key === 'cache_transactions');
  const cachedRows = transactionCacheUpdate?.[1] instanceof Function
    ? transactionCacheUpdate[1]([])
    : [];
  expect(cachedRows[0]).not.toHaveProperty('sms_source');
  expect(mockAddTransaction).not.toHaveBeenCalled();
  expect(mockClearCache).not.toHaveBeenCalled();
  expect(mockSignOut).not.toHaveBeenCalled();
  expect(mockedToastShow).toHaveBeenCalledWith(expect.objectContaining({
    type: 'info',
    text1: 'Saved offline',
  }));
});

it('does not allow manual offline saves when the cached session fails with an auth error', async () => {
  mockGetSession.mockResolvedValue({ data: { session: { user: { id: 'user-expired' } } } });
  mockGetUser.mockResolvedValue({
    data: { user: null },
    error: { message: 'JWT expired', status: 401 },
  });

  let tree!: ReactTestRenderer.ReactTestRenderer;
  await ReactTestRenderer.act(async () => {
    tree = ReactTestRenderer.create(<Add />);
  });
  await flush();

  const inputs = tree.root.findAllByType(TextInput);
  await ReactTestRenderer.act(async () => {
    inputs[0].props.onChangeText('100');
    inputs[1].props.onChangeText('Expired session save');
  });

  const saveButton = findButtonByText(tree, 'Save');
  await ReactTestRenderer.act(async () => {
    saveButton?.props.onPress();
    await Promise.resolve();
  });

  expect(mockAppendQueueItem).not.toHaveBeenCalled();
  expect(mockAddTransaction).not.toHaveBeenCalled();
  expect(mockClearCache).toHaveBeenCalled();
  expect(mockSignOut).toHaveBeenCalled();
  expect(mockedToastShow).toHaveBeenCalledWith(expect.objectContaining({
    type: 'error',
    text1: 'Login required',
  }));
});
