import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  captureTransactionSignal,
  groupSignalsByTransaction,
  buildTransactionBlackBoxExport,
  recordUserNote,
  listUserNotes,
  setUserNoteStatus,
  recordFeatureUsage,
  getFeatureUsageSummary,
  clearTransactionBlackBoxStore,
  __resetTransactionBlackBoxCacheForTests,
  type TransactionSignalRecord,
} from './transactionBlackBox';

const baseSignal = (over: Partial<TransactionSignalRecord> = {}): TransactionSignalRecord => ({
  id: Math.random().toString(36).slice(2),
  time: Date.now(),
  sourceKind: 'notification',
  sourceLabel: 'Super.money',
  sourceIdentity: 'money.super.payments',
  rawText: '₹187 received',
  textLen: 13,
  hash: 'abcd1234',
  amount: 187,
  direction: 'credit',
  referenceNumber: null,
  confidence: 'low',
  transactionId: 'txn-1',
  linked: true,
  signalId: 'sig-1',
  ...over,
});

beforeEach(async () => {
  await AsyncStorage.clear();
  __resetTransactionBlackBoxCacheForTests();
});

describe('transactionBlackBox capture', () => {
  it('captures a signal and persists it for export', async () => {
    await captureTransactionSignal({
      sourceKind: 'notification',
      sourceLabel: 'Super.money',
      sourceIdentity: 'money.super.payments',
      rawText: '₹187 received',
      amount: 187,
      direction: 'credit',
      confidence: 'low',
      transactionId: 'txn-1',
      signalId: 'sig-1',
    });

    const exportJson = JSON.parse(await buildTransactionBlackBoxExport());
    expect(exportJson.summary.signalCount).toBe(1);
    expect(exportJson.summary.linkedSignalCount).toBe(1);
    expect(exportJson.provenance[0].transactionId).toBe('txn-1');
  });

  it('dedupes repeated capture of the same signal+transaction', async () => {
    const input = {
      sourceKind: 'sms' as const,
      sourceIdentity: 'KOTAK',
      rawText: 'Rs.187 credited',
      signalId: 'sig-dup',
      transactionId: 'txn-1',
    };
    await captureTransactionSignal(input);
    await captureTransactionSignal(input);

    const exportJson = JSON.parse(await buildTransactionBlackBoxExport());
    expect(exportJson.summary.signalCount).toBe(1);
  });

  it('truncates absurdly long raw text but records the true length', async () => {
    const huge = 'x'.repeat(5000);
    await captureTransactionSignal({
      sourceKind: 'sms',
      sourceIdentity: 'KOTAK',
      rawText: huge,
      signalId: 'sig-huge',
      transactionId: 'txn-2',
    });
    const exportJson = JSON.parse(await buildTransactionBlackBoxExport());
    const signal = exportJson.provenance[0].contributions[0];
    expect(signal.rawText.length).toBe(2000);
    expect(signal.textLen).toBe(5000);
  });
});

describe('provenance grouping', () => {
  it('groups multiple sources under one transaction and picks the most confident', () => {
    const signals: TransactionSignalRecord[] = [
      baseSignal({ signalId: 's1', sourceLabel: 'Super.money', confidence: 'low', time: 1 }),
      baseSignal({ signalId: 's2', sourceLabel: 'KOTAK', sourceKind: 'sms', confidence: 'high', time: 2 }),
      baseSignal({ signalId: 's3', sourceLabel: 'Truecaller', confidence: 'medium', time: 3 }),
    ];
    const groups = groupSignalsByTransaction(signals);
    expect(groups).toHaveLength(1);
    expect(groups[0].signalCount).toBe(3);
    expect(groups[0].mostConfidentSource?.sourceLabel).toBe('KOTAK');
    expect(groups[0].amountDisagreement).toBe(false);
  });

  it('flags amount disagreement across sources', () => {
    const signals: TransactionSignalRecord[] = [
      baseSignal({ signalId: 's1', amount: 187 }),
      baseSignal({ signalId: 's2', amount: 188 }),
    ];
    const groups = groupSignalsByTransaction(signals);
    expect(groups[0].amountDisagreement).toBe(true);
  });

  it('ignores unlinked signals when grouping', () => {
    const signals: TransactionSignalRecord[] = [
      baseSignal({ signalId: 's1', transactionId: null, linked: false }),
    ];
    expect(groupSignalsByTransaction(signals)).toHaveLength(0);
  });
});

describe('user notes', () => {
  it('records, lists, and resolves notes', async () => {
    const note = await recordUserNote({ text: 'UPI from XYZ shows wrong name', kind: 'error', context: 'TransactionDetail' });
    expect(note).not.toBeNull();

    let notes = await listUserNotes();
    expect(notes).toHaveLength(1);
    expect(notes[0].status).toBe('open');

    await setUserNoteStatus(notes[0].id, 'resolved');
    notes = await listUserNotes();
    expect(notes[0].status).toBe('resolved');
  });

  it('ignores empty notes', async () => {
    const note = await recordUserNote({ text: '   ' });
    expect(note).toBeNull();
    expect(await listUserNotes()).toHaveLength(0);
  });
});

describe('feature usage', () => {
  it('counts repeated feature usage', async () => {
    await recordFeatureUsage('debt_freedom');
    await recordFeatureUsage('debt_freedom');
    await recordFeatureUsage('reminders');

    const summary = await getFeatureUsageSummary();
    expect(summary.debt_freedom.count).toBe(2);
    expect(summary.reminders.count).toBe(1);
  });
});

describe('clear', () => {
  it('wipes the store', async () => {
    await captureTransactionSignal({ sourceKind: 'sms', sourceIdentity: 'KOTAK', rawText: 'x', signalId: 's', transactionId: 't' });
    await clearTransactionBlackBoxStore();
    const exportJson = JSON.parse(await buildTransactionBlackBoxExport());
    expect(exportJson.summary.signalCount).toBe(0);
  });
});
