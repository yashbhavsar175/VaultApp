import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';
import { AppHeader, Card, ScreenWrapper } from '../../components';
import { useTheme } from '../../context/ThemeContext';
import {
  DebtFreedomCoachViewModel,
  getDebtFreedomCoachViewModel,
} from '../../lib/services/debtFreedomViewModel';
import { DebtFreedomWarningCode, DebtItem } from '../../lib/services/debtFreedom';
import {
  buildDefaultDebtFreedomSettings,
  DebtFreedomIncomeMode,
  DebtFreedomSettingsInput,
  upsertDebtFreedomSettings,
} from '../../lib/services/debtFreedomSettings';

type SettingsFormState = {
  income_mode: DebtFreedomIncomeMode;
  monthly_income_amount: string;
  essential_monthly_expenses: string;
  emergency_contribution: string;
  target_monthly_income: string;
  planned_monthly_debt_payment: string;
  target_debt_free_months: string;
  strategy: 'balanced' | 'snowball' | 'avalanche';
};

export const APPROVED_DEBT_FREEDOM_ICONS = [
  'alert-circle-outline',
  'alert-octagon-outline',
  'calendar-check-outline',
  'calendar-clock',
  'cash-check',
  'cash-remove',
  'chart-line',
  'chart-timeline-variant',
  'check-circle-outline',
  'clipboard-alert-outline',
  'close',
  'content-duplicate',
  'credit-card-outline',
  'database-alert-outline',
  'eye-off-outline',
  'information-outline',
  'percent-outline',
  'refresh',
  'shield-alert-outline',
  'shield-check-outline',
  'speedometer',
  'target',
  'target-account',
  'target-variant',
  'text-box-search-outline',
  'trending-down',
  'wallet-outline',
] as const;

type DebtFreedomIconName = typeof APPROVED_DEBT_FREEDOM_ICONS[number];

const APPROVED_DEBT_FREEDOM_ICON_SET = new Set<string>(APPROVED_DEBT_FREEDOM_ICONS);

export const DEBT_FREEDOM_ICONS = {
  fallback: 'information-outline',
  highDti: 'alert-circle-outline',
  veryHighDti: 'alert-octagon-outline',
  incomeMissing: 'cash-remove',
  incomeVariableEstimate: 'chart-timeline-variant',
  incomeNeedsReview: 'text-box-search-outline',
  incomePaceBehind: 'trending-down',
  incomeSampleTooSmall: 'calendar-clock',
  dailyTargetHigh: 'speedometer',
  missingInterestRates: 'percent-outline',
  duplicateDebtPossible: 'content-duplicate',
  hiddenDebtIncluded: 'eye-off-outline',
  emergencyBufferLow: 'shield-alert-outline',
  essentialExpenseMissing: 'clipboard-alert-outline',
  minimumPaymentExceedsIncome: 'shield-alert-outline',
  targetUnreachable: 'target-variant',
  staleOrLowConfidenceDebt: 'database-alert-outline',
  safePlan: 'shield-check-outline',
  planningTargets: 'target-account',
  close: 'close',
  alert: 'alert-circle-outline',
  refresh: 'refresh',
  review: 'text-box-search-outline',
  success: 'check-circle-outline',
  actionTarget: 'target',
  metricTotalDebt: 'credit-card-outline',
  metricDebtFreeEstimate: 'calendar-check-outline',
  metricTodayTarget: 'target',
  metricIncomePace: 'speedometer',
  metricSafeSpend: 'wallet-outline',
  metricFreeCashflow: 'cash-check',
  metricMinimumDebtPayment: 'calendar-clock',
  metricDebtToIncomeRatio: 'percent-outline',
} satisfies Record<string, DebtFreedomIconName>;

