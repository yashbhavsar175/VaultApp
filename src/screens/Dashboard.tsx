import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, LayoutAnimation, Platform, UIManager, RefreshControl, AppState, AppStateStatus, Animated } from 'react-native';
import { formatCurrency as formatAmount } from '../utils/format';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';
import HapticFeedback from 'react-native-haptic-feedback';
import { getTransactions } from '../lib/core';
import { Transaction, PeopleLedger } from '../types';
import { useTheme } from '../context/ThemeContext';
import { ScreenWrapper, Card, AppHeader, QuickAddModal } from '../components';
import { getPeopleLedger } from '../lib/database/userdata';
import { getCached, setCache, CACHE_KEYS } from '../lib/services/cache';
import { financeDataChangedAffects, subscribeFinanceDataChanged } from '../lib/services/dataEvents';
import {
  computeDashboardReviewBreakdown,
  computeDashboardReviewPromptSummary,
  computeMonthlyTransactionTotals,
} from '../utils/financeSummary';
import { runWhenIdle } from '../utils/runWhenIdle';
import {
  getIncomeReviewCandidates,
  getIncomeReviewDecisions,
  IncomeReviewCandidate,
  IncomeReviewDecision,
} from '../lib/services/incomeReview';
import { getReviewQueue, ReviewItem } from '../lib/services/autoTransactionReviewQueue';
import {
  DashboardSummarySnapshot,
  getCachedDashboardSummary,
  setCachedDashboardSummary,
} from '../lib/services/dashboardSummaryCache';

type DashboardDebugPayload = Record<string, boolean | number | string | null | undefined>;

function logDashboardDebug(event: string, payload: DashboardDebugPayload) {
  const maybeProcess = (globalThis as { process?: { env?: { JEST_WORKER_ID?: string } } }).process;
  const isJestRuntime = Boolean(maybeProcess?.env?.JEST_WORKER_ID);
  if (__DEV__ && !isJestRuntime) {
    console.log('[DashboardDebug]', event, payload);
  }
}

// Enable LayoutAnimation on Android
const isFabricEnabled = (globalThis as any).nativeFabricUIManager != null;
if (
  Platform.OS === 'android' &&
  !isFabricEnabled &&
  UIManager.setLayoutAnimationEnabledExperimental
) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

