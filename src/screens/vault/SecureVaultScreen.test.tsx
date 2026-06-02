import React from 'react';
import { Clipboard, Text, TouchableOpacity } from 'react-native';
import ReactTestRenderer, { act } from 'react-test-renderer';
import Toast from 'react-native-toast-message';
import SecureVaultScreen from './SecureVaultScreen';
import { getVaultItems } from '../../lib/database/vaultDb';
import { setVaultSecureWindow } from '../../lib/services/vaultSecurity';

const fs = require('fs') as { readFileSync: (filePath: string, encoding: 'utf8') => string };

const mockIsSensorAvailable = jest.fn();
const mockSimplePrompt = jest.fn();

jest.mock('react-native-biometrics', () => jest.fn().mockImplementation(() => ({
  isSensorAvailable: mockIsSensorAvailable,
  simplePrompt: mockSimplePrompt,
})));

jest.mock('react-native-vector-icons/MaterialCommunityIcons', () => {
  const React = require('react');
  const RN = require('react-native');
  return (props: any) => <RN.Text {...props}>{props.name}</RN.Text>;
});

jest.mock('react-native-toast-message', () => {
  const ToastComponent = () => null;
  return Object.assign(ToastComponent, {
    hide: jest.fn(),
    show: jest.fn(),
  });
});

jest.mock('react-native-haptic-feedback', () => ({
  trigger: jest.fn(),
}));

jest.mock('../../components', () => ({
  ScreenWrapper: ({ children }: { children: React.ReactNode }) => {
    const RN = require('react-native');
    return <RN.View>{children}</RN.View>;
  },
  Card: ({ children }: { children: React.ReactNode }) => {
    const RN = require('react-native');
    return <RN.View>{children}</RN.View>;
  },
  AppHeader: ({ title }: { title: string }) => {
    const RN = require('react-native');
    return <RN.Text>{title}</RN.Text>;
  },
  AppButton: ({ title, onPress, disabled }: { title: string; onPress: () => void; disabled?: boolean }) => {
    const RN = require('react-native');
    return (
      <RN.TouchableOpacity onPress={disabled ? undefined : onPress}>
        <RN.Text>{title}</RN.Text>
      </RN.TouchableOpacity>
    );
  },
  AppConfirmModal: () => null,
}));

jest.mock('../../context/ThemeContext', () => ({
  useTheme: () => ({
    colors: {
      accent: '#7c3aed',
      background: '#f8fafc',
      border: '#e5e7eb',
      card: '#ffffff',
      subtext: '#6b7280',
      text: '#111827',
    },
    typography: {
      h2: { fontSize: 22 },
      h3: { fontSize: 18 },
      body: { fontSize: 16 },
      bodyBold: { fontSize: 16, fontWeight: '700' },
      caption: { fontSize: 12 },
    },
    spacing: { sm: 8, md: 16, lg: 24, xl: 32 },
    borderRadius: { md: 8, lg: 8 },
  }),
}));

jest.mock('@react-navigation/native', () => ({
  useFocusEffect: (callback: () => void | (() => void)) => {
    const React = require('react');
    React.useEffect(() => callback(), [callback]);
  },
}));

jest.mock('../../lib/database/vaultDb', () => ({
  addVaultItem: jest.fn(),
  deleteVaultItem: jest.fn(),
  getVaultItems: jest.fn(),
  updateVaultItem: jest.fn(),
}));

jest.mock('../../lib/services/cache', () => ({
  CACHE_KEYS: { VAULT_ITEMS: 'cache_vault_items' },
  removeCache: jest.fn(),
}));

jest.mock('../../lib/services/vaultSecurity', () => ({
  setVaultSecureWindow: jest.fn(() => Promise.resolve(true)),
}));

const mockedGetVaultItems = getVaultItems as jest.Mock;
const mockedSetVaultSecureWindow = setVaultSecureWindow as jest.Mock;
const mockedToast = Toast.show as jest.Mock;

function textFromNode(value: unknown): string {
  if (typeof value === 'string' || typeof value === 'number') return String(value);
  if (Array.isArray(value)) return value.map(textFromNode).join('');
  return '';
}

function renderedText(renderer: ReactTestRenderer.ReactTestRenderer): string {
  return renderer.root
    .findAllByType(Text)
    .map(node => textFromNode(node.props.children))
    .join(' ');
}

async function renderVault() {
  let renderer: ReactTestRenderer.ReactTestRenderer | undefined;
  await act(async () => {
    renderer = ReactTestRenderer.create(<SecureVaultScreen />);
  });
  await act(async () => {
    await Promise.resolve();
  });
  return renderer!;
}

function touchableByText(renderer: ReactTestRenderer.ReactTestRenderer, text: string) {
  return renderer.root.findAllByType(TouchableOpacity).find(button =>
    button.findAllByType(Text).some(node => textFromNode(node.props.children).includes(text)),
  );
}

