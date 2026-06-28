import AsyncStorage from '@react-native-async-storage/async-storage';
import EncryptedStorage from 'react-native-encrypted-storage';
import { supabase } from '../core';
import {
  ACCOUNT_DELETION_COPY,
  ACCOUNT_DELETION_CASCADE_TABLES,
  ACCOUNT_DELETION_COVERED_TABLES,
  ACCOUNT_DELETION_DIRECT_TABLES,
  ACCOUNT_DELETION_LOCAL_KEYS,
  AUTH_USER_DELETION_IMPLEMENTED,
  PLACE_PHOTOS_BUCKET,
  AccountDataDeletionError,
  deleteCurrentUserAppData,
  exportUserDataBeforeDeletion,
} from './accountDeletion';
import {
  OFFLINE_TX_QUEUE_BASE_KEY,
  getUserScopedQueueKey,
} from './userScopedQueues';

jest.mock('../core', () => ({
  supabase: {
    auth: {
      getUser: jest.fn(),
      signOut: jest.fn(),
    },
    storage: {
      from: jest.fn(),
    },
    from: jest.fn(),
  },
}));

const EXPECTED_USER_DATA_TABLES = [
  'profiles',
  'debt_freedom_settings',
  'bank_accounts',
  'transactions',
  'transaction_evidence',
  'income_review_decisions',
  'user_accounts',
  'credit_cards',
  'cc_transactions',
  'loans',
  'emi_payments',
  'people_ledger',
  'people_ledger_payments',
  'places',
  'vault_items',
  'balance_snapshots',
  'debit_cards',
  'account_app_mappings',
  'detected_accounts',
  'credit_card_statements',
];

