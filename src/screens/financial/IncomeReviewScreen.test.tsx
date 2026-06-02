declare const require: (moduleName: string) => any;
declare const __dirname: string;

const fs = require('fs');
const path = require('path');
const materialCommunityIcons = require('react-native-vector-icons/glyphmaps/MaterialCommunityIcons.json');

import React from 'react';
import { RefreshControl, Text, TouchableOpacity } from 'react-native';
import ReactTestRenderer from 'react-test-renderer';
import IncomeReviewScreen, { APPROVED_INCOME_REVIEW_ICONS } from './IncomeReviewScreen';
import {
  getIncomeReviewScreenState,
  saveIncomeReviewDecision,
  deleteIncomeReviewDecision,
} from '../../lib/services/incomeReview';

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ goBack: jest.fn() }),
}));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));

jest.mock('../../context/ThemeContext', () => ({
  useTheme: () => ({
    colors: {
      background: '#f8fafc',
      card: '#ffffff',
      text: '#111827',
      subtext: '#6b7280',
      accent: '#7c3aed',
      border: '#e5e7eb',
    },
    typography: {
      h1: { fontSize: 28, fontWeight: '700' },
      h2: { fontSize: 22, fontWeight: '700' },
      h3: { fontSize: 18, fontWeight: '700' },
      body: { fontSize: 16, fontWeight: '400' },
      bodyBold: { fontSize: 16, fontWeight: '700' },
      caption: { fontSize: 12, fontWeight: '400' },
    },
    spacing: { xs: 4, sm: 8, md: 16, lg: 24 },
    borderRadius: { md: 8, lg: 8 },
    shadows: { sm: {} },
  }),
}));

jest.mock('../../lib/services/incomeReview', () => ({
  getIncomeReviewScreenState: jest.fn(),
  saveIncomeReviewDecision: jest.fn(),
  deleteIncomeReviewDecision: jest.fn(),
}));

const mockedGetState = getIncomeReviewScreenState as jest.Mock;
const mockedSave = saveIncomeReviewDecision as jest.Mock;
const mockedDelete = deleteIncomeReviewDecision as jest.Mock;

function read(relativePath: string): string {
  return fs.readFileSync(path.join(__dirname, '..', '..', '..', relativePath), 'utf8');
}

function childText(children: unknown): string {
  if (Array.isArray(children)) return children.map(childText).join('');
  if (typeof children === 'string' || typeof children === 'number') return String(children);
  return '';
}

function renderedText(renderer: ReactTestRenderer.ReactTestRenderer): string {
  return renderer.root
    .findAllByType(Text)
    .map(node => childText(node.props.children))
    .join(' ');
}

function touchableByText(renderer: ReactTestRenderer.ReactTestRenderer, text: string) {
  return renderer.root
    .findAllByType(TouchableOpacity)
    .find(node => node.findAllByType(Text).some(textNode => childText(textNode.props.children).includes(text)));
}

function candidate(overrides = {}) {
  return {
    id: 'transaction:tx_1',
    candidateType: 'transaction',
    transactionId: 'tx_1',
    evidenceId: null,
    signalHash: null,
    amount: 1200,
    receivedAt: '2026-06-05T10:00:00.000Z',
    sourceHint: 'upi_credit',
    suggestedDecision: 'needs_review',
    suggestedIncomeSourceType: null,
    safeLabel: 'UPI credit',
    safeReason: 'Credit needs review before it can count as income.',
    confidence: 'needs_review',
    currentDecision: null,
    ...overrides,
  };
}

async function renderWithState(state: any) {
  mockedGetState.mockResolvedValueOnce(state);
  let renderer: ReactTestRenderer.ReactTestRenderer | undefined;

  await ReactTestRenderer.act(async () => {
    renderer = ReactTestRenderer.create(<IncomeReviewScreen />);
  });
  await ReactTestRenderer.act(async () => {
    await Promise.resolve();
  });

  return renderer!;
}

