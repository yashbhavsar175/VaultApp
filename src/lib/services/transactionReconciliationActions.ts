import { AccountMatchConfidence, AccountMatchOwnerType } from '../../types';
import { supabase } from '../core';
import { TransactionReconciliationProposal } from './transactionReconciliationProposals';
import { validateProposalCanBeConfirmed } from './transactionReconciliationConfirmability';

export { validateProposalCanBeConfirmed } from './transactionReconciliationConfirmability';

export interface ConfirmTransactionAccountMatchInput {
  transactionId: string;
  ownerType: AccountMatchOwnerType;
  ownerId: string;
  evidenceIds: string[];
  confidence: Exclude<AccountMatchConfidence, 'low'>;
  reason: string;
}

export interface ConfirmTransactionAccountMatchResult {
  transaction_id: string;
  status: 'manual_confirmed';
}

const SAFE_REASON_TOKEN = /^[a-z0-9_]{1,64}$/;
const SAFE_CONFIRM_REASONS_BY_CONFIDENCE = {
  exact: ['same_reference_bank_evidence'],
  high: ['amount_time_single_bank_evidence'],
  medium: ['user_mapping_hint', 'manual_user_choice'],
} as const;

function uniqueIds(ids: string[]): string[] {
  return Array.from(new Set(ids.map(id => id.trim()).filter(Boolean)));
}

function requireSafeConfirmInput(
  input: ConfirmTransactionAccountMatchInput
): ConfirmTransactionAccountMatchInput {
  const transactionId = input.transactionId.trim();
  const ownerId = input.ownerId.trim();
  const evidenceIds = uniqueIds(input.evidenceIds);
  const reason = input.reason.trim().toLowerCase();

  if (!transactionId) throw new Error('Existing transaction is required');
  if (!ownerId) throw new Error('Matched owner is required');
  if (!['bank_account', 'credit_card', 'debit_card'].includes(input.ownerType)) {
    throw new Error('Unsupported matched owner');
  }
  if (!evidenceIds.length) throw new Error('Evidence is required');
  if (!['exact', 'high', 'medium'].includes(input.confidence)) {
    throw new Error('Low-confidence proposals require manual review');
  }
  if (!SAFE_REASON_TOKEN.test(reason)) throw new Error('Unsafe match reason');
  if (!(SAFE_CONFIRM_REASONS_BY_CONFIDENCE[input.confidence] as readonly string[]).includes(reason)) {
    throw new Error('Proposal reason requires manual review');
  }

  return {
    transactionId,
    ownerType: input.ownerType,
    ownerId,
    evidenceIds,
    confidence: input.confidence,
    reason,
  };
}

export function buildConfirmPayloadFromProposal(
  proposal: TransactionReconciliationProposal
): ConfirmTransactionAccountMatchInput {
  if (!validateProposalCanBeConfirmed(proposal)) {
    throw new Error('Proposal cannot be confirmed without manual review');
  }

  return requireSafeConfirmInput({
    transactionId: proposal.transactionId!,
    ownerType: proposal.matchedOwnerType!,
    ownerId: proposal.matchedOwnerId!,
    evidenceIds: proposal.evidenceIds,
    confidence: proposal.confidence as 'exact' | 'high',
    reason: proposal.reasonCode,
  });
}

export async function confirmTransactionAccountMatch(
  input: ConfirmTransactionAccountMatchInput
): Promise<ConfirmTransactionAccountMatchResult> {
  const safeInput = requireSafeConfirmInput(input);
  const { data, error } = await supabase.rpc('confirm_transaction_account_match', {
    p_transaction_id: safeInput.transactionId,
    p_owner_type: safeInput.ownerType,
    p_owner_id: safeInput.ownerId,
    p_evidence_ids: safeInput.evidenceIds,
    p_confidence: safeInput.confidence,
    p_reason: safeInput.reason,
  });

  if (error) throw error;

  const result = Array.isArray(data) ? data[0] : data;
  if (!result?.transaction_id || result.status !== 'manual_confirmed') {
    throw new Error('Confirmed account match did not return a safe result');
  }

  return result as ConfirmTransactionAccountMatchResult;
}