export default function Dashboard() {
  const navigation = useNavigation();
  const { colors, typography, spacing } = useTheme();
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [isInitialLoad, setIsInitialLoad] = useState(true);
  const [peopleLedger, setPeopleLedger] = useState<PeopleLedger[]>([]);
  const [incomeReviewDecisions, setIncomeReviewDecisions] = useState<IncomeReviewDecision[]>([]);
  const [incomeReviewCandidates, setIncomeReviewCandidates] = useState<IncomeReviewCandidate[]>([]);
  const [transactionReviewItems, setTransactionReviewItems] = useState<ReviewItem[]>([]);
  const [cachedDashboardSummary, setCachedDashboardSummaryState] = useState<DashboardSummarySnapshot | null>(null);
  const [hasResolvedDashboardData, setHasResolvedDashboardData] = useState(false);
  const [hasResolvedIncomeReviewDecisions, setHasResolvedIncomeReviewDecisions] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [showQuickAdd, setShowQuickAdd] = useState(false);
  const isMountedRef = useRef(true);

  useEffect(() => {
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  // SECURITY: Privacy screen when app goes to background
  const [isPrivacyMode, setIsPrivacyMode] = useState(false);
  useEffect(() => {
    const sub = AppState.addEventListener('change', (next: AppStateStatus) => {
      setIsPrivacyMode(next !== 'active');
    });
    return () => sub.remove();
  }, []);

  // UX: Shimmer animation for skeleton loader
  const shimmerAnim = useRef(new Animated.Value(0.4)).current;
  useEffect(() => {
    if (!loading) return;
    const shimmer = Animated.loop(
      Animated.sequence([
        Animated.timing(shimmerAnim, { toValue: 1, duration: 750, useNativeDriver: true }),
        Animated.timing(shimmerAnim, { toValue: 0.4, duration: 750, useNativeDriver: true }),
      ])
    );
    shimmer.start();
    return () => shimmer.stop();
  }, [loading, shimmerAnim]);

  // UX: Haptic feedback helper
  const triggerHaptic = useCallback(() => {
    HapticFeedback.trigger('impactLight', { enableVibrateFallback: true, ignoreAndroidSystemSettings: false });
  }, []);
  
  // Month selector state
  const [selectedDate, setSelectedDate] = useState(new Date());
  
  // Accordion state
  const [openSections, setOpenSections] = useState({
    incomeExpense: true,
    people: true,
    investedEmi: false,
  });

  const toggleSection = (section: keyof typeof openSections) => {
    triggerHaptic();
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setOpenSections(prev => ({
      ...prev,
      [section]: !prev[section],
    }));
  };

  const getMonthName = (date: Date) => {
    return date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  };

  const navigateMonth = (direction: 'prev' | 'next') => {
    triggerHaptic();
    const newDate = new Date(selectedDate);
    if (direction === 'prev') {
      newDate.setMonth(newDate.getMonth() - 1);
    } else {
      newDate.setMonth(newDate.getMonth() + 1);
    }
    setSelectedDate(newDate);
  };

  const isCurrentMonth = () => {
    const now = new Date();
    return selectedDate.getMonth() === now.getMonth() && 
           selectedDate.getFullYear() === now.getFullYear();
  };

  // Helper to compute people summary from ledger data
  const computePeopleSummary = useCallback((ledgerData: PeopleLedger[]) => {
    return ledgerData.reduce(
      (summary, entry) => {
        if (entry.type === 'lent') {
          summary.totalLent += Number(entry.remaining_amount);
          summary.lentCount += 1;
        } else if (entry.type === 'borrowed') {
          summary.totalBorrowed += Number(entry.remaining_amount);
          summary.borrowedCount += 1;
        }

        return summary;
      },
      { totalLent: 0, totalBorrowed: 0, lentCount: 0, borrowedCount: 0 }
    );
  }, []);

  const peopleSummary = useMemo(() => computePeopleSummary(peopleLedger), [computePeopleSummary, peopleLedger]);
  const lentPeopleEntries = useMemo(() => peopleLedger.filter(e => e.type === 'lent'), [peopleLedger]);

  const monthlyTotals = useMemo(
    () => computeMonthlyTransactionTotals(transactions, selectedDate, { incomeReviewDecisions }),
    [incomeReviewDecisions, selectedDate, transactions]
  );
  const reviewPromptSummary = useMemo(
    () => computeDashboardReviewPromptSummary(transactions, selectedDate, { incomeReviewDecisions }),
    [incomeReviewDecisions, selectedDate, transactions]
  );
  const reviewBreakdown = useMemo(
    () => computeDashboardReviewBreakdown(reviewPromptSummary, incomeReviewCandidates, transactionReviewItems),
    [incomeReviewCandidates, reviewPromptSummary, transactionReviewItems]
  );
  const shouldUseCachedMonthlyTotals = Boolean(
    cachedDashboardSummary
    && (!hasResolvedDashboardData || !hasResolvedIncomeReviewDecisions)
  );
  const shouldUseCachedPeopleSummary = Boolean(
    cachedDashboardSummary
    && !hasResolvedDashboardData
    && peopleLedger.length === 0
  );
  const shouldUseCachedReviewBreakdown = Boolean(
    cachedDashboardSummary
    && !hasResolvedDashboardData
    && incomeReviewCandidates.length === 0
    && transactionReviewItems.length === 0
  );
  const hasCachedDashboardDisplay = shouldUseCachedMonthlyTotals
    || shouldUseCachedPeopleSummary
    || shouldUseCachedReviewBreakdown;
  const displayMonthlyTotals = shouldUseCachedMonthlyTotals
    ? cachedDashboardSummary!.monthlyTotals
    : monthlyTotals;
  const displayPeopleSummary = shouldUseCachedPeopleSummary
    ? cachedDashboardSummary!.peopleSummary
    : peopleSummary;
  const displayReviewBreakdown = shouldUseCachedReviewBreakdown
    ? cachedDashboardSummary!.reviewBreakdown
    : reviewBreakdown;
  const reviewPromptCount = displayReviewBreakdown.totalReviewableCount;
  const hasMixedReviewSources = displayReviewBreakdown.incomeReviewCount > 0
    && displayReviewBreakdown.transactionReviewCount > 0;
  const reviewPromptLabel = hasMixedReviewSources
    ? `${displayReviewBreakdown.incomeReviewCount} ${displayReviewBreakdown.incomeReviewCount === 1 ? 'credit' : 'credits'} and ${displayReviewBreakdown.transactionReviewCount} ${displayReviewBreakdown.transactionReviewCount === 1 ? 'movement' : 'movements'} need review`
    : `${reviewPromptCount} ${reviewPromptCount === 1 ? 'item needs' : 'items need'} review`;

  const {
    totalIncome,
    grossExpense,
    totalRefunds,
    netExpense,
    totalExpense,
    totalInvestment,
    totalEMI,
    monthlyBalance,
  } = displayMonthlyTotals;
  const expenseRatio = totalIncome > 0 ? (totalExpense / totalIncome) * 100 : 0;

  // Exact change tracking avoids JSON.stringify on full datasets during refresh.
  const lastTransactionsRef = useRef<Transaction[]>([]);
  const lastPeopleRef = useRef<PeopleLedger[]>([]);
  const isSilentLoadInFlightRef = useRef(false);
  const reviewLoadRequestIdRef = useRef(0);
  const cachedDashboardSummaryRef = useRef<DashboardSummarySnapshot | null>(null);

  useEffect(() => {
    logDashboardDebug('render_source', {
      loading,
      monthlySource: shouldUseCachedMonthlyTotals ? 'cached_summary' : 'live_state',
      peopleSource: shouldUseCachedPeopleSummary ? 'cached_summary' : 'live_state',
      reviewSource: shouldUseCachedReviewBreakdown ? 'cached_summary' : 'live_state',
      hasResolvedDashboardData,
      hasResolvedIncomeReviewDecisions,
      transactionCount: transactions.length,
      peopleCount: peopleLedger.length,
      incomeReviewCount: incomeReviewCandidates.length,
      transactionReviewCount: transactionReviewItems.length,
      hasCachedSummary: Boolean(cachedDashboardSummary),
    });
  }, [
    cachedDashboardSummary,
    hasResolvedDashboardData,
    hasResolvedIncomeReviewDecisions,
    incomeReviewCandidates.length,
    loading,
    peopleLedger.length,
    shouldUseCachedMonthlyTotals,
    shouldUseCachedPeopleSummary,
    shouldUseCachedReviewBreakdown,
    transactionReviewItems.length,
    transactions.length,
  ]);

  const loadCachedDashboardSummarySilently = useCallback(async () => {
    try {
      const snapshot = await getCachedDashboardSummary(selectedDate);
      if (isMountedRef.current) {
        cachedDashboardSummaryRef.current = snapshot;
        setCachedDashboardSummaryState(snapshot);
      }
      logDashboardDebug('summary_cache_read', {
        hit: Boolean(snapshot),
        monthKey: snapshot?.monthKey,
      });
      return snapshot;
    } catch {
      if (isMountedRef.current) {
        cachedDashboardSummaryRef.current = null;
        setCachedDashboardSummaryState(null);
      }
      logDashboardDebug('summary_cache_read', { hit: false, failed: true });
      return null;
    }
  }, [selectedDate]);

  const loadIncomeReviewDecisionsSilently = useCallback(async () => {
    try {
      const decisions = await getIncomeReviewDecisions();
      if (isMountedRef.current) {
        setIncomeReviewDecisions(decisions);
        setHasResolvedIncomeReviewDecisions(true);
      }
      logDashboardDebug('income_review_decisions_loaded', {
        count: decisions.length,
      });
      return decisions;
    } catch {
      console.warn('[Dashboard] Income review decisions unavailable');
      logDashboardDebug('income_review_decisions_unavailable', {
        keepsCachedSummary: Boolean(cachedDashboardSummaryRef.current),
      });
      return [] as IncomeReviewDecision[];
    }
  }, []);

  const loadReviewPromptDataSilently = useCallback(async () => {
    const requestId = ++reviewLoadRequestIdRef.current;
    try {
      const [candidates, queueItems] = await Promise.all([
        getIncomeReviewCandidates({ showExcluded: true }),
        getReviewQueue(),
      ]);
      if (!isMountedRef.current || requestId !== reviewLoadRequestIdRef.current) {
        return { candidates, queueItems };
      }
      setIncomeReviewCandidates(candidates);
      setTransactionReviewItems(queueItems);
      return { candidates, queueItems };
    } catch {
      console.warn('[Dashboard] Review prompt data unavailable');
      return { candidates: [] as IncomeReviewCandidate[], queueItems: [] as ReviewItem[] };
    }
  }, []);

  const areTransactionsEqual = useCallback((left: Transaction[], right: Transaction[]) => {
    if (left.length !== right.length) return false;

    return left.every((tx, index) => {
      const next = right[index];
      return (
        tx.id === next.id &&
        tx.created_at === next.created_at &&
        Number(tx.amount) === Number(next.amount) &&
        tx.type === next.type &&
        tx.category === next.category &&
        tx.note === next.note &&
        tx.account_id === next.account_id &&
        tx.account_match_status === next.account_match_status &&
        tx.account_match_reason === next.account_match_reason &&
        tx.account_match_confidence === next.account_match_confidence
      );
    });
  }, []);

  const arePeopleLedgerEqual = useCallback((left: PeopleLedger[], right: PeopleLedger[]) => {
    if (left.length !== right.length) return false;

    return left.every((entry, index) => {
      const next = right[index];
      return (
        entry.id === next.id &&
        entry.type === next.type &&
        Number(entry.remaining_amount) === Number(next.remaining_amount) &&
        entry.is_settled === next.is_settled &&
        entry.person_name === next.person_name
      );
    });
  }, []);

  const loadDataSilently = useCallback(async () => {
    if (isSilentLoadInFlightRef.current) return;
    isSilentLoadInFlightRef.current = true;

    try {
      // Load transactions
      let latestTransactions = lastTransactionsRef.current;
      let latestLedger = lastPeopleRef.current;
      let loadedTransactions = false;
      let loadedPeopleLedger = false;
      try {
        const data = await getTransactions();
        loadedTransactions = true;
        latestTransactions = data;
        logDashboardDebug('live_transactions_loaded', {
          count: data.length,
          changed: !areTransactionsEqual(lastTransactionsRef.current, data),
        });
        if (!areTransactionsEqual(lastTransactionsRef.current, data)) {
          lastTransactionsRef.current = data;
          setTransactions(data);
          // Save to cache for next instant load
          setCache(CACHE_KEYS.TRANSACTIONS, data);
        }
      } catch (error) {
        console.error('Error loading transactions:', error);
      }

      const decisions = await loadIncomeReviewDecisionsSilently();
      const reviewData = await loadReviewPromptDataSilently();
      
      // Load people ledger data
      try {
        const ledgerData = await getPeopleLedger(true);
        loadedPeopleLedger = true;
        latestLedger = ledgerData;
        const activeLedger = ledgerData.filter(entry => !entry.is_settled);
        logDashboardDebug('live_people_ledger_loaded', {
          count: ledgerData.length,
          activeCount: activeLedger.length,
          changed: !arePeopleLedgerEqual(lastPeopleRef.current, ledgerData),
        });
        if (!arePeopleLedgerEqual(lastPeopleRef.current, ledgerData)) {
          lastPeopleRef.current = ledgerData;
          setPeopleLedger(activeLedger);
          // Save to cache
          setCache(CACHE_KEYS.PEOPLE_LEDGER, ledgerData);
        }
      } catch (error) {
        console.error('Error loading people ledger:', error);
      }

      if (!loadedTransactions) {
        logDashboardDebug('live_refresh_waiting', {
          reason: 'transactions_not_loaded',
          keepsCachedSummary: Boolean(cachedDashboardSummaryRef.current),
        });
        return;
      }

      if (isMountedRef.current) {
        setHasResolvedDashboardData(true);
      }

      if (!loadedPeopleLedger) {
        logDashboardDebug('live_refresh_partial', {
          reason: 'people_ledger_not_loaded',
          transactionCount: latestTransactions.length,
        });
        return;
      }

      const activeLedger = latestLedger.filter(entry => !entry.is_settled);
      const snapshot = {
        monthlyTotals: computeMonthlyTransactionTotals(latestTransactions, selectedDate, { incomeReviewDecisions: decisions }),
        peopleSummary: computePeopleSummary(activeLedger),
        reviewBreakdown: computeDashboardReviewBreakdown(
          computeDashboardReviewPromptSummary(latestTransactions, selectedDate, { incomeReviewDecisions: decisions }),
          reviewData.candidates,
          reviewData.queueItems,
        ),
      };
      if (isMountedRef.current) {
        cachedDashboardSummaryRef.current = {
          ...snapshot,
          monthKey: `${selectedDate.getFullYear()}-${String(selectedDate.getMonth() + 1).padStart(2, '0')}`,
          createdAt: new Date().toISOString(),
        };
        setCachedDashboardSummaryState({
          ...snapshot,
          monthKey: `${selectedDate.getFullYear()}-${String(selectedDate.getMonth() + 1).padStart(2, '0')}`,
          createdAt: new Date().toISOString(),
        });
      }
      void setCachedDashboardSummary(selectedDate, snapshot);
    } catch (error) {
      console.error('Error in loadDataSilently:', error);
    } finally {
      isSilentLoadInFlightRef.current = false;
    }
  }, [
    arePeopleLedgerEqual,
    areTransactionsEqual,
    computePeopleSummary,
    loadIncomeReviewDecisionsSilently,
    loadReviewPromptDataSilently,
    selectedDate,
  ]);

  const loadData = useCallback(async () => {
    try {
      const cachedSummary = await loadCachedDashboardSummarySilently();
      if (cachedSummary) setLoading(false);
      // Step 1: Try cache first for INSTANT display (no skeleton)
      const [cachedTxns, cachedLedger] = await Promise.all([
        getCached<Transaction[]>(CACHE_KEYS.TRANSACTIONS),
        getCached<PeopleLedger[]>(CACHE_KEYS.PEOPLE_LEDGER),
      ]);

      if (cachedTxns || cachedLedger) {
        // Cache hit! Show data instantly — no skeleton needed
        const cachedTransactions = cachedTxns?.data || [];
        const shouldPreferSummaryOverEmptyTransactions = Boolean(
          cachedSummary
          && cachedTransactions.length === 0
        );
        const cachedLedgerData = cachedLedger?.data || [];
        const activeCachedLedgerCount = cachedLedgerData.filter(entry => !entry.is_settled).length;
        logDashboardDebug('raw_cache_read', {
          hasSummary: Boolean(cachedSummary),
          hasTransactionCache: Boolean(cachedTxns),
          transactionCacheStale: cachedTxns?.isStale,
          transactionCount: cachedTransactions.length,
          hasLedgerCache: Boolean(cachedLedger),
          ledgerCacheStale: cachedLedger?.isStale,
          ledgerCount: cachedLedgerData.length,
          activeLedgerCount: activeCachedLedgerCount,
          hasResolvedIncomeReviewDecisions,
          monthlyPrefersSummary: shouldPreferSummaryOverEmptyTransactions,
        });
        setTransactions(cachedTransactions);
        lastTransactionsRef.current = cachedTransactions;
        if (cachedLedger?.data) {
          const activeLedger = cachedLedger.data.filter(entry => !entry.is_settled);
          setPeopleLedger(activeLedger);
          lastPeopleRef.current = cachedLedger.data;
        }
        setHasResolvedDashboardData(Boolean(cachedTxns) && !shouldPreferSummaryOverEmptyTransactions);
        setLoading(false); // Skip skeleton entirely!
        void loadIncomeReviewDecisionsSilently();
        void loadReviewPromptDataSilently();

        // Step 2: Silently refresh in background if stale
        if (cachedTxns?.isStale || cachedLedger?.isStale) {
          loadDataSilently();
        }
        return;
      }

      // No cache — show skeleton and fetch
      setLoading(true);
      await loadDataSilently();
    } catch (error) {
      console.error('Error in loadData:', error);
    } finally {
      setLoading(false);
    }
  }, [
    hasResolvedIncomeReviewDecisions,
    loadCachedDashboardSummarySilently,
    loadDataSilently,
    loadIncomeReviewDecisionsSilently,
    loadReviewPromptDataSilently,
  ]);

  useEffect(() => {
    void loadCachedDashboardSummarySilently();
  }, [loadCachedDashboardSummarySilently]);

  // Keep ref always pointing to the latest loadDataSilently — prevents stale closure in debounce
  const loadDataSilentlyRef = useRef(loadDataSilently);
  useEffect(() => { loadDataSilentlyRef.current = loadDataSilently; }, [loadDataSilently]);

  // Debounce ref — prevents rapid back-to-back loads during bulk operations
  const loadTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const debouncedLoadSilently = useCallback(() => {
    // Cancel any pending load
    if (loadTimerRef.current) {
      clearTimeout(loadTimerRef.current);
    }
    // Wait 500ms before actually loading — if another trigger comes, reset
    loadTimerRef.current = setTimeout(() => {
      loadDataSilentlyRef.current(); // Always uses the latest version
    }, 500);
  }, []);

  useFocusEffect(
    React.useCallback(() => {
      const task = runWhenIdle(() => {
        if (isInitialLoad) {
          // First time: show skeleton loader
          loadData();
          setIsInitialLoad(false);
        } else {
          void loadReviewPromptDataSilently();
          // Debounced reload — waits for data to settle
          debouncedLoadSilently();
        }
      });
      return () => task.cancel();
    }, [isInitialLoad, debouncedLoadSilently, loadData, loadReviewPromptDataSilently])
  );

  useFocusEffect(
    React.useCallback(() => {
      return subscribeFinanceDataChanged(payload => {
        if (financeDataChangedAffects(payload, ['review'])) {
          cachedDashboardSummaryRef.current = null;
          setCachedDashboardSummaryState(null);
          setHasResolvedDashboardData(true);
          void loadReviewPromptDataSilently();
        }
        if (financeDataChangedAffects(payload, ['transactions', 'ledger'])) {
          cachedDashboardSummaryRef.current = null;
          setCachedDashboardSummaryState(null);
          setHasResolvedDashboardData(true);
          if (payload.transactionId && payload.source?.includes('delete')) {
            setTransactions(prev => prev.filter(tx => tx.id !== payload.transactionId));
            lastTransactionsRef.current = lastTransactionsRef.current.filter(tx => tx.id !== payload.transactionId);
          }
          debouncedLoadSilently();
        }
      });
    }, [debouncedLoadSilently, loadReviewPromptDataSilently])
  );

  // Cleanup debounce timer on unmount
  useEffect(() => {
    return () => {
      if (loadTimerRef.current) {
        clearTimeout(loadTimerRef.current);
      }
    };
  }, []);

  const onRefresh = async () => {
    triggerHaptic();
    setRefreshing(true);
    await loadDataSilently();
    setRefreshing(false);
  };

  const handleReviewIncome = () => {
    triggerHaptic();
    (navigation as any).navigate('Settings', {
      screen: 'MoneyMovementReview',
      params: { initialSection: 'credits' },
    });
  };

  const handleReviewMovements = () => {
    triggerHaptic();
    (navigation as any).navigate('Settings', {
      screen: 'MoneyMovementReview',
      params: { initialSection: 'payments' },
    });
  };

  const handleReviewAllMovements = () => {
    triggerHaptic();
    (navigation as any).navigate('Settings', {
      screen: 'MoneyMovementReview',
      params: { initialSection: 'all' },
    });
  };

  const handleReviewNow = displayReviewBreakdown.transactionReviewCount > 0
    ? handleReviewMovements
    : handleReviewIncome;

  // SECURITY: Blank privacy screen when app is in background
  if (isPrivacyMode) {
    return (
      <View style={[styles.loadingContainer, { backgroundColor: colors.background }]}>
        <MaterialCommunityIcons name="shield-lock-outline" size={64} color={colors.accent} />
        <Text style={[typography.h3, { color: colors.text, marginTop: 16 }]}>SpendSense is locked</Text>
      </View>
    );
  }

  if (loading && !hasCachedDashboardDisplay) {
    // Skeleton loader that mimics the actual Dashboard layout
    return (
      <ScreenWrapper>
        <AppHeader title="SpendSense" />
        <ScrollView contentContainerStyle={{ padding: spacing.lg }}>
          <Animated.View style={{ opacity: shimmerAnim }}>
          {/* Month selector skeleton */}
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.lg }}>
            <View style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: colors.border }} />
            <View style={{ width: 140, height: 20, borderRadius: 6, backgroundColor: colors.border }} />
            <View style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: colors.border }} />
          </View>

          {/* Balance card skeleton */}
          <Card style={{ padding: spacing.lg, marginBottom: spacing.lg }}>
            <View style={{ alignItems: 'center' }}>
              <View style={{ width: 100, height: 12, borderRadius: 4, backgroundColor: colors.border, marginBottom: 10 }} />
              <View style={{ width: 160, height: 28, borderRadius: 6, backgroundColor: colors.border, marginBottom: 12 }} />
              <View style={{ width: 200, height: 8, borderRadius: 4, backgroundColor: colors.border, marginBottom: 6 }} />
              <View style={{ width: 120, height: 10, borderRadius: 4, backgroundColor: colors.border }} />
            </View>
          </Card>

          {/* Income / Expense row skeleton */}
          <View style={{ flexDirection: 'row', gap: spacing.md, marginBottom: spacing.lg }}>
            <Card style={{ flex: 1, padding: spacing.md }}>
              <View style={{ width: 50, height: 10, borderRadius: 4, backgroundColor: colors.border, marginBottom: 8 }} />
              <View style={{ width: 80, height: 20, borderRadius: 4, backgroundColor: colors.border }} />
            </Card>
            <Card style={{ flex: 1, padding: spacing.md }}>
              <View style={{ width: 50, height: 10, borderRadius: 4, backgroundColor: colors.border, marginBottom: 8 }} />
              <View style={{ width: 80, height: 20, borderRadius: 4, backgroundColor: colors.border }} />
            </Card>
          </View>

          {/* Section skeleton */}
          {[1, 2].map(key => (
            <Card key={key} style={{ padding: spacing.md, marginBottom: spacing.md, opacity: 1 - (key * 0.2) }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                <View style={{ width: 120, height: 14, borderRadius: 4, backgroundColor: colors.border }} />
                <View style={{ width: 20, height: 20, borderRadius: 10, backgroundColor: colors.border }} />
              </View>
            </Card>
          ))}
          </Animated.View>
        </ScrollView>
      </ScreenWrapper>
    );
  }

  return (
    <ScreenWrapper>
      <AppHeader 
        title="SpendSense" 
        rightActions={[
          {
            icon: 'chart-bar',
            onPress: () => (navigation as any).navigate('Analytics'),
          },
          {
            icon: 'format-list-bulleted',
            onPress: () => (navigation as any).navigate('Transactions'),
          },
        ]}
      />
      
      <ScrollView
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={colors.accent}
            colors={[colors.accent]}
          />
        }
      >
        {/* Month Selector */}
        <View style={[styles.monthSelector, { paddingHorizontal: spacing.lg, paddingVertical: spacing.md }]}>
          <TouchableOpacity onPress={() => navigateMonth('prev')} style={styles.monthArrow}>
            <MaterialCommunityIcons name="chevron-left" size={28} color={colors.text} />
          </TouchableOpacity>
          <Text style={[typography.h3, { color: colors.text, fontWeight: 'bold' }]}>
            {getMonthName(selectedDate)}
          </Text>
          <TouchableOpacity 
            onPress={isCurrentMonth() ? undefined : () => navigateMonth('next')} 
            style={styles.monthArrow}
            disabled={isCurrentMonth()}
          >
            <MaterialCommunityIcons 
              name="chevron-right" 
              size={28} 
              color={colors.text} 
              style={{ opacity: isCurrentMonth() ? 0.3 : 1 }}
            />
          </TouchableOpacity>
        </View>

        {/* Hero Card - Monthly Balance */}
        <View style={{ paddingHorizontal: spacing.lg, marginBottom: spacing.lg }}>
          <View style={[styles.heroCard, { backgroundColor: colors.accent }]}>
            <View style={styles.heroCircle1} />
            <View style={styles.heroCircle2} />
            
            <Text style={[typography.caption, { color: 'rgba(255,255,255,0.8)', fontSize: 13 }]}>
              Monthly Balance
            </Text>
            <Text style={[typography.h1, { color: '#fff', fontSize: 36, fontWeight: 'bold', marginTop: 4 }]}>
              {formatAmount(monthlyBalance)}
            </Text>
            
            <View style={{ flexDirection: 'row', marginTop: spacing.md, gap: 12 }}>
              <View style={styles.heroPill}>
                <MaterialCommunityIcons name="arrow-down" size={14} color="#fff" />
                <Text style={[typography.caption, { color: '#fff', marginLeft: 4, fontSize: 11 }]}>
                  {formatAmount(totalIncome)}
                </Text>
              </View>
              <Text style={{ color: 'rgba(255,255,255,0.5)' }}>|</Text>
              <View style={styles.heroPill}>
                <MaterialCommunityIcons name="arrow-up" size={14} color="#fff" />
                <Text style={[typography.caption, { color: '#fff', marginLeft: 4, fontSize: 11 }]}>
                  {formatAmount(netExpense)}
                </Text>
              </View>
            </View>
          </View>
        </View>

        {reviewPromptCount > 0 && (
          <View style={{ paddingHorizontal: spacing.lg, marginBottom: spacing.lg }}>
            <Card style={[
              styles.reviewPromptCard,
              {
                borderColor: colors.warning || '#f59e0b',
                backgroundColor: colors.card,
              },
            ]}>
              <View style={styles.reviewPromptHeader}>
                <View style={[
                  styles.reviewPromptIcon,
                  { backgroundColor: `${colors.warning || '#f59e0b'}20` },
                ]}>
                  <MaterialCommunityIcons name="inbox-multiple-outline" size={22} color={colors.warning || '#f59e0b'} />
                </View>
                <View style={{ flex: 1, marginLeft: spacing.sm }}>
                  <Text style={[typography.bodyBold, { color: colors.text }]}>
                    Money movements need review
                  </Text>
                  <Text style={[typography.caption, { color: colors.subtext, marginTop: 2 }]}>
                    {reviewPromptLabel}
                  </Text>
                </View>
              </View>
              <Text style={[typography.body, { color: colors.text, marginTop: spacing.sm }]}>
                Some credits or debits were not counted in income or expenses.
              </Text>
              <Text style={[typography.caption, { color: colors.subtext, marginTop: spacing.xs }]}>
                Review them to keep your dashboard accurate.
              </Text>
              <View style={[styles.reviewPromptActions, { marginTop: spacing.md }]}>
                <TouchableOpacity
                  activeOpacity={0.8}
                  onPress={hasMixedReviewSources ? handleReviewAllMovements : handleReviewNow}
                  style={[styles.reviewPromptButton, { backgroundColor: colors.accent }]}>
                  <Text style={[typography.bodyBold, { color: '#fff' }]}>Review now</Text>
                  <MaterialCommunityIcons name="chevron-right" size={18} color="#fff" />
                </TouchableOpacity>
              </View>
            </Card>
          </View>
        )}

        {/* Accordion Sections */}
        <View style={{ paddingHorizontal: spacing.lg }}>
          
          {/* ACCORDION 1: Income & Expense */}
          <View style={{ marginBottom: spacing.md }}>
            <TouchableOpacity 
              onPress={() => toggleSection('incomeExpense')}
              style={styles.accordionHeader}>
              <Text style={[typography.h3, { color: colors.text, fontWeight: 'bold' }]}>
                Income & Expense
              </Text>
              <MaterialCommunityIcons 
                name={openSections.incomeExpense ? 'chevron-up' : 'chevron-down'} 
                size={24} 
                color={colors.subtext} 
              />
            </TouchableOpacity>
            <View style={[styles.divider, { backgroundColor: colors.border, marginBottom: openSections.incomeExpense ? spacing.md : 0 }]} />
            
            {openSections.incomeExpense && (
              <View>
                <View style={{ flexDirection: 'row', gap: 12, marginBottom: spacing.md }}>
                  <Card style={{ ...styles.summaryCard, flex: 1 }}>
                    <MaterialCommunityIcons name="arrow-down-circle" size={24} color={colors.income} />
                    <Text style={[typography.caption, { color: colors.subtext, marginTop: spacing.xs, fontSize: 11 }]}>
                      Income
                    </Text>
                    <Text style={[typography.h3, { color: colors.text, fontWeight: 'bold', marginTop: 4 }]}>
                      {formatAmount(totalIncome)}
                    </Text>
                  </Card>

                  <Card style={{ ...styles.summaryCard, flex: 1 }}>
                    <MaterialCommunityIcons name="arrow-up-circle" size={24} color={colors.expense} />
                    <Text style={[typography.caption, { color: colors.subtext, marginTop: spacing.xs, fontSize: 11 }]}>
                      Net Expense
                    </Text>
                    <Text style={[typography.h3, { color: colors.text, fontWeight: 'bold', marginTop: 4 }]}>
                      {formatAmount(netExpense)}
                    </Text>
                    {totalRefunds > 0 && (
                      <Text style={[typography.caption, { color: colors.subtext, marginTop: 4, fontSize: 10 }]}>
                        Gross {formatAmount(grossExpense)} | Refunds {formatAmount(totalRefunds)}
                      </Text>
                    )}
                  </Card>
                </View>

                {/* Progress Bar */}
                <View style={{ marginBottom: spacing.sm }}>
                  <View style={[styles.progressBar, { backgroundColor: colors.border }]}>
                    <View style={[styles.progressFillGreen, { width: `${Math.min(100, 100 - expenseRatio)}%` }]} />
                    <View style={[styles.progressFillRed, { width: `${Math.min(100, expenseRatio)}%` }]} />
                  </View>
                  <Text style={[typography.caption, { color: colors.subtext, marginTop: spacing.xs, fontSize: 11, textAlign: 'center' }]}>
                    {totalIncome > 0 
                      ? `This month you spent ${expenseRatio.toFixed(0)}% of income`
                      : 'No income recorded this month'}
                  </Text>
                </View>
              </View>
            )}
          </View>

          {/* ACCORDION 2: People */}
          {lentPeopleEntries.length > 0 && (
            <View style={{ marginBottom: spacing.md }}>
              <TouchableOpacity 
                onPress={() => toggleSection('people')}
                style={styles.accordionHeader}>
                <Text style={[typography.h3, { color: colors.text, fontWeight: 'bold' }]}>
                  People
                </Text>
                <MaterialCommunityIcons 
                  name={openSections.people ? 'chevron-up' : 'chevron-down'} 
                  size={24} 
                  color={colors.subtext} 
                />
              </TouchableOpacity>
              <View style={[styles.divider, { backgroundColor: colors.border, marginBottom: openSections.people ? spacing.md : 0 }]} />
              
              {openSections.people && (
                <View>
                  {/* You Lent Summary Card */}
                  <Card style={{ 
                    ...styles.lentSummaryCard,
                    borderLeftWidth: 4, 
                    borderLeftColor: colors.income,
                    padding: 16,
                    marginBottom: spacing.md,
                  }}>
                    <Text style={[typography.caption, { color: colors.subtext, fontSize: 12 }]}>
                      You Lent
                    </Text>
                    <Text style={[typography.h1, { color: colors.income, fontSize: 24, fontWeight: 'bold', marginTop: 4 }]}>
                      {formatAmount(displayPeopleSummary.totalLent)}
                    </Text>
                    <Text style={[typography.caption, { color: colors.subtext, fontSize: 12, marginTop: 4 }]}>
                      {displayPeopleSummary.lentCount} {displayPeopleSummary.lentCount === 1 ? 'person' : 'people'}
                    </Text>
                  </Card>

                  {lentPeopleEntries.slice(0, 3).map((entry) => {
                    const personColor = colors.income;
                    
                    return (
                      <Card key={entry.id} style={{ marginBottom: spacing.sm }}>
                        <View style={styles.peopleRow}>
                          <View style={[styles.avatarCircle, { backgroundColor: personColor + '20' }]}>
                            <Text style={[typography.bodyBold, { color: personColor, fontSize: 14 }]}>
                              {entry.person_name.charAt(0).toUpperCase()}
                            </Text>
                          </View>
                          <View style={{ flex: 1, marginLeft: spacing.sm }}>
                            <Text style={[typography.bodyBold, { color: colors.text, fontSize: 14 }]}>
                              {entry.person_name}
                            </Text>
                            <View style={[styles.typeBadge, { backgroundColor: personColor + '15' }]}>
                              <Text style={[typography.caption, { color: personColor, fontSize: 10 }]}>
                                Lent
                              </Text>
                            </View>
                          </View>
                          <Text style={[typography.bodyBold, { color: personColor, fontSize: 15 }]}>
                            {formatAmount(Number(entry.remaining_amount))}
                          </Text>
                        </View>
                      </Card>
                    );
                  })}

                  {lentPeopleEntries.length > 3 && (
                    <TouchableOpacity onPress={() => (navigation as any).navigate('People')}>
                      <Text style={[typography.caption, { color: colors.accent, textAlign: 'center', marginTop: spacing.xs, fontWeight: '600' }]}>
                        View all →
                      </Text>
                    </TouchableOpacity>
                  )}
                </View>
              )}
            </View>
          )}

          {/* ACCORDION 3: Invested & EMI */}
          <View style={{ marginBottom: spacing.lg }}>
            <TouchableOpacity 
              onPress={() => toggleSection('investedEmi')}
              style={styles.accordionHeader}>
              <Text style={[typography.h3, { color: colors.text, fontWeight: 'bold' }]}>
                Invested & EMI
              </Text>
              <MaterialCommunityIcons 
                name={openSections.investedEmi ? 'chevron-up' : 'chevron-down'} 
                size={24} 
                color={colors.subtext} 
              />
            </TouchableOpacity>
            <View style={[styles.divider, { backgroundColor: colors.border, marginBottom: openSections.investedEmi ? spacing.md : 0 }]} />
            
            {openSections.investedEmi && (
              <View style={{ flexDirection: 'row', gap: 12 }}>
                <Card style={{ ...styles.summaryCard, flex: 1 }}>
                  <MaterialCommunityIcons name="chart-line" size={24} color={colors.investment} />
                  <Text style={[typography.caption, { color: colors.subtext, marginTop: spacing.xs, fontSize: 11 }]}>
                    Invested
                  </Text>
                  <Text style={[typography.h3, { color: colors.text, fontWeight: 'bold', marginTop: 4 }]}>
                    {formatAmount(totalInvestment)}
                  </Text>
                </Card>

                <Card style={{ ...styles.summaryCard, flex: 1 }}>
                  <MaterialCommunityIcons name="credit-card" size={24} color={colors.emi} />
                  <Text style={[typography.caption, { color: colors.subtext, marginTop: spacing.xs, fontSize: 11 }]}>
                    EMI / Loans
                  </Text>
                  <Text style={[typography.h3, { color: colors.text, fontWeight: 'bold', marginTop: 4 }]}>
                    {formatAmount(totalEMI)}
                  </Text>
                </Card>
              </View>
            )}
          </View>
        </View>
      </ScrollView>

      {/* Quick Add FAB */}
      <TouchableOpacity
        style={[styles.quickAddFab, { backgroundColor: colors.accent }]}
        activeOpacity={0.8}
        onPress={() => setShowQuickAdd(true)}
      >
        <MaterialCommunityIcons name="microphone" size={24} color="#fff" />
      </TouchableOpacity>

      <QuickAddModal
        visible={showQuickAdd}
        onClose={() => setShowQuickAdd(false)}
        onSuccess={() => {
          loadDataSilently();
        }}
      />
    </ScreenWrapper>
  );
}

