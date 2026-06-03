import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';
import { AppHeader, Card, ScreenWrapper } from '../../components';
import { useTheme } from '../../context/ThemeContext';
import { financeDataChangedAffects, subscribeFinanceDataChanged } from '../../lib/services/dataEvents';
import {
  deleteIncomeReviewDecision,
  getIncomeReviewScreenState,
  IncomeReviewCandidate,
  IncomeReviewIncomeSourceType,
  IncomeReviewStorageStatus,
  saveIncomeReviewDecision,
} from '../../lib/services/incomeReview';

export const APPROVED_INCOME_REVIEW_ICONS = [
  'alert-circle-outline',
  'bank-transfer-in',
  'cash-check',
  'cash-remove',
  'check-circle-outline',
  'chevron-down',
  'close-circle-outline',
  'database-alert-outline',
  'pencil-outline',
  'refresh',
  'text-box-search-outline',
  'wallet-plus-outline',
] as const;

type IncomeReviewIconName = typeof APPROVED_INCOME_REVIEW_ICONS[number];

const INCOME_REVIEW_ICONS = {
  alert: 'alert-circle-outline',
  credit: 'bank-transfer-in',
  count: 'cash-check',
  notIncome: 'cash-remove',
  reset: 'close-circle-outline',
  migration: 'database-alert-outline',
  refresh: 'refresh',
  review: 'text-box-search-outline',
  source: 'wallet-plus-outline',
  selected: 'check-circle-outline',
  open: 'chevron-down',
  change: 'pencil-outline',
} satisfies Record<string, IncomeReviewIconName>;

const SOURCE_OPTIONS: Array<{ value: IncomeReviewIncomeSourceType; label: string }> = [
  { value: 'salary', label: 'Salary' },
  { value: 'gig_work', label: 'Gig work' },
  { value: 'freelance', label: 'Freelance' },
  { value: 'business', label: 'Business' },
  { value: 'cash_deposit', label: 'Cash deposit' },
  { value: 'other', label: 'Other' },
];

function rupee(value: number): string {
  return `₹${Math.round(value).toLocaleString('en-IN')}`;
}

