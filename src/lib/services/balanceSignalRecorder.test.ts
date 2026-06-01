import {
  recordBalanceSignalForUser,
  recordEstimatedBankBalanceMovementForUser,
} from './balanceSignalRecorder';
import { supabase } from '../core';

jest.mock('../core', () => ({
  supabase: {
    from: jest.fn(),
  },
}));

const mockSupabase = supabase as any;

type Row = Record<string, any>;

const tables: Record<string, Row[]> = {
  bank_accounts: [],
  credit_cards: [],
  balance_snapshots: [],
  detected_accounts: [],
  debit_cards: [],
  credit_card_statements: [],
};

let nextId = 1;

function valueForKey(row: Row, key: string): any {
  if (key === 'raw_source_metadata->>hash') {
    return row.raw_source_metadata?.hash;
  }
  return row[key];
}

function matchingRows(table: string, filters: Array<{ key: string; value: any; op: 'eq' | 'is' | 'gte' }>): Row[] {
  return tables[table].filter(row => filters.every(filter => {
    const value = valueForKey(row, filter.key);
    if (filter.op === 'is') return value === filter.value;
    if (filter.op === 'gte') return String(value) >= String(filter.value);
    return value === filter.value;
  }));
}

function setupSupabaseMock() {
  mockSupabase.from.mockImplementation((table: string) => {
    const filters: Array<{ key: string; value: any; op: 'eq' | 'is' | 'gte' }> = [];
    let limitCount: number | null = null;
    let operation: 'insert' | 'update' | null = null;
    let operationPayload: Row | null = null;

    const queryRows = () => {
      const rows = matchingRows(table, filters);
      return limitCount ? rows.slice(0, limitCount) : rows;
    };

    const builder: any = {
      select: jest.fn(() => builder),
      eq: jest.fn((key: string, value: any) => {
        filters.push({ key, value, op: 'eq' });
        return builder;
      }),
      is: jest.fn((key: string, value: any) => {
        filters.push({ key, value, op: 'is' });
        return builder;
      }),
      gte: jest.fn((key: string, value: any) => {
        filters.push({ key, value, op: 'gte' });
        return builder;
      }),
      order: jest.fn(() => builder),
      limit: jest.fn((count: number) => {
        limitCount = count;
        return builder;
      }),
      maybeSingle: jest.fn(async () => ({ data: queryRows()[0] || null, error: null })),
      single: jest.fn(async () => {
        if (operation === 'insert' && operationPayload) {
          const row = {
            id: `${table}_${nextId++}`,
            created_at: '2026-05-29T00:00:00.000Z',
            updated_at: '2026-05-29T00:00:00.000Z',
            ...operationPayload,
          };
          tables[table].push(row);
          return { data: row, error: null };
        }

        if (operation === 'update' && operationPayload) {
          const row = queryRows()[0];
          if (!row) return { data: null, error: null };
          Object.assign(row, operationPayload);
          return { data: row, error: null };
        }

        return { data: queryRows()[0] || null, error: null };
      }),
      insert: jest.fn((payload: Row) => {
        operation = 'insert';
        operationPayload = payload;
        return builder;
      }),
      update: jest.fn((payload: Row) => {
        operation = 'update';
        operationPayload = payload;
        return builder;
      }),
      then: jest.fn((resolve, reject) => Promise
        .resolve({ data: queryRows(), error: null })
        .then(resolve, reject)),
    };

    return builder;
  });
}

function resetTables() {
  for (const rows of Object.values(tables)) rows.length = 0;
  nextId = 1;
}

