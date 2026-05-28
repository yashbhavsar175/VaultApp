import {
  createRedactedRawTextRecord,
  ensureRedactedRawTextRecord,
  isRedactedRawTextRecord,
  sanitizeDebugBugReportsForPrivacy,
  sanitizeTransactionRawSmsForPrivacy,
} from './rawText';

describe('raw text privacy helpers', () => {
  it('creates a deterministic redacted SMS record without retaining body text', () => {
    const body = 'Rs.31 debited from account XX1234 to TASK24D SHOP. OTP 123456. Call 9876543210.';

    const first = createRedactedRawTextRecord({
      kind: 'sms',
      text: body,
      sender: 'HDFCBK',
      source: 'bank',
    });
    const second = createRedactedRawTextRecord({
      kind: 'sms',
      text: body,
      sender: 'HDFCBK',
      source: 'bank',
    });

    expect(first).toBe(second);
    expect(first).toMatch(/^redacted_sms len=\d+ hash=[a-f0-9]{8}/);
    expect(first).toContain('sender=HDFCBK');
    expect(first).toContain('source=bank');
    expect(first).not.toContain('TASK24D SHOP');
    expect(first).not.toContain('123456');
    expect(first).not.toContain('9876543210');
    expect(isRedactedRawTextRecord(first)).toBe(true);
  });

  it('omits phone-like metadata values from the redacted record', () => {
    const record = createRedactedRawTextRecord({
      kind: 'notification',
      text: 'Paid Rs.42 to TASK24D NOTIFY',
      sender: '+919876543210',
      source: 'upi',
      app: 'com.google.android.apps.nbu.paisa.user',
    });

    expect(record).toMatch(/^redacted_notification len=\d+ hash=[a-f0-9]{8}/);
    expect(record).not.toContain('9876543210');
    expect(record).not.toContain('+91');
    expect(record).toContain('source=upi');
    expect(record).toContain('app=com.google.android.apps.nbu.paisa.user');
  });

  it('sanitizes bug report raw text without retaining OTP, phone, or address text', () => {
    const body = 'OTP 123456 for account 9876543210 at 12 Main Road. This is not a transaction.';
    const reports = sanitizeDebugBugReportsForPrivacy([
      {
        id: '1',
        type: 'sms_failed',
        sender: 'TESTBK',
        rawSms: body,
        logicLog: 'Parse failed',
      },
    ]);

    expect(reports[0].rawSms).toMatch(/^redacted_sms len=\d+ hash=[a-f0-9]{8}/);
    expect(reports[0].rawSms).toContain('sender=TESTBK');
    expect(reports[0].rawSms).toContain('source=sms_failed');
    expect(reports[0].rawSms).not.toContain('OTP');
    expect(reports[0].rawSms).not.toContain('123456');
    expect(reports[0].rawSms).not.toContain('9876543210');
    expect(reports[0].rawSms).not.toContain('Main Road');
  });

  it('keeps already redacted bug report metadata stable', () => {
    const rawSms = ensureRedactedRawTextRecord('Payment failed for Rs.500', {
      kind: 'notification',
      sender: 'GPAY',
      source: 'notification_parse_failed',
      app: 'com.google.android.apps.nbu.paisa.user',
    });

    const [report] = sanitizeDebugBugReportsForPrivacy([
      {
        id: '2',
        type: 'sms_failed',
        rawSmsKind: 'notification',
        sender: 'GPAY',
        rawSms,
      },
    ]);

    expect(report.rawSms).toBe(rawSms);
    expect(report.rawSmsKind).toBe('notification');
  });

  it('redacts historical transaction raw_sms without retaining SMS body details', () => {
    const tx = sanitizeTransactionRawSmsForPrivacy({
      id: 'tx_legacy',
      sms_source: 'bank',
      sms_sender: 'HDFCBK',
      raw_sms: 'Rs.99 debited from account XX1234 to TASK24F STORE. OTP 123456. Call 9876543210.',
    });

    expect(tx.raw_sms).toMatch(/^redacted_sms len=\d+ hash=[a-f0-9]{8}/);
    expect(tx.raw_sms).toContain('sender=HDFCBK');
    expect(tx.raw_sms).toContain('source=bank');
    expect(tx.raw_sms).not.toContain('TASK24F STORE');
    expect(tx.raw_sms).not.toContain('OTP');
    expect(tx.raw_sms).not.toContain('123456');
    expect(tx.raw_sms).not.toContain('9876543210');
  });

  it('keeps already redacted transaction raw_sms unchanged', () => {
    const redacted = 'redacted_sms len=99 hash=abcdef12 sender=HDFCBK source=bank';
    const tx = sanitizeTransactionRawSmsForPrivacy({
      id: 'tx_redacted',
      sms_source: 'bank',
      sms_sender: 'HDFCBK',
      raw_sms: redacted,
    });

    expect(tx.raw_sms).toBe(redacted);
  });
});
