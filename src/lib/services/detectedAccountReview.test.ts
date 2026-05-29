import { supabase } from '../core';
import { removeCache } from './cache';
import { emitFinanceDataChanged } from './dataEvents';
import {
  DetectedAccountDuplicateError,
  buildDetectedAccountReviewItems,
  confirmDetectedBankAccount,
  confirmDetectedCreditCard,
  confirmDetectedDebitCard,
  ignoreDetectedAccount,
  mergeDetectedAccount,
} from './detectedAccountReview';

jest.mock('../core', () => ({
  supabase: {
    auth: {
      getUser: jest.fn(),
    },
    from: jest.fn(),
  },
}));

jest.mock('./cache', () => ({
  CACHE_KEYS: {
    BANK_ACCOUNTS: 'cache_bank_accounts',
  },
  removeCache: jest.fn(),
}));

jest.mock('./dataEvents', () => ({
  emitFinanceDataChanged: jest.fn(),
}));

const mockedSupabase = supabase as unknown as {
  auth: { getUser: jest.Mock };
  from: jest.Mock;
};

type Tables = Record<string, any[]>;

const BASE_TIME = '2026-05-29T10:00:00.000Z';

function makeDetection(overrides: Partial<any> = {}) {
  return ({
    id: overrides.id || 'detected_1',
    user_id: 'user_1',
    detection_type: 'bank_account',
    detected_bank_name: 'HDFC Bank',
    account_last4: '1234',
    card_last4: null,
    account_type_hint: 'savings',
    balance_amount: 1234.5,
    balance_kind: 'available_balance',
    source: 'sms',
    confidence: 'exact',
    status: 'pending',
    matched_owner_type: null,
    matched_owner_id: null,
    source_sender_or_package: 'HDFCBK',
    raw_source_metadata: { raw_sms: 'OTP 123456 account 123456789012', hash: 'safe_hash' },
    first_seen_at: BASE_TIME,
    last_seen_at: BASE_TIME,
    created_at: BASE_TIME,
    updated_at: BASE_TIME,
    ...overrides,
  } as any);
}

function setupSupabase(initialTables: Partial<Tables> = {}) {
  const tables: Tables = {
    detected_accounts: [],
    bank_accounts: [],
    credit_cards: [],
    debit_cards: [],
    balance_snapshots: [],
    transactions: [],
    cc_transactions: [],
    emi_payments: [],
    ...initialTables,
  };
  const tableCalls: string[] = [];
  let idCounter = 1;

  mockedSupabase.auth.getUser.mockResolvedValue({ data: { user: { id: 'user_1' } } });
  mockedSupabase.from.mockImplementation((table: string) => {
    tableCalls.push(table);
    if (!tables[table]) tables[table] = [];
    return createQuery(table);
  });

  function createQuery(table: string) {
    const filters: Array<{ column: string; value: unknown; mode: 'eq' | 'is' }> = [];
    let op: 'select' | 'insert' | 'update' = 'select';
    let payload: any;
    let limitCount: number | null = null;

    const query: any = {
      select: jest.fn(() => query),
      insert: jest.fn((value: any) => {
        op = 'insert';
        payload = value;
        return query;
      }),
      update: jest.fn((value: any) => {
        op = 'update';
        payload = value;
        return query;
      }),
      eq: jest.fn((column: string, value: unknown) => {
        filters.push({ column, value, mode: 'eq' });
        return query;
      }),
      is: jest.fn((column: string, value: unknown) => {
        filters.push({ column, value, mode: 'is' });
        return query;
      }),
      order: jest.fn(() => query),
      limit: jest.fn((count: number) => {
        limitCount = count;
        return query;
      }),
      maybeSingle: jest.fn(async () => executeSingle(true)),
      single: jest.fn(async () => executeSingle(false)),
      then: (resolve: any, reject: any) => executeList().then(resolve, reject),
    };

    function matches(row: any) {
      return filters.every(filter => {
        if (filter.mode === 'is') return row[filter.column] === filter.value;
        return row[filter.column] === filter.value;
      });
    }

    function matchingRows() {
      const rows = tables[table].filter(matches);
      return limitCount === null ? rows : rows.slice(0, limitCount);
    }

    async function executeList() {
      if (op === 'insert') {
        const rows = Array.isArray(payload) ? payload : [payload];
        const inserted = rows.map(row => ({
          id: `${table}_${idCounter++}`,
          created_at: BASE_TIME,
          updated_at: BASE_TIME,
          ...row,
        }));
        tables[table].push(...inserted);
        return { data: Array.isArray(payload) ? inserted : inserted[0], error: null };
      }

      if (op === 'update') {
        const rows = matchingRows();
        rows.forEach(row => Object.assign(row, payload));
        return { data: rows, error: null };
      }

      return { data: matchingRows(), error: null };
    }

    async function executeSingle(maybe: boolean) {
      if (op === 'insert') {
        const result = await executeList();
        return { data: Array.isArray(result.data) ? result.data[0] : result.data, error: null };
      }

      if (op === 'update') {
        const result = await executeList();
        const row = result.data[0] || null;
        if (!row && !maybe) return { data: null, error: { message: 'No rows' } };
        return { data: row, error: null };
      }

      const row = matchingRows()[0] || null;
      if (!row && !maybe) return { data: null, error: { message: 'No rows' } };
      return { data: row, error: null };
    }

    return query;
  }

  return { tables, tableCalls };
}

