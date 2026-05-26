import { supabase } from '../core';
import { addEMIPayment, calculateEMIComponents } from './financial';

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
