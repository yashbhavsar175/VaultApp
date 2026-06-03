import { supabase } from '../core';
import {
  buildManualBalanceCorrectionSnapshotInput,
  createManualBalanceCorrectionSnapshot,
  parseManualBalanceCorrectionAmount,
  sanitizeBalanceSourceMetadata,
} from './balanceSnapshots';

jest.mock('../core', () => ({
  supabase: {
    auth: {
      getUser: jest.fn(),
    },
    from: jest.fn(),
  },
}));

const mockedSupabase = supabase as unknown as {
  auth: { getUser: jest.Mock };
  from: jest.Mock;
};

function setupSnapshotInsert() {
  const tables: string[] = [];
  const inserts: Record<string, any[]> = {};
  const updates: Record<string, any[]> = {};

  mockedSupabase.auth.getUser.mockResolvedValue({
    data: { user: { id: 'user_1' } },
  });

  mockedSupabase.from.mockImplementation((table: string) => {
    tables.push(table);
    const updateQuery: any = {
      eq: jest.fn(() => updateQuery),
      then: (resolve: any, reject: any) => Promise.resolve({ data: null, error: null }).then(resolve, reject),
    };
    return {
      insert: jest.fn((payload) => {
        inserts[table] = [...(inserts[table] || []), payload];
        return {
          select: jest.fn(() => ({
            single: jest.fn(async () => ({
              data: {
                id: `${table}_1`,
                created_at: '2026-05-29T10:00:00.000Z',
                ...payload,
              },
              error: null,
            })),
          })),
        };
      }),
      update: jest.fn((payload) => {
        updates[table] = [...(updates[table] || []), payload];
        return updateQuery;
      }),
    };
  });

  return { tables, inserts, updates };
}

