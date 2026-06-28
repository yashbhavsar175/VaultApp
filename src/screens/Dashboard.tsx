import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, LayoutAnimation, Platform, UIManager, RefreshControl, AppState, AppStateStatus, Animated, Easing } from 'react-native';
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
  computeMonthlyTransactionTotals,
} from '../utils/financeSummary';
import { getISTDate } from '../utils/dateHelpers';
import { runWhenIdle } from '../utils/runWhenIdle';




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
  const [hasResolvedDashboardData, setHasResolvedDashboardData] = useState(false);
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
    const now = getISTDate(new Date());
    const selected = getISTDate(selectedDate);
    return selected.getMonth() === now.getMonth() &&
           selected.getFullYear() === now.getFullYear();
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
    () => computeMonthlyTransactionTotals(transactions, selectedDate),
    [selectedDate, transactions]
  );


  const {
    totalIncome,
    grossExpense,
    totalRefunds,
    netExpense,
    totalExpense,
    totalInvestment,
    totalEMI,
    monthlyBalance,
  } = monthlyTotals;
  const expenseRatio = totalIncome > 0 ? (totalExpense / totalIncome) * 100 : 0;

  // Exact change tracking avoids JSON.stringify on full datasets during refresh.
  const lastTransactionsRef = useRef<Transaction[]>([]);
  const lastPeopleRef = useRef<PeopleLedger[]>([]);
  const isSilentLoadInFlightRef = useRef(false);


  useEffect(() => {
    logDashboardDebug('render_source', {
      loading,
      hasResolvedDashboardData,
    });
  }, [
    hasResolvedDashboardData,
    loading,
    peopleLedger.length,
    transactions.length,
  ]);





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

      // Removed review loaders
      // Load people ledger data
      try {
        const ledgerData = await getPeopleLedger(true);
        loadedPeopleLedger = true;
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

      if (isMountedRef.current) {
        // Force re-render with new data
      }
    } catch (error) {
      console.error('Error in loadDataSilently:', error);
    } finally {
      isSilentLoadInFlightRef.current = false;
    }
  }, [
    arePeopleLedgerEqual,
    areTransactionsEqual,
  ]);

  const loadData = useCallback(async () => {
    try {

      // Step 1: Try cache first for INSTANT display (no skeleton)
      const [cachedTxns, cachedLedger] = await Promise.all([
        getCached<Transaction[]>(CACHE_KEYS.TRANSACTIONS),
        getCached<PeopleLedger[]>(CACHE_KEYS.PEOPLE_LEDGER),
      ]);

      if (cachedTxns || cachedLedger) {
        // Cache hit! Show data instantly — no skeleton needed
        const cachedTransactions = cachedTxns?.data || [];
        const shouldPreferSummaryOverEmptyTransactions = false;
        const cachedLedgerData = cachedLedger?.data || [];
        const activeCachedLedgerCount = cachedLedgerData.filter(entry => !entry.is_settled).length;
        logDashboardDebug('raw_cache_read', {
          hasTransactionCache: Boolean(cachedTxns),
          transactionCacheStale: cachedTxns?.isStale,
          transactionCount: cachedTransactions.length,
          hasLedgerCache: Boolean(cachedLedger),
          ledgerCacheStale: cachedLedger?.isStale,
          ledgerCount: cachedLedgerData.length,
          activeLedgerCount: activeCachedLedgerCount,
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
    loadDataSilently,
  ]);

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
          // Debounced reload — waits for data to settle
          debouncedLoadSilently();
        }
      });
      return () => task.cancel();
    }, [isInitialLoad, debouncedLoadSilently, loadData])
  );

  useFocusEffect(
    React.useCallback(() => {
      return subscribeFinanceDataChanged(payload => {

        if (financeDataChangedAffects(payload, ['transactions', 'ledger'])) {
          setHasResolvedDashboardData(true);
          if (payload.transactionId && payload.source?.includes('delete')) {
            setTransactions(prev => prev.filter(tx => tx.id !== payload.transactionId));
            lastTransactionsRef.current = lastTransactionsRef.current.filter(tx => tx.id !== payload.transactionId);
          }
          debouncedLoadSilently();
        }
      });
    }, [debouncedLoadSilently])
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



  // SECURITY: Blank privacy screen when app is in background
  if (isPrivacyMode) {
    return (
      <View style={[styles.loadingContainer, { backgroundColor: colors.background }]}>
        <MaterialCommunityIcons name="shield-lock-outline" size={64} color={colors.accent} />
        <Text style={[typography.h3, { color: colors.text, marginTop: 16 }]}>SpendSense is locked</Text>
      </View>
    );
  }

  if (loading) {
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
          <TouchableOpacity
            onPress={() => navigateMonth('prev')}
            style={styles.monthArrow}
            accessibilityRole="button"
            accessibilityLabel="Previous month">
            <MaterialCommunityIcons name="chevron-left" size={28} color={colors.text} />
          </TouchableOpacity>
          <Text style={[typography.h3, { color: colors.text, fontWeight: 'bold' }]}>
            {getMonthName(selectedDate)}
          </Text>
          <TouchableOpacity 
            onPress={isCurrentMonth() ? undefined : () => navigateMonth('next')} 
            style={styles.monthArrow}
            disabled={isCurrentMonth()}
            accessibilityRole="button"
            accessibilityLabel="Next month"
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
            {monthlyBalance < 0 && <AnimatedArrows type="loss" />}
            {monthlyBalance > 0 && <AnimatedArrows type="profit" />}
            
            <Text style={[typography.caption, { color: 'rgba(255,255,255,0.8)', fontSize: 13 }]}>
              Monthly Balance
            </Text>
            <Text style={[typography.h1, { 
              color: monthlyBalance > 0 ? '#85FFB3' : (monthlyBalance < 0 ? '#FF9B9B' : '#fff'), 
              fontSize: 36, 
              fontWeight: 'bold', 
              marginTop: 4 
            }]}>
              {formatAmount(Math.abs(monthlyBalance))}
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



        {/* Accordion Sections */}
        <View style={{ paddingHorizontal: spacing.lg }}>
          
          {/* ACCORDION 1: Income & Expense */}
          <View style={{ marginBottom: spacing.md }}>
            <TouchableOpacity 
              onPress={() => toggleSection('incomeExpense')}
              accessibilityRole="button"
              accessibilityLabel={openSections.incomeExpense ? 'Collapse income and expense' : 'Expand income and expense'}
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
                accessibilityRole="button"
                accessibilityLabel={openSections.people ? 'Collapse people section' : 'Expand people section'}
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
                      {formatAmount(peopleSummary.totalLent)}
                    </Text>
                    <Text style={[typography.caption, { color: colors.subtext, fontSize: 12, marginTop: 4 }]}>
                      {peopleSummary.lentCount} {peopleSummary.lentCount === 1 ? 'person' : 'people'}
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
              accessibilityRole="button"
              accessibilityLabel={openSections.investedEmi ? 'Collapse invested and EMI' : 'Expand invested and EMI'}
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
        accessibilityRole="button"
        accessibilityLabel="Open quick add"
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

const AnimatedArrows = ({ type }: { type: 'loss' | 'profit' }) => {
  const isLoss = type === 'loss';
  return (
    <View style={[StyleSheet.absoluteFill, { overflow: 'hidden' }]} pointerEvents="none">
      {Array.from({ length: 20 }).map((_, i) => (
        <FallingArrow key={i} isLoss={isLoss} index={i} />
      ))}
    </View>
  );
};

const FallingArrow = ({ isLoss, index }: { isLoss: boolean, index: number }) => {
  const anim = useRef(new Animated.Value(0)).current;
  const startX = useRef(new Animated.Value(0)).current;
  const size = useRef(20 + Math.random() * 12).current;
  
  useEffect(() => {
    // Initial stagger delay
    const initialDelay = Math.random() * 4000;
    let isFirstRun = true;
    
    const runAnimation = () => {
      // Pick a NEW random starting X position every time the arrow falls
      // -100 to 500 covers the entire width of the screen, even for tablets
      const randomStartX = (Math.random() * 600) - 100;
      startX.setValue(randomStartX);
      anim.setValue(0);
      
      const duration = 1500 + Math.random() * 2000;
      
      Animated.sequence([
        Animated.delay(isFirstRun ? initialDelay : Math.random() * 500),
        Animated.timing(anim, {
          toValue: 1,
          duration: duration,
          easing: Easing.linear,
          useNativeDriver: true,
        })
      ]).start(() => {
        isFirstRun = false;
        runAnimation();
      });
    };
    
    runAnimation();
  }, [anim, startX]);

  const translateY = anim.interpolate({ 
    inputRange: [0, 1], 
    // Card is ~200px tall. Start well above (-80), end well below (280)
    outputRange: isLoss ? [-80, 280] : [280, -80] 
  });
  
  const deltaX = anim.interpolate({ 
    inputRange: [0, 1], 
    // Loss falls diagonally left, profit rises diagonally right
    outputRange: isLoss ? [100, -100] : [-100, 100] 
  });
  
  // Combine the dynamic random start position with the movement delta
  const translateX = Animated.add(startX, deltaX);

  const opacity = anim.interpolate({ 
    inputRange: [0, 0.1, 0.9, 1], 
    outputRange: [0, 0.8, 0.8, 0] 
  });

  return (
    <Animated.View style={{
      position: 'absolute',
      opacity,
      transform: [
        { translateX },
        { translateY },
      ]
    }}>
      <MaterialCommunityIcons 
        name={isLoss ? "arrow-bottom-left" : "arrow-top-right"} 
        size={size} 
        color={isLoss ? "#ff6b6b" : "#4ade80"} 
      />
    </Animated.View>
  );
};
