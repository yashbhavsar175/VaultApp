import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';
import Toast from 'react-native-toast-message';
import { AppHeader, Card, ScreenWrapper } from '../../components';
import { useTheme } from '../../context/ThemeContext';
import {
  buildConfirmPayloadFromProposal,
  confirmTransactionAccountMatch,
} from '../../lib/services/transactionReconciliationActions';
import { validateProposalCanBeConfirmed } from '../../lib/services/transactionReconciliationConfirmability';
import {
  TransactionReconciliationProposal,
  getRecentReconciliationProposals,
} from '../../lib/services/transactionReconciliationProposals';

const DECISION_LABELS: Record<TransactionReconciliationProposal['decision'], string> = {
  attach_account: 'Account match',
  link_existing_transaction: 'Existing transaction match',
  create_unknown_transaction: 'Unknown transaction',
  review_required: 'Review required',
  ignore: 'Ignore',
};

const CONFIDENCE_LABELS: Record<TransactionReconciliationProposal['confidence'], string> = {
  exact: 'Exact',
  high: 'High',
  medium: 'Medium',
  low: 'Low',
};

const REASON_LABELS: Record<string, string> = {
  same_reference_bank_evidence: 'Matched by same UTR/reference',
  amount_time_single_bank_evidence: 'Matched by bank evidence + amount/time',
  user_mapping_hint: 'User mapping hint',
  payment_app_only: 'Payment app only',
  upi_only_not_bank_proof: 'UPI-only not bank proof',
  multiple_bank_candidates: 'Multiple candidates',
  conflicting_direction: 'Conflicting direction',
  conflicting_reference: 'Conflicting reference',
  missing_bank_evidence: 'Missing bank evidence',
  ambiguous_payment_method: 'Ambiguous payment method',
  insufficient_evidence: 'Insufficient evidence',
};

const CONFIRM_REASON_LABELS: Record<string, string> = {
  same_reference_bank_evidence: 'Same UTR/reference',
  amount_time_single_bank_evidence: 'Bank evidence + amount/time',
};

const CONFIRM_WARNING =
  'This links the transaction to this account. It does not create a new transaction or change balances.';

function safeOwnerLabel(value?: string | null): string | null {
  const trimmed = (value || '').trim();
  if (!trimmed) return null;
  if (/[A-Za-z0-9._+-]{2,}@[A-Za-z][A-Za-z0-9.-]{1,}/.test(trimmed)) return null;
  if (/\b(?:\+?91[-\s]?)?[6-9]\d{9}\b/.test(trimmed)) return null;
  if (/\d(?:[ -]?\d){8,}/.test(trimmed)) return null;
  return trimmed.slice(0, 64);
}

function decisionTone(decision: TransactionReconciliationProposal['decision']) {
  if (decision === 'attach_account' || decision === 'link_existing_transaction') return 'good';
  if (decision === 'review_required') return 'warn';
  return 'neutral';
}

function displayConfidence(proposal: TransactionReconciliationProposal) {
  if (
    proposal.reasonCode === 'user_mapping_hint' &&
    (proposal.confidence === 'exact' || proposal.confidence === 'high')
  ) {
    return 'medium';
  }
  return proposal.confidence;
}

function formatFreshness(createdAt?: string | null): string {
  const parsed = createdAt ? Date.parse(createdAt) : NaN;
  if (!Number.isFinite(parsed)) return 'Created recently';

  const elapsedMs = Date.now() - parsed;
  if (elapsedMs < 60_000) return 'Created just now';
  if (elapsedMs < 60 * 60_000) return `Created ${Math.max(1, Math.round(elapsedMs / 60_000))}m ago`;
  if (elapsedMs < 24 * 60 * 60_000) return `Created ${Math.round(elapsedMs / (60 * 60_000))}h ago`;
  return new Date(parsed).toLocaleDateString();
}

function safeConfirmLogCode(error: unknown): string {
  const code = (error as { code?: unknown } | null)?.code;
  if (typeof code !== 'string') return 'unknown';
  return code.replace(/[^a-z0-9_]/gi, '').slice(0, 24) || 'unknown';
}

