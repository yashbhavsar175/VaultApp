/* eslint-env jest, node */

const fs = require('fs');
const path = require('path');

function readSqlFile(fileName) {
  return fs.readFileSync(path.join(__dirname, '..', '..', '..', fileName), 'utf8');
}

describe('account archive SQL', () => {
  it.each([
    'supabase_account_archive_fields.sql',
    'supabase-fresh-setup.sql',
  ])('%s adds archive fields for both owner tables without weakening RLS', fileName => {
    const sql = readSqlFile(fileName);
    const lowerSql = sql.toLowerCase();

    expect(lowerSql).toContain('is_archived');
    expect(lowerSql).toContain('archived_at');
    expect(lowerSql).toContain('idx_bank_accounts_user_archived');
    expect(lowerSql).toContain('idx_credit_cards_user_archived');
    expect(lowerSql).not.toContain('disable row level security');
    expect(lowerSql).not.toContain('grant all on table');
  });

  it('keeps standalone bank and credit-card setup files aligned with archive fields', () => {
    const bankSql = readSqlFile('supabase_bank_accounts_table.sql').toLowerCase();
    const cardSql = readSqlFile('supabase_credit_cards_tables.sql').toLowerCase();

    expect(bankSql).toContain('is_archived');
    expect(bankSql).toContain('archived_at');
    expect(bankSql).toContain('idx_bank_accounts_user_archived');
    expect(cardSql).toContain('is_archived');
    expect(cardSql).toContain('archived_at');
    expect(cardSql).toContain('idx_credit_cards_user_archived');
  });

  it('keeps the migration additive and idempotent', () => {
    const sql = readSqlFile('supabase_account_archive_fields.sql').toLowerCase();

    expect(sql).toContain('add column if not exists is_archived boolean not null default false');
    expect(sql).toContain('add column if not exists archived_at timestamptz');
    expect(sql).toContain('create index if not exists idx_bank_accounts_user_archived');
    expect(sql).toContain('create index if not exists idx_credit_cards_user_archived');
    expect(sql).not.toContain('drop table');
    expect(sql).not.toContain('delete from');
  });
});
