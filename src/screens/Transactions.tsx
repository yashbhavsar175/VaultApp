import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  Alert,
  RefreshControl,
  ScrollView,
  Pressable,
} from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { StackNavigationProp } from '@react-navigation/stack';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';
import Toast from 'react-native-toast-message';
import { getTransactions, deleteTransaction, updateTransaction } from '../lib/db';
import { Transaction, TransactionType } from '../types';
import { useTheme } from '../context/ThemeContext';
import { ScreenWrapper, AppHeader } from '../components';
import EditTransactionModal from '../components/ui/EditTransactionModal';
import AppConfirmModal from '../components/ui/AppConfirmModal';

type FilterType = 'all' | TransactionType;

type DashboardStackParamList = {
  DashboardHome: undefined;
  Banks: undefined;
  Transactions: undefined;
  Analytics: undefined;
  TransactionDetail: { transactionId: string };
};

type TransactionsScreenNavigationProp = StackNavigationProp<
  DashboardStackParamList,
  'Transactions'
>;

// Helper functions moved outside component to avoid re-creation
const getTransactionIcon = (type: string) => {
  switch (type) {
    case 'income': return 'arrow-down-circle';
    case 'expense': return 'arrow-up-circle';
    case 'investment': return 'chart-line';
    case 'emi': return 'credit-card';
    case 'transfer': return 'swap-horizontal';
    case 'lent': return 'hand-coin';
    case 'borrowed': return 'hand-heart';
    default: return 'cash';
  }
};

const getTransactionColor = (type: string) => {
  switch (type) {
    case 'income': return '#10b981';
    case 'expense': return '#ef4444';
    case 'investment': return '#7c6af7';
    case 'emi': return '#f59e0b';
    case 'transfer': return '#f97316';
    case 'lent': return '#06b6d4';
    case 'borrowed': return '#ec4899';
    default: return '#999';
  }
};

const formatAmount = (amount: number) => {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(amount);
};

const formatDate = (dateString: string) => {
  const date = new Date(dateString);
  return date.toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
};

// Memoized transaction row component — only re-renders when its own props change
const TransactionRow = React.memo(({ 
  item, 
  isSelected, 
  selectMode, 
  onPress, 
  onLongPress,
  colors,
  typography,
  spacing,
}: {
  item: Transaction;
  isSelected: boolean;
  selectMode: boolean;
  onPress: (item: Transaction) => void;
  onLongPress: (id: string) => void;
  colors: any;
  typography: any;
  spacing: any;
}) => {
  const color = getTransactionColor(item.type);

  return (
    <Pressable
      onPress={() => onPress(item)}
      onLongPress={() => onLongPress(item.id)}
      delayLongPress={250}
      android_ripple={{ color: colors.accent + '20', borderless: false }}
      style={({ pressed }) => [
        styles.rowCard,
        {
          backgroundColor: isSelected ? colors.accent + '10' : colors.card,
          borderLeftWidth: isSelected ? 4 : 0,
          borderLeftColor: isSelected ? colors.accent : 'transparent',
          borderRadius: 16,
          padding: 10,
          marginBottom: 6,
          opacity: pressed ? 0.85 : 1,
        },
      ]}>
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
    </Pressable>
  );
});

