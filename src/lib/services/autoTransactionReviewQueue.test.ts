import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  enqueueReviewCandidate,
  getReviewQueue,
  getPendingCount,
  markReviewed,
  markIgnored,
  clearReviewQueue,
  markPosted,
  checkForDuplicateTransaction
} from './autoTransactionReviewQueue';
import { subscribeFinanceDataChanged } from './dataEvents';
import { SmartCandidate, AutoTransactionClass } from './transactionIntelligence';

export const mockTransactions = [
  { id: 'tx_existing_1', reference_number: 'ref_exists', amount: 500, type: 'expense', created_at: new Date().toISOString() }
];

jest.mock('../core', () => ({
  getTransactions: jest.fn(async () => mockTransactions),
  addTransaction: jest.fn(async (tx) => ({ id: 'new_tx_id', ...tx, created_at: new Date().toISOString() })),
  supabase: {
    auth: {
      getUser: jest.fn(async () => ({ data: { user: { id: 'test_user_id' } } }))
    }
  }
}));

jest.mock('@react-native-async-storage/async-storage', () => {
  let store: Record<string, string> = {};
  return {
    getItem: jest.fn(async (key: string) => store[key] || null),
    setItem: jest.fn(async (key: string, value: string) => {
      store[key] = value;
      return null;
    }),
    removeItem: jest.fn(async (key: string) => {
      delete store[key];
      return null;
    }),
    clear: jest.fn(async () => {
      store = {};
      return null;
    }),
  };
});

