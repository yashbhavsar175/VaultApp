import React from 'react';
import { Text, TouchableOpacity } from 'react-native';
import ReactTestRenderer from 'react-test-renderer';
import TransactionDetail from './TransactionDetail';
import { Transaction, TransactionEvidence } from '../../types';
import { getBankAccounts } from '../../lib/database/financial';
import { getEvidenceForTransaction } from '../../lib/services/transactionEvidence';
import { saveReviewClassificationPreferenceForTransaction } from '../../lib/services/reviewClassificationPreferences';

const mockTransactionSingle = jest.fn();
const mockSupabaseFrom = jest.fn((_table?: string) => {
  const query: Record<string, jest.Mock> = {};
  query.select = jest.fn(() => query);
  query.eq = jest.fn(() => query);
  query.single = mockTransactionSingle;
  return query;
});

jest.mock('react-native-vector-icons/MaterialCommunityIcons', () => 'Icon');

jest.mock('react-native-haptic-feedback', () => ({
  trigger: jest.fn(),
}));

jest.mock('react-native-toast-message', () => ({
  show: jest.fn(),
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
  AppButton: ({ title }: { title: string }) => {
    const RN = require('react-native');
    return <RN.Text>{title}</RN.Text>;
  },
  EditTransactionModal: () => null,
  AppConfirmModal: () => null,
}));

