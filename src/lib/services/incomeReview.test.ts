import { supabase } from '../core';
import {
  applyIncomeReviewDecisionsToIncomeEvents,
  buildIncomeReviewCandidatesFromRows,
  getIncomeReviewDecisions,
  isIncomeReviewTableMissingError,
  upsertIncomeReviewDecision,
} from './incomeReview';
import { IncomeEvent } from './debtFreedom';
import { Transaction, TransactionEvidence } from '../../types';

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
  op?: string;
  payload?: unknown;
  eqs: Array<[string, unknown]>;
};

let calls: QueryCall[] = [];
let rows: Record<string, unknown[]> = {};
let errors: Record<string, unknown> = {};

class QueryBuilder {
  call: QueryCall;

  constructor(private table: string) {
    this.call = { table, eqs: [] };
    calls.push(this.call);
  }

  select() {
    this.call.op = this.call.op || 'select';
    return this;
  }

  insert(payload: unknown) {
    this.call.op = 'insert';
    this.call.payload = payload;
    return this;
  }

  update(payload: unknown) {
    this.call.op = 'update';
    this.call.payload = payload;
    return this;
  }

  delete() {
    this.call.op = 'delete';
    return this;
  }

  eq(field: string, value: unknown) {
    this.call.eqs.push([field, value]);
    return this;
  }

  order() {
    return this;
  }

  limit() {
    return this;
  }

  single() {
    return Promise.resolve(this.resolve(true));
  }

  maybeSingle() {
    const result = this.resolve(false);
    return Promise.resolve({
      data: Array.isArray(result.data) ? result.data[0] || null : result.data,
      error: result.error,
    });
  }

  then(resolve: (value: { data: unknown; error: unknown }) => void) {
    resolve(this.resolve(false));
  }

  private resolve(single: boolean) {
    if (errors[this.table]) return { data: null, error: errors[this.table] };
    if (this.call.op === 'insert' || this.call.op === 'update') {
      return {
        data: {
          id: 'decision_saved',
          user_id: 'user_1',
          transaction_id: (this.call.payload as any).transaction_id || null,
          evidence_id: (this.call.payload as any).evidence_id || null,
          signal_hash: (this.call.payload as any).signal_hash || null,
          decision: (this.call.payload as any).decision,
          income_source_type: (this.call.payload as any).income_source_type || null,
          confidence: (this.call.payload as any).confidence || 'user_confirmed',
          reason_code: (this.call.payload as any).reason_code || null,
          reviewed_at: (this.call.payload as any).reviewed_at || '2026-06-01T00:00:00.000Z',
          created_at: '2026-06-01T00:00:00.000Z',
          updated_at: '2026-06-01T00:00:00.000Z',
        },
        error: null,
      };
    }

    const tableRows = (rows[this.table] || []).filter(row => (
      this.call.eqs.every(([field, value]) => (row as any)[field] === value)
    ));
    return { data: single ? tableRows[0] || null : tableRows, error: null };
  }
}

function transaction(overrides: Partial<Transaction>): Transaction {
  return {
    id: overrides.id || 'tx_1',
    user_id: 'user_1',
    amount: overrides.amount ?? 1000,
    type: overrides.type || 'income',
    note: overrides.note ?? 'UPI credit from private.person@oksbi phone 9876543210',
    category: overrides.category ?? 'Income',
    created_at: overrides.created_at || '2026-06-05T10:00:00.000Z',
    sms_source: overrides.sms_source,
    reference_number: overrides.reference_number,
    from_account_id: overrides.from_account_id,
    to_account_id: overrides.to_account_id,
    refund_of_transaction_id: overrides.refund_of_transaction_id,
  } as Transaction;
}

