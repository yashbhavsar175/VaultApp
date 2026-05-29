import {
  buildBalanceSnapshotInsert,
  sanitizeBalanceSourceMetadata,
} from './balanceSnapshots';
import { buildDetectedAccountInsert } from './detectedAccounts';
import { buildCreditCardStatementPayload } from './creditCardStatements';

jest.mock('../core', () => ({
  supabase: {
    auth: {
      getUser: jest.fn(),
    },
    from: jest.fn(),
  },
}));

describe('balance foundation privacy helpers', () => {
  it('removes raw body fields and sensitive values from source metadata', () => {
    const sanitized = sanitizeBalanceSourceMetadata({
      len: 120,
      hash: 'abcdef12',
      source: 'sms',
      sender: 'HDFCBK',
      package: 'com.bank.app',
      kind: 'sms',
      rawText: 'Rs.500 debited from A/c XX1234. OTP 123456.',
      raw_sms: 'secret body',
      body: 'full sms',
      message: 'full notification',
      notificationText: 'full notification',
      payload: { text: 'nested raw' },
      accountNumber: '123456789012',
      cardNumber: '4111111111111111',
      phone: '9876543210',
      address: 'Main Road, Ahmedabad',
    });

    expect(sanitized).toEqual({
      len: 120,
      hash: 'abcdef12',
      source: 'sms',
      sender: 'HDFCBK',
      package: 'com.bank.app',
      kind: 'sms',
    });
    expect(JSON.stringify(sanitized)).not.toContain('OTP');
    expect(JSON.stringify(sanitized)).not.toContain('9876543210');
    expect(JSON.stringify(sanitized)).not.toContain('4111111111111111');
  });

  it('builds a balance snapshot payload with only redacted metadata', () => {
    const payload = buildBalanceSnapshotInsert('user_1', {
      owner_type: 'bank_account',
      owner_id: 'bank_1',
      account_last4: 'XX1234',
      balance_kind: 'available_balance',
      amount: 1500,
      source: 'sms',
      confidence: 'exact',
      raw_source_metadata: {
        length: 88,
        hash: '1234abcd',
        rawText: 'raw bank alert should not survive',
      },
    });

    expect(payload.account_last4).toBe('1234');
    expect(payload.raw_source_metadata).toEqual({
      length: 88,
      hash: '1234abcd',
    });
  });

  it('builds detected account candidates with last4 and redacted metadata only', () => {
    const payload = buildDetectedAccountInsert('user_1', {
      detection_type: 'credit_card',
      detected_bank_name: 'HDFC Bank',
      card_last4: '4111111111111234',
      balance_amount: 2500,
      balance_kind: 'outstanding',
      source: 'notification',
      confidence: 'exact',
      raw_source_metadata: {
        len: 140,
        hash: 'feed1234',
        notificationText: 'full card statement body',
      },
    });

    expect(payload.card_last4).toBe('1234');
    expect(payload.status).toBe('pending');
    expect(payload.raw_source_metadata).toEqual({
      len: 140,
      hash: 'feed1234',
    });
  });

  it('builds credit card statement payloads with due, minimum due, and payment date', () => {
    const payload = buildCreditCardStatementPayload('user_1', {
      credit_card_id: 'card_1',
      total_due: 12000,
      minimum_due: 800,
      payment_due_date: '2026-06-15',
      statement_date: '2026-05-29',
      source: 'sms',
      confidence: 'exact',
      raw_source_metadata: {
        len: 100,
        hash: 'abab1234',
        body: 'raw statement body',
      },
    });

    expect(payload.total_due).toBe(12000);
    expect(payload.minimum_due).toBe(800);
    expect(payload.payment_due_date).toBe('2026-06-15');
    expect(payload.raw_source_metadata).toEqual({
      len: 100,
      hash: 'abab1234',
    });
  });
});