describe('whole-account app-data deletion', () => {
  const tableDeletes: Array<{ table: string; column: string; userId: string }> = [];
  const listPhotos = jest.fn();
  const removePhotos = jest.fn();

  beforeEach(async () => {
    await AsyncStorage.clear();
    jest.clearAllMocks();
    tableDeletes.length = 0;

    (supabase.auth.getUser as jest.Mock).mockResolvedValue({
      data: { user: { id: 'user_a' } },
    });
    (supabase.auth.signOut as jest.Mock).mockResolvedValue({ error: null });
    listPhotos.mockResolvedValue({
      data: [{ name: 'photo-one.jpg' }, { name: 'photo-two.jpg' }],
      error: null,
    });
    removePhotos.mockResolvedValue({ error: null });
    (supabase.storage.from as jest.Mock).mockReturnValue({
      list: listPhotos,
      remove: removePhotos,
    });
    (supabase.from as jest.Mock).mockImplementation((table: string) => ({
      delete: () => ({
        eq: async (column: string, userId: string) => {
          tableDeletes.push({ table, column, userId });
          return { error: null };
        },
      }),
    }));
  });

  it('covers every current user-data table from the SQL surface', () => {
    expect([...ACCOUNT_DELETION_COVERED_TABLES].sort()).toEqual([...EXPECTED_USER_DATA_TABLES].sort());
    expect(ACCOUNT_DELETION_CASCADE_TABLES).toEqual([
      { table: 'people_ledger_payments', deletedWith: 'people_ledger' },
    ]);
  });

  it('keeps child deletes before their parents', () => {
    const tables = ACCOUNT_DELETION_DIRECT_TABLES.map(step => step.table);
    type TableName = typeof ACCOUNT_DELETION_DIRECT_TABLES[number]['table'];
    const expectBefore = (child: TableName, parent: TableName) => {
      expect(tables.indexOf(child)).toBeLessThan(tables.indexOf(parent));
    };

    expectBefore('income_review_decisions', 'transaction_evidence');
    expectBefore('income_review_decisions', 'transactions');
    expectBefore('transaction_evidence', 'transactions');
    expectBefore('credit_card_statements', 'credit_cards');
    expectBefore('cc_transactions', 'credit_cards');
    expectBefore('emi_payments', 'loans');
    expectBefore('people_ledger', 'profiles');
    expectBefore('debit_cards', 'bank_accounts');
    expectBefore('transactions', 'bank_accounts');
  });

  it('removes current-user photos, owned rows, local caches, and current-user queues before signing out', async () => {
    await AsyncStorage.multiSet([
      ['cache_transactions', 'cached transactions'],
      ['cache_ledger_payments:ledger_a', 'cached payments'],
      ['app_user_id', 'user_a'],
      ['bank_auto_detection_result', 'cached bank scan'],
      ['bank_auto_detection_date', '2026-06-03'],
      ['debug_bug_reports', 'cached reports'],
      ['data_export_user_a_123', '{"tables":{"transactions":[{"amount":1}]}}'],
      [OFFLINE_TX_QUEUE_BASE_KEY, 'legacy queue'],

      [getUserScopedQueueKey(OFFLINE_TX_QUEUE_BASE_KEY, 'user_a'), JSON.stringify([{ queueOwnerId: 'user_a' }])],
      [getUserScopedQueueKey(OFFLINE_TX_QUEUE_BASE_KEY, 'user_b'), JSON.stringify([{ queueOwnerId: 'user_b' }])],
    ]);

    await deleteCurrentUserAppData();

    expect(supabase.storage.from).toHaveBeenCalledWith(PLACE_PHOTOS_BUCKET);
    expect(listPhotos).toHaveBeenCalledWith('user_a', { limit: 100, offset: 0 });
    expect(removePhotos).toHaveBeenCalledWith([
      'user_a/photo-one.jpg',
      'user_a/photo-two.jpg',
    ]);
    expect(tableDeletes).toEqual(ACCOUNT_DELETION_DIRECT_TABLES.map(step => ({
      table: step.table,
      column: step.filterColumn,
      userId: 'user_a',
    })));
    expect(supabase.auth.signOut).toHaveBeenCalledTimes(1);

    for (const key of ACCOUNT_DELETION_LOCAL_KEYS) {
      expect(await AsyncStorage.getItem(key)).toBeNull();
    }
    expect(await AsyncStorage.getItem('cache_transactions')).toBeNull();
    expect(await AsyncStorage.getItem('cache_ledger_payments:ledger_a')).toBeNull();
    expect(await AsyncStorage.getItem('data_export_user_a_123')).toBeNull();
    expect(await AsyncStorage.getItem(OFFLINE_TX_QUEUE_BASE_KEY)).toBeNull();
    expect(EncryptedStorage.removeItem).toHaveBeenCalledWith('vault:data-key:v2:user_a');

    expect(await AsyncStorage.getItem(getUserScopedQueueKey(OFFLINE_TX_QUEUE_BASE_KEY, 'user_a'))).toBeNull();
    expect(await AsyncStorage.getItem(getUserScopedQueueKey(OFFLINE_TX_QUEUE_BASE_KEY, 'user_b'))).not.toBeNull();
  });

  it('states that Auth user deletion is not implemented and uses honest UI copy', () => {
    expect(AUTH_USER_DELETION_IMPLEMENTED).toBe(false);
    expect(ACCOUNT_DELETION_COPY.confirmTitle).toBe('Delete App Data?');
    expect(ACCOUNT_DELETION_COPY.confirmMessage).toContain('Your sign-in account is not deleted automatically.');
    expect(ACCOUNT_DELETION_COPY.successMessage).toContain('Contact support to remove the remaining sign-in account.');
    expect(ACCOUNT_DELETION_COPY.failureMessage).toContain('Some app data may already be deleted.');
    expect(ACCOUNT_DELETION_COPY.dangerButton).toBe('Delete App Data');
  });

  it('does not allow plaintext financial export into AsyncStorage before deletion', async () => {
    await expect(exportUserDataBeforeDeletion('user_a')).rejects.toEqual(
      new AccountDataDeletionError('plaintext-export-disabled'),
    );
    const keys = await AsyncStorage.getAllKeys();
    expect(keys.some(key => key.startsWith('data_export_'))).toBe(false);
  });

  it('stops safely when storage cleanup fails without logging raw errors', async () => {
    const logSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    listPhotos.mockResolvedValue({
      data: null,
      error: { message: 'private@example.com raw storage failure' },
    });

    try {
      await expect(deleteCurrentUserAppData()).rejects.toEqual(
        new AccountDataDeletionError('storage-list'),
      );
      expect(supabase.from).not.toHaveBeenCalled();
      expect(supabase.auth.signOut).not.toHaveBeenCalled();
      expect(JSON.stringify(logSpy.mock.calls)).not.toContain('private@example.com');
    } finally {
      logSpy.mockRestore();
    }
  });

  it('reports a structural partial failure and does not continue deleting parent tables', async () => {
    (supabase.from as jest.Mock).mockImplementation((table: string) => ({
      delete: () => ({
        eq: async (column: string, userId: string) => {
          tableDeletes.push({ table, column, userId });
          return {
            error: table === 'transactions'
              ? { message: 'private@example.com raw table failure' }
              : null,
          };
        },
      }),
    }));

    await expect(deleteCurrentUserAppData()).rejects.toEqual(
      new AccountDataDeletionError('table:transactions'),
    );
    expect(tableDeletes.map(step => step.table)).toEqual([
      'income_review_decisions',
      'transaction_evidence',
      'transactions',
    ]);
    expect(supabase.auth.signOut).not.toHaveBeenCalled();
  });
});
