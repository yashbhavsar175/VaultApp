import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '../core';
import {
  getReviewClassificationPreferenceSuggestions,
  getReviewClassificationPreferencesKey,
  saveReviewClassificationPreferenceForTransaction,
} from './reviewClassificationPreferences';
import { ReviewItem } from './autoTransactionReviewQueue';
import { Transaction } from '../../types';

jest.mock('../core', () => ({
  supabase: {
    auth: {
      getUser: jest.fn(),
    },
  },
}));

const mockedGetUser = supabase.auth.getUser as jest.Mock;

function transaction(overrides: Partial<Transaction> = {}): Transaction {
  return {
    id: 'tx_1',
    user_id: 'user_1',
    amount: 2,
    type: 'expense',
    note: 'Reviewed expense',
    category: 'Groceries',
    created_at: '2026-06-03T10:00:00.000Z',
    account_last4: '1447',
    sms_source: 'sms',
    sms_sender: 'AD-KOTAKB-S',
    reference_number: '651916430927',
    raw_sms: 'OTP 123456 private SMS',
    ...overrides,
  };
}

function item(): ReviewItem {
  return {
    id: 'sig_1',
    candidate: {
      signalId: 'sig_1',
      sourceType: 'sms',
      autoClass: 'bank_debit',
      direction: 'debit',
      amount: 2,
      merchantOrPerson: null,
      last4: '1447',
      reference: '651916430927',
      instrumentHint: 'bank_account',
      confidenceScore: 70,
      confidenceLevel: 'medium',
      decision: 'review_required',
      duplicateFingerprints: [],
      redactedPreview: {
        detectedSource: 'AD-KOTAKB-S',
        autoClass: 'bank_debit',
        hashSummary: 'len=80 hash=abcdef12',
      },
    },
    reasons: ['Debit needs confirmation before counting as an expense'],
    status: 'pending',
    createdAt: Date.now(),
  };
}

describe('review classification preferences', () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    await AsyncStorage.clear();
    mockedGetUser.mockResolvedValue({ data: { user: { id: 'user_1' } } });
  });

  it('stores only a safe user-scoped pattern and returns a future suggestion', async () => {
    await saveReviewClassificationPreferenceForTransaction(transaction(), 'count_as_expense');

    const key = getReviewClassificationPreferencesKey('user_1');
    const raw = await AsyncStorage.getItem(key);
    expect(raw).toContain('AD-KOTAKB-S');
    expect(raw).toContain('1447');
    expect(raw).not.toContain('651916430927');
    expect(raw).not.toContain('OTP 123456');

    await expect(getReviewClassificationPreferenceSuggestions([item()])).resolves.toEqual({
      sig_1: expect.objectContaining({
        action: 'count_as_expense',
        sourceToken: 'AD-KOTAKB-S',
        accountLast4: '1447',
      }),
    });
  });

  it('does not store a phone-like sender or raw transaction text', async () => {
    await saveReviewClassificationPreferenceForTransaction(transaction({
      sms_sender: '9876543210',
      raw_sms: 'address private OTP 123456',
    }), 'not_expense');

    const raw = await AsyncStorage.getItem(getReviewClassificationPreferencesKey('user_1'));
    expect(raw).not.toContain('9876543210');
    expect(raw).not.toContain('address private');
    expect(raw).not.toContain('123456');
  });

  it('keeps preferences isolated by current user', async () => {
    await saveReviewClassificationPreferenceForTransaction(transaction(), 'always_ask');
    mockedGetUser.mockResolvedValue({ data: { user: { id: 'user_2' } } });

    await expect(getReviewClassificationPreferenceSuggestions([item()])).resolves.toEqual({});
  });
});
