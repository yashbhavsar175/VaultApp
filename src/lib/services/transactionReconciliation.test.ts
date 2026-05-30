declare const require: (moduleName: string) => any;
declare const __dirname: string;

const fs = require('fs');
const path = require('path');
import {
  KnownAccount,
  KnownMapping,
  ReconciliationEvidence,
  classifyAccountMatchConfidence,
  isAmountMatch,
  isCloseTime,
  isReferenceMatch,
  normalizeReference,
  reconcileEvidenceSet,
  scoreEvidenceMatch,
  shouldRequireReview,
} from './transactionReconciliation';

const T0 = Date.parse('2026-05-30T10:00:00.000Z');

const hdfcAccount: KnownAccount = {
  id: 'bank_hdfc_1',
  ownerType: 'bank_account',
  bankName: 'HDFC Bank',
  accountLast4: '1234',
};

const iciciAccount: KnownAccount = {
  id: 'bank_icici_1',
  ownerType: 'bank_account',
  bankName: 'ICICI Bank',
  accountLast4: '4321',
};

const axisAccountSameLast4: KnownAccount = {
  id: 'bank_axis_same_last4',
  ownerType: 'bank_account',
  bankName: 'Axis Bank',
  accountLast4: '1234',
};

function appEvidence(overrides: Partial<ReconciliationEvidence> = {}): ReconciliationEvidence {
  return {
    id: 'app_1',
    sourceType: 'notification',
    sourcePackage: 'com.google.android.apps.nbu.paisa.user',
    sourceApp: 'GPay',
    amount: 501.25,
    direction: 'debit',
    capturedAt: T0,
    referenceNumber: 'UPI Ref No 321654987123',
    merchantOrPerson: 'safe merchant',
    upiIdMasked: 'user***@oksbi',
    upiIdHash: 'abcdef123456',
    ...overrides,
  };
}

function bankEvidence(overrides: Partial<ReconciliationEvidence> = {}): ReconciliationEvidence {
  return {
    id: 'bank_1',
    sourceType: 'sms',
    amount: 501.25,
    direction: 'debit',
    capturedAt: T0 + 45_000,
    referenceNumber: 'UTR 321654987123',
    merchantOrPerson: 'safe merchant',
    bankName: 'HDFC Bank',
    accountLast4: '1234',
    instrumentHint: 'bank_account',
    ...overrides,
  };
}

function activeMapping(overrides: Partial<KnownMapping> = {}): KnownMapping {
  return {
    id: 'mapping_1',
    appPackage: 'com.google.android.apps.nbu.paisa.user',
    paymentMethodHash: 'abcdef123456',
    ownerType: 'bank_account',
    ownerId: 'bank_hdfc_1',
    confidenceLevel: 'medium',
    status: 'active',
    ...overrides,
  };
}

