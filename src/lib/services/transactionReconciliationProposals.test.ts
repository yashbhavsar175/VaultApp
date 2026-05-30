declare const require: (moduleName: string) => any;
declare const __dirname: string;

const fs = require('fs');
const path = require('path');

import { supabase } from '../core';
import {
  buildKnownMappings,
  buildKnownOwners,
  getRecentReconciliationProposals,
  getProposalsForEvidence,
  getProposalsForTransaction,
  toReconciliationEvidence,
} from './transactionReconciliationProposals';

jest.mock('../core', () => ({
  supabase: {
    auth: {
      getUser: jest.fn(),
    },
    from: jest.fn(),
    rpc: jest.fn(),
  },
}));

const mockedSupabase = supabase as unknown as {
  auth: { getUser: jest.Mock };
  from: jest.Mock;
  rpc: jest.Mock;
};

const T0 = Date.parse('2026-05-30T10:00:00.000Z');
const NOW = '2026-05-30T12:00:00.000Z';

type QueryCall = {
  table: string;
  op: 'select' | 'insert' | 'update' | 'delete' | 'upsert';
  payload?: unknown;
  selectColumns?: string;
  filters: Array<{ method: 'eq' | 'in' | 'is'; column: string; value: unknown }>;
  order?: { column: string; options?: unknown };
  limit?: number;
};

type MockRows = {
  evidence?: any[];
  bankAccounts?: any[];
  creditCards?: any[];
  debitCards?: any[];
  mappings?: any[];
  transactions?: any[];
};

function iso(offsetMs = 0): string {
  return new Date(T0 + offsetMs).toISOString();
}

function appEvidence(overrides: Record<string, unknown> = {}) {
  return {
    id: 'ev_app_1',
    user_id: 'user_1',
    signal_id: 'sig_app_1',
    transaction_id: null,
    source_type: 'notification',
    source_package: 'com.google.android.apps.nbu.paisa.user',
    source_app: 'GPay',
    sender: null,
    amount: 501.25,
    direction: 'debit',
    captured_at: iso(),
    reference_number: 'UPI Ref No 321654987123',
    merchant_or_person: 'Safe Merchant',
    bank_name: null,
    account_last4: null,
    card_last4: null,
    instrument_hint: 'unknown',
    upi_id_masked: 'yash***@oksbi',
    upi_id_hash: 'abcdef12',
    confidence_level: 'low',
    match_status: 'unlinked',
    match_reason_code: null,
    raw_source_metadata: {
      body: 'raw notification body OTP 123456 phone 9876543210 yash@oksbi',
      payload: { text: 'secret' },
    },
    created_at: iso(),
    updated_at: iso(),
    ...overrides,
  };
}

function bankEvidence(overrides: Record<string, unknown> = {}) {
  return {
    id: 'ev_bank_1',
    user_id: 'user_1',
    signal_id: 'sig_bank_1',
    transaction_id: null,
    source_type: 'sms',
    source_package: null,
    source_app: null,
    sender: 'HDFCBK',
    amount: 501.25,
    direction: 'debit',
    captured_at: iso(45_000),
    reference_number: 'UTR 321654987123',
    merchant_or_person: 'Safe Merchant',
    bank_name: 'HDFC Bank',
    account_last4: '1234',
    card_last4: null,
    instrument_hint: 'bank_account',
    upi_id_masked: null,
    upi_id_hash: null,
    confidence_level: 'high',
    match_status: 'unlinked',
    match_reason_code: null,
    raw_source_metadata: {
      raw_sms: 'full raw sms should not surface',
    },
    created_at: iso(45_000),
    updated_at: iso(45_000),
    ...overrides,
  };
}

function hdfcAccount(overrides: Record<string, unknown> = {}) {
  return {
    id: 'bank_hdfc_1',
    user_id: 'user_1',
    bank_name: 'HDFC Bank',
    account_last4: '1234',
    account_type: 'savings',
    ...overrides,
  };
}

function activeMapping(overrides: Record<string, unknown> = {}) {
  return {
    id: 'mapping_1',
    user_id: 'user_1',
    app_package: 'com.google.android.apps.nbu.paisa.user',
    app_label: 'GPay',
    payment_method_hash: 'abcdef12',
    payment_method_masked: 'yash***@oksbi',
    owner_type: 'bank_account',
    owner_id: 'bank_hdfc_1',
    account_last4: '1234',
    card_last4: null,
    bank_name: 'HDFC Bank',
    confidence_level: 'medium',
    use_count: 1,
    last_confirmed_at: iso(),
    status: 'active',
    created_at: iso(),
    updated_at: iso(),
    ...overrides,
  };
}

