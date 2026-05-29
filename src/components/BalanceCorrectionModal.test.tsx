import React from 'react';
import { Modal, Text, TextInput, TouchableOpacity } from 'react-native';
import ReactTestRenderer from 'react-test-renderer';
import Toast from 'react-native-toast-message';
import BalanceCorrectionModal from './BalanceCorrectionModal';
import { createManualBalanceCorrectionSnapshot } from '../lib/services/balanceSnapshots';

jest.mock('../context/ThemeContext', () => ({
  useTheme: () => ({
    colors: {
      background: '#f5f5f5',
      card: '#ffffff',
      text: '#111111',
      subtext: '#666666',
      accent: '#7c3aed',
      border: '#e5e7eb',
      error: '#ef4444',
    },
    typography: {
      h3: { fontSize: 18, fontWeight: '600' },
      body: { fontSize: 16, fontWeight: '400' },
      bodyBold: { fontSize: 16, fontWeight: '600' },
      caption: { fontSize: 12, fontWeight: '400' },
    },
    spacing: { xs: 4, sm: 8, md: 16 },
  }),
}));

jest.mock('react-native-toast-message', () => ({
  show: jest.fn(),
}));

jest.mock('../lib/services/balanceSnapshots', () => {
  const actual = jest.requireActual('../lib/services/balanceSnapshots');
  return {
    ...actual,
    createManualBalanceCorrectionSnapshot: jest.fn(),
  };
});

const mockedCreateManualSnapshot = createManualBalanceCorrectionSnapshot as jest.Mock;

function renderModal(overrides = {}) {
  return ReactTestRenderer.create(
    <BalanceCorrectionModal
      visible
      ownerType="bank_account"
      ownerId="bank_1"
      ownerDisplayName="HDFC Bank •••• 1234"
      accountLast4="1234"
      detectedBankName="HDFC Bank"
      kindOptions={[
        { kind: 'available_balance', label: 'Available' },
        { kind: 'current_balance', label: 'Current' },
      ]}
      defaultKind="available_balance"
      onClose={jest.fn()}
      onSaved={jest.fn()}
      {...overrides}
    />
  );
}

function findSaveButton(root: ReactTestRenderer.ReactTestInstance) {
  const buttons = root.findAllByType(TouchableOpacity);
  const button = buttons.find(item =>
    item.findAllByType(Text).some(text => text.props.children === 'Save Balance')
  );
  if (!button) throw new Error('Save button not found');
  return button;
}

describe('BalanceCorrectionModal', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('disables save while the amount is empty or invalid', () => {
    let renderer: ReactTestRenderer.ReactTestRenderer;
    ReactTestRenderer.act(() => {
      renderer = renderModal();
    });

    const root = renderer!.root;
    expect(findSaveButton(root).props.disabled).toBe(true);

    ReactTestRenderer.act(() => {
      root.findAllByType(TextInput)[0].props.onChangeText('-1');
    });
    expect(findSaveButton(root).props.disabled).toBe(true);

    ReactTestRenderer.act(() => {
      root.findAllByType(TextInput)[0].props.onChangeText('123.45');
    });
    expect(findSaveButton(root).props.disabled).toBe(false);
  });

  it('does not write anything when cancelled', () => {
    const onClose = jest.fn();
    let renderer: ReactTestRenderer.ReactTestRenderer;
    ReactTestRenderer.act(() => {
      renderer = renderModal({ onClose });
    });

    ReactTestRenderer.act(() => {
      renderer!.root.findByType(Modal).props.onRequestClose();
    });

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(mockedCreateManualSnapshot).not.toHaveBeenCalled();
  });

  it('keeps the modal in retry state when snapshot write fails', async () => {
    mockedCreateManualSnapshot.mockRejectedValueOnce(new Error('insert failed'));
    const onClose = jest.fn();
    const onSaved = jest.fn();
    let renderer: ReactTestRenderer.ReactTestRenderer;

    ReactTestRenderer.act(() => {
      renderer = renderModal({ onClose, onSaved });
    });

    await ReactTestRenderer.act(async () => {
      renderer!.root.findAllByType(TextInput)[0].props.onChangeText('100');
    });
    await ReactTestRenderer.act(async () => {
      await findSaveButton(renderer!.root).props.onPress();
    });

    expect(mockedCreateManualSnapshot).toHaveBeenCalledWith(expect.objectContaining({
      owner_type: 'bank_account',
      owner_id: 'bank_1',
      balance_kind: 'available_balance',
      amount: 100,
    }));
    expect(onSaved).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    expect(Toast.show).toHaveBeenCalledWith(expect.objectContaining({
      type: 'error',
      text1: 'Could not update balance',
    }));
    expect(renderer!.root.findAllByType(Text).some(text =>
      text.props.children === 'Could not update balance. Try again.'
    )).toBe(true);
  });
});
