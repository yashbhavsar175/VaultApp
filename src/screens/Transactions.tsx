import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  Alert,
  RefreshControl,
  ScrollView,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';
import Toast from 'react-native-toast-message';
import { getTransactions, deleteTransaction } from '../lib/db';
import { Transaction, TransactionType } from '../types';
import { useTheme } from '../context/ThemeContext';

type FilterType = 'all' | TransactionType;

export default function Transactions() {
  const { colors } = useTheme();
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [filteredTransactions, setFilteredTransactions] = useState<Transaction[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [filter, setFilter] = useState<FilterType>('all');

  const loadTransactions = async () => {
    try {
      const data = await getTransactions();
      setTransactions(data);
      applyFilter(data, filter);
    } catch (error) {
      Toast.show({
        type: 'error',
        text1: 'Error',
        text2: 'Failed to load transactions',
      });
    } finally {
      setRefreshing(false);
    }
  };

  useEffect(() => {
    loadTransactions();
  }, []);

  useFocusEffect(
    React.useCallback(() => {
      loadTransactions();
    }, [])
  );

  const applyFilter = (data: Transaction[], filterType: FilterType) => {
    if (filterType === 'all') {
      setFilteredTransactions(data);
    } else {
      setFilteredTransactions(data.filter(t => t.type === filterType));
    }
  };

  const handleFilterChange = (filterType: FilterType) => {
    setFilter(filterType);
    applyFilter(transactions, filterType);
  };

  const onRefresh = () => {
    setRefreshing(true);
    loadTransactions();
  };

  const handleDeleteTransaction = (id: string, note: string) => {
    Alert.alert(
      'Delete Transaction',
      `Delete "${note}"?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              await deleteTransaction(id);
              Toast.show({
                type: 'success',
                text1: 'Deleted',
                text2: 'Transaction deleted successfully',
              });
              loadTransactions();
            } catch (error) {
              Toast.show({
                type: 'error',
                text1: 'Error',
                text2: 'Failed to delete transaction',
              });
            }
          },
        },
      ]
    );
  };

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
    return date.toLocaleDateString('en-IN', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
  };

  const renderTransaction = ({ item }: { item: Transaction }) => {
    const color = getTransactionColor(item.type);
    return (
      <TouchableOpacity
        style={[styles.transactionRow, { backgroundColor: colors.card, borderColor: colors.border }]}
        onLongPress={() => handleDeleteTransaction(item.id, item.note)}
        activeOpacity={0.7}>
        <View style={[styles.iconBox, { backgroundColor: color + '20' }]}>
          <MaterialCommunityIcons
            name={getTransactionIcon(item.type)}
            size={24}
            color={color}
          />
        </View>
        <View style={styles.transactionInfo}>
          <Text style={[styles.transactionNote, { color: colors.text }]}>{item.note}</Text>
          <Text style={[styles.transactionDate, { color: colors.subtext }]}>{formatDate(item.created_at)}</Text>
        </View>
        <Text style={[styles.transactionAmount, { color }]}>
          {item.type === 'income' ? '+' : 
           item.type === 'transfer' ? '↔' : '-'}{formatAmount(Number(item.amount))}
        </Text>
      </TouchableOpacity>
    );
  };

  const renderEmptyState = () => (
    <View style={styles.emptyState}>
      <MaterialCommunityIcons name="inbox-outline" size={64} color={colors.border} />
      <Text style={[styles.emptyText, { color: colors.subtext }]}>No transactions yet</Text>
      <Text style={[styles.emptySubtext, { color: colors.subtext }]}>Add your first transaction to get started</Text>
    </View>
  );

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={[styles.filterBar, { borderBottomColor: colors.border }]}
        contentContainerStyle={styles.filterBarContent}>
        <TouchableOpacity
          style={[styles.filterPill, { borderColor: colors.border, backgroundColor: colors.card }, filter === 'all' && { backgroundColor: colors.background }]}
          onPress={() => handleFilterChange('all')}>
          <Text style={[styles.filterText, { color: colors.subtext }, filter === 'all' && { color: colors.accent }]}>
            All
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[
            styles.filterPill,
            { borderColor: '#10b981', backgroundColor: colors.card },
            filter === 'income' && { backgroundColor: colors.background },
          ]}
          onPress={() => handleFilterChange('income')}>
          <Text
            style={[
              styles.filterText,
              { color: colors.subtext },
              filter === 'income' && { color: '#10b981' },
            ]}>
            Income
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[
            styles.filterPill,
            { borderColor: '#ef4444', backgroundColor: colors.card },
            filter === 'expense' && { backgroundColor: colors.background },
          ]}
          onPress={() => handleFilterChange('expense')}>
          <Text
            style={[
              styles.filterText,
              { color: colors.subtext },
              filter === 'expense' && { color: '#ef4444' },
            ]}>
            Expense
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[
            styles.filterPill,
            { borderColor: '#7c6af7', backgroundColor: colors.card },
            filter === 'investment' && { backgroundColor: colors.background },
          ]}
          onPress={() => handleFilterChange('investment')}>
          <Text
            style={[
              styles.filterText,
              { color: colors.subtext },
              filter === 'investment' && { color: '#7c6af7' },
            ]}>
            Investment
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[
            styles.filterPill,
            { borderColor: '#f59e0b', backgroundColor: colors.card },
            filter === 'emi' && { backgroundColor: colors.background },
          ]}
          onPress={() => handleFilterChange('emi')}>
          <Text
            style={[
              styles.filterText,
              { color: colors.subtext },
              filter === 'emi' && { color: '#f59e0b' },
            ]}>
            EMI
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[
            styles.filterPill,
            { borderColor: '#f97316', backgroundColor: colors.card },
            filter === 'transfer' && { backgroundColor: colors.background },
          ]}
          onPress={() => handleFilterChange('transfer')}>
          <Text
            style={[
              styles.filterText,
              { color: colors.subtext },
              filter === 'transfer' && { color: '#f97316' },
            ]}>
            Transfers
          </Text>
        </TouchableOpacity>
      </ScrollView>

      <FlatList
        data={filteredTransactions}
        renderItem={renderTransaction}
        keyExtractor={item => item.id}
        contentContainerStyle={styles.listContent}
        ListEmptyComponent={renderEmptyState}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={colors.accent}
            colors={[colors.accent]}
          />
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  filterBar: {
    maxHeight: 60,
    borderBottomWidth: 1,
  },
  filterBarContent: {
    paddingHorizontal: 20,
    paddingVertical: 12,
    gap: 8,
  },
  filterPill: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 2,
    marginRight: 8,
  },
  filterPillActive: {},
  filterText: {
    fontSize: 14,
    fontWeight: '600',
  },
  filterTextActive: {},
  listContent: {
    padding: 20,
    flexGrow: 1,
  },
  transactionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    borderRadius: 12,
    marginBottom: 12,
    borderWidth: 1,
  },
  iconBox: {
    width: 48,
    height: 48,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  transactionInfo: {
    flex: 1,
    marginLeft: 12,
  },
  transactionNote: {
    fontSize: 16,
    marginBottom: 4,
    fontWeight: '500',
  },
  transactionDate: {
    fontSize: 12,
  },
  transactionAmount: {
    fontSize: 16,
    fontWeight: 'bold',
  },
  emptyState: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingTop: 100,
  },
  emptyText: {
    fontSize: 18,
    marginTop: 16,
    fontWeight: '600',
  },
  emptySubtext: {
    fontSize: 14,
    marginTop: 8,
  },
});
