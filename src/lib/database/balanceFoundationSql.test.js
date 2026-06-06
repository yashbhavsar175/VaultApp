/* eslint-env jest, node */

const fs = require('fs');
const path = require('path');

const SQL_FILES = [
  'supabase_balance_snapshots.sql',
  'supabase_debit_cards.sql',
  'supabase_detected_accounts.sql',
  'supabase_credit_card_statements.sql',
  'supabase-fresh-setup.sql',
];

function readSqlFile(fileName) {
  const rootPath = path.join(__dirname, '..', '..', '..', fileName);
  const archivePath = path.join(__dirname, '..', '..', '..', 'docs', 'sql-archive', fileName);
  return fs.readFileSync(fs.existsSync(rootPath) ? rootPath : archivePath, 'utf8');
}

describe('balance and card foundation SQL', () => {
  it('creates all foundation tables in migration files and fresh setup', () => {
    for (const fileName of SQL_FILES) {
      const sql = readSqlFile(fileName);
      if (fileName === 'supabase_debit_cards.sql') {
        expect(sql).toContain('CREATE TABLE IF NOT EXISTS debit_cards');
      } else if (fileName === 'supabase_detected_accounts.sql') {
        expect(sql).toContain('CREATE TABLE IF NOT EXISTS detected_accounts');
      } else if (fileName === 'supabase_credit_card_statements.sql') {
        expect(sql).toContain('CREATE TABLE IF NOT EXISTS credit_card_statements');
      } else {
        expect(sql).toContain('CREATE TABLE IF NOT EXISTS balance_snapshots');
      }
    }

    const fresh = readSqlFile('supabase-fresh-setup.sql');
    expect(fresh).toContain('CREATE TABLE IF NOT EXISTS balance_snapshots');
    expect(fresh).toContain('CREATE TABLE IF NOT EXISTS debit_cards');
    expect(fresh).toContain('CREATE TABLE IF NOT EXISTS detected_accounts');
    expect(fresh).toContain('CREATE TABLE IF NOT EXISTS credit_card_statements');
  });

  it.each(SQL_FILES)('%s enables RLS and scopes policies to auth.uid() = user_id', fileName => {
    const sql = readSqlFile(fileName);

    if (fileName === 'supabase_balance_snapshots.sql') {
      expect(sql).toContain('ALTER TABLE balance_snapshots ENABLE ROW LEVEL SECURITY');
    }
    if (fileName === 'supabase_debit_cards.sql') {
      expect(sql).toContain('ALTER TABLE debit_cards ENABLE ROW LEVEL SECURITY');
    }
    if (fileName === 'supabase_detected_accounts.sql') {
      expect(sql).toContain('ALTER TABLE detected_accounts ENABLE ROW LEVEL SECURITY');
    }
    if (fileName === 'supabase_credit_card_statements.sql') {
      expect(sql).toContain('ALTER TABLE credit_card_statements ENABLE ROW LEVEL SECURITY');
    }

    expect(sql).toContain('USING (auth.uid() = user_id)');
    expect(sql).toContain('WITH CHECK (auth.uid() = user_id)');
  });

  it('adds useful lookup indexes', () => {
    const allSql = SQL_FILES.map(readSqlFile).join('\n');

    expect(allSql).toContain('idx_balance_snapshots_owner_latest');
    expect(allSql).toContain('idx_balance_snapshots_account_last4');
    expect(allSql).toContain('idx_balance_snapshots_card_last4');
    expect(allSql).toContain('idx_balance_snapshots_source');
    expect(allSql).toContain('idx_debit_cards_unique_bank_card');
    expect(allSql).toContain('idx_detected_accounts_status_type');
    expect(allSql).toContain('idx_credit_card_statements_due_date');
  });

  it('allows multiple debit cards per bank account but blocks duplicate card last4 per account', () => {
    const sql = readSqlFile('supabase_debit_cards.sql');

    expect(sql).toContain('ON debit_cards(user_id, bank_account_id, card_last4)');
    expect(sql).toContain('WHERE bank_account_id IS NOT NULL');
    expect(sql).not.toContain('UNIQUE(user_id, bank_account_id)');
  });

  it('guards linked debit card bank accounts to the same user', () => {
    const sql = readSqlFile('supabase_debit_cards.sql');
    const fresh = readSqlFile('supabase-fresh-setup.sql');

    for (const source of [sql, fresh]) {
      expect(source).toContain('validate_debit_card_bank_account_owner');
      expect(source).toContain('trigger_validate_debit_card_bank_account_owner');
      expect(source).toContain('WHERE id = NEW.bank_account_id');
      expect(source).toContain('AND user_id = NEW.user_id');
    }
  });

  it('guards credit card statement card and snapshot links to the same user', () => {
    const sql = readSqlFile('supabase_credit_card_statements.sql');
    const fresh = readSqlFile('supabase-fresh-setup.sql');

    for (const source of [sql, fresh]) {
      expect(source).toContain('validate_credit_card_statement_owner');
      expect(source).toContain('trigger_validate_credit_card_statement_owner');
      expect(source).toContain('WHERE id = NEW.credit_card_id');
      expect(source).toContain('WHERE id = NEW.source_snapshot_id');
      expect(source).toContain('AND user_id = NEW.user_id');
    }
  });

  it('does not introduce checking as an account type in new foundation SQL', () => {
    for (const fileName of SQL_FILES.filter(name => name !== 'supabase-fresh-setup.sql')) {
      expect(readSqlFile(fileName).toLowerCase()).not.toContain('checking');
    }
  });

  it('documents redacted metadata conventions', () => {
    const allSql = SQL_FILES.map(readSqlFile).join('\n').toLowerCase();

    expect(allSql).toContain('redacted metadata only');
    expect(allSql).toContain('never raw sms');
    expect(allSql).toContain('notification body');
    expect(allSql).toContain('full account/card number');
  });
});
