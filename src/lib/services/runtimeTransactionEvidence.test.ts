import {
  buildEvidenceSignalId,
  mapNotificationToEvidence,
  mapParsedTransactionToEvidence,
  recordNotificationTransactionEvidence,
  recordSmsTransactionEvidence,
} from './runtimeTransactionEvidence';
import { createTransactionEvidence } from './transactionEvidence';

jest.mock('./transactionEvidence', () => {
  const actual = jest.requireActual('./transactionEvidence');
  return {
    ...actual,
    createTransactionEvidence: jest.fn(async input => ({
      id: 'evidence_1',
      ...input,
    })),
  };
});

const mockedCreateTransactionEvidence = createTransactionEvidence as jest.Mock;

describe('runtime transaction evidence recording', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('builds deterministic signal ids for the same replay across time buckets', () => {
    const first = buildEvidenceSignalId({
      sourceType: 'sms',
      sourceIdentity: 'HDFCBK',
      safeHash: 'abcdef12',
      amount: 29,
      referenceNumber: '292929292929',
      capturedAt: '2026-05-30T10:00:01.000Z',
    });
    const replay = buildEvidenceSignalId({
      sourceType: 'sms',
      sourceIdentity: 'HDFCBK',
      safeHash: 'abcdef12',
      amount: 29,
      referenceNumber: '292929292929',
      capturedAt: '2026-05-30T11:04:59.000Z',
    });

    expect(replay).toBe(first);
    expect(first).toContain('runtime:sms:hdfcbk:abcdef12:29.00:292929292929');
  });

  it('keeps different references as separate evidence signals', () => {
    const first = buildEvidenceSignalId({
      sourceType: 'sms',
      sourceIdentity: 'HDFCBK',
      safeHash: 'abcdef12',
      amount: 29,
      referenceNumber: '292929292929',
    });
    const second = buildEvidenceSignalId({
      sourceType: 'sms',
      sourceIdentity: 'HDFCBK',
      safeHash: 'abcdef12',
      amount: 29,
      referenceNumber: '303030303030',
    });

    expect(second).not.toBe(first);
  });

  it('maps bank SMS to linked exact evidence without raw text', async () => {
    const text = 'Rs.29 debited from your HDFC Bank account XX2929 to CODEX28J SHOP via UPI. Avl Bal Rs.2929.29. UPI Ref 292929292929. OTP 123456. Call 9876543210.';

    const evidence = mapParsedTransactionToEvidence({
      text,
      sender: 'HDFCBK',
      parsed: {
        amount: 29,
        type: 'debit',
        reference: '292929292929',
        merchant: 'CODEX28J SHOP',
        source: 'bank',
        accountLast4: '2929',
        bankName: 'HDFC Bank',
      },
      transactionId: 'tx_1',
      timestamp: Date.parse('2026-05-30T10:00:00.000Z'),
    });

    expect(evidence).toEqual(expect.objectContaining({
      transaction_id: 'tx_1',
      source_type: 'sms',
      sender: 'HDFCBK',
      amount: 29,
      direction: 'debit',
      reference_number: '292929292929',
      merchant_or_person: 'CODEX28J SHOP',
      bank_name: 'HDFC Bank',
      account_last4: '2929',
      card_last4: null,
      instrument_hint: 'bank_account',
      confidence_level: 'exact',
      match_status: 'linked',
    }));
    expect(evidence.raw_source_metadata).toEqual(expect.objectContaining({
      len: text.length,
      source: 'runtime',
      sender: 'HDFCBK',
      kind: 'transaction_evidence',
    }));
    expect(JSON.stringify(evidence)).not.toContain(text);
    expect(JSON.stringify(evidence)).not.toContain('OTP 123456');
    expect(JSON.stringify(evidence)).not.toContain('9876543210');
  });

  it('masks embedded UPI IDs and strips unsafe sender text from stored evidence', () => {
    const evidence = mapParsedTransactionToEvidence({
      text: 'Rs.29 debited from account XX2929 to yash.codex28j@oksbi.',
      sender: '9876543210',
      parsed: {
        amount: 29,
        type: 'debit',
        merchant: 'Paid to yash.codex28j@oksbi',
        accountLast4: '2929',
      },
    });

    expect(evidence.sender).toBeNull();
    expect(evidence.raw_source_metadata).toEqual(expect.objectContaining({ sender: null }));
    expect(evidence.merchant_or_person).toBe('Paid to yash***@oksbi');
    expect(JSON.stringify(evidence)).not.toContain('yash.codex28j@oksbi');
    expect(JSON.stringify(evidence)).not.toContain('9876543210');
  });

  it('drops raw-like account context from broad SMS merchant extraction', () => {
    const evidence = mapParsedTransactionToEvidence({
      text: 'Rs.32 debited from your HDFC Bank account XX2841 to CODEX28KR SHOP via UPI.',
      sender: 'HDFCBK',
      parsed: {
        amount: 32,
        type: 'debit',
        merchant: 'your HDFC Bank account XX2841 to CODEX28KR SHOP',
        accountLast4: '2841',
      },
    });

    expect(evidence.merchant_or_person).toBeNull();
    expect(JSON.stringify(evidence)).not.toContain('your HDFC Bank account');
    expect(JSON.stringify(evidence)).not.toContain('CODEX28KR');
  });

  it('records bank SMS evidence and skips duplicate signal conflicts safely', async () => {
    await expect(recordSmsTransactionEvidence({
      text: 'Rs.29 debited from account XX2929. UPI Ref 292929292929.',
      sender: 'HDFCBK',
      parsed: {
        amount: 29,
        type: 'debit',
        reference: '292929292929',
        accountLast4: '2929',
      },
      transactionId: 'tx_1',
      timestamp: Date.parse('2026-05-30T10:00:00.000Z'),
    })).resolves.toBe('created');

    mockedCreateTransactionEvidence.mockRejectedValueOnce({ code: '23505', message: 'duplicate key value' });

    await expect(recordSmsTransactionEvidence({
      text: 'Rs.29 debited from account XX2929. UPI Ref 292929292929.',
      sender: 'HDFCBK',
      parsed: {
        amount: 29,
        type: 'debit',
        reference: '292929292929',
        accountLast4: '2929',
      },
      transactionId: 'tx_1',
      timestamp: Date.parse('2026-05-30T10:00:01.000Z'),
    })).resolves.toBe('duplicate');
  });

  it('maps payment app notifications as unlinked app evidence without account ownership', async () => {
    const text = 'Paid Rs.77 to CODEX28J via UPI yash.codex28j@oksbi. UPI Ref 777777777777. Card 123456789012. OTP 123456.';

    const evidence = mapNotificationToEvidence({
      text,
      sourcePackage: 'com.google.android.apps.nbu.paisa.user',
      sender: 'GPAYID',
      parsed: {
        amount: 77,
        type: 'debit',
        reference: '777777777777',
        merchant: 'CODEX28J',
        accountLast4: '9012',
        bankName: 'HDFC Bank',
        upiId: 'yash.codex28j@oksbi',
      },
      transactionId: null,
      timestamp: Date.parse('2026-05-30T10:00:00.000Z'),
    });

    expect(evidence).toEqual(expect.objectContaining({
      transaction_id: null,
      source_type: 'notification',
      source_package: 'com.google.android.apps.nbu.paisa.user',
      source_app: 'GPay',
      sender: 'GPAYID',
      amount: 77,
      direction: 'debit',
      reference_number: '777777777777',
      merchant_or_person: 'CODEX28J',
      bank_name: null,
      account_last4: null,
      card_last4: null,
      instrument_hint: 'unknown',
      upi_id_masked: 'yash***@oksbi',
      confidence_level: 'low',
      match_status: 'unlinked',
    }));
    expect(evidence).not.toHaveProperty('account_id');
    expect(evidence).not.toHaveProperty('account_match_status');
    expect(JSON.stringify(evidence)).not.toContain(text);
    expect(JSON.stringify(evidence)).not.toContain('yash.codex28j@oksbi');
    expect(JSON.stringify(evidence)).not.toContain('123456789012');
    expect(JSON.stringify(evidence)).not.toContain('OTP 123456');
  });

  it('does not fail callers when evidence insertion fails', async () => {
    mockedCreateTransactionEvidence.mockRejectedValueOnce(new Error('write failed with raw body hidden'));

    await expect(recordNotificationTransactionEvidence({
      text: 'Paid Rs.77 to CODEX28J via UPI yash.codex28j@oksbi.',
      sourcePackage: 'com.phonepe.app',
      sender: 'PHONEPE',
      transactionId: null,
      timestamp: Date.parse('2026-05-30T10:00:00.000Z'),
    })).resolves.toBe('failed');

    expect(console.warn).toHaveBeenCalledWith(
      '[RuntimeTransactionEvidence] Failed to record evidence',
      expect.objectContaining({
        sourceType: 'notification',
        reason: 'evidence_write_failed',
      })
    );
    expect(JSON.stringify((console.warn as jest.Mock).mock.calls)).not.toContain('yash.codex28j@oksbi');
  });
});
