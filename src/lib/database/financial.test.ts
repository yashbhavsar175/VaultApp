import { supabase } from '../core';
import { addEMIPayment, calculateEMIComponents, getBankAccounts, getCreditCards } from './financial';

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
