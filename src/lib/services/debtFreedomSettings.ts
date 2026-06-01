import { supabase } from '../core';
import { DebtFreedomStrategy } from './debtFreedom';

export type DebtFreedomIncomeMode = 'auto' | 'confirmed' | 'manual_estimate';

export interface DebtFreedomSettings {
  id: string;
  user_id: string;
  confirmed_monthly_income: number | null;
  essential_monthly_expenses: number | null;
  emergency_contribution: number;
  target_monthly_income: number | null;
  planned_monthly_debt_payment: number | null;
  target_debt_free_months: number | null;
  strategy: DebtFreedomStrategy;
  income_mode: DebtFreedomIncomeMode;
  created_at: string;
  updated_at: string;
}

export type DebtFreedomSettingsInput = Partial<Record<
  | 'confirmed_monthly_income'
  | 'essential_monthly_expenses'
  | 'emergency_contribution'
  | 'target_monthly_income'
  | 'planned_monthly_debt_payment'
  | 'target_debt_free_months'
  | 'strategy'
  | 'income_mode',
  unknown
>>;

export type SanitizedDebtFreedomSettingsInput = {
  confirmed_monthly_income: number | null;
  essential_monthly_expenses: number | null;
  emergency_contribution: number;
  target_monthly_income: number | null;
  planned_monthly_debt_payment: number | null;
  target_debt_free_months: number | null;
  strategy: DebtFreedomStrategy;
  income_mode: DebtFreedomIncomeMode;
};

const STRATEGIES = new Set<DebtFreedomStrategy>(['balanced', 'snowball', 'avalanche']);
const INCOME_MODES = new Set<DebtFreedomIncomeMode>(['auto', 'confirmed', 'manual_estimate']);

const SETTINGS_COLUMNS = [
  'id',
  'user_id',
  'confirmed_monthly_income',
  'essential_monthly_expenses',
  'emergency_contribution',
  'target_monthly_income',
  'planned_monthly_debt_payment',
  'target_debt_free_months',
  'strategy',
  'income_mode',
  'created_at',
  'updated_at',
].join(', ');

function numericValue(value: unknown, field: string, nullable: boolean): number | null {
  if (value === undefined || value === null || value === '') {
    if (nullable) return null;
    return 0;
  }
  const parsed = typeof value === 'number' ? value : Number(String(value).trim());
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`${field} must be a non-negative number`);
  }
  return Math.round((parsed + Number.EPSILON) * 100) / 100;
}

function targetMonthsValue(value: unknown): number | null {
  if (value === undefined || value === null || value === '') return null;
  const parsed = typeof value === 'number' ? value : Number(String(value).trim());
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 600) {
    throw new Error('target_debt_free_months must be between 1 and 600');
  }
  return parsed;
}

function strategyValue(value: unknown): DebtFreedomStrategy {
  if (value === undefined || value === null || value === '') return 'balanced';
  if (typeof value === 'string' && STRATEGIES.has(value as DebtFreedomStrategy)) {
    return value as DebtFreedomStrategy;
  }
  throw new Error('Invalid debt freedom strategy');
}

function incomeModeValue(value: unknown): DebtFreedomIncomeMode {
  if (value === undefined || value === null || value === '') return 'auto';
  if (typeof value === 'string' && INCOME_MODES.has(value as DebtFreedomIncomeMode)) {
    return value as DebtFreedomIncomeMode;
  }
  throw new Error('Invalid debt freedom income mode');
}

export function buildDefaultDebtFreedomSettings(): SanitizedDebtFreedomSettingsInput {
  return {
    confirmed_monthly_income: null,
    essential_monthly_expenses: null,
    emergency_contribution: 0,
    target_monthly_income: null,
    planned_monthly_debt_payment: null,
    target_debt_free_months: null,
    strategy: 'balanced',
    income_mode: 'auto',
  };
}

export function sanitizeDebtFreedomSettingsInput(
  input: DebtFreedomSettingsInput = {}
): SanitizedDebtFreedomSettingsInput {
  return {
    confirmed_monthly_income: numericValue(input.confirmed_monthly_income, 'confirmed_monthly_income', true),
    essential_monthly_expenses: numericValue(input.essential_monthly_expenses, 'essential_monthly_expenses', true),
    emergency_contribution: numericValue(input.emergency_contribution, 'emergency_contribution', false) || 0,
    target_monthly_income: numericValue(input.target_monthly_income, 'target_monthly_income', true),
    planned_monthly_debt_payment: numericValue(input.planned_monthly_debt_payment, 'planned_monthly_debt_payment', true),
    target_debt_free_months: targetMonthsValue(input.target_debt_free_months),
    strategy: strategyValue(input.strategy),
    income_mode: incomeModeValue(input.income_mode),
  };
}

export function isDebtFreedomSettingsTableMissingError(error: unknown): boolean {
  const code = (error as { code?: string } | null)?.code;
  return code === '42P01' || code === '42703' || code === 'PGRST204' || code === 'PGRST205';
}

async function getCurrentUserId(): Promise<string> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user?.id) throw new Error('Not authenticated');
  return user.id;
}

export async function getDebtFreedomSettings(): Promise<DebtFreedomSettings | null> {
  const userId = await getCurrentUserId();
  const { data, error } = await supabase
    .from('debt_freedom_settings')
    .select(SETTINGS_COLUMNS)
    .eq('user_id', userId)
    .maybeSingle();

  if (error) throw error;
  return data as unknown as DebtFreedomSettings | null;
}

export async function upsertDebtFreedomSettings(
  input: DebtFreedomSettingsInput
): Promise<DebtFreedomSettings> {
  const userId = await getCurrentUserId();
  const sanitized = sanitizeDebtFreedomSettingsInput(input);
  const { data, error } = await supabase
    .from('debt_freedom_settings')
    .upsert({
      ...sanitized,
      user_id: userId,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id' })
    .select(SETTINGS_COLUMNS)
    .single();

  if (error) throw error;
  return data as unknown as DebtFreedomSettings;
}
