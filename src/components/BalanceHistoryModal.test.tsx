import React from 'react';
import { Modal, Text } from 'react-native';
import ReactTestRenderer from 'react-test-renderer';
import BalanceHistoryModal from './BalanceHistoryModal';

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
      h2: { fontSize: 22, fontWeight: '700' },
      h3: { fontSize: 18, fontWeight: '600' },
      body: { fontSize: 16, fontWeight: '400' },
      bodyBold: { fontSize: 16, fontWeight: '600' },
      caption: { fontSize: 12, fontWeight: '400' },
    },
    spacing: { xs: 4, sm: 8, md: 16 },
  }),
}));

function textNodes(renderer: ReactTestRenderer.ReactTestRenderer): string[] {
  return renderer.root
    .findAllByType(Text)
    .map(node => node.props.children)
    .flat(4)
    .filter((value): value is string => typeof value === 'string');
}

describe('BalanceHistoryModal', () => {
  it('renders history source and confidence without raw metadata', () => {
    let renderer: ReactTestRenderer.ReactTestRenderer;

    ReactTestRenderer.act(() => {
      renderer = ReactTestRenderer.create(
        <BalanceHistoryModal
          visible
          title="HDFC Bank"
          subtitle="Savings ••2621"
          balanceLabel="Displayed balance"
          balanceAmount={1234.56}
          balanceKindLabel="Available"
          sourceLabel="SMS"
          confidenceLabel="Exact"
          freshnessLabel="Just now"
          history={[
            {
              id: 'snap_1',
              balanceKind: 'available_balance',
              balanceKindLabel: 'Available',
              amount: 1234.56,
              source: 'sms',
              confidence: 'exact',
              detectedAt: '2026-05-29T08:00:00.000Z',
              freshnessLabel: 'Just now',
              sourceLabel: 'SMS',
              confidenceLabel: 'Exact',
              noteSafe: 'Manual check',
            },
          ]}
          metrics={[{ label: 'Type', value: 'Savings' }]}
          onClose={jest.fn()}
          onUpdateBalance={jest.fn()}
        />
      );
    });

    const visibleText = textNodes(renderer!);
    expect(visibleText).toContain('Recent History');
    expect(visibleText).toContain('SMS');
    expect(visibleText).toContain('Exact');
    expect(visibleText).toContain('Just now');
    expect(visibleText).toContain('Manual check');
    expect(visibleText.join(' ')).not.toMatch(/raw_source_metadata|raw payload|otp|phone|address/i);
  });

  it('does not show a delta between mixed balance kinds', () => {
    let renderer: ReactTestRenderer.ReactTestRenderer;

    ReactTestRenderer.act(() => {
      renderer = ReactTestRenderer.create(
        <BalanceHistoryModal
          visible
          title="HDFC Bank"
          balanceLabel="Outstanding"
          balanceAmount={1200}
          balanceKindLabel="Outstanding"
          sourceLabel="SMS"
          confidenceLabel="Exact"
          freshnessLabel="Just now"
          history={[
            {
              id: 'outstanding',
              balanceKind: 'outstanding',
              balanceKindLabel: 'Outstanding',
              amount: 1200,
              source: 'sms',
              confidence: 'exact',
              detectedAt: '2026-05-29T08:00:00.000Z',
              freshnessLabel: 'Just now',
              sourceLabel: 'SMS',
              confidenceLabel: 'Exact',
              noteSafe: null,
            },
            {
              id: 'available_limit',
              balanceKind: 'available_limit',
              balanceKindLabel: 'Available Limit',
              amount: 40000,
              source: 'sms',
              confidence: 'exact',
              detectedAt: '2026-05-29T07:00:00.000Z',
              freshnessLabel: 'Updated today',
              sourceLabel: 'SMS',
              confidenceLabel: 'Exact',
              noteSafe: null,
            },
          ]}
          onClose={jest.fn()}
        />
      );
    });

    expect(textNodes(renderer!).join(' ')).not.toContain('-₹38,800.00');
  });

  it('renders the empty history state safely', () => {
    let renderer: ReactTestRenderer.ReactTestRenderer;

    ReactTestRenderer.act(() => {
      renderer = ReactTestRenderer.create(
        <BalanceHistoryModal
          visible
          title="HDFC Bank"
          balanceLabel="Displayed balance"
          balanceAmount={0}
          balanceKindLabel="Current"
          sourceLabel="Calculated"
          confidenceLabel="Estimated"
          freshnessLabel="Calculated balance"
          history={[]}
          onClose={jest.fn()}
        />
      );
    });

    expect(renderer!.root.findByType(Modal).props.visible).toBe(true);
    expect(textNodes(renderer!)).toContain('No balance history yet');
  });
});