function getEligibilityDisplay(proposal: TransactionReconciliationProposal) {
  if (proposal.reasonCode === 'user_mapping_hint') {
    return {
      label: 'Hint only',
      helper: 'User mapping is a hint. Bank SMS can override it.',
      tone: 'neutral' as const,
      icon: 'information-outline',
    };
  }
  if (proposal.reasonCode === 'upi_only_not_bank_proof' || proposal.reasonCode === 'payment_app_only') {
    return {
      label: 'Needs review',
      helper: 'UPI handle is not bank proof.',
      tone: 'warn' as const,
      icon: 'alert-circle-outline',
    };
  }
  if (proposal.reasonCode === 'multiple_bank_candidates' || proposal.matchStatus === 'ambiguous') {
    return {
      label: 'Manual review required',
      helper: 'Multiple possible accounts. Choose carefully.',
      tone: 'warn' as const,
      icon: 'alert-circle-outline',
    };
  }
  if (validateProposalCanBeConfirmed(proposal)) {
    return {
      label: 'Can confirm after review',
      helper: 'This match has bank evidence. Confirmation will require your tap.',
      tone: 'good' as const,
      icon: 'check-circle-outline',
    };
  }
  return {
    label: 'Needs review',
    helper: 'Review the evidence quality before any future confirmation.',
    tone: 'warn' as const,
    icon: 'alert-circle-outline',
  };
}

