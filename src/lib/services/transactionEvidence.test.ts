import { supabase } from '../core';
import {
  createOrUpdateAccountAppMapping,
  createTransactionEvidence,
  disableAccountAppMapping,
  getActiveAppMappings,
  getEvidenceForTransaction,
  getUnlinkedEvidence,
  linkEvidenceToTransaction,
  markEvidenceReviewRequired,
  maskUpiId,
  sanitizeEvidenceMetadata,
} from './transactionEvidence';

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

type QueryCall = {
  table: string;
  op: 'select' | 'insert' | 'update';
  payload?: any;
  filters: Array<{ method: 'eq' | 'is'; column: string; value: unknown }>;
  order?: { column: string; options?: unknown };
  limit?: number;
};

function setupSupabaseMock(options: { existingMapping?: any } = {}) {
  const calls: QueryCall[] = [];

  mockedSupabase.auth.getUser.mockResolvedValue({
    data: { user: { id: 'user_1' } },
  });

  mockedSupabase.from.mockImplementation((table: string) => {
    const call: QueryCall = {
      table,
      op: 'select',
      filters: [],
    };
    calls.push(call);

    const query: any = {
      select: jest.fn(() => query),
      insert: jest.fn((payload: any) => {
        call.op = 'insert';
        call.payload = payload;
        return query;
      }),
      update: jest.fn((payload: any) => {
        call.op = 'update';
        call.payload = payload;
        return query;
      }),
      eq: jest.fn((column: string, value: unknown) => {
        call.filters.push({ method: 'eq', column, value });
        return query;
      }),
      is: jest.fn((column: string, value: unknown) => {
        call.filters.push({ method: 'is', column, value });
        return query;
      }),
      order: jest.fn((column: string, optionsArg?: unknown) => {
        call.order = { column, options: optionsArg };
        return query;
      }),
      limit: jest.fn((limit: number) => {
        call.limit = limit;
        return query;
      }),
      maybeSingle: jest.fn(async () => ({
        data: table === 'account_app_mappings' && call.op === 'select'
          ? options.existingMapping || null
          : null,
        error: null,
      })),
      single: jest.fn(async () => ({
        data: {
          id: `${table}_1`,
          created_at: '2026-05-29T10:00:00.000Z',
          updated_at: '2026-05-29T10:00:00.000Z',
          ...(call.payload || {}),
        },
        error: null,
      })),
      then: (resolve: any, reject: any) => Promise.resolve({
        data: [],
        error: null,
      }).then(resolve, reject),
    };

    return query;
  });

  return { calls };
}