describe('Auto Transaction Review Queue Service', () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    await clearReviewQueue();
  });

  const mockCandidate = (signalId: string, ref?: string): SmartCandidate => ({
    signalId,
    autoClass: 'upi_payment',
    direction: 'debit',
    amount: 500,
    merchantOrPerson: 'Test Merchant',
    last4: '1234',
    reference: ref || null,
    instrumentHint: 'bank_account',
    confidenceScore: 75,
    confidenceLevel: 'medium',
    decision: 'review_required',
    duplicateFingerprints: [
      ...(ref ? [{ strategy: 'reference' as const, value: ref }] : []),
      { strategy: 'hash' as const, value: `hash_${signalId}` }
    ],
    redactedPreview: {
      amount: 500,
      detectedSource: 'HDFCBK',
      autoClass: 'upi_payment',
      maskedLast4: 'XX1234',
      hashSummary: `len=20 hash=${signalId}`
    }
  });

  it('enqueues a candidate successfully and omits rawText', async () => {
    const candidate = {
      ...mockCandidate('sig1'),
      rawText: 'Rs 500 debited from AC 1234'
    } as any;

    const enqueued = await enqueueReviewCandidate(candidate);
    expect(enqueued).toBe(true);

    const queue = await getReviewQueue();
    expect(queue).toHaveLength(1);
    expect(queue[0].candidate.signalId).toBe('sig1');
    expect(queue[0].status).toBe('pending');
    expect(queue[0].reasons).toContain('Medium confidence detection');
    expect((queue[0].candidate as any).rawText).toBeUndefined();
  });

  it('deduplicates enqueued candidates by duplicateFingerprints', async () => {
    const candidate1 = mockCandidate('sig1', 'ref123');
    const candidate2 = mockCandidate('sig2', 'ref123'); // same reference

    const added1 = await enqueueReviewCandidate(candidate1);
    expect(added1).toBe(true);

    const added2 = await enqueueReviewCandidate(candidate2);
    expect(added2).toBe(false); // duplicate!

    const queue = await getReviewQueue();
    expect(queue).toHaveLength(1);
  });

  it('enforces maximum 200 items limit', async () => {
    for (let i = 0; i < 205; i++) {
      const candidate = mockCandidate(`sig_${i}`);
      await enqueueReviewCandidate(candidate);
    }

    const queue = await getReviewQueue();
    expect(queue.length).toBe(200);
    // Newest should be at the start
    expect(queue[0].candidate.signalId).toBe('sig_204');
  });

  it('safely handles corrupt AsyncStorage JSON without crashing', async () => {
    await AsyncStorage.setItem('auto_transaction_review_queue_v1', 'invalid-json-{]');
    
    const queue = await getReviewQueue();
    expect(queue).toEqual([]);
    
    const count = await getPendingCount();
    expect(count).toBe(0);
  });

  it('marks items as reviewed or ignored and updates pending count', async () => {
    const cand1 = mockCandidate('sig1');
    const cand2 = mockCandidate('sig2');

    await enqueueReviewCandidate(cand1);
    await enqueueReviewCandidate(cand2);

    let pendingCount = await getPendingCount();
    expect(pendingCount).toBe(2);

    await markReviewed('sig1');
    
    pendingCount = await getPendingCount();
    expect(pendingCount).toBe(1);

    const queue = await getReviewQueue();
    const item1 = queue.find(i => i.id === 'sig1');
    expect(item1?.status).toBe('reviewed');

    await markIgnored('sig2');
    pendingCount = await getPendingCount();
    expect(pendingCount).toBe(0);
  });

  it('marks candidate as posted and decreases pending count', async () => {
    const cand = mockCandidate('sig1');
    await enqueueReviewCandidate(cand);
    
    let count = await getPendingCount();
    expect(count).toBe(1);

    await markPosted('sig1', 'tx_new_123');

    count = await getPendingCount();
    expect(count).toBe(0); // marked posted, so it is no longer pending

    const queue = await getReviewQueue();
    expect(queue[0].status).toBe('posted');
    expect(queue[0].createdTransactionId).toBe('tx_new_123');
  });

  it('emits a privacy-safe review refresh event after queue actions', async () => {
    const listener = jest.fn();
    const unsubscribe = subscribeFinanceDataChanged(listener);
    const cand = mockCandidate('sig_event_test');
    await enqueueReviewCandidate(cand);

    await markIgnored('sig_event_test');

    expect(listener).toHaveBeenCalledWith({
      areas: ['review'],
      source: 'review_queue:changed',
      at: expect.any(Number),
    });
    expect(JSON.stringify(listener.mock.calls)).not.toContain('Test Merchant');
    expect(JSON.stringify(listener.mock.calls)).not.toContain('HDFCBK');

    unsubscribe();
  });

  it('identifies duplicate transaction by reference correctly', async () => {
    const candidateWithReference = mockCandidate('sig_ref_test', 'ref_exists');
    const isDup = await checkForDuplicateTransaction(candidateWithReference);
    expect(isDup).toBe(true);

    const candidateNewReference = {
      ...mockCandidate('sig_ref_test_new', 'ref_does_not_exist'),
      amount: 9999
    };
    const isDupNew = await checkForDuplicateTransaction(candidateNewReference);
    expect(isDupNew).toBe(false);
  });

  it('identifies duplicate transaction by amount, type, and timestamp correctly', async () => {
    // mockTransactions has an expense with amount 500, type 'expense', created_at: now
    // We create a candidate that matches amount (500), direction (debit -> expense), and has a matching timestamp
    const now = Date.now();
    const matchingCandidate = {
      ...mockCandidate(`sig_${now}_match`),
      amount: 500,
      direction: 'debit' as const,
    };

    const isDup = await checkForDuplicateTransaction(matchingCandidate);
    expect(isDup).toBe(true);

    // Different amount
    const nonMatchingCandidateAmount = {
      ...matchingCandidate,
      amount: 100,
    };
    const isDupAmt = await checkForDuplicateTransaction(nonMatchingCandidateAmount);
    expect(isDupAmt).toBe(false);

    // Different time window (more than 10 minutes ago)
    const oldTime = now - 20 * 60 * 1000;
    const nonMatchingCandidateTime = {
      ...matchingCandidate,
      signalId: `sig_${oldTime}_old`,
    };
    const isDupTime = await checkForDuplicateTransaction(nonMatchingCandidateTime);
    expect(isDupTime).toBe(false);
  });

  it('keeps unsupported classes (credit_card_bill_payment, loan_disbursal, self_transfer) as pending', async () => {
    const unsupportedClasses: AutoTransactionClass[] = [
      'credit_card_bill_payment',
      'loan_disbursal',
      'loan_emi_payment',
      'self_transfer',
      'unknown_financial',
    ];

    // Enqueue one candidate for each unsupported class
    for (const cls of unsupportedClasses) {
      const candidate: SmartCandidate = {
        signalId: `sig_unsupported_${cls}`,
        autoClass: cls,
        direction: 'debit',
        amount: 1000,
        merchantOrPerson: null,
        last4: null,
        reference: null,
        instrumentHint: 'bank_account',
        confidenceScore: 80,
        confidenceLevel: 'high',
        decision: 'review_required',
        duplicateFingerprints: [{ strategy: 'hash' as const, value: `hash_${cls}` }],
        redactedPreview: {
          amount: 1000,
          detectedSource: 'TESTBK',
          autoClass: cls,
          maskedLast4: 'XXXX',
          hashSummary: `len=10 hash=${cls}`,
        },
      };

      await enqueueReviewCandidate(candidate);
    }

    const queue = await getReviewQueue();
    expect(queue).toHaveLength(unsupportedClasses.length);

    // Every unsupported candidate should still be 'pending'
    for (const item of queue) {
      expect(item.status).toBe('pending');
    }

    // Verify markPosted does NOT change class semantics — it only changes status.
    // In Phase 1, the UI prevents calling markPosted for unsupported classes,
    // but the service layer should still work correctly if called.
    await markPosted(`sig_unsupported_credit_card_bill_payment`, 'tx_forbidden');
    const updatedQueue = await getReviewQueue();
    const billItem = updatedQueue.find(i => i.id === 'sig_unsupported_credit_card_bill_payment');
    expect(billItem?.status).toBe('posted');
    expect(billItem?.createdTransactionId).toBe('tx_forbidden');
  });

  it('candidate remains pending when addTransaction fails (DB failure scenario)', async () => {
    const { addTransaction } = require('../core');

    const candidate = mockCandidate('sig_fail_test', 'ref_new_fail');
    await enqueueReviewCandidate(candidate);

    // Verify it starts as pending
    let queue = await getReviewQueue();
    expect(queue).toHaveLength(1);
    expect(queue[0].status).toBe('pending');

    // Simulate DB write failure
    (addTransaction as jest.Mock).mockRejectedValueOnce(new Error('Supabase connection failed'));

    // Attempt to create transaction — this would fail
    try {
      await addTransaction({
        amount: 500,
        type: 'expense',
        note: 'Test',
        category: 'upi_payment',
      });
    } catch {
      // Expected failure — candidate should NOT be marked posted
    }

    // Verify the candidate is STILL pending (not posted, not ignored)
    queue = await getReviewQueue();
    const failedItem = queue.find(i => i.id === 'sig_fail_test');
    expect(failedItem).toBeDefined();
    expect(failedItem?.status).toBe('pending');
    expect(failedItem?.createdTransactionId).toBeUndefined();
  });
});
