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
