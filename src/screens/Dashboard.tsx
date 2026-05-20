import React, { useState, useEffect, useRef, useCallback } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, LayoutAnimation, Platform, UIManager, RefreshControl, InteractionManager, AppState, AppStateStatus, Animated } from 'react-native';
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

// Enable LayoutAnimation on Android
if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

export default function Dashboard() {
  const navigation = useNavigation();
  const { colors, typography, spacing } = useTheme();
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [isInitialLoad, setIsInitialLoad] = useState(true);
  const [peopleLedger, setPeopleLedger] = useState<PeopleLedger[]>([]);
  const [peopleSummary, setPeopleSummary] = useState({ totalLent: 0, totalBorrowed: 0, lentCount: 0, borrowedCount: 0 });
  const [refreshing, setRefreshing] = useState(false);
  const [showQuickAdd, setShowQuickAdd] = useState(false);

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

  const filterTransactionsByMonth = (txns: Transaction[]) => {
    const year = selectedDate.getFullYear();
    const month = selectedDate.getMonth();
    // Use year/month comparison to avoid UTC vs local timezone issues
    // new Date(ISO string) converts UTC to local time automatically
    return txns.filter(t => {
      const txDate = new Date(t.created_at);
      return txDate.getFullYear() === year && txDate.getMonth() === month;
    });
  };

  // Helper to compute people summary from ledger data
  const computePeopleSummary = useCallback((ledgerData: PeopleLedger[]) => {
    const lentEntries = ledgerData.filter(e => e.type === 'lent');
    const borrowedEntries = ledgerData.filter(e => e.type === 'borrowed');
    const lentTotal = lentEntries.reduce((sum, e) => sum + Number(e.remaining_amount), 0);
    const borrowedTotal = borrowedEntries.reduce((sum, e) => sum + Number(e.remaining_amount), 0);
    return {
      totalLent: lentTotal,
      totalBorrowed: borrowedTotal,
      lentCount: lentEntries.length,
      borrowedCount: borrowedEntries.length,
    };
  }, []);

  // Deep equality tracking
  const lastTransactionsStringRef = useRef<string | null>(null);
  const lastPeopleStringRef = useRef<string | null>(null);

  const loadDataSilently = useCallback(async () => {
    try {
      // Load transactions
      try {
        const data = await getTransactions();
        const dataStr = JSON.stringify(data);
        if (lastTransactionsStringRef.current !== dataStr) {
          lastTransactionsStringRef.current = dataStr;
          setTransactions(data);
          // Save to cache for next instant load
          setCache(CACHE_KEYS.TRANSACTIONS, data);
        }
      } catch (error) {
        console.error('Error loading transactions:', error);
      }
      
      // Load people ledger data
      try {
        const ledgerData = await getPeopleLedger(true);
        const activeLedger = ledgerData.filter(entry => !entry.is_settled);
        const ledgerStr = JSON.stringify(ledgerData);
        if (lastPeopleStringRef.current !== ledgerStr) {
          lastPeopleStringRef.current = ledgerStr;
          setPeopleLedger(activeLedger);
          setPeopleSummary(computePeopleSummary(activeLedger));
          // Save to cache
          setCache(CACHE_KEYS.PEOPLE_LEDGER, ledgerData);
        }
      } catch (error) {
        console.error('Error loading people ledger:', error);
      }
    } catch (error) {
      console.error('Error in loadDataSilently:', error);
    }
  }, [computePeopleSummary]);

  const loadData = useCallback(async () => {
    try {
      // Step 1: Try cache first for INSTANT display (no skeleton)
      const [cachedTxns, cachedLedger] = await Promise.all([
        getCached<Transaction[]>(CACHE_KEYS.TRANSACTIONS),
        getCached<PeopleLedger[]>(CACHE_KEYS.PEOPLE_LEDGER),
      ]);

      if (cachedTxns || cachedLedger) {
        // Cache hit! Show data instantly — no skeleton needed
        setTransactions(cachedTxns?.data || []);
        if (cachedLedger?.data) {
          const activeLedger = cachedLedger.data.filter(entry => !entry.is_settled);
          setPeopleLedger(activeLedger);
          setPeopleSummary(computePeopleSummary(activeLedger));
        }
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
  }, [computePeopleSummary, loadDataSilently]);

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

  useEffect(() => {
    if (!isInitialLoad) {
      loadData();
    }
  }, [selectedDate, isInitialLoad, loadData]);

  useFocusEffect(
    React.useCallback(() => {
      const task = InteractionManager.runAfterInteractions(() => {
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

  // Filter transactions for selected month
  const monthlyTransactions = filterTransactionsByMonth(transactions);

  const totalIncome = monthlyTransactions
    .filter(t => t.type === 'income')
    .reduce((sum, t) => sum + Number(t.amount), 0);

  const totalExpense = monthlyTransactions
    .filter(t => t.type === 'expense')
    .reduce((sum, t) => sum + Number(t.amount), 0);

  const totalInvestment = monthlyTransactions
    .filter(t => t.type === 'investment')
    .reduce((sum, t) => sum + Number(t.amount), 0);

  const totalEMI = monthlyTransactions
    .filter(t => t.type === 'emi')
    .reduce((sum, t) => sum + Number(t.amount), 0);

  const monthlyBalance = totalIncome - totalExpense - totalInvestment - totalEMI;
  
  const expenseRatio = totalIncome > 0 ? (totalExpense / totalIncome) * 100 : 0;


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
                  {formatAmount(totalExpense)}
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
                      Expense
                    </Text>
                    <Text style={[typography.h3, { color: colors.text, fontWeight: 'bold', marginTop: 4 }]}>
                      {formatAmount(totalExpense)}
                    </Text>
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
          {peopleLedger.filter(e => e.type === 'lent').length > 0 && (
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
                      {formatAmount(peopleSummary.totalLent)}
                    </Text>
                    <Text style={[typography.caption, { color: colors.subtext, fontSize: 12, marginTop: 4 }]}>
                      {peopleSummary.lentCount} {peopleSummary.lentCount === 1 ? 'person' : 'people'}
                    </Text>
                  </Card>

                  {peopleLedger.filter(e => e.type === 'lent').slice(0, 3).map((entry) => {
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

                  {peopleLedger.filter(e => e.type === 'lent').length > 3 && (
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