const WARNING_COPY: Record<DebtFreedomWarningCode, {
  title: string;
  body: string;
  icon: DebtFreedomIconName;
}> = {
  high_dti: {
    title: 'Debt payment is high',
    body: 'Minimum debt payments are taking a large share of income.',
    icon: DEBT_FREEDOM_ICONS.highDti,
  },
  very_high_dti: {
    title: 'Debt payment is very high',
    body: 'Debt payments may be difficult to manage without a tighter plan.',
    icon: DEBT_FREEDOM_ICONS.veryHighDti,
  },
  income_missing: {
    title: 'Income estimate missing',
    body: 'Gig/freelance income will appear here when earning transactions are safely recognized.',
    icon: DEBT_FREEDOM_ICONS.incomeMissing,
  },
  income_variable_estimate: {
    title: 'Income is an estimate',
    body: 'This estimate is based on your current-month earning pace.',
    icon: DEBT_FREEDOM_ICONS.incomeVariableEstimate,
  },
  income_needs_review: {
    title: 'Income needs review',
    body: 'Some credits need review before they can count as income.',
    icon: DEBT_FREEDOM_ICONS.incomeNeedsReview,
  },
  income_pace_behind: {
    title: 'Behind target',
    body: 'Current month income pace is behind the target.',
    icon: DEBT_FREEDOM_ICONS.incomePaceBehind,
  },
  income_sample_too_small: {
    title: 'Income sample is small',
    body: 'More current-month earning days will make this estimate steadier.',
    icon: DEBT_FREEDOM_ICONS.incomeSampleTooSmall,
  },
  daily_target_high: {
    title: 'Today’s target is high',
    body: 'Today needs a higher earning pace than the current average.',
    icon: DEBT_FREEDOM_ICONS.dailyTargetHigh,
  },
  missing_interest_rates: {
    title: 'APR missing',
    body: 'Some debts do not have interest rates, so payoff order is only a guide.',
    icon: DEBT_FREEDOM_ICONS.missingInterestRates,
  },
  duplicate_debt_possible: {
    title: 'Duplicate debt possible',
    body: 'Some debt rows may represent the same card or loan. Review before acting.',
    icon: DEBT_FREEDOM_ICONS.duplicateDebtPossible,
  },
  hidden_debt_included: {
    title: 'Hidden debt included',
    body: 'A hidden nonzero debt is included here, so hidden does not mean ignored.',
    icon: DEBT_FREEDOM_ICONS.hiddenDebtIncluded,
  },
  emergency_buffer_low: {
    title: 'Emergency buffer low',
    body: 'A larger buffer may make repayment safer.',
    icon: DEBT_FREEDOM_ICONS.emergencyBufferLow,
  },
  essential_expense_missing: {
    title: 'Essential expenses missing',
    body: 'Safe spend needs essential expenses before it can be trusted.',
    icon: DEBT_FREEDOM_ICONS.essentialExpenseMissing,
  },
  minimum_payment_exceeds_income: {
    title: 'Minimum payment exceeds income',
    body: 'Minimum debt payments are higher than recognized income.',
    icon: DEBT_FREEDOM_ICONS.minimumPaymentExceedsIncome,
  },
  target_unreachable: {
    title: 'Target needs review',
    body: 'The current payment target cannot produce a reliable debt-free estimate.',
    icon: DEBT_FREEDOM_ICONS.targetUnreachable,
  },
  stale_or_low_confidence_debt: {
    title: 'Debt amount needs review',
    body: 'Some debt balances are estimated or low confidence.',
    icon: DEBT_FREEDOM_ICONS.staleOrLowConfidenceDebt,
  },
};

function safeDebtFreedomIconName(icon: DebtFreedomIconName): DebtFreedomIconName {
  return APPROVED_DEBT_FREEDOM_ICON_SET.has(icon) ? icon : DEBT_FREEDOM_ICONS.fallback;
}

function DebtFreedomIcon({
  name,
  size,
  color,
}: {
  name: DebtFreedomIconName;
  size: number;
  color: string;
}) {
  return <MaterialCommunityIcons name={safeDebtFreedomIconName(name)} size={size} color={color} />;
}

function rupee(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return 'Needs review';
  return `₹${Math.round(value).toLocaleString('en-IN')}`;
}

function percent(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return 'Needs review';
  return `${Math.round(value)}%`;
}

function paceGapLabel(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return 'Target needs review';
  if (value >= 0) return `Ahead of target: ${rupee(value)}`;
  return `Behind target: ${rupee(Math.abs(value))}`;
}

function looksUnsafeLabel(value: string): boolean {
  return (
    /\b(?:otp|one\s*time\s*password|verification\s*code)\b/i.test(value)
    || /\b(?:\+?91[-\s]?)?[6-9]\d{9}\b/.test(value)
    || /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i.test(value)
    || /\b[\w.-]+@[a-z]{2,}\b/i.test(value)
    || /\b\d(?:[ -]?\d){5,}\b/.test(value)
    || /\b(?:address|flat|tower|road|street|society|sector|near|landmark|pincode|pin code)\b/i.test(value)
  );
}

function safeDebtLabel(debt: DebtItem): string {
  const label = (debt.label || '').trim();
  const base = label && !looksUnsafeLabel(label) ? label : 'Debt';
  const last4 = (debt.metadata?.last4 || '').replace(/\D/g, '').slice(-4);
  return last4 ? `${base} ••${last4}` : base;
}

function minimumPaymentLabel(debt: DebtItem): string {
  if (debt.minimumMonthlyPayment !== null && debt.minimumMonthlyPayment !== undefined && Number.isFinite(debt.minimumMonthlyPayment)) {
    if (debt.sourceType === 'loan' || debt.sourceType === 'loan_account') {
      return `EMI ${rupee(debt.minimumMonthlyPayment)}`;
    }
    return `Minimum exact ${rupee(debt.minimumMonthlyPayment)}`;
  }
  if (debt.sourceType === 'loan' || debt.sourceType === 'loan_account') {
    return 'EMI unknown';
  }
  if (debt.sourceType === 'credit_card' && Number.isFinite(debt.outstanding) && debt.outstanding > 0) {
    return `Minimum estimated ${rupee(debt.outstanding * 0.05)}`;
  }
  return 'Minimum unknown';
}

