import { supabase } from '../core';
import { createManualBalanceCorrectionSnapshot } from './balanceSnapshots';
import { CACHE_KEYS, updateCache } from './cache';
import { emitFinanceDataChanged } from './dataEvents';

jest.mock('../core', () => ({
  supabase: {
    auth: { getUser: jest.fn() },
    from: jest.fn(),
  },
}));

jest.mock('./cache', () => ({
  CACHE_KEYS: { BANK_ACCOUNTS: 'cache_bank_accounts' },
  updateCache: jest.fn(),
}));

jest.mock('./dataEvents', () => ({
  emitFinanceDataChanged: jest.fn(),
}));

const mockedSupabase = supabase as unknown as {
  auth: { getUser: jest.Mock };
  from: jest.Mock;
};
const mockedUpdateCache = updateCache as jest.Mock;
const mockedEmitFinanceDataChanged = emitFinanceDataChanged as jest.Mock;

function setupManualCorrectionMock(bankUpdateError: unknown = null) {
  const calls: Array<{ table: string; op: string; payload?: unknown; filters: Array<[string, unknown]> }> = [];
  const snapshot = {
    id: 'snapshot_1',
    user_id: 'user_1',
    owner_type: 'bank_account',
    owner_id: 'bank_1',
    detected_bank_name: 'HDFC Bank',
    account_last4: '1234',
    card_last4: null,
    balance_kind: 'available_balance',
    amount: 4321,
    currency: 'INR',
    source: 'manual',
    confidence: 'exact',
    detected_at: '2026-06-03T10:00:00.000Z',
    source_sender_or_package: null,
    raw_source_metadata: { source: 'manual', kind: 'balance_correction' },
    note: 'Manual check',
    created_at: '2026-06-03T10:00:00.000Z',
  };

  mockedSupabase.auth.getUser.mockResolvedValue({ data: { user: { id: 'user_1' } } });
  mockedSupabase.from.mockImplementation((table: string) => {
    const call = { table, op: 'select', payload: undefined as unknown, filters: [] as Array<[string, unknown]> };
    calls.push(call);
    const query: any = {
      insert: jest.fn((payload: unknown) => {
        call.op = 'insert';
        call.payload = payload;
        return query;
      }),
      update: jest.fn((payload: unknown) => {
        call.op = 'update';
        call.payload = payload;
        return query;
      }),
      select: jest.fn(() => query),
      eq: jest.fn((column: string, value: unknown) => {
        call.filters.push([column, value]);
        return query;
      }),
      single: jest.fn(async () => ({ data: snapshot, error: null })),
      then: (resolve: any, reject: any) => {
        const result = table === 'bank_accounts'
          ? { data: null, error: bankUpdateError }
          : { data: snapshot, error: null };
        return Promise.resolve(result).then(resolve, reject);
      },
    };
    return query;
  });

  return { calls, snapshot };
}

describe('manual balance correction snapshots', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('writes through bank account balance cache and emits balance refresh event', async () => {
    const { calls, snapshot } = setupManualCorrectionMock();
    mockedUpdateCache.mockImplementation(async (_key, updater) => {
      const result = updater([{ id: 'bank_1', balance: 1000 }, { id: 'bank_2', balance: 2000 }]);
      expect(result).toEqual([{ id: 'bank_1', balance: 4321 }, { id: 'bank_2', balance: 2000 }]);
    });

    const result = await createManualBalanceCorrectionSnapshot({
      owner_type: 'bank_account',
      owner_id: 'bank_1',
      balance_kind: 'available_balance',
      amount: 4321,
      note: 'Manual check',
      account_last4: '1234',
      detected_bank_name: 'HDFC Bank',
    });

    expect(result).toBe(snapshot);
    expect(calls.find(call => call.table === 'bank_accounts')).toEqual(expect.objectContaining({
      op: 'update',
      payload: { balance: 4321 },
      filters: [['id', 'bank_1'], ['user_id', 'user_1']],
    }));
    expect(mockedUpdateCache).toHaveBeenCalledWith(CACHE_KEYS.BANK_ACCOUNTS, expect.any(Function));
    expect(mockedEmitFinanceDataChanged).toHaveBeenCalledWith({
      areas: ['accounts', 'balances'],
      source: 'manual_balance_correction',
    });
  });

  it('logs only structural information when account write-through fails', async () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    setupManualCorrectionMock({
      code: '42501',
      message: 'amount 4321 note Manual check account 123456789012',
    });

    await createManualBalanceCorrectionSnapshot({
      owner_type: 'bank_account',
      owner_id: 'bank_1',
      balance_kind: 'available_balance',
      amount: 4321,
      note: 'Manual check',
      account_last4: '1234',
      detected_bank_name: 'HDFC Bank',
    });

    const logged = JSON.stringify(warnSpy.mock.calls);
    expect(logged).toContain('Manual correction');
    expect(logged).toContain('42501');
    expect(logged).not.toContain('4321');
    expect(logged).not.toContain('Manual check');
    expect(logged).not.toContain('123456789012');
    warnSpy.mockRestore();
  });
});