export default function Transactions() {
  const navigation = useNavigation<TransactionsScreenNavigationProp>();
  const { colors, typography, spacing, borderRadius } = useTheme();
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [filteredTransactions, setFilteredTransactions] = useState<Transaction[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [filter, setFilter] = useState<FilterType>('all');
  
  // Select mode state — use a plain object for O(1) lookup instead of Set
  const [selectMode, setSelectMode] = useState(false);
  const [selectedMap, setSelectedMap] = useState<Record<string, boolean>>({});

  // Derived selected count and all selected status
  const selectedCount = useMemo(() => Object.keys(selectedMap).length, [selectedMap]);
  const isAllSelected = useMemo(() => {
    return filteredTransactions.length > 0 && selectedCount === filteredTransactions.length;
  }, [filteredTransactions.length, selectedCount]);

  // Edit modal state
  const [isEditModalVisible, setIsEditModalVisible] = useState(false);
  const [editingTransaction, setEditingTransaction] = useState<Transaction | null>(null);

  // Confirm dialog state
  const [confirmDialog, setConfirmDialog] = useState<{
    visible: boolean;
    title: string;
    message: string;
    confirmText?: string;
    isDestructive: boolean;
    onConfirm: () => void;
  } | null>(null);

  // Double-tap tracking
  const lastTapRef = useRef<{ id: string; time: number } | null>(null);

  const loadTransactions = useCallback(async () => {
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
  }, [filter]);

  useEffect(() => {
    loadTransactions();
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadTransactions();
    }, [])
  );

  const applyFilter = useCallback((data: Transaction[], filterType: FilterType) => {
    if (filterType === 'all') {
      setFilteredTransactions(data);
    } else {
      setFilteredTransactions(data.filter(t => t.type === filterType));
    }
  }, []);

  const handleFilterChange = useCallback((filterType: FilterType) => {
    setFilter(filterType);
    applyFilter(transactions, filterType);
  }, [transactions, applyFilter]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    loadTransactions();
  }, [loadTransactions]);

  const handleDeleteTransaction = useCallback((id: string, note: string) => {
    setConfirmDialog({
      visible: true,
      title: 'Delete Transaction',
      message: `Delete "${note}"?`,
      confirmText: 'Delete',
      isDestructive: true,
      onConfirm: async () => {
        try {
          await deleteTransaction(id);
          Toast.show({
            type: 'success',
            text1: 'Deleted',
            text2: 'Transaction deleted successfully',
          });
          loadTransactions();
          setConfirmDialog(null);
        } catch (error) {
          Toast.show({
            type: 'error',
            text1: 'Error',
            text2: 'Failed to delete transaction',
          });
        }
      }
    });
  }, [loadTransactions]);

  // Select mode functions — instant updates with object spread
  const enterSelectMode = useCallback((id: string) => {
    // Small delay allows the ripple animation to finish smoothly
    // before the JS thread blocks to re-render the list
    setTimeout(() => {
      setSelectMode(true);
      setSelectedMap({ [id]: true });
    }, 50);
  }, []);

  const exitSelectMode = useCallback(() => {
    setSelectMode(false);
    setSelectedMap({});
  }, []);

  const toggleSelection = useCallback((id: string) => {
    setSelectedMap(prev => {
      const next = { ...prev };
      if (next[id]) {
        delete next[id];
      } else {
        next[id] = true;
      }
      return next;
    });
  }, []);

  const toggleSelectAll = useCallback(() => {
    if (isAllSelected) {
      setSelectedMap({});
    } else {
      const map: Record<string, boolean> = {};
      filteredTransactions.forEach(t => { map[t.id] = true; });
      setSelectedMap(map);
    }
  }, [filteredTransactions, isAllSelected]);

  const handleBulkDelete = useCallback(() => {
    const ids = Object.keys(selectedMap);
    const count = ids.length;
    setConfirmDialog({
      visible: true,
      title: 'Delete Transactions',
      message: `Delete ${count} transaction${count > 1 ? 's' : ''}? This cannot be undone.`,
      confirmText: 'Delete',
      isDestructive: true,
      onConfirm: async () => {
        try {
          await Promise.all(ids.map(id => deleteTransaction(id)));
          
          Toast.show({
            type: 'success',
            text1: 'Deleted',
            text2: `${count} transaction${count > 1 ? 's' : ''} deleted successfully`,
          });
          
          exitSelectMode();
          loadTransactions();
          setConfirmDialog(null);
        } catch (error) {
          Toast.show({
            type: 'error',
            text1: 'Error',
            text2: 'Failed to delete transactions',
          });
        }
      }
    });
  }, [selectedMap, exitSelectMode, loadTransactions]);

  // Edit modal functions
  const openEditModal = useCallback((transaction: Transaction) => {
    setEditingTransaction(transaction);
    setIsEditModalVisible(true);
  }, []);

  const closeEditModal = useCallback(() => {
    setIsEditModalVisible(false);
    setEditingTransaction(null);
  }, []);

  const handleSaveEdit = useCallback(async (id: string, updates: Partial<Transaction>) => {
    try {
      await updateTransaction(id, updates);
      
      Toast.show({
        type: 'success',
        text1: 'Updated',
        text2: 'Transaction updated successfully',
      });
      
      closeEditModal();
      loadTransactions();
    } catch (error) {
      Toast.show({
        type: 'error',
        text1: 'Error',
        text2: 'Failed to update transaction',
      });
    }
  }, [closeEditModal, loadTransactions]);

  // Memoized press handlers for each item
  const handleItemPress = useCallback((item: Transaction) => {
    if (selectMode) {
      toggleSelection(item.id);
      return;
    }
    navigation.navigate('TransactionDetail', { transactionId: item.id });
  }, [selectMode, toggleSelection, navigation]);

  const handleItemLongPress = useCallback((id: string) => {
    if (!selectMode) {
      enterSelectMode(id);
    }
  }, [selectMode, enterSelectMode]);

  // Memoized renderItem — returns a stable function
  const renderTransaction = useCallback(({ item }: { item: Transaction }) => {
    return (
      <TransactionRow
        item={item}
        isSelected={!!selectedMap[item.id]}
        selectMode={selectMode}
        onPress={handleItemPress}
        onLongPress={handleItemLongPress}
        colors={colors}
        typography={typography}
        spacing={spacing}
      />
    );
  }, [selectedMap, selectMode, handleItemPress, handleItemLongPress, colors, typography, spacing]);

  const renderEmptyState = useCallback(() => (
    <View style={styles.emptyState}>
      <MaterialCommunityIcons name="inbox-outline" size={64} color={colors.border} />
      <Text style={[typography.h3, { color: colors.subtext, marginTop: spacing.md }]}>No transactions yet</Text>
      <Text style={[typography.caption, { color: colors.subtext, marginTop: spacing.xs }]}>Add your first transaction to get started</Text>
    </View>
  ), [colors, typography, spacing]);

  // Stable key extractor
  const keyExtractor = useCallback((item: Transaction) => item.id, []);

  // Stable content container style
  const listContentStyle = useMemo(() => [
    styles.listContent, 
    { paddingHorizontal: 16, paddingTop: 16, paddingBottom: selectMode ? 100 : 16 }
  ], [selectMode]);

  return (
    <ScreenWrapper>
      {selectMode ? (
        <View style={[styles.selectModeHeader, { backgroundColor: colors.background, paddingHorizontal: spacing.md, paddingVertical: 16 }]}>
          <TouchableOpacity onPress={exitSelectMode} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
            <MaterialCommunityIcons name="close" size={24} color={colors.text} />
          </TouchableOpacity>
          <Text style={[typography.h2, { color: colors.text }]}>
            {selectedCount} selected
          </Text>
          <View style={{ width: 24 }} />
        </View>
      ) : (
        <AppHeader title="History" showBack={true} />
      )}
      
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={[styles.filterBar, { borderBottomColor: colors.border }]}
        contentContainerStyle={{ paddingHorizontal: 16, paddingVertical: 12, gap: 8 }}>
        <TouchableOpacity
          style={[styles.filterButton, {
            backgroundColor: filter === 'all' ? colors.accent : colors.card,
            borderColor: filter === 'all' ? colors.accent : colors.border,
          }]}
          onPress={() => handleFilterChange('all')}>
          <Text 
            style={[styles.filterButtonText, { 
              color: filter === 'all' ? '#fff' : colors.text,
            }]}
            numberOfLines={1}>
            All
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.filterButton, {
            backgroundColor: filter === 'income' ? '#10b981' : colors.card,
            borderColor: filter === 'income' ? '#10b981' : colors.border,
          }]}
          onPress={() => handleFilterChange('income')}>
          <Text 
            style={[styles.filterButtonText, { 
              color: filter === 'income' ? '#fff' : colors.text,
            }]}
            numberOfLines={1}>
            Income
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.filterButton, {
            backgroundColor: filter === 'expense' ? '#ef4444' : colors.card,
            borderColor: filter === 'expense' ? '#ef4444' : colors.border,
          }]}
          onPress={() => handleFilterChange('expense')}>
          <Text 
            style={[styles.filterButtonText, { 
              color: filter === 'expense' ? '#fff' : colors.text,
            }]}
            numberOfLines={1}>
            Expense
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.filterButton, {
            backgroundColor: filter === 'investment' ? '#7c6af7' : colors.card,
            borderColor: filter === 'investment' ? '#7c6af7' : colors.border,
          }]}
          onPress={() => handleFilterChange('investment')}>
          <Text 
            style={[styles.filterButtonText, { 
              color: filter === 'investment' ? '#fff' : colors.text,
            }]}
            numberOfLines={1}>
            Investment
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.filterButton, {
            backgroundColor: filter === 'emi' ? '#f59e0b' : colors.card,
            borderColor: filter === 'emi' ? '#f59e0b' : colors.border,
          }]}
          onPress={() => handleFilterChange('emi')}>
          <Text 
            style={[styles.filterButtonText, { 
              color: filter === 'emi' ? '#fff' : colors.text,
            }]}
            numberOfLines={1}>
            EMI
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.filterButton, {
            backgroundColor: filter === 'transfer' ? '#f97316' : colors.card,
            borderColor: filter === 'transfer' ? '#f97316' : colors.border,
          }]}
          onPress={() => handleFilterChange('transfer')}>
          <Text 
            style={[styles.filterButtonText, { 
              color: filter === 'transfer' ? '#fff' : colors.text,
            }]}
            numberOfLines={1}>
            Transfers
          </Text>
        </TouchableOpacity>
      </ScrollView>

      <FlatList
        data={filteredTransactions}
        renderItem={renderTransaction}
        keyExtractor={keyExtractor}
        extraData={selectedMap}
        maxToRenderPerBatch={10}
        windowSize={5}
        initialNumToRender={10}
        contentContainerStyle={listContentStyle}
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
            onPress={toggleSelectAll}>
            <Text style={[typography.body, { color: colors.text }]}>
              {isAllSelected ? 'Deselect All' : 'Select All'}
            </Text>
          </TouchableOpacity>
          
          <TouchableOpacity
            style={[styles.actionButton, { backgroundColor: colors.error, borderRadius: borderRadius.md, paddingHorizontal: spacing.lg, paddingVertical: spacing.md }]}
            onPress={handleBulkDelete}
            disabled={selectedCount === 0}>
            <Text style={[typography.body, { color: '#fff', opacity: selectedCount === 0 ? 0.5 : 1 }]}>
              Delete ({selectedCount})
            </Text>
          </TouchableOpacity>
        </View>
      )}

      <EditTransactionModal
        visible={isEditModalVisible}
        transaction={editingTransaction}
        onClose={closeEditModal}
        onSave={handleSaveEdit}
      />

      <AppConfirmModal
        visible={!!confirmDialog}
        title={confirmDialog?.title || ''}
        message={confirmDialog?.message || ''}
        confirmText={confirmDialog?.confirmText}
        isDestructive={confirmDialog?.isDestructive}
        onConfirm={() => confirmDialog?.onConfirm()}
        onCancel={() => setConfirmDialog(null)}
      />
    </ScreenWrapper>
  );
}

const styles = StyleSheet.create({
  filterBar: {
    flexShrink: 0,
    flexGrow: 0,
    borderBottomWidth: 1,
  },
  filterButton: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
    minWidth: 70,
    alignItems: 'center',
    justifyContent: 'center',
  },
  filterButtonText: {
    fontSize: 14,
    fontWeight: '500',
  },
  listContent: {
    flexGrow: 1,
  },
  rowCard: {
    overflow: 'hidden',
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
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