function touchableByIcon(renderer: ReactTestRenderer.ReactTestRenderer, iconName: string) {
  return renderer.root.findAllByType(TouchableOpacity).find(button =>
    button.findAllByType(Text).some(node => node.props.name === iconName),
  );
}

describe('SecureVaultScreen emergency hardening', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useRealTimers();
    (Clipboard as any).setString = jest.fn();
    (Clipboard as any).getString = jest.fn();
    mockIsSensorAvailable.mockResolvedValue({ available: true });
    mockSimplePrompt.mockResolvedValue({ success: true });
    mockedGetVaultItems.mockResolvedValue([]);
  });

  it('keeps Vault locked when biometrics are unavailable', async () => {
    mockIsSensorAvailable.mockResolvedValueOnce({ available: false });
    mockedGetVaultItems.mockResolvedValueOnce([{
      id: 'vault_1',
      title: 'Should Not Render',
      category: 'other',
      fields: [],
      notes: '',
      createdAt: '2026-06-02T00:00:00.000Z',
      updatedAt: '2026-06-02T00:00:00.000Z',
    }]);

    const renderer = await renderVault();
    const text = renderedText(renderer);

    expect(text).toContain('Vault is Locked');
    expect(text).toContain('Vault lock is unavailable on this device. Set up biometrics or use a future app PIN.');
    expect(text).not.toContain('Should Not Render');
    expect(mockedGetVaultItems).not.toHaveBeenCalled();
  });

  it('does not auto-unlock without biometric success or PIN fallback', async () => {
    mockIsSensorAvailable.mockResolvedValueOnce({ available: true });
    mockSimplePrompt.mockResolvedValueOnce({ success: false });

    const renderer = await renderVault();
    const text = renderedText(renderer);

    expect(text).toContain('Vault is Locked');
    expect(text).not.toContain('Your Digital Safe');
    expect(mockedGetVaultItems).not.toHaveBeenCalled();
  });

  it('invokes secure-window protection while Vault is active', async () => {
    const renderer = await renderVault();

    expect(mockedSetVaultSecureWindow).toHaveBeenCalledWith(true);

    await act(async () => {
      renderer.unmount();
    });

    expect(mockedSetVaultSecureWindow).toHaveBeenCalledWith(false);
  });

  it('copies a secret with a safe notice and clears clipboard without logging the value', async () => {
    jest.useFakeTimers();
    const logSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const secretValue = 'Codex40D Secret Value';
    (Clipboard as any).getString.mockResolvedValue(secretValue);
    mockedGetVaultItems.mockResolvedValueOnce([{
      id: 'vault_1',
      title: 'Codex40D Item',
      category: 'other',
      fields: [{ label: 'Password', value: secretValue, isSecret: true }],
      notes: '',
      createdAt: '2026-06-02T00:00:00.000Z',
      updatedAt: '2026-06-02T00:00:00.000Z',
    }]);

    try {
      const renderer = await renderVault();
      const itemButton = touchableByText(renderer, 'Codex40D Item');
      expect(itemButton).toBeDefined();

      await act(async () => {
        itemButton!.props.onPress();
      });

      const copyButton = touchableByIcon(renderer, 'content-copy');
      expect(copyButton).toBeDefined();

      await act(async () => {
        copyButton!.props.onPress();
      });

      expect(Clipboard.setString).toHaveBeenCalledWith(secretValue);
      expect(mockedToast).toHaveBeenCalledWith(expect.objectContaining({
        type: 'info',
        text1: 'Copied',
        text2: 'Copied. Clipboard will be cleared soon.',
      }));

      await act(async () => {
        jest.advanceTimersByTime(15_000);
        await Promise.resolve();
      });

      expect(Clipboard.setString).toHaveBeenLastCalledWith('');
      expect(JSON.stringify(logSpy.mock.calls)).not.toContain(secretValue);
    } finally {
      logSpy.mockRestore();
      jest.useRealTimers();
    }
  });

  it('logs Vault load errors structurally without secret values', async () => {
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    mockedGetVaultItems.mockRejectedValueOnce({
      name: 'PostgrestError',
      code: 'PGRST500',
      message: 'Codex40D Secret Value leaked in error',
    });

    try {
      await renderVault();

      const logs = JSON.stringify(errorSpy.mock.calls);
      expect(logs).toContain('PostgrestError');
      expect(logs).toContain('PGRST500');
      expect(logs).not.toContain('Codex40D Secret Value');
      expect(logs).not.toContain('leaked in error');
    } finally {
      errorSpy.mockRestore();
    }
  });

  it('uses English-only emergency copy and no question-mark fallback icons', () => {
    const source = fs.readFileSync('src/screens/vault/SecureVaultScreen.tsx', 'utf8');

    expect(source).toContain('Vault lock is unavailable on this device. Set up biometrics or use a future app PIN.');
    expect(source).toContain('Copied. Clipboard will be cleared soon.');
    expect(source).not.toMatch(/name=["']\?["']/);
  });
});
