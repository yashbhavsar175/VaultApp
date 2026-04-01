import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  TouchableOpacity,
  AppState,
} from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';
import Toast from 'react-native-toast-message';
import { getTransactions, addTransaction } from '../lib/db';
import { supabase } from '../lib/supabase';
import { Transaction } from '../types';
import { useTheme } from '../context/ThemeContext';

export default function Dashboard() {
  const navigation = useNavigation();
  const { colors } = useTheme();
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [userName, setUserName] = useState('there');
  const [tapCount, setTapCount] = useState(0);
  const tapTimeoutRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  const getGreeting = () => {
    const hour = new Date().getHours();
    if (hour < 12) return 'Good morning';
    if (hour < 17) return 'Good afternoon';
    if (hour < 21) return 'Good evening';
    return 'Good night';
  };

  const loadData = async () => {
    try {
      setLoading(true);
      const data = await getTransactions();
      console.log('Fetched transactions:', data.length, data);
      const { data: { user } } = await supabase.auth.getUser();
      console.log('Current user ID:', user?.id);
      setTransactions(data);
    } catch (error) {
      console.error('Error loading transactions:', error);
    } finally {
      setLoading(false);
    }
  };

  const loadProfile = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        // Load profile name
        const { data: profile } = await supabase
          .from('profiles')
          .select('full_name')
          .eq('id', user.id)
          .single();
        
        if (profile?.full_name) {
          setUserName(profile.full_name);
        }
      }
    } catch (error) {
      console.error('Error loading profile:', error);
    }
  };

  // Hidden developer test function - 5 taps on "Net Balance" to trigger fake self-transfer
  const handleBalanceTap = () => {
    setTapCount(prev => prev + 1);
    
    // Clear existing timeout
    if (tapTimeoutRef.current) {
      clearTimeout(tapTimeoutRef.current);
    }
    
    // Set new timeout to reset tap count
    tapTimeoutRef.current = setTimeout(() => {
      setTapCount(0);
    }, 500);
    
    // Check if 5 taps
    if (tapCount + 1 === 5) {
      setTapCount(0);
      triggerFakeSelfTransfer();
    }
  };

  const triggerFakeSelfTransfer = async () => {
    console.log('🧪 Developer Test: Triggering fake self-transfer');
    
    try {
      // Transaction 1 — Debit (sending account)
      await addTransaction({
        amount: 500,
        type: 'expense',
        note: 'Sent to own Kotak A/c XX5678',
        category: 'transfer'
      });
      
      console.log('🧪 Debit transaction added');
      
      // Transaction 2 — Credit (receiving account) with 1 second delay
      setTimeout(async () => {
        await addTransaction({
          amount: 500,
          type: 'income',
          note: 'Received in Kotak A/c XX5678',
          category: 'transfer'
        });
        
        console.log('🧪 Credit transaction added');
        
        loadData();
        Toast.show({ 
          type: 'success', 
          text1: 'Self transfer test done!', 
          text2: 'Both debit + credit saved' 
        });
      }, 1000);
      
      loadData();
      
    } catch (error) {
      console.error('🧪 Error triggering fake self-transfer:', error);
      Toast.show({ 
        type: 'error', 
        text1: 'Test failed', 
        text2: String(error) 
      });
    }
  };

  useEffect(() => {
    loadData();

    // IMPORTANT: Enable Realtime for transactions table in Supabase Dashboard → Database → Replication
    
    // Set up real-time subscription for transactions
    const setupRealtimeSubscription = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      const userId = user?.id;

      if (!userId) return;

      const channel = supabase
        .channel('transactions-realtime')
        .on(
          'postgres_changes',
          {
            event: 'INSERT',
            schema: 'public',
            table: 'transactions',
            filter: `user_id=eq.${userId}`,
          },
          (payload) => {
            // Add new transaction to existing state instantly
            setTransactions(prev => [payload.new as Transaction, ...prev]);
          }
        )
        .on(
          'postgres_changes',
          {
            event: 'DELETE',
            schema: 'public',
            table: 'transactions',
          },
          (payload) => {
            setTransactions(prev => prev.filter(t => t.id !== payload.old.id));
          }
        )
        .on(
          'postgres_changes',
          {
            event: 'UPDATE',
            schema: 'public',
            table: 'transactions',
            filter: `user_id=eq.${userId}`,
          },
          (payload) => {
            setTransactions(prev => 
              prev.map(t => t.id === payload.new.id ? payload.new as Transaction : t)
            );
          }
        )
        .subscribe();

      // Clean up subscription on unmount
      return () => {
        supabase.removeChannel(channel);
      };
    };

    const cleanup = setupRealtimeSubscription();
    
    return () => {
      cleanup.then(cleanupFn => cleanupFn?.());
    };
  }, []);

  useFocusEffect(
    React.useCallback(() => {
      loadData();
      loadProfile(); // Load profile on every focus to get latest name
      
      // Listen for app state changes to reload when app comes to foreground
      const subscription = AppState.addEventListener('change', (state) => {
        if (state === 'active') {
          // Reload data when app becomes active
          setTimeout(() => {
            loadData();
            loadProfile();
          }, 500);
        }
      });
      
      return () => subscription.remove();
    }, [])
  );

  const totalIncome = transactions
    .filter(t => t.type === 'income')
    .reduce((sum, t) => sum + Number(t.amount), 0);

  const totalExpense = transactions
    .filter(t => t.type === 'expense')
    .reduce((sum, t) => sum + Number(t.amount), 0);

  const totalInvestment = transactions
    .filter(t => t.type === 'investment')
    .reduce((sum, t) => sum + Number(t.amount), 0);

  const totalEMI = transactions
    .filter(t => t.type === 'emi')
    .reduce((sum, t) => sum + Number(t.amount), 0);

  const totalTransfers = transactions
    .filter(t => t.type === 'transfer')
    .reduce((sum, t) => sum + Number(t.amount), 0);

  const netBalance = totalIncome - totalExpense - totalInvestment - totalEMI;

  const formatAmount = (amount: number) => {
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: 'INR',
      maximumFractionDigits: 0,
    }).format(amount);
  };

  const getTransactionIcon = (type: string) => {
    switch (type) {
      case 'income':
        return 'arrow-down-circle';
      case 'expense':
        return 'arrow-up-circle';
      case 'investment':
        return 'chart-line';
      case 'emi':
        return 'credit-card';
      case 'transfer':
        return 'swap-horizontal';
      default:
        return 'cash';
    }
  };

  const getTransactionColor = (type: string) => {
    switch (type) {
      case 'income':
        return '#10b981';
      case 'expense':
        return '#ef4444';
      case 'investment':
        return '#7c6af7';
      case 'emi':
        return '#f59e0b';
      case 'transfer':
        return '#f97316'; // Orange
      default:
        return '#999';
    }
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
  };

  const getTodayDate = () => {
    return new Date().toLocaleDateString('en-IN', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    });
  };

  if (loading) {
    return (
      <View style={[styles.loadingContainer, { backgroundColor: colors.background }]}>
        <ActivityIndicator size="large" color={colors.accent} />
      </View>
    );
  }

  return (
    <ScrollView style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={styles.header}>
        <Text style={[styles.greeting, { color: colors.text }]}>{getGreeting()}, {userName}</Text>
        <Text style={[styles.date, { color: colors.subtext }]}>{getTodayDate()}</Text>
      </View>

      <View style={[styles.balanceCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <TouchableOpacity onPress={handleBalanceTap} activeOpacity={1}>
          <Text style={[styles.balanceLabel, { color: colors.subtext }]}>Net Balance</Text>
          <Text style={[
            styles.balanceAmount,
            { color: netBalance >= 0 ? colors.success : colors.error }
          ]}>
            {formatAmount(netBalance)}
          </Text>
        </TouchableOpacity>
      </View>

      <View style={styles.statsGrid}>
        <View style={[styles.statCard, styles.incomeCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.statLabel, { color: colors.subtext }]}>Income</Text>
          <Text style={[styles.statAmount, { color: colors.text }]}>{formatAmount(totalIncome)}</Text>
        </View>

        <View style={[styles.statCard, styles.expenseCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.statLabel, { color: colors.subtext }]}>Expenses</Text>
          <Text style={[styles.statAmount, { color: colors.text }]}>{formatAmount(totalExpense)}</Text>
        </View>

        <View style={[styles.statCard, styles.investmentCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.statLabel, { color: colors.subtext }]}>Invested</Text>
          <Text style={[styles.statAmount, { color: colors.text }]}>{formatAmount(totalInvestment)}</Text>
        </View>

        <View style={[styles.statCard, styles.emiCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.statLabel, { color: colors.subtext }]}>EMI / Loans</Text>
          <Text style={[styles.statAmount, { color: colors.text }]}>{formatAmount(totalEMI)}</Text>
        </View>
      </View>

      <View style={styles.recentSection}>
        <View style={styles.recentHeader}>
          <Text style={[styles.recentTitle, { color: colors.text }]}>Recent Transactions</Text>
          <TouchableOpacity onPress={() => (navigation as any).navigate('Transactions')}>
            <Text style={[styles.viewAllLink, { color: colors.accent }]}>View all</Text>
          </TouchableOpacity>
        </View>

        {transactions.length > 0 ? (
          transactions.slice(0, 5).map((transaction) => (
            <View key={transaction.id} style={[styles.transactionRow, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <MaterialCommunityIcons
                name={getTransactionIcon(transaction.type)}
                size={24}
                color={getTransactionColor(transaction.type)}
              />
              <View style={styles.transactionInfo}>
                <Text style={[styles.transactionNote, { color: colors.text }]}>{transaction.note}</Text>
                <Text style={[styles.transactionDate, { color: colors.subtext }]}>{formatDate(transaction.created_at)}</Text>
              </View>
              <Text style={[
                styles.transactionAmount,
                { color: transaction.type === 'income' ? colors.success : 
                         transaction.type === 'transfer' ? colors.warning : colors.error }
              ]}>
                {transaction.type === 'income' ? '+' : 
                 transaction.type === 'transfer' ? '↔' : '-'}{formatAmount(Number(transaction.amount))}
              </Text>
            </View>
          ))
        ) : (
          <View style={styles.emptyContainer}>
            <MaterialCommunityIcons name="receipt-text-outline" size={64} color={colors.border} />
            <Text style={[styles.emptyText, { color: colors.subtext }]}>No transactions yet</Text>
            <Text style={[styles.emptySubtext, { color: colors.subtext }]}>Start tracking your finances</Text>
          </View>
        )}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  header: {
    padding: 20,
    paddingTop: 16,
  },
  greeting: {
    fontSize: 24,
    fontWeight: 'bold',
    marginBottom: 4,
  },
  date: {
    fontSize: 14,
  },
  balanceCard: {
    marginHorizontal: 20,
    marginBottom: 20,
    padding: 24,
    borderRadius: 16,
    borderWidth: 1,
  },
  balanceLabel: {
    fontSize: 14,
    marginBottom: 8,
  },
  balanceAmount: {
    fontSize: 36,
    fontWeight: 'bold',
  },
  statsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: 20,
    marginBottom: 20,
  },
  statCard: {
    width: '48%',
    padding: 16,
    borderRadius: 12,
    marginBottom: 12,
    borderWidth: 1,
    borderLeftWidth: 4,
  },
  incomeCard: {
    marginRight: '4%',
    borderLeftColor: '#10b981',
  },
  expenseCard: {
    borderLeftColor: '#ef4444',
  },
  investmentCard: {
    marginRight: '4%',
    borderLeftColor: '#7c6af7',
  },
  emiCard: {
    borderLeftColor: '#f59e0b',
  },
  statLabel: {
    fontSize: 12,
    marginBottom: 8,
  },
  statAmount: {
    fontSize: 18,
    fontWeight: 'bold',
  },
  recentSection: {
    paddingHorizontal: 20,
    paddingBottom: 20,
  },
  recentHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  recentTitle: {
    fontSize: 18,
    fontWeight: 'bold',
  },
  viewAllLink: {
    fontSize: 14,
  },
  transactionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    borderRadius: 12,
    marginBottom: 8,
    borderWidth: 1,
  },
  transactionInfo: {
    flex: 1,
    marginLeft: 12,
  },
  transactionNote: {
    fontSize: 16,
    marginBottom: 4,
  },
  transactionDate: {
    fontSize: 12,
  },
  transactionAmount: {
    fontSize: 16,
    fontWeight: 'bold',
  },
  emptyContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 40,
  },
  emptyText: {
    textAlign: 'center',
    fontSize: 16,
    marginTop: 16,
    fontWeight: '500',
  },
  emptySubtext: {
    textAlign: 'center',
    fontSize: 14,
    marginTop: 4,
  },
});
