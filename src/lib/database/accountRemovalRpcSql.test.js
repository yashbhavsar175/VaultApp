/* eslint-env jest, node */

const fs = require('fs');
const path = require('path');

function readSqlFile(fileName) {
  return fs.readFileSync(path.join(__dirname, '..', '..', '..', fileName), 'utf8');
}

describe('account removal RPC SQL', () => {
  const sql = readSqlFile('supabase_account_removal_rpc.sql');
  const lowerSql = sql.toLowerCase();

  it('defines one authenticated RLS-scoped owner delete RPC', () => {
    expect(sql).toContain('CREATE OR REPLACE FUNCTION hard_delete_financial_owner_if_safe');
    expect(sql).toContain('auth.uid()');
    expect(sql).toContain('SECURITY INVOKER');
    expect(sql).toContain('SET search_path = public, pg_temp');
    expect(sql).toContain("RAISE EXCEPTION 'Authentication required'");
    expect(sql).toContain('REVOKE ALL ON FUNCTION hard_delete_financial_owner_if_safe');
    expect(sql).toContain('GRANT EXECUTE ON FUNCTION hard_delete_financial_owner_if_safe');
  });

  it('locks the owner before checking dependencies and rejects unsupported types', () => {
    expect((sql.match(/FOR UPDATE/g) || []).length).toBe(3);
    expect(sql).toContain("p_owner_type = 'bank_account'");
    expect(sql).toContain("p_owner_type = 'credit_card'");
    expect(sql).toContain("p_owner_type = 'debit_card'");
    expect(sql).toContain("RAISE EXCEPTION 'Unsupported account removal owner type'");
  });

  it('checks every linked history and provenance table before deleting', () => {
    for (const tableName of [
      'transactions',
      'transaction_evidence',
      'balance_snapshots',
      'credit_card_statements',
      'cc_transactions',
      'debit_cards',
      'account_app_mappings',
      'detected_accounts',
    ]) {
      expect(lowerSql).toContain(`from ${tableName}`);
    }
    expect(sql).toContain('v_has_stored_balance');
    expect(sql).toContain('coalesce(ba.balance, 0) <> 0 OR coalesce(ba.starting_balance, 0) <> 0');
    expect(sql).toContain('coalesce(cc.current_outstanding, 0) <> 0');
  });

  it('deletes only the selected owner row and never financial history rows', () => {
    expect(lowerSql).toMatch(/delete from bank_accounts\b/);
    expect(lowerSql).toMatch(/delete from credit_cards\b/);
    expect(lowerSql).toMatch(/delete from debit_cards\b/);
    expect(lowerSql).not.toMatch(/delete from transactions\b/);
    expect(lowerSql).not.toMatch(/delete from transaction_evidence\b/);
    expect(lowerSql).not.toMatch(/delete from balance_snapshots\b/);
    expect(lowerSql).not.toMatch(/delete from credit_card_statements\b/);
    expect(lowerSql).not.toMatch(/delete from cc_transactions\b/);
    expect(lowerSql).not.toMatch(/delete from account_app_mappings\b/);
    expect(lowerSql).not.toMatch(/delete from detected_accounts\b/);
  });
});
