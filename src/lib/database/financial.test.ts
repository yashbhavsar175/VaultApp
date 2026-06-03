import { supabase } from '../core';
import {
  addBankAccount,
  archiveBankAccountIfSupported,
  addEMIPayment,
  calculateEMIComponents,
  getBankAccounts,
  getCreditCards,
  updateBankAccount,
} from './financial';

jest.mock('../core', () => ({
  supabase: {
    auth: {
      getUser: jest.fn(),
    },
    from: jest.fn(),
  },
}));

const mockSupabase = supabase as any;

function mockInsertResult() {
  const single = jest.fn().mockResolvedValue({
    data: {
      id: 'emi_1',
      loan_id: 'loan_1',
      user_id: 'user_1',
      amount_paid: 10000,
      payment_date: '2026-05-25',
      principal_component: 10000,
      interest_component: 0,
      reference_number: 'REF123',
      created_at: '2026-05-25T00:00:00.000Z',
    },
    error: null,
  });
  const select = jest.fn(() => ({ single }));
  const insert = jest.fn(() => ({ select }));

  return { insert, select, single };
}

describe('loan EMI helpers', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSupabase.auth.getUser.mockResolvedValue({
      data: { user: { id: 'user_1' } },
    });
  });

  it('preserves explicit zero interest instead of recalculating EMI components', async () => {
    const emiPayments = mockInsertResult();

    mockSupabase.from.mockImplementation((table: string) => {
      if (table === 'loans') {
        throw new Error('Loan lookup should not run when both components are provided');
      }
      if (table === 'emi_payments') {
        return { insert: emiPayments.insert };
      }
      throw new Error(`Unexpected table: ${table}`);
    });

    await addEMIPayment({
      loan_id: 'loan_1',
      amount_paid: 10000,
      payment_date: new Date('2026-05-25T00:00:00.000Z'),
      principal_component: 10000,
      interest_component: 0,
      reference_number: '  REF123  ',
    });

    expect(mockSupabase.from).not.toHaveBeenCalledWith('loans');
    expect(emiPayments.insert).toHaveBeenCalledWith(expect.objectContaining({
      loan_id: 'loan_1',
      amount_paid: 10000,
      payment_date: '2026-05-25',
      principal_component: 10000,
      interest_component: 0,
      reference_number: 'REF123',
    }));
  });

  it('preserves explicit zero principal instead of recalculating EMI components', async () => {
    const emiPayments = mockInsertResult();

    mockSupabase.from.mockImplementation((table: string) => {
      if (table === 'loans') {
        throw new Error('Loan lookup should not run when both components are provided');
      }
      if (table === 'emi_payments') {
        return { insert: emiPayments.insert };
      }
      throw new Error(`Unexpected table: ${table}`);
    });

    await addEMIPayment({
      loan_id: 'loan_1',
      amount_paid: 10000,
      principal_component: 0,
      interest_component: 10000,
    });

    expect(mockSupabase.from).not.toHaveBeenCalledWith('loans');
    expect(emiPayments.insert).toHaveBeenCalledWith(expect.objectContaining({
      principal_component: 0,
      interest_component: 10000,
    }));
  });

  it('calculates missing EMI components from current outstanding and interest rate', async () => {
    const emiPayments = mockInsertResult();
    const loanSingle = jest.fn().mockResolvedValue({
      data: {
        id: 'loan_1',
        user_id: 'user_1',
        current_outstanding: 100000,
        interest_rate: 12,
      },
      error: null,
    });
    const loanEqUser = jest.fn(() => ({ single: loanSingle }));
    const loanEqId = jest.fn(() => ({ eq: loanEqUser }));
    const loanSelect = jest.fn(() => ({ eq: loanEqId }));

    mockSupabase.from.mockImplementation((table: string) => {
      if (table === 'loans') {
        return { select: loanSelect };
      }
      if (table === 'emi_payments') {
        return { insert: emiPayments.insert };
      }
      throw new Error(`Unexpected table: ${table}`);
    });

    await addEMIPayment({
      loan_id: 'loan_1',
      amount_paid: 10000,
    });

    expect(loanSelect).toHaveBeenCalledWith('*');
    expect(emiPayments.insert).toHaveBeenCalledWith(expect.objectContaining({
      principal_component: 9000,
      interest_component: 1000,
    }));
  });

  it('keeps principal reduction separate from total EMI amount', () => {
    const components = calculateEMIComponents(100000, 12, 10000);

    expect(components).toEqual({
      principal: 9000,
      interest: 1000,
    });
  });
});

