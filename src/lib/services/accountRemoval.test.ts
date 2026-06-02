import {
  getAccountRemovalImpact,
  hardDeleteOwnerIfSafe,
  restoreArchivedOwner,
  removeOrArchiveOwner,
} from './accountRemoval';
import { supabase } from '../core';
import { emitFinanceDataChanged } from './dataEvents';

jest.mock('../core', () => ({
  supabase: {
    auth: { getUser: jest.fn() },
    from: jest.fn(),
    rpc: jest.fn(),
  },
}));

jest.mock('./dataEvents', () => ({
  emitFinanceDataChanged: jest.fn(),
}));

type Row = Record<string, any>;

const tables: Record<string, Row[]> = {};

class QueryBuilder {
  private filters: Array<(row: Row) => boolean> = [];
  private countMode = false;
  private action: 'select' | 'update' | 'delete' = 'select';
  private payload: Row | null = null;

  constructor(private table: string) {}

  select(_columns?: string, options?: { count?: string; head?: boolean }) {
    this.action = 'select';
    this.countMode = Boolean(options?.count && options?.head);
    return this;
  }

  update(payload: Row) {
    this.action = 'update';
    this.payload = payload;
    return this;
  }

  delete() {
    this.action = 'delete';
    return this;
  }

  eq(column: string, value: unknown) {
    this.filters.push(row => row[column] === value);
    return this;
  }

  maybeSingle() {
    const rows = this.filteredRows();
    return Promise.resolve({ data: rows[0] || null, error: null });
  }

  then(resolve: (value: any) => void, reject?: (reason: unknown) => void) {
    return this.execute().then(resolve, reject);
  }

  private filteredRows() {
    return (tables[this.table] || []).filter(row => this.filters.every(filter => filter(row)));
  }

  private async execute() {
    if (this.action === 'select') {
      const rows = this.filteredRows();
      return this.countMode
        ? { count: rows.length, error: null }
        : { data: rows, error: null };
    }

    if (this.action === 'update') {
      let updated = 0;
      tables[this.table] = (tables[this.table] || []).map(row => {
        if (!this.filters.every(filter => filter(row))) return row;
        updated += 1;
        return { ...row, ...this.payload };
      });
      return { data: updated, error: null };
    }

    const before = tables[this.table] || [];
    tables[this.table] = before.filter(row => !this.filters.every(filter => filter(row)));
    return { data: null, error: null };
  }
}

function resetTables(overrides: Partial<Record<string, Row[]>> = {}) {
  Object.keys(tables).forEach(key => delete tables[key]);
  Object.assign(tables, {
    bank_accounts: [],
    credit_cards: [],
    debit_cards: [],
    transactions: [],
    transaction_evidence: [],
    balance_snapshots: [],
    credit_card_statements: [],
    cc_transactions: [],
    account_app_mappings: [],
    detected_accounts: [],
    ...overrides,
  });
}

