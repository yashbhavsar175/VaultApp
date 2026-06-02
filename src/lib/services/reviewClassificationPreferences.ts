import AsyncStorage from '@react-native-async-storage/async-storage';
import { Transaction } from '../../types';
import { supabase } from '../core';
import { ReviewItem } from './autoTransactionReviewQueue';
import {
  isReviewedDebitCandidate,
  sanitizeReviewedExpenseSourceToken,
} from './reviewQueueExpenses';

export const REVIEW_CLASSIFICATION_PREFERENCES_BASE_KEY = 'review_classification_preferences_v1';

export type ReviewClassificationPreferenceAction =
  | 'always_ask'
  | 'count_as_expense'
  | 'not_expense'
  | 'suggest_category';

export interface ReviewClassificationPreference {
  id: string;
  direction: 'debit';
  sourceToken?: string;
  accountLast4?: string;
  action: ReviewClassificationPreferenceAction;
  suggestedCategory?: string;
  updatedAt: number;
}

function safeLast4(value?: string | null): string | undefined {
  const digits = (value || '').replace(/\D/g, '');
  return digits.length === 4 ? digits : undefined;
}

function safeCategory(value?: string | null): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed || trimmed.length > 48) return undefined;
  if (/\d{6,}|@|otp|phone|address/i.test(trimmed)) return undefined;
  return /^[A-Za-z0-9 &_-]+$/.test(trimmed) ? trimmed : undefined;
}

async function getCurrentUserId(): Promise<string> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user?.id) throw new Error('Not authenticated');
  return user.id;
}

export function getReviewClassificationPreferencesKey(userId: string): string {
  return `${REVIEW_CLASSIFICATION_PREFERENCES_BASE_KEY}:user:${userId}`;
}

async function loadPreferences(userId: string): Promise<ReviewClassificationPreference[]> {
  const raw = await AsyncStorage.getItem(getReviewClassificationPreferencesKey(userId));
  if (!raw) return [];

  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function preferenceId(sourceToken?: string, accountLast4?: string): string {
  return `debit:${sourceToken || 'source'}:${accountLast4 || 'account'}`;
}

function buildPattern(source?: string | null, last4?: string | null) {
  const sourceToken = sanitizeReviewedExpenseSourceToken(source);
  const accountLast4 = safeLast4(last4);
  return {
    ...(sourceToken ? { sourceToken } : {}),
    ...(accountLast4 ? { accountLast4 } : {}),
  };
}

export async function saveReviewClassificationPreferenceForTransaction(
  transaction: Transaction,
  action: ReviewClassificationPreferenceAction,
): Promise<ReviewClassificationPreference> {
  const userId = await getCurrentUserId();
  const pattern = buildPattern(transaction.sms_sender, transaction.account_last4);
  const suggestedCategory = action === 'suggest_category'
    ? safeCategory(transaction.category)
    : undefined;
  const preference: ReviewClassificationPreference = {
    id: preferenceId(pattern.sourceToken, pattern.accountLast4),
    direction: 'debit',
    ...pattern,
    action,
    ...(suggestedCategory ? { suggestedCategory } : {}),
    updatedAt: Date.now(),
  };
  const current = await loadPreferences(userId);
  const next = [
    preference,
    ...current.filter(item => item.id !== preference.id),
  ].slice(0, 50);

  await AsyncStorage.setItem(
    getReviewClassificationPreferencesKey(userId),
    JSON.stringify(next)
  );
  return preference;
}

function preferenceMatchesItem(
  preference: ReviewClassificationPreference,
  item: ReviewItem,
): boolean {
  if (!isReviewedDebitCandidate(item)) return false;
  const pattern = buildPattern(
    item.candidate.redactedPreview.detectedSource,
    item.candidate.last4,
  );
  return preference.direction === 'debit' &&
    (!preference.sourceToken || preference.sourceToken === pattern.sourceToken) &&
    (!preference.accountLast4 || preference.accountLast4 === pattern.accountLast4);
}

export async function getReviewClassificationPreferenceSuggestions(
  items: ReviewItem[],
): Promise<Record<string, ReviewClassificationPreference>> {
  const userId = await getCurrentUserId();
  const preferences = await loadPreferences(userId);

  return items.reduce<Record<string, ReviewClassificationPreference>>((suggestions, item) => {
    const preference = preferences.find(entry => preferenceMatchesItem(entry, item));
    if (preference) suggestions[item.id] = preference;
    return suggestions;
  }, {});
}
