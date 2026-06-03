import { supabase } from '../core';
import { removeCache } from './cache';
import { emitFinanceDataChanged } from './dataEvents';
import {
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
    rpc: jest.fn(),
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
  rpc: jest.Mock;
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
  const rpcCalls: Array<{ name: string; params: Record<string, any> }> = [];
  let idCounter = 1;

  mockedSupabase.auth.getUser.mockResolvedValue({ data: { user: { id: 'user_1' } } });
  mockedSupabase.from.mockImplementation((table: string) => {
    tableCalls.push(table);
    if (!tables[table]) tables[table] = [];
    return createQuery(table);
  });
  mockedSupabase.rpc.mockImplementation(async (name: string, params: Record<string, any>) => {
    rpcCalls.push({ name, params });
    return executeRpc(name, params);
  });

  function nextRowId(table: string) {
    return `${table}_${idCounter++}`;
  }

  function sameBankName(left?: string | null, right?: string | null) {
    const normalize = (value?: string | null) => (value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    return Boolean(normalize(left) && normalize(left) === normalize(right));
  }

  function rpcError(message: string) {
    return { data: null, error: { message } };
  }

  function findDetection(id: string) {
    return tables.detected_accounts.find(row => row.id === id && row.user_id === 'user_1');
  }

  function createSnapshotIfCompatible(
    detection: any,
    ownerType: 'bank_account' | 'credit_card' | 'debit_card',
    ownerId: string,
    overrides: Partial<any> = {}
  ) {
    if (detection.balance_amount === null || detection.balance_amount === undefined || !detection.balance_kind) {
      return null;
    }

    const allowedKinds: Record<string, string[]> = {
      bank_account: ['available_balance', 'current_balance'],
      credit_card: ['outstanding', 'available_limit', 'credit_limit', 'due_amount', 'minimum_due'],
      debit_card: ['available_balance', 'current_balance', 'outstanding', 'available_limit', 'credit_limit', 'due_amount', 'minimum_due'],
    };
    if (!allowedKinds[ownerType].includes(detection.balance_kind)) return null;

    const amount = Number(detection.balance_amount);
    const detectedAt = detection.last_seen_at || BASE_TIME;
    const existing = tables.balance_snapshots.find(row =>
      row.user_id === 'user_1' &&
      row.owner_type === ownerType &&
      row.owner_id === ownerId &&
      row.balance_kind === detection.balance_kind &&
      row.amount === amount &&
      row.source === detection.source &&
      row.detected_at === detectedAt
    );
    if (existing) return null;

    const snapshot = {
      id: nextRowId('balance_snapshots'),
      user_id: 'user_1',
      owner_type: ownerType,
      owner_id: ownerId,
      detected_bank_name: overrides.detected_bank_name ?? null,
      account_last4: overrides.account_last4 ?? detection.account_last4,
      card_last4: overrides.card_last4 ?? detection.card_last4,
      balance_kind: detection.balance_kind,
      amount,
      currency: 'INR',
      source: detection.source,
      confidence: detection.confidence,
      detected_at: detectedAt,
      source_sender_or_package: detection.source_sender_or_package,
      raw_source_metadata: {
        source: detection.source,
        kind: overrides.kind || 'detected_account_confirmation',
      },
      note: null,
      created_at: BASE_TIME,
    };
    tables.balance_snapshots.push(snapshot);
    return snapshot;
  }

  function markDetection(detection: any, status: string, ownerType: string | null, ownerId: string | null) {
    Object.assign(detection, {
      status,
      matched_owner_type: ownerType,
      matched_owner_id: ownerId,
      updated_at: BASE_TIME,
    });
  }

  function executeRpc(name: string, params: Record<string, any>) {
    const detection = findDetection(params.p_detection_id);
    if (!detection) return rpcError('Detection was not found');

    if (name === 'confirm_detected_bank_account') {
      if (detection.status !== 'pending') {
        if (detection.matched_owner_type === 'bank_account' && detection.matched_owner_id) {
          return { data: [{ owner_id: detection.matched_owner_id, status: detection.status }], error: null };
        }
        return rpcError('Detection has already been reviewed');
      }
      if (detection.detection_type !== 'bank_account') return rpcError('Detection is not a bank account');

      const existing = tables.bank_accounts.find(account =>
        account.user_id === 'user_1' &&
        account.account_last4 === params.p_account_last4 &&
        account.account_type !== 'credit_card' &&
        account.account_type !== 'loan' &&
        sameBankName(account.bank_name, params.p_bank_name)
      );
      if (existing) {
        createSnapshotIfCompatible(detection, 'bank_account', existing.id, {
          detected_bank_name: existing.bank_name,
          account_last4: existing.account_last4,
          card_last4: null,
        });
        markDetection(detection, 'merged', 'bank_account', existing.id);
        return { data: [{ owner_id: existing.id, status: 'merged' }], error: null };
      }

      const account = {
        id: nextRowId('bank_accounts'),
        user_id: 'user_1',
        bank_name: params.p_bank_name,
        account_last4: params.p_account_last4,
        account_type: params.p_account_type,
        starting_balance: 0,
        balance: 0,
        credit_limit: 0,
        loan_total: 0,
        upi_ids: [],
        created_at: BASE_TIME,
        updated_at: BASE_TIME,
      };
      tables.bank_accounts.push(account);
      createSnapshotIfCompatible(detection, 'bank_account', account.id, {
        detected_bank_name: params.p_bank_name,
        account_last4: account.account_last4,
        card_last4: null,
      });
      markDetection(detection, 'confirmed', 'bank_account', account.id);
      return { data: [{ owner_id: account.id, status: 'confirmed' }], error: null };
    }

    if (name === 'confirm_detected_credit_card') {
      if (detection.status !== 'pending') {
        if (detection.matched_owner_type === 'credit_card' && detection.matched_owner_id) {
          return { data: [{ owner_id: detection.matched_owner_id, status: detection.status }], error: null };
        }
        return rpcError('Detection has already been reviewed');
      }
      if (detection.detection_type !== 'credit_card') return rpcError('Detection is not a credit card');

      const existing = tables.credit_cards.find(card =>
        card.user_id === 'user_1' && card.last_4_digits === params.p_card_last4
      );
      if (existing) {
        createSnapshotIfCompatible(detection, 'credit_card', existing.id, {
          detected_bank_name: existing.bank_name,
          account_last4: null,
          card_last4: existing.last_4_digits,
        });
        markDetection(detection, 'merged', 'credit_card', existing.id);
        return { data: [{ owner_id: existing.id, status: 'merged' }], error: null };
      }

      const card = {
        id: nextRowId('credit_cards'),
        user_id: 'user_1',
        bank_name: params.p_bank_name,
        card_name: params.p_card_name,
        last_4_digits: params.p_card_last4,
        credit_limit: params.p_credit_limit ?? 0,
        current_outstanding: 0,
        due_date: params.p_due_date ?? 1,
        billing_cycle_date: params.p_billing_cycle_date ?? 1,
        created_at: BASE_TIME,
        updated_at: BASE_TIME,
      };
      tables.credit_cards.push(card);
      createSnapshotIfCompatible(detection, 'credit_card', card.id, {
        detected_bank_name: params.p_bank_name,
        account_last4: null,
        card_last4: card.last_4_digits,
      });
      markDetection(detection, 'confirmed', 'credit_card', card.id);
      return { data: [{ owner_id: card.id, status: 'confirmed' }], error: null };
    }

    if (name === 'confirm_detected_debit_card') {
      if (detection.status !== 'pending') {
        if (detection.matched_owner_type === 'debit_card' && detection.matched_owner_id) {
          return { data: [{ owner_id: detection.matched_owner_id, status: detection.status }], error: null };
        }
        return rpcError('Detection has already been reviewed');
      }
      if (detection.detection_type !== 'debit_card') return rpcError('Detection is not a debit card');

      const bankAccount = tables.bank_accounts.find(account =>
        account.id === params.p_bank_account_id &&
        account.user_id === 'user_1' &&
        account.account_type !== 'credit_card' &&
        account.account_type !== 'loan'
      );
      if (!bankAccount) return rpcError('Choose a linked bank account first');

      const existing = tables.debit_cards.find(card =>
        card.user_id === 'user_1' &&
        card.bank_account_id === params.p_bank_account_id &&
        card.card_last4 === params.p_card_last4
      );
      if (existing) {
        createSnapshotIfCompatible(detection, 'bank_account', bankAccount.id, {
          detected_bank_name: bankAccount.bank_name,
          account_last4: bankAccount.account_last4,
          card_last4: existing.card_last4,
        });
        markDetection(detection, 'merged', 'debit_card', existing.id);
        return { data: [{ owner_id: existing.id, status: 'merged' }], error: null };
      }

      const debitCard = {
        id: nextRowId('debit_cards'),
        user_id: 'user_1',
        bank_account_id: bankAccount.id,
        bank_name: bankAccount.bank_name,
        card_last4: params.p_card_last4,
        card_network: null,
        card_label: params.p_card_label || null,
        status: 'active',
        detected_confidence: detection.confidence,
        source_sender_or_package: detection.source_sender_or_package,
        last_seen_at: detection.last_seen_at,
        created_at: BASE_TIME,
        updated_at: BASE_TIME,
      };
      tables.debit_cards.push(debitCard);
      createSnapshotIfCompatible(detection, 'bank_account', bankAccount.id, {
        detected_bank_name: bankAccount.bank_name,
        account_last4: bankAccount.account_last4,
        card_last4: debitCard.card_last4,
      });
      markDetection(detection, 'confirmed', 'debit_card', debitCard.id);
      return { data: [{ owner_id: debitCard.id, status: 'confirmed' }], error: null };
    }

    if (name === 'merge_detected_account') {
      if (detection.status !== 'pending') {
        if (
          detection.status === 'merged' &&
          detection.matched_owner_type === params.p_owner_type &&
          detection.matched_owner_id === params.p_owner_id
        ) {
          return { data: [{ owner_id: params.p_owner_id, status: 'merged' }], error: null };
        }
        return rpcError('Detection has already been reviewed');
      }

      const ownerTable = params.p_owner_type === 'bank_account'
        ? 'bank_accounts'
        : params.p_owner_type === 'credit_card'
          ? 'credit_cards'
          : 'debit_cards';
      const expectedType = detection.detection_type;
      if (
        (expectedType === 'bank_account' && params.p_owner_type !== 'bank_account') ||
        (expectedType === 'credit_card' && params.p_owner_type !== 'credit_card') ||
        (expectedType === 'debit_card' && params.p_owner_type !== 'debit_card') ||
        expectedType === 'loan'
      ) {
        return rpcError('This detection cannot be linked to the selected owner type');
      }

      const owner = tables[ownerTable].find(row => row.id === params.p_owner_id && row.user_id === 'user_1');
      if (!owner) return rpcError('Selected owner was not found');

      createSnapshotIfCompatible(detection, params.p_owner_type, params.p_owner_id, {
        detected_bank_name: owner.bank_name || null,
        account_last4: owner.account_last4 || detection.account_last4,
        card_last4: owner.card_last4 || owner.last_4_digits || detection.card_last4,
        kind: 'detected_account_merge',
      });
      markDetection(detection, 'merged', params.p_owner_type, params.p_owner_id);
      return { data: [{ owner_id: params.p_owner_id, status: 'merged' }], error: null };
    }

    if (name === 'ignore_detected_account_rpc') {
      if (detection.status === 'ignored') {
        return { data: [{ owner_id: null, status: 'ignored' }], error: null };
      }
      if (detection.status !== 'pending') return rpcError('Detection has already been reviewed');
      markDetection(detection, 'ignored', null, null);
      return { data: [{ owner_id: null, status: 'ignored' }], error: null };
    }

    return rpcError(`Unhandled RPC: ${name}`);
  }

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
          id: nextRowId(table),
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

  return { tables, tableCalls, rpcCalls };
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
    const { tables, tableCalls, rpcCalls } = setupSupabase({
      detected_accounts: [makeDetection()],
    });

    expect(tables.bank_accounts).toHaveLength(0);

    const result = await confirmDetectedBankAccount({
      detectedAccountId: 'detected_1',
      bankName: 'HDFC Bank',
      accountLast4: '1234',
      accountType: 'savings',
    });

    expect(rpcCalls).toEqual([{
      name: 'confirm_detected_bank_account',
      params: {
        p_detection_id: 'detected_1',
        p_bank_name: 'HDFC Bank',
        p_account_last4: '1234',
        p_account_type: 'savings',
      },
    }]);
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
    expect(tables.transactions).toHaveLength(0);
    expect(tables.cc_transactions).toHaveLength(0);
    expect(tables.emi_payments).toHaveLength(0);
    expect(JSON.stringify(rpcCalls)).not.toContain('raw_source_metadata');
    expect(JSON.stringify(rpcCalls)).not.toContain('raw_sms');
    expect(removeCache).toHaveBeenCalledWith('cache_bank_accounts');
    expect(emitFinanceDataChanged).toHaveBeenCalledWith(expect.objectContaining({ areas: ['accounts'] }));
  });

  it('does not copy sensitive detected display text into confirmation snapshots', async () => {
    const { tables } = setupSupabase({
      detected_accounts: [
        makeDetection({
          detected_bank_name: 'OTP 123456 account 123456789012',
        }),
      ],
    });

    await confirmDetectedBankAccount({
      detectedAccountId: 'detected_1',
      bankName: 'HDFC Bank',
      accountLast4: '1234',
      accountType: 'savings',
    });

    expect(tables.balance_snapshots[0].detected_bank_name).toBe('HDFC Bank');
    expect(JSON.stringify(tables.balance_snapshots[0])).not.toContain('123456789012');
  });

  it('does not create another owner when confirmation is repeated after resolution', async () => {
    const { tables, rpcCalls } = setupSupabase({
      detected_accounts: [makeDetection()],
    });

    const first = await confirmDetectedBankAccount({
      detectedAccountId: 'detected_1',
      bankName: 'HDFC Bank',
      accountLast4: '1234',
      accountType: 'savings',
    });

    const second = await confirmDetectedBankAccount({
      detectedAccountId: 'detected_1',
      bankName: 'HDFC Bank',
      accountLast4: '1234',
      accountType: 'savings',
    });

    expect(second.account.id).toBe(first.account.id);
    expect(tables.bank_accounts).toHaveLength(1);
    expect(tables.balance_snapshots).toHaveLength(1);
    expect(rpcCalls.map(call => call.name)).toEqual([
      'confirm_detected_bank_account',
      'confirm_detected_bank_account',
    ]);
  });

  it('surfaces safe RPC errors without partial client-side writes', async () => {
    const { tables } = setupSupabase({
      detected_accounts: [makeDetection()],
    });
    mockedSupabase.rpc.mockResolvedValueOnce({
      data: null,
      error: { message: 'Could not atomically confirm detection' },
    });

    await expect(confirmDetectedBankAccount({
      detectedAccountId: 'detected_1',
      bankName: 'HDFC Bank',
      accountLast4: '1234',
      accountType: 'savings',
    })).rejects.toThrow('Could not atomically confirm detection');

    expect(tables.bank_accounts).toHaveLength(0);
    expect(tables.balance_snapshots).toHaveLength(0);
    expect(tables.detected_accounts[0].status).toBe('pending');
  });

  it('rejects full account or card numbers before calling RPC', async () => {
    const { rpcCalls } = setupSupabase({
      detected_accounts: [makeDetection()],
    });

    await expect(confirmDetectedBankAccount({
      detectedAccountId: 'detected_1',
      bankName: 'HDFC Bank',
      accountLast4: '123456789012',
      accountType: 'savings',
    })).rejects.toThrow('Account last4 must be exactly four digits');

    await expect(confirmDetectedCreditCard({
      detectedAccountId: 'detected_1',
      bankName: 'HDFC Bank',
      cardName: 'HDFC card',
      cardLast4: '4111111111111234',
    })).rejects.toThrow('Card last4 must be exactly four digits');

    await expect(confirmDetectedDebitCard({
      detectedAccountId: 'detected_1',
      bankAccountId: 'bank_1',
      cardLast4: '4111111111112222',
    })).rejects.toThrow('Debit card last4 must be exactly four digits');

    expect(rpcCalls).toHaveLength(0);
  });

  it('confirms a credit card without mutating outstanding or creating card transactions', async () => {
    const { tables, tableCalls, rpcCalls } = setupSupabase({
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

    expect(rpcCalls[0]).toEqual({
      name: 'confirm_detected_credit_card',
      params: {
        p_detection_id: 'detected_1',
        p_bank_name: 'ICICI Bank',
        p_card_name: 'ICICI card 9876',
        p_card_last4: '9876',
        p_credit_limit: 0,
        p_due_date: 5,
        p_billing_cycle_date: 20,
      },
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
    expect(tables.cc_transactions).toHaveLength(0);
    expect(tables.transactions).toHaveLength(0);
    expect(tables.emi_payments).toHaveLength(0);
  });

  it('keeps an exact detected credit limit as a snapshot instead of a card field', async () => {
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

    expect(tables.credit_cards[0].credit_limit).toBe(0);
    expect(tables.credit_cards[0].current_outstanding).toBe(0);
    expect(tables.balance_snapshots[0]).toEqual(expect.objectContaining({
      owner_type: 'credit_card',
      owner_id: tables.credit_cards[0].id,
      balance_kind: 'credit_limit',
      amount: 90000,
    }));
  });

  it('requires and uses a linked bank account for debit card confirmation', async () => {
    const { tables, rpcCalls } = setupSupabase({
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

    expect(rpcCalls.map(call => call.name)).toEqual([
      'confirm_detected_debit_card',
    ]);
    expect(tables.debit_cards[0]).toEqual(expect.objectContaining({
      bank_account_id: 'bank_1',
      card_last4: '2222',
      status: 'active',
      card_label: 'Daily card',
    }));
    expect(tables.transactions).toHaveLength(0);
    expect(tables.cc_transactions).toHaveLength(0);
    expect(tables.emi_payments).toHaveLength(0);
    expect(tables.detected_accounts[0]).toEqual(expect.objectContaining({
      status: 'confirmed',
      matched_owner_type: 'debit_card',
      matched_owner_id: tables.debit_cards[0].id,
    }));
  });

  it('ignore updates status only', async () => {
    const { tables, tableCalls, rpcCalls } = setupSupabase({
      detected_accounts: [makeDetection({ balance_amount: null, balance_kind: null })],
    });

    await ignoreDetectedAccount('detected_1');

    expect(tables.detected_accounts[0]).toEqual(expect.objectContaining({
      status: 'ignored',
      matched_owner_type: null,
      matched_owner_id: null,
    }));
    expect(rpcCalls).toEqual([{
      name: 'ignore_detected_account_rpc',
      params: { p_detection_id: 'detected_1' },
    }]);
    expect(tableCalls).toEqual(['detected_accounts']);
  });

  it('merge updates status and matched owner without creating a duplicate owner', async () => {
    const { tables, tableCalls, rpcCalls } = setupSupabase({
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
    expect(rpcCalls).toEqual([{
      name: 'merge_detected_account',
      params: {
        p_detection_id: 'detected_1',
        p_owner_type: 'bank_account',
        p_owner_id: 'bank_1',
      },
    }]);
    expect(tableCalls.filter(table => table === 'bank_accounts')).toHaveLength(0);
    expect(tableCalls).not.toContain('transactions');
    expect(tableCalls).not.toContain('cc_transactions');
    expect(tableCalls).not.toContain('emi_payments');
  });

  it('merge skips a duplicate compatible snapshot on retry-style state', async () => {
    const { tables } = setupSupabase({
      detected_accounts: [makeDetection()],
      bank_accounts: [{
        id: 'bank_1',
        user_id: 'user_1',
        bank_name: 'HDFC Bank',
        account_last4: '1234',
        account_type: 'savings',
      }],
      balance_snapshots: [{
        id: 'snapshot_existing',
        user_id: 'user_1',
        owner_type: 'bank_account',
        owner_id: 'bank_1',
        balance_kind: 'available_balance',
        amount: 1234.5,
        source: 'sms',
        detected_at: BASE_TIME,
      }],
    });

    const result = await mergeDetectedAccount({
      detectedAccountId: 'detected_1',
      ownerType: 'bank_account',
      ownerId: 'bank_1',
    });

    expect(result.snapshot).toEqual(expect.objectContaining({
      id: 'snapshot_existing',
      owner_type: 'bank_account',
      owner_id: 'bank_1',
    }));
    expect(tables.balance_snapshots).toHaveLength(1);
    expect(tables.detected_accounts[0]).toEqual(expect.objectContaining({
      status: 'merged',
      matched_owner_type: 'bank_account',
      matched_owner_id: 'bank_1',
    }));
  });

  it('steers duplicate bank, credit card, and debit card confirmation to merge without duplicate owners', async () => {
    const bankSetup = setupSupabase({
      detected_accounts: [makeDetection()],
      bank_accounts: [{
        id: 'bank_existing',
        user_id: 'user_1',
        bank_name: 'HDFC Bank',
        account_last4: '1234',
        account_type: 'savings',
      }],
    });

    await confirmDetectedBankAccount({
      detectedAccountId: 'detected_1',
      bankName: 'HDFC Bank',
      accountLast4: '1234',
      accountType: 'savings',
    });

    expect(bankSetup.tables.bank_accounts).toHaveLength(1);
    expect(bankSetup.tables.detected_accounts[0]).toEqual(expect.objectContaining({
      status: 'merged',
      matched_owner_type: 'bank_account',
      matched_owner_id: 'bank_existing',
    }));

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

    await confirmDetectedCreditCard({
      detectedAccountId: 'detected_1',
      bankName: 'ICICI Bank',
      cardName: 'ICICI card 9999',
      cardLast4: '9999',
    });

    expect(setup.tables.credit_cards).toHaveLength(1);
    expect(setup.tables.detected_accounts[0]).toEqual(expect.objectContaining({
      status: 'merged',
      matched_owner_type: 'credit_card',
      matched_owner_id: 'card_existing',
    }));

    const legacyCardItems = buildDetectedAccountReviewItems(
      [makeDetection({
        detection_type: 'credit_card',
        card_last4: '2246',
        account_last4: null,
      })],
      [{
        id: 'legacy_card_bank_1',
        user_id: 'user_1',
        bank_name: 'HDFC Bank',
        account_last4: '2246',
        account_type: 'credit_card',
      } as any],
      [],
      []
    );

    expect(legacyCardItems[0].duplicateOwner).toEqual(expect.objectContaining({
      ownerType: 'bank_account',
      ownerId: 'legacy_card_bank_1',
      last4: '2246',
      subtitle: 'Legacy credit card setup',
    }));
    expect(legacyCardItems[0].canConfirmNew).toBe(false);

    const debitSetup = setupSupabase({
      detected_accounts: [makeDetection({
        detection_type: 'debit_card',
        account_last4: '1234',
        card_last4: '2222',
      })],
      bank_accounts: [{
        id: 'bank_1',
        user_id: 'user_1',
        bank_name: 'HDFC Bank',
        account_last4: '1234',
        account_type: 'savings',
      }],
      debit_cards: [{
        id: 'debit_existing',
        user_id: 'user_1',
        bank_account_id: 'bank_1',
        bank_name: 'HDFC Bank',
        card_last4: '2222',
        card_label: 'Existing debit card',
        status: 'active',
      }],
    });

    await confirmDetectedDebitCard({
      detectedAccountId: 'detected_1',
      bankAccountId: 'bank_1',
      cardLast4: '2222',
    });

    expect(debitSetup.tables.debit_cards).toHaveLength(1);
    expect(debitSetup.tables.detected_accounts[0]).toEqual(expect.objectContaining({
      status: 'merged',
      matched_owner_type: 'debit_card',
      matched_owner_id: 'debit_existing',
    }));
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
