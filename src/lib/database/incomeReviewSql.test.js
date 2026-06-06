/* eslint-env jest, node */

const fs = require('fs');
const path = require('path');

const SQL_FILES = [
  'supabase_income_review_decisions.sql',
  'supabase-fresh-setup.sql',
];

function readSqlFile(fileName) {
  const rootPath = path.join(__dirname, '..', '..', '..', fileName);
  const archivePath = path.join(__dirname, '..', '..', '..', 'docs', 'sql-archive', fileName);
  return fs.readFileSync(fs.existsSync(rootPath) ? rootPath : archivePath, 'utf8');
}

describe('income review decisions SQL', () => {
  it.each(SQL_FILES)('%s creates income_review_decisions with expected columns', fileName => {
    const sql = readSqlFile(fileName);

    expect(sql).toContain('CREATE TABLE IF NOT EXISTS income_review_decisions');
    expect(sql).toContain('id uuid PRIMARY KEY DEFAULT gen_random_uuid()');
    expect(sql).toContain('user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE');
    expect(sql).toContain('transaction_id uuid REFERENCES transactions(id) ON DELETE CASCADE');
    expect(sql).toContain('evidence_id uuid REFERENCES transaction_evidence(id) ON DELETE CASCADE');
    expect(sql).toContain('signal_hash text');
    expect(sql).toContain("decision text NOT NULL CHECK (decision IN ('count_as_income', 'not_income', 'needs_review'))");
    expect(sql).toContain("income_source_type text CHECK (income_source_type IN ('salary', 'gig_work', 'freelance', 'business', 'cash_deposit', 'other'))");
    expect(sql).toContain("confidence text NOT NULL DEFAULT 'user_confirmed' CHECK (confidence IN ('user_confirmed', 'system_suggested'))");
    expect(sql).toContain('reason_code text');
    expect(sql).toContain('reviewed_at timestamptz NOT NULL DEFAULT now()');
  });

  it.each(SQL_FILES)('%s enforces target and unique constraints', fileName => {
    const sql = readSqlFile(fileName);

    expect(sql).toContain('CHECK (transaction_id IS NOT NULL OR evidence_id IS NOT NULL OR signal_hash IS NOT NULL)');
    expect(sql).toContain('idx_income_review_decisions_user_transaction');
    expect(sql).toContain('ON income_review_decisions(user_id, transaction_id)');
    expect(sql).toContain('WHERE transaction_id IS NOT NULL');
    expect(sql).toContain('idx_income_review_decisions_user_evidence');
    expect(sql).toContain('ON income_review_decisions(user_id, evidence_id)');
    expect(sql).toContain('WHERE evidence_id IS NOT NULL');
    expect(sql).toContain('idx_income_review_decisions_user_signal_hash');
    expect(sql).toContain('ON income_review_decisions(user_id, signal_hash)');
    expect(sql).toContain('WHERE signal_hash IS NOT NULL');
  });

  it.each(SQL_FILES)('%s enables RLS with own-row policies only', fileName => {
    const sql = readSqlFile(fileName);

    expect(sql).toContain('ALTER TABLE income_review_decisions ENABLE ROW LEVEL SECURITY');
    expect(sql).toContain('FOR SELECT');
    expect(sql).toContain('FOR INSERT');
    expect(sql).toContain('FOR UPDATE');
    expect(sql).toContain('FOR DELETE');
    expect(sql).toContain('USING (auth.uid() = user_id)');
    expect(sql).toContain('WITH CHECK (auth.uid() = user_id)');
    expect(sql).not.toMatch(/GRANT\s+.*\s+ON\s+income_review_decisions\s+TO\s+(anon|public)/i);
  });

  it.each(SQL_FILES)('%s validates transaction and evidence ownership', fileName => {
    const sql = readSqlFile(fileName);

    expect(sql).toContain('validate_income_review_decision_owner');
    expect(sql).toContain('FROM transactions t');
    expect(sql).toContain('FROM transaction_evidence te');
    expect(sql).toContain('AND t.user_id = NEW.user_id');
    expect(sql).toContain('AND te.user_id = NEW.user_id');
  });

  it('keeps fresh setup aligned with standalone SQL and ordered after evidence setup', () => {
    const standalone = readSqlFile('supabase_income_review_decisions.sql');
    const fresh = readSqlFile('supabase-fresh-setup.sql');

    for (const token of [
      'CREATE TABLE IF NOT EXISTS income_review_decisions',
      'idx_income_review_decisions_user_transaction',
      'set_income_review_decisions_updated_at',
      'trigger_validate_income_review_decision_owner',
    ]) {
      expect(standalone).toContain(token);
      expect(fresh).toContain(token);
    }

    expect(fresh.indexOf('CREATE TABLE IF NOT EXISTS transaction_evidence')).toBeLessThan(
      fresh.indexOf('CREATE TABLE IF NOT EXISTS income_review_decisions')
    );
  });

  it('does not introduce raw text/body columns or broad public access', () => {
    const sql = readSqlFile('supabase_income_review_decisions.sql').toLowerCase();

    expect(sql).not.toContain('raw_sms');
    expect(sql).not.toContain('notification_text');
    expect(sql).not.toMatch(/\bbody\s+text\b/);
    expect(sql).not.toContain('upi_id');
    expect(sql).not.toMatch(/\bpayload\s+json/);
    expect(sql).not.toMatch(/\bgrant\s+all\b/);
  });
});
