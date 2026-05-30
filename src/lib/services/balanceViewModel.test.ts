import {
  buildAccountBalanceViewModelsForRows,
  buildBalanceHistoryViewForRows,
  buildBankAccountDetailViewForRows,
  buildCreditCardDetailViewForRows,
  buildCreditCardBalanceViewModelsForRows,
  selectBestBalanceSnapshot,
  summarizePendingDetectedAccounts,
} from './balanceViewModel';
import { BalanceSnapshot, BankAccount, CreditCardStatement } from '../../types';
import { CreditCard } from '../database/financial';

function snapshot(overrides: Partial<BalanceSnapshot>): BalanceSnapshot {
  return {
    id: overrides.id || 'snapshot_1',
    user_id: 'user_1',
    owner_type: overrides.owner_type || 'bank_account',
    owner_id: overrides.owner_id || 'owner_1',
    detected_bank_name: null,
    account_last4: null,
    card_last4: null,
    balance_kind: overrides.balance_kind || 'available_balance',
    amount: overrides.amount ?? 0,
    currency: 'INR',
    source: overrides.source || 'sms',
    confidence: overrides.confidence || 'exact',
    detected_at: overrides.detected_at || '2026-05-28T10:00:00.000Z',
    source_sender_or_package: null,
    raw_source_metadata: overrides.raw_source_metadata || {},
    note: overrides.note ?? null,
    created_at: overrides.created_at || overrides.detected_at || '2026-05-28T10:00:00.000Z',
  };
}

const bankAccount: BankAccount = {
  id: 'bank_1',
  user_id: 'user_1',
  bank_name: 'HDFC Bank',
  account_last4: '1234',
  account_type: 'savings',
  starting_balance: 1000,
  balance: 1200,
  credit_limit: 0,
  loan_total: 0,
  upi_ids: [],
  created_at: '2026-05-20T00:00:00.000Z',
};

const creditCard: CreditCard = {
  id: 'card_1',
  user_id: 'user_1',
  bank_name: 'HDFC Bank',
  card_name: 'Rewards',
  last_4_digits: '4321',
  credit_limit: 50000,
  current_outstanding: 12000,
  due_date: 5,
  billing_cycle_date: 20,
  created_at: '2026-05-20T00:00:00.000Z',
  updated_at: '2026-05-20T00:00:00.000Z',
};

