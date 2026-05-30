import { TransactionReconciliationProposal } from './transactionReconciliationProposals';

const CONFIRMABLE_REASON_BY_CONFIDENCE = {
  exact: 'same_reference_bank_evidence',
  high: 'amount_time_single_bank_evidence',
} as const;

export function validateProposalCanBeConfirmed(
  proposal: TransactionReconciliationProposal
): boolean {
  if (!proposal.transactionId || !proposal.matchedOwnerId || !proposal.matchedOwnerType) return false;
  if (!proposal.evidenceIds.length) return false;
  if (proposal.decision !== 'attach_account' && proposal.decision !== 'link_existing_transaction') return false;
  if (proposal.matchStatus === 'ambiguous' || proposal.matchStatus === 'review_required') return false;
  if (proposal.reasonCode === 'upi_only_not_bank_proof' || proposal.reasonCode === 'payment_app_only') {
    return false;
  }
  if (proposal.confidence !== 'exact' && proposal.confidence !== 'high') return false;

  return proposal.reasonCode === CONFIRMABLE_REASON_BY_CONFIDENCE[proposal.confidence];
}