const styles = StyleSheet.create({
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  monthSelector: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  monthArrow: {
    padding: 4,
  },
  heroCard: {
    borderRadius: 16,
    padding: 20,
    position: 'relative',
    overflow: 'hidden',
    elevation: 6,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
  },
  heroCircle1: {
    position: 'absolute',
    width: 150,
    height: 150,
    borderRadius: 75,
    backgroundColor: 'rgba(255,255,255,0.08)',
    top: -30,
    right: -30,
  },
  heroCircle2: {
    position: 'absolute',
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: 'rgba(255,255,255,0.05)',
    bottom: -20,
    left: -20,
  },
  heroPill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.2)',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  lentSummaryCard: {
    elevation: 3,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 3,
  },
  accordionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
  },
  divider: {
    height: 1,
  },
  summaryCard: {
    padding: 16,
  },
  reviewPromptCard: {
    padding: 16,
    borderWidth: 1,
  },
  reviewPromptHeader: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  reviewPromptIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
  },
  reviewPromptButton: {
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  reviewPromptActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  progressBar: {
    height: 8,
    borderRadius: 4,
    flexDirection: 'row',
    overflow: 'hidden',
  },
  progressFillGreen: {
    backgroundColor: '#10b981',
    height: '100%',
  },
  progressFillRed: {
    backgroundColor: '#ef4444',
    height: '100%',
  },
  peoplePill: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  peopleRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  avatarCircle: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
  },
  typeBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 8,
    alignSelf: 'flex-start',
    marginTop: 2,
  },
  quickAddFab: {
    position: 'absolute',
    bottom: 24,
    right: 20,
    width: 56,
    height: 56,
    borderRadius: 28,
    justifyContent: 'center',
    alignItems: 'center',
    elevation: 6,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
  },
});
