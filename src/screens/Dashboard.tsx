import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, ActivityIndicator, TouchableOpacity, ScrollView, LayoutAnimation, Platform, UIManager } from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';
import { getTransactions } from '../lib/db';
import { supabase } from '../lib/supabase';
import { Transaction, PeopleLedger } from '../types';
import { useTheme } from '../context/ThemeContext';
import { ScreenWrapper, Card, AppHeader } from '../components';
import { getPeopleLedger } from '../lib/peopleLedger';

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
  
  // Month selector state
  const [selectedDate, setSelectedDate] = useState(new Date());
  
  // Accordion state
  const [openSections, setOpenSections] = useState({
    incomeExpense: true,
    people: true,
    investedEmi: false,
  });

  const toggleSection = (section: keyof typeof openSections) => {
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
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0, 23, 59, 59);

    return txns.filter(t => {
      const txDate = new Date(t.created_at);
      return txDate >= firstDay && txDate <= lastDay;
    });
  };

  const loadData = async () => {
    try {
      setLoading(true);
      
      // Load transactions
      try {
        const data = await getTransactions();
        setTransactions(data);
      } catch (error) {
        console.error('Error loading transactions:', error);
        setTransactions([]);
      }
      
      // Load people ledger data
      try {
        const ledgerData = await getPeopleLedger(false);
        setPeopleLedger(ledgerData);
        
        const lentEntries = ledgerData.filter(e => e.type === 'lent');
        const borrowedEntries = ledgerData.filter(e => e.type === 'borrowed');
        
        const lentTotal = lentEntries.reduce((sum, e) => sum + Number(e.remaining_amount), 0);
        const borrowedTotal = borrowedEntries.reduce((sum, e) => sum + Number(e.remaining_amount), 0);
        
        setPeopleSummary({ 
          totalLent: lentTotal, 
          totalBorrowed: borrowedTotal,
          lentCount: lentEntries.length,
          borrowedCount: borrowedEntries.length,
        });
      } catch (error) {
        console.error('Error loading people ledger:', error);
        setPeopleLedger([]);
      }
    } catch (error) {
      console.error('Error in loadData:', error);
    } finally {
      setLoading(false);
    }
  };

  const loadDataSilently = async () => {
    // Load data in background without showing loader
    try {
      // Load transactions
      try {
        const data = await getTransactions();
        setTransactions(data);
      } catch (error) {
        console.error('Error loading transactions:', error);
      }
      
      // Load people ledger data
      try {
        const ledgerData = await getPeopleLedger(false);
        setPeopleLedger(ledgerData);
        
        const lentEntries = ledgerData.filter(e => e.type === 'lent');
        const borrowedEntries = ledgerData.filter(e => e.type === 'borrowed');
        
        const lentTotal = lentEntries.reduce((sum, e) => sum + Number(e.remaining_amount), 0);
        const borrowedTotal = borrowedEntries.reduce((sum, e) => sum + Number(e.remaining_amount), 0);
        
        setPeopleSummary({ 
          totalLent: lentTotal, 
          totalBorrowed: borrowedTotal,
          lentCount: lentEntries.length,
          borrowedCount: borrowedEntries.length,
        });
      } catch (error) {
        console.error('Error loading people ledger:', error);
      }
    } catch (error) {
      console.error('Error in loadDataSilently:', error);
    }
  };

  const loadProfile = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        const { data: profile } = await supabase
          .from('profiles')
          .select('full_name')
          .eq('id', user.id)
          .single();
      }
    } catch (error) {
      console.error('Error loading profile:', error);
    }
  };

  useEffect(() => {
    loadData();
  }, [selectedDate]);

  useFocusEffect(
    React.useCallback(() => {
      if (isInitialLoad) {
        // First time: show loader
        loadData();
        loadProfile();
        setIsInitialLoad(false);
      } else {
        // Subsequent visits: load silently in background
        loadDataSilently();
        loadProfile();
      }
    }, [isInitialLoad])
  );

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

  const formatAmount = (amount: number) => {
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: 'INR',
      maximumFractionDigits: 0,
    }).format(amount);
  };

  if (loading) {
    return (
      <ScreenWrapper>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={colors.accent} />
        </View>
      </ScreenWrapper>
    );
  }

  return (
    <ScreenWrapper>
      <AppHeader 
        title="SpendSense" 
        rightActions={[
          {
            icon: 'bank',
            onPress: () => (navigation as any).navigate('Banks'),
          },
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
      
      <ScrollView showsVerticalScrollIndicator={false}>
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
                    <MaterialCommunityIcons name="arrow-down-circle" size={24} color="#10b981" />
                    <Text style={[typography.caption, { color: colors.subtext, marginTop: spacing.xs, fontSize: 11 }]}>
                      Income
                    </Text>
                    <Text style={[typography.h3, { color: colors.text, fontWeight: 'bold', marginTop: 4 }]}>
                      {formatAmount(totalIncome)}
                    </Text>
                  </Card>

                  <Card style={{ ...styles.summaryCard, flex: 1 }}>
                    <MaterialCommunityIcons name="arrow-up-circle" size={24} color="#ef4444" />
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
                    borderLeftColor: '#10b981',
                    padding: 16,
                    marginBottom: spacing.md,
                  }}>
                    <Text style={[typography.caption, { color: colors.subtext, fontSize: 12 }]}>
                      You Lent
                    </Text>
                    <Text style={[typography.h1, { color: '#10b981', fontSize: 24, fontWeight: 'bold', marginTop: 4 }]}>
                      {formatAmount(peopleSummary.totalLent)}
                    </Text>
                    <Text style={[typography.caption, { color: colors.subtext, fontSize: 12, marginTop: 4 }]}>
                      {peopleSummary.lentCount} {peopleSummary.lentCount === 1 ? 'person' : 'people'}
                    </Text>
                  </Card>

                  {peopleLedger.filter(e => e.type === 'lent').slice(0, 3).map((entry) => {
                    const personColor = '#10b981';
                    
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
                  <MaterialCommunityIcons name="chart-line" size={24} color="#7c3aed" />
                  <Text style={[typography.caption, { color: colors.subtext, marginTop: spacing.xs, fontSize: 11 }]}>
                    Invested
                  </Text>
                  <Text style={[typography.h3, { color: colors.text, fontWeight: 'bold', marginTop: 4 }]}>
                    {formatAmount(totalInvestment)}
                  </Text>
                </Card>

                <Card style={{ ...styles.summaryCard, flex: 1 }}>
                  <MaterialCommunityIcons name="credit-card" size={24} color="#f59e0b" />
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
});