function aprLabel(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return 'APR unknown';
  return `APR ${value}%`;
}

function debtFreeEstimateLabel(vm: DebtFreedomCoachViewModel): string {
  if (vm.plan.totalDebt <= 0) return 'No active debt found';
  if (!vm.plan.estimatedDebtFreeDate) return 'Not enough data';
  return vm.summary.debtFreeDateLabel.replace('Debt-free date estimate: ', '');
}

function amountInputValue(value: number | null | undefined): string {
  return value === null || value === undefined || !Number.isFinite(value) ? '' : String(Math.round(value));
}

function buildFormState(vm: DebtFreedomCoachViewModel | null): SettingsFormState {
  const defaults = buildDefaultDebtFreedomSettings();
  const settings = vm?.settings;
  const monthlyIncome = settings?.confirmed_monthly_income ?? defaults.confirmed_monthly_income;
  return {
    income_mode: settings?.income_mode || defaults.income_mode,
    monthly_income_amount: amountInputValue(monthlyIncome),
    essential_monthly_expenses: amountInputValue(settings?.essential_monthly_expenses ?? defaults.essential_monthly_expenses),
    emergency_contribution: amountInputValue(settings?.emergency_contribution ?? defaults.emergency_contribution),
    target_monthly_income: amountInputValue(settings?.target_monthly_income ?? defaults.target_monthly_income),
    planned_monthly_debt_payment: amountInputValue(settings?.planned_monthly_debt_payment ?? defaults.planned_monthly_debt_payment),
    target_debt_free_months: settings?.target_debt_free_months ? String(settings.target_debt_free_months) : '',
    strategy: settings?.strategy || defaults.strategy,
  };
}

function parseOptionalAmount(value: string, label: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (!/^\d+(?:\.\d{1,2})?$/.test(trimmed)) {
    throw new Error(`${label} must be a valid non-negative amount`);
  }
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`${label} must be a valid non-negative amount`);
  }
  return Math.round((parsed + Number.EPSILON) * 100) / 100;
}

function parseEmergencyAmount(value: string): number {
  return parseOptionalAmount(value, 'Emergency contribution') || 0;
}

function parseTargetMonths(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (!/^\d+$/.test(trimmed)) {
    throw new Error('Debt-free target months must be between 1 and 600');
  }
  const parsed = Number(trimmed);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 600) {
    throw new Error('Debt-free target months must be between 1 and 600');
  }
  return parsed;
}

function buildSettingsInputFromForm(form: SettingsFormState): DebtFreedomSettingsInput {
  return {
    income_mode: form.income_mode,
    confirmed_monthly_income: parseOptionalAmount(form.monthly_income_amount, 'Monthly income amount'),
    essential_monthly_expenses: parseOptionalAmount(form.essential_monthly_expenses, 'Essential monthly expenses'),
    emergency_contribution: parseEmergencyAmount(form.emergency_contribution),
    target_monthly_income: parseOptionalAmount(form.target_monthly_income, 'Target monthly income'),
    planned_monthly_debt_payment: parseOptionalAmount(form.planned_monthly_debt_payment, 'Planned monthly debt payment'),
    target_debt_free_months: parseTargetMonths(form.target_debt_free_months),
    strategy: form.strategy,
  };
}

function markerTone(marker: 'hidden' | 'duplicate' | 'review') {
  if (marker === 'hidden') return '#f59e0b';
  if (marker === 'duplicate') return '#8b5cf6';
  return '#06b6d4';
}

export function warningCopyForCode(code: DebtFreedomWarningCode) {
  return WARNING_COPY[code] || {
    title: 'Review needed',
    body: 'This guidance needs review before action.',
    icon: DEBT_FREEDOM_ICONS.alert,
  };
}

