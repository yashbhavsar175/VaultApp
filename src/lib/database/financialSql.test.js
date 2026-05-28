/* eslint-env jest, node */

const fs = require('fs');
const path = require('path');

function readSqlFile(fileName) {
  return fs.readFileSync(path.join(__dirname, '..', '..', '..', fileName), 'utf8');
}

describe('EMI accounting SQL', () => {
  it.each([
    'supabase-fresh-setup.sql',
    'supabase_loans_tables.sql',
    'supabase_emi_accounting_fix.sql',
  ])('%s reduces outstanding by principal component instead of total EMI', fileName => {
    const sql = readSqlFile(fileName);

    expect(sql).toContain('v_new_principal := COALESCE(NEW.principal_component, NEW.amount_paid);');
    expect(sql).toContain('v_old_principal := COALESCE(OLD.principal_component, OLD.amount_paid);');
    expect(sql).toContain('AFTER INSERT OR UPDATE OR DELETE ON emi_payments');
    expect(sql).toContain('current_outstanding = GREATEST(current_outstanding - v_new_principal, 0)');
    expect(sql).toContain('current_outstanding = current_outstanding + v_old_principal');
    expect(sql).not.toContain('current_outstanding = GREATEST(current_outstanding - NEW.amount_paid, 0)');
    expect(sql).not.toContain('current_outstanding = current_outstanding + OLD.amount_paid');
  });

  it('adds reference support for future EMI duplicate detection', () => {
    const sql = readSqlFile('supabase_emi_accounting_fix.sql');

    expect(sql).toContain('ADD COLUMN IF NOT EXISTS reference_number text');
    expect(sql).toContain('idx_emi_payments_reference');
  });
});

describe('transfer accounting SQL', () => {
  it.each([
    'supabase-fresh-setup.sql',
    'supabase-self-transfer-enhancement.sql',
    'supabase_transfer_accounting_fix.sql',
  ])('%s uses reversible, user-scoped transfer balance movement', fileName => {
    const sql = readSqlFile(fileName);

    expect(sql).toContain('CREATE OR REPLACE FUNCTION update_bank_balances_on_transfer()');
    expect(sql).toContain('AFTER INSERT OR UPDATE OR DELETE ON transactions');
    expect(sql).toContain("OLD.type = 'transfer'");
    expect(sql).toContain("NEW.type = 'transfer'");
    expect(sql).toContain('COALESCE(OLD.is_transfer_pending, false) = false');
    expect(sql).toContain('COALESCE(NEW.is_transfer_pending, false) = false');
    expect(sql).toContain('SET balance = COALESCE(balance, starting_balance) + OLD.amount');
    expect(sql).toContain('SET balance = COALESCE(balance, starting_balance) - OLD.amount');
    expect(sql).toContain('SET balance = COALESCE(balance, starting_balance) - NEW.amount');
    expect(sql).toContain('SET balance = COALESCE(balance, starting_balance) + NEW.amount');
    expect(sql).toContain('AND user_id = OLD.user_id');
    expect(sql).toContain('AND user_id = NEW.user_id');
    expect(sql).toContain('NEW.from_account_id = NEW.to_account_id');
    expect(sql).toContain('SELECT COUNT(*) INTO v_owned_count');
    expect(sql).toContain('Transfer accounts must belong to the transaction user');
    expect(sql).not.toContain('WHERE id = NEW.from_account_id;');
    expect(sql).not.toContain('WHERE id = NEW.to_account_id;');

    expect(sql.indexOf("IF TG_OP IN ('UPDATE', 'DELETE')")).toBeLessThan(
      sql.indexOf("IF TG_OP IN ('INSERT', 'UPDATE')")
    );
  });

  it('adds duplicate readiness indexes for transfer posting', () => {
    const sql = readSqlFile('supabase_transfer_accounting_fix.sql');

    expect(sql).toContain('idx_transactions_transfer_match');
    expect(sql).toContain('idx_transactions_transfer_accounts');
    expect(sql).toContain('ON transactions(user_id, from_account_id, to_account_id, amount, created_at DESC)');
  });
});

describe('refund foundation SQL', () => {
  it.each([
    'supabase-fresh-setup.sql',
    'supabase_refund_foundation.sql',
  ])('%s supports linked refund transactions', fileName => {
    const sql = readSqlFile(fileName);

    expect(sql).toContain("'refund'");
    expect(sql).toContain('refund_of_transaction_id uuid');
    expect(sql).toContain('transactions_refund_of_transaction_id_fkey');
    expect(sql).toContain('FOREIGN KEY (refund_of_transaction_id) REFERENCES transactions(id) NOT VALID');
    expect(sql).toContain('transactions_refund_amount_positive');
    expect(sql).toContain('transactions_refund_requires_link');
    expect(sql).toContain('transactions_refund_link_only_for_refund');
    expect(sql).toContain('idx_transactions_refund_link');
    expect(sql).toContain('idx_transactions_refund_reference');
    expect(sql).toContain('idx_transactions_refund_duplicate');
    expect(sql).toContain('CREATE OR REPLACE FUNCTION validate_refund_transaction_link()');
    expect(sql).toContain('DROP TRIGGER IF EXISTS trigger_validate_refund_transaction_link ON transactions');
    expect(sql).toContain('BEFORE INSERT OR UPDATE ON transactions');
  });

  it('validates refund links against same-user expense rows in SQL', () => {
    const sql = readSqlFile('supabase_refund_foundation.sql');

    expect(sql).toContain("IF NEW.type = 'refund' THEN");
    expect(sql).toContain('NEW.amount IS NULL OR NEW.amount <= 0');
    expect(sql).toContain('NEW.refund_of_transaction_id IS NULL');
    expect(sql).toContain('SELECT user_id, type');
    expect(sql).toContain('v_original_user <> NEW.user_id');
    expect(sql).toContain("v_original_type <> 'expense'");
    expect(sql).toContain('Only refund transactions can link to an original transaction');
  });

  it.each([
    'supabase-fresh-setup.sql',
    'supabase-migration-lent-borrowed.sql',
    'supabase_add_transfer_type.sql',
    'supabase-self-transfer-enhancement.sql',
    'supabase-setup.sql',
    'supabase_transfer_accounting_fix.sql',
    'supabase_refund_foundation.sql',
  ])('%s keeps refund in the transaction type check', fileName => {
    const sql = readSqlFile(fileName);

    expect(sql).toContain("'income', 'expense', 'investment', 'emi', 'lent', 'borrowed', 'transfer', 'refund'");
  });
});

describe('raw SMS privacy backfill SQL', () => {
  it('redacts only historical raw_sms and uses the app-compatible FNV hash helper', () => {
    const sql = readSqlFile('supabase_raw_sms_privacy_backfill.sql');

    expect(sql).toContain('create or replace function pg_temp.task24f_fnv1a_32');
    expect(sql).toContain('hash_value bigint := 2166136261');
    expect(sql).toContain('* 16777619');
    expect(sql).toContain('pg_temp.task24f_fnv1a_32(raw_sms)');
    expect(sql).toContain("raw_sms !~ '^redacted_(sms|notification)\\s'");
    expect(sql).toContain('update public.transactions');
    expect(sql).toContain('set raw_sms = concat(');
    expect(sql).not.toContain('md5(');
    expect(sql).not.toContain('reference_number =');
    expect(sql).not.toContain('amount =');
    expect(sql).not.toContain('note =');
  });
});