describe('financial account archive filtering', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSupabase.auth.getUser.mockResolvedValue({
      data: { user: { id: 'user_1' } },
    });
  });

  function mockListQuery(rows: any[] = [], error: any = null) {
    const order = jest.fn().mockResolvedValue({ data: error ? null : rows, error });
    const chain: { eq: jest.Mock; order: jest.Mock } = {
      eq: jest.fn(),
      order,
    };
    chain.eq.mockReturnValue(chain);
    const select = jest.fn(() => chain);
    return { select, eq: chain.eq, order };
  }

  it('excludes archived bank accounts by default', async () => {
    const query = mockListQuery();
    mockSupabase.from.mockReturnValue(query);

    await getBankAccounts();

    expect(mockSupabase.from).toHaveBeenCalledWith('bank_accounts');
    expect(query.eq).toHaveBeenCalledWith('user_id', 'user_1');
    expect(query.eq).toHaveBeenCalledWith('is_archived', false);
  });

  it('falls back safely when bank archive columns are not deployed yet', async () => {
    const archiveError = {
      code: '42703',
      message: 'column bank_accounts.is_archived does not exist',
    };
    const failedQuery = mockListQuery([], archiveError);
    const fallbackQuery = mockListQuery([{ id: 'bank_1', user_id: 'user_1' }]);
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    mockSupabase.from
      .mockReturnValueOnce(failedQuery)
      .mockReturnValueOnce(fallbackQuery);

    const rows = await getBankAccounts();

    expect(rows).toEqual([{ id: 'bank_1', user_id: 'user_1' }]);
    expect(failedQuery.eq).toHaveBeenCalledWith('is_archived', false);
    expect(fallbackQuery.eq).toHaveBeenCalledWith('user_id', 'user_1');
    expect(fallbackQuery.eq).not.toHaveBeenCalledWith('is_archived', false);
    expect(warnSpy).toHaveBeenCalledWith(
      '[Accounts] Archive fields unavailable; loading without archive filter',
      { table: 'bank_accounts', code: '42703' }
    );
    warnSpy.mockRestore();
  });

  it('can fetch only hidden bank accounts for restore UI', async () => {
    const query = mockListQuery();
    mockSupabase.from.mockReturnValue(query);

    await getBankAccounts({ archivedOnly: true });

    expect(query.eq).toHaveBeenCalledWith('user_id', 'user_1');
    expect(query.eq).toHaveBeenCalledWith('is_archived', true);
  });

  it('archives a legacy bank account only within the current user scope', async () => {
    const eqUser = jest.fn().mockResolvedValue({ error: null });
    const eqId = jest.fn(() => ({ eq: eqUser }));
    const update = jest.fn(() => ({ eq: eqId }));
    mockSupabase.from.mockReturnValue({ update });

    const result = await archiveBankAccountIfSupported('legacy_card_bank_1');

    expect(result).toBe(true);
    expect(mockSupabase.from).toHaveBeenCalledWith('bank_accounts');
    expect(update).toHaveBeenCalledWith(expect.objectContaining({
      is_archived: true,
      archived_at: expect.any(String),
    }));
    expect(eqId).toHaveBeenCalledWith('id', 'legacy_card_bank_1');
    expect(eqUser).toHaveBeenCalledWith('user_id', 'user_1');
  });

  it('leaves legacy bank account visible when archive columns are not deployed', async () => {
    const eqUser = jest.fn().mockResolvedValue({
      error: {
        code: '42703',
        message: 'column bank_accounts.is_archived does not exist',
      },
    });
    const eqId = jest.fn(() => ({ eq: eqUser }));
    const update = jest.fn(() => ({ eq: eqId }));
    mockSupabase.from.mockReturnValue({ update });

    const result = await archiveBankAccountIfSupported('legacy_card_bank_1');

    expect(result).toBe(false);
  });

  it('excludes archived credit cards by default', async () => {
    const query = mockListQuery();
    mockSupabase.from.mockReturnValue(query);

    await getCreditCards();

    expect(mockSupabase.from).toHaveBeenCalledWith('credit_cards');
    expect(query.eq).toHaveBeenCalledWith('user_id', 'user_1');
    expect(query.eq).toHaveBeenCalledWith('is_archived', false);
  });

  it('treats hidden credit-card lists as empty when archive columns are not deployed yet', async () => {
    const archiveError = {
      code: '42703',
      message: 'column credit_cards.is_archived does not exist',
    };
    const failedQuery = mockListQuery([], archiveError);
    mockSupabase.from.mockReturnValueOnce(failedQuery);

    const rows = await getCreditCards({ archivedOnly: true });

    expect(rows).toEqual([]);
    expect(mockSupabase.from).toHaveBeenCalledTimes(1);
    expect(failedQuery.eq).toHaveBeenCalledWith('is_archived', true);
  });
});