export default function DebtFreedomScreen() {
  const { colors, typography, spacing, borderRadius } = useTheme();
  const [viewModel, setViewModel] = useState<DebtFreedomCoachViewModel | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(false);
  const [settingsModalVisible, setSettingsModalVisible] = useState(false);
  const [settingsForm, setSettingsForm] = useState<SettingsFormState>(() => buildFormState(null));
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const [settingsSuccess, setSettingsSuccess] = useState<string | null>(null);
  const [savingSettings, setSavingSettings] = useState(false);

  const loadCoach = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    try {
      const next = await getDebtFreedomCoachViewModel();
      setViewModel(next);
      setError(false);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    loadCoach();
  }, [loadCoach]);

  const openSettingsModal = () => {
    setSettingsForm(buildFormState(viewModel));
    setSettingsError(null);
    setSettingsSuccess(null);
    setSettingsModalVisible(true);
  };

  const closeSettingsModal = () => {
    if (savingSettings) return;
    setSettingsModalVisible(false);
    setSettingsError(null);
  };

  const updateSettingsForm = <K extends keyof SettingsFormState>(key: K, value: SettingsFormState[K]) => {
    setSettingsForm(current => ({ ...current, [key]: value }));
    setSettingsError(null);
  };

  const savePlanningTargets = async () => {
    try {
      setSavingSettings(true);
      setSettingsError(null);
      await upsertDebtFreedomSettings(buildSettingsInputFromForm(settingsForm));
      setSettingsSuccess('Planning targets saved.');
      setSettingsModalVisible(false);
      await loadCoach(true);
    } catch (saveError) {
      const code = (saveError as { code?: string } | null)?.code;
      const message = code === '42P01' || code === '42703' || code === 'PGRST204' || code === 'PGRST205'
        ? 'Settings table not ready. Run SQL migration first.'
        : saveError instanceof Error
          ? saveError.message
          : 'Could not save planning targets.';
      setSettingsError(message);
    } finally {
      setSavingSettings(false);
    }
  };

  const renderMetricCard = (
    title: string,
    value: string,
    helper: string,
    icon: DebtFreedomIconName,
    color = colors.accent
  ) => (
    <Card style={styles.metricCard}>
      <View style={styles.metricHeader}>
        <DebtFreedomIcon name={icon} size={20} color={color} />
        <Text style={[typography.caption, styles.metricTitle, { color: colors.subtext }]} numberOfLines={2}>
          {title}
        </Text>
      </View>
      <Text style={[typography.h3, { color: colors.text, marginTop: spacing.xs }]} numberOfLines={2}>
        {value}
      </Text>
      <Text style={[typography.caption, { color: colors.subtext, marginTop: 3 }]} numberOfLines={3}>
        {helper}
      </Text>
    </Card>
  );

  const renderMarker = (label: string, marker: 'hidden' | 'duplicate' | 'review') => {
    const color = markerTone(marker);
    return (
      <View style={[styles.marker, { borderColor: `${color}55`, backgroundColor: `${color}12` }]}>
        <Text style={[typography.caption, styles.markerText, { color }]}>{label}</Text>
      </View>
    );
  };

  const renderDebtRow = (debt: DebtItem) => (
    <View key={debt.id} style={[styles.debtRow, { borderBottomColor: colors.border }]}>
      <View style={{ flex: 1, marginRight: spacing.sm }}>
        <Text style={[typography.bodyBold, { color: colors.text }]} numberOfLines={1}>
          {safeDebtLabel(debt)}
        </Text>
        <Text style={[typography.caption, { color: colors.subtext, marginTop: 3 }]} numberOfLines={1}>
          {minimumPaymentLabel(debt)} · {aprLabel(debt.annualInterestRate)}
        </Text>
        <View style={styles.markerRow}>
          {debt.isHidden ? renderMarker('Hidden included', 'hidden') : null}
          {debt.duplicateGroupKey ? renderMarker('Duplicate risk', 'duplicate') : null}
          {debt.confidence === 'needs_review' || debt.confidence === 'low'
            ? renderMarker('Review', 'review')
            : null}
        </View>
      </View>
      <Text
        style={[typography.bodyBold, { color: colors.text }]}
        numberOfLines={1}
        adjustsFontSizeToFit
        minimumFontScale={0.75}>
        {`Outstanding ${rupee(debt.outstanding)}`}
      </Text>
    </View>
  );

  const renderWarnings = (vm: DebtFreedomCoachViewModel) => {
    if (!vm.plan.warnings.length) {
      return (
        <Card>
          <View style={styles.sectionHeader}>
            <DebtFreedomIcon name={DEBT_FREEDOM_ICONS.safePlan} size={21} color="#10b981" />
            <Text style={[typography.bodyBold, { color: colors.text, marginLeft: spacing.sm }]}>
              No major warnings
            </Text>
          </View>
          <Text style={[typography.caption, { color: colors.subtext, marginTop: spacing.xs }]}>
            Keep checking income, spending, and repayment pace.
          </Text>
        </Card>
      );
    }

    return (
      <Card>
        <Text style={[typography.bodyBold, { color: colors.text, marginBottom: spacing.sm }]}>
          Guidance warnings
        </Text>
        {vm.plan.warnings.map(warning => {
          const copy = warningCopyForCode(warning.code);
          const color = warning.severity === 'high' ? '#ef4444' : warning.severity === 'caution' ? '#f59e0b' : '#06b6d4';
          return (
            <View key={warning.code} style={[styles.warningRow, { borderTopColor: colors.border }]}>
              <DebtFreedomIcon name={copy.icon} size={20} color={color} />
              <View style={{ flex: 1, marginLeft: spacing.sm }}>
                <Text style={[typography.caption, { color: colors.text, fontWeight: '700' }]}>
                  {copy.title}
                </Text>
                <Text style={[typography.caption, { color: colors.subtext, marginTop: 2 }]}>
                  {copy.body}
                </Text>
              </View>
            </View>
          );
        })}
      </Card>
    );
  };

  const renderModeOption = (value: DebtFreedomIncomeMode, label: string) => (
    <TouchableOpacity
      key={value}
      style={[
        styles.optionButton,
        {
          borderColor: settingsForm.income_mode === value ? colors.accent : colors.border,
          backgroundColor: settingsForm.income_mode === value ? `${colors.accent}16` : colors.card,
        },
      ]}
      onPress={() => updateSettingsForm('income_mode', value)}>
      <Text style={[typography.caption, { color: settingsForm.income_mode === value ? colors.accent : colors.text, fontWeight: '700' }]}>
        {label}
      </Text>
    </TouchableOpacity>
  );

  const renderStrategyOption = (value: SettingsFormState['strategy'], label: string) => (
    <TouchableOpacity
      key={value}
      style={[
        styles.optionButton,
        {
          borderColor: settingsForm.strategy === value ? colors.accent : colors.border,
          backgroundColor: settingsForm.strategy === value ? `${colors.accent}16` : colors.card,
        },
      ]}
      onPress={() => updateSettingsForm('strategy', value)}>
      <Text style={[typography.caption, { color: settingsForm.strategy === value ? colors.accent : colors.text, fontWeight: '700' }]}>
        {label}
      </Text>
    </TouchableOpacity>
  );

  const renderSettingsInput = (
    label: string,
    key: keyof Pick<SettingsFormState,
      | 'monthly_income_amount'
      | 'essential_monthly_expenses'
      | 'emergency_contribution'
      | 'target_monthly_income'
      | 'planned_monthly_debt_payment'
      | 'target_debt_free_months'
    >,
    placeholder: string
  ) => (
    <View style={styles.inputGroup}>
      <Text style={[typography.caption, { color: colors.subtext, fontWeight: '700' }]}>{label}</Text>
      <TextInput
        value={settingsForm[key]}
        onChangeText={value => updateSettingsForm(key, value)}
        placeholder={placeholder}
        placeholderTextColor={colors.subtext}
        keyboardType="numeric"
        style={[
          styles.input,
          {
            color: colors.text,
            borderColor: colors.border,
            borderRadius: borderRadius.md,
            backgroundColor: colors.background,
          },
        ]}
      />
    </View>
  );

  const renderSettingsPrompt = (vm: DebtFreedomCoachViewModel) => {
    if (vm.settingsStatus === 'loaded') return null;
    return (
      <Card>
        <View style={styles.sectionHeader}>
          <DebtFreedomIcon name={DEBT_FREEDOM_ICONS.planningTargets} size={21} color={colors.accent} />
          <Text style={[typography.bodyBold, { color: colors.text, marginLeft: spacing.sm }]}>
            Planning targets
          </Text>
        </View>
        <Text style={[typography.caption, { color: colors.subtext, marginTop: spacing.xs }]}>
          Optional. Leave income blank to use your current-month earning pace.
        </Text>
        {vm.settingsStatus === 'error' ? (
          <Text style={[typography.caption, { color: '#f59e0b', marginTop: spacing.xs }]}>
            Settings table not ready. Run SQL migration before live settings use.
          </Text>
        ) : null}
      </Card>
    );
  };

  const renderSettingsModal = () => (
    <Modal visible={settingsModalVisible} animationType="slide" transparent onRequestClose={closeSettingsModal}>
      <View style={styles.modalBackdrop}>
        <View style={[styles.modalCard, { backgroundColor: colors.card, borderRadius: borderRadius.lg }]}>
          <ScrollView keyboardShouldPersistTaps="handled">
            <View style={styles.modalHeader}>
              <Text style={[typography.h3, { color: colors.text }]}>Set planning targets</Text>
              <TouchableOpacity onPress={closeSettingsModal} style={styles.iconButton}>
                <DebtFreedomIcon name={DEBT_FREEDOM_ICONS.close} size={22} color={colors.text} />
              </TouchableOpacity>
            </View>

            <Text style={[typography.caption, { color: colors.subtext, marginBottom: spacing.sm }]}>
              Optional. Leave income blank to use your current-month earning pace.
            </Text>
            <Text style={[typography.caption, { color: colors.subtext, marginBottom: spacing.sm }]}>
              This does not change transactions or balances.
            </Text>
            <Text style={[typography.caption, { color: colors.subtext, marginBottom: spacing.md }]}>
              Debt Freedom Score is guidance, not a credit score.
            </Text>

            <Text style={[typography.caption, styles.fieldLabel, { color: colors.text }]}>Income mode</Text>
            <View style={styles.optionRow}>
              {renderModeOption('auto', 'Auto from current month pace')}
              {renderModeOption('confirmed', 'Confirmed monthly income')}
              {renderModeOption('manual_estimate', 'Manual estimate')}
            </View>

            {settingsForm.income_mode !== 'auto'
              ? renderSettingsInput('Monthly income amount', 'monthly_income_amount', 'Optional')
              : null}

            {renderSettingsInput('Essential monthly expenses', 'essential_monthly_expenses', 'Rent, food, fuel, bills')}
            <Text style={[typography.caption, { color: colors.subtext, marginBottom: spacing.sm }]}>
              Use essential expenses for rent, food, fuel, bills - not entertainment.
            </Text>
            {renderSettingsInput('Emergency monthly contribution', 'emergency_contribution', '0')}
            {renderSettingsInput('Target monthly income', 'target_monthly_income', 'Optional')}
            {renderSettingsInput('Planned monthly debt payment', 'planned_monthly_debt_payment', 'Optional')}
            {renderSettingsInput('Debt-free target months', 'target_debt_free_months', '1 to 600')}

            <Text style={[typography.caption, styles.fieldLabel, { color: colors.text }]}>Strategy</Text>
            <View style={styles.optionRow}>
              {renderStrategyOption('balanced', 'Balanced')}
              {renderStrategyOption('snowball', 'Snowball')}
              {renderStrategyOption('avalanche', 'Avalanche')}
            </View>

            {settingsError ? (
              <Text style={[typography.caption, { color: '#ef4444', marginTop: spacing.sm }]}>
                {settingsError}
              </Text>
            ) : null}

            <View style={styles.modalActions}>
              <TouchableOpacity
                style={[styles.secondaryButton, { borderColor: colors.border, borderRadius: borderRadius.md }]}
                onPress={closeSettingsModal}>
                <Text style={[typography.caption, { color: colors.text, fontWeight: '800' }]}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.primaryButton, { backgroundColor: colors.accent, borderRadius: borderRadius.md }]}
                onPress={savePlanningTargets}
                disabled={savingSettings}>
                {savingSettings ? <ActivityIndicator size="small" color="#ffffff" /> : null}
                <Text style={[typography.caption, { color: '#ffffff', fontWeight: '800', marginLeft: savingSettings ? 6 : 0 }]}>
                  Save settings
                </Text>
              </TouchableOpacity>
            </View>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );

  const renderContent = () => {
    if (loading) {
      return (
        <View style={styles.centerState}>
          <ActivityIndicator color={colors.accent} />
          <Text style={[typography.body, { color: colors.subtext, marginTop: spacing.md }]}>
            Loading Debt Freedom Coach
          </Text>
        </View>
      );
    }

    if (error || !viewModel) {
      return (
        <View style={styles.centerState}>
          <DebtFreedomIcon name={DEBT_FREEDOM_ICONS.alert} size={42} color="#f59e0b" />
          <Text style={[typography.bodyBold, { color: colors.text, marginTop: spacing.md }]}>
            Could not load Debt Freedom Coach
          </Text>
          <Text style={[typography.caption, styles.centerText, { color: colors.subtext, marginTop: spacing.xs }]}>
            Pull to refresh or try again.
          </Text>
          <TouchableOpacity
            style={[styles.retryButton, { borderColor: colors.border, borderRadius: borderRadius.md }]}
            onPress={() => loadCoach(true)}>
            <DebtFreedomIcon name={DEBT_FREEDOM_ICONS.refresh} size={18} color={colors.accent} />
            <Text style={[typography.caption, { color: colors.accent, marginLeft: 6, fontWeight: '700' }]}>
              Refresh
            </Text>
          </TouchableOpacity>
        </View>
      );
    }

    const { plan, summary, dataQuality, debtItems } = viewModel;
    const hasDebt = plan.totalDebt > 0 && debtItems.length > 0;
    const noIncome = plan.incomeProjection.source === 'missing';
    const pace = plan.incomeProjection;

    return (
      <View style={styles.contentStack}>
        <Card>
          <View style={styles.scoreRow}>
            <View style={{ flex: 1, marginRight: spacing.md }}>
              <Text style={[typography.caption, { color: colors.subtext }]}>
                Debt Freedom Score
              </Text>
              <Text style={[typography.h1, { color: colors.text, marginTop: 2 }]}>
                {plan.debtFreedomScore}
              </Text>
              <Text style={[typography.caption, { color: colors.subtext, marginTop: 2 }]}>
                Guidance score, not a credit score
              </Text>
            </View>
            <View style={[styles.scoreBadge, { borderColor: colors.border, borderRadius: borderRadius.md }]}>
              <Text style={[typography.caption, { color: colors.text, fontWeight: '800' }]}>
                {summary.scoreLabel}
              </Text>
            </View>
          </View>
        </Card>

        <View style={styles.metricGrid}>
          {renderMetricCard('Total Debt', summary.totalDebtLabel, hasDebt ? 'Included debts only' : 'No active debt found', DEBT_FREEDOM_ICONS.metricTotalDebt, '#ef4444')}
          {renderMetricCard('Debt-free estimate', debtFreeEstimateLabel(viewModel), 'Based on minimum debt payment', DEBT_FREEDOM_ICONS.metricDebtFreeEstimate, '#10b981')}
          {renderMetricCard('Today’s target', summary.dailyTargetLabel.replace('Today’s target: ', ''), 'Today’s target', DEBT_FREEDOM_ICONS.metricTodayTarget, '#f59e0b')}
          {renderMetricCard('Current month income pace', summary.monthlyIncomeLabel, 'Month-end estimate', DEBT_FREEDOM_ICONS.metricIncomePace, '#06b6d4')}
          {renderMetricCard('Safe spend estimate', summary.safeSpendLabel, 'After essentials and debt plan', DEBT_FREEDOM_ICONS.metricSafeSpend, '#8b5cf6')}
          {renderMetricCard('Free cashflow after debt', rupee(plan.freeCashflowAfterDebt), 'Estimate after debt payments', DEBT_FREEDOM_ICONS.metricFreeCashflow, '#10b981')}
          {renderMetricCard('Minimum debt payment', rupee(plan.minimumDebtPayment), 'Minimum due or estimate', DEBT_FREEDOM_ICONS.metricMinimumDebtPayment, '#ef4444')}
          {renderMetricCard('Debt-to-income ratio', percent(plan.debtToIncomePercent), 'Based on recognized income only', DEBT_FREEDOM_ICONS.metricDebtToIncomeRatio, '#f59e0b')}
        </View>

        <Card>
          <Text style={[typography.bodyBold, { color: colors.text }]}>Income pace</Text>
          <Text style={[typography.caption, { color: colors.subtext, marginTop: spacing.xs }]}>
            This estimate is based on your current-month earning pace.
          </Text>
          <View style={styles.incomePaceGrid}>
            <View style={styles.incomePaceItem}>
              <Text style={[typography.caption, { color: colors.subtext }]}>Average so far</Text>
              <Text style={[typography.bodyBold, { color: colors.text }]}>{rupee(pace.averageDailyIncome)}</Text>
            </View>
            <View style={styles.incomePaceItem}>
              <Text style={[typography.caption, { color: colors.subtext }]}>Month-end estimate</Text>
              <Text style={[typography.bodyBold, { color: colors.text }]}>{rupee(pace.projectedMonthEndIncome)}</Text>
            </View>
            <View style={styles.incomePaceItem}>
              <Text style={[typography.caption, { color: colors.subtext }]}>Target progress</Text>
              <Text style={[typography.bodyBold, { color: colors.text }]}>{paceGapLabel(pace.incomePaceGap)}</Text>
            </View>
          </View>
          {dataQuality.needsIncomeReviewCount > 0 ? (
            <View style={[styles.reviewBanner, { borderColor: '#f59e0b55', backgroundColor: '#f59e0b12' }]}>
              <DebtFreedomIcon name={DEBT_FREEDOM_ICONS.review} size={18} color="#f59e0b" />
              <Text style={[typography.caption, { color: colors.text, marginLeft: spacing.sm, flex: 1 }]}>
                Some credits need review before they can count as income. Count: {dataQuality.needsIncomeReviewCount}
              </Text>
            </View>
          ) : null}
          {noIncome ? (
            <View style={[styles.reviewBanner, { borderColor: '#06b6d455', backgroundColor: '#06b6d412' }]}>
              <DebtFreedomIcon name={DEBT_FREEDOM_ICONS.incomeMissing} size={18} color="#06b6d4" />
              <Text style={[typography.caption, { color: colors.text, marginLeft: spacing.sm, flex: 1 }]}>
                Income estimate missing. Gig/freelance income will appear here when earning transactions are safely recognized.
              </Text>
            </View>
          ) : null}
        </Card>

        {settingsSuccess ? (
          <Card>
            <View style={styles.sectionHeader}>
              <DebtFreedomIcon name={DEBT_FREEDOM_ICONS.success} size={21} color="#10b981" />
              <Text style={[typography.caption, { color: colors.text, marginLeft: spacing.sm, fontWeight: '700' }]}>
                {settingsSuccess}
              </Text>
            </View>
          </Card>
        ) : null}

        {renderSettingsPrompt(viewModel)}

        {dataQuality.missingEmiCount > 0 ? (
          <Card>
            <View style={styles.sectionHeader}>
              <DebtFreedomIcon name={DEBT_FREEDOM_ICONS.alert} size={20} color="#f59e0b" />
              <Text style={[typography.caption, { color: colors.text, marginLeft: spacing.sm, flex: 1 }]}>
                EMI amount missing for this loan.
              </Text>
            </View>
          </Card>
        ) : null}

        {!hasDebt ? (
          <Card style={styles.emptyDebtCard}>
            <DebtFreedomIcon name={DEBT_FREEDOM_ICONS.success} size={42} color="#10b981" />
            <Text style={[typography.bodyBold, { color: colors.text, marginTop: spacing.sm }]}>
              No active debt found.
            </Text>
            <Text style={[typography.caption, styles.centerText, { color: colors.subtext, marginTop: spacing.xs }]}>
              Keep tracking income and spending to stay debt-free.
            </Text>
          </Card>
        ) : (
          <Card>
            <Text style={[typography.bodyBold, { color: colors.text, marginBottom: spacing.sm }]}>
              Debt list
            </Text>
            {debtItems.map(renderDebtRow)}
          </Card>
        )}

        {renderWarnings(viewModel)}

        <View style={styles.actionRow}>
          <TouchableOpacity
            style={[styles.refreshButton, { backgroundColor: colors.accent, borderRadius: borderRadius.md }]}
            onPress={() => loadCoach(true)}
            disabled={refreshing}>
            {refreshing ? (
              <ActivityIndicator size="small" color="#ffffff" />
            ) : (
              <DebtFreedomIcon name={DEBT_FREEDOM_ICONS.refresh} size={18} color="#ffffff" />
            )}
            <Text style={[typography.caption, { color: '#ffffff', marginLeft: 6, fontWeight: '800' }]}>
              Refresh
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.secondaryButton, { borderColor: colors.border, borderRadius: borderRadius.md }]}
            onPress={openSettingsModal}>
            <DebtFreedomIcon name={DEBT_FREEDOM_ICONS.actionTarget} size={18} color={colors.accent} />
            <Text style={[typography.caption, { color: colors.accent, marginLeft: 6, fontWeight: '800' }]}>
              Set planning targets
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  };

  return (
    <ScreenWrapper>
      <AppHeader
        title="Debt Freedom Coach"
        showBack
        rightAction={{ icon: 'refresh', onPress: () => loadCoach(true) }}
      />
      <ScrollView
        contentContainerStyle={[styles.scrollContent, { padding: spacing.md }]}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => loadCoach(true)}
            tintColor={colors.accent}
          />
        }>
        {renderContent()}
      </ScrollView>
      {renderSettingsModal()}
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
    minHeight: 420,
    alignItems: 'center',
    justifyContent: 'center',
  },
  centerText: {
    textAlign: 'center',
    maxWidth: 300,
  },
  retryButton: {
    marginTop: 16,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 9,
    flexDirection: 'row',
    alignItems: 'center',
  },
  scoreRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  scoreBadge: {
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 8,
    maxWidth: 110,
  },
  metricGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  metricCard: {
    flexBasis: '47%',
    flexGrow: 1,
    minHeight: 132,
  },
  metricHeader: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  metricTitle: {
    flex: 1,
    marginLeft: 8,
    fontWeight: '700',
  },
  incomePaceGrid: {
    marginTop: 12,
    gap: 10,
  },
  incomePaceItem: {
    minHeight: 48,
    justifyContent: 'center',
  },
  reviewBanner: {
    marginTop: 12,
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 9,
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  emptyDebtCard: {
    alignItems: 'center',
  },
  debtRow: {
    minHeight: 74,
    paddingVertical: 10,
    borderBottomWidth: 1,
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  markerRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 7,
  },
  marker: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 7,
    paddingVertical: 4,
  },
  markerText: {
    fontWeight: '700',
  },
  warningRow: {
    borderTopWidth: 1,
    paddingTop: 10,
    marginTop: 10,
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  actionRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginBottom: 18,
  },
  refreshButton: {
    minHeight: 42,
    paddingHorizontal: 14,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
  },
  secondaryButton: {
    minHeight: 42,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.42)',
    justifyContent: 'flex-end',
  },
  modalCard: {
    maxHeight: '88%',
    padding: 16,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  iconButton: {
    minHeight: 40,
    minWidth: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  optionRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 12,
  },
  optionButton: {
    minHeight: 40,
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 9,
    justifyContent: 'center',
  },
  inputGroup: {
    marginBottom: 12,
  },
  fieldLabel: {
    fontWeight: '800',
    marginBottom: 8,
  },
  input: {
    minHeight: 44,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 9,
    marginTop: 6,
  },
  modalActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 10,
    marginTop: 16,
    marginBottom: 8,
  },
  primaryButton: {
    minHeight: 42,
    paddingHorizontal: 14,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
