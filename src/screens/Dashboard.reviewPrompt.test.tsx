import React from 'react';
import { Text, TouchableOpacity } from 'react-native';
import ReactTestRenderer from 'react-test-renderer';
import Dashboard from './Dashboard';
import { Transaction } from '../types';
import { getTransactions } from '../lib/core';
import { getPeopleLedger } from '../lib/database/userdata';
import { getCached } from '../lib/services/cache';
import { getIncomeReviewCandidates, getIncomeReviewDecisions } from '../lib/services/incomeReview';
import { getReviewQueue } from '../lib/services/autoTransactionReviewQueue';

const fs = require('fs') as { readFileSync: (filePath: string, encoding: 'utf8') => string };

const mockNavigate = jest.fn();
let mockFinanceDataChangedListener: ((payload: { areas?: string[]; source?: string; at: number }) => void) | null = null;

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: mockNavigate }),
  useFocusEffect: (callback: () => void | (() => void)) => {
    const react = require('react');
    react.useEffect(() => callback(), [callback]);
  },
}));

jest.mock('react-native-vector-icons/MaterialCommunityIcons', () => 'Icon');

jest.mock('react-native-haptic-feedback', () => ({
  trigger: jest.fn(),
}));

jest.mock('../components', () => ({
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
  QuickAddModal: () => null,
}));

jest.mock('../context/ThemeContext', () => ({
  useTheme: () => ({
    colors: {
      accent: '#7c3aed',
      background: '#f8fafc',
      border: '#e5e7eb',
      card: '#ffffff',
      emi: '#f59e0b',
      expense: '#ef4444',
      income: '#10b981',
      investment: '#7c6af7',
      subtext: '#6b7280',
      text: '#111827',
      warning: '#f59e0b',
    },
    typography: {
      h1: { fontSize: 28 },
      h3: { fontSize: 18 },
      body: { fontSize: 16 },
      bodyBold: { fontSize: 16, fontWeight: '700' },
      caption: { fontSize: 12 },
    },
    spacing: { xs: 4, sm: 8, md: 16, lg: 24, xl: 32 },
  }),
}));

jest.mock('../lib/core', () => ({
  getTransactions: jest.fn(),
}));

jest.mock('../lib/database/userdata', () => ({
  getPeopleLedger: jest.fn(),
}));

jest.mock('../lib/services/cache', () => ({
  CACHE_KEYS: {
    PEOPLE_LEDGER: 'cache_people_ledger',
    TRANSACTIONS: 'cache_transactions',
  },
  getCached: jest.fn(),
  setCache: jest.fn(),
}));

jest.mock('../lib/services/dataEvents', () => ({
  financeDataChangedAffects: jest.fn((payload: { areas?: string[] }, areas: string[]) => (
    !payload.areas || payload.areas.length === 0 || payload.areas.some(area => areas.includes(area))
  )),
  subscribeFinanceDataChanged: jest.fn((listener: typeof mockFinanceDataChangedListener) => {
    mockFinanceDataChangedListener = listener;
    return jest.fn();
  }),
}));

jest.mock('../lib/services/incomeReview', () => ({
  getIncomeReviewCandidates: jest.fn(),
  getIncomeReviewDecisions: jest.fn(),
}));

jest.mock('../lib/services/autoTransactionReviewQueue', () => ({
  getReviewQueue: jest.fn(),
}));

jest.mock('../utils/runWhenIdle', () => ({
  runWhenIdle: (callback: () => void) => {
    callback();
    return { cancel: jest.fn() };
  },
}));

const mockedGetTransactions = getTransactions as jest.Mock;
const mockedGetPeopleLedger = getPeopleLedger as jest.Mock;
const mockedGetCached = getCached as jest.Mock;
const mockedGetIncomeReviewCandidates = getIncomeReviewCandidates as jest.Mock;
const mockedGetIncomeReviewDecisions = getIncomeReviewDecisions as jest.Mock;
const mockedGetReviewQueue = getReviewQueue as jest.Mock;

