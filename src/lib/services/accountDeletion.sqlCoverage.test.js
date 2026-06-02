const fs = require('fs');
const path = require('path');

describe('whole-account deletion SQL-surface coverage', () => {
  const service = fs.readFileSync(path.join(__dirname, 'accountDeletion.ts'), 'utf8');
  const sql = fs.readFileSync(path.join(__dirname, '../../../supabase-fresh-setup.sql'), 'utf8');
  const expectedTables = [
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

  it('keeps every current SQL table represented in the deletion manifest', () => {
    for (const table of expectedTables) {
      expect(sql).toContain(`CREATE TABLE IF NOT EXISTS ${table} (`);
      expect(service).toContain(`table: '${table}'`);
    }
  });

  it('documents ledger payments as a child-table cascade', () => {
    expect(sql).toContain('ledger_id uuid NOT NULL REFERENCES people_ledger(id) ON DELETE CASCADE');
    expect(service).toContain("{ table: 'people_ledger_payments', deletedWith: 'people_ledger' }");
  });
});
