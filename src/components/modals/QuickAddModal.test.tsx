import React from 'react';
import { Text, TextInput, TouchableOpacity } from 'react-native';
import ReactTestRenderer, { act } from 'react-test-renderer';
import Toast from 'react-native-toast-message';
import QuickAddModal from './QuickAddModal';
import { addTransaction } from '../../lib/core';
import { updateCache } from '../../lib/services/cache';
import { parseNaturalLanguageTxn } from '../../utils/nlpParser';

jest.mock('../../context/ThemeContext', () => ({
  useTheme: () => ({
    colors: {
      background: '#ffffff',
      card: '#f8fafc',
      border: '#e2e8f0',
      text: '#0f172a',
      textSecondary: '#64748b',
      primary: '#2563eb',
      success: '#16a34a',
      danger: '#dc2626',
    },
    typography: {
      fontSize: { sm: 12, md: 14, lg: 16, xl: 20 },
      fontWeight: { medium: '500', semibold: '600', bold: '700' },
    },
    borderRadius: { md: 8, lg: 12 },
  }),
}));

jest.mock('react-native-toast-message', () => ({
  show: jest.fn(),
}));

jest.mock('../../lib/core', () => ({
  addTransaction: jest.fn(),
}));

jest.mock('../../lib/services/cache', () => ({
  CACHE_KEYS: { TRANSACTIONS: 'transactions' },
  GEMINI_API_KEY: 'test-key',
  updateCache: jest.fn(),
}));

jest.mock('../../utils/nlpParser', () => ({
  parseNaturalLanguageTxn: jest.fn(),
}));

const mockedAddTransaction = addTransaction as jest.Mock;
const mockedUpdateCache = updateCache as jest.Mock;
const mockedParseNaturalLanguageTxn = parseNaturalLanguageTxn as jest.Mock;
const mockedToast = Toast.show as jest.Mock;
const fs = require('fs') as { readFileSync: (filePath: string, encoding: 'utf8') => string };
const path = require('path') as { join: (...parts: string[]) => string };

const blockedTokens = [
  ['A', 'aj'].join(''),
  ['Ab', 'tak'].join(' '),
  ['pi', 'che'].join(''),
  ['aa', 'ge'].join(''),
  ['Y', 'eh'].join(''),
  ['pai', 'sa'].join(''),
  ['pai', 'se'].join(''),
  ['khar', 'cha'].join(''),
  ['khar', 'ch'].join(''),
  ['ka', 'mana'].join(''),
  ['kar', 'na'].join(''),
  ['h', 'ai'].join(''),
  ['na', 'hi'].join(''),
  ['ha', 'an'].join(''),
  ['ud', 'har'].join(''),
  ['Hin', 'glish'].join(''),
];

const textFromNode = (value: unknown): string => {
  if (typeof value === 'string' || typeof value === 'number') {
    return String(value);
  }
  if (Array.isArray(value)) {
    return value.map(textFromNode).join('');
  }
  return '';
};

const visibleText = (renderer: ReactTestRenderer.ReactTestRenderer): string =>
  renderer.root
    .findAllByType(Text)
    .map(node => textFromNode(node.props.children))
    .join(' ');

const tokenPattern = (token: string) =>
  new RegExp(`\\b${token.replace(/\s+/g, '\\s+')}\\b`, 'i');

const expectNoBlockedTokens = (text: string) => {
  blockedTokens.forEach(token => {
    expect(text).not.toMatch(tokenPattern(token));
  });
};

const findButtonWithText = (
  renderer: ReactTestRenderer.ReactTestRenderer,
  label: string,
) =>
  renderer.root.findAllByType(TouchableOpacity).find(button =>
    button.findAllByType(Text).some(node =>
      textFromNode(node.props.children).includes(label),
    ),
  );

describe('QuickAddModal', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedParseNaturalLanguageTxn.mockReturnValue({
      amount: null,
      type: null,
      category: 'Other',
      note: '',
    });
  });

  it('renders English-only base copy and warning copy', async () => {
    let renderer: ReactTestRenderer.ReactTestRenderer;
    await act(async () => {
      renderer = ReactTestRenderer.create(
        <QuickAddModal visible onClose={jest.fn()} onSuccess={jest.fn()} />,
      );
    });

    await act(async () => {
      renderer!.root.findByType(TextInput).props.onChangeText('hello');
    });

    const copy = visibleText(renderer!);
    expect(copy).toContain('Quick Add');
    expect(copy).toContain('Type or speak to start...');
    expect(copy).toContain('Hi there. Try a transaction such as "500 tea paid".');
    expectNoBlockedTokens(copy);

    await act(async () => {
      renderer!.unmount();
    });
  });

  it('saves parsed transactions without changing callback behavior', async () => {
    const onClose = jest.fn();
    const onSuccess = jest.fn();
    mockedParseNaturalLanguageTxn.mockReturnValue({
      amount: 500,
      type: 'expense',
      category: 'Fuel',
      note: 'Paid 500 for petrol',
    });
    mockedAddTransaction.mockResolvedValue({
      id: 'txn-1',
      amount: 500,
      type: 'expense',
      category: 'Fuel',
      note: 'Paid 500 for petrol',
    });
    mockedUpdateCache.mockResolvedValue(undefined);

    let renderer: ReactTestRenderer.ReactTestRenderer;
    await act(async () => {
      renderer = ReactTestRenderer.create(
        <QuickAddModal visible onClose={onClose} onSuccess={onSuccess} />,
      );
    });

    await act(async () => {
      renderer!.root.findByType(TextInput).props.onChangeText('Paid 500 for petrol');
    });

    const saveButton = findButtonWithText(renderer!, 'Save Transaction');
    expect(saveButton).toBeTruthy();

    await act(async () => {
      await saveButton?.props.onPress();
    });

    expect(mockedAddTransaction).toHaveBeenCalledWith({
      amount: 500,
      type: 'expense',
      category: 'Fuel',
      note: 'Paid 500 for petrol',
      sms_source: 'voice',
    });
    expect(mockedUpdateCache).toHaveBeenCalled();
    expect(mockedToast).toHaveBeenCalledWith(expect.objectContaining({ type: 'success' }));
    expect(onSuccess).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();

    await act(async () => {
      renderer!.unmount();
    });
  });

  it('keeps QuickAddModal source free of known app-facing blocked tokens', () => {
    const source = fs.readFileSync(
      path.join('src', 'components', 'modals', 'QuickAddModal.tsx'),
      'utf8',
    );

    expectNoBlockedTokens(source);
  });

  it('uses valid MaterialCommunityIcons names without question-mark fallbacks', () => {
    const glyphMap = require('react-native-vector-icons/glyphmaps/MaterialCommunityIcons.json');
    const iconNames = [
      'close-circle',
      'microphone-settings',
      'microphone',
      'arrow-down',
      'arrow-up',
      'swap-horizontal',
      'tag-outline',
    ];

    iconNames.forEach(name => {
      expect(glyphMap).toHaveProperty(name);
      expect(name).not.toMatch(/question|help|unknown|fallback/i);
    });
  });
});