describe('manual balance correction snapshots', () => {
  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(new Date('2026-05-29T10:00:00.000Z'));
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('creates a manual exact bank available balance snapshot payload', async () => {
    const { tables, inserts, updates } = setupSnapshotInsert();

    await createManualBalanceCorrectionSnapshot({
      owner_type: 'bank_account',
      owner_id: 'bank_1',
      balance_kind: 'available_balance',
      amount: 1234.56,
      account_last4: 'XX1234',
      detected_bank_name: 'HDFC Bank',
      note: 'Manual branch check',
    });

    expect(tables).toEqual(['balance_snapshots', 'bank_accounts']);
    expect(inserts.balance_snapshots[0]).toEqual(expect.objectContaining({
      user_id: 'user_1',
      owner_type: 'bank_account',
      owner_id: 'bank_1',
      account_last4: '1234',
      balance_kind: 'available_balance',
      amount: 1234.56,
      currency: 'INR',
      source: 'manual',
      confidence: 'exact',
      detected_at: '2026-05-29T10:00:00.000Z',
      raw_source_metadata: { source: 'manual', kind: 'balance_correction' },
      note: 'Manual branch check',
    }));
    expect(updates.bank_accounts[0]).toEqual({ balance: 1234.56 });
  });

  it('creates a manual exact bank current balance snapshot payload', () => {
    const payload = buildManualBalanceCorrectionSnapshotInput({
      owner_type: 'bank_account',
      owner_id: 'bank_1',
      balance_kind: 'current_balance',
      amount: 2500,
    });

    expect(payload).toEqual(expect.objectContaining({
      owner_type: 'bank_account',
      owner_id: 'bank_1',
      balance_kind: 'current_balance',
      amount: 2500,
      source: 'manual',
      confidence: 'exact',
      currency: 'INR',
    }));
  });

  it('creates a manual credit card outstanding snapshot payload', () => {
    const payload = buildManualBalanceCorrectionSnapshotInput({
      owner_type: 'credit_card',
      owner_id: 'card_1',
      balance_kind: 'outstanding',
      amount: 3456,
      card_last4: '4321',
    });

    expect(payload).toEqual(expect.objectContaining({
      owner_type: 'credit_card',
      owner_id: 'card_1',
      card_last4: '4321',
      balance_kind: 'outstanding',
      source: 'manual',
      confidence: 'exact',
    }));
  });

  it.each([
    ['available_limit' as const, 21000],
    ['credit_limit' as const, 50000],
  ])('creates a manual credit card %s snapshot payload', (balanceKind, amount) => {
    const payload = buildManualBalanceCorrectionSnapshotInput({
      owner_type: 'credit_card',
      owner_id: 'card_1',
      balance_kind: balanceKind,
      amount,
    });

    expect(payload).toEqual(expect.objectContaining({
      owner_type: 'credit_card',
      balance_kind: balanceKind,
      amount,
      source: 'manual',
      confidence: 'exact',
    }));
  });

  it('creates a manual loan outstanding snapshot payload', () => {
    const payload = buildManualBalanceCorrectionSnapshotInput({
      owner_type: 'loan',
      owner_id: 'loan_1',
      balance_kind: 'loan_outstanding',
      amount: 90000,
      account_last4: '9999',
    });

    expect(payload).toEqual(expect.objectContaining({
      owner_type: 'loan',
      owner_id: 'loan_1',
      account_last4: '9999',
      balance_kind: 'loan_outstanding',
      source: 'manual',
      confidence: 'exact',
    }));
  });

  it('rejects a manual balance kind that does not match the owner type', () => {
    expect(() => buildManualBalanceCorrectionSnapshotInput({
      owner_type: 'bank_account',
      owner_id: 'bank_1',
      balance_kind: 'outstanding',
      amount: 100,
    })).toThrow('Balance kind is not valid for this balance owner');
  });

  it('requires an owner id for manual corrections', () => {
    expect(() => buildManualBalanceCorrectionSnapshotInput({
      owner_type: 'bank_account',
      owner_id: '  ',
      balance_kind: 'available_balance',
      amount: 100,
    })).toThrow('Balance owner is required');
  });

  it('does not insert fake transaction, card transaction, emi, or bank account rows', async () => {
    const { tables, inserts, updates } = setupSnapshotInsert();

    await createManualBalanceCorrectionSnapshot({
      owner_type: 'bank_account',
      owner_id: 'bank_1',
      balance_kind: 'available_balance',
      amount: 100,
    });

    expect(tables).toEqual(['balance_snapshots', 'bank_accounts']);
    expect(tables).not.toContain('transactions');
    expect(tables).not.toContain('cc_transactions');
    expect(tables).not.toContain('emi_payments');
    expect(inserts.bank_accounts).toBeUndefined();
    expect(updates.bank_accounts[0]).toEqual({ balance: 100 });
  });

  it('sanitizes manual notes and metadata', async () => {
    const { inserts } = setupSnapshotInsert();

    await createManualBalanceCorrectionSnapshot({
      owner_type: 'bank_account',
      owner_id: 'bank_1',
      balance_kind: 'available_balance',
      amount: 100,
      note: 'OTP 123456 from account 123456789012',
    });

    expect(inserts.balance_snapshots[0].note).toBeNull();
    expect(inserts.balance_snapshots[0].raw_source_metadata).toEqual({
      source: 'manual',
      kind: 'balance_correction',
    });
    expect(JSON.stringify(inserts.balance_snapshots[0])).not.toContain('123456789012');
  });

  it('preserves safe redacted hashes even when they are numeric-looking', () => {
    expect(sanitizeBalanceSourceMetadata({
      hash: '26212621',
      len: 116,
      source: 'sms',
      raw_sms: 'Full raw SMS should be dropped',
    })).toEqual({
      hash: '26212621',
      len: 116,
      source: 'sms',
    });
  });

  it.each(['', 'abc', '-1', '12.345'])('blocks invalid manual amount input: %s', (value) => {
    expect(parseManualBalanceCorrectionAmount(value)).toBeNull();
  });

  it('parses a non-negative manual amount input', () => {
    expect(parseManualBalanceCorrectionAmount('₹1,234.50')).toBe(1234.5);
  });
});