describe('transaction reconciliation pure engine', () => {
  it('normalizes and compares payment references safely', () => {
    expect(normalizeReference(' UPI Ref No: 321 654 987 123 ')).toBe('321654987123');
    expect(normalizeReference('utr-abc123xyz')).toBe('ABC123XYZ');
    expect(normalizeReference('ref no 123')).toBeNull();
    expect(normalizeReference('9876543210')).toBeNull();
    expect(isReferenceMatch('UPI Ref 321654987123', 'UTR: 321-654-987-123')).toBe(true);
  });

  it('keeps helper amount and time matching deterministic', () => {
    expect(isAmountMatch(50.0, 50.004)).toBe(true);
    expect(isAmountMatch(50.0, 50.02)).toBe(false);
    expect(isCloseTime(T0, T0 + 119_999)).toBe(true);
    expect(isCloseTime(T0, T0 + 121_000)).toBe(false);
    expect(classifyAccountMatchConfidence({ exactReference: true })).toBe('exact');
    expect(classifyAccountMatchConfidence({ mappingConfidence: 'medium' })).toBe('medium');
    expect(shouldRequireReview({ upiOnly: true })).toBe(true);
  });

  it('attaches HDFC exactly for GPay notification plus HDFC SMS with the same UTR', () => {
    const result = scoreEvidenceMatch({
      evidences: [appEvidence(), bankEvidence()],
      knownAccounts: [hdfcAccount],
    });

    expect(result).toEqual(expect.objectContaining({
      decision: 'attach_account',
      confidence: 'exact',
      matchStatus: 'linked',
      matchedOwnerType: 'bank_account',
      matchedOwnerId: 'bank_hdfc_1',
      reasonCode: 'same_reference_bank_evidence',
      score: 100,
    }));
    expect(result.matchedEvidenceIds).toEqual(['app_1', 'bank_1']);
  });

  it('attaches the correct account for PhonePe notification plus bank SMS with the same reference', () => {
    const result = scoreEvidenceMatch({
      evidences: [
        appEvidence({
          id: 'phonepe_1',
          sourcePackage: 'com.phonepe.app',
          sourceApp: 'PhonePe',
          referenceNumber: 'Ref No 999888777666',
          amount: 900,
        }),
        bankEvidence({
          id: 'icici_sms_1',
          bankName: 'ICICI Bank',
          accountLast4: '4321',
          referenceNumber: 'UTR: 999888777666',
          amount: 900,
        }),
      ],
      knownAccounts: [hdfcAccount, iciciAccount],
    });

    expect(result.decision).toBe('attach_account');
    expect(result.confidence).toBe('exact');
    expect(result.matchedOwnerId).toBe('bank_icici_1');
  });

  it('does not attach from same reference when bank evidence has no last4 proof', () => {
    const result = scoreEvidenceMatch({
      evidences: [
        appEvidence(),
        bankEvidence({
          accountLast4: null,
          cardLast4: null,
        }),
      ],
      knownAccounts: [hdfcAccount],
    });

    expect(result.decision).toBe('review_required');
    expect(result.confidence).toBe('low');
    expect(result.matchedOwnerId).toBeNull();
  });

  it('keeps conflicting bank references in review even when one bank signal matches exactly', () => {
    const result = scoreEvidenceMatch({
      evidences: [
        appEvidence({ referenceNumber: 'UTR 111222333444' }),
        bankEvidence({
          id: 'hdfc_sms_exact',
          referenceNumber: 'UPI Ref 111222333444',
        }),
        bankEvidence({
          id: 'icici_sms_conflict',
          bankName: 'ICICI Bank',
          accountLast4: '4321',
          referenceNumber: 'UTR 555666777888',
        }),
      ],
      knownAccounts: [hdfcAccount, iciciAccount],
    });

    expect(result.decision).toBe('review_required');
    expect(result.reasonCode).toBe('conflicting_reference');
    expect(result.matchedOwnerId).toBeNull();
  });

  it('attaches high confidence for one bank SMS with same amount and close timestamp', () => {
    const result = scoreEvidenceMatch({
      evidences: [
        appEvidence({
          referenceNumber: null,
          merchantOrPerson: 'Swiggy Mart',
        }),
        bankEvidence({
          referenceNumber: null,
          merchantOrPerson: 'Swiggy Store',
        }),
      ],
      knownAccounts: [hdfcAccount],
    });

    expect(result).toEqual(expect.objectContaining({
      decision: 'attach_account',
      confidence: 'high',
      reasonCode: 'amount_time_single_bank_evidence',
      matchedOwnerId: 'bank_hdfc_1',
    }));
    expect(result.score).toBeGreaterThan(80);
    expect(result.explanationTokens).toContain('merchant_overlap');
    expect(JSON.stringify(result)).not.toContain('Swiggy');
  });

  it('lets clear bank evidence beat a conflicting app mapping hint', () => {
    const result = scoreEvidenceMatch({
      evidences: [
        appEvidence({
          referenceNumber: null,
          upiIdHash: 'mapped_to_hdfc',
        }),
        bankEvidence({
          referenceNumber: null,
          bankName: 'ICICI Bank',
          accountLast4: '4321',
        }),
      ],
      knownAccounts: [hdfcAccount, iciciAccount],
      knownMappings: [
        activeMapping({
          paymentMethodHash: 'mapped_to_hdfc',
          ownerId: 'bank_hdfc_1',
        }),
      ],
    });

    expect(result.decision).toBe('attach_account');
    expect(result.confidence).toBe('high');
    expect(result.reasonCode).toBe('amount_time_single_bank_evidence');
    expect(result.matchedOwnerId).toBe('bank_icici_1');
  });

  it('uses an active user mapping as medium confidence and never exact', () => {
    const result = scoreEvidenceMatch({
      evidences: [appEvidence({ referenceNumber: null })],
      knownMappings: [activeMapping()],
    });

    expect(result).toEqual(expect.objectContaining({
      decision: 'attach_account',
      confidence: 'medium',
      matchStatus: 'linked',
      matchedOwnerType: 'bank_account',
      matchedOwnerId: 'bank_hdfc_1',
      reasonCode: 'user_mapping_hint',
    }));
    expect(result.confidence).not.toBe('exact');
  });

  it('ignores disabled mappings and does not attach a bank from payment app evidence alone', () => {
    const result = scoreEvidenceMatch({
      evidences: [appEvidence({ referenceNumber: null, upiIdMasked: null, upiIdHash: null })],
      knownMappings: [activeMapping({ status: 'disabled' })],
    });

    expect(result.decision).toBe('review_required');
    expect(result.confidence).toBe('low');
    expect(result.reasonCode).toBe('payment_app_only');
    expect(result.matchedOwnerId).toBeNull();
  });

  it('returns review for GPay-only evidence without bank proof or mapping', () => {
    const result = scoreEvidenceMatch({
      evidences: [appEvidence({ referenceNumber: null, upiIdMasked: null, upiIdHash: null })],
    });

    expect(result).toEqual(expect.objectContaining({
      decision: 'review_required',
      confidence: 'low',
      matchStatus: 'review_required',
      reasonCode: 'payment_app_only',
    }));
  });

  it('never attaches a bank from UPI ID, @oksbi, or @okaxis handle alone', () => {
    const cases = [
      {
        upiIdMasked: 'user***@oksbi',
        upiIdHash: 'oksbi_hash',
        account: {
          id: 'bank_sbi_1',
          ownerType: 'bank_account' as const,
          bankName: 'State Bank of India',
          accountLast4: '7777',
        },
      },
      {
        upiIdMasked: 'user***@okaxis',
        upiIdHash: 'okaxis_hash',
        account: {
          id: 'bank_axis_1',
          ownerType: 'bank_account' as const,
          bankName: 'Axis Bank',
          accountLast4: '8888',
        },
      },
    ];

    for (const testCase of cases) {
      const result = scoreEvidenceMatch({
        evidences: [
          appEvidence({
            referenceNumber: null,
            upiIdMasked: testCase.upiIdMasked,
            upiIdHash: testCase.upiIdHash,
          }),
        ],
        knownAccounts: [testCase.account],
      });

      expect(result.decision).toBe('review_required');
      expect(result.reasonCode).toBe('upi_only_not_bank_proof');
      expect(result.confidence).toBe('low');
      expect(result.matchedOwnerId).toBeNull();
    }
  });

  it('requires review when two bank SMS candidates match the same amount and time', () => {
    const result = scoreEvidenceMatch({
      evidences: [
        appEvidence({ sourcePackage: 'com.phonepe.app', referenceNumber: null }),
        bankEvidence({ id: 'hdfc_sms', referenceNumber: null }),
        bankEvidence({
          id: 'icici_sms',
          referenceNumber: null,
          bankName: 'ICICI Bank',
          accountLast4: '4321',
        }),
      ],
      knownAccounts: [hdfcAccount, iciciAccount],
    });

    expect(result.decision).toBe('review_required');
    expect(result.matchStatus).toBe('ambiguous');
    expect(result.reasonCode).toBe('multiple_bank_candidates');
  });

  it('requires review for conflicting directions and conflicting references', () => {
    const directionConflict = scoreEvidenceMatch({
      evidences: [appEvidence({ direction: 'debit' }), bankEvidence({ direction: 'credit' })],
      knownAccounts: [hdfcAccount],
    });

    expect(directionConflict.reasonCode).toBe('conflicting_direction');

    const referenceConflict = scoreEvidenceMatch({
      evidences: [
        appEvidence({ referenceNumber: 'UTR 111222333444' }),
        bankEvidence({ referenceNumber: 'UTR 555666777888' }),
      ],
      knownAccounts: [hdfcAccount],
    });

    expect(referenceConflict.reasonCode).toBe('conflicting_reference');
    expect(referenceConflict.decision).toBe('review_required');
  });

  it('requires review for missing amount and multiple known accounts with the same last4', () => {
    const missingAmount = scoreEvidenceMatch({
      evidences: [appEvidence({ amount: null }), bankEvidence()],
      knownAccounts: [hdfcAccount],
    });

    expect(missingAmount.reasonCode).toBe('insufficient_evidence');
    expect(missingAmount.decision).toBe('review_required');

    const duplicateLast4 = scoreEvidenceMatch({
      evidences: [appEvidence(), bankEvidence({ bankName: null })],
      knownAccounts: [hdfcAccount, axisAccountSameLast4],
    });

    expect(duplicateLast4.reasonCode).toBe('multiple_bank_candidates');
    expect(duplicateLast4.decision).toBe('review_required');
  });

  it('handles late bank evidence or late payment app evidence in either order', () => {
    const paymentFirst = reconcileEvidenceSet({
      evidences: [
        appEvidence({ capturedAt: T0 }),
        bankEvidence({ capturedAt: T0 + 10 * 60 * 1000 }),
      ],
      knownAccounts: [hdfcAccount],
    });
    const bankFirst = reconcileEvidenceSet({
      evidences: [
        bankEvidence({ id: 'bank_first', capturedAt: T0 }),
        appEvidence({ id: 'app_late', capturedAt: T0 + 10 * 60 * 1000 }),
      ],
      knownAccounts: [hdfcAccount],
    });

    expect(paymentFirst.confidence).toBe('exact');
    expect(paymentFirst.decision).toBe('attach_account');
    expect(bankFirst.confidence).toBe('exact');
    expect(bankFirst.decision).toBe('attach_account');
  });

  it('can represent linking to an existing transaction candidate without DB writes', () => {
    const result = scoreEvidenceMatch({
      evidences: [appEvidence(), bankEvidence()],
      knownAccounts: [hdfcAccount],
      existingTransactions: [{
        id: 'tx_existing',
        referenceNumber: '321654987123',
        amount: 501.25,
        capturedAt: T0,
      }],
    });

    expect(result.decision).toBe('link_existing_transaction');
    expect(result.reasonCode).toBe('same_reference_bank_evidence');
  });

  it('keeps special route ambiguity in review unless exact bank evidence exists', () => {
    const creditCardMappingOnly = scoreEvidenceMatch({
      evidences: [
        appEvidence({
          referenceNumber: null,
          merchantOrPerson: 'credit_card_bill_payment',
        }),
      ],
      knownMappings: [activeMapping()],
    });

    expect(creditCardMappingOnly.decision).toBe('review_required');
    expect(creditCardMappingOnly.reasonCode).toBe('ambiguous_payment_method');

    for (const merchantOrPerson of ['loan emi payment', 'refund from merchant', 'self_transfer']) {
      const result = scoreEvidenceMatch({
        evidences: [
          appEvidence({
            referenceNumber: null,
            merchantOrPerson,
          }),
        ],
        knownMappings: [activeMapping()],
      });

      expect(result.decision).toBe('review_required');
      expect(result.reasonCode).toBe('ambiguous_payment_method');
    }

    const exactSpecialRoute = scoreEvidenceMatch({
      evidences: [
        appEvidence({ merchantOrPerson: 'loan emi payment' }),
        bankEvidence(),
      ],
      knownAccounts: [hdfcAccount],
    });

    expect(exactSpecialRoute.decision).toBe('attach_account');
    expect(exactSpecialRoute.confidence).toBe('exact');
  });

  it('keeps explanations tokenized and excludes raw private values from results', () => {
    const result = scoreEvidenceMatch({
      evidences: [
        appEvidence({
          merchantOrPerson: 'Paid raw notification body OTP 123456 phone 9876543210 at Main Road yash@oksbi',
          referenceNumber: null,
          upiIdMasked: 'yash***@oksbi',
          upiIdHash: null,
        }),
      ],
    });

    for (const token of result.explanationTokens) {
      expect(token).toMatch(/^[a-z0-9_]+$/);
    }

    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain('raw notification body');
    expect(serialized).not.toContain('OTP');
    expect(serialized).not.toContain('123456');
    expect(serialized).not.toContain('9876543210');
    expect(serialized).not.toContain('Main Road');
    expect(serialized).not.toContain('yash@oksbi');
  });

  it('does not import side-effecting dependencies or runtime-wire processors yet', () => {
    const root = path.join(__dirname, '..', '..', '..');
    const engine = fs.readFileSync(
      path.join(root, 'src', 'lib', 'services', 'transactionReconciliation.ts'),
      'utf8'
    );
    const processors = fs.readFileSync(
      path.join(root, 'src', 'lib', 'processors', 'TransactionProcessors.ts'),
      'utf8'
    );
    const notifications = fs.readFileSync(
      path.join(root, 'src', 'lib', 'services', 'notifications.ts'),
      'utf8'
    );
    const smsParser = fs.readFileSync(
      path.join(root, 'src', 'lib', 'services', 'smsParser.ts'),
      'utf8'
    );

    expect(engine).not.toContain('supabase');
    expect(engine).not.toContain('AsyncStorage');
    expect(engine).not.toMatch(/\.from\(['"`]/);
    expect(processors).not.toContain('transactionReconciliation');
    expect(notifications).not.toContain('transactionReconciliation');
    expect(smsParser).not.toContain('transactionReconciliation');
  });
});
