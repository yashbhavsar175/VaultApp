/* eslint-env jest, node */

const fs = require('fs');
const path = require('path');

const SQL_FILES = [
  'supabase_debt_freedom_settings.sql',
  'supabase-fresh-setup.sql',
];

function readSqlFile(fileName) {
  const rootPath = path.join(__dirname, '..', '..', '..', fileName);
  const archivePath = path.join(__dirname, '..', '..', '..', 'docs', 'sql-archive', fileName);
  return fs.readFileSync(fs.existsSync(rootPath) ? rootPath : archivePath, 'utf8');
}

describe('debt freedom settings SQL', () => {
  it.each(SQL_FILES)('%s creates debt_freedom_settings with expected columns', fileName => {
    const sql = readSqlFile(fileName);

    expect(sql).toContain('CREATE TABLE IF NOT EXISTS debt_freedom_settings');
    expect(sql).toContain('confirmed_monthly_income numeric(14,2)');
    expect(sql).toContain('essential_monthly_expenses numeric(14,2)');
    expect(sql).toContain('emergency_contribution numeric(14,2) NOT NULL DEFAULT 0');
    expect(sql).toContain('target_monthly_income numeric(14,2)');
    expect(sql).toContain('planned_monthly_debt_payment numeric(14,2)');
    expect(sql).toContain('target_debt_free_months integer');
    expect(sql).toContain("strategy text NOT NULL DEFAULT 'balanced'");
    expect(sql).toContain("income_mode text NOT NULL DEFAULT 'auto'");
  });

  it.each(SQL_FILES)('%s keeps one settings row per user and enforces checks', fileName => {
    const sql = readSqlFile(fileName);

    expect(sql).toContain('UNIQUE(user_id)');
    expect(sql).toContain('confirmed_monthly_income IS NULL OR confirmed_monthly_income >= 0');
    expect(sql).toContain('essential_monthly_expenses IS NULL OR essential_monthly_expenses >= 0');
    expect(sql).toContain('emergency_contribution >= 0');
    expect(sql).toContain('target_monthly_income IS NULL OR target_monthly_income >= 0');
    expect(sql).toContain('planned_monthly_debt_payment IS NULL OR planned_monthly_debt_payment >= 0');
    expect(sql).toContain('target_debt_free_months > 0 AND target_debt_free_months <= 600');
    expect(sql).toContain("strategy IN ('balanced', 'snowball', 'avalanche')");
    expect(sql).toContain("income_mode IN ('auto', 'confirmed', 'manual_estimate')");
  });

  it.each(SQL_FILES)('%s enables RLS with own-row policies only', fileName => {
    const sql = readSqlFile(fileName);

    expect(sql).toContain('ALTER TABLE debt_freedom_settings ENABLE ROW LEVEL SECURITY');
    expect(sql).toContain('FOR SELECT');
    expect(sql).toContain('FOR INSERT');
    expect(sql).toContain('FOR UPDATE');
    expect(sql).toContain('FOR DELETE');
    expect(sql).toContain('USING (auth.uid() = user_id)');
    expect(sql).toContain('WITH CHECK (auth.uid() = user_id)');
    expect(sql).not.toMatch(/TO\s+(anon|public)/i);
    expect(sql).not.toMatch(/GRANT\s+.*\s+ON\s+debt_freedom_settings\s+TO\s+(anon|public)/i);
  });

  it.each(SQL_FILES)('%s updates updated_at by trigger', fileName => {
    const sql = readSqlFile(fileName);

    expect(sql).toContain('set_debt_freedom_settings_updated_at');
    expect(sql).toContain('trigger_set_debt_freedom_settings_updated_at');
    expect(sql).toContain('NEW.updated_at = now()');
  });

  it('keeps fresh setup aligned with standalone SQL', () => {
    const standalone = readSqlFile('supabase_debt_freedom_settings.sql');
    const fresh = readSqlFile('supabase-fresh-setup.sql');

    for (const token of [
      'CREATE TABLE IF NOT EXISTS debt_freedom_settings',
      'idx_debt_freedom_settings_user_id',
      'set_debt_freedom_settings_updated_at',
      'trigger_set_debt_freedom_settings_updated_at',
    ]) {
      expect(standalone).toContain(token);
      expect(fresh).toContain(token);
    }
  });

  it('does not introduce raw payload or broad public access', () => {
    const sql = readSqlFile('supabase_debt_freedom_settings.sql').toLowerCase();

    expect(sql).not.toContain('raw_sms');
    expect(sql).not.toContain('notification_text');
    expect(sql).not.toContain('profile object json');
    expect(sql).not.toContain('upi_id');
    expect(sql).not.toMatch(/\bpayload\s+json/);
    expect(sql).not.toMatch(/\bgrant\s+all\b/);
  });
});