function evidence(overrides: Partial<TransactionEvidence>): TransactionEvidence {
  const sourcePackage = Object.prototype.hasOwnProperty.call(overrides, 'source_package')
    ? overrides.source_package
    : 'com.porter.partner';
  const sourceApp = Object.prototype.hasOwnProperty.call(overrides, 'source_app')
    ? overrides.source_app
    : 'Porter';
  const merchantOrPerson = Object.prototype.hasOwnProperty.call(overrides, 'merchant_or_person')
    ? overrides.merchant_or_person
    : 'Porter payout';

  return {
    id: overrides.id || 'ev_1',
    user_id: 'user_1',
    signal_id: overrides.signal_id || 'abcdef123456',
    transaction_id: overrides.transaction_id || null,
    source_type: overrides.source_type || 'notification',
    source_package: sourcePackage ?? null,
    source_app: sourceApp ?? null,
    sender: null,
    amount: overrides.amount ?? 900,
    direction: overrides.direction || 'credit',
    captured_at: overrides.captured_at || '2026-06-06T10:00:00.000Z',
    reference_number: null,
    merchant_or_person: merchantOrPerson ?? null,
    bank_name: null,
    account_last4: null,
    card_last4: null,
    instrument_hint: 'unknown',
    upi_id_masked: null,
    upi_id_hash: null,
    confidence_level: overrides.confidence_level || 'medium',
    match_status: 'unlinked',
    match_reason_code: null,
    raw_source_metadata: {},
    created_at: '2026-06-06T10:00:00.000Z',
    updated_at: '2026-06-06T10:00:00.000Z',
  };
}

function decision(overrides = {}) {
  return {
    id: 'decision_1',
    user_id: 'user_1',
    transaction_id: 'tx_1',
    evidence_id: null,
    signal_hash: null,
    decision: 'count_as_income',
    income_source_type: 'gig_work',
    confidence: 'user_confirmed',
    reason_code: 'upi_credit',
    reviewed_at: '2026-06-01T00:00:00.000Z',
    created_at: '2026-06-01T00:00:00.000Z',
    updated_at: '2026-06-01T00:00:00.000Z',
    ...overrides,
  } as any;
}

