/* eslint-env jest, node */

const fs = require('fs');
const path = require('path');

function readSqlFile(fileName) {
  return fs.readFileSync(path.join(__dirname, '..', '..', '..', fileName), 'utf8');
}

describe('detected account review RPC SQL', () => {
  const sql = readSqlFile('supabase_detected_accounts_rpc.sql');
  const lowerSql = sql.toLowerCase();

  it('defines the atomic review RPC functions', () => {
    expect(sql).toContain('CREATE OR REPLACE FUNCTION confirm_detected_bank_account');
    expect(sql).toContain('CREATE OR REPLACE FUNCTION confirm_detected_credit_card');
    expect(sql).toContain('CREATE OR REPLACE FUNCTION confirm_detected_debit_card');
    expect(sql).toContain('CREATE OR REPLACE FUNCTION merge_detected_account');
    expect(sql).toContain('CREATE OR REPLACE FUNCTION ignore_detected_account_rpc');
    expect(sql).toContain('RETURNS TABLE(owner_id uuid, status text)');
  });

  it('locks detected rows and checks the authenticated owner', () => {
    expect((sql.match(/FOR UPDATE/g) || []).length).toBeGreaterThanOrEqual(8);
    expect(sql).toContain('auth.uid()');
    expect(sql).toContain('user_id = v_user_id');
    expect(sql).toContain("RAISE EXCEPTION 'Authentication required'");
  });

  it('keeps function security constrained without weakening RLS', () => {
    expect(sql).toContain('SECURITY INVOKER');
    if (/SECURITY DEFINER/i.test(sql)) {
      expect(sql).toContain('SET search_path = public, pg_temp');
    }
    expect(sql).toContain('REVOKE ALL ON FUNCTION confirm_detected_bank_account');
    expect(sql).toContain('GRANT EXECUTE ON FUNCTION confirm_detected_bank_account');
    expect(sql).not.toMatch(/^\s*EXECUTE\s+/im);
  });

  it('blocks duplicate owner creation and handles idempotent statuses', () => {
    expect(sql).toContain('FROM bank_accounts');
    expect(sql).toContain('FROM credit_cards');
    expect(sql).toContain('FROM debit_cards');
    expect(sql).toContain("account_type NOT IN ('credit_card', 'loan')");
    expect(sql).toContain('last_4_digits = v_card_last4');
    expect(sql).toContain('bank_account_id = p_bank_account_id');
    expect(sql).toContain("v_detection.status IN ('confirmed', 'merged')");
    expect(sql).toContain("v_detection.status = 'ignored'");
    expect(sql).toContain("RETURN QUERY SELECT v_detection.matched_owner_id, v_detection.status");
  });

  it('serializes duplicate create checks with transaction advisory locks', () => {
    expect(sql).toContain('pg_advisory_xact_lock');
    expect(sql).toContain('detected_bank_account:');
    expect(sql).toContain('detected_credit_card:');
    expect(sql).toContain('detected_debit_card:');
  });

  it('validates last4-only inputs and supported account/card types', () => {
    expect(sql).toContain("v_account_last4 !~ '^[0-9]{4}$'");
    expect(sql).toContain("v_card_last4 !~ '^[0-9]{4}$'");
    expect(sql).toContain("v_account_type NOT IN ('savings', 'current')");
    expect(sql).toContain("v_detection.detection_type = 'loan'");
  });

  it('creates only safe compatible snapshots and no fake financial rows', () => {
    expect(sql).toContain('INSERT INTO balance_snapshots');
    expect(sql).toContain("jsonb_build_object(\n          'source', v_detection.source,\n          'kind', 'detected_account_confirmation'");
    expect(sql).toContain("'hash', v_source_snapshot.raw_source_metadata->>'hash'");
    expect(sql).toContain("'len', v_source_snapshot.raw_source_metadata->>'len'");
    expect(sql).toContain("jsonb_build_object('source', v_detection.source, 'kind', 'detected_account_merge')");
    expect(lowerSql).not.toMatch(/insert\s+into\s+transactions\b/);
    expect(lowerSql).not.toMatch(/insert\s+into\s+cc_transactions\b/);
    expect(lowerSql).not.toMatch(/insert\s+into\s+emi_payments\b/);
    expect(lowerSql).not.toMatch(/insert\s+into\s+loans\b/);
  });

  it('qualifies snapshot duplicate checks to avoid RPC return-column ambiguity', () => {
    expect(sql).toContain('FROM balance_snapshots bs');
    expect(sql).not.toMatch(/\bAND\s+owner_id\s*=/);
    expect(sql).not.toMatch(/\bWHERE\s+owner_id\s*=/);
  });

  it('does not return or copy raw source metadata', () => {
    const returnQueryLines = lowerSql
      .split('\n')
      .filter(line => line.includes('return query'));
    expect(returnQueryLines.join('\n')).not.toContain('raw_source_metadata');
    expect(lowerSql).not.toContain('v_detection.raw_source_metadata');
    expect(lowerSql).not.toContain('raw_sms');
    expect(lowerSql).not.toContain('notification body');
  });
});
