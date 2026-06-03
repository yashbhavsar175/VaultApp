import React from 'react';
import { Text, TouchableOpacity } from 'react-native';
import ReactTestRenderer from 'react-test-renderer';
import Dashboard from './Dashboard';
import { Transaction } from '../types';
import { getTransactions, supabase } from '../lib/core';
import { getPeopleLedger } from '../lib/database/userdata';
import { getCached, setCache } from '../lib/services/cache';
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
  supabase: {
    auth: {
      getUser: jest.fn(),
    },
  },
}));

jest.mock('../lib/database/userdata', () => ({
  getPeopleLedger: jest.fn(),
}));

jest.mock('../lib/services/cache', () => ({
  CACHE_KEYS: {
    PEOPLE_LEDGER: 'cache_people_ledger',
    TRANSACTIONS: 'cache_transactions',
    DASHBOARD_SUMMARY: 'cache_dashboard_summary',
  },
  getCached: jest.fn(),
  setCache: jest.fn(),
  scopedCacheKey: (base: string, scope: string | number) => `${base}:${scope}`,
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
const mockedGetUser = supabase.auth.getUser as jest.Mock;
const mockedGetPeopleLedger = getPeopleLedger as jest.Mock;
const mockedGetCached = getCached as jest.Mock;
const mockedSetCache = setCache as jest.Mock;
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
  mockedGetUser.mockResolvedValue({ data: { user: { id: 'user_1' } } });
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
    mockedGetUser.mockResolvedValue({ data: { user: { id: 'user_1' } } });
  });

  it('renders a user-month cached dashboard summary before remote refresh resolves', async () => {
    const currentMonth = new Date();
    const monthKey = `${currentMonth.getFullYear()}-${String(currentMonth.getMonth() + 1).padStart(2, '0')}`;
    mockedGetCached.mockImplementation(async (key: string) => {
      if (key === `cache_dashboard_summary:user_1:${monthKey}`) {
        return {
          isStale: false,
          data: {
            monthKey,
            createdAt: '2026-06-03T00:00:00.000Z',
            monthlyTotals: {
              totalIncome: 103,
              grossExpense: 0,
              totalRefunds: 0,
              netExpense: 0,
              totalExpense: 0,
              totalInvestment: 0,
              totalEMI: 0,
              monthlyBalance: 103,
            },
            peopleSummary: {
              totalLent: 0,
              totalBorrowed: 0,
              lentCount: 0,
              borrowedCount: 0,
            },
            reviewBreakdown: {
              totalReviewableCount: 1,
              incomeReviewCount: 1,
              transactionReviewCount: 0,
              historicalCorrectionCount: 0,
            },
          },
        };
      }
      return null;
    });
    mockedGetTransactions.mockReturnValue(new Promise(() => undefined));
    mockedGetPeopleLedger.mockReturnValue(new Promise(() => undefined));
    mockedGetIncomeReviewDecisions.mockResolvedValue([]);
    mockedGetIncomeReviewCandidates.mockResolvedValue([]);
    mockedGetReviewQueue.mockResolvedValue([]);

    let renderer!: ReactTestRenderer.ReactTestRenderer;
    await ReactTestRenderer.act(async () => {
      renderer = ReactTestRenderer.create(<Dashboard />);
      await Promise.resolve();
      await Promise.resolve();
    });

    const text = allText(renderer);
    expect(text).toContain('₹103');
    expect(text).toContain('Money movements need review');
    expect(mockedGetCached).toHaveBeenCalledWith(`cache_dashboard_summary:user_1:${monthKey}`);

    await ReactTestRenderer.act(() => {
      renderer.unmount();
    });
  });

  it('does not flash zero when stale empty transaction cache exists before live refresh', async () => {
    const currentMonth = new Date();
    const monthKey = `${currentMonth.getFullYear()}-${String(currentMonth.getMonth() + 1).padStart(2, '0')}`;
    mockedGetCached.mockImplementation(async (key: string) => {
      if (key === `cache_dashboard_summary:user_1:${monthKey}`) {
        return {
          isStale: false,
          data: {
            monthKey,
            createdAt: '2026-06-03T00:00:00.000Z',
            monthlyTotals: {
              totalIncome: 103,
              grossExpense: 0,
              totalRefunds: 0,
              netExpense: 0,
              totalExpense: 0,
              totalInvestment: 0,
              totalEMI: 0,
              monthlyBalance: 103,
            },
            peopleSummary: {
              totalLent: 0,
              totalBorrowed: 0,
              lentCount: 0,
              borrowedCount: 0,
            },
            reviewBreakdown: {
              totalReviewableCount: 0,
              incomeReviewCount: 0,
              transactionReviewCount: 0,
              historicalCorrectionCount: 0,
            },
          },
        };
      }
      if (key === 'cache_transactions') {
        return { isStale: true, data: [] };
      }
      if (key === 'cache_people_ledger') {
        return null;
      }
      return null;
    });
    mockedGetTransactions.mockReturnValue(new Promise(() => undefined));
    mockedGetPeopleLedger.mockReturnValue(new Promise(() => undefined));
    mockedGetIncomeReviewDecisions.mockResolvedValue([]);
    mockedGetIncomeReviewCandidates.mockResolvedValue([]);
    mockedGetReviewQueue.mockResolvedValue([]);

    let renderer!: ReactTestRenderer.ReactTestRenderer;
    await ReactTestRenderer.act(async () => {
      renderer = ReactTestRenderer.create(<Dashboard />);
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(allText(renderer)).toContain('₹103');

    await ReactTestRenderer.act(() => {
      renderer.unmount();
    });
  });

  it('keeps cached monthly totals when people cache resolves before transactions', async () => {
    const currentMonth = new Date();
    const monthKey = `${currentMonth.getFullYear()}-${String(currentMonth.getMonth() + 1).padStart(2, '0')}`;
    mockedGetCached.mockImplementation(async (key: string) => {
      if (key === `cache_dashboard_summary:user_1:${monthKey}`) {
        return {
          isStale: false,
          data: {
            monthKey,
            createdAt: '2026-06-03T00:00:00.000Z',
            monthlyTotals: {
              totalIncome: 103,
              grossExpense: 0,
              totalRefunds: 0,
              netExpense: 0,
              totalExpense: 0,
              totalInvestment: 0,
              totalEMI: 0,
              monthlyBalance: 103,
            },
            peopleSummary: {
              totalLent: 0,
              totalBorrowed: 0,
              lentCount: 0,
              borrowedCount: 0,
            },
            reviewBreakdown: {
              totalReviewableCount: 0,
              incomeReviewCount: 0,
              transactionReviewCount: 0,
              historicalCorrectionCount: 0,
            },
          },
        };
      }
      if (key === 'cache_transactions') {
        return { isStale: true, data: [] };
      }
      if (key === 'cache_people_ledger') {
        return {
          isStale: false,
          data: [{
            id: 'ledger_1',
            type: 'lent',
            remaining_amount: 10,
            is_settled: false,
            person_name: 'Person',
          }],
        };
      }
      return null;
    });
    mockedGetTransactions.mockReturnValue(new Promise(() => undefined));
    mockedGetPeopleLedger.mockReturnValue(new Promise(() => undefined));
    mockedGetIncomeReviewDecisions.mockResolvedValue([]);
    mockedGetIncomeReviewCandidates.mockResolvedValue([]);
    mockedGetReviewQueue.mockResolvedValue([]);

    let renderer!: ReactTestRenderer.ReactTestRenderer;
    await ReactTestRenderer.act(async () => {
      renderer = ReactTestRenderer.create(<Dashboard />);
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(allText(renderer)).toContain('₹103');

    await ReactTestRenderer.act(() => {
      renderer.unmount();
    });
  });

  it('keeps cached monthly totals when transaction cache resolves before income review decisions', async () => {
    const currentMonth = new Date();
    const monthKey = `${currentMonth.getFullYear()}-${String(currentMonth.getMonth() + 1).padStart(2, '0')}`;
    mockedGetCached.mockImplementation(async (key: string) => {
      if (key === `cache_dashboard_summary:user_1:${monthKey}`) {
        return {
          isStale: false,
          data: {
            monthKey,
            createdAt: '2026-06-03T00:00:00.000Z',
            monthlyTotals: {
              totalIncome: 103,
              grossExpense: 0,
              totalRefunds: 0,
              netExpense: 0,
              totalExpense: 0,
              totalInvestment: 0,
              totalEMI: 0,
              monthlyBalance: 103,
            },
            peopleSummary: {
              totalLent: 0,
              totalBorrowed: 0,
              lentCount: 0,
              borrowedCount: 0,
            },
            reviewBreakdown: {
              totalReviewableCount: 0,
              incomeReviewCount: 0,
              transactionReviewCount: 0,
              historicalCorrectionCount: 0,
            },
          },
        };
      }
      if (key === 'cache_transactions') {
        return {
          isStale: false,
          data: [tx({
            id: 'reviewed_income_waiting_for_decision',
            amount: 103,
            type: 'income',
            sms_source: 'bank',
            note: 'Cash deposit',
          })],
        };
      }
      if (key === 'cache_people_ledger') {
        return null;
      }
      return null;
    });
    mockedGetTransactions.mockReturnValue(new Promise(() => undefined));
    mockedGetPeopleLedger.mockReturnValue(new Promise(() => undefined));
    mockedGetIncomeReviewDecisions.mockReturnValue(new Promise(() => undefined));
    mockedGetIncomeReviewCandidates.mockResolvedValue([]);
    mockedGetReviewQueue.mockResolvedValue([]);

    let renderer!: ReactTestRenderer.ReactTestRenderer;
    await ReactTestRenderer.act(async () => {
      renderer = ReactTestRenderer.create(<Dashboard />);
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(allText(renderer)).toContain('₹103');

    await ReactTestRenderer.act(() => {
      renderer.unmount();
    });
  });

  it('writes refreshed dashboard summary into a user-month scoped cache', async () => {
    const renderer = await renderDashboard([
      tx({
        id: 'manual_income',
        amount: 2500,
        type: 'income',
        note: 'Manual income',
        category: 'Income',
      }),
    ]);
    const dashboardCacheWrite = mockedSetCache.mock.calls.find(([key]) => (
      typeof key === 'string' && key.startsWith('cache_dashboard_summary:user_1:')
    ));

    expect(dashboardCacheWrite).toBeTruthy();
    expect(dashboardCacheWrite?.[1]).toEqual(expect.objectContaining({
      monthlyTotals: expect.objectContaining({
        totalIncome: 2500,
        monthlyBalance: 2500,
      }),
      reviewBreakdown: expect.objectContaining({
        totalReviewableCount: 0,
      }),
    }));

    await ReactTestRenderer.act(() => {
      renderer.unmount();
    });
  });

  it('refreshes totals when only review status changes from ignored to counted', async () => {
    const ignoredExpense = tx({
      id: 'reviewed_expense_toggle',
      amount: 2,
      type: 'expense',
      category: 'Reviewed Expense',
      note: 'Reviewed expense',
      sms_source: 'sms',
      account_match_status: 'ignored',
      account_match_reason: 'review_detail_not_expense',
    });
    const countedExpense = {
      ...ignoredExpense,
      account_match_status: 'manual_confirmed',
      account_match_reason: 'review_detail_expense_confirmed',
    };
    const renderer = await renderDashboard([ignoredExpense]);

    expect(allText(renderer)).not.toContain('₹2');
    mockedGetTransactions.mockResolvedValue([countedExpense]);

    await ReactTestRenderer.act(async () => {
      mockFinanceDataChangedListener?.({
        areas: ['transactions'],
        source: 'transaction:update',
        at: Date.now(),
      });
      await new Promise<void>(resolve => {
        setTimeout(() => resolve(), 650);
      });
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(allText(renderer)).toContain('₹2');

    await ReactTestRenderer.act(() => {
      renderer.unmount();
    });
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

  it('counts and routes credit-only review prompts to unified Money Movement Review', async () => {
    const renderer = await renderDashboard([], {
      incomeCandidates: [incomeCandidate()],
    });

    expect(allText(renderer)).toContain('1 item needs review');
    pressByText(renderer, 'Review now');
    expect(mockNavigate).toHaveBeenCalledWith('Settings', {
      screen: 'MoneyMovementReview',
      params: { initialSection: 'credits' },
    });

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
    expect(mockNavigate).toHaveBeenCalledWith('Settings', {
      screen: 'MoneyMovementReview',
      params: { initialSection: 'payments' },
    });

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

  it('renders honest mixed-source copy and opens unified review for all movements', async () => {
    const renderer = await renderDashboard([], {
      incomeCandidates: [incomeCandidate()],
      queueItems: [queueItem()],
    });
    const text = allText(renderer);

    expect(text).toContain('1 credit and 1 movement need review');
    expect(text).toContain('Review now');
    expect(text).not.toContain('Review credits');
    expect(text).not.toContain('Review payments');
    expect(text).not.toContain('private.person@oksbi');
    expect(text).not.toContain('9876543210');

    pressByText(renderer, 'Review now');
    expect(mockNavigate).toHaveBeenCalledWith('Settings', {
      screen: 'MoneyMovementReview',
      params: { initialSection: 'all' },
    });

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
