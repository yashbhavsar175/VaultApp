/* eslint-env jest, node */

const fs = require('fs');
const path = require('path');

const SQL_FILES = [
  'supabase_transaction_evidence.sql',
  'supabase_account_app_mappings.sql',
  'supabase-fresh-setup.sql',
];

function readSqlFile(fileName) {
  return fs.readFileSync(path.join(__dirname, '..', '..', '..', fileName), 'utf8');
}

describe('transaction evidence foundation SQL', () => {
  it('creates transaction evidence and account app mapping tables', () => {
    const evidence = readSqlFile('supabase_transaction_evidence.sql');
    const mappings = readSqlFile('supabase_account_app_mappings.sql');
    const fresh = readSqlFile('supabase-fresh-setup.sql');

    for (const sql of [evidence, fresh]) {
      expect(sql).toContain('CREATE TABLE IF NOT EXISTS transaction_evidence');
      expect(sql).toContain("source_type IN ('sms', 'notification', 'accessibility', 'manual', 'imported')");
      expect(sql).toContain("match_status IN ('unlinked', 'linked', 'ambiguous', 'review_required', 'ignored')");
    }

    for (const sql of [mappings, fresh]) {
      expect(sql).toContain('CREATE TABLE IF NOT EXISTS account_app_mappings');
      expect(sql).toContain("owner_type IN ('bank_account', 'credit_card', 'debit_card', 'wallet')");
      expect(sql).toContain("confidence_level IN ('medium', 'low')");
    }

    expect(mappings).not.toContain("confidence_level IN ('exact'");
  });

  it.each(SQL_FILES)('%s enables RLS and scopes policies to auth.uid() = user_id', fileName => {
    const sql = readSqlFile(fileName);

    if (fileName !== 'supabase_account_app_mappings.sql') {
      expect(sql).toContain('ALTER TABLE transaction_evidence ENABLE ROW LEVEL SECURITY');
    }
    if (fileName !== 'supabase_transaction_evidence.sql') {
      expect(sql).toContain('ALTER TABLE account_app_mappings ENABLE ROW LEVEL SECURITY');
    }

    expect(sql).toContain('USING (auth.uid() = user_id)');
    expect(sql).toContain('WITH CHECK (auth.uid() = user_id)');
  });

  it('adds transaction match fields without changing transaction types', () => {
    for (const fileName of ['supabase_transaction_evidence.sql', 'supabase-fresh-setup.sql']) {
      const sql = readSqlFile(fileName);

      expect(sql).toContain('ADD COLUMN IF NOT EXISTS account_match_status text DEFAULT \'unlinked\'');
      expect(sql).toContain('ADD COLUMN IF NOT EXISTS account_match_confidence text');
      expect(sql).toContain('ADD COLUMN IF NOT EXISTS account_match_reason text');
      expect(sql).toContain('ADD COLUMN IF NOT EXISTS primary_evidence_id uuid');
      expect(sql).toContain('transactions_primary_evidence_id_fkey');
      expect(sql).toContain("account_match_status IN ('unlinked', 'linked', 'ambiguous', 'review_required', 'ignored', 'manual_confirmed')");
      expect(sql).toContain("account_match_confidence IN ('exact', 'high', 'medium', 'low')");
    }

    expect(readSqlFile('supabase-fresh-setup.sql')).toContain(
      "'income', 'expense', 'investment', 'emi', 'lent', 'borrowed', 'transfer', 'refund'"
    );
  });

  it('adds evidence lookup indexes', () => {
    const sql = SQL_FILES.map(readSqlFile).join('\n');

    expect(sql).toContain('idx_transaction_evidence_user_signal');
    expect(sql).toContain('idx_transaction_evidence_transaction');
    expect(sql).toContain('idx_transaction_evidence_reference');
    expect(sql).toContain('idx_transaction_evidence_amount_captured');
    expect(sql).toContain('idx_transaction_evidence_account_last4');
    expect(sql).toContain('idx_transaction_evidence_card_last4');
    expect(sql).toContain('idx_transaction_evidence_match_status');
    expect(sql).toContain('idx_transaction_evidence_source_package_captured');
    expect(sql).toContain('idx_account_app_mappings_package_status');
    expect(sql).toContain('idx_account_app_mappings_payment_hash');
    expect(sql).toContain('idx_account_app_mappings_owner');
    expect(sql).toContain('idx_account_app_mappings_active_unique');
  });

  it('guards account app mapping ownership and keeps wallet unsupported', () => {
    for (const fileName of ['supabase_account_app_mappings.sql', 'supabase-fresh-setup.sql']) {
      const sql = readSqlFile(fileName);

      expect(sql).toContain('validate_account_app_mapping_owner');
      expect(sql).toContain('trigger_validate_account_app_mapping_owner');
      expect(sql).toContain("IF NEW.owner_type = 'bank_account' THEN");
      expect(sql).toContain("ELSIF NEW.owner_type = 'credit_card' THEN");
      expect(sql).toContain("ELSIF NEW.owner_type = 'debit_card' THEN");
      expect(sql).toContain("ELSIF NEW.owner_type = 'wallet' THEN");
      expect(sql).toContain('Wallet mappings are not supported until a wallet owner table exists');
      expect(sql).toContain('AND user_id = NEW.user_id');
      expect(sql).toContain('SECURITY INVOKER');
    }
  });

  it('does not create raw body columns or introduce checking in new foundation SQL', () => {
    for (const fileName of ['supabase_transaction_evidence.sql', 'supabase_account_app_mappings.sql']) {
      const sql = readSqlFile(fileName).toLowerCase();

      expect(sql).not.toContain('raw_sms text');
      expect(sql).not.toContain('body text');
      expect(sql).not.toContain('message text');
      expect(sql).not.toContain('notificationtext text');
      expect(sql).not.toMatch(/\n\s*payload\s+json/);
      expect(sql).not.toContain('checking');
    }
  });

  it('documents redacted metadata and masked UPI rules', () => {
    const sql = SQL_FILES.map(readSqlFile).join('\n').toLowerCase();

    expect(sql).toContain('redacted metadata only');
    expect(sql).toContain('never raw sms');
    expect(sql).toContain('notification body');
    expect(sql).toContain('full account/card number');
    expect(sql).toContain('masked upi id only');
    expect(sql).toContain('never overrides bank sms evidence');
  });

  it('does not wire runtime processors to transaction evidence yet', () => {
    const root = path.join(__dirname, '..', '..', '..');
    const processors = fs.readFileSync(
      path.join(root, 'src', 'lib', 'processors', 'TransactionProcessors.ts'),
      'utf8'
    );
    const notifications = fs.readFileSync(
      path.join(root, 'src', 'lib', 'services', 'notifications.ts'),
      'utf8'
    );

    expect(processors).not.toContain('transactionEvidence');
    expect(notifications).not.toContain('transactionEvidence');
  });
});
