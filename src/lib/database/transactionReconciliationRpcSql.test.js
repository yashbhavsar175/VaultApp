/* eslint-env jest, node */

const fs = require('fs');
const path = require('path');

function readSqlFile(fileName) {
  return fs.readFileSync(path.join(__dirname, '..', '..', '..', fileName), 'utf8');
}

describe('transaction reconciliation confirmed match RPC SQL', () => {
  const sql = readSqlFile('supabase_transaction_reconciliation_rpc.sql');
  const lowerSql = sql.toLowerCase();

  it('defines one atomic authenticated RPC and locks the target rows', () => {
    expect(sql).toContain('CREATE OR REPLACE FUNCTION confirm_transaction_account_match');
    expect(sql).toContain('RETURNS TABLE(transaction_id uuid, status text)');
    expect(sql).toContain('auth.uid()');
    expect((sql.match(/FOR UPDATE/g) || []).length).toBeGreaterThanOrEqual(5);
    expect(sql).toContain("RAISE EXCEPTION 'Authentication required'");
    expect(sql).toContain('SECURITY INVOKER');
    expect(sql).toContain('SET search_path = public, pg_temp');
  });

  it('adds durable owner identity for idempotency across owner tables', () => {
    expect(sql).toContain('ADD COLUMN IF NOT EXISTS account_match_owner_type text');
    expect(sql).toContain('ADD COLUMN IF NOT EXISTS account_match_owner_id uuid');
    expect(sql).toContain("account_match_owner_type IN ('bank_account', 'credit_card', 'debit_card')");
    expect(sql).toContain('idx_transactions_account_match_owner');
  });

  it('validates owner and evidence ownership before linking', () => {
    expect(sql).toContain('FROM bank_accounts ba');
    expect(sql).toContain('FROM credit_cards cc');
    expect(sql).toContain('FROM debit_cards dc');
    expect(sql).toContain('FROM transaction_evidence te');
    expect(sql).toContain('te.user_id = v_user_id');
    expect(sql).toContain('te.id = ANY(p_evidence_ids)');
    expect(sql).toContain('v_owned_evidence_count <> v_requested_evidence_count');
  });

  it('rejects UPI-only, missing-last4, conflicting, and protected-type attaches', () => {
    expect(sql).toContain('UPI-only evidence cannot confirm an account match');
    expect(sql).toContain('Exact confidence requires same reference and bank or card last4 proof');
    expect(sql).toContain('High confidence requires amount, time, and bank or card last4 proof');
    expect(sql).toContain('Conflicting bank or card evidence requires manual review');
    expect(sql).toContain("v_transaction.type IN ('transfer', 'refund', 'emi')");
    expect(sql).toContain("te.source_type = 'sms'");
  });

  it('checks compatibility and safely handles idempotent or different-owner retries', () => {
    expect(sql).toContain('Evidence is not compatible with the selected transaction');
    expect(sql).toContain('AND NOT coalesce((\n        te.transaction_id = v_transaction.id');
    expect(sql).toContain('      ), false)');
    expect(sql).toContain('Evidence is already linked to a different transaction');
    expect(sql).toContain('v_transaction.account_match_owner_type = v_owner_type');
    expect(sql).toContain('v_transaction.account_match_owner_id = p_owner_id');
    expect(sql).toContain('v_all_evidence_already_linked');
    expect(sql).toContain('Transaction is linked to a different owner; manual review required');
  });

  it('updates only existing transaction match and evidence link fields', () => {
    expect(sql).toContain('UPDATE transaction_evidence te');
    expect(sql).toContain("match_status = 'linked'");
    expect(sql).toContain('confidence_level = v_confidence');
    expect(sql).toContain('match_reason_code = v_reason');
    expect(sql).toContain('UPDATE transactions t');
    expect(sql).toContain("account_match_status = 'manual_confirmed'");
    expect(sql).toContain('primary_evidence_id = v_primary_evidence_id');
    expect(lowerSql).not.toMatch(/insert\s+into\s+transactions\b/);
    expect(lowerSql).not.toMatch(/insert\s+into\s+cc_transactions\b/);
    expect(lowerSql).not.toMatch(/insert\s+into\s+emi_payments\b/);
    expect(lowerSql).not.toMatch(/insert\s+into\s+balance_snapshots\b/);
    expect(lowerSql).not.toMatch(/delete\s+from\b/);
    expect(lowerSql).not.toMatch(/update\s+bank_accounts\b/);
    expect(lowerSql).not.toMatch(/update\s+credit_cards\b/);
    expect(lowerSql).not.toMatch(/update\s+debit_cards\b/);
    expect(lowerSql).not.toMatch(/update\s+cc_transactions\b/);
    expect(lowerSql).not.toMatch(/update\s+emi_payments\b/);
    expect(sql).not.toMatch(/\n\s*amount\s*=/);
    expect(sql).not.toMatch(/\n\s*type\s*=/);
    expect(sql).not.toMatch(/\n\s*category\s*=/);
  });

  it('keeps execution scoped to authenticated users and returns no sensitive metadata', () => {
    expect(sql).toContain('REVOKE ALL ON FUNCTION confirm_transaction_account_match');
    expect(sql).toContain('GRANT EXECUTE ON FUNCTION confirm_transaction_account_match');
    expect(sql).toContain('TO authenticated');
    expect(lowerSql).not.toContain('security definer');
    expect(lowerSql).not.toContain('raw_source_metadata');
    expect(lowerSql).not.toContain('raw_sms');
    expect(lowerSql).not.toMatch(/^\s*execute\s+/im);
  });

  it('wires confirmation only through the explicit proposal UI, not runtime processors', () => {
    const root = path.join(__dirname, '..', '..', '..');
    expect(fs.readFileSync(
      path.join(root, 'src', 'screens', 'transactions', 'ReconciliationProposalsScreen.tsx'),
      'utf8'
    )).toContain('transactionReconciliationActions');

    for (const fileName of [
      path.join('src', 'lib', 'processors', 'TransactionProcessors.ts'),
      path.join('src', 'lib', 'services', 'notifications.ts'),
      path.join('src', 'lib', 'services', 'smsParser.ts'),
    ]) {
      expect(fs.readFileSync(path.join(root, fileName), 'utf8'))
        .not.toContain('transactionReconciliationActions');
    }
  });
});
