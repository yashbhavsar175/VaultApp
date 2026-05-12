import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  RefreshControl,
  ScrollView,
  Pressable,
  BackHandler,
  UIManager,
  Platform,
  Animated,
  InteractionManager,
} from 'react-native';

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { StackNavigationProp } from '@react-navigation/stack';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';
import Toast from 'react-native-toast-message';
import { getTransactions, deleteTransaction, updateTransaction, bulkDeleteTransactions } from '../../lib/core';
import { getCached, setCache, CACHE_KEYS } from '../../lib/services/cache';
import { Transaction, TransactionType } from '../../types';
import { useTheme } from '../../context/ThemeContext';
import { ScreenWrapper, AppHeader, EditTransactionModal, AppConfirmModal } from '../../components';
import { formatCurrency as formatAmount } from '../../utils/format';
import { getTransactionIcon, getTransactionColor, formatTransactionDate } from '../../utils/transactionHelpers';

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

  // 120 FPS smooth native thread animation using built-in Animated
  const selectAnim = useRef(new Animated.Value(selectMode ? 1 : 0)).current;

  useEffect(() => {
    Animated.spring(selectAnim, {
      toValue: selectMode ? 1 : 0,
      useNativeDriver: true, // Native UI thread -> 120 FPS
      friction: 8,
      tension: 80,
    }).start();
  }, [selectMode, selectAnim]);

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
      <View style={[styles.transactionRow, { paddingLeft: 0 }]}>
        {/* Checkbox slides in from left */}
        <Animated.View style={{
          position: 'absolute',
          left: 0,
          width: 36,
          height: '100%',
          justifyContent: 'center',
          opacity: selectAnim,
          transform: [{
            translateX: selectAnim.interpolate({
              inputRange: [0, 1],
              outputRange: [-20, 0],
            })
          }],
        }}>
          <MaterialCommunityIcons
            name={isSelected ? 'checkbox-marked-circle' : 'checkbox-blank-circle-outline'}
            size={24}
            color={isSelected ? colors.accent : colors.border}
          />
        </Animated.View>

        {/* Content slides to the right */}
        <Animated.View style={{
          flex: 1,
          flexDirection: 'row',
          alignItems: 'center',
          transform: [{
            translateX: selectAnim.interpolate({
              inputRange: [0, 1],
              outputRange: [0, 36],
            })
          }],
        }}>
          <View style={[styles.iconBox, { backgroundColor: color + '20', borderRadius: 10 }]}>
            <MaterialCommunityIcons
              name={getTransactionIcon(item.type)}
              size={20}
              color={color}
            />
          </View>
          <View style={styles.transactionInfo}>
            <Text style={{ color: colors.text, fontSize: 14, fontWeight: '500' }}>{item.note}</Text>
            <Text style={[typography.caption, { color: colors.subtext, marginTop: spacing.xs }]}>{formatTransactionDate(item.created_at)}</Text>
          </View>
          <Text style={{ color, fontSize: 14, fontWeight: '600' }}>
            {item.type === 'income' ? '+' :
              item.type === 'transfer' ? '↔' : '-'}{formatAmount(Number(item.amount))}
          </Text>
        </Animated.View>
      </View>
    </Pressable>
  );
});