function transaction(overrides: Record<string, unknown> = {}) {
  return {
    id: 'tx_1',
    user_id: 'user_1',
    amount: 501.25,
    type: 'expense',
    created_at: iso(30_000),
    reference_number: '321654987123',
    note: 'Safe Merchant',
    category: 'expense',
    ...overrides,
  };
}

function getFilter(call: QueryCall, column: string) {
  return call.filters.find(filter => filter.column === column);
}

function applyFilters(rows: any[], call: QueryCall): any[] {
  let result = rows;
  for (const filter of call.filters) {
    if (filter.method === 'eq') {
      result = result.filter(row => row[filter.column] === filter.value);
    } else if (filter.method === 'in') {
      result = result.filter(row => Array.isArray(filter.value) && filter.value.includes(row[filter.column]));
    } else if (filter.method === 'is') {
      result = result.filter(row => row[filter.column] === filter.value);
    }
  }

  if (call.order) {
    const { column, options } = call.order;
    const ascending = Boolean((options as { ascending?: boolean } | undefined)?.ascending);
    result = [...result].sort((a, b) => {
      const left = Date.parse(a[column]) || 0;
      const right = Date.parse(b[column]) || 0;
      return ascending ? left - right : right - left;
    });
  }

  if (call.limit) result = result.slice(0, call.limit);
  return result;
}

function rowsForTable(table: string, rows: MockRows): any[] {
  if (table === 'transaction_evidence') return rows.evidence || [];
  if (table === 'bank_accounts') return rows.bankAccounts || [];
  if (table === 'credit_cards') return rows.creditCards || [];
  if (table === 'debit_cards') return rows.debitCards || [];
  if (table === 'account_app_mappings') return rows.mappings || [];
  if (table === 'transactions') return rows.transactions || [];
  return [];
}

function setupSupabaseReadMock(rows: MockRows) {
  const calls: QueryCall[] = [];
  const mutations: QueryCall[] = [];

  mockedSupabase.auth.getUser.mockResolvedValue({
    data: { user: { id: 'user_1' } },
  });
  mockedSupabase.rpc.mockImplementation((fnName: string) => {
    throw new Error(`Unexpected rpc call: ${fnName}`);
  });

  mockedSupabase.from.mockImplementation((table: string) => {
    const call: QueryCall = {
      table,
      op: 'select',
      filters: [],
    };
    calls.push(call);

    const resultForCall = () => {
      const tableRows = applyFilters(rowsForTable(table, rows), call);
      const idFilter = getFilter(call, 'id');
      const singleLike = Boolean(idFilter);
      return {
        data: singleLike ? tableRows[0] || null : tableRows,
        error: null,
      };
    };

    const query: any = {
      select: jest.fn((columns?: string) => {
        call.selectColumns = columns;
        return query;
      }),
      insert: jest.fn((payload: unknown) => {
        call.op = 'insert';
        call.payload = payload;
        mutations.push(call);
        throw new Error('Unexpected insert in read-only proposal service');
      }),
      update: jest.fn((payload: unknown) => {
        call.op = 'update';
        call.payload = payload;
        mutations.push(call);
        throw new Error('Unexpected update in read-only proposal service');
      }),
      delete: jest.fn(() => {
        call.op = 'delete';
        mutations.push(call);
        throw new Error('Unexpected delete in read-only proposal service');
      }),
      upsert: jest.fn((payload: unknown) => {
        call.op = 'upsert';
        call.payload = payload;
        mutations.push(call);
        throw new Error('Unexpected upsert in read-only proposal service');
      }),
      eq: jest.fn((column: string, value: unknown) => {
        call.filters.push({ method: 'eq', column, value });
        return query;
      }),
      in: jest.fn((column: string, value: unknown[]) => {
        call.filters.push({ method: 'in', column, value });
        return query;
      }),
      is: jest.fn((column: string, value: unknown) => {
        call.filters.push({ method: 'is', column, value });
        return query;
      }),
      order: jest.fn((column: string, options?: unknown) => {
        call.order = { column, options };
        return query;
      }),
      limit: jest.fn((limit: number) => {
        call.limit = limit;
        return query;
      }),
      maybeSingle: jest.fn(async () => resultForCall()),
      single: jest.fn(async () => resultForCall()),
      then: (resolve: any, reject: any) => Promise.resolve(resultForCall()).then(resolve, reject),
    };

    return query;
  });

  return { calls, mutations };
}

