import React, { useCallback, useEffect, useState } from 'react';
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
import {
  deleteIncomeReviewDecision,
  getIncomeReviewScreenState,
  IncomeReviewCandidate,
  IncomeReviewIncomeSourceType,
  IncomeReviewStorageStatus,
  upsertIncomeReviewDecision,
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

export default function IncomeReviewScreen() {
  const { colors, typography, spacing, borderRadius } = useTheme();
  const [candidates, setCandidates] = useState<IncomeReviewCandidate[]>([]);
  const [storageStatus, setStorageStatus] = useState<IncomeReviewStorageStatus>('ready');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sourceByCandidate, setSourceByCandidate] = useState<Record<string, IncomeReviewIncomeSourceType>>({});

  const load = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    try {
      const state = await getIncomeReviewScreenState();
      setCandidates(state.candidates);
      setStorageStatus(state.storageStatus);
      setError(null);
    } catch {
      setError('Could not load income review.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    load();
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
        await upsertIncomeReviewDecision({
          transaction_id: candidate.transactionId || null,
          evidence_id: candidate.evidenceId || null,
          signal_hash: candidate.signalHash || null,
          decision,
          income_source_type: decision === 'count_as_income'
            ? sourceByCandidate[candidate.id] || candidate.currentDecision?.income_source_type || candidate.suggestedIncomeSourceType || 'other'
            : null,
          reason_code: candidate.sourceHint,
        });
      }
      await load(true);
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
      || candidate.suggestedIncomeSourceType
      || 'gig_work';
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

  const renderCandidate = (candidate: IncomeReviewCandidate) => {
    const disabled = storageStatus !== 'ready' || savingId === candidate.id;
    return (
      <Card key={candidate.id} style={styles.card}>
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
                This does not change transactions or balances.
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

        {candidates.length === 0 ? (
          <View style={styles.centerState}>
            <MaterialCommunityIcons name={INCOME_REVIEW_ICONS.review} size={44} color={colors.subtext} />
            <Text style={[typography.bodyBold, { color: colors.text, marginTop: spacing.md }]}>
              No income credits need review right now.
            </Text>
            <Text style={[typography.caption, styles.centerText, { color: colors.subtext, marginTop: spacing.xs }]}>
              New credits may appear here when the app cannot safely classify them.
            </Text>
          </View>
        ) : candidates.map(renderCandidate)}
      </View>
    );
  };

  return (
    <ScreenWrapper>
      <AppHeader
        title="Income Review"
        showBack
        rightAction={{ icon: 'refresh', onPress: () => load(true) }}
      />
      <ScrollView
        contentContainerStyle={[styles.scrollContent, { padding: spacing.md }]}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={() => load(true)} tintColor={colors.accent} />
        }>
        {renderContent()}
      </ScrollView>
    </ScreenWrapper>
  );
}

const styles = StyleSheet.create({
  scrollContent: {
    flexGrow: 1,
  },
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
  card: {
    gap: 12,
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
});