export default function Transactions() {
  const navigation = useNavigation<TransactionsScreenNavigationProp>();
  const { colors, typography, spacing, borderRadius } = useTheme();
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [filteredTransactions, setFilteredTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);
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

  // Deep equality tracking to prevent re-renders
  const lastDataStringRef = useRef<string | null>(null);

  // 120 FPS smooth bottom bar animation
  const bottomBarAnim = useRef(new Animated.Value(0)).current;

  const loadTransactions = useCallback(async () => {
    try {
      const data = await getTransactions();
      const dataStr = JSON.stringify(data);
      
      // Prevent unnecessary state updates and re-renders that drop touches!
      if (lastDataStringRef.current === dataStr) {
        return;
      }
      
      lastDataStringRef.current = dataStr;
      
      setTransactions(data);
      applyFilter(data, filter);
      // Cache for instant load next time
      setCache(CACHE_KEYS.TRANSACTIONS, data);
    } catch (error) {
      Toast.show({
        type: 'error',
        text1: 'Error',
        text2: 'Failed to load transactions',
      });
    } finally {
      setRefreshing(false);
      setLoading(false);
    }
  }, [filter]);

  // Initial load: cache first, then network
  useEffect(() => {
    const initLoad = async () => {
      // Try cache for instant display
      const cached = await getCached<Transaction[]>(CACHE_KEYS.TRANSACTIONS);
      if (cached && cached.length > 0) {
        setTransactions(cached);
        applyFilter(cached, filter);
        setLoading(false);
        // Background refresh
        loadTransactions();
      } else {
        loadTransactions();
      }
    };
    initLoad();
  }, []);

  useFocusEffect(
    useCallback(() => {
      let isActive = true;
      const task = InteractionManager.runAfterInteractions(() => {
        if (isActive) {
          loadTransactions();
        }
      });
      return () => {
        isActive = false;
        task.cancel();
      };
    }, [loadTransactions])
  );

  useEffect(() => {
    Animated.spring(bottomBarAnim, {
      toValue: selectMode ? 1 : 0,
      useNativeDriver: true, // Native UI thread -> 120 FPS
      friction: 8,
      tension: 65,
    }).start();
  }, [selectMode, bottomBarAnim]);


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
        // Dismiss dialog immediately for a faster feel
        setConfirmDialog(null);

        // Optimistic UI Update: Remove from list instantly
        setTransactions(prev => prev.filter(t => t.id !== id));
        setFilteredTransactions(prev => prev.filter(t => t.id !== id));

        try {
          await deleteTransaction(id);
          // No reload needed — optimistic update already done
        } catch (error) {
          // Revert optimistic update on failure
          loadTransactions();
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
    setSelectMode(true);
    setSelectedMap({ [id]: true });
  }, []);

  const exitSelectMode = useCallback(() => {
    setSelectMode(false);
    setSelectedMap({});
  }, []);

  // Handle hardware back press for selection mode
  useFocusEffect(
    useCallback(() => {
      const onBackPress = () => {
        if (selectMode) {
          exitSelectMode();
          return true; // prevent default behavior
        }
        return false; // let default behavior happen
      };

      const subscription = BackHandler.addEventListener('hardwareBackPress', onBackPress);

      return () => {
        subscription.remove();
      };
    }, [selectMode, exitSelectMode])
  );

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
        // Dismiss dialog immediately for a faster feel
        setConfirmDialog(null);

        // Optimistic UI update: Remove from list instantly
        const idSet = new Set(ids);
        setTransactions(prev => prev.filter(t => !idSet.has(t.id)));
        setFilteredTransactions(prev => prev.filter(t => !idSet.has(t.id)));
        exitSelectMode();

        Toast.show({
          type: 'success',
          text1: 'Deleted',
          text2: `${count} transaction${count > 1 ? 's' : ''} deleted successfully`,
        });

        // Background: single batch API call (not 120 individual calls!)
        try {
          await bulkDeleteTransactions(ids);
        } catch (error) {
          // Revert on failure — reload from server
          loadTransactions();
          Toast.show({
            type: 'error',
            text1: 'Sync Error',
            text2: 'Some deletions may have failed. Reloading...',
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

  const renderEmptyState = useCallback(() => {
    if (loading) {
      return (
        <View style={{ paddingTop: 8 }}>
          {[1, 2, 3, 4, 5, 6, 7, 8].map((key) => (
            <View key={key} style={[styles.rowCard, {
              backgroundColor: colors.card,
              borderRadius: 16,
              padding: 10,
              marginBottom: 6,
              flexDirection: 'row',
              alignItems: 'center',
              opacity: 0.8 - (key * 0.08) // Nice fade out effect
            }]}>
              <View style={[styles.iconBox, { backgroundColor: colors.border, borderRadius: 10 }]} />
              <View style={styles.transactionInfo}>
                <View style={{ height: 14, backgroundColor: colors.border, borderRadius: 4, width: '60%', marginBottom: 8 }} />
                <View style={{ height: 10, backgroundColor: colors.border, borderRadius: 4, width: '40%' }} />
              </View>
              <View style={{ height: 14, backgroundColor: colors.border, borderRadius: 4, width: '20%' }} />
            </View>
          ))}
        </View>
      );
    }
    return (
      <View style={styles.emptyState}>
        <MaterialCommunityIcons name="inbox-outline" size={64} color={colors.border} />
        <Text style={[typography.h3, { color: colors.subtext, marginTop: spacing.md }]}>No transactions yet</Text>
        <Text style={[typography.caption, { color: colors.subtext, marginTop: spacing.xs }]}>Add your first transaction to get started</Text>
      </View>
    );
  }, [loading, colors, typography, spacing]);

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
        <Animated.View style={[
          styles.bottomActionBar,
          { backgroundColor: colors.card, borderTopColor: colors.border },
          {
            transform: [{
              translateY: bottomBarAnim.interpolate({
                inputRange: [0, 1],
                outputRange: [100, 0],
              })
            }],
            opacity: bottomBarAnim,
          }
        ]}>
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
        </Animated.View>
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
    paddingTop: 12,
    paddingBottom: 28,
    borderTopWidth: 1,
  },
  actionButton: {
    flex: 1,
    marginHorizontal: 8,
    alignItems: 'center',
  },
});