describe('balance view model', () => {
  it('uses latest exact SMS snapshot over calculated bank-account fallback', () => {
    const views = buildAccountBalanceViewModelsForRows([bankAccount], [
      snapshot({
        id: 'sms_1',
        owner_id: 'bank_1',
        amount: 2500,
        source: 'sms',
        confidence: 'exact',
      }),
    ]);

    expect(views[0]).toEqual(expect.objectContaining({
      displayBalance: 2500,
      source: 'sms',
      confidence: 'exact',
      sourceLabel: 'SMS',
      confidenceLabel: 'Exact',
      isEstimated: false,
    }));
  });

  it('keeps manual exact ahead of an older SMS snapshot by priority', () => {
    const best = selectBestBalanceSnapshot([
      snapshot({
        id: 'sms_newer',
        owner_id: 'bank_1',
        amount: 3000,
        source: 'sms',
        confidence: 'exact',
        detected_at: '2026-05-29T10:00:00.000Z',
      }),
      snapshot({
        id: 'manual_older',
        owner_id: 'bank_1',
        amount: 2800,
        source: 'manual',
        confidence: 'exact',
        detected_at: '2026-05-28T10:00:00.000Z',
      }),
    ]);

    expect(best?.id).toBe('manual_older');
  });

  it('uses manual exact bank available balance over a newer exact SMS snapshot', () => {
    const views = buildAccountBalanceViewModelsForRows([bankAccount], [
      snapshot({
        id: 'sms_newer',
        owner_id: 'bank_1',
        balance_kind: 'available_balance',
        amount: 3200,
        source: 'sms',
        confidence: 'exact',
        detected_at: '2026-05-29T10:00:00.000Z',
      }),
      snapshot({
        id: 'manual_older',
        owner_id: 'bank_1',
        balance_kind: 'available_balance',
        amount: 3000,
        source: 'manual',
        confidence: 'exact',
        detected_at: '2026-05-28T10:00:00.000Z',
      }),
    ]);

    expect(views[0]).toEqual(expect.objectContaining({
      displayBalance: 3000,
      balanceKind: 'available_balance',
      source: 'manual',
      confidence: 'exact',
      sourceLabel: 'Manual',
      confidenceLabel: 'Exact',
    }));
  });

  it('builds newest-first balance history without raw metadata exposure', () => {
    const view = buildBalanceHistoryViewForRows('bank_account', 'bank_1', [
      snapshot({
        id: 'older',
        owner_id: 'bank_1',
        amount: 1000,
        detected_at: '2026-05-28T10:00:00.000Z',
        raw_source_metadata: { body: 'raw sms should not appear' },
        note: 'raw sms leaked 123456',
      }),
      snapshot({
        id: 'newer',
        owner_id: 'bank_1',
        amount: 1200,
        source: 'manual',
        detected_at: '2026-05-29T10:00:00.000Z',
        note: 'Verified in app',
      }),
    ]);

    expect(view.items.map(item => item.id)).toEqual(['newer', 'older']);
    expect(view.items[0]).toEqual(expect.objectContaining({
      balanceKind: 'available_balance',
      balanceKindLabel: 'Available',
      sourceLabel: 'Manual',
      confidenceLabel: 'Exact',
      noteSafe: 'Verified in app',
    }));
    expect(view.items[1].noteSafe).toBeNull();
    expect(JSON.stringify(view)).not.toContain('raw_source_metadata');
    expect(JSON.stringify(view)).not.toContain('raw sms should not appear');
  });

  it('filters older unsafe note shapes from balance history', () => {
    const view = buildBalanceHistoryViewForRows('bank_account', 'bank_1', [
      snapshot({
        id: 'payload_json',
        owner_id: 'bank_1',
        note: 'payload JSON: {"body":"debited at merchant"}',
      }),
      snapshot({
        id: 'notification_text',
        owner_id: 'bank_1',
        note: 'Notification message from bank app',
      }),
      snapshot({
        id: 'safe_note',
        owner_id: 'bank_1',
        note: 'Verified in app',
      }),
    ]);

    expect(view.items.find(item => item.id === 'payload_json')?.noteSafe).toBeNull();
    expect(view.items.find(item => item.id === 'notification_text')?.noteSafe).toBeNull();
    expect(view.items.find(item => item.id === 'safe_note')?.noteSafe).toBe('Verified in app');
    expect(JSON.stringify(view)).not.toMatch(/payload JSON|Notification message|debited at merchant/i);
  });

  it('returns an empty history view safely', () => {
    const view = buildBalanceHistoryViewForRows('bank_account', 'bank_1', []);

    expect(view).toEqual({
      ownerType: 'bank_account',
      ownerId: 'bank_1',
      items: [],
      hasHistory: false,
    });
  });

  it('includes latest balance and history in bank account detail', () => {
    const detail = buildBankAccountDetailViewForRows(
      bankAccount,
      [
        snapshot({
          id: 'sms',
          owner_id: 'bank_1',
          amount: 2500,
          source: 'sms',
        }),
        snapshot({
          id: 'manual',
          owner_id: 'bank_1',
          amount: 3000,
          source: 'manual',
          detected_at: '2026-05-29T10:00:00.000Z',
        }),
      ],
      [
        snapshot({
          id: 'manual',
          owner_id: 'bank_1',
          amount: 3000,
          source: 'manual',
          detected_at: '2026-05-29T10:00:00.000Z',
        }),
      ]
    );

    expect(detail).toEqual(expect.objectContaining({
      accountId: 'bank_1',
      displayBalance: 3000,
      source: 'manual',
      confidence: 'exact',
      hasHistory: true,
    }));
    expect(detail.history).toHaveLength(1);
  });

  it('uses newer exact SMS over older exact SMS', () => {
    const best = selectBestBalanceSnapshot([
      snapshot({
        id: 'sms_older',
        owner_id: 'bank_1',
        amount: 2000,
        source: 'sms',
        confidence: 'exact',
        detected_at: '2026-05-28T10:00:00.000Z',
      }),
      snapshot({
        id: 'sms_newer',
        owner_id: 'bank_1',
        amount: 2100,
        source: 'sms',
        confidence: 'exact',
        detected_at: '2026-05-29T10:00:00.000Z',
      }),
    ]);

    expect(best?.id).toBe('sms_newer');
  });

  it('falls back to bank account balance when no snapshot exists', () => {
    const views = buildAccountBalanceViewModelsForRows([bankAccount], []);

    expect(views[0]).toEqual(expect.objectContaining({
      displayBalance: 1200,
      balanceKind: 'current_balance',
      source: 'calculated',
      confidence: 'estimated',
      isEstimated: true,
    }));
  });

  it('keeps calculated fallback ahead of low-confidence snapshot values', () => {
    const views = buildAccountBalanceViewModelsForRows([bankAccount], [
      snapshot({
        id: 'low_sms',
        owner_id: 'bank_1',
        amount: 9999,
        source: 'sms',
        confidence: 'low',
      }),
    ]);

    expect(views[0]).toEqual(expect.objectContaining({
      displayBalance: 1200,
      source: 'calculated',
      confidence: 'estimated',
    }));
  });

  it('uses exact current balance ahead of low-confidence available balance', () => {
    const views = buildAccountBalanceViewModelsForRows([bankAccount], [
      snapshot({
        id: 'available_low',
        owner_id: 'bank_1',
        balance_kind: 'available_balance',
        amount: 9999,
        source: 'sms',
        confidence: 'low',
        detected_at: '2026-05-29T10:00:00.000Z',
      }),
      snapshot({
        id: 'current_exact',
        owner_id: 'bank_1',
        balance_kind: 'current_balance',
        amount: 2400,
        source: 'sms',
        confidence: 'exact',
        detected_at: '2026-05-28T10:00:00.000Z',
      }),
    ]);

    expect(views[0]).toEqual(expect.objectContaining({
      displayBalance: 2400,
      balanceKind: 'current_balance',
      source: 'sms',
      confidence: 'exact',
    }));
  });

  it('prefers available balance over current balance when rank is tied', () => {
    const views = buildAccountBalanceViewModelsForRows([bankAccount], [
      snapshot({
        id: 'available_exact',
        owner_id: 'bank_1',
        balance_kind: 'available_balance',
        amount: 2600,
        source: 'sms',
        confidence: 'exact',
        detected_at: '2026-05-28T10:00:00.000Z',
      }),
      snapshot({
        id: 'current_exact_newer',
        owner_id: 'bank_1',
        balance_kind: 'current_balance',
        amount: 2700,
        source: 'sms',
        confidence: 'exact',
        detected_at: '2026-05-29T10:00:00.000Z',
      }),
    ]);

    expect(views[0]).toEqual(expect.objectContaining({
      displayBalance: 2600,
      balanceKind: 'available_balance',
    }));
  });

  it('calculates credit card utilization and limits from snapshots when present', () => {
    const views = buildCreditCardBalanceViewModelsForRows([creditCard], [
      snapshot({
        id: 'outstanding',
        owner_type: 'credit_card',
        owner_id: 'card_1',
        balance_kind: 'outstanding',
        amount: 10000,
        source: 'notification',
      }),
      snapshot({
        id: 'available',
        owner_type: 'credit_card',
        owner_id: 'card_1',
        balance_kind: 'available_limit',
        amount: 40000,
        source: 'notification',
      }),
    ]);

    expect(views[0]).toEqual(expect.objectContaining({
      outstanding: 10000,
      availableLimit: 40000,
      creditLimit: 50000,
      utilizationPercent: 20,
      source: 'notification',
      sourceLabel: 'Notification',
    }));
  });

  it('uses manual exact credit card outstanding and limit snapshots', () => {
    const views = buildCreditCardBalanceViewModelsForRows([creditCard], [
      snapshot({
        id: 'manual_outstanding',
        owner_type: 'credit_card',
        owner_id: 'card_1',
        balance_kind: 'outstanding',
        amount: 8000,
        source: 'manual',
      }),
      snapshot({
        id: 'manual_available',
        owner_type: 'credit_card',
        owner_id: 'card_1',
        balance_kind: 'available_limit',
        amount: 42000,
        source: 'manual',
      }),
      snapshot({
        id: 'manual_limit',
        owner_type: 'credit_card',
        owner_id: 'card_1',
        balance_kind: 'credit_limit',
        amount: 50000,
        source: 'manual',
      }),
    ]);

    expect(views[0]).toEqual(expect.objectContaining({
      outstanding: 8000,
      availableLimit: 42000,
      creditLimit: 50000,
      source: 'manual',
      confidence: 'exact',
      sourceLabel: 'Manual',
      confidenceLabel: 'Exact',
    }));
  });

  it('keeps credit card source chips tied to the displayed outstanding amount', () => {
    const views = buildCreditCardBalanceViewModelsForRows([creditCard], [
      snapshot({
        id: 'sms_outstanding',
        owner_type: 'credit_card',
        owner_id: 'card_1',
        balance_kind: 'outstanding',
        amount: 2468.12,
        source: 'sms',
      }),
      snapshot({
        id: 'manual_minimum_due',
        owner_type: 'credit_card',
        owner_id: 'card_1',
        balance_kind: 'minimum_due',
        amount: 321,
        source: 'manual',
      }),
    ]);

    expect(views[0]).toEqual(expect.objectContaining({
      outstanding: 2468.12,
      minimumDue: 321,
      source: 'sms',
      confidence: 'exact',
      sourceLabel: 'SMS',
      confidenceLabel: 'Exact',
    }));
  });

  it('uses manual exact loan outstanding snapshots for loan accounts', () => {
    const loanAccount: BankAccount = {
      ...bankAccount,
      id: 'loan_account_1',
      account_type: 'loan',
      starting_balance: 100000,
      balance: 95000,
      loan_total: 100000,
    };

    const views = buildAccountBalanceViewModelsForRows([loanAccount], [
      snapshot({
        id: 'manual_loan',
        owner_type: 'loan',
        owner_id: 'loan_account_1',
        balance_kind: 'loan_outstanding',
        amount: 88000,
        source: 'manual',
      }),
    ]);

    expect(views[0]).toEqual(expect.objectContaining({
      displayBalance: 88000,
      balanceKind: 'loan_outstanding',
      source: 'manual',
      confidence: 'exact',
      sourceLabel: 'Manual',
    }));
  });

  it('handles credit card utilization safely when credit limit is missing', () => {
    const zeroLimitCard: CreditCard = {
      ...creditCard,
      credit_limit: 0,
      current_outstanding: 500,
    };

    const views = buildCreditCardBalanceViewModelsForRows([zeroLimitCard], []);

    expect(views[0]).toEqual(expect.objectContaining({
      creditLimit: 0,
      availableLimit: 0,
      utilizationPercent: 0,
    }));
  });

  it('keeps calculated credit card fallback ahead of low-confidence outstanding snapshots', () => {
    const views = buildCreditCardBalanceViewModelsForRows([creditCard], [
      snapshot({
        id: 'low_outstanding',
        owner_type: 'credit_card',
        owner_id: 'card_1',
        balance_kind: 'outstanding',
        amount: 45000,
        source: 'notification',
        confidence: 'low',
      }),
    ]);

    expect(views[0]).toEqual(expect.objectContaining({
      outstanding: 12000,
      source: 'calculated',
      confidence: 'estimated',
    }));
  });

  it('does not show a low-confidence credit-card source when fallback wins', () => {
    const views = buildCreditCardBalanceViewModelsForRows([creditCard], [
      snapshot({
        id: 'low_available',
        owner_type: 'credit_card',
        owner_id: 'card_1',
        balance_kind: 'available_limit',
        amount: 1000,
        source: 'notification',
        confidence: 'low',
      }),
    ]);

    expect(views[0]).toEqual(expect.objectContaining({
      availableLimit: 38000,
      source: 'calculated',
      confidence: 'estimated',
      sourceLabel: 'Calculated',
    }));
  });

  it('uses due and minimum due values without exposing raw metadata', () => {
    const statement: CreditCardStatement = {
      id: 'statement_1',
      user_id: 'user_1',
      credit_card_id: 'card_1',
      statement_date: '2026-05-25',
      period_start: null,
      period_end: null,
      total_due: 9000,
      minimum_due: 450,
      payment_due_date: '2026-06-05',
      statement_balance: 9000,
      source_snapshot_id: null,
      status: 'open',
      source: 'sms',
      confidence: 'exact',
      raw_source_metadata: {
        hash: 'abcd1234',
        body: 'raw sms should never leave the model',
      },
      created_at: '2026-05-25T00:00:00.000Z',
      updated_at: '2026-05-25T00:00:00.000Z',
    };

    const views = buildCreditCardBalanceViewModelsForRows([creditCard], [], [statement]);
    const serialized = JSON.stringify(views);

    expect(views[0]).toEqual(expect.objectContaining({
      dueAmount: 9000,
      minimumDue: 450,
      paymentDueDate: '2026-06-05',
    }));
    expect(serialized).not.toContain('raw_source_metadata');
    expect(serialized).not.toContain('raw sms');
  });

  it('includes credit card outstanding, limit, due, minimum due, and history groups', () => {
    const detail = buildCreditCardDetailViewForRows(
      creditCard,
      [
        snapshot({
          id: 'outstanding',
          owner_type: 'credit_card',
          owner_id: 'card_1',
          balance_kind: 'outstanding',
          amount: 8000,
          source: 'sms',
        }),
        snapshot({
          id: 'limit',
          owner_type: 'credit_card',
          owner_id: 'card_1',
          balance_kind: 'credit_limit',
          amount: 40000,
          source: 'sms',
        }),
        snapshot({
          id: 'due',
          owner_type: 'credit_card',
          owner_id: 'card_1',
          balance_kind: 'due_amount',
          amount: 1200,
          source: 'sms',
        }),
        snapshot({
          id: 'minimum_due',
          owner_type: 'credit_card',
          owner_id: 'card_1',
          balance_kind: 'minimum_due',
          amount: 300,
          source: 'sms',
        }),
      ],
      [],
      [
        snapshot({
          id: 'outstanding',
          owner_type: 'credit_card',
          owner_id: 'card_1',
          balance_kind: 'outstanding',
          amount: 8000,
          source: 'sms',
        }),
        snapshot({
          id: 'minimum_due',
          owner_type: 'credit_card',
          owner_id: 'card_1',
          balance_kind: 'minimum_due',
          amount: 300,
          source: 'sms',
        }),
      ]
    );

    expect(detail).toEqual(expect.objectContaining({
      outstanding: 8000,
      creditLimit: 40000,
      dueAmount: 1200,
      minimumDue: 300,
      utilizationPercent: 20,
    }));
    expect(detail.historyByKind.outstanding?.[0].amount).toBe(8000);
    expect(detail.historyByKind.minimum_due?.[0].balanceKindLabel).toBe('Minimum Due');
  });

  it('keeps credit card detail safe when limit is zero and history is empty', () => {
    const zeroLimitCard: CreditCard = {
      ...creditCard,
      credit_limit: 0,
      current_outstanding: 900,
    };
    const detail = buildCreditCardDetailViewForRows(zeroLimitCard, [], [], []);

    expect(detail).toEqual(expect.objectContaining({
      creditLimit: 0,
      availableLimit: 0,
      utilizationPercent: 0,
      history: [],
      historyByKind: {},
    }));
  });

  it('summarizes pending detected accounts by type', () => {
    expect(summarizePendingDetectedAccounts([
      { detection_type: 'bank_account' },
      { detection_type: 'credit_card' },
      { detection_type: 'credit_card' },
      { detection_type: 'debit_card' },
    ])).toEqual({
      total: 4,
      bank_account: 1,
      credit_card: 2,
      debit_card: 1,
      loan: 0,
    });
  });
});
