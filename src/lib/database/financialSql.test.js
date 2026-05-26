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