function tx(overrides: Partial<Transaction>): Transaction {
  return {
    id: overrides.id || 'tx_1',
    user_id: 'user_1',
    amount: overrides.amount ?? 0,
    type: overrides.type || 'expense',
    note: overrides.note || 'Test transaction',
    category: overrides.category || 'general',
    created_at: overrides.created_at || new Date().toISOString(),
    ...overrides,
  };
}

function childText(children: unknown): string {
  if (Array.isArray(children)) return children.map(childText).join('');
  if (typeof children === 'string' || typeof children === 'number') return String(children);
  return '';
}

function incomeCandidate(overrides: Record<string, unknown> = {}) {
  return {
    id: 'signal:abcabc123456',
    candidateType: 'evidence',
    transactionId: null,
    evidenceId: 'ev_1',
    signalHash: 'abcabc123456',
    amount: 1000,
    receivedAt: new Date().toISOString(),
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

function queueItem(overrides: Record<string, unknown> = {}) {
  return {
    id: 'sig_queue_1',
    status: 'pending',
    createdAt: Date.now(),
    reasons: ['Needs review'],
    candidate: {
      signalId: 'sig_queue_1',
      autoClass: 'upi_payment',
      direction: 'debit',
      amount: 500,
      merchantOrPerson: null,
      last4: '1447',
      reference: null,
      instrumentHint: 'bank_account',
      confidenceScore: 75,
      confidenceLevel: 'medium',
      decision: 'review_required',
      duplicateFingerprints: [],
      redactedPreview: {
        detectedSource: 'UTKSPR',
        autoClass: 'upi_payment',
        hashSummary: 'len=20 hash=abc123',
      },
      ...overrides,
    },
  };
}

async function renderDashboard(
  transactions: Transaction[],
  options: {
    incomeCandidates?: ReturnType<typeof incomeCandidate>[];
    queueItems?: ReturnType<typeof queueItem>[];
  } = {}
) {
  mockedGetCached.mockResolvedValue(null);
  mockedGetTransactions.mockResolvedValue(transactions);
  mockedGetPeopleLedger.mockResolvedValue([]);
  mockedGetIncomeReviewDecisions.mockResolvedValue([]);
  mockedGetIncomeReviewCandidates.mockResolvedValue(options.incomeCandidates || []);
  mockedGetReviewQueue.mockResolvedValue(options.queueItems || []);
  mockNavigate.mockClear();

  let renderer!: ReactTestRenderer.ReactTestRenderer;
  await ReactTestRenderer.act(async () => {
    renderer = ReactTestRenderer.create(<Dashboard />);
  });
  await ReactTestRenderer.act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
  return renderer;
}

function allText(renderer: ReactTestRenderer.ReactTestRenderer): string {
  return renderer.root.findAllByType(Text).map(node => childText(node.props.children)).join(' ');
}

function pressByText(renderer: ReactTestRenderer.ReactTestRenderer, text: string) {
  const button = renderer.root
    .findAllByType(TouchableOpacity)
    .find(node => node.findAllByType(Text).some(textNode => childText(textNode.props.children).includes(text)));
  if (!button) throw new Error(`Touchable text not found: ${text}`);
  button.props.onPress();
}

describe('Dashboard review prompt', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFinanceDataChangedListener = null;
  });

  it('keeps historical excluded rows out of the actionable CTA count', async () => {
    const renderer = await renderDashboard([
      tx({
        id: 'private_transfer',
        amount: 11000,
        type: 'expense',
        note: 'Sent to Rahul 9876543210 rahul@oksbi raw private note',
        sms_source: 'upi',
      }),
      tx({
        id: 'cash_deposit',
        amount: 12000,
        type: 'income',
        note: 'Cash deposit',
        sms_source: 'bank',
      }),
    ]);

    const text = allText(renderer);
    expect(text).not.toContain('Money movements need review');
    expect(text).not.toContain('Rahul');
    expect(text).not.toContain('9876543210');
    expect(text).not.toContain('@oksbi');

    await ReactTestRenderer.act(() => {
      renderer.unmount();
    });
  });

  it('counts and routes credit-only review prompts to Income Review', async () => {
    const renderer = await renderDashboard([], {
      incomeCandidates: [incomeCandidate()],
    });

    expect(allText(renderer)).toContain('1 item needs review');
    pressByText(renderer, 'Review now');
    expect(mockNavigate).toHaveBeenCalledWith('Settings', { screen: 'IncomeReview' });

    await ReactTestRenderer.act(() => {
      renderer.unmount();
    });
  });

  it('renders and routes a local Review Queue prompt when no transaction row was created', async () => {
    const renderer = await renderDashboard([], {
      queueItems: [queueItem()],
    });

    expect(allText(renderer)).toContain('Money movements need review');
    expect(allText(renderer)).toContain('1 item needs review');

    pressByText(renderer, 'Review now');
    expect(mockNavigate).toHaveBeenCalledWith('ReviewQueue');

    await ReactTestRenderer.act(() => {
      renderer.unmount();
    });
  });

  it('refreshes the review prompt immediately after a review queue event', async () => {
    const renderer = await renderDashboard([], {
      queueItems: [queueItem()],
    });
    expect(allText(renderer)).toContain('Money movements need review');

    mockedGetIncomeReviewCandidates.mockResolvedValueOnce([]);
    mockedGetReviewQueue.mockResolvedValueOnce([]);

    await ReactTestRenderer.act(async () => {
      mockFinanceDataChangedListener?.({
        areas: ['review'],
        source: 'review_queue:changed',
        at: Date.now(),
      });
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(allText(renderer)).not.toContain('Money movements need review');

    await ReactTestRenderer.act(() => {
      renderer.unmount();
    });
  });

  it('renders honest mixed-source copy and exposes both review routes', async () => {
    const renderer = await renderDashboard([], {
      incomeCandidates: [incomeCandidate()],
      queueItems: [queueItem()],
    });
    const text = allText(renderer);

    expect(text).toContain('1 credit and 1 movement need review');
    expect(text).toContain('Review credits');
    expect(text).toContain('Review payments');
    expect(text).not.toContain('private.person@oksbi');
    expect(text).not.toContain('9876543210');

    pressByText(renderer, 'Review credits');
    expect(mockNavigate).toHaveBeenCalledWith('Settings', { screen: 'IncomeReview' });
    mockNavigate.mockClear();
    pressByText(renderer, 'Review payments');
    expect(mockNavigate).toHaveBeenCalledWith('ReviewQueue');

    await ReactTestRenderer.act(() => {
      renderer.unmount();
    });
  });

  it('does not render the prompt when only normal merchant and salary rows exist', async () => {
    const renderer = await renderDashboard([
      tx({
        id: 'merchant',
        amount: 500,
        type: 'expense',
        category: 'Groceries',
        note: 'Merchant purchase',
        sms_source: 'upi',
      }),
      tx({
        id: 'salary',
        amount: 20000,
        type: 'income',
        category: 'Salary',
        note: 'Salary credited',
        sms_source: 'bank',
      }),
    ]);

    expect(allText(renderer)).not.toContain('Money movements need review');

    await ReactTestRenderer.act(() => {
      renderer.unmount();
    });
  });

  it('keeps Dashboard review UI English-only with verified icons and no question fallback', () => {
    const source = fs.readFileSync('src/screens/Dashboard.tsx', 'utf8');
    const blockedTokens = [
      'A' + 'aj',
      'A' + 'b tak',
      'p' + 'iche',
      'a' + 'age',
      'Y' + 'eh',
      'p' + 'aisa',
      'p' + 'aise',
      'k' + 'harcha',
      'k' + 'harch',
      'k' + 'amana',
      'k' + 'arna',
      'h' + 'ai',
      'n' + 'ahi',
      'h' + 'aan',
      'u' + 'dhar',
    ];

    expect(source).toContain('name="inbox-multiple-outline"');
    expect(source).toContain('name="chevron-right"');
    expect(source).not.toMatch(/name=["']question(?:-mark)?["']/);
    expect(source).not.toMatch(new RegExp(`\\b(?:${blockedTokens.join('|')})\\b`, 'i'));
  });
});