describe('IncomeReviewScreen', () => {
  beforeEach(() => {
    mockedGetState.mockReset();
    mockedSave.mockReset();
    mockedDelete.mockReset();
  });

  it('loads excluded credit candidates so Dashboard review prompts have a review surface', async () => {
    const renderer = await renderWithState({
      candidates: [],
      storageStatus: 'ready',
    });

    expect(mockedGetState).toHaveBeenCalledWith({ showExcluded: true });
    await ReactTestRenderer.act(() => {
      renderer.unmount();
    });
  });

  it('renders the loading state', () => {
    mockedGetState.mockReturnValue(new Promise(() => {}));
    let renderer: ReactTestRenderer.ReactTestRenderer | undefined;

    ReactTestRenderer.act(() => {
      renderer = ReactTestRenderer.create(<IncomeReviewScreen />);
    });

    expect(renderedText(renderer!)).toContain('Loading income review');
  });

  it('renders empty state and safe explanatory copy', async () => {
    const renderer = await renderWithState({ candidates: [], storageStatus: 'ready' });
    const text = renderedText(renderer);

    expect(text).toContain('Review credits before they count as income.');
    expect(text).toContain('Family or friend transfers are not counted automatically.');
    expect(text).toContain('Counting evidence-only income creates a safe History entry. Balances do not change.');
    expect(text).toContain('Debt Freedom Coach will use your reviewed income decisions.');
    expect(text).toContain('No credits need review right now.');
    expect(text).toContain('New credits may appear here when the app cannot safely classify them.');
  });

  it('renders missing migration state without crashing', async () => {
    const renderer = await renderWithState({
      candidates: [candidate()],
      storageStatus: 'missing',
    });
    const text = renderedText(renderer);

    expect(text).toContain('Income review storage is not ready yet.');
    expect(text).toContain('Run the database update before saving decisions.');
    expect(text).toContain('UPI credit');
  });

  it('renders normal candidate fields and English source picker', async () => {
    const renderer = await renderWithState({
      candidates: [
        candidate({
          sourceHint: 'gig_payout',
          suggestedDecision: 'count_as_income',
          suggestedIncomeSourceType: 'gig_work',
          safeLabel: 'Possible gig payout',
          safeReason: 'This credit looks like a gig payout, but you can override it.',
          confidence: 'medium',
        }),
      ],
      storageStatus: 'ready',
    });
    const text = renderedText(renderer);

    expect(text).toContain('Income Review');
    expect(text).toContain('₹1,200');
    expect(text).toContain('Possible gig payout');
    expect(text).toContain('Dashboard: Not counted until reviewed');
    expect(text).toContain('Source hint: Gig payout');
    expect(text).toContain('Count as income');
    expect(text).toContain('Not income');
    expect(text).toContain('Keep reviewing');
    expect(text).toContain('Salary');
    expect(text).toContain('Gig work');
    expect(text).toContain('Freelance');
    expect(text).toContain('Business');
    expect(text).toContain('Cash deposit');
    expect(text).toContain('Other');
  });

  it('calls service actions for Count as income and Not income', async () => {
    mockedGetState
      .mockResolvedValueOnce({
        candidates: [candidate({ suggestedDecision: 'count_as_income', suggestedIncomeSourceType: 'gig_work' })],
        storageStatus: 'ready',
      })
      .mockResolvedValueOnce({ candidates: [], storageStatus: 'ready' });
    mockedSave.mockResolvedValue({});

    let renderer: ReactTestRenderer.ReactTestRenderer | undefined;
    await ReactTestRenderer.act(async () => {
      renderer = ReactTestRenderer.create(<IncomeReviewScreen />);
    });

    await ReactTestRenderer.act(async () => {
      await touchableByText(renderer!, 'Count as income')!.props.onPress();
    });

    expect(mockedSave).toHaveBeenCalledWith(expect.objectContaining({
      transaction_id: 'tx_1',
      decision: 'count_as_income',
      income_source_type: 'gig_work',
    }));

    ReactTestRenderer.act(() => {
      renderer!.unmount();
    });
    mockedSave.mockClear();
    mockedGetState
      .mockResolvedValueOnce({
        candidates: [candidate({ suggestedDecision: 'needs_review', suggestedIncomeSourceType: null })],
        storageStatus: 'ready',
      })
      .mockResolvedValueOnce({ candidates: [], storageStatus: 'ready' });

    await ReactTestRenderer.act(async () => {
      renderer = ReactTestRenderer.create(<IncomeReviewScreen />);
    });

    await ReactTestRenderer.act(async () => {
      await touchableByText(renderer!, 'Not income')!.props.onPress();
    });

    expect(mockedSave).toHaveBeenCalledWith(expect.objectContaining({
      transaction_id: 'tx_1',
      decision: 'not_income',
      income_source_type: null,
    }));
  });

  it('saves generic reviewed credits with the same fallback source shown in the picker', async () => {
    mockedGetState
      .mockResolvedValueOnce({
        candidates: [candidate({ suggestedDecision: 'needs_review', suggestedIncomeSourceType: null })],
        storageStatus: 'ready',
      })
      .mockResolvedValueOnce({ candidates: [], storageStatus: 'ready' });
    mockedSave.mockResolvedValue({});

    let renderer: ReactTestRenderer.ReactTestRenderer | undefined;
    await ReactTestRenderer.act(async () => {
      renderer = ReactTestRenderer.create(<IncomeReviewScreen />);
    });

    expect(renderedText(renderer!)).toContain('Other');

    await ReactTestRenderer.act(async () => {
      await touchableByText(renderer!, 'Count as income')!.props.onPress();
    });

    expect(mockedSave).toHaveBeenCalledWith(expect.objectContaining({
      transaction_id: 'tx_1',
      decision: 'count_as_income',
      income_source_type: 'other',
    }));
  });

  it('ignores an older refresh result after a decision save completes', async () => {
    let resolveStaleRefresh: (state: any) => void = () => {};
    const staleRefresh = new Promise(resolve => {
      resolveStaleRefresh = resolve;
    });
    const unresolvedState = {
      candidates: [candidate()],
      storageStatus: 'ready',
    };
    const reviewedState = {
      candidates: [candidate({
        currentDecision: {
          id: 'decision_1',
          decision: 'count_as_income',
          income_source_type: 'other',
          reviewed_at: '2026-06-05T11:00:00.000Z',
        },
      })],
      storageStatus: 'ready',
    };
    mockedGetState
      .mockResolvedValueOnce(unresolvedState)
      .mockReturnValueOnce(staleRefresh)
      .mockResolvedValueOnce(reviewedState);
    mockedSave.mockResolvedValue({});

    let renderer: ReactTestRenderer.ReactTestRenderer | undefined;
    await ReactTestRenderer.act(async () => {
      renderer = ReactTestRenderer.create(<IncomeReviewScreen />);
    });

    ReactTestRenderer.act(() => {
      renderer!.root.findByType(RefreshControl).props.onRefresh();
    });
    await ReactTestRenderer.act(async () => {
      await touchableByText(renderer!, 'Count as income')!.props.onPress();
    });

    expect(renderedText(renderer!)).toContain('Counted as income');

    await ReactTestRenderer.act(async () => {
      resolveStaleRefresh(unresolvedState);
      await staleRefresh;
    });

    expect(renderedText(renderer!)).toContain('Counted as income');
    expect(renderedText(renderer!)).not.toContain('Dashboard: Not counted until reviewed');
  });

  it('saves deduped transaction/evidence cards with the shared identity fields', async () => {
    mockedGetState
      .mockResolvedValueOnce({
        candidates: [
          candidate({
            transactionId: 'tx_22700',
            evidenceId: 'ev_22700',
            signalHash: 'abcabc123456',
            amount: 22700,
            sourceHint: 'bank_credit',
            safeLabel: 'Bank credit',
          }),
        ],
        storageStatus: 'ready',
      })
      .mockResolvedValueOnce({ candidates: [], storageStatus: 'ready' });
    mockedSave.mockResolvedValue({});

    let renderer: ReactTestRenderer.ReactTestRenderer | undefined;
    await ReactTestRenderer.act(async () => {
      renderer = ReactTestRenderer.create(<IncomeReviewScreen />);
    });

    expect(renderedText(renderer!)).toContain('Dashboard: Not counted until reviewed');

    await ReactTestRenderer.act(async () => {
      await touchableByText(renderer!, 'Not income')!.props.onPress();
    });

    expect(mockedSave).toHaveBeenCalledWith(expect.objectContaining({
      transaction_id: 'tx_22700',
      evidence_id: 'ev_22700',
      signal_hash: 'abcabc123456',
      decision: 'not_income',
      income_source_type: null,
    }));
  });

  it('renders service-deduped candidates without duplicate React keys', async () => {
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const renderer = await renderWithState({
      candidates: [
        candidate({ id: 'transaction:tx_1', transactionId: 'tx_1' }),
        candidate({ id: 'signal:abcabc123456', transactionId: null, evidenceId: 'ev_1', signalHash: 'abcabc123456' }),
      ],
      storageStatus: 'ready',
    });

    expect(renderedText(renderer)).toContain('₹1,200');
    expect(errorSpy.mock.calls.flat().join(' ')).not.toContain('Encountered two children with the same key');
    errorSpy.mockRestore();
  });

  it('resets an existing decision with delete service', async () => {
    mockedGetState
      .mockResolvedValueOnce({
        candidates: [candidate({
          currentDecision: {
            id: 'decision_1',
            decision: 'count_as_income',
            income_source_type: 'gig_work',
          },
        })],
        storageStatus: 'ready',
      })
      .mockResolvedValueOnce({ candidates: [], storageStatus: 'ready' });
    mockedDelete.mockResolvedValue(undefined);

    let renderer: ReactTestRenderer.ReactTestRenderer | undefined;
    await ReactTestRenderer.act(async () => {
      renderer = ReactTestRenderer.create(<IncomeReviewScreen />);
    });

    await ReactTestRenderer.act(async () => {
      touchableByText(renderer!, 'Change')!.props.onPress();
    });

    await ReactTestRenderer.act(async () => {
      await touchableByText(renderer!, 'Keep reviewing')!.props.onPress();
    });

    expect(mockedDelete).toHaveBeenCalledWith('decision_1');
  });

  it('shows unresolved cards in the active list and keeps only the five newest reviewed decisions compact', async () => {
    const reviewed = Array.from({ length: 6 }, (_, index) => candidate({
      id: `transaction:reviewed_${index}`,
      transactionId: `reviewed_${index}`,
      amount: 2000 + index,
      safeLabel: `Reviewed label ${index}`,
      currentDecision: {
        id: `decision_${index}`,
        decision: index % 2 === 0 ? 'count_as_income' : 'not_income',
        income_source_type: index % 2 === 0 ? 'other' : null,
        reviewed_at: `2026-06-0${index + 1}T00:00:00.000Z`,
      },
    }));
    const renderer = await renderWithState({
      candidates: [candidate({ id: 'transaction:active', transactionId: 'active' }), ...reviewed],
      storageStatus: 'ready',
    });
    const text = renderedText(renderer);

    expect(text).toContain('Recently reviewed');
    expect(text).toContain('Reviewed label 5');
    expect(text).toContain('Reviewed label 1');
    expect(text).not.toContain('Reviewed label 0');
    expect(text.match(/Change/g)).toHaveLength(5);
    expect(text.match(/₹1,200/g)).toHaveLength(1);
  });

  it('keeps legacy evidence-only reviewed income honest until the safe History entry is reconfirmed', async () => {
    const renderer = await renderWithState({
      candidates: [candidate({
        id: 'evidence:legacy',
        candidateType: 'evidence',
        transactionId: null,
        evidenceId: 'legacy',
        currentDecision: {
          id: 'decision_legacy',
          decision: 'count_as_income',
          income_source_type: 'other',
          reviewed_at: '2026-06-01T00:00:00.000Z',
        },
      })],
      storageStatus: 'ready',
    });

    expect(renderedText(renderer)).toContain('Income confirmation needs refresh');
    expect(renderedText(renderer)).not.toContain('Dashboard: Counted as reviewed income');
  });

  it('does not render raw SMS, full UPI, phone, full number, or notes', async () => {
    const renderer = await renderWithState({
      candidates: [candidate()],
      storageStatus: 'ready',
    });
    const text = renderedText(renderer);

    expect(text).not.toContain('private.person@oksbi');
    expect(text).not.toContain('9876543210');
    expect(text).not.toContain('123456789012');
    expect(text).not.toContain('raw SMS');
    expect(text).not.toContain('raw note');
  });

  it('has no Hinglish tokens, fallback icons, or transaction mutation code', () => {
    const screen = read('src/screens/financial/IncomeReviewScreen.tsx');
    const blockedTokens = [
      'p' + 'aisa',
      'k' + 'ama',
      'k' + 'amana',
      'h' + 'ai',
      'n' + 'ahi',
    ];
    const blockedIconTokens = [
      'q' + 'uestion',
      'q' + 'uestion-mark',
      'h' + 'elp',
      'u' + 'nknown',
    ];

    for (const token of blockedTokens) {
      expect(screen).not.toContain(token);
    }
    for (const icon of APPROVED_INCOME_REVIEW_ICONS) {
      expect(materialCommunityIcons).toHaveProperty(icon);
      for (const token of blockedIconTokens) {
        expect(icon).not.toContain(token);
      }
    }
    expect(screen).not.toMatch(/from\('transactions'\)[\s\S]{0,160}\.(insert|update|delete|upsert|rpc)\s*\(/);
    expect(screen).not.toMatch(/from\('balance_snapshots'\)/);
    expect(screen).not.toContain('raw_sms');
    expect(screen).not.toContain('notification_text');
    expect(screen).not.toContain('raw_source_metadata');
  });

  it('is reachable from Settings through a hidden route', () => {
    const settingsStack = read('src/navigation/SettingsStack.tsx');
    const bottomTabs = read('src/navigation/BottomTabNavigator.tsx');
    const settingsScreen = read('src/screens/user/Settings.tsx');

    expect(settingsStack).toContain('IncomeReview: undefined');
    expect(settingsStack).toContain('<Stack.Screen name="IncomeReview" component={IncomeReviewScreen} />');
    expect(bottomTabs).toContain("'IncomeReview'");
    expect(settingsScreen).toContain('Income Review');
    expect(settingsScreen).toContain("navigate('IncomeReview')");
  });
});