export default function ReconciliationProposalsScreen() {
  const { colors, typography, spacing, borderRadius } = useTheme();
  const [proposals, setProposals] = useState<TransactionReconciliationProposal[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(false);
  const [selectedProposal, setSelectedProposal] = useState<TransactionReconciliationProposal | null>(null);
  const [confirmingProposalId, setConfirmingProposalId] = useState<string | null>(null);
  const confirmingRef = useRef(false);

  const loadProposals = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    try {
      const nextProposals = await getRecentReconciliationProposals();
      setProposals(nextProposals);
      setError(false);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    loadProposals();
  }, [loadProposals]);

  const closeConfirmModal = useCallback(() => {
    if (confirmingRef.current) return;
    setSelectedProposal(null);
  }, []);

  const openConfirmModal = useCallback((proposal: TransactionReconciliationProposal) => {
    if (!validateProposalCanBeConfirmed(proposal)) {
      Toast.show({
        type: 'info',
        text1: 'Review required',
        text2: 'This proposal needs manual review before it can be linked.',
      });
      return;
    }
    setSelectedProposal(proposal);
  }, []);

  const handleConfirmMatch = useCallback(async () => {
    const proposal = selectedProposal;
    if (!proposal || confirmingRef.current) return;

    let payload;
    try {
      payload = buildConfirmPayloadFromProposal(proposal);
    } catch {
      Toast.show({
        type: 'error',
        text1: 'Match not confirmed',
        text2: 'This proposal needs manual review before it can be linked.',
      });
      return;
    }

    confirmingRef.current = true;
    setConfirmingProposalId(proposal.proposalId);

    try {
      await confirmTransactionAccountMatch(payload);
      Toast.show({
        type: 'success',
        text1: 'Match confirmed',
        text2: 'The transaction was linked without changing balances.',
      });
      setSelectedProposal(null);
      await loadProposals(true);
    } catch (confirmError) {
      console.warn('[ReconciliationProposals] Confirm match failed', {
        code: safeConfirmLogCode(confirmError),
      });
      Toast.show({
        type: 'error',
        text1: 'Match not confirmed',
        text2: 'Could not confirm this match. Please refresh and review again.',
      });
    } finally {
      confirmingRef.current = false;
      setConfirmingProposalId(null);
    }
  }, [loadProposals, selectedProposal]);

  const renderPill = (label: string, tone: 'good' | 'warn' | 'neutral' = 'neutral') => {
    const color = tone === 'good' ? '#10b981' : tone === 'warn' ? '#f59e0b' : colors.subtext;
    return (
      <View style={[styles.pill, { borderColor: `${color}55`, backgroundColor: `${color}12` }]}>
        <Text style={[typography.caption, styles.pillText, { color }]} numberOfLines={1}>
          {label}
        </Text>
      </View>
    );
  };

  const renderProposal = (proposal: TransactionReconciliationProposal) => {
    const isAppOnly = proposal.reasonCode === 'upi_only_not_bank_proof' || proposal.reasonCode === 'payment_app_only';
    const ownerLabel = isAppOnly ? null : safeOwnerLabel(proposal.matchedOwnerLabel);
    const eligibility = getEligibilityDisplay(proposal);
    const eligibilityColor = eligibility.tone === 'good' ? '#10b981' : eligibility.tone === 'warn' ? '#f59e0b' : '#06b6d4';
    const reasonLabel = REASON_LABELS[proposal.reasonCode] || 'Review required';
    const evidenceLabel = `${proposal.evidenceIds.length} evidence ${proposal.evidenceIds.length === 1 ? 'signal' : 'signals'}`;
    const canConfirm = validateProposalCanBeConfirmed(proposal);
    const isConfirming = confirmingProposalId === proposal.proposalId;

    return (
      <Card key={proposal.proposalId} style={{ marginBottom: spacing.md }}>
        <View style={styles.cardHeader}>
          <View style={{ flex: 1, marginRight: spacing.sm }}>
            <Text style={[typography.bodyBold, { color: colors.text }]} numberOfLines={1}>
              {DECISION_LABELS[proposal.decision]}
            </Text>
            <Text style={[typography.caption, { color: colors.subtext, marginTop: 3 }]} numberOfLines={1}>
              {reasonLabel}
            </Text>
          </View>
          {renderPill(CONFIDENCE_LABELS[displayConfidence(proposal)], decisionTone(proposal.decision))}
        </View>

        {ownerLabel ? (
          <View style={[styles.ownerRow, { backgroundColor: colors.background, borderRadius: borderRadius.md }]}>
            <MaterialCommunityIcons name="bank-check" size={18} color="#10b981" />
            <Text style={[typography.body, { color: colors.text, marginLeft: spacing.sm, flex: 1 }]} numberOfLines={1}>
              {ownerLabel}
            </Text>
          </View>
        ) : (
          <View style={[styles.ownerRow, { backgroundColor: colors.background, borderRadius: borderRadius.md }]}>
            <MaterialCommunityIcons name="help-circle-outline" size={18} color={colors.subtext} />
            <Text style={[typography.body, { color: colors.subtext, marginLeft: spacing.sm, flex: 1 }]} numberOfLines={1}>
              Unknown account
            </Text>
          </View>
        )}

        <Text style={[typography.caption, { color: colors.subtext, marginTop: spacing.sm }]}>
          {eligibility.helper}
        </Text>

        <View style={[styles.eligibilityBanner, { borderColor: `${eligibilityColor}55`, backgroundColor: `${eligibilityColor}12` }]}>
          <MaterialCommunityIcons name={eligibility.icon} size={16} color={eligibilityColor} />
          <Text style={[typography.caption, { color: eligibilityColor, marginLeft: 6, flex: 1, fontWeight: '700' }]}>
              {eligibility.label}
            </Text>
        </View>

        {canConfirm ? (
          <TouchableOpacity
            testID={`confirm-match-${proposal.proposalId}`}
            style={[
              styles.confirmButton,
              {
                backgroundColor: colors.accent,
                borderRadius: borderRadius.md,
                opacity: isConfirming ? 0.7 : 1,
              },
            ]}
            disabled={isConfirming}
            activeOpacity={0.75}
            onPress={() => openConfirmModal(proposal)}>
            <MaterialCommunityIcons name="shield-check-outline" size={18} color="#ffffff" />
            <Text style={[typography.caption, { color: '#ffffff', marginLeft: 6, fontWeight: '800' }]}>
              {isConfirming ? 'Confirming...' : 'Confirm Match'}
            </Text>
          </TouchableOpacity>
        ) : null}

        <View style={[styles.metaRow, { borderTopColor: colors.border }]}>
          <Text style={[typography.caption, { color: colors.subtext }]}>Score {proposal.score}</Text>
          <Text style={[typography.caption, { color: colors.subtext }]}>{evidenceLabel}</Text>
          <Text style={[typography.caption, { color: colors.subtext }]}>{formatFreshness(proposal.createdAt)}</Text>
        </View>
      </Card>
    );
  };

  const renderConfirmModal = () => {
    const proposal = selectedProposal;
    const ownerLabel = safeOwnerLabel(proposal?.matchedOwnerLabel) || 'Matched account';
    const confidenceLabel = proposal ? CONFIDENCE_LABELS[proposal.confidence] : '';
    const reasonLabel = proposal ? CONFIRM_REASON_LABELS[proposal.reasonCode] || 'Bank evidence reviewed' : '';
    const evidenceLabel = proposal
      ? `${proposal.evidenceIds.length} evidence ${proposal.evidenceIds.length === 1 ? 'signal' : 'signals'}`
      : '';
    const isConfirming = Boolean(proposal && confirmingProposalId === proposal.proposalId);

    return (
      <Modal
        visible={Boolean(proposal)}
        transparent
        animationType="fade"
        statusBarTranslucent
        onRequestClose={closeConfirmModal}>
        <View style={styles.modalOverlay}>
          {proposal ? (
            <View style={[
              styles.modalCard,
              {
                backgroundColor: colors.card,
                borderRadius: borderRadius.lg,
                borderColor: colors.border,
              },
            ]}>
              <Text style={[typography.bodyBold, { color: colors.text }]}>
                Confirm Account Match
              </Text>
              <Text style={[typography.caption, { color: colors.subtext, marginTop: spacing.xs }]}>
                Review the bank evidence before linking this transaction.
              </Text>

              <View style={[styles.modalDetailBox, { backgroundColor: colors.background, borderRadius: borderRadius.md }]}>
                <View style={styles.modalDetailRow}>
                  <Text style={[typography.caption, styles.modalDetailLabel, { color: colors.subtext }]}>Account</Text>
                  <Text style={[typography.body, styles.modalDetailValue, { color: colors.text }]} numberOfLines={1}>
                    {ownerLabel}
                  </Text>
                </View>
                <View style={styles.modalDetailRow}>
                  <Text style={[typography.caption, styles.modalDetailLabel, { color: colors.subtext }]}>Confidence</Text>
                  <Text style={[typography.body, styles.modalDetailValue, { color: colors.text }]}>
                    {confidenceLabel}
                  </Text>
                </View>
                <View style={styles.modalDetailRow}>
                  <Text style={[typography.caption, styles.modalDetailLabel, { color: colors.subtext }]}>Reason</Text>
                  <Text style={[typography.body, styles.modalDetailValue, { color: colors.text }]}>
                    {reasonLabel}
                  </Text>
                </View>
                <View style={styles.modalDetailRow}>
                  <Text style={[typography.caption, styles.modalDetailLabel, { color: colors.subtext }]}>Evidence</Text>
                  <Text style={[typography.body, styles.modalDetailValue, { color: colors.text }]}>
                    {evidenceLabel}
                  </Text>
                </View>
              </View>

              <View style={[styles.warningBox, { borderColor: '#f59e0b55', backgroundColor: '#f59e0b12' }]}>
                <MaterialCommunityIcons name="alert-outline" size={17} color="#f59e0b" />
                <Text style={[typography.caption, { color: colors.text, marginLeft: 8, flex: 1, lineHeight: 18 }]}>
                  {CONFIRM_WARNING}
                </Text>
              </View>

              <View style={styles.modalButtonRow}>
                <TouchableOpacity
                  testID="confirm-match-modal-cancel"
                  style={[styles.modalButton, styles.cancelButton, { borderColor: colors.border, borderRadius: borderRadius.md }]}
                  disabled={isConfirming}
                  activeOpacity={0.75}
                  onPress={closeConfirmModal}>
                  <Text style={[typography.caption, { color: colors.subtext, fontWeight: '800' }]}>
                    Cancel
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  testID="confirm-match-modal-submit"
                  style={[
                    styles.modalButton,
                    {
                      backgroundColor: colors.accent,
                      borderColor: colors.accent,
                      borderRadius: borderRadius.md,
                      opacity: isConfirming ? 0.7 : 1,
                    },
                  ]}
                  disabled={isConfirming}
                  activeOpacity={0.75}
                  onPress={handleConfirmMatch}>
                  {isConfirming ? (
                    <ActivityIndicator color="#ffffff" size="small" />
                  ) : (
                    <Text style={[typography.caption, { color: '#ffffff', fontWeight: '800' }]}>
                      Confirm Match
                    </Text>
                  )}
                </TouchableOpacity>
              </View>
            </View>
          ) : null}
        </View>
      </Modal>
    );
  };

  return (
    <>
      <ScreenWrapper>
        <AppHeader
          title="Reconciliation Proposals"
          showBack
          rightAction={{ icon: 'refresh', onPress: () => loadProposals(true) }}
        />

        <ScrollView
          contentContainerStyle={[styles.content, { padding: spacing.md }]}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => loadProposals(true)}
              tintColor={colors.accent}
            />
          }>
          {loading ? (
            <View style={styles.centerState}>
              <ActivityIndicator color={colors.accent} />
              <Text style={[typography.body, { color: colors.subtext, marginTop: spacing.md }]}>
                Loading proposals
              </Text>
            </View>
          ) : error ? (
            <View style={styles.centerState}>
              <MaterialCommunityIcons name="alert-circle-outline" size={42} color="#f59e0b" />
              <Text style={[typography.bodyBold, { color: colors.text, marginTop: spacing.md }]}>
                Could not load proposals
              </Text>
              <Text style={[typography.caption, styles.centerText, { color: colors.subtext, marginTop: spacing.xs }]}>
                Pull to refresh or try again.
              </Text>
              <TouchableOpacity
                style={[styles.retryButton, { borderColor: colors.border, borderRadius: borderRadius.md }]}
                onPress={() => loadProposals(true)}>
                <MaterialCommunityIcons name="refresh" size={18} color={colors.accent} />
                <Text style={[typography.caption, { color: colors.accent, marginLeft: 6, fontWeight: '700' }]}>
                  Refresh
                </Text>
              </TouchableOpacity>
            </View>
          ) : proposals.length === 0 ? (
            <View style={styles.centerState}>
              <MaterialCommunityIcons name="source-branch-sync" size={44} color={colors.subtext} />
              <Text style={[typography.bodyBold, { color: colors.text, marginTop: spacing.md }]}>
                No reconciliation proposals yet
              </Text>
              <Text style={[typography.caption, styles.centerText, { color: colors.subtext, marginTop: spacing.xs }]}>
                Payment match suggestions will appear here for review and explicit confirmation.
              </Text>
            </View>
          ) : (
            proposals.map(renderProposal)
          )}
        </ScrollView>
      </ScreenWrapper>
      {renderConfirmModal()}
    </>
  );
}

