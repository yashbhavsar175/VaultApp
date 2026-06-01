import { supabase } from '../core';
import {
  buildDefaultDebtFreedomSettings,
  getDebtFreedomSettings,
  isDebtFreedomSettingsTableMissingError,
  sanitizeDebtFreedomSettingsInput,
  upsertDebtFreedomSettings,
} from './debtFreedomSettings';

declare const require: any;

const fs = require('fs');

jest.mock('../core', () => ({
  supabase: {
    auth: { getUser: jest.fn() },
    from: jest.fn(),
  },
}));

const mockedSupabase = supabase as unknown as {
  auth: { getUser: jest.Mock };
  from: jest.Mock;
};

type QueryCall = {
  table: string;
  op?: 'select' | 'upsert';
  payload?: unknown;
  options?: unknown;
  eqs: Array<[string, unknown]>;
};

class QueryBuilder {
  call: QueryCall;

  constructor(table: string, private result: { data?: unknown; error?: unknown }) {
    this.call = { table, eqs: [] };
    calls.push(this.call);
  }

  select() {
    this.call.op = this.call.op || 'select';
    return this;
  }

  eq(field: string, value: unknown) {
    this.call.eqs.push([field, value]);
    return this;
  }

  upsert(payload: unknown, options: unknown) {
    this.call.op = 'upsert';
    this.call.payload = payload;
    this.call.options = options;
    return this;
  }

  maybeSingle() {
    return Promise.resolve(this.result);
  }

  single() {
    return Promise.resolve(this.result);
  }
}

let calls: QueryCall[] = [];
let queryResult: { data?: unknown; error?: unknown };

function settingsRow(overrides = {}) {
  return {
    id: 'settings_1',
    user_id: 'user_1',
    confirmed_monthly_income: null,
    essential_monthly_expenses: null,
    emergency_contribution: 0,
    target_monthly_income: null,
    planned_monthly_debt_payment: null,
    target_debt_free_months: null,
    strategy: 'balanced',
    income_mode: 'auto',
    created_at: '2026-06-01T00:00:00.000Z',
    updated_at: '2026-06-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('debtFreedomSettings service', () => {
  beforeEach(() => {
    calls = [];
    queryResult = { data: settingsRow(), error: null };
    mockedSupabase.auth.getUser.mockResolvedValue({ data: { user: { id: 'user_1' } } });
    mockedSupabase.from.mockImplementation((table: string) => new QueryBuilder(table, queryResult));
  });

  it('builds safe default settings', () => {
    expect(buildDefaultDebtFreedomSettings()).toEqual({
      confirmed_monthly_income: null,
      essential_monthly_expenses: null,
      emergency_contribution: 0,
      target_monthly_income: null,
      planned_monthly_debt_payment: null,
      target_debt_free_months: null,
      strategy: 'balanced',
      income_mode: 'auto',
    });
  });

  it('sanitizes numeric values and ignores raw extra fields', () => {
    const sanitized = sanitizeDebtFreedomSettingsInput({
      confirmed_monthly_income: '45000.126',
      essential_monthly_expenses: '12000',
      emergency_contribution: '',
      target_monthly_income: null,
      planned_monthly_debt_payment: 8000,
      target_debt_free_months: 12,
      strategy: 'snowball',
      income_mode: 'manual_estimate',
      raw_sms: 'OTP 123456 account 123456789012',
    } as any);

    expect(sanitized).toEqual({
      confirmed_monthly_income: 45000.13,
      essential_monthly_expenses: 12000,
      emergency_contribution: 0,
      target_monthly_income: null,
      planned_monthly_debt_payment: 8000,
      target_debt_free_months: 12,
      strategy: 'snowball',
      income_mode: 'manual_estimate',
    });
    expect(JSON.stringify(sanitized)).not.toContain('OTP');
  });

  it('blocks negative and invalid numeric fields', () => {
    expect(() => sanitizeDebtFreedomSettingsInput({ confirmed_monthly_income: -1 })).toThrow('non-negative');
    expect(() => sanitizeDebtFreedomSettingsInput({ essential_monthly_expenses: 'abc' })).toThrow('non-negative');
  });

  it('blocks invalid strategy and income mode', () => {
    expect(() => sanitizeDebtFreedomSettingsInput({ strategy: 'fastest' })).toThrow('strategy');
    expect(() => sanitizeDebtFreedomSettingsInput({ income_mode: 'salary' })).toThrow('income mode');
  });

  it('blocks target month values outside 1..600', () => {
    expect(() => sanitizeDebtFreedomSettingsInput({ target_debt_free_months: 0 })).toThrow('between 1 and 600');
    expect(() => sanitizeDebtFreedomSettingsInput({ target_debt_free_months: 601 })).toThrow('between 1 and 600');
    expect(() => sanitizeDebtFreedomSettingsInput({ target_debt_free_months: 12.5 })).toThrow('between 1 and 600');
  });

  it('loads settings for the authenticated user only', async () => {
    queryResult = { data: settingsRow({ essential_monthly_expenses: 15000 }), error: null };

    const result = await getDebtFreedomSettings();

    expect(result?.essential_monthly_expenses).toBe(15000);
    expect(calls[0].table).toBe('debt_freedom_settings');
    expect(calls[0].eqs).toContainEqual(['user_id', 'user_1']);
  });

  it('upserts settings with user_id from auth and whitelisted fields only', async () => {
    queryResult = { data: settingsRow({ planned_monthly_debt_payment: 7000 }), error: null };

    await upsertDebtFreedomSettings({
      planned_monthly_debt_payment: 7000,
      strategy: 'avalanche',
      raw_payload: { secret: 'do not save' },
    } as any);

    const payload = calls[0].payload as Record<string, unknown>;
    expect(calls[0]).toEqual(expect.objectContaining({
      table: 'debt_freedom_settings',
      op: 'upsert',
      options: { onConflict: 'user_id' },
    }));
    expect(payload.user_id).toBe('user_1');
    expect(payload.planned_monthly_debt_payment).toBe(7000);
    expect(payload.strategy).toBe('avalanche');
    expect(payload).not.toHaveProperty('raw_payload');
    expect(payload).not.toHaveProperty('id');
  });

  it('identifies missing-table fallback errors', () => {
    expect(isDebtFreedomSettingsTableMissingError({ code: '42P01' })).toBe(true);
    expect(isDebtFreedomSettingsTableMissingError({ code: '42703' })).toBe(true);
    expect(isDebtFreedomSettingsTableMissingError({ code: 'PGRST205' })).toBe(true);
    expect(isDebtFreedomSettingsTableMissingError({ code: '42501' })).toBe(false);
  });

  it('does not log raw values', () => {
    const source = fs.readFileSync('src/lib/services/debtFreedomSettings.ts', 'utf8');

    expect(source).not.toMatch(/console\./);
    expect(source).not.toMatch(/raw_sms|notification_text|raw payload|profile object/i);
  });
});