function dateLabel(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Date needs review';
  return date.toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

function decisionLabel(candidate: IncomeReviewCandidate): string {
  const decision = candidate.currentDecision?.decision || candidate.suggestedDecision;
  if (decision === 'count_as_income') return 'Count as income';
  if (decision === 'not_income') return 'Not income';
  return 'Keep reviewing';
}

function dashboardStatusLabel(candidate: IncomeReviewCandidate): string {
  const decision = candidate.currentDecision?.decision;
  if (decision === 'count_as_income' && candidate.transactionId) return 'Dashboard: Counted as reviewed income';
  if (decision === 'count_as_income') return 'Dashboard: Not counted until confirmed again';
  if (decision === 'not_income') return 'Dashboard: Not counted';
  return 'Dashboard: Not counted until reviewed';
}

function recentDecisionLabel(candidate: IncomeReviewCandidate): string {
  if (candidate.currentDecision?.decision === 'count_as_income' && candidate.transactionId) {
    return 'Counted as income';
  }
  if (candidate.currentDecision?.decision === 'count_as_income') {
    return 'Income confirmation needs refresh';
  }
  return 'Not income';
}

function sourceTypeLabel(value?: IncomeReviewIncomeSourceType | null): string {
  return SOURCE_OPTIONS.find(option => option.value === value)?.label || 'Source type';
}

function sourceHintLabel(value: IncomeReviewCandidate['sourceHint']): string {
  switch (value) {
    case 'upi_credit':
      return 'UPI credit';
    case 'bank_credit':
      return 'Bank credit';
    case 'gig_payout':
      return 'Gig payout';
    case 'salary':
      return 'Salary';
    case 'refund':
      return 'Refund';
    case 'personal_transfer':
      return 'Personal transfer';
    default:
      return 'Unknown credit';
  }
}

function defaultSourceType(candidate: IncomeReviewCandidate): IncomeReviewIncomeSourceType {
  if (candidate.suggestedIncomeSourceType) return candidate.suggestedIncomeSourceType;
  if (candidate.sourceHint === 'salary') return 'salary';
  if (candidate.sourceHint === 'gig_payout') return 'gig_work';
  if (candidate.sourceHint === 'bank_credit') return 'cash_deposit';
  return 'other';
}

type IncomeReviewScreenProps = {
  embedded?: boolean;
};

export default function IncomeReviewScreen({ embedded = false }: IncomeReviewScreenProps) {
  const { colors, typography, spacing, borderRadius } = useTheme();
  const [candidates, setCandidates] = useState<IncomeReviewCandidate[]>([]);
  const [storageStatus, setStorageStatus] = useState<IncomeReviewStorageStatus>('ready');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sourceByCandidate, setSourceByCandidate] = useState<Record<string, IncomeReviewIncomeSourceType>>({});
  const [changingCandidateId, setChangingCandidateId] = useState<string | null>(null);
  const isMountedRef = useRef(true);
  const loadRequestIdRef = useRef(0);
  const activeCandidates = useMemo(() => candidates.filter(candidate => (
    !candidate.currentDecision || candidate.currentDecision.decision === 'needs_review'
  )), [candidates]);
  const recentlyReviewedCandidates = useMemo(() => candidates
    .filter(candidate => (
      candidate.currentDecision?.decision === 'count_as_income'
      || candidate.currentDecision?.decision === 'not_income'
    ))
    .sort((a, b) => (
      new Date(b.currentDecision?.reviewed_at || 0).getTime()
      - new Date(a.currentDecision?.reviewed_at || 0).getTime()
    ))
    .slice(0, 5), [candidates]);

  useEffect(() => {
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const load = useCallback(async (isRefresh = false) => {
    const requestId = ++loadRequestIdRef.current;
    if (isRefresh) setRefreshing(true);
    try {
      const state = await getIncomeReviewScreenState({ showExcluded: true });
      if (!isMountedRef.current || requestId !== loadRequestIdRef.current) return;
      setCandidates(state.candidates);
      setStorageStatus(state.storageStatus);
      setError(null);
    } catch {
      if (!isMountedRef.current || requestId !== loadRequestIdRef.current) return;
      setError('Could not load income review.');
    } finally {
      if (isMountedRef.current && requestId === loadRequestIdRef.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    return subscribeFinanceDataChanged(payload => {
      if (financeDataChangedAffects(payload, ['transactions', 'review'])) {
        load(true);
      }
    });
  }, [load]);

  const saveDecision = async (
    candidate: IncomeReviewCandidate,
    decision: 'count_as_income' | 'not_income' | 'needs_review'
  ) => {
    if (storageStatus !== 'ready') return;
    setSavingId(candidate.id);
    setError(null);
    try {
      if (decision === 'needs_review' && candidate.currentDecision?.id) {
        await deleteIncomeReviewDecision(candidate.currentDecision.id);
      } else {
        await saveIncomeReviewDecision({
          transaction_id: candidate.transactionId || null,
          evidence_id: candidate.evidenceId || null,
          signal_hash: candidate.signalHash || null,
          decision,
          income_source_type: decision === 'count_as_income'
            ? sourceByCandidate[candidate.id] || candidate.currentDecision?.income_source_type || defaultSourceType(candidate)
            : null,
          reason_code: candidate.sourceHint,
        });
      }
      setChangingCandidateId(null);
      if (decision === 'count_as_income' || decision === 'not_income') {
        const reviewedAt = new Date().toISOString();
        setCandidates(current => current.map(item => (
          item.id === candidate.id
            ? {
              ...item,
              currentDecision: {
                id: candidate.currentDecision?.id || `local:${candidate.id}`,
                user_id: candidate.currentDecision?.user_id || '',
                transaction_id: candidate.transactionId || null,
                evidence_id: candidate.evidenceId || null,
                signal_hash: candidate.signalHash || null,
                decision,
                income_source_type: decision === 'count_as_income'
                  ? sourceByCandidate[candidate.id] || candidate.currentDecision?.income_source_type || defaultSourceType(candidate)
                  : null,
                confidence: 'user_confirmed',
                reason_code: candidate.sourceHint,
                reviewed_at: reviewedAt,
                created_at: candidate.currentDecision?.created_at || reviewedAt,
                updated_at: reviewedAt,
              },
            }
            : item
        )));
      }
      void load(true);
    } catch (saveError) {
      const code = (saveError as { code?: string } | null)?.code;
      setError(code === '42P01' || code === '42703' || code === 'PGRST204' || code === 'PGRST205'
        ? 'Income review storage is not ready yet.'
        : 'Could not save income review decision.');
    } finally {
      setSavingId(null);
    }
  };

  const renderSourcePicker = (candidate: IncomeReviewCandidate) => {
    const selected = sourceByCandidate[candidate.id]
      || candidate.currentDecision?.income_source_type
      || defaultSourceType(candidate);
    return (
      <View style={styles.sourceWrap}>
        <View style={styles.sourceHeader}>
          <MaterialCommunityIcons name={INCOME_REVIEW_ICONS.source} size={17} color={colors.accent} />
          <Text style={[typography.caption, { color: colors.subtext, marginLeft: 6 }]}>
            {sourceTypeLabel(selected)}
          </Text>
        </View>
        <View style={styles.sourceGrid}>
          {SOURCE_OPTIONS.map(option => (
            <TouchableOpacity
              key={option.value}
              style={[
                styles.sourceButton,
                {
                  borderColor: selected === option.value ? colors.accent : colors.border,
                  backgroundColor: selected === option.value ? `${colors.accent}16` : colors.card,
                  borderRadius: borderRadius.md,
                },
              ]}
              onPress={() => setSourceByCandidate(current => ({ ...current, [candidate.id]: option.value }))}>
              {selected === option.value ? (
                <MaterialCommunityIcons name={INCOME_REVIEW_ICONS.selected} size={15} color={colors.accent} />
              ) : null}
              <Text style={[typography.caption, { color: selected === option.value ? colors.accent : colors.text, fontWeight: '700', marginLeft: selected === option.value ? 5 : 0 }]}>
                {option.label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>
    );
  };

  const renderCandidate = (candidate: IncomeReviewCandidate, key = candidate.id) => {
    const disabled = storageStatus !== 'ready' || savingId === candidate.id;
    return (
      <Card key={key} style={styles.card}>
        <View style={styles.cardHeader}>
          <View style={{ flex: 1, marginRight: spacing.sm }}>
            <Text style={[typography.h3, { color: colors.text }]}>{rupee(candidate.amount)}</Text>
            <Text style={[typography.caption, { color: colors.subtext, marginTop: 2 }]}>
              {dateLabel(candidate.receivedAt)}
            </Text>
          </View>
          <View style={[styles.statusPill, { borderColor: colors.border, borderRadius: borderRadius.md }]}>
            <Text style={[typography.caption, { color: colors.text, fontWeight: '800' }]}>
              {decisionLabel(candidate)}
            </Text>
          </View>
        </View>

        <View style={styles.safeLabelRow}>
          <MaterialCommunityIcons name={INCOME_REVIEW_ICONS.credit} size={19} color={colors.accent} />
          <View style={{ flex: 1, marginLeft: spacing.sm }}>
            <Text style={[typography.bodyBold, { color: colors.text }]}>{candidate.safeLabel}</Text>
            <Text style={[typography.caption, { color: colors.subtext, marginTop: 2 }]}>
              {candidate.safeReason}
            </Text>
          </View>
        </View>

        <View style={styles.metaRow}>
          <Text style={[typography.caption, styles.metaText, { color: colors.subtext }]}>
            {dashboardStatusLabel(candidate)}
          </Text>
          <Text style={[typography.caption, styles.metaText, { color: colors.subtext }]}>
            Source hint: {sourceHintLabel(candidate.sourceHint)}
          </Text>
          <Text style={[typography.caption, styles.metaText, { color: colors.subtext }]}>
            Confidence: {candidate.confidence.replace('_', ' ')}
          </Text>
        </View>

        {renderSourcePicker(candidate)}

        <View style={styles.actionRow}>
          <TouchableOpacity
            disabled={disabled}
            onPress={() => saveDecision(candidate, 'count_as_income')}
            style={[styles.actionButton, { backgroundColor: '#10b981', borderRadius: borderRadius.md, opacity: disabled ? 0.55 : 1 }]}>
            {savingId === candidate.id ? <ActivityIndicator size="small" color="#ffffff" /> : (
              <MaterialCommunityIcons name={INCOME_REVIEW_ICONS.count} size={17} color="#ffffff" />
            )}
            <Text style={[typography.caption, styles.actionText, { color: '#ffffff' }]}>Count as income</Text>
          </TouchableOpacity>
          <TouchableOpacity
            disabled={disabled}
            onPress={() => saveDecision(candidate, 'not_income')}
            style={[styles.actionButton, { borderColor: colors.border, borderWidth: 1, borderRadius: borderRadius.md, opacity: disabled ? 0.55 : 1 }]}>
            <MaterialCommunityIcons name={INCOME_REVIEW_ICONS.notIncome} size={17} color="#ef4444" />
            <Text style={[typography.caption, styles.actionText, { color: '#ef4444' }]}>Not income</Text>
          </TouchableOpacity>
          <TouchableOpacity
            disabled={disabled}
            onPress={() => saveDecision(candidate, 'needs_review')}
            style={[styles.actionButton, { borderColor: colors.border, borderWidth: 1, borderRadius: borderRadius.md, opacity: disabled ? 0.55 : 1 }]}>
            <MaterialCommunityIcons name={INCOME_REVIEW_ICONS.reset} size={17} color={colors.accent} />
            <Text style={[typography.caption, styles.actionText, { color: colors.accent }]}>Keep reviewing</Text>
          </TouchableOpacity>
        </View>
      </Card>
    );
  };

  const renderRecentlyReviewedCandidate = (candidate: IncomeReviewCandidate) => {
    if (changingCandidateId === candidate.id) {
      return renderCandidate(candidate, `change:${candidate.id}`);
    }

    return (
      <Card key={candidate.id} style={styles.recentCard}>
        <View style={styles.cardHeader}>
          <View style={{ flex: 1, marginRight: spacing.sm }}>
            <Text style={[typography.bodyBold, { color: colors.text }]}>{rupee(candidate.amount)}</Text>
            <Text style={[typography.caption, { color: colors.subtext, marginTop: 2 }]}>
              {dateLabel(candidate.receivedAt)}
            </Text>
            <Text style={[typography.caption, { color: colors.text, marginTop: 6, fontWeight: '700' }]}>
              {candidate.safeLabel}
            </Text>
            <Text style={[typography.caption, { color: colors.subtext, marginTop: 2 }]}>
              {recentDecisionLabel(candidate)}
            </Text>
          </View>
          <TouchableOpacity
            onPress={() => setChangingCandidateId(candidate.id)}
            style={[styles.changeButton, { borderColor: colors.border, borderRadius: borderRadius.md }]}>
            <MaterialCommunityIcons name={INCOME_REVIEW_ICONS.change} size={15} color={colors.accent} />
            <Text style={[typography.caption, styles.actionText, { color: colors.accent }]}>Change</Text>
          </TouchableOpacity>
        </View>
      </Card>
    );
  };

  const renderContent = () => {
    if (loading) {
      return (
        <View style={styles.centerState}>
          <ActivityIndicator color={colors.accent} />
          <Text style={[typography.body, { color: colors.subtext, marginTop: spacing.md }]}>Loading income review</Text>
        </View>
      );
    }

    return (
      <View style={styles.contentStack}>
        <Card>
          <View style={styles.safeLabelRow}>
            <MaterialCommunityIcons name={INCOME_REVIEW_ICONS.review} size={22} color={colors.accent} />
            <View style={{ flex: 1, marginLeft: spacing.sm }}>
              <Text style={[typography.bodyBold, { color: colors.text }]}>Review credits before they count as income.</Text>
              <Text style={[typography.caption, { color: colors.subtext, marginTop: 4 }]}>
                Family or friend transfers are not counted automatically.
              </Text>
              <Text style={[typography.caption, { color: colors.subtext, marginTop: 4 }]}>
                Counting evidence-only income creates a safe History entry. Balances do not change.
              </Text>
              <Text style={[typography.caption, { color: colors.subtext, marginTop: 4 }]}>
                Debt Freedom Coach will use your reviewed income decisions.
              </Text>
            </View>
          </View>
        </Card>

        {storageStatus === 'missing' ? (
          <Card>
            <View style={styles.safeLabelRow}>
              <MaterialCommunityIcons name={INCOME_REVIEW_ICONS.migration} size={22} color="#f59e0b" />
              <View style={{ flex: 1, marginLeft: spacing.sm }}>
                <Text style={[typography.bodyBold, { color: colors.text }]}>Income review storage is not ready yet.</Text>
                <Text style={[typography.caption, { color: colors.subtext, marginTop: 4 }]}>
                  Run the database update before saving decisions.
                </Text>
              </View>
            </View>
          </Card>
        ) : null}

        {error ? (
          <Card>
            <View style={styles.safeLabelRow}>
              <MaterialCommunityIcons name={INCOME_REVIEW_ICONS.alert} size={22} color="#ef4444" />
              <Text style={[typography.caption, { color: colors.text, marginLeft: spacing.sm, flex: 1 }]}>{error}</Text>
            </View>
          </Card>
        ) : null}

        {activeCandidates.length === 0 ? (
          <View style={[styles.centerState, recentlyReviewedCandidates.length > 0 ? styles.compactCenterState : null]}>
            <MaterialCommunityIcons name={INCOME_REVIEW_ICONS.review} size={44} color={colors.subtext} />
            <Text style={[typography.bodyBold, { color: colors.text, marginTop: spacing.md }]}>
              No credits need review right now.
            </Text>
            <Text style={[typography.caption, styles.centerText, { color: colors.subtext, marginTop: spacing.xs }]}>
              New credits may appear here when the app cannot safely classify them.
            </Text>
          </View>
        ) : activeCandidates.map(candidate => renderCandidate(candidate))}

        {recentlyReviewedCandidates.length > 0 ? (
          <View style={styles.recentSection}>
            <Text style={[typography.h3, { color: colors.text }]}>Recently reviewed</Text>
            {recentlyReviewedCandidates.map(renderRecentlyReviewedCandidate)}
          </View>
        ) : null}
      </View>
    );
  };

  const content = (
    <>
      {!embedded ? (
        <AppHeader
          title="Money Movement Review"
          showBack
          rightAction={{ icon: 'refresh', onPress: () => load(true) }}
        />
      ) : null}
      <ScrollView
        scrollEnabled={!embedded}
        contentContainerStyle={[
          styles.scrollContent,
          embedded ? styles.embeddedScrollContent : null,
          { padding: embedded ? 0 : spacing.md },
        ]}
        refreshControl={
          embedded
            ? undefined
            : <RefreshControl refreshing={refreshing} onRefresh={() => load(true)} tintColor={colors.accent} />
        }>
        {renderContent()}
      </ScrollView>
    </>
  );

  if (embedded) {
    return <View style={styles.embeddedRoot}>{content}</View>;
  }

  return (
    <ScreenWrapper>
      {content}
    </ScreenWrapper>
  );
}

const styles = StyleSheet.create({
  scrollContent: {
    flexGrow: 1,
  },
  embeddedScrollContent: {
    flexGrow: 0,
  },
  embeddedRoot: {},
  contentStack: {
    gap: 12,
  },
  centerState: {
    flex: 1,
    minHeight: 360,
    alignItems: 'center',
    justifyContent: 'center',
  },
  centerText: {
    textAlign: 'center',
    maxWidth: 300,
  },
  compactCenterState: {
    minHeight: 160,
  },
  card: {
    gap: 12,
  },
  recentSection: {
    gap: 8,
  },
  recentCard: {
    gap: 8,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  statusPill: {
    minHeight: 32,
    borderWidth: 1,
    paddingHorizontal: 9,
    paddingVertical: 7,
    justifyContent: 'center',
    maxWidth: 150,
  },
  safeLabelRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  metaRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  metaText: {
    flexBasis: '47%',
    flexGrow: 1,
  },
  sourceWrap: {
    gap: 8,
  },
  sourceHeader: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  sourceGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  sourceButton: {
    minHeight: 36,
    borderWidth: 1,
    paddingHorizontal: 9,
    paddingVertical: 8,
    flexDirection: 'row',
    alignItems: 'center',
  },
  actionRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  actionButton: {
    minHeight: 40,
    paddingHorizontal: 10,
    paddingVertical: 9,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    flexGrow: 1,
    flexBasis: '31%',
  },
  actionText: {
    fontWeight: '800',
    marginLeft: 6,
  },
  changeButton: {
    minHeight: 36,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 8,
    flexDirection: 'row',
    alignItems: 'center',
  },
});
