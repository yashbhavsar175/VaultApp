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
import { ScreenWrapper, Card, AppHeader } from '../components';

type FilterType = 'all' | TransactionType;

export default function Transactions() {
  const { colors, typography, spacing, borderRadius } = useTheme();
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [filteredTransactions, setFilteredTransactions] = useState<Transaction[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [filter, setFilter] = useState<FilterType>('all');
  
  // Select mode state
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

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

  // Select mode functions
  const enterSelectMode = (id: string) => {
    setSelectMode(true);
    setSelectedIds(new Set([id]));
  };

  const exitSelectMode = () => {
    setSelectMode(false);
    setSelectedIds(new Set());
  };

  const toggleSelection = (id: string) => {
    const newSelected = new Set(selectedIds);
    if (newSelected.has(id)) {
      newSelected.delete(id);
    } else {
      newSelected.add(id);
    }
    setSelectedIds(newSelected);
  };

  const selectAll = () => {
    const allIds = new Set(filteredTransactions.map(t => t.id));
    setSelectedIds(allIds);
  };

  const handleBulkDelete = () => {
    const count = selectedIds.size;
    Alert.alert(
      'Delete Transactions',
      `Delete ${count} transaction${count > 1 ? 's' : ''}? This cannot be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              // Delete all selected transactions
              await Promise.all(
                Array.from(selectedIds).map(id => deleteTransaction(id))
              );
              
              Toast.show({
                type: 'success',
                text1: 'Deleted',
                text2: `${count} transaction${count > 1 ? 's' : ''} deleted successfully`,
              });
              
              exitSelectMode();
              loadTransactions();
            } catch (error) {
              Toast.show({
                type: 'error',
                text1: 'Error',
                text2: 'Failed to delete transactions',
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
      case 'lent':
        return 'hand-coin';
      case 'borrowed':
        return 'hand-heart';
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
      case 'lent':
        return '#06b6d4'; // Cyan
      case 'borrowed':
        return '#ec4899'; // Pink
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
    const isSelected = selectedIds.has(item.id);
    
    return (
      <TouchableOpacity
        onPress={() => {
          if (selectMode) {
            toggleSelection(item.id);
          }
        }}
        onLongPress={() => {
          if (!selectMode) {
            enterSelectMode(item.id);
          }
        }}
        activeOpacity={0.7}>
        <Card 
          style={{ 
            marginBottom: 6, 
            padding: 10,
            borderLeftWidth: isSelected ? 4 : 0,
            borderLeftColor: isSelected ? colors.accent : 'transparent',
            backgroundColor: isSelected ? colors.accent + '10' : colors.card,
          }}>
          <View style={styles.transactionRow}>
            {selectMode && (
              <MaterialCommunityIcons
                name={isSelected ? 'checkbox-marked-circle' : 'checkbox-blank-circle-outline'}
                size={24}
                color={isSelected ? colors.accent : colors.border}
                style={{ marginRight: 12 }}
              />
            )}
            <View style={[styles.iconBox, { backgroundColor: color + '20', borderRadius: 10 }]}>
              <MaterialCommunityIcons
                name={getTransactionIcon(item.type)}
                size={20}
                color={color}
              />
            </View>
            <View style={styles.transactionInfo}>
              <Text style={{ color: colors.text, fontSize: 14, fontWeight: '500' }}>{item.note}</Text>
              <Text style={[typography.caption, { color: colors.subtext, marginTop: spacing.xs }]}>{formatDate(item.created_at)}</Text>
            </View>
            <Text style={{ color, fontSize: 14, fontWeight: '600' }}>
              {item.type === 'income' ? '+' : 
               item.type === 'transfer' ? '↔' : '-'}{formatAmount(Number(item.amount))}
            </Text>
          </View>
        </Card>
      </TouchableOpacity>
    );
  };

  const renderEmptyState = () => (
    <View style={styles.emptyState}>
      <MaterialCommunityIcons name="inbox-outline" size={64} color={colors.border} />
      <Text style={[typography.h3, { color: colors.subtext, marginTop: spacing.md }]}>No transactions yet</Text>
      <Text style={[typography.caption, { color: colors.subtext, marginTop: spacing.xs }]}>Add your first transaction to get started</Text>
    </View>
  );

  return (
    <ScreenWrapper>
      {!selectMode && <AppHeader title="History" showBack={true} />}
      
      {selectMode ? (
        <View style={[styles.selectModeHeader, { backgroundColor: colors.card, borderBottomColor: colors.border, paddingHorizontal: spacing.md, paddingVertical: spacing.md }]}>
          <TouchableOpacity onPress={exitSelectMode}>
            <Text style={[typography.body, { color: colors.accent }]}>Cancel</Text>
          </TouchableOpacity>
          <Text style={[typography.h3, { color: colors.text }]}>
            {selectedIds.size} selected
          </Text>
          <View style={{ width: 60 }} />
        </View>
      ) : null}
      
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={[styles.filterBar, { borderBottomColor: colors.border }]}
        contentContainerStyle={{ paddingHorizontal: 20, paddingVertical: 12 }}>
        <TouchableOpacity
          style={{
            paddingHorizontal: 16,
            paddingVertical: 8,
            borderRadius: 20,
            backgroundColor: filter === 'all' ? colors.accent : colors.card,
            borderWidth: 1,
            borderColor: filter === 'all' ? colors.accent : colors.border,
            marginRight: 8,
          }}
          onPress={() => handleFilterChange('all')}>
          <Text style={{ 
            color: filter === 'all' ? '#fff' : colors.text,
            fontSize: 14,
            fontWeight: '500'
          }}>
            All
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={{
            paddingHorizontal: 16,
            paddingVertical: 8,
            borderRadius: 20,
            backgroundColor: filter === 'income' ? '#10b981' : colors.card,
            borderWidth: 1,
            borderColor: filter === 'income' ? '#10b981' : colors.border,
            marginRight: 8,
          }}
          onPress={() => handleFilterChange('income')}>
          <Text style={{ 
            color: filter === 'income' ? '#fff' : colors.text,
            fontSize: 14,
            fontWeight: '500'
          }}>
            Income
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={{
            paddingHorizontal: 16,
            paddingVertical: 8,
            borderRadius: 20,
            backgroundColor: filter === 'expense' ? '#ef4444' : colors.card,
            borderWidth: 1,
            borderColor: filter === 'expense' ? '#ef4444' : colors.border,
            marginRight: 8,
          }}
          onPress={() => handleFilterChange('expense')}>
          <Text style={{ 
            color: filter === 'expense' ? '#fff' : colors.text,
            fontSize: 14,
            fontWeight: '500'
          }}>
            Expense
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={{
            paddingHorizontal: 16,
            paddingVertical: 8,
            borderRadius: 20,
            backgroundColor: filter === 'investment' ? '#7c6af7' : colors.card,
            borderWidth: 1,
            borderColor: filter === 'investment' ? '#7c6af7' : colors.border,
            marginRight: 8,
          }}
          onPress={() => handleFilterChange('investment')}>
          <Text style={{ 
            color: filter === 'investment' ? '#fff' : colors.text,
            fontSize: 14,
            fontWeight: '500'
          }}>
            Investment
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={{
            paddingHorizontal: 16,
            paddingVertical: 8,
            borderRadius: 20,
            backgroundColor: filter === 'emi' ? '#f59e0b' : colors.card,
            borderWidth: 1,
            borderColor: filter === 'emi' ? '#f59e0b' : colors.border,
            marginRight: 8,
          }}
          onPress={() => handleFilterChange('emi')}>
          <Text style={{ 
            color: filter === 'emi' ? '#fff' : colors.text,
            fontSize: 14,
            fontWeight: '500'
          }}>
            EMI
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={{
            paddingHorizontal: 16,
            paddingVertical: 8,
            borderRadius: 20,
            backgroundColor: filter === 'transfer' ? '#f97316' : colors.card,
            borderWidth: 1,
            borderColor: filter === 'transfer' ? '#f97316' : colors.border,
            marginRight: 8,
          }}
          onPress={() => handleFilterChange('transfer')}>
          <Text style={{ 
            color: filter === 'transfer' ? '#fff' : colors.text,
            fontSize: 14,
            fontWeight: '500'
          }}>
            Transfers
          </Text>
        </TouchableOpacity>
      </ScrollView>

      <FlatList
        data={filteredTransactions}
        renderItem={renderTransaction}
        keyExtractor={item => item.id}
        contentContainerStyle={[styles.listContent, { paddingHorizontal: 16, paddingTop: 16, paddingBottom: selectMode ? 100 : 16 }]}
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

      {selectMode && (
        <View style={[styles.bottomActionBar, { backgroundColor: colors.card, borderTopColor: colors.border }]}>
          <TouchableOpacity
            style={[styles.actionButton, { backgroundColor: colors.background, borderRadius: borderRadius.md, paddingHorizontal: spacing.lg, paddingVertical: spacing.md }]}
            onPress={selectAll}>
            <Text style={[typography.body, { color: colors.text }]}>Select All</Text>
          </TouchableOpacity>
          
          <TouchableOpacity
            style={[styles.actionButton, { backgroundColor: colors.error, borderRadius: borderRadius.md, paddingHorizontal: spacing.lg, paddingVertical: spacing.md }]}
            onPress={handleBulkDelete}
            disabled={selectedIds.size === 0}>
            <Text style={[typography.body, { color: '#fff', opacity: selectedIds.size === 0 ? 0.5 : 1 }]}>
              Delete ({selectedIds.size})
            </Text>
          </TouchableOpacity>
        </View>
      )}
    </ScreenWrapper>
  );
}

const styles = StyleSheet.create({
  filterBar: {
    maxHeight: 60,
    borderBottomWidth: 1,
  },
  listContent: {
    flexGrow: 1,
  },
  transactionRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  iconBox: {
    width: 48,
    height: 48,
    justifyContent: 'center',
    alignItems: 'center',
  },
  transactionInfo: {
    flex: 1,
    marginLeft: 12,
  },
  emptyState: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingTop: 100,
  },
  selectModeHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderBottomWidth: 1,
  },
  bottomActionBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderTopWidth: 1,
  },
  actionButton: {
    flex: 1,
    marginHorizontal: 8,
    alignItems: 'center',
  },
});