describe('Loan/EMI bank account fields', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSupabase.auth.getUser.mockResolvedValue({
      data: { user: { id: 'user_1' } },
    });
  });

  function loanAccountPayload(
    overrides: Partial<Parameters<typeof addBankAccount>[0]> = {}
  ): Parameters<typeof addBankAccount>[0] {
    return {
      bank_name: 'HDFC Bank',
      account_last4: '1234',
      account_type: 'loan' as const,
      starting_balance: 125000,
      credit_limit: 0,
      loan_total: 150000,
      monthly_emi_amount: 5000,
      upi_ids: [],
      ...overrides,
    };
  }

  it('saves monthly EMI amount for Loan/EMI bank accounts', async () => {
    const insert = jest.fn().mockResolvedValue({ error: null });
    mockSupabase.from.mockReturnValue({ insert });

    await addBankAccount(loanAccountPayload());

    expect(mockSupabase.from).toHaveBeenCalledWith('bank_accounts');
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({
      user_id: 'user_1',
      account_type: 'loan',
      starting_balance: 125000,
      balance: 125000,
      loan_total: 150000,
      monthly_emi_amount: 5000,
    }));
  });

  it('saves blank Loan/EMI monthly EMI as null on update', async () => {
    const eqUser = jest.fn().mockResolvedValue({ error: null });
    const eqId = jest.fn(() => ({ eq: eqUser }));
    const update = jest.fn(() => ({ eq: eqId }));
    mockSupabase.from.mockReturnValue({ update });

    await updateBankAccount('bank_1', {
      account_type: 'loan',
      monthly_emi_amount: null,
    });

    expect(update).toHaveBeenCalledWith(expect.objectContaining({
      account_type: 'loan',
      monthly_emi_amount: null,
    }));
    expect(eqId).toHaveBeenCalledWith('id', 'bank_1');
    expect(eqUser).toHaveBeenCalledWith('user_id', 'user_1');
  });

  it('falls back safely when monthly_emi_amount is not deployed yet', async () => {
    const missingColumnError = {
      code: '42703',
      message: 'column bank_accounts.monthly_emi_amount does not exist',
    };
    const failedInsert = jest.fn().mockResolvedValue({ error: missingColumnError });
    const fallbackInsert = jest.fn().mockResolvedValue({ error: null });
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

    mockSupabase.from
      .mockReturnValueOnce({ insert: failedInsert })
      .mockReturnValueOnce({ insert: fallbackInsert });

    await addBankAccount(loanAccountPayload());

    expect(failedInsert).toHaveBeenCalledWith(expect.objectContaining({
      monthly_emi_amount: 5000,
    }));
    expect(fallbackInsert).toHaveBeenCalledWith(expect.not.objectContaining({
      monthly_emi_amount: expect.anything(),
    }));
    expect(warnSpy).toHaveBeenCalledWith(
      '[Accounts] Monthly EMI field unavailable; saving account without EMI amount',
      { table: 'bank_accounts', code: '42703' }
    );
    warnSpy.mockRestore();
  });

  it('does not hide monthly EMI validation errors behind missing-column fallback', async () => {
    const constraintError = {
      code: '23514',
      message: 'violates check constraint "bank_accounts_monthly_emi_amount_nonnegative"',
    };
    const insert = jest.fn().mockResolvedValue({ error: constraintError });
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    mockSupabase.from.mockReturnValue({ insert });

    await expect(addBankAccount(loanAccountPayload({ monthly_emi_amount: -1 })))
      .rejects.toEqual(constraintError);

    expect(insert).toHaveBeenCalledTimes(1);
    expect(mockSupabase.from).toHaveBeenCalledTimes(1);
    errorSpy.mockRestore();
  });
});