describe('incomeReview service', () => {
  beforeEach(() => {
    calls = [];
    errors = {};
    rows = {
      transactions: [transaction({ id: 'tx_1' })],
      transaction_evidence: [evidence({ id: 'ev_1' })],
      income_review_decisions: [decision()],
    };
    mockedSupabase.auth.getUser.mockResolvedValue({ data: { user: { id: 'user_1' } } });
    mockedSupabase.from.mockImplementation((table: string) => new QueryBuilder(table));
  });

  it('loads decisions through the authenticated user path', async () => {
    const result = await getIncomeReviewDecisions();

    expect(result).toHaveLength(1);
    expect(calls[0].table).toBe('income_review_decisions');
    expect(calls[0].eqs).toContainEqual(['user_id', 'user_1']);
  });

  it('returns an empty decision list when the table is missing', async () => {
    errors.income_review_decisions = { code: 'PGRST205' };

    await expect(getIncomeReviewDecisions()).resolves.toEqual([]);
    expect(isIncomeReviewTableMissingError({ code: '42P01' })).toBe(true);
  });

  it('injects user_id from auth, validates ownership, and whitelists saved fields', async () => {
    rows.income_review_decisions = [];
    const result = await upsertIncomeReviewDecision({
      transaction_id: 'tx_1',
      decision: 'count_as_income',
      income_source_type: 'gig_work',
      raw_sms: 'OTP 123456 9876543210',
    } as any);

    const insertCall = calls.find(call => call.table === 'income_review_decisions' && call.op === 'insert')!;
    expect(result.decision).toBe('count_as_income');
    expect(insertCall.payload).toEqual(expect.objectContaining({
      user_id: 'user_1',
      transaction_id: 'tx_1',
      decision: 'count_as_income',
      income_source_type: 'gig_work',
    }));
    expect(JSON.stringify(insertCall.payload)).not.toContain('OTP');
    expect(JSON.stringify(insertCall.payload)).not.toContain('9876543210');
    expect(calls.some(call => call.table === 'transactions' && call.eqs.some(eq => eq[0] === 'user_id'))).toBe(true);
  });

  it('rejects invalid decision and source type values', async () => {
    await expect(upsertIncomeReviewDecision({
      transaction_id: 'tx_1',
      decision: 'maybe' as any,
    })).rejects.toThrow('Invalid income review decision');

    await expect(upsertIncomeReviewDecision({
      transaction_id: 'tx_1',
      decision: 'count_as_income',
      income_source_type: 'tips' as any,
    })).rejects.toThrow('Invalid income source type');
  });

  it('maps generic UPI and bank credits as needs review with safe labels', () => {
    const candidates = buildIncomeReviewCandidatesFromRows({
      transactions: [
        transaction({ id: 'upi', note: 'UPI credit from private.person@oksbi 9876543210' }),
        transaction({ id: 'bank', note: 'Bank credit received' }),
      ],
    });

    expect(candidates.map(candidate => candidate.suggestedDecision)).toEqual(['needs_review', 'needs_review']);
    expect(candidates.map(candidate => candidate.safeReason)).toEqual([
      'Credit needs review before it can count as income.',
      'Credit needs review before it can count as income.',
    ]);
    expect(JSON.stringify(candidates)).not.toContain('private.person@oksbi');
    expect(JSON.stringify(candidates)).not.toContain('9876543210');
  });

  it('deduplicates transaction and linked evidence into one transaction-backed card', () => {
    const candidates = buildIncomeReviewCandidatesFromRows({
      transactions: [
        transaction({
          id: 'tx_22700',
          amount: 22700,
          note: 'Bank credit received',
          created_at: '2026-06-01T08:00:00.000Z',
        }),
      ],
      evidence: [
        evidence({
          id: 'ev_22700',
          transaction_id: 'tx_22700',
          signal_id: 'abcabc123456',
          amount: 22700,
          source_app: null,
          source_package: null,
          merchant_or_person: null,
          captured_at: '2026-06-01T08:01:00.000Z',
        }),
      ],
    });

    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toEqual(expect.objectContaining({
      id: 'transaction:tx_22700',
      candidateType: 'transaction',
      transactionId: 'tx_22700',
      evidenceId: 'ev_22700',
      signalHash: 'abcabc123456',
      amount: 22700,
    }));
  });

  it('deduplicates duplicate evidence rows for the same transaction', () => {
    const candidates = buildIncomeReviewCandidatesFromRows({
      evidence: [
        evidence({
          id: 'ev_old',
          transaction_id: 'tx_1',
          signal_id: 'aaaabbbb1111',
          amount: 22700,
          source_app: null,
          source_package: null,
          merchant_or_person: null,
          captured_at: '2026-06-01T08:00:00.000Z',
        }),
        evidence({
          id: 'ev_new',
          transaction_id: 'tx_1',
          signal_id: 'ccccdddd2222',
          amount: 22700,
          source_app: null,
          source_package: null,
          merchant_or_person: null,
          captured_at: '2026-06-01T08:02:00.000Z',
        }),
      ],
    });

    expect(candidates).toHaveLength(1);
    expect(candidates[0].id).toBe('transaction:tx_1');
    expect(candidates[0].transactionId).toBe('tx_1');
  });

  it('keeps one unlinked evidence-only card and collapses repeated signal hashes', () => {
    const unlinked = buildIncomeReviewCandidatesFromRows({
      evidence: [
        evidence({
          id: 'ev_unlinked',
          transaction_id: null,
          signal_id: 'aaaabbbb3333',
          amount: 700,
          source_app: null,
          source_package: null,
          merchant_or_person: null,
        }),
      ],
    });
    const repeatedSignal = buildIncomeReviewCandidatesFromRows({
      evidence: [
        evidence({
          id: 'ev_sig_1',
          transaction_id: null,
          signal_id: 'ffffeeee4444',
          amount: 700,
          source_app: null,
          source_package: null,
          merchant_or_person: null,
          captured_at: '2026-06-01T08:00:00.000Z',
        }),
        evidence({
          id: 'ev_sig_2',
          transaction_id: null,
          signal_id: 'FFFFEEEE4444',
          amount: 700,
          source_app: null,
          source_package: null,
          merchant_or_person: null,
          captured_at: '2026-06-01T08:02:00.000Z',
        }),
      ],
    });

    expect(unlinked).toHaveLength(1);
    expect(unlinked[0]).toEqual(expect.objectContaining({
      candidateType: 'evidence',
      evidenceId: 'ev_unlinked',
      signalHash: 'aaaabbbb3333',
    }));
    expect(repeatedSignal).toHaveLength(1);
    expect(repeatedSignal[0].id).toBe('signal:ffffeeee4444');
    expect(new Set(repeatedSignal.map(candidate => candidate.id)).size).toBe(repeatedSignal.length);
  });

  it('shows unknown person credits for review without exposing the raw person field', () => {
    const candidates = buildIncomeReviewCandidatesFromRows({
      evidence: [
        evidence({
          id: 'ev_person',
          source_app: '',
          source_package: '',
          merchant_or_person: 'Private Person 9876543210',
          amount: 1500,
        }),
      ],
    });

    expect(candidates[0]).toEqual(expect.objectContaining({
      sourceHint: 'personal_transfer',
      suggestedDecision: 'needs_review',
      safeLabel: 'Person transfer',
      safeReason: 'Credit needs review before it can count as income.',
    }));
    expect(JSON.stringify(candidates[0])).not.toContain('Private Person');
    expect(JSON.stringify(candidates[0])).not.toContain('9876543210');
  });

  it.each(['Porter', 'Swiggy', 'Zomato', 'Rapido', 'Zepto'])(
    'suggests gig income for %s payout candidates',
    token => {
      const candidates = buildIncomeReviewCandidatesFromRows({
        transactions: [transaction({ id: token, category: token, note: `${token} payout` })],
      });

      expect(candidates[0]).toEqual(expect.objectContaining({
        sourceHint: 'gig_payout',
        suggestedDecision: 'count_as_income',
        suggestedIncomeSourceType: 'gig_work',
        safeLabel: 'Possible gig payout',
      }));
    }
  );

  it('suggests salary, freelance, and business income while allowing override', () => {
    const candidates = buildIncomeReviewCandidatesFromRows({
      transactions: [
        transaction({ id: 'salary', category: 'Salary', note: 'salary credited' }),
        transaction({ id: 'freelance', category: 'Freelance', note: 'freelance payout' }),
        transaction({ id: 'business', category: 'Business', note: 'business earnings' }),
      ],
    });

    expect(candidates.map(candidate => candidate.suggestedIncomeSourceType)).toEqual(['salary', 'freelance', 'business']);
    expect(candidates.map(candidate => candidate.suggestedDecision)).toEqual(['count_as_income', 'count_as_income', 'count_as_income']);
  });

  it('keeps family, friend, refund, borrowed money, and self-transfer out of the active list by default', () => {
    const active = buildIncomeReviewCandidatesFromRows({
      transactions: [
        transaction({ id: 'friend', note: 'friend returned split' }),
        transaction({ id: 'refund', type: 'refund', note: 'refund' }),
        transaction({ id: 'borrowed', type: 'borrowed', note: 'borrowed' }),
        transaction({ id: 'transfer', type: 'transfer', note: 'self transfer' }),
      ],
    });
    const excluded = buildIncomeReviewCandidatesFromRows({
      transactions: [
        transaction({ id: 'friend', note: 'friend returned split' }),
        transaction({ id: 'refund', type: 'refund', note: 'refund' }),
        transaction({ id: 'borrowed', type: 'borrowed', note: 'borrowed' }),
        transaction({ id: 'transfer', type: 'transfer', note: 'self transfer' }),
      ],
    }, { showExcluded: true });

    expect(active).toHaveLength(0);
    expect(excluded.map(candidate => candidate.suggestedDecision)).toEqual(['not_income', 'not_income', 'not_income', 'not_income']);
  });

  it('keeps cash deposits excluded unless the user reviews them', () => {
    const active = buildIncomeReviewCandidatesFromRows({
      transactions: [
        transaction({ id: 'cash_deposit', note: 'Cash deposit credited', sms_source: 'bank' }),
      ],
    });
    const excluded = buildIncomeReviewCandidatesFromRows({
      transactions: [
        transaction({ id: 'cash_deposit', note: 'Cash deposit credited', sms_source: 'bank' }),
      ],
    }, { showExcluded: true });

    expect(active).toHaveLength(0);
    expect(excluded[0]).toEqual(expect.objectContaining({
      sourceHint: 'bank_credit',
      suggestedDecision: 'not_income',
      safeReason: 'Cash deposits are not counted as income unless you review them.',
    }));
  });

  it('maps credit evidence into safe income candidates', () => {
    const candidates = buildIncomeReviewCandidatesFromRows({
      evidence: [evidence({ source_app: 'Porter', source_package: 'com.porter.partner' })],
    });

    expect(candidates[0]).toEqual(expect.objectContaining({
      candidateType: 'evidence',
      evidenceId: 'ev_1',
      signalHash: 'abcdef123456',
      suggestedIncomeSourceType: 'gig_work',
    }));
    expect(JSON.stringify(candidates[0])).not.toContain('raw_source_metadata');
  });

  it('applies reviewed decisions to income events without mutating financial rows', () => {
    const events: IncomeEvent[] = [{
      id: 'tx_1',
      amount: 1200,
      receivedAt: '2026-06-05T00:00:00.000Z',
      sourceType: 'upi_credit',
      label: 'Income needs review',
      confidence: 'needs_review',
      includeInIncome: false,
      exclusionReason: 'unknown_credit',
    }];

    expect(applyIncomeReviewDecisionsToIncomeEvents(events, [
      decision({ decision: 'count_as_income', income_source_type: 'gig_work' }),
    ])[0]).toEqual(expect.objectContaining({
      sourceType: 'gig_work',
      confidence: 'confirmed',
      includeInIncome: true,
      exclusionReason: null,
    }));

    expect(applyIncomeReviewDecisionsToIncomeEvents(events, [
      decision({ decision: 'not_income', income_source_type: null }),
    ])[0]).toEqual(expect.objectContaining({
      confidence: 'excluded',
      includeInIncome: false,
    }));

    expect(applyIncomeReviewDecisionsToIncomeEvents(events, [
      decision({ decision: 'needs_review', income_source_type: null }),
    ])[0]).toEqual(expect.objectContaining({
      confidence: 'needs_review',
      includeInIncome: false,
    }));
  });

  it('updates an existing evidence decision when a deduped transaction card is saved', async () => {
    rows.income_review_decisions = [
      decision({
        id: 'decision_evidence',
        transaction_id: null,
        evidence_id: 'ev_1',
        signal_hash: null,
        decision: 'needs_review',
        income_source_type: null,
      }),
    ];

    await upsertIncomeReviewDecision({
      transaction_id: 'tx_1',
      evidence_id: 'ev_1',
      signal_hash: 'abcdef123456',
      decision: 'count_as_income',
      income_source_type: 'other',
    });

    const updateCall = calls.find(call => call.table === 'income_review_decisions' && call.op === 'update')!;
    expect(updateCall).toBeTruthy();
    expect(updateCall.eqs).toContainEqual(['id', 'decision_evidence']);
    expect(updateCall.payload).toEqual(expect.objectContaining({
      transaction_id: 'tx_1',
      evidence_id: 'ev_1',
      signal_hash: 'abcdef123456',
      decision: 'count_as_income',
    }));
  });

  it('does not log raw values or call mutating financial tables', () => {
    const source = fs.readFileSync('src/lib/services/incomeReview.ts', 'utf8');

    expect(source).not.toMatch(/console\./);
    expect(source).not.toMatch(/raw_sms|notification_text|raw payload|profile object/i);
    expect(source).not.toMatch(/from\('transactions'\)[\s\S]{0,160}\.(insert|update|delete|upsert|rpc)\s*\(/);
    expect(source).not.toMatch(/from\('transaction_evidence'\)[\s\S]{0,160}\.(insert|update|delete|upsert|rpc)\s*\(/);
  });
});
