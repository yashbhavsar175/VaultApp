import { supabase } from '../core';
import { createOrUpdateAccountAppMapping } from './transactionEvidence';
import { recordEstimatedBankBalanceMovementForUser } from './balanceSignalRecorder';
import { emitFinanceDataChanged } from './dataEvents';
import {
  bankHintHash,
  confirmPaymentAppBankAccountMapping,
  extractPaymentAppBankHint,
  recordMappedPaymentAppBalanceEstimateForCurrentUser,
  resolvePaymentAppBankAccountForUser,
} from './paymentAppAccountMappings';

jest.mock('../core', () => ({
  supabase: {
    auth: { getUser: jest.fn() },
    from: jest.fn(),
  },
}));

jest.mock('./transactionEvidence', () => ({
  createOrUpdateAccountAppMapping: jest.fn(async input => ({ id: 'mapping_new', ...input })),
}));

jest.mock('./balanceSignalRecorder', () => ({
  recordEstimatedBankBalanceMovementForUser: jest.fn(async () => null),
}));

jest.mock('./dataEvents', () => ({
  emitFinanceDataChanged: jest.fn(),
}));

const mockedSupabase = supabase as any;
const mockedCreateMapping = createOrUpdateAccountAppMapping as jest.Mock;
const mockedRecordEstimate = recordEstimatedBankBalanceMovementForUser as jest.Mock;
const mockedEmitFinanceDataChanged = emitFinanceDataChanged as jest.Mock;

const tables: Record<string, any[]> = {
  bank_accounts: [],
  account_app_mappings: [],
};

function setupSupabaseMock() {
  mockedSupabase.auth.getUser.mockResolvedValue({ data: { user: { id: 'user_1' } } });
  mockedSupabase.from.mockImplementation((table: string) => {
    const filters: Array<[string, unknown]> = [];
    let limitCount: number | null = null;
    const rows = () => tables[table]
      .filter(row => filters.every(([key, value]) => row[key] === value))
      .slice(0, limitCount || undefined);
    const query: any = {
      select: jest.fn(() => query),
      eq: jest.fn((key: string, value: unknown) => {
        filters.push([key, value]);
        return query;
      }),
      limit: jest.fn((count: number) => {
        limitCount = count;
        return query;
      }),
      maybeSingle: jest.fn(async () => ({ data: rows()[0] || null, error: null })),
      then: (resolve: any, reject: any) => Promise.resolve({ data: rows(), error: null }).then(resolve, reject),
    };
    return query;
  });
}

describe('payment app account mappings', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    tables.bank_accounts = [];
    tables.account_app_mappings = [];
    setupSupabaseMock();
  });

  it('extracts only a safe super.money package and Slice bank hint token', () => {
    const context = extractPaymentAppBankHint(
      'Rs.103.00 received from PRIVATE PERSON. Deposited in your slice bank. Call 9876543210.',
      'money.super.payments'
    );

    expect(context).toEqual({
      sourcePackage: 'money.super.payments',
      sourceLabel: 'Super.money',
      bankHint: 'slice',
      bankHintLabel: 'Slice',
      bankHintHash: bankHintHash('slice'),
    });
    expect(JSON.stringify(context)).not.toContain('PRIVATE PERSON');
    expect(JSON.stringify(context)).not.toContain('9876543210');
  });

  it('returns needs_review when no user-confirmed mapping exists', async () => {
    const result = await resolvePaymentAppBankAccountForUser({
      userId: 'user_1',
      sourcePackage: 'money.super.payments',
      text: 'Rs.103 received. Deposited in your slice bank.',
    });

    expect(result).toEqual(expect.objectContaining({
      bankHint: 'slice',
      mappingStatus: 'needs_review',
    }));
  });

  it('resolves only the current users confirmed mapping to an owned bank account', async () => {
    tables.account_app_mappings.push(
      {
        id: 'mapping_user_2',
        user_id: 'user_2',
        app_package: 'money.super.payments',
        payment_method_hash: bankHintHash('slice'),
        owner_type: 'bank_account',
        owner_id: 'bank_user_2',
        status: 'active',
      },
      {
        id: 'mapping_user_1',
        user_id: 'user_1',
        app_package: 'money.super.payments',
        payment_method_hash: bankHintHash('slice'),
        owner_type: 'bank_account',
        owner_id: 'bank_user_1',
        status: 'active',
      }
    );
    tables.bank_accounts.push({
      id: 'bank_user_1',
      user_id: 'user_1',
      bank_name: 'Slice',
      account_last4: '5235',
      account_type: 'savings',
    });

    const result = await resolvePaymentAppBankAccountForUser({
      userId: 'user_1',
      sourcePackage: 'money.super.payments',
      text: 'Rs.103 received. Deposited in your slice bank.',
    });

    expect(result).toEqual(expect.objectContaining({
      mappingStatus: 'user_confirmed',
      mappedBankAccountId: 'bank_user_1',
      mappedBankAccountLast4: '5235',
      mappedBankName: 'Slice',
    }));
  });

  it('saves a user-confirmed safe hint mapping for an owned account', async () => {
    tables.bank_accounts.push({
      id: 'bank_user_1',
      user_id: 'user_1',
      bank_name: 'Slice',
      account_last4: '5235',
      account_type: 'savings',
    });

    await confirmPaymentAppBankAccountMapping({
      sourcePackage: 'money.super.payments',
      sourceLabel: 'Super.money',
      bankHint: 'slice',
      bankAccountId: 'bank_user_1',
    });

    expect(mockedCreateMapping).toHaveBeenCalledWith(expect.objectContaining({
      app_package: 'money.super.payments',
      app_label: 'Super.money',
      payment_method_hash: bankHintHash('slice'),
      payment_method_masked: 'bank_hint:slice',
      owner_type: 'bank_account',
      owner_id: 'bank_user_1',
      account_last4: '5235',
      confidence_level: 'medium',
    }));
  });

  it('records a mapped estimate only through the safe calculated snapshot helper', async () => {
    mockedRecordEstimate.mockResolvedValueOnce({ id: 'snapshot_1' });

    await expect(recordMappedPaymentAppBalanceEstimateForCurrentUser({
      bankAccountId: 'bank_user_1',
      amount: 103,
      direction: 'credit',
      sourcePackage: 'money.super.payments',
      sourceHash: 'abcdef12',
    })).resolves.toBe(true);

    expect(mockedRecordEstimate).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'user_1',
      bankAccountId: 'bank_user_1',
      amount: 103,
      direction: 'credit',
      sourceType: 'notification',
      reason: 'app_mapping',
    }));
    expect(mockedEmitFinanceDataChanged).toHaveBeenCalledWith({
      areas: ['balances'],
      source: 'review_queue:app_mapping_balance_estimate',
    });
  });

  it('does not invent a mapped estimate when the balance helper has no previous basis', async () => {
    mockedRecordEstimate.mockResolvedValueOnce(null);

    await expect(recordMappedPaymentAppBalanceEstimateForCurrentUser({
      bankAccountId: 'bank_user_1',
      amount: 103,
      direction: 'credit',
      sourcePackage: 'money.super.payments',
    })).resolves.toBe(false);

    expect(mockedEmitFinanceDataChanged).not.toHaveBeenCalled();
  });
});