jest.mock('../../context/ThemeContext', () => ({
  useTheme: () => ({
    colors: {
      accent: '#7c3aed',
      background: '#f8fafc',
      border: '#e5e7eb',
      card: '#ffffff',
      error: '#ef4444',
      info: '#0ea5e9',
      subtext: '#6b7280',
      success: '#10b981',
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
    borderRadius: { sm: 8, full: 999 },
  }),
}));

jest.mock('../../lib/core', () => ({
  supabase: {
    auth: {
      getUser: jest.fn(async () => ({ data: { user: { id: 'user_1' } } })),
    },
    from: (table: string) => mockSupabaseFrom(table),
  },
  deleteTransaction: jest.fn(),
  updateTransaction: jest.fn(),
}));

jest.mock('../../lib/database/financial', () => ({
  getBankAccounts: jest.fn(),
}));

jest.mock('../../lib/services/cache', () => ({
  CACHE_KEYS: {
    BANK_ACCOUNTS: 'cache_bank_accounts',
    TRANSACTIONS: 'cache_transactions',
  },
  getCached: jest.fn(async () => null),
  setCache: jest.fn(async () => undefined),
  updateCache: jest.fn(async () => undefined),
}));

jest.mock('../../lib/services/transactionEvidence', () => ({
  getEvidenceForTransaction: jest.fn(),
}));

jest.mock('../../lib/services/reviewClassificationPreferences', () => ({
  saveReviewClassificationPreferenceForTransaction: jest.fn(),
}));

jest.mock('../../lib/privacy/rawText', () => ({
  isRedactedRawTextRecord: jest.fn((value?: string | null) => Boolean(value?.startsWith('[redacted]'))),
  sanitizeTransactionRawSmsForPrivacy: jest.fn((transaction: Transaction) => transaction),
}));

const mockedGetBankAccounts = getBankAccounts as jest.Mock;
const mockedGetEvidenceForTransaction = getEvidenceForTransaction as jest.Mock;
const mockedSavePreference = saveReviewClassificationPreferenceForTransaction as jest.Mock;

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

function transaction(overrides: Partial<Transaction> = {}): Transaction {
  return {
    id: 'tx_1',
    user_id: 'user_1',
    amount: 22700,
    type: 'income',
    note: 'Reviewed credit',
    category: 'Reviewed Income',
    created_at: '2026-06-01T10:00:00.000Z',
    account_id: 'bank_1',
    account_last4: '5191',
    sms_source: 'notification',
    sms_sender: 'money.super.payments',
    upi_id: 'yashpatel@oksbi',
    reference_number: '651884660419',
    raw_sms: 'OTP 123456 phone 9876543210 account 123456789012 yashpatel@oksbi address private',
    account_match_status: 'linked',
    account_match_confidence: 'high',
    account_match_reason: 'runtime_notification',
    primary_evidence_id: 'ev_1',
    ...overrides,
  };
}

function evidence(overrides: Partial<TransactionEvidence> = {}): TransactionEvidence {
  return {
    id: 'ev_1',
    user_id: 'user_1',
    signal_id: 'runtime:notification:money.super.payments',
    transaction_id: 'tx_1',
    source_type: 'notification',
    source_package: 'money.super.payments',
    source_app: 'Super.money',
    sender: null,
    amount: 22700,
    direction: 'credit',
    captured_at: '2026-06-01T10:00:00.000Z',
    reference_number: '651884660419',
    merchant_or_person: null,
    bank_name: 'Bank Of Baroda',
    account_last4: '5191',
    card_last4: null,
    instrument_hint: 'bank_account',
    upi_id_masked: 'yash***@oksbi',
    upi_id_hash: 'abc123',
    confidence_level: 'exact',
    match_status: 'linked',
    match_reason_code: 'runtime_notification',
    raw_source_metadata: { body: 'private notification body', raw_sms: 'secret' },
    created_at: '2026-06-01T10:00:00.000Z',
    updated_at: '2026-06-01T10:00:00.000Z',
    ...overrides,
  };
}

async function renderDetail(tx: Transaction, rows: TransactionEvidence[]) {
  mockTransactionSingle.mockResolvedValueOnce({ data: tx, error: null });
  mockedGetBankAccounts.mockResolvedValueOnce([{
    id: 'bank_1',
    user_id: 'user_1',
    bank_name: 'Bank Of Baroda',
    account_last4: '5191',
    account_type: 'savings',
    starting_balance: 0,
    balance: 0,
    credit_limit: 0,
    loan_total: 0,
    upi_ids: [],
    created_at: '2026-01-01T00:00:00.000Z',
  }]);
  mockedGetEvidenceForTransaction.mockResolvedValueOnce(rows);

  let renderer!: ReactTestRenderer.ReactTestRenderer;
  await ReactTestRenderer.act(async () => {
    renderer = ReactTestRenderer.create(
      <TransactionDetail
        route={{ params: { transactionId: tx.id } } as any}
        navigation={{ goBack: jest.fn() } as any}
      />
    );
  });
  await ReactTestRenderer.act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
  return renderer;
}

describe('TransactionDetail Source Trace', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders evidence-backed source, bank, UPI, UTR, match, and dashboard status safely', async () => {
    const renderer = await renderDetail(transaction(), [evidence()]);
    const text = renderedText(renderer);

    expect(text).toContain('Source Trace');
    expect(text).toContain('Captured from: Super.money notification');
    expect(text).toContain('Credited to: Bank Of Baroda ••5191');
    expect(text).toContain('Source app Super.money');
    expect(text).toContain('Package money.super.payments');
    expect(text).toContain('Matched Account Bank Of Baroda ••5191');
    expect(text).toContain('Match status Linked');
    expect(text).toContain('Match confidence High');
    expect(text).toContain('Direction Credit');
    expect(text).toContain('Instrument Bank account');
    expect(text).toContain('Ref / UTR 651884660419');
    expect(text).toContain('UPI yash***@oksbi');
    expect(text).toContain('Dashboard status Counted as income');

    expect(text).not.toContain('yashpatel@oksbi');
    expect(text).not.toContain('9876543210');
    expect(text).not.toContain('123456789012');
    expect(text).not.toContain('private notification body');
    expect(text).not.toContain('raw_source_metadata');
    expect(text).not.toContain('Raw Message');
    expect(text).not.toContain('Show');

    await ReactTestRenderer.act(() => {
      renderer.unmount();
    });
  });

  it('falls back to generic notification source copy when app label and package are missing', async () => {
    const renderer = await renderDetail(
      transaction({
        id: 'tx_fallback',
        account_id: null,
        account_last4: null,
        sms_sender: null,
        primary_evidence_id: 'ev_fallback',
      }),
      [evidence({
        id: 'ev_fallback',
        transaction_id: 'tx_fallback',
        source_app: null,
        source_package: null,
        bank_name: null,
        account_last4: null,
      })]
    );

    expect(renderedText(renderer)).toContain('Captured from: Notification source notification');

    await ReactTestRenderer.act(() => {
      renderer.unmount();
    });
  });

  it('renders review decision and suggestion-only intelligence cards for reviewed expense transactions', async () => {
    const renderer = await renderDetail(transaction({
      id: 'tx_reviewed_expense',
      amount: 2,
      type: 'expense',
      note: 'Reviewed expense',
      category: 'Reviewed Expense',
      sms_source: 'sms',
      sms_sender: 'AD-KOTAKB-S',
      account_last4: '1447',
      account_match_status: 'manual_confirmed',
      account_match_confidence: 'medium',
      account_match_reason: 'review_queue_expense_confirmed',
      reference_number: '651916430927',
      primary_evidence_id: null,
    }), []);
    const text = renderedText(renderer);

    expect(text).toContain('Review decision');
    expect(text).toContain('Status Counted as expense');
    expect(text).toContain('If this happens again');
    expect(text).toContain('Always ask me');
    expect(text).toContain('Count as expense next time');
    expect(text).toContain('Do not count as expense');
    expect(text).toContain('Suggest this category next time');
    expect(text).toContain('Matched Account Bank Of Baroda ••5191');
    expect(text).toContain('Ref / UTR 651916430927');
    expect(text).not.toContain('?');

    await ReactTestRenderer.act(() => {
      renderer.unmount();
    });
  });

  it('saves a future suggestion without silently posting another transaction', async () => {
    mockedSavePreference.mockResolvedValueOnce({});
    const tx = transaction({
      id: 'tx_reviewed_preference',
      type: 'expense',
      note: 'Reviewed expense',
      category: 'Reviewed Expense',
      account_match_status: 'manual_confirmed',
    });
    const renderer = await renderDetail(tx, []);
    const button = renderer.root
      .findAllByType(TouchableOpacity)
      .find(node => node.findAllByType(Text).some(textNode =>
        childText(textNode.props.children).includes('Count as expense next time')
      ));

    await ReactTestRenderer.act(async () => {
      await button?.props.onPress();
    });

    expect(mockedSavePreference).toHaveBeenCalledWith(tx, 'count_as_expense');
    expect(renderedText(renderer)).toContain('Suggest expense next time');

    await ReactTestRenderer.act(() => {
      renderer.unmount();
    });
  });

  it('shows the reversible not-counted state after a later correction', async () => {
    const renderer = await renderDetail(transaction({
      id: 'tx_not_expense',
      type: 'expense',
      note: 'Reviewed expense',
      category: 'Reviewed Expense',
      account_match_status: 'ignored',
      account_match_reason: 'review_detail_not_expense',
    }), []);
    const text = renderedText(renderer);

    expect(text).toContain('Status Not counted');
    expect(text).toContain('Mark as expense');

    await ReactTestRenderer.act(() => {
      renderer.unmount();
    });
  });
});