describe('transaction reconciliation proposal service', () => {
  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(new Date(NOW));
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('returns exact attach proposal for app evidence plus bank evidence with the same UTR', async () => {
    const { calls } = setupSupabaseReadMock({
      evidence: [appEvidence(), bankEvidence()],
      bankAccounts: [hdfcAccount()],
    });

    const proposals = await getRecentReconciliationProposals();

    expect(proposals).toHaveLength(1);
    expect(proposals[0]).toEqual(expect.objectContaining({
      decision: 'attach_account',
      confidence: 'exact',
      matchStatus: 'linked',
      matchedOwnerType: 'bank_account',
      matchedOwnerId: 'bank_hdfc_1',
      matchedOwnerLabel: 'HDFC Bank ••1234',
      reasonCode: 'same_reference_bank_evidence',
      createdAt: NOW,
    }));
    expect(proposals[0].evidenceIds.sort()).toEqual(['ev_app_1', 'ev_bank_1']);
    expect(calls.every(call => call.op === 'select')).toBe(true);
  });

  it('returns high attach proposal for amount/time with one bank evidence candidate', async () => {
    setupSupabaseReadMock({
      evidence: [
        appEvidence({ reference_number: null }),
        bankEvidence({ reference_number: null }),
      ],
      bankAccounts: [hdfcAccount()],
    });

    const [proposal] = await getRecentReconciliationProposals();

    expect(proposal).toEqual(expect.objectContaining({
      decision: 'attach_account',
      confidence: 'high',
      reasonCode: 'amount_time_single_bank_evidence',
      matchedOwnerId: 'bank_hdfc_1',
    }));
  });

  it('returns review proposal for multiple bank candidates in the same amount/time window', async () => {
    setupSupabaseReadMock({
      evidence: [
        appEvidence({ reference_number: null }),
        bankEvidence({ id: 'ev_hdfc', reference_number: null }),
        bankEvidence({
          id: 'ev_icici',
          reference_number: null,
          bank_name: 'ICICI Bank',
          account_last4: '4321',
        }),
      ],
      bankAccounts: [
        hdfcAccount(),
        hdfcAccount({
          id: 'bank_icici_1',
          bank_name: 'ICICI Bank',
          account_last4: '4321',
        }),
      ],
    });

    const [proposal] = await getRecentReconciliationProposals();

    expect(proposal.decision).toBe('review_required');
    expect(proposal.matchStatus).toBe('ambiguous');
    expect(proposal.reasonCode).toBe('multiple_bank_candidates');
    expect(proposal.matchedOwnerId).toBeNull();
    expect(proposal.evidenceIds.sort()).toEqual(['ev_app_1', 'ev_hdfc', 'ev_icici']);
  });

  it('returns low review proposal for app-only evidence without bank proof', async () => {
    setupSupabaseReadMock({
      evidence: [appEvidence({ reference_number: null, upi_id_hash: null, upi_id_masked: null })],
      bankAccounts: [hdfcAccount()],
    });

    const [proposal] = await getRecentReconciliationProposals();

    expect(proposal).toEqual(expect.objectContaining({
      decision: 'review_required',
      confidence: 'low',
      reasonCode: 'payment_app_only',
      matchedOwnerId: null,
    }));
  });

  it('uses active app mapping as medium proposal only and ignores disabled mappings', async () => {
    setupSupabaseReadMock({
      evidence: [appEvidence({ reference_number: null })],
      bankAccounts: [hdfcAccount()],
      mappings: [activeMapping()],
    });

    const [mappedProposal] = await getRecentReconciliationProposals();

    expect(mappedProposal).toEqual(expect.objectContaining({
      decision: 'attach_account',
      confidence: 'medium',
      reasonCode: 'user_mapping_hint',
      matchedOwnerId: 'bank_hdfc_1',
      matchedOwnerLabel: 'HDFC Bank ••1234',
    }));
    expect(mappedProposal.confidence).not.toBe('exact');

    setupSupabaseReadMock({
      evidence: [appEvidence({ reference_number: null, upi_id_hash: 'abcdef12' })],
      bankAccounts: [hdfcAccount()],
      mappings: [activeMapping({ status: 'disabled' })],
    });

    const [disabledProposal] = await getRecentReconciliationProposals();
    expect(disabledProposal.decision).toBe('review_required');
    expect(disabledProposal.reasonCode).toBe('upi_only_not_bank_proof');
    expect(disabledProposal.matchedOwnerId).toBeNull();
  });

  it('never attaches account for UPI-only evidence', async () => {
    setupSupabaseReadMock({
      evidence: [
        appEvidence({
          reference_number: null,
          upi_id_masked: 'user***@okaxis',
          upi_id_hash: 'okaxis_hash',
        }),
      ],
      bankAccounts: [
        hdfcAccount({
          id: 'bank_axis_1',
          bank_name: 'Axis Bank',
          account_last4: '8888',
        }),
      ],
    });

    const [proposal] = await getRecentReconciliationProposals();

    expect(proposal.decision).toBe('review_required');
    expect(proposal.reasonCode).toBe('upi_only_not_bank_proof');
    expect(proposal.matchedOwnerId).toBeNull();
  });

  it('links existing transaction candidate in proposal without writing to transactions', async () => {
    const { mutations } = setupSupabaseReadMock({
      evidence: [appEvidence(), bankEvidence()],
      bankAccounts: [hdfcAccount()],
      transactions: [transaction()],
    });

    const proposals = await getProposalsForTransaction('tx_1');

    expect(proposals[0]).toEqual(expect.objectContaining({
      transactionId: 'tx_1',
      decision: 'link_existing_transaction',
      confidence: 'exact',
      matchedOwnerId: 'bank_hdfc_1',
    }));
    expect(mutations).toHaveLength(0);
  });

  it('does not link an existing transaction by amount/time alone without merchant overlap', async () => {
    setupSupabaseReadMock({
      evidence: [
        appEvidence({ reference_number: null, merchant_or_person: 'Safe Merchant' }),
        bankEvidence({ reference_number: null, merchant_or_person: 'Safe Merchant' }),
      ],
      bankAccounts: [hdfcAccount()],
      transactions: [
        transaction({
          reference_number: null,
          note: 'Different Store',
          category: 'shopping',
        }),
      ],
    });

    const [proposal] = await getRecentReconciliationProposals();

    expect(proposal).toEqual(expect.objectContaining({
      transactionId: null,
      decision: 'attach_account',
      confidence: 'high',
      matchedOwnerId: 'bank_hdfc_1',
    }));
  });

  it('links an existing transaction by amount/time only when merchant overlaps', async () => {
    setupSupabaseReadMock({
      evidence: [
        appEvidence({ reference_number: null, merchant_or_person: 'Safe Merchant' }),
        bankEvidence({ reference_number: null, merchant_or_person: 'Safe Merchant' }),
      ],
      bankAccounts: [hdfcAccount()],
      transactions: [
        transaction({
          reference_number: null,
          note: 'Safe Merchant order',
          category: 'shopping',
        }),
      ],
    });

    const [proposal] = await getRecentReconciliationProposals();

    expect(proposal).toEqual(expect.objectContaining({
      transactionId: 'tx_1',
      decision: 'link_existing_transaction',
      confidence: 'high',
      matchedOwnerId: 'bank_hdfc_1',
    }));
  });

  it('can build a proposal for one evidence seed using the safe evidence pool', async () => {
    setupSupabaseReadMock({
      evidence: [appEvidence(), bankEvidence()],
      bankAccounts: [hdfcAccount()],
    });

    const proposals = await getProposalsForEvidence('ev_app_1');

    expect(proposals).toHaveLength(1);
    expect(proposals[0].confidence).toBe('exact');
    expect(proposals[0].evidenceIds.sort()).toEqual(['ev_app_1', 'ev_bank_1']);
  });

  it('builds known owners, mappings, and reconciliation evidence with safe last4 fields', () => {
    const owners = buildKnownOwners({
      bankAccounts: [
        hdfcAccount({
          bank_name: 'HDFC Bank 123456789012',
          account_last4: 'XX1234',
        }),
        hdfcAccount({
          id: 'loan_1',
          account_type: 'loan',
          account_last4: '9999',
        }),
      ],
      creditCards: [{
        id: 'cc_1',
        user_id: 'user_1',
        bank_name: 'ICICI Bank',
        card_name: 'Coral 4111111111111111',
        last_4_digits: '4321',
      }],
      debitCards: [{
        id: 'dc_1',
        user_id: 'user_1',
        bank_account_id: 'bank_hdfc_1',
        bank_name: 'HDFC Bank',
        card_last4: '6789',
        card_network: null,
        card_label: null,
        status: 'active',
        detected_confidence: 'low',
        source_sender_or_package: null,
        last_seen_at: null,
        created_at: iso(),
        updated_at: iso(),
      }],
    });
    const mappings = buildKnownMappings([
      activeMapping(),
      activeMapping({ id: 'disabled', status: 'disabled' }),
      activeMapping({ id: 'wallet', owner_type: 'wallet' }),
    ] as any);
    const evidence = toReconciliationEvidence(bankEvidence({ account_last4: 'XX1234' }) as any);

    expect(owners.map(owner => owner.ownerType)).toEqual(['bank_account', 'credit_card', 'debit_card']);
    expect(JSON.stringify(owners)).not.toContain('123456789012');
    expect(JSON.stringify(owners)).not.toContain('4111111111111111');
    expect(mappings).toHaveLength(1);
    expect(mappings[0].confidenceLevel).toBe('medium');
    expect(evidence.accountLast4).toBe('1234');
  });

  it('keeps proposal output privacy-safe and excludes raw metadata/body/full UPI', async () => {
    setupSupabaseReadMock({
      evidence: [
        appEvidence({
          reference_number: null,
          merchant_or_person: 'Paid raw notification body OTP 123456 phone 9876543210 at Main Road yash@oksbi',
          upi_id_masked: 'yash***@oksbi',
          raw_source_metadata: {
            rawText: 'raw SMS body',
            body: 'OTP 123456',
            payload: { text: '9876543210' },
          },
        }),
      ],
      bankAccounts: [hdfcAccount({ bank_name: 'HDFC Bank 123456789012' })],
    });

    const [proposal] = await getRecentReconciliationProposals();
    const serialized = JSON.stringify(proposal);

    expect(serialized).not.toContain('raw notification body');
    expect(serialized).not.toContain('raw SMS body');
    expect(serialized).not.toContain('OTP');
    expect(serialized).not.toContain('123456');
    expect(serialized).not.toContain('9876543210');
    expect(serialized).not.toContain('Main Road');
    expect(serialized).not.toContain('yash@oksbi');
    expect(serialized).not.toContain('123456789012');
    for (const token of proposal.explanationTokens) {
      expect(token).toMatch(/^[a-z0-9_]+$/);
    }
  });

  it('performs no insert/update/delete/upsert/rpc calls', async () => {
    const { calls, mutations } = setupSupabaseReadMock({
      evidence: [appEvidence(), bankEvidence()],
      bankAccounts: [hdfcAccount()],
    });

    await getRecentReconciliationProposals();

    expect(mockedSupabase.rpc).not.toHaveBeenCalled();
    expect(mutations).toHaveLength(0);
    expect(calls.map(call => call.op)).toEqual(calls.map(() => 'select'));
  });

  it('does not export mutating functions or runtime-wire processors yet', () => {
    const root = path.join(__dirname, '..', '..', '..');
    const service = fs.readFileSync(
      path.join(root, 'src', 'lib', 'services', 'transactionReconciliationProposals.ts'),
      'utf8'
    );
    const processors = fs.readFileSync(
      path.join(root, 'src', 'lib', 'processors', 'TransactionProcessors.ts'),
      'utf8'
    );
    const notifications = fs.readFileSync(
      path.join(root, 'src', 'lib', 'services', 'notifications.ts'),
      'utf8'
    );
    const smsParser = fs.readFileSync(
      path.join(root, 'src', 'lib', 'services', 'smsParser.ts'),
      'utf8'
    );

    expect(service).not.toMatch(/export\s+(?:async\s+)?function\s+(?:create|insert|update|delete|upsert|disable|link|attach|apply|mutate)/);
    expect(service).not.toMatch(/\.(?:insert|update|delete|upsert|rpc)\s*\(/);
    expect(processors).not.toContain('transactionReconciliationProposals');
    expect(notifications).not.toContain('transactionReconciliationProposals');
    expect(smsParser).not.toContain('transactionReconciliationProposals');
  });
});