describe('detected account review service', () => {
  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(new Date(BASE_TIME));
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('builds privacy-safe pending candidate view models without raw metadata', () => {
    const items = buildDetectedAccountReviewItems([
      makeDetection({
        detected_bank_name: 'OTP 123456 account 123456789012',
        raw_source_metadata: {
          raw_sms: 'Full raw SMS with OTP 123456',
          payload: { phone: '9876543210' },
        },
      }),
    ]);

    expect(items[0]).toEqual(expect.objectContaining({
      bankName: 'Unknown bank',
      accountLast4: '1234',
      sourceLabel: 'SMS',
      confidenceLabel: 'Exact',
    }));
    expect(JSON.stringify(items)).not.toContain('raw_sms');
    expect(JSON.stringify(items)).not.toContain('9876543210');
    expect(JSON.stringify(items)).not.toContain('123456789012');
  });

  it('confirms a bank account only when the explicit confirm action calls the service', async () => {
    const { tables, tableCalls } = setupSupabase({
      detected_accounts: [makeDetection()],
    });

    expect(tables.bank_accounts).toHaveLength(0);

    const result = await confirmDetectedBankAccount({
      detectedAccountId: 'detected_1',
      bankName: 'HDFC Bank',
      accountLast4: '1234',
      accountType: 'savings',
    });

    expect(result.account.id).toBeTruthy();
    expect(tables.bank_accounts[0]).toEqual(expect.objectContaining({
      user_id: 'user_1',
      bank_name: 'HDFC Bank',
      account_last4: '1234',
      account_type: 'savings',
      starting_balance: 0,
      balance: 0,
      upi_ids: [],
    }));
    expect(tables.balance_snapshots[0]).toEqual(expect.objectContaining({
      owner_type: 'bank_account',
      owner_id: tables.bank_accounts[0].id,
      balance_kind: 'available_balance',
      amount: 1234.5,
      source: 'sms',
      confidence: 'exact',
      raw_source_metadata: {
        source: 'sms',
        kind: 'detected_account_confirmation',
      },
    }));
    expect(tables.detected_accounts[0]).toEqual(expect.objectContaining({
      status: 'confirmed',
      matched_owner_type: 'bank_account',
      matched_owner_id: tables.bank_accounts[0].id,
    }));
    expect(tableCalls).not.toContain('transactions');
    expect(tableCalls).not.toContain('cc_transactions');
    expect(tableCalls).not.toContain('emi_payments');
    expect(removeCache).toHaveBeenCalledWith('cache_bank_accounts');
    expect(emitFinanceDataChanged).toHaveBeenCalledWith(expect.objectContaining({ areas: ['accounts'] }));
  });

  it('confirms a credit card without mutating outstanding or creating card transactions', async () => {
    const { tables, tableCalls } = setupSupabase({
      detected_accounts: [
        makeDetection({
          detection_type: 'credit_card',
          account_last4: null,
          card_last4: '9876',
          balance_kind: 'outstanding',
          balance_amount: 4500,
        }),
      ],
    });

    await confirmDetectedCreditCard({
      detectedAccountId: 'detected_1',
      bankName: 'ICICI Bank',
      cardName: 'ICICI card 9876',
      cardLast4: '9876',
      creditLimit: null,
      dueDate: 5,
      billingCycleDate: 20,
    });

    expect(tables.credit_cards[0]).toEqual(expect.objectContaining({
      bank_name: 'ICICI Bank',
      card_name: 'ICICI card 9876',
      last_4_digits: '9876',
      credit_limit: 0,
      current_outstanding: 0,
      due_date: 5,
      billing_cycle_date: 20,
    }));
    expect(tables.balance_snapshots[0]).toEqual(expect.objectContaining({
      owner_type: 'credit_card',
      owner_id: tables.credit_cards[0].id,
      balance_kind: 'outstanding',
      amount: 4500,
    }));
    expect(tables.detected_accounts[0].matched_owner_type).toBe('credit_card');
    expect(tableCalls).not.toContain('cc_transactions');
    expect(tableCalls).not.toContain('transactions');
    expect(tableCalls).not.toContain('emi_payments');
  });

  it('uses an exact detected credit limit when confirming a credit card', async () => {
    const { tables } = setupSupabase({
      detected_accounts: [
        makeDetection({
          detection_type: 'credit_card',
          card_last4: '4444',
          balance_kind: 'credit_limit',
          balance_amount: 90000,
          confidence: 'exact',
        }),
      ],
    });

    await confirmDetectedCreditCard({
      detectedAccountId: 'detected_1',
      bankName: 'Axis Bank',
      cardName: 'Axis card 4444',
      cardLast4: '4444',
    });

    expect(tables.credit_cards[0].credit_limit).toBe(90000);
    expect(tables.credit_cards[0].current_outstanding).toBe(0);
  });

  it('requires and uses a linked bank account for debit card confirmation', async () => {
    const { tables } = setupSupabase({
      detected_accounts: [
        makeDetection({
          detection_type: 'debit_card',
          account_last4: '1234',
          card_last4: '2222',
          balance_kind: null,
          balance_amount: null,
        }),
      ],
      bank_accounts: [{
        id: 'bank_1',
        user_id: 'user_1',
        bank_name: 'HDFC Bank',
        account_last4: '1234',
        account_type: 'savings',
      }],
    });

    await expect(confirmDetectedDebitCard({
      detectedAccountId: 'detected_1',
      bankAccountId: '',
      cardLast4: '2222',
    })).rejects.toThrow('Choose a linked bank account first');

    await confirmDetectedDebitCard({
      detectedAccountId: 'detected_1',
      bankAccountId: 'bank_1',
      cardLast4: '2222',
      cardLabel: 'Daily card',
    });

    expect(tables.debit_cards[0]).toEqual(expect.objectContaining({
      bank_account_id: 'bank_1',
      card_last4: '2222',
      status: 'active',
      card_label: 'Daily card',
    }));
    expect(tables.detected_accounts[0]).toEqual(expect.objectContaining({
      status: 'confirmed',
      matched_owner_type: 'debit_card',
      matched_owner_id: tables.debit_cards[0].id,
    }));
  });

  it('ignore updates status only', async () => {
    const { tables, tableCalls } = setupSupabase({
      detected_accounts: [makeDetection({ balance_amount: null, balance_kind: null })],
    });

    await ignoreDetectedAccount('detected_1');

    expect(tables.detected_accounts[0]).toEqual(expect.objectContaining({
      status: 'ignored',
      matched_owner_type: null,
      matched_owner_id: null,
    }));
    expect(tableCalls).toEqual(['detected_accounts', 'detected_accounts']);
  });

  it('merge updates status and matched owner without creating a duplicate owner', async () => {
    const { tables, tableCalls } = setupSupabase({
      detected_accounts: [makeDetection({ balance_amount: null, balance_kind: null })],
      bank_accounts: [{
        id: 'bank_1',
        user_id: 'user_1',
        bank_name: 'HDFC Bank',
        account_last4: '1234',
        account_type: 'savings',
      }],
    });

    await mergeDetectedAccount({
      detectedAccountId: 'detected_1',
      ownerType: 'bank_account',
      ownerId: 'bank_1',
    });

    expect(tables.bank_accounts).toHaveLength(1);
    expect(tables.detected_accounts[0]).toEqual(expect.objectContaining({
      status: 'merged',
      matched_owner_type: 'bank_account',
      matched_owner_id: 'bank_1',
    }));
    expect(tableCalls.filter(table => table === 'bank_accounts')).toHaveLength(1);
    expect(tableCalls).not.toContain('transactions');
    expect(tableCalls).not.toContain('cc_transactions');
    expect(tableCalls).not.toContain('emi_payments');
  });

  it('blocks duplicate bank and credit card creation', async () => {
    setupSupabase({
      detected_accounts: [makeDetection()],
      bank_accounts: [{
        id: 'bank_existing',
        user_id: 'user_1',
        bank_name: 'HDFC Bank',
        account_last4: '1234',
        account_type: 'savings',
      }],
    });

    await expect(confirmDetectedBankAccount({
      detectedAccountId: 'detected_1',
      bankName: 'HDFC Bank',
      accountLast4: '1234',
      accountType: 'savings',
    })).rejects.toBeInstanceOf(DetectedAccountDuplicateError);

    const setup = setupSupabase({
      detected_accounts: [makeDetection({
        detection_type: 'credit_card',
        card_last4: '9999',
        account_last4: null,
      })],
      credit_cards: [{
        id: 'card_existing',
        user_id: 'user_1',
        bank_name: 'ICICI Bank',
        card_name: 'ICICI card',
        last_4_digits: '9999',
      }],
    });

    await expect(confirmDetectedCreditCard({
      detectedAccountId: 'detected_1',
      bankName: 'ICICI Bank',
      cardName: 'ICICI card 9999',
      cardLast4: '9999',
    })).rejects.toBeInstanceOf(DetectedAccountDuplicateError);

    expect(setup.tables.credit_cards).toHaveLength(1);
  });

  it('keeps loan confirmation unsupported for this task', async () => {
    const loanDetection = makeDetection({
      detection_type: 'loan',
      balance_kind: 'loan_outstanding',
      balance_amount: 50000,
    });

    expect(buildDetectedAccountReviewItems([loanDetection])[0]).toEqual(expect.objectContaining({
      loanUnsupported: true,
      canConfirmNew: false,
    }));

    setupSupabase({ detected_accounts: [loanDetection] });
    await expect(confirmDetectedBankAccount({
      detectedAccountId: 'detected_1',
      bankName: 'HDFC Bank',
      accountLast4: '1234',
      accountType: 'savings',
    })).rejects.toThrow('Detection is not a bank account');
  });
});