const styles = StyleSheet.create({
  content: {
    flexGrow: 1,
  },
  centerState: {
    flex: 1,
    minHeight: 360,
    alignItems: 'center',
    justifyContent: 'center',
  },
  centerText: {
    textAlign: 'center',
    maxWidth: 280,
  },
  retryButton: {
    marginTop: 16,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 9,
    flexDirection: 'row',
    alignItems: 'center',
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  pill: {
    minHeight: 28,
    maxWidth: 110,
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 9,
    paddingVertical: 5,
    justifyContent: 'center',
  },
  pillText: {
    fontWeight: '700',
    textAlign: 'center',
  },
  ownerRow: {
    minHeight: 42,
    marginTop: 12,
    paddingHorizontal: 10,
    paddingVertical: 9,
    flexDirection: 'row',
    alignItems: 'center',
  },
  eligibilityBanner: {
    marginTop: 10,
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 9,
    paddingVertical: 7,
    flexDirection: 'row',
    alignItems: 'center',
  },
  confirmButton: {
    minHeight: 42,
    marginTop: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  metaRow: {
    marginTop: 12,
    paddingTop: 10,
    borderTopWidth: 1,
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    gap: 8,
  },
  modalOverlay: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
    backgroundColor: 'rgba(15,23,42,0.55)',
  },
  modalCard: {
    width: '100%',
    maxWidth: 420,
    borderWidth: 1,
    padding: 18,
  },
  modalDetailBox: {
    marginTop: 14,
    padding: 12,
    gap: 10,
  },
  modalDetailRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  modalDetailLabel: {
    width: 82,
    fontWeight: '700',
  },
  modalDetailValue: {
    flex: 1,
    fontWeight: '700',
  },
  warningBox: {
    marginTop: 14,
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 9,
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  modalButtonRow: {
    marginTop: 16,
    flexDirection: 'row',
    gap: 10,
  },
  modalButton: {
    flex: 1,
    minHeight: 42,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  cancelButton: {
    backgroundColor: 'transparent',
  },
});