describe('balance signal runtime recorder', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resetTables();
    setupSupabaseMock();
  });

  it('creates a balance snapshot for a matched bank account', async () => {
    tables.bank_accounts.push({
      id: 'bank_1',
      user_id: 'user_1',
      bank_name: 'HDFC Bank',
      account_last4: '1234',
      account_type: 'savings',
    });

    const result = await recordBalanceSignalForUser({
      userId: 'user_1',
      sourceType: 'sms',
      senderOrPackage: 'HDFCBK',
      timestamp: Date.UTC(2026, 4, 29),
      text: 'HDFC Bank: Rs.100 debited from A/c XX1234. Avl Bal Rs.12,000. UPI Ref 123456789012.',
    });

    expect(result.snapshots).toHaveLength(1);
    expect(tables.balance_snapshots[0]).toEqual(expect.objectContaining({
      owner_type: 'bank_account',
      owner_id: 'bank_1',
      account_last4: '1234',
      balance_kind: 'available_balance',
      amount: 12000,
      source: 'sms',
    }));
    expect(tables.detected_accounts).toHaveLength(0);
  });

  it('creates a pending detected account and snapshot when a bank account is missing', async () => {
    await recordBalanceSignalForUser({
      userId: 'user_1',
      sourceType: 'sms',
      senderOrPackage: 'SBIN',
      timestamp: Date.UTC(2026, 4, 29),
      text: 'SBI account ending 9988 credited by Rs.500. Available Balance INR 4,500.',
    });

    expect(tables.detected_accounts).toHaveLength(1);
    expect(tables.detected_accounts[0]).toEqual(expect.objectContaining({
      detection_type: 'bank_account',
      status: 'pending',
      account_last4: '9988',
      balance_amount: 4500,
    }));
    expect(tables.balance_snapshots[0]).toEqual(expect.objectContaining({
      owner_type: 'detected_account',
      owner_id: tables.detected_accounts[0].id,
      amount: 4500,
    }));
  });

  it('does not attach to a same-last4 account when the detected bank conflicts', async () => {
    tables.bank_accounts.push({
      id: 'bank_axis_1',
      user_id: 'user_1',
      bank_name: 'Axis Bank',
      account_last4: '9988',
      account_type: 'savings',
    });

    await recordBalanceSignalForUser({
      userId: 'user_1',
      sourceType: 'sms',
      senderOrPackage: 'SBIN',
      timestamp: Date.UTC(2026, 4, 29),
      text: 'SBI account ending 9988 credited by Rs.500. Available Balance INR 4,500.',
    });

    expect(tables.balance_snapshots[0]).toEqual(expect.objectContaining({
      owner_type: 'detected_account',
      owner_id: tables.detected_accounts[0].id,
    }));
    expect(tables.balance_snapshots[0].owner_id).not.toBe('bank_axis_1');
  });

  it('does not duplicate snapshots or detected candidates for repeated messages', async () => {
    const input = {
      userId: 'user_1',
      sourceType: 'notification' as const,
      senderOrPackage: 'com.google.android.apps.nbu.paisa.user',
      timestamp: Date.UTC(2026, 4, 29),
      text: 'ICICI account ending 7788 debited Rs.50. Avl Bal Rs.2,000.',
    };

    await recordBalanceSignalForUser(input);
    await recordBalanceSignalForUser({ ...input, timestamp: Date.UTC(2026, 4, 29, 0, 2) });

    expect(tables.detected_accounts).toHaveLength(1);
    expect(tables.balance_snapshots).toHaveLength(1);
  });

  it('allows a later different balance without creating another detected account candidate', async () => {
    const baseInput = {
      userId: 'user_1',
      sourceType: 'sms' as const,
      senderOrPackage: 'ICICIB',
      timestamp: Date.UTC(2026, 4, 29),
    };

    await recordBalanceSignalForUser({
      ...baseInput,
      text: 'ICICI account ending 7788 debited Rs.50. Avl Bal Rs.2,000.',
    });
    await recordBalanceSignalForUser({
      ...baseInput,
      timestamp: Date.UTC(2026, 4, 29, 0, 10),
      text: 'ICICI account ending 7788 debited Rs.75. Avl Bal Rs.1,925.',
    });

    expect(tables.detected_accounts).toHaveLength(1);
    expect(tables.balance_snapshots).toHaveLength(2);
    expect(tables.balance_snapshots.map(row => row.amount)).toEqual([2000, 1925]);
    expect(tables.balance_snapshots.every(row => row.owner_id === tables.detected_accounts[0].id)).toBe(true);
  });

  it('creates credit card snapshots and statement for a matched card', async () => {
    tables.credit_cards.push({
      id: 'card_1',
      user_id: 'user_1',
      bank_name: 'HDFC Bank',
      last_4_digits: '4321',
    });

    await recordBalanceSignalForUser({
      userId: 'user_1',
      sourceType: 'sms',
      senderOrPackage: 'HDFCBK',
      timestamp: Date.UTC(2026, 4, 29),
      text: 'HDFC Credit Card XX4321 statement generated for Rs.12,000. Minimum amount due Rs.500. Payment due date 05 Jun 2026. Available limit Rs.38,000.',
    });

    expect(tables.balance_snapshots.some(row => row.owner_type === 'credit_card' && row.owner_id === 'card_1')).toBe(true);
    expect(tables.credit_card_statements).toHaveLength(1);
    expect(tables.credit_card_statements[0]).toEqual(expect.objectContaining({
      credit_card_id: 'card_1',
      minimum_due: 500,
      payment_due_date: '2026-06-05',
      statement_balance: 12000,
    }));
  });

  it('creates a pending detected credit card candidate when the card is missing', async () => {
    await recordBalanceSignalForUser({
      userId: 'user_1',
      sourceType: 'notification',
      senderOrPackage: 'com.dreamplug.androidapp',
      timestamp: Date.UTC(2026, 4, 29),
      text: 'ICICI Credit Card XX2468 total outstanding Rs.7,000. Available limit Rs.43,000.',
    });

    expect(tables.detected_accounts[0]).toEqual(expect.objectContaining({
      detection_type: 'credit_card',
      card_last4: '2468',
      status: 'pending',
    }));
    expect(tables.balance_snapshots[0]).toEqual(expect.objectContaining({
      owner_type: 'detected_card',
      owner_id: tables.detected_accounts[0].id,
    }));
  });

  it('records a detected debit card when its bank account is matched', async () => {
    tables.bank_accounts.push({
      id: 'bank_1',
      user_id: 'user_1',
      bank_name: 'HDFC Bank',
      account_last4: '1234',
      account_type: 'savings',
    });

    await recordBalanceSignalForUser({
      userId: 'user_1',
      sourceType: 'sms',
      senderOrPackage: 'HDFCBK',
      timestamp: Date.UTC(2026, 4, 29),
      text: 'HDFC: Rs.200 spent on debit card ending 5678 linked to A/c XX1234 at POS. Avl Bal Rs.5,000.',
    });

    expect(tables.debit_cards).toHaveLength(1);
    expect(tables.debit_cards[0]).toEqual(expect.objectContaining({
      bank_account_id: 'bank_1',
      card_last4: '5678',
      status: 'detected',
    }));
  });

  it('keeps an unmatched debit card as a pending candidate without creating a debit card row', async () => {
    await recordBalanceSignalForUser({
      userId: 'user_1',
      sourceType: 'sms',
      senderOrPackage: 'HDFCBK',
      timestamp: Date.UTC(2026, 4, 29),
      text: 'HDFC: Rs.200 spent on debit card ending 5678 linked to A/c XX1234 at POS. Avl Bal Rs.5,000.',
    });

    expect(tables.debit_cards).toHaveLength(0);
    expect(tables.detected_accounts).toEqual(expect.arrayContaining([
      expect.objectContaining({
        detection_type: 'bank_account',
        account_last4: '1234',
        status: 'pending',
      }),
      expect.objectContaining({
        detection_type: 'debit_card',
        card_last4: '5678',
        status: 'pending',
      }),
    ]));
  });

  it('stores only redacted metadata, safe reasons, and last4 identifiers', async () => {
    await recordBalanceSignalForUser({
      userId: 'user_1',
      sourceType: 'sms',
      senderOrPackage: '9876543210',
      timestamp: Date.UTC(2026, 4, 29),
      text: 'HDFC Bank: A/c 123456789012 Avl Bal Rs.1,000. OTP 123456. Call 9876543210.',
    });

    const serialized = JSON.stringify({
      snapshots: tables.balance_snapshots,
      candidates: tables.detected_accounts,
    });

    expect(serialized).not.toContain('123456789012');
    expect(serialized).not.toContain('9876543210');
    expect(serialized).not.toContain('OTP');
    expect(tables.balance_snapshots[0].raw_source_metadata).toEqual(expect.objectContaining({
      len: expect.any(Number),
      hash: expect.stringMatching(/^[a-f0-9]{8}$/),
      source: 'sms',
      kind: 'balance_signal',
      reasons: expect.any(Array),
    }));
  });

  it('creates an estimated calculated snapshot from the latest known bank balance', async () => {
    tables.bank_accounts.push({
      id: 'bank_1',
      user_id: 'user_1',
      bank_name: 'Kotak Bank',
      account_last4: '1447',
      account_type: 'savings',
      balance: 10000,
    });
    tables.balance_snapshots.push({
      id: 'snap_existing',
      user_id: 'user_1',
      owner_type: 'bank_account',
      owner_id: 'bank_1',
      account_last4: '1447',
      detected_bank_name: 'Kotak Bank',
      balance_kind: 'available_balance',
      amount: 10000,
      source: 'sms',
      confidence: 'exact',
      detected_at: '2026-06-01T05:00:00.000Z',
      created_at: '2026-06-01T05:00:00.000Z',
      raw_source_metadata: { hash: '11111111' },
    });

    const snapshot = await recordEstimatedBankBalanceMovementForUser({
      userId: 'user_1',
      bankAccountId: 'bank_1',
      amount: 5000,
      direction: 'credit',
      sourceType: 'notification',
      timestamp: Date.UTC(2026, 5, 1, 5, 15),
      sourceHash: 'abcdef12',
      sourceLength: 56,
      senderOrPackage: 'com.google.android.apps.nbu.paisa.user',
    });

    expect(snapshot).toEqual(expect.objectContaining({
      owner_type: 'bank_account',
      owner_id: 'bank_1',
      balance_kind: 'available_balance',
      amount: 15000,
      source: 'calculated',
      confidence: 'estimated',
    }));
    expect(tables.balance_snapshots).toHaveLength(2);
    expect(tables.balance_snapshots[1].raw_source_metadata).toEqual(expect.objectContaining({
      hash: 'abcdef12',
      kind: 'transaction_balance_estimate',
      source: 'notification',
    }));
  });

  it('does not invent an estimated balance without a previous known balance', async () => {
    tables.bank_accounts.push({
      id: 'bank_1',
      user_id: 'user_1',
      bank_name: 'Kotak Bank',
      account_last4: '1447',
      account_type: 'savings',
      balance: null,
    });

    const snapshot = await recordEstimatedBankBalanceMovementForUser({
      userId: 'user_1',
      bankAccountId: 'bank_1',
      amount: 5000,
      direction: 'credit',
      sourceType: 'notification',
      sourceHash: 'abcdef12',
    });

    expect(snapshot).toBeNull();
    expect(tables.balance_snapshots).toHaveLength(0);
  });

  it('subtracts a matched debit when creating an estimated calculated snapshot', async () => {
    tables.bank_accounts.push({
      id: 'bank_1',
      user_id: 'user_1',
      bank_name: 'Kotak Bank',
      account_last4: '1447',
      account_type: 'savings',
      balance: 10000,
    });

    const snapshot = await recordEstimatedBankBalanceMovementForUser({
      userId: 'user_1',
      bankAccountId: 'bank_1',
      amount: 1500,
      direction: 'debit',
      sourceType: 'sms',
      sourceHash: 'abcdef12',
    });

    expect(snapshot).toEqual(expect.objectContaining({
      owner_type: 'bank_account',
      owner_id: 'bank_1',
      amount: 8500,
      source: 'calculated',
      confidence: 'estimated',
    }));
  });
});
