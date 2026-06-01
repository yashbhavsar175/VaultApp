import {
  buildDebtFreedomSummaryLabels,
  buildDebtItemsFromRows,
  buildIncomeEventsFromTransactions,
  getDebtFreedomCoachViewModel,
} from './debtFreedomViewModel';
import { DebtFreedomOptions, IncomeEvent } from './debtFreedom';
import {
  BalanceSnapshot,
  BankAccount,
  CreditCardStatement,
  PeopleLedger,
  Transaction,
} from '../../types';
import { CreditCard, Loan } from '../database/financial';
import { DebtFreedomSettings } from './debtFreedomSettings';
import { IncomeReviewDecision } from './incomeReview';

declare const require: any;
declare const __dirname: string;

const fs = require('fs');
const path = require('path');

const JUNE_OPTIONS: DebtFreedomOptions = {
  now: '2026-06-10T10:00:00.000Z',
  daysInMonth: 30,
  elapsedDaysInCurrentMonth: 10,
};

function settings(overrides: Partial<DebtFreedomSettings> = {}): DebtFreedomSettings {
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

function incomeDecision(overrides: Partial<IncomeReviewDecision> = {}): IncomeReviewDecision {
  return {
    id: overrides.id || 'decision_1',
    user_id: 'user_1',
    transaction_id: overrides.transaction_id === undefined ? 'unknown' : overrides.transaction_id,
    evidence_id: overrides.evidence_id || null,
    signal_hash: overrides.signal_hash || null,
    decision: overrides.decision || 'count_as_income',
    income_source_type: overrides.income_source_type === undefined ? 'gig_work' : overrides.income_source_type,
    confidence: overrides.confidence || 'user_confirmed',
    reason_code: overrides.reason_code || null,
    reviewed_at: overrides.reviewed_at || '2026-06-01T00:00:00.000Z',
    created_at: overrides.created_at || '2026-06-01T00:00:00.000Z',
    updated_at: overrides.updated_at || '2026-06-01T00:00:00.000Z',
  };
}

function transaction(overrides: Partial<Transaction>): Transaction {
  return {
    id: overrides.id || 'tx_1',
    user_id: 'user_1',
    amount: overrides.amount ?? 1000,
    type: overrides.type || 'income',
    note: overrides.note ?? 'Income',
    category: overrides.category ?? 'Income',
    created_at: overrides.created_at || '2026-06-05T10:00:00.000Z',
    account_id: overrides.account_id,
    account_last4: overrides.account_last4,
    sms_source: overrides.sms_source,
    sms_sender: overrides.sms_sender,
    upi_id: overrides.upi_id,
    reference_number: overrides.reference_number,
    raw_sms: overrides.raw_sms,
    balance: overrides.balance,
    from_account_id: overrides.from_account_id,
    to_account_id: overrides.to_account_id,
    is_transfer_pending: overrides.is_transfer_pending,
    refund_of_transaction_id: overrides.refund_of_transaction_id,
  };
}

function loan(overrides: Partial<Loan> = {}): Loan {
  return {
    id: overrides.id || 'loan_1',
    user_id: 'user_1',
    loan_name: overrides.loan_name || 'Personal loan',
    lender_name: overrides.lender_name || 'HDFC Bank',
    principal_amount: overrides.principal_amount ?? 100000,
    current_outstanding: overrides.current_outstanding ?? 90000,
    emi_amount: overrides.emi_amount ?? 5000,
    emi_due_date: overrides.emi_due_date ?? 15,
    interest_rate: overrides.interest_rate ?? 12,
    tenure_months: overrides.tenure_months ?? 24,
    start_date: overrides.start_date || '2026-01-01',
    loan_type: overrides.loan_type || 'Personal',
    created_at: overrides.created_at || '2026-01-01T00:00:00.000Z',
    updated_at: overrides.updated_at || '2026-01-01T00:00:00.000Z',
  };
}

function creditCard(overrides: Partial<CreditCard> = {}): CreditCard {
  return {
    id: overrides.id || 'card_1',
    user_id: 'user_1',
    bank_name: overrides.bank_name || 'HDFC Bank',
    card_name: overrides.card_name || 'Rewards',
    last_4_digits: overrides.last_4_digits || '4321',
    credit_limit: overrides.credit_limit ?? 100000,
    current_outstanding: overrides.current_outstanding ?? 12000,
    due_date: overrides.due_date ?? 7,
    billing_cycle_date: overrides.billing_cycle_date ?? 20,
    is_archived: overrides.is_archived,
    archived_at: overrides.archived_at,
    created_at: overrides.created_at || '2026-01-01T00:00:00.000Z',
    updated_at: overrides.updated_at || '2026-01-01T00:00:00.000Z',
  };
}

function bankAccount(overrides: Partial<BankAccount> = {}): BankAccount {
  return {
    id: overrides.id || 'bank_1',
    user_id: 'user_1',
    bank_name: overrides.bank_name || 'HDFC Bank',
    account_last4: overrides.account_last4 || '1234',
    account_type: overrides.account_type || 'loan',
    starting_balance: overrides.starting_balance ?? 0,
    balance: overrides.balance ?? 0,
    credit_limit: overrides.credit_limit ?? 0,
    loan_total: overrides.loan_total ?? 90000,
    upi_ids: overrides.upi_ids || [],
    is_archived: overrides.is_archived,
    archived_at: overrides.archived_at,
    created_at: overrides.created_at || '2026-01-01T00:00:00.000Z',
  };
}

function statement(overrides: Partial<CreditCardStatement> = {}): CreditCardStatement {
  return {
    id: overrides.id || 'stmt_1',
    user_id: 'user_1',
    credit_card_id: overrides.credit_card_id || 'card_1',
    statement_date: overrides.statement_date || '2026-06-01',
    period_start: overrides.period_start || null,
    period_end: overrides.period_end || null,
    total_due: overrides.total_due ?? 12000,
    minimum_due: overrides.minimum_due ?? 900,
    payment_due_date: overrides.payment_due_date || '2026-06-18',
    statement_balance: overrides.statement_balance ?? null,
    source_snapshot_id: overrides.source_snapshot_id || null,
    status: overrides.status || 'open',
    source: overrides.source || 'sms',
    confidence: overrides.confidence || 'exact',
    raw_source_metadata: overrides.raw_source_metadata || {},
    created_at: overrides.created_at || '2026-06-01T00:00:00.000Z',
    updated_at: overrides.updated_at || '2026-06-01T00:00:00.000Z',
  };
}

function snapshot(overrides: Partial<BalanceSnapshot>): BalanceSnapshot {
  return {
    id: overrides.id || 'snap_1',
    user_id: 'user_1',
    owner_type: overrides.owner_type || 'credit_card',
    owner_id: overrides.owner_id || 'card_1',
    detected_bank_name: overrides.detected_bank_name || null,
    account_last4: overrides.account_last4 || null,
    card_last4: overrides.card_last4 || null,
    balance_kind: overrides.balance_kind || 'outstanding',
    amount: overrides.amount ?? 11000,
    currency: overrides.currency || 'INR',
    source: overrides.source || 'sms',
    confidence: overrides.confidence || 'exact',
    detected_at: overrides.detected_at || '2026-06-03T00:00:00.000Z',
    source_sender_or_package: overrides.source_sender_or_package || null,
    raw_source_metadata: overrides.raw_source_metadata || {},
    note: overrides.note || null,
    created_at: overrides.created_at || '2026-06-03T00:00:00.000Z',
  };
}

function ledger(overrides: Partial<PeopleLedger> = {}): PeopleLedger {
  return {
    id: overrides.id || 'ledger_1',
    user_id: 'user_1',
    person_name: overrides.person_name || 'Private Person',
    type: overrides.type || 'borrowed',
    total_amount: overrides.total_amount ?? 5000,
    paid_amount: overrides.paid_amount ?? 1000,
    remaining_amount: overrides.remaining_amount ?? 4000,
    repayment_type: overrides.repayment_type || 'installment',
    due_date: overrides.due_date || '2026-06-20',
    installment_amount: overrides.installment_amount ?? 500,
    installment_days: overrides.installment_days || ['mon'],
    start_date: overrides.start_date || '2026-06-01',
    notes: overrides.notes || 'private note',
    is_settled: overrides.is_settled ?? false,
    settled_at: overrides.settled_at || null,
    created_at: overrides.created_at || '2026-06-01T00:00:00.000Z',
  };
}

describe('debt freedom view model static boundaries', () => {
  const source = fs.readFileSync(path.join(__dirname, 'debtFreedomViewModel.ts'), 'utf8');
  const lower = source.toLowerCase();

  it('does not call mutating database or function APIs', () => {
    expect(lower).not.toMatch(/\.(insert|update|delete|upsert|rpc)\s*\(/);
    expect(lower).not.toMatch(/\bcreate\s+table\b|\balter\s+table\b|\bdrop\s+table\b/);
  });

  it('does not write app state, import UI, or log raw data', () => {
    expect(lower).not.toMatch(/asyncstorage|setitem|removeitem|cache_keys|emitfinancedatachanged/);
    expect(lower).not.toMatch(/console\.(log|warn|error|info|debug)/);
    expect(lower).not.toMatch(/react-native|src\/screens|src\\screens/);
  });

  it('does not select raw payload columns', () => {
    expect(lower).not.toContain('raw_sms');
    expect(lower).not.toContain('raw_source_metadata');
    expect(lower).not.toContain('notification_text');
  });
});

describe('buildDebtItemsFromRows', () => {
  it('maps a standalone loan row to a debt item', () => {
    const items = buildDebtItemsFromRows({ loans: [loan()] }, JUNE_OPTIONS);
    expect(items[0]).toEqual(expect.objectContaining({
      sourceType: 'loan',
      outstanding: 90000,
      minimumMonthlyPayment: 5000,
      annualInterestRate: 12,
      dueDate: '2026-06-15',
      confidence: 'exact',
    }));
  });

  it('maps credit card outstanding and latest statement minimum due', () => {
    const items = buildDebtItemsFromRows({
      creditCards: [creditCard()],
      creditCardStatements: [
        statement({ id: 'old', minimum_due: 300, payment_due_date: '2026-06-08' }),
        statement({ id: 'new', minimum_due: 900, payment_due_date: '2026-06-18' }),
      ],
    }, JUNE_OPTIONS);
    expect(items[0]).toEqual(expect.objectContaining({
      sourceType: 'credit_card',
      outstanding: 12000,
      minimumMonthlyPayment: 900,
      dueDate: '2026-06-18',
    }));
  });

  it('uses latest exact credit-card snapshot for outstanding confidence', () => {
    const items = buildDebtItemsFromRows({
      creditCards: [creditCard()],
      balanceSnapshots: [snapshot({ amount: 13500, confidence: 'exact' })],
    }, JUNE_OPTIONS);
    expect(items[0]).toEqual(expect.objectContaining({
      outstanding: 13500,
      confidence: 'exact',
    }));
  });

  it('maps people borrowed remaining amount without person notes', () => {
    const items = buildDebtItemsFromRows({ peopleLedger: [ledger()] }, JUNE_OPTIONS);
    expect(items[0]).toEqual(expect.objectContaining({
      sourceType: 'people_borrowed',
      outstanding: 4000,
      minimumMonthlyPayment: 500,
      label: 'Borrowed balance',
    }));
    expect(JSON.stringify(items[0])).not.toContain('Private Person');
    expect(JSON.stringify(items[0])).not.toContain('private note');
  });

  it('includes archived nonzero credit cards and excludes zero archived cards', () => {
    const items = buildDebtItemsFromRows({
      creditCards: [
        creditCard({ id: 'hidden_nonzero', current_outstanding: 7000, is_archived: true }),
        creditCard({ id: 'hidden_zero', current_outstanding: 0, is_archived: true }),
      ],
    }, JUNE_OPTIONS);
    expect(items).toHaveLength(1);
    expect(items[0]).toEqual(expect.objectContaining({
      id: 'credit_card:hidden_nonzero',
      isHidden: true,
    }));
  });

  it('flags duplicate standalone loan and loan-style bank account groups', () => {
    const items = buildDebtItemsFromRows({
      loans: [loan({ id: 'loan_a', current_outstanding: 100000, lender_name: 'HDFC Bank' })],
      bankAccounts: [bankAccount({ id: 'bank_loan_a', loan_total: 102000, bank_name: 'HDFC Bank' })],
    }, JUNE_OPTIONS);
    const groupKeys = items.map(item => item.duplicateGroupKey).filter(Boolean);
    expect(new Set(groupKeys).size).toBe(1);
    expect(groupKeys).toHaveLength(2);
    expect(items.find(item => item.sourceType === 'loan_account')?.confidence).toBe('needs_review');
  });

  it('flags duplicate credit-card representations', () => {
    const items = buildDebtItemsFromRows({
      creditCards: [creditCard({ id: 'card_a', bank_name: 'ICICI Bank', last_4_digits: '9876' })],
      bankAccounts: [bankAccount({
        id: 'bank_card_a',
        account_type: 'credit_card',
        bank_name: 'ICICI Bank',
        account_last4: '9876',
        credit_limit: 50000,
        balance: 38000,
        loan_total: 0,
      })],
    }, JUNE_OPTIONS);
    const groupKeys = items.map(item => item.duplicateGroupKey).filter(Boolean);
    expect(new Set(groupKeys).size).toBe(1);
    expect(groupKeys).toHaveLength(2);
  });

  it('uses credit-card bank-account balance as outstanding, not available limit', () => {
    const items = buildDebtItemsFromRows({
      bankAccounts: [bankAccount({
        id: 'bank_card_only',
        account_type: 'credit_card',
        account_last4: '4444',
        credit_limit: 50000,
        balance: 38000,
        starting_balance: 0,
        loan_total: 0,
      })],
    }, JUNE_OPTIONS);
    expect(items[0]).toEqual(expect.objectContaining({
      id: 'credit_card_account:bank_card_only',
      outstanding: 38000,
    }));
  });

  it('does not invent hidden credit-card debt from credit limit alone', () => {
    const items = buildDebtItemsFromRows({
      bankAccounts: [bankAccount({
        id: 'hidden_bank_card_zero',
        account_type: 'credit_card',
        account_last4: '5555',
        credit_limit: 50000,
        balance: 0,
        starting_balance: 0,
        loan_total: 0,
        is_archived: true,
      })],
    }, JUNE_OPTIONS);
    expect(items).toHaveLength(0);
  });
});

describe('buildIncomeEventsFromTransactions', () => {
  function includedTotal(events: IncomeEvent[]): number {
    return events.filter(event => event.includeInIncome).reduce((sum, event) => sum + event.amount, 0);
  }

  it.each(['Porter', 'Swiggy', 'Zomato', 'Rapido', 'Zepto', 'Delivery'])(
    'counts current-month gig income for %s',
    token => {
      const events = buildIncomeEventsFromTransactions([
        transaction({ id: token, category: token, note: `${token} payout`, amount: 1200 }),
      ], JUNE_OPTIONS);
      expect(events[0]).toEqual(expect.objectContaining({
        sourceType: 'gig_work',
        includeInIncome: true,
      }));
    }
  );

  it('counts salary, freelance, and business income', () => {
    const events = buildIncomeEventsFromTransactions([
      transaction({ id: 'salary', category: 'Salary', note: 'salary credited', amount: 5000 }),
      transaction({ id: 'freelance', category: 'Freelance', note: 'freelance payout', amount: 3000 }),
      transaction({ id: 'business', category: 'Business', note: 'business earnings', amount: 2000 }),
    ], JUNE_OPTIONS);
    expect(includedTotal(events)).toBe(10000);
    expect(events.map(event => event.sourceType)).toEqual(['salary', 'freelance', 'business']);
  });

  it('keeps generic income and UPI credit as needs review', () => {
    const events = buildIncomeEventsFromTransactions([
      transaction({ id: 'upi', category: 'Income', note: 'UPI credit received', amount: 2500 }),
    ], JUNE_OPTIONS);
    expect(events[0]).toEqual(expect.objectContaining({
      sourceType: 'upi_credit',
      confidence: 'needs_review',
      includeInIncome: false,
      exclusionReason: 'unknown_credit',
    }));
  });

  it.each([
    ['family', 'money from family'],
    ['friend', 'friend returned split'],
    ['mom', 'mom sent money'],
    ['dad', 'dad transfer'],
    ['papa', 'papa sent cash'],
    ['brother', 'brother split'],
    ['sister', 'sister rent return'],
  ])('excludes %s income-like credits', (_name, note) => {
    const events = buildIncomeEventsFromTransactions([
      transaction({ note, amount: 1000 }),
    ], JUNE_OPTIONS);
    expect(events[0].includeInIncome).toBe(false);
    expect(events[0].exclusionReason).toBe('family_or_friend');
  });

  it('excludes refund, borrowed money, and self-transfer candidates', () => {
    const events = buildIncomeEventsFromTransactions([
      transaction({ id: 'refund', type: 'refund', category: 'Refund', note: 'refund', amount: 400 }),
      transaction({ id: 'borrowed', type: 'borrowed', category: 'Borrowed', note: 'borrowed', amount: 500 }),
      transaction({
        id: 'transfer',
        type: 'transfer',
        category: 'Transfer',
        note: 'self transfer',
        from_account_id: 'a',
        to_account_id: 'b',
        amount: 600,
      }),
    ], JUNE_OPTIONS);
    expect(events.map(event => event.includeInIncome)).toEqual([false, false, false]);
    expect(events.map(event => event.exclusionReason)).toEqual(['refund', 'borrowed_money', 'self_transfer']);
  });

  it('ignores future-dated and previous-month transactions for current-month pace', () => {
    const events = buildIncomeEventsFromTransactions([
      transaction({ id: 'future', category: 'Salary', note: 'salary', created_at: '2026-06-20T00:00:00.000Z' }),
      transaction({ id: 'previous', category: 'Salary', note: 'salary', created_at: '2026-05-30T00:00:00.000Z' }),
      transaction({ id: 'current', category: 'Salary', note: 'salary', created_at: '2026-06-08T00:00:00.000Z' }),
    ], JUNE_OPTIONS);
    expect(events.map(event => event.id)).toEqual(['current']);
  });

  it('sanitizes raw note, UPI, phone, address, and long identifiers from events', () => {
    const events = buildIncomeEventsFromTransactions([
      transaction({
        id: 'privacy',
        category: 'Income 9876543210',
        note: 'UPI credit from rahul@okhdfcbank phone 9876543210 address flat 101 road 1234567890123456',
        raw_sms: 'RAW SMS body 4111111111111111',
        upi_id: 'rahul@okhdfcbank',
        account_last4: '1234',
      }),
    ], JUNE_OPTIONS);
    const serialized = JSON.stringify(events);
    expect(serialized).not.toContain('rahul@okhdfcbank');
    expect(serialized).not.toContain('9876543210');
    expect(serialized).not.toContain('flat 101');
    expect(serialized).not.toContain('1234567890123456');
    expect(serialized).not.toContain('RAW SMS');
  });
});

describe('getDebtFreedomCoachViewModel', () => {
  it('returns a plan from current-month daily average income and read-only rows', async () => {
    const viewModel = await getDebtFreedomCoachViewModel({
      ...JUNE_OPTIONS,
      rows: {
        transactions: [
          transaction({ id: 'salary', category: 'Salary', note: 'salary', amount: 1000 }),
        ],
        creditCards: [creditCard({ current_outstanding: 10000 })],
        creditCardStatements: [statement({ minimum_due: 500 })],
      },
    });
    expect(viewModel.plan.totalDebt).toBe(10000);
    expect(viewModel.plan.minimumDebtPayment).toBe(500);
    expect(viewModel.plan.monthlyIncomeUsed).toBe(3000);
    expect(viewModel.plan.incomeProjection.averageDailyIncome).toBe(100);
    expect(viewModel.dataQuality).toEqual(expect.objectContaining({
      hasConfirmedIncome: false,
      hasVariableIncomeEstimate: true,
      needsIncomeReviewCount: 0,
      missingAprCount: 1,
    }));
    expect(viewModel.plan.warnings.map(warning => warning.code)).toContain('essential_expense_missing');
  });

  it('uses confirmed monthly income from settings', async () => {
    const viewModel = await getDebtFreedomCoachViewModel({
      ...JUNE_OPTIONS,
      settings: settings({
        income_mode: 'confirmed',
        confirmed_monthly_income: 50000,
        essential_monthly_expenses: 12000,
      }),
      rows: {
        transactions: [
          transaction({ id: 'gig', category: 'Porter', note: 'Porter payout', amount: 1000 }),
        ],
        creditCards: [creditCard({ current_outstanding: 10000 })],
      },
    });

    expect(viewModel.settingsStatus).toBe('loaded');
    expect(viewModel.plan.monthlyIncomeUsed).toBe(50000);
    expect(viewModel.plan.incomeProjection.source).toBe('confirmed');
    expect(viewModel.summary.monthlyIncomeLabel).toBe('Confirmed: ₹50,000');
    expect(viewModel.dataQuality.hasConfirmedIncome).toBe(true);
  });

  it('uses manual estimate settings without treating it as confirmed income', async () => {
    const viewModel = await getDebtFreedomCoachViewModel({
      ...JUNE_OPTIONS,
      settings: settings({
        income_mode: 'manual_estimate',
        confirmed_monthly_income: 36000,
      }),
      rows: {
        creditCards: [creditCard({ current_outstanding: 10000 })],
      },
    });

    expect(viewModel.plan.monthlyIncomeUsed).toBe(36000);
    expect(viewModel.plan.incomeProjection.source).toBe('manual_estimate');
    expect(viewModel.summary.monthlyIncomeLabel).toBe('Manual estimate: ₹36,000');
    expect(viewModel.dataQuality.hasConfirmedIncome).toBe(false);
  });

  it('passes settings for essentials, emergency, target income, planned payment, target months, and strategy', async () => {
    const viewModel = await getDebtFreedomCoachViewModel({
      ...JUNE_OPTIONS,
      settings: settings({
        income_mode: 'confirmed',
        confirmed_monthly_income: 50000,
        essential_monthly_expenses: 20000,
        emergency_contribution: 3000,
        target_monthly_income: 60000,
        planned_monthly_debt_payment: 10000,
        target_debt_free_months: 6,
        strategy: 'snowball',
      }),
      rows: {
        creditCards: [creditCard({ current_outstanding: 30000 })],
      },
    });

    expect(viewModel.plan.strategy).toBe('snowball');
    expect(viewModel.plan.safeSpendAmount).toBe(17000);
    expect(viewModel.plan.freeCashflowAfterDebt).toBe(27000);
    expect(viewModel.plan.incomeProjection.targetMonthlyIncome).toBe(60000);
    expect(viewModel.plan.extraMonthlyNeededForTarget).toBe(0);
    expect(viewModel.plan.estimatedMonthsToDebtFree).toBe(3);
  });

  it('falls back safely when settings are missing', async () => {
    const viewModel = await getDebtFreedomCoachViewModel({
      ...JUNE_OPTIONS,
      settings: null,
      rows: {
        transactions: [
          transaction({ id: 'salary', category: 'Salary', note: 'salary', amount: 1000 }),
        ],
      },
    });

    expect(viewModel.settings).toBeNull();
    expect(viewModel.settingsStatus).toBe('missing');
    expect(viewModel.plan.incomeProjection.source).toBe('current_month_daily_average');
  });

  it.each(['42P01', '42703', 'PGRST205'])('falls back safely when settings table is unavailable with %s', async code => {
    const viewModel = await getDebtFreedomCoachViewModel({
      ...JUNE_OPTIONS,
      settingsError: { code },
      rows: {
        transactions: [
          transaction({ id: 'salary', category: 'Salary', note: 'salary', amount: 1000 }),
        ],
      },
    });

    expect(viewModel.settings).toBeNull();
    expect(viewModel.settingsStatus).toBe('error');
    expect(viewModel.plan.incomeProjection.source).toBe('current_month_daily_average');
  });

  it('does not double count duplicate debts through the engine', async () => {
    const viewModel = await getDebtFreedomCoachViewModel({
      ...JUNE_OPTIONS,
      rows: {
        loans: [loan({ id: 'loan_a', current_outstanding: 100000, lender_name: 'HDFC Bank' })],
        bankAccounts: [bankAccount({ id: 'bank_loan_a', loan_total: 102000, bank_name: 'HDFC Bank' })],
      },
    });
    expect(viewModel.debtItems).toHaveLength(2);
    expect(viewModel.dataQuality.duplicateDebtWarningCount).toBe(1);
    expect(viewModel.plan.totalDebt).toBe(100000);
    expect(viewModel.plan.warnings.map(warning => warning.code)).toContain('duplicate_debt_possible');
  });

  it('surfaces hidden debts, income review, missing APR, and missing EMI counts', async () => {
    const viewModel = await getDebtFreedomCoachViewModel({
      ...JUNE_OPTIONS,
      rows: {
        transactions: [
          transaction({ id: 'unknown', category: 'Income', note: 'UPI credit received', amount: 1000 }),
        ],
        creditCards: [creditCard({ current_outstanding: 5000, is_archived: true })],
      },
    });
    expect(viewModel.dataQuality).toEqual(expect.objectContaining({
      hiddenDebtCount: 1,
      needsIncomeReviewCount: 1,
      missingAprCount: 1,
      missingEmiCount: 1,
    }));
    expect(viewModel.plan.warnings.map(warning => warning.code)).toContain('hidden_debt_included');
  });

  it('uses reviewed income decisions in the current-month projection', async () => {
    const viewModel = await getDebtFreedomCoachViewModel({
      ...JUNE_OPTIONS,
      incomeReviewDecisions: [
        incomeDecision({ transaction_id: 'unknown', decision: 'count_as_income', income_source_type: 'gig_work' }),
      ],
      rows: {
        transactions: [
          transaction({ id: 'unknown', category: 'Income', note: 'UPI credit received', amount: 1000 }),
        ],
      },
    });

    expect(viewModel.plan.monthlyIncomeUsed).toBe(3000);
    expect(viewModel.incomeEvents[0]).toEqual(expect.objectContaining({
      sourceType: 'gig_work',
      confidence: 'confirmed',
      includeInIncome: true,
    }));
    expect(viewModel.dataQuality.needsIncomeReviewCount).toBe(0);
    expect(viewModel.incomeReviewStatus).toBe('loaded');
  });

  it('excludes reviewed not-income credits from the projection', async () => {
    const viewModel = await getDebtFreedomCoachViewModel({
      ...JUNE_OPTIONS,
      incomeReviewDecisions: [
        incomeDecision({ transaction_id: 'gig', decision: 'not_income', income_source_type: null }),
      ],
      rows: {
        transactions: [
          transaction({ id: 'gig', category: 'Porter', note: 'Porter payout', amount: 1000 }),
        ],
      },
    });

    expect(viewModel.plan.monthlyIncomeUsed).toBeNull();
    expect(viewModel.incomeEvents[0]).toEqual(expect.objectContaining({
      confidence: 'excluded',
      includeInIncome: false,
    }));
  });

  it.each(['42P01', '42703', 'PGRST205'])('continues safely when income review table is unavailable with %s', async code => {
    const viewModel = await getDebtFreedomCoachViewModel({
      ...JUNE_OPTIONS,
      incomeReviewError: { code },
      rows: {
        transactions: [
          transaction({ id: 'salary', category: 'Salary', note: 'salary', amount: 1000 }),
        ],
      },
    });

    expect(viewModel.incomeReviewStatus).toBe('error');
    expect(viewModel.plan.incomeProjection.source).toBe('current_month_daily_average');
  });

  it('builds display-safe summary labels', async () => {
    const viewModel = await getDebtFreedomCoachViewModel({
      ...JUNE_OPTIONS,
      targetMonthlyIncome: 6000,
      rows: {
        transactions: [
          transaction({ id: 'salary', category: 'Salary', note: 'salary', amount: 1000 }),
        ],
        creditCards: [creditCard({ current_outstanding: 10000 })],
      },
    });
    const summary = buildDebtFreedomSummaryLabels(viewModel.plan);
    expect(summary.totalDebtLabel).toBe('₹10,000');
    expect(summary.monthlyIncomeLabel).toBe('Estimate: ₹3,000');
    expect(summary.dailyTargetLabel).toContain('Today’s target: ₹');
    expect(summary.debtFreeDateLabel).toContain('Debt-free date estimate');
    expect(summary.safeSpendLabel).toBe('Needs review');
    expect(summary.scoreLabel).toMatch(/Good|Caution|High risk|Needs review/);
  });
});