describe('transaction evidence service foundation', () => {
  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(new Date('2026-05-29T10:00:00.000Z'));
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('masks UPI IDs without exposing phone-like local parts', () => {
    expect(maskUpiId('yash@oksbi')).toBe('yash***@oksbi');
    expect(maskUpiId('9876543210@ybl')).toBe('****@ybl');
    expect(maskUpiId('not-a-upi')).toBeNull();
    expect(maskUpiId('very.private.local@oksbi')).toBe('very***@oksbi');
    expect(maskUpiId('pay@bad@extra')).toBeNull();
  });

  it('sanitizes evidence metadata to the whitelist only', () => {
    const sanitized = sanitizeEvidenceMetadata({
      len: 123,
      length: 124,
      hash: 'ABCDEF12',
      source: 'notification',
      sender: 'HDFCBK',
      package: 'com.google.android.apps.nbu.paisa.user',
      kind: 'payment_signal',
      reasons: ['same_utr', 'amount_time'],
      parserVersion: 'v1',
      rawText: 'OTP 123456 raw SMS',
      raw_sms: 'Full raw body',
      body: 'Paid from account 123456789012',
      message: 'Call 9876543210',
      notificationText: 'Flat 1, Road 2',
      payload: { text: 'secret' },
      text: 'yash@oksbi',
      address: 'MG Road',
      accountNumber: '123456789012',
      cardNumber: '4111111111111111',
      phone: '9876543210',
    });

    expect(sanitized).toEqual({
      len: 123,
      length: 124,
      hash: 'abcdef12',
      source: 'notification',
      sender: 'HDFCBK',
      package: 'com.google.android.apps.nbu.paisa.user',
      kind: 'payment_signal',
      reasons: ['same_utr', 'amount_time'],
      parserVersion: 'v1',
    });
    expect(JSON.stringify(sanitized)).not.toContain('OTP');
    expect(JSON.stringify(sanitized)).not.toContain('9876543210');
    expect(JSON.stringify(sanitized)).not.toContain('123456789012');
    expect(JSON.stringify(sanitized)).not.toContain('yash@oksbi');
  });

  it('creates transaction evidence through the authenticated Supabase path with safe metadata only', async () => {
    const { calls } = setupSupabaseMock();

    await createTransactionEvidence({
      signal_id: 'signal_1',
      source_type: 'notification',
      source_package: 'com.google.android.apps.nbu.paisa.user',
      amount: 28,
      direction: 'debit',
      reference_number: '272828282828',
      account_last4: 'XX2728',
      upi_id: 'yash@oksbi',
      raw_source_metadata: {
        len: 120,
        hash: 'abcdef12',
        rawText: 'raw body should go',
        phone: '9876543210',
      },
    });

    expect(mockedSupabase.auth.getUser).toHaveBeenCalled();
    expect(calls[0].table).toBe('transaction_evidence');
    expect(calls[0].op).toBe('insert');
    expect(calls[0].payload).toEqual(expect.objectContaining({
      user_id: 'user_1',
      signal_id: 'signal_1',
      source_type: 'notification',
      source_package: 'com.google.android.apps.nbu.paisa.user',
      amount: 28,
      direction: 'debit',
      account_last4: '2728',
      upi_id_masked: 'yash***@oksbi',
      confidence_level: 'low',
      match_status: 'unlinked',
      raw_source_metadata: {
        len: 120,
        hash: 'abcdef12',
      },
    }));
    expect(JSON.stringify(calls[0].payload)).not.toContain('raw body should go');
    expect(JSON.stringify(calls[0].payload)).not.toContain('9876543210');
    expect(JSON.stringify(calls[0].payload)).not.toContain('yash@oksbi');
  });

  it('does not persist caller-provided raw UPI IDs as masked evidence fields', async () => {
    const { calls } = setupSupabaseMock();

    await createTransactionEvidence({
      signal_id: 'signal_2',
      source_type: 'notification',
      upi_id_masked: '9876543210@ybl',
      raw_source_metadata: {},
    });

    expect(calls[0].payload.upi_id_masked).toBe('****@ybl');
    expect(JSON.stringify(calls[0].payload)).not.toContain('9876543210@ybl');
  });

  it('reads linked and unlinked evidence through user-scoped queries', async () => {
    const { calls } = setupSupabaseMock();

    await getEvidenceForTransaction('tx_1');
    await getUnlinkedEvidence(500);

    expect(calls[0]).toEqual(expect.objectContaining({
      table: 'transaction_evidence',
      op: 'select',
      filters: expect.arrayContaining([
        { method: 'eq', column: 'user_id', value: 'user_1' },
        { method: 'eq', column: 'transaction_id', value: 'tx_1' },
      ]),
    }));
    expect(calls[1].filters).toEqual(expect.arrayContaining([
      { method: 'eq', column: 'user_id', value: 'user_1' },
      { method: 'eq', column: 'match_status', value: 'unlinked' },
    ]));
    expect(calls[1].limit).toBe(100);
  });

  it('links evidence to transaction match fields without touching account_id', async () => {
    const { calls } = setupSupabaseMock();

    await linkEvidenceToTransaction('evidence_1', 'tx_1', 'linked', 'exact', 'same_utr_bank_last4');

    expect(calls[0]).toEqual(expect.objectContaining({
      table: 'transactions',
      op: 'select',
      filters: expect.arrayContaining([
        { method: 'eq', column: 'id', value: 'tx_1' },
        { method: 'eq', column: 'user_id', value: 'user_1' },
      ]),
    }));
    expect(calls[1]).toEqual(expect.objectContaining({
      table: 'transaction_evidence',
      op: 'update',
      payload: expect.objectContaining({
        transaction_id: 'tx_1',
        match_status: 'linked',
        confidence_level: 'exact',
        match_reason_code: 'same_utr_bank_last4',
      }),
    }));
    expect(calls[2]).toEqual(expect.objectContaining({
      table: 'transactions',
      op: 'update',
      payload: expect.objectContaining({
        account_match_status: 'linked',
        account_match_confidence: 'exact',
        account_match_reason: 'same_utr_bank_last4',
        primary_evidence_id: 'evidence_1',
      }),
    }));
    expect(calls[2].payload).not.toHaveProperty('account_id');
    expect(calls[2].payload).not.toHaveProperty('account_last4');
  });

  it('marks evidence review required without creating transactions', async () => {
    const { calls } = setupSupabaseMock();

    await markEvidenceReviewRequired('evidence_1', 'ambiguous_bank_sms');

    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual(expect.objectContaining({
      table: 'transaction_evidence',
      op: 'update',
      payload: {
        match_status: 'review_required',
        match_reason_code: 'ambiguous_bank_sms',
      },
    }));
  });

  it('creates account app mapping with medium/low confidence only', async () => {
    const { calls } = setupSupabaseMock();

    await createOrUpdateAccountAppMapping({
      app_package: 'com.phonepe.app',
      app_label: 'PhonePe',
      payment_method_hash: 'ABCDEF12',
      payment_method_masked: 'yash@ybl',
      owner_type: 'bank_account',
      owner_id: 'bank_1',
      account_last4: '1234',
      bank_name: 'HDFC Bank',
      confidence_level: 'medium',
    });

    expect(calls[0].table).toBe('account_app_mappings');
    expect(calls[0].op).toBe('select');
    expect(calls[1].table).toBe('account_app_mappings');
    expect(calls[1].op).toBe('insert');
    expect(calls[1].payload).toEqual(expect.objectContaining({
      user_id: 'user_1',
      app_package: 'com.phonepe.app',
      payment_method_hash: 'abcdef12',
      payment_method_masked: 'yash***@ybl',
      owner_type: 'bank_account',
      owner_id: 'bank_1',
      account_last4: '1234',
      confidence_level: 'medium',
      use_count: 1,
      status: 'active',
    }));
    expect(calls[1].payload.confidence_level).not.toBe('exact');
  });

  it('sanitizes account app masked payment fields before storage', async () => {
    const { calls } = setupSupabaseMock();

    await createOrUpdateAccountAppMapping({
      app_package: 'com.supermoney.app',
      payment_method_masked: '4111 1111 1111 1234',
      owner_type: 'credit_card',
      owner_id: 'card_1',
      confidence_level: 'exact' as any,
    });

    expect(calls[1].payload.payment_method_masked).toBe('****1234');
    expect(calls[1].payload.confidence_level).toBe('medium');
    expect(JSON.stringify(calls[1].payload)).not.toContain('4111 1111 1111 1234');
  });

  it('updates an existing app mapping and rejects unsupported wallet mappings', async () => {
    const { calls } = setupSupabaseMock({
      existingMapping: {
        id: 'mapping_1',
        use_count: 4,
      },
    });

    await createOrUpdateAccountAppMapping({
      app_package: 'com.google.android.apps.nbu.paisa.user',
      owner_type: 'credit_card',
      owner_id: 'card_1',
      card_last4: '4321',
      confidence_level: 'low',
    });

    expect(calls[1].op).toBe('update');
    expect(calls[1].payload).toEqual(expect.objectContaining({
      use_count: 5,
      confidence_level: 'low',
      card_last4: '4321',
    }));

    await expect(createOrUpdateAccountAppMapping({
      app_package: 'com.wallet.future',
      owner_type: 'wallet',
      owner_id: 'wallet_1',
    })).rejects.toThrow('Wallet mappings are not supported yet');
  });

  it('reads and disables app mappings through authenticated Supabase path', async () => {
    const { calls } = setupSupabaseMock();

    await getActiveAppMappings('com.phonepe.app', 'ABCDEF12');
    await disableAccountAppMapping('mapping_1');

    expect(calls[0]).toEqual(expect.objectContaining({
      table: 'account_app_mappings',
      op: 'select',
      filters: expect.arrayContaining([
        { method: 'eq', column: 'user_id', value: 'user_1' },
        { method: 'eq', column: 'app_package', value: 'com.phonepe.app' },
        { method: 'eq', column: 'status', value: 'active' },
        { method: 'eq', column: 'payment_method_hash', value: 'abcdef12' },
      ]),
    }));
    expect(calls[1]).toEqual(expect.objectContaining({
      table: 'account_app_mappings',
      op: 'update',
      payload: { status: 'disabled' },
      filters: expect.arrayContaining([
        { method: 'eq', column: 'id', value: 'mapping_1' },
        { method: 'eq', column: 'user_id', value: 'user_1' },
      ]),
    }));
  });

});