describe('account removal safety', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (supabase.auth.getUser as jest.Mock).mockResolvedValue({
      data: { user: { id: 'user_1' } },
    });
    (supabase.from as jest.Mock).mockImplementation((table: string) => new QueryBuilder(table));
    (supabase.rpc as jest.Mock).mockImplementation((_name: string, params: {
      p_owner_type: 'bank_account' | 'credit_card' | 'debit_card';
      p_owner_id: string;
    }) => {
      const table = params.p_owner_type === 'bank_account'
        ? 'bank_accounts'
        : params.p_owner_type === 'credit_card'
          ? 'credit_cards'
          : 'debit_cards';
      tables[table] = tables[table].filter(row => row.id !== params.p_owner_id || row.user_id !== 'user_1');
      return Promise.resolve({ error: null });
    });
    resetTables();
  });

  it('hard deletes an empty temporary credit card without deleting transactions', async () => {
    resetTables({
      credit_cards: [{
        id: 'card_empty',
        user_id: 'user_1',
        last_4_digits: '3030',
      }],
      transactions: [{ id: 'tx_real', user_id: 'user_1', amount: 50 }],
      cc_transactions: [],
    });

    const result = await hardDeleteOwnerIfSafe('credit_card', 'card_empty');

    expect(result.action).toBe('deleted');
    expect(tables.credit_cards).toHaveLength(0);
    expect(tables.transactions).toHaveLength(1);
    expect(tables.cc_transactions).toHaveLength(0);
    expect(supabase.rpc).toHaveBeenCalledWith('hard_delete_financial_owner_if_safe', {
      p_owner_type: 'credit_card',
      p_owner_id: 'card_empty',
    });
    expect(emitFinanceDataChanged).toHaveBeenCalledWith(expect.objectContaining({ areas: ['accounts'] }));
  });

  it('hides a credit card with dependent card transactions instead of deleting history', async () => {
    resetTables({
      credit_cards: [{
        id: 'card_busy',
        user_id: 'user_1',
        last_4_digits: '4444',
        current_outstanding: 250,
        is_archived: false,
      }],
      cc_transactions: [{ id: 'cc_tx_1', user_id: 'user_1', card_id: 'card_busy' }],
    });

    const impact = await getAccountRemovalImpact('credit_card', 'card_busy');

    expect(impact.canHardDelete).toBe(false);
    expect(impact.willArchive).toBe(true);
    expect(impact.counts.ccTransactions).toBe(1);
    const result = await removeOrArchiveOwner('credit_card', 'card_busy');
    expect(result.action).toBe('archived');
    expect(tables.credit_cards).toEqual([
      expect.objectContaining({
        id: 'card_busy',
        current_outstanding: 250,
        is_archived: true,
      }),
    ]);
    expect(tables.cc_transactions).toHaveLength(1);
  });

  it('hides a bank account with linked transactions instead of deleting history', async () => {
    resetTables({
      bank_accounts: [{
        id: 'bank_busy',
        user_id: 'user_1',
        account_last4: '1111',
        balance: 900,
        starting_balance: 900,
        is_archived: false,
      }],
      transactions: [{ id: 'tx_1', user_id: 'user_1', account_id: 'bank_busy' }],
    });

    const impact = await getAccountRemovalImpact('bank_account', 'bank_busy');

    expect(impact.canHardDelete).toBe(false);
    expect(impact.willArchive).toBe(true);
    expect(impact.counts.transactions).toBe(1);
    await expect(hardDeleteOwnerIfSafe('bank_account', 'bank_busy')).rejects.toThrow(/cannot be permanently deleted/);
    await removeOrArchiveOwner('bank_account', 'bank_busy');
    expect(tables.bank_accounts).toEqual([
      expect.objectContaining({
        id: 'bank_busy',
        balance: 900,
        starting_balance: 900,
        is_archived: true,
      }),
    ]);
    expect(tables.transactions).toHaveLength(1);
  });

  it('blocks hard delete for owners that still carry a stored balance', async () => {
    resetTables({
      bank_accounts: [{
        id: 'bank_balance',
        user_id: 'user_1',
        account_last4: '1919',
        balance: 125,
        starting_balance: 0,
      }, {
        id: 'bank_starting_balance',
        user_id: 'user_1',
        account_last4: '1818',
        balance: 0,
        starting_balance: 125,
      }],
      credit_cards: [{
        id: 'card_balance',
        user_id: 'user_1',
        last_4_digits: '2929',
        current_outstanding: 80,
      }],
    });

    const bankImpact = await getAccountRemovalImpact('bank_account', 'bank_balance');
    const bankStartingImpact = await getAccountRemovalImpact('bank_account', 'bank_starting_balance');
    const cardImpact = await getAccountRemovalImpact('credit_card', 'card_balance');

    expect(bankImpact.canHardDelete).toBe(false);
    expect(bankImpact.counts.storedBalances).toBe(1);
    expect(bankStartingImpact.canHardDelete).toBe(false);
    expect(bankStartingImpact.counts.storedBalances).toBe(1);
    expect(cardImpact.canHardDelete).toBe(false);
    expect(cardImpact.counts.storedBalances).toBe(1);
  });

  it('restores hidden bank accounts and credit cards without touching balances', async () => {
    resetTables({
      bank_accounts: [{
        id: 'bank_hidden',
        user_id: 'user_1',
        account_last4: '1234',
        balance: 1200,
        starting_balance: 1000,
        is_archived: true,
        archived_at: '2026-05-31T00:00:00.000Z',
      }],
      credit_cards: [{
        id: 'card_hidden',
        user_id: 'user_1',
        last_4_digits: '5678',
        current_outstanding: 345,
        is_archived: true,
        archived_at: '2026-05-31T00:00:00.000Z',
      }],
    });

    await restoreArchivedOwner('bank_account', 'bank_hidden');
    await restoreArchivedOwner('credit_card', 'card_hidden');

    expect(tables.bank_accounts).toEqual([
      expect.objectContaining({
        id: 'bank_hidden',
        balance: 1200,
        starting_balance: 1000,
        is_archived: false,
        archived_at: null,
      }),
    ]);
    expect(tables.credit_cards).toEqual([
      expect.objectContaining({
        id: 'card_hidden',
        current_outstanding: 345,
        is_archived: false,
        archived_at: null,
      }),
    ]);
  });

  it('restores hidden credit cards without deleting dependent history rows', async () => {
    resetTables({
      credit_cards: [{
        id: 'card_hidden_history',
        user_id: 'user_1',
        last_4_digits: '7788',
        credit_limit: 1000,
        current_outstanding: 400,
        is_archived: true,
        archived_at: '2026-05-31T00:00:00.000Z',
      }],
      cc_transactions: [{
        id: 'cc_tx_restore',
        user_id: 'user_1',
        card_id: 'card_hidden_history',
        amount: 25,
      }],
      balance_snapshots: [{
        id: 'snap_restore',
        user_id: 'user_1',
        owner_type: 'credit_card',
        owner_id: 'card_hidden_history',
        amount: 400,
      }],
      credit_card_statements: [{
        id: 'stmt_restore',
        user_id: 'user_1',
        credit_card_id: 'card_hidden_history',
        total_due: 400,
      }],
      account_app_mappings: [{
        id: 'mapping_restore',
        user_id: 'user_1',
        owner_type: 'credit_card',
        owner_id: 'card_hidden_history',
      }],
    });

    await restoreArchivedOwner('credit_card', 'card_hidden_history');

    expect(tables.credit_cards).toEqual([
      expect.objectContaining({
        id: 'card_hidden_history',
        credit_limit: 1000,
        current_outstanding: 400,
        is_archived: false,
        archived_at: null,
      }),
    ]);
    expect(tables.cc_transactions).toEqual([
      expect.objectContaining({ id: 'cc_tx_restore', card_id: 'card_hidden_history' }),
    ]);
    expect(tables.balance_snapshots).toEqual([
      expect.objectContaining({ id: 'snap_restore', owner_id: 'card_hidden_history' }),
    ]);
    expect(tables.credit_card_statements).toEqual([
      expect.objectContaining({ id: 'stmt_restore', credit_card_id: 'card_hidden_history' }),
    ]);
    expect(tables.account_app_mappings).toEqual([
      expect.objectContaining({ id: 'mapping_restore', owner_id: 'card_hidden_history' }),
    ]);
    expect(emitFinanceDataChanged).toHaveBeenCalledWith(expect.objectContaining({
      areas: ['accounts'],
      source: 'account_archive:restore',
    }));
  });

  it('archives a debit card with dependencies instead of deleting it', async () => {
    resetTables({
      debit_cards: [{
        id: 'debit_busy',
        user_id: 'user_1',
        card_last4: '2222',
        status: 'active',
      }],
      balance_snapshots: [{
        id: 'snap_1',
        user_id: 'user_1',
        owner_type: 'debit_card',
        owner_id: 'debit_busy',
      }],
    });

    const result = await removeOrArchiveOwner('debit_card', 'debit_busy');

    expect(result.action).toBe('archived');
    expect(tables.debit_cards).toEqual([
      expect.objectContaining({ id: 'debit_busy', status: 'inactive' }),
    ]);
    expect(tables.balance_snapshots).toHaveLength(1);
  });

  it('does not expose raw evidence metadata in the impact result', async () => {
    resetTables({
      credit_cards: [{ id: 'card_private', user_id: 'user_1', last_4_digits: '9876' }],
      transaction_evidence: [{
        id: 'evidence_1',
        user_id: 'user_1',
        card_last4: '9876',
        raw_source_metadata: {
          body: 'Card 1234567890129876 OTP 123456 call 9876543210',
        },
      }],
    });

    const impact = await getAccountRemovalImpact('credit_card', 'card_private');
    const serialized = JSON.stringify(impact);

    expect(impact.counts.transactionEvidence).toBe(1);
    expect(serialized).not.toContain('1234567890129876');
    expect(serialized).not.toContain('OTP');
    expect(serialized).not.toContain('9876543210');
  });

  it('blocks hard delete when account app mappings or detected rows still reference the owner', async () => {
    resetTables({
      credit_cards: [{ id: 'card_referenced', user_id: 'user_1', last_4_digits: '5656' }],
      account_app_mappings: [{
        id: 'mapping_1',
        user_id: 'user_1',
        owner_type: 'credit_card',
        owner_id: 'card_referenced',
      }],
      detected_accounts: [{
        id: 'detection_1',
        user_id: 'user_1',
        matched_owner_type: 'credit_card',
        matched_owner_id: 'card_referenced',
      }],
    });

    const impact = await getAccountRemovalImpact('credit_card', 'card_referenced');

    expect(impact.canHardDelete).toBe(false);
    expect(impact.counts.accountAppMappings).toBe(1);
    expect(impact.counts.detectedAccounts).toBe(1);
    await expect(removeOrArchiveOwner('credit_card', 'card_referenced')).resolves.toEqual(
      expect.objectContaining({ action: 'archived' })
    );
    expect(tables.credit_cards).toHaveLength(1);
  });

  it('rejects unsupported runtime owner types without querying or deleting debit cards', async () => {
    resetTables({
      debit_cards: [{ id: 'loan_1', user_id: 'user_1', card_last4: '7878', status: 'active' }],
    });

    await expect(getAccountRemovalImpact('loan' as any, 'loan_1')).rejects.toThrow(/Unsupported/);

    expect(tables.debit_cards).toHaveLength(1);
    expect(supabase.rpc).not.toHaveBeenCalled();
  });
});
