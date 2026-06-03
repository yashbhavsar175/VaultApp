import { supabase } from '../core';
import {
  buildConfirmPayloadFromProposal,
  confirmTransactionAccountMatch,
  validateProposalCanBeConfirmed,
} from './transactionReconciliationActions';
import { TransactionReconciliationProposal } from './transactionReconciliationProposals';

jest.mock('../core', () => ({
  supabase: {
    rpc: jest.fn(),
    from: jest.fn(),
  },
}));

const mockedSupabase = supabase as unknown as {
  rpc: jest.Mock;
  from: jest.Mock;
};

function proposal(
  overrides: Partial<TransactionReconciliationProposal> = {}
): TransactionReconciliationProposal {
  return {
    proposalId: 'proposal_1',
    transactionId: 'tx_1',
    evidenceIds: ['evidence_app', 'evidence_bank'],
    decision: 'link_existing_transaction',
    confidence: 'exact',
    matchStatus: 'linked',
    matchedOwnerType: 'bank_account',
    matchedOwnerId: 'bank_1',
    matchedOwnerLabel: 'HDFC Bank ••1234',
    reasonCode: 'same_reference_bank_evidence',
    explanationTokens: ['same_reference', 'bank_evidence'],
    evidenceSummary: {
      sourceTypes: ['notification', 'sms'],
      direction: 'debit',
      amountPresent: true,
      referencePresent: true,
      bankProofCount: 1,
      accountLast4s: ['1234'],
      cardLast4s: [],
      bankNames: ['HDFC Bank'],
      paymentAppHint: true,
    },
    score: 100,
    createdAt: '2026-05-30T00:00:00.000Z',
    ...overrides,
  };
}

describe('transaction reconciliation confirmed actions', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it.each([
    proposal(),
    proposal({
      confidence: 'high',
      reasonCode: 'amount_time_single_bank_evidence',
    }),
  ])('allows safe exact/high proposals with an existing transaction', candidate => {
    expect(validateProposalCanBeConfirmed(candidate)).toBe(true);
  });

  it.each([
    proposal({
      confidence: 'low',
      reasonCode: 'upi_only_not_bank_proof',
      decision: 'review_required',
      matchStatus: 'review_required',
      matchedOwnerId: null,
      matchedOwnerType: null,
    }),
    proposal({
      confidence: 'medium',
      reasonCode: 'user_mapping_hint',
    }),
    proposal({
      confidence: 'low',
      reasonCode: 'multiple_bank_candidates',
      decision: 'review_required',
      matchStatus: 'ambiguous',
      matchedOwnerId: null,
      matchedOwnerType: null,
    }),
    proposal({
      transactionId: null,
    }),
    proposal({
      decision: 'create_unknown_transaction',
    }),
    proposal({
      matchStatus: 'review_required',
    }),
  ])('rejects proposals that need manual review or lack an existing transaction', candidate => {
    expect(validateProposalCanBeConfirmed(candidate)).toBe(false);
  });

  it('builds a minimal privacy-safe payload and deduplicates evidence ids', () => {
    const candidate = proposal({
      evidenceIds: [' evidence_app ', 'evidence_bank', 'evidence_app'],
    }) as TransactionReconciliationProposal & {
      raw_source_metadata?: unknown;
      raw_sms?: string;
      upi_id?: string;
    };
    candidate.raw_source_metadata = { body: 'secret notification body' };
    candidate.raw_sms = 'OTP 123456';
    candidate.upi_id = 'raw@oksbi';

    const payload = buildConfirmPayloadFromProposal(candidate);
    const serialized = JSON.stringify(payload);

    expect(payload).toEqual({
      transactionId: 'tx_1',
      ownerType: 'bank_account',
      ownerId: 'bank_1',
      evidenceIds: ['evidence_app', 'evidence_bank'],
      confidence: 'exact',
      reason: 'same_reference_bank_evidence',
    });
    expect(serialized).not.toContain('secret notification body');
    expect(serialized).not.toContain('OTP');
    expect(serialized).not.toContain('raw@oksbi');
  });

  it('calls only the atomic RPC with the safe payload', async () => {
    mockedSupabase.rpc.mockResolvedValue({
      data: [{ transaction_id: 'tx_1', status: 'manual_confirmed' }],
      error: null,
    });

    await expect(confirmTransactionAccountMatch({
      transactionId: ' tx_1 ',
      ownerType: 'bank_account',
      ownerId: ' bank_1 ',
      evidenceIds: [' evidence_bank ', 'evidence_bank'],
      confidence: 'exact',
      reason: 'same_reference_bank_evidence',
    })).resolves.toEqual({
      transaction_id: 'tx_1',
      status: 'manual_confirmed',
    });

    expect(mockedSupabase.rpc).toHaveBeenCalledWith('confirm_transaction_account_match', {
      p_transaction_id: 'tx_1',
      p_owner_type: 'bank_account',
      p_owner_id: 'bank_1',
      p_evidence_ids: ['evidence_bank'],
      p_confidence: 'exact',
      p_reason: 'same_reference_bank_evidence',
    });
    expect(mockedSupabase.from).not.toHaveBeenCalled();
  });

  it('does not call RPC for low confidence or unsafe free-text reasons', async () => {
    await expect(confirmTransactionAccountMatch({
      transactionId: 'tx_1',
      ownerType: 'bank_account',
      ownerId: 'bank_1',
      evidenceIds: ['evidence_bank'],
      confidence: 'low' as 'medium',
      reason: 'upi_only_not_bank_proof',
    })).rejects.toThrow('Low-confidence proposals require manual review');

    await expect(confirmTransactionAccountMatch({
      transactionId: 'tx_1',
      ownerType: 'bank_account',
      ownerId: 'bank_1',
      evidenceIds: ['evidence_bank'],
      confidence: 'medium',
      reason: 'raw notification body',
    })).rejects.toThrow('Unsafe match reason');

    await expect(confirmTransactionAccountMatch({
      transactionId: 'tx_1',
      ownerType: 'bank_account',
      ownerId: 'bank_1',
      evidenceIds: ['evidence_bank'],
      confidence: 'medium',
      reason: 'upi_only_not_bank_proof',
    })).rejects.toThrow('Proposal reason requires manual review');

    expect(mockedSupabase.rpc).not.toHaveBeenCalled();
  });
});
