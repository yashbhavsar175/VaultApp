import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  Modal,
  ScrollView,
  Alert,
  Linking,
  Animated,
} from 'react-native';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';
import HapticFeedback from 'react-native-haptic-feedback';
import Toast from 'react-native-toast-message';
import { useFocusEffect } from '@react-navigation/native';
import { useTheme } from '../../context/ThemeContext';
import { ScreenWrapper, AppHeader, Card, AppButton, AppInput, AppConfirmModal } from '../../components';
import {
  getPeopleLedger,
  getLedgerSummary,
  addLedgerEntry,
  addPayment,
  markAsSettled,
  deleteLedgerEntry,
  isOverdue,
  isDueToday,
  getDaysUntilDue,
  calculateExpectedByToday,
  AddLedgerEntryData,
  getPayments,
} from '../../lib/database/userdata';
import { PeopleLedger, PeopleLedgerPayment } from '../../types';
import { scheduleLedgerNotifications } from '../../lib/services/scheduledNotifications';
import { CACHE_KEYS, getCached, scopedCacheKey, setCache, updateCache } from '../../lib/services/cache';
import { financeDataChangedAffects, subscribeFinanceDataChanged } from '../../lib/services/dataEvents';

type FilterType = 'active' | 'settled';

export default function PeopleScreen() {
  const { colors, typography, spacing, borderRadius } = useTheme();
  const [ledgerEntries, setLedgerEntries] = useState<PeopleLedger[]>([]);
  const [filteredEntries, setFilteredEntries] = useState<PeopleLedger[]>([]);
  const [filter, setFilter] = useState<FilterType>('active');
  const [loading, setLoading] = useState(true);
  const [summary, setSummary] = useState({ totalLent: 0, totalBorrowed: 0, lentCount: 0, borrowedCount: 0 });

  const [showAddModal, setShowAddModal] = useState(false);
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [showPaymentHistoryModal, setShowPaymentHistoryModal] = useState(false);
  const [selectedEntry, setSelectedEntry] = useState<PeopleLedger | null>(null);
  const [showConfetti, setShowConfetti] = useState(false);
  const confettiAnim = useRef(new Animated.Value(0)).current;
  const [confirmDialog, setConfirmDialog] = useState<{
    visible: boolean;
    title: string;
    message: string;
    confirmText: string;
    isDestructive: boolean;
    onConfirm: () => void;
  } | null>(null);
  const lastDataStringRef = useRef<string | null>(null);

  const applyLedgerEntries = useCallback(async (entries: PeopleLedger[]) => {
    const entriesStr = JSON.stringify(entries);
    if (lastDataStringRef.current === entriesStr) return;

    lastDataStringRef.current = entriesStr;
    setLedgerEntries(entries);
    setSummary(await getLedgerSummary(entries.filter(e => !e.is_settled)));
  }, []);

  const loadDataSilently = useCallback(async (rescheduleNotifications = false) => {
    const entries = await getPeopleLedger(true); // Fetch all, including settled
    await applyLedgerEntries(entries);
    await setCache(CACHE_KEYS.PEOPLE_LEDGER, entries);

    // Only reschedule notifications when needed (initial load or after add/settle)
    // Not on every pull-to-refresh — avoids cancelling/re-adding 50+ notifications
    if (rescheduleNotifications) {
      const activeEntries = entries.filter(e => !e.is_settled);
      await scheduleLedgerNotifications(activeEntries);
    }
  }, [applyLedgerEntries]);

  const loadData = useCallback(async (rescheduleNotifications = false, forceFresh = false) => {
    try {
      if (!forceFresh) {
        const cached = await getCached<PeopleLedger[]>(CACHE_KEYS.PEOPLE_LEDGER);
        if (cached) {
          await applyLedgerEntries(cached.data);
          setLoading(false);

          if (cached.isStale) {
            loadDataSilently(rescheduleNotifications).catch(error =>
              console.error('Error refreshing ledger:', error)
            );
          } else if (rescheduleNotifications) {
            scheduleLedgerNotifications(cached.data.filter(e => !e.is_settled)).catch(error =>
              console.error('Error scheduling ledger reminders:', error)
            );
          }
          return;
        }
      }

      if (!lastDataStringRef.current) setLoading(true);
      await loadDataSilently(rescheduleNotifications);
    } catch (error) {
      console.error('Error loading ledger:', error);
      Alert.alert('Error', 'Failed to load people ledger');
    } finally {
      setLoading(false);
    }
  }, [applyLedgerEntries, loadDataSilently]);

  const applyFilter = useCallback(() => {
    if (filter === 'settled') {
      setFilteredEntries(ledgerEntries.filter(e => e.is_settled));
    } else {
      setFilteredEntries(ledgerEntries.filter(e => !e.is_settled));
    }
  }, [filter, ledgerEntries]);

  useEffect(() => {
    loadData(true); // Initial load: reschedule notifications
    // Don't request notification permission here - user should enable it from Settings
  }, [loadData]);

  useFocusEffect(
    useCallback(() => {
      return subscribeFinanceDataChanged(payload => {
        if (financeDataChangedAffects(payload, ['ledger'])) {
          loadData(false, true);
        }
      });
    }, [loadData])
  );

  useEffect(() => {
    applyFilter();
  }, [applyFilter]);

  const handleAddEntry = () => {
    setSelectedEntry(null);
    setShowAddModal(true);
  };

  const handleAddPayment = useCallback((entry: PeopleLedger) => {
    setSelectedEntry(entry);
    setShowPaymentModal(true);
  }, []);

  const handleSettle = useCallback(async (entry: PeopleLedger) => {
    setConfirmDialog({
      visible: true,
      title: 'Settle Entry',
      message: `Mark ${entry.person_name} as settled?`,
      confirmText: 'Settle',
      isDestructive: false,
      onConfirm: async () => {
        setConfirmDialog(null);
        setLedgerEntries(prev => {
          const next = prev.map(e => e.id === entry.id ? { ...e, is_settled: true, settled_at: new Date().toISOString() } : e);
          setCache(CACHE_KEYS.PEOPLE_LEDGER, next);
          getLedgerSummary(next.filter(e => !e.is_settled)).then(setSummary);
          return next;
        });
        setFilteredEntries(prev => prev.filter(e => e.id !== entry.id));
        try {
          await markAsSettled(entry.id);
          HapticFeedback.trigger('notificationSuccess', { enableVibrateFallback: true, ignoreAndroidSystemSettings: false });
          // Confetti burst
          setShowConfetti(true);
          confettiAnim.setValue(0);
          Animated.timing(confettiAnim, { toValue: 1, duration: 1800, useNativeDriver: true }).start(() => {
            setShowConfetti(false);
          });
          Toast.show({ type: 'success', text1: '🎉 Settled!', text2: `${entry.person_name} has been settled.` });
        } catch {
          await loadData(false, true);
          Alert.alert('Error', 'Failed to settle entry');
        }
      }
    });
  }, [loadData, confettiAnim]);

  const handleDelete = useCallback(async (entry: PeopleLedger) => {
    HapticFeedback.trigger('notificationWarning', { enableVibrateFallback: true, ignoreAndroidSystemSettings: false });
    setConfirmDialog({
      visible: true,
      title: 'Delete Entry',
      message: `Delete ${entry.person_name}? This action cannot be undone.`,
      confirmText: 'Delete',
      isDestructive: true,
      onConfirm: async () => {
        setConfirmDialog(null);
        setLedgerEntries(prev => prev.filter(e => e.id !== entry.id));
        setFilteredEntries(prev => prev.filter(e => e.id !== entry.id));
        try {
          await deleteLedgerEntry(entry.id);
          await loadData(false, true);
        } catch {
          await loadData(false, true);
          Alert.alert('Error', 'Failed to delete entry');
        }
      }
    });
  }, [loadData]);

  const getPersonInitial = useCallback((name: string) => {
    return name.charAt(0).toUpperCase();
  }, []);

  // WhatsApp Remind deep link
  const handleWhatsAppRemind = useCallback((entry: PeopleLedger) => {
    HapticFeedback.trigger('impactLight', { enableVibrateFallback: true, ignoreAndroidSystemSettings: false });
    const remaining = Number(entry.remaining_amount).toFixed(0);
    const msg = encodeURIComponent(
      `Hi ${entry.person_name} 👋, just a friendly reminder — you have an outstanding amount of ₹${remaining} pending. Please settle at your earliest convenience. Thank you! 🙏`
    );
    Linking.openURL(`whatsapp://send?text=${msg}`).catch(() =>
      Alert.alert('WhatsApp Not Found', 'WhatsApp is not installed on this device.')
    );
  }, []);

  const getAvatarColor = useCallback((name: string) => {
    const colorsList = ['#FF6B6B', '#4ECDC4', '#45B7D1', '#FFA07A', '#98D8C8', '#F7DC6F'];
    const index = name.charCodeAt(0) % colorsList.length;
    return colorsList[index];
  }, []);

  const openPaymentHistory = useCallback((entry: PeopleLedger) => {
    setSelectedEntry(entry);
    setShowPaymentHistoryModal(true);
  }, []);

  const renderLedgerCard = useCallback(({ item }: { item: PeopleLedger }) => {
    if (item.is_settled) {
      return (
        <SettledRow
          item={item}
          colors={colors}
          typography={typography}
          spacing={spacing}
          borderRadius={borderRadius}
          onDelete={handleDelete}
        />
      );
    }
    return (
      <LedgerCard
        item={item}
        colors={colors}
        typography={typography}
        spacing={spacing}
        onAddPayment={handleAddPayment}
        onSettle={handleSettle}
        onDelete={handleDelete}
        onViewHistory={openPaymentHistory}
        onRemind={handleWhatsAppRemind}
        getAvatarColor={getAvatarColor}
        getPersonInitial={getPersonInitial}
      />
    );
  }, [colors, typography, spacing, borderRadius, handleAddPayment, handleSettle, handleDelete, openPaymentHistory, handleWhatsAppRemind, getAvatarColor, getPersonInitial]);

  return (
    <ScreenWrapper>
      <AppHeader
        title="People"
        rightAction={{
          icon: 'plus',
          onPress: handleAddEntry,
        }}
      />

      <View style={{ paddingHorizontal: spacing.md, flex: 1 }}>
        {/* Summary Cards */}
        <View style={[styles.summaryRow, { marginBottom: spacing.md }]}>
          <Card style={[styles.summaryCard, {
            borderLeftWidth: 4,
            borderLeftColor: colors.success,
            minHeight: 120,
            padding: 24,
            position: 'relative',
            overflow: 'hidden',
          }]}>
            <MaterialCommunityIcons
              name="account-group"
              size={48}
              color={colors.success}
              style={{
                position: 'absolute',
                right: 20,
                top: '50%',
                marginTop: -24,
                opacity: 0.2
              }}
            />
            <Text style={[typography.caption, { color: colors.subtext, fontSize: 16 }]}>
              Active Lent
            </Text>
            <Text style={[typography.h2, { color: colors.success, fontSize: 36, fontWeight: '800', marginTop: 4 }]}>
              ₹{summary.totalLent.toFixed(0)}
            </Text>
            <Text style={[typography.caption, { color: colors.subtext, fontSize: 14, marginTop: 6 }]}>
              {summary.lentCount} people
            </Text>
          </Card>

          {summary.totalBorrowed > 0 && (
            <Card style={[styles.summaryCard, {
              borderLeftWidth: 4,
              borderLeftColor: colors.danger,
              minHeight: 120,
              padding: 24,
              position: 'relative',
              overflow: 'hidden',
            }]}>
              <MaterialCommunityIcons
                name="account-arrow-left"
                size={48}
                color={colors.danger}
                style={{
                  position: 'absolute',
                  right: 20,
                  top: '50%',
                  marginTop: -24,
                  opacity: 0.2
                }}
              />
              <Text style={[typography.caption, { color: colors.subtext, fontSize: 16 }]}>
                You Borrowed
              </Text>
              <Text style={[typography.h2, { color: colors.danger, fontSize: 36, fontWeight: '800', marginTop: 4 }]}>
                ₹{summary.totalBorrowed.toFixed(0)}
              </Text>
              <Text style={[typography.caption, { color: colors.subtext, fontSize: 14, marginTop: 6 }]}>
                {summary.borrowedCount} people
              </Text>
            </Card>
          )}
        </View>

        {/* Filter Tabs */}
        <View style={[styles.filterTabs, { marginBottom: spacing.md }]}>
          {(['active', 'settled'] as FilterType[]).map((f) => {
            const isActive = filter === f;
            return (
              <TouchableOpacity
                key={f}
                onPress={() => {
                  HapticFeedback.trigger('impactLight', { enableVibrateFallback: true, ignoreAndroidSystemSettings: false });
                  setFilter(f);
                }}
                style={[
                  styles.filterTab,
                  {
                    backgroundColor: isActive ? colors.accent : colors.card,
                    borderRadius: borderRadius.md,
                    paddingVertical: spacing.sm,
                    paddingHorizontal: spacing.xs,
                    borderWidth: isActive ? 0 : 1,
                    borderColor: colors.border,
                  },
                ]}>
                <Text
                  style={[
                    typography.caption,
                    {
                      color: isActive ? '#fff' : colors.text,
                      fontSize: 11,
                      fontWeight: isActive ? '600' : '400',
                    }
                  ]}
                  numberOfLines={1}
                  adjustsFontSizeToFit>
                  {f.charAt(0).toUpperCase() + f.slice(1)}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
        {/* People List */}
        {loading ? (
          <View>
            {[1, 2, 3].map((key) => (
              <Card key={key} style={{ marginBottom: spacing.md, padding: spacing.md, opacity: 0.8 - (key * 0.15) }}>
                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                  <View style={{ width: 48, height: 48, borderRadius: 24, backgroundColor: colors.border, marginRight: spacing.md }} />
                  <View style={{ flex: 1 }}>
                    <View style={{ height: 16, backgroundColor: colors.border, borderRadius: 4, width: '50%', marginBottom: 8 }} />
                    <View style={{ height: 12, backgroundColor: colors.border, borderRadius: 4, width: '30%', marginBottom: 12 }} />
                    <View style={{ flexDirection: 'row', gap: 8 }}>
                      <View style={{ height: 20, backgroundColor: colors.border, borderRadius: 10, width: 50 }} />
                      <View style={{ height: 20, backgroundColor: colors.border, borderRadius: 10, width: 70 }} />
                    </View>
                  </View>
                </View>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: spacing.md }}>
                  {[1, 2, 3].map(i => (
                    <View key={i} style={{ alignItems: 'center' }}>
                      <View style={{ height: 10, backgroundColor: colors.border, borderRadius: 4, width: 40, marginBottom: 4 }} />
                      <View style={{ height: 16, backgroundColor: colors.border, borderRadius: 4, width: 50 }} />
                    </View>
                  ))}
                </View>
              </Card>
            ))}
          </View>
        ) : filteredEntries.length === 0 ? (
          <View style={{ alignItems: 'center', marginTop: spacing.xl }}>
            <MaterialCommunityIcons name="account-group-outline" size={64} color={colors.subtext} />
            <Text style={[typography.body, { color: colors.subtext, marginTop: spacing.md }]}>
              {filter === 'settled' ? 'No settled entries' : 'No active entries'}
            </Text>
          </View>
        ) : (
          <FlatList
            data={filteredEntries}
            renderItem={renderLedgerCard}
            keyExtractor={(item) => item.id}
            showsVerticalScrollIndicator={false}
          />
        )}
      </View>

      <AddEntryModal
        visible={showAddModal}
        onClose={() => setShowAddModal(false)}
        onSuccess={() => loadData(false, true)}
      />

      <PaymentModal
        visible={showPaymentModal}
        entry={selectedEntry}
        onClose={() => setShowPaymentModal(false)}
        onSuccess={() => loadData(false, true)}
      />

      <PaymentHistoryModal
        visible={showPaymentHistoryModal}
        entry={selectedEntry}
        onClose={() => setShowPaymentHistoryModal(false)}
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

      {/* Confetti celebration overlay */}
      {showConfetti && (
        <Animated.View
          pointerEvents="none"
          style={{
            position: 'absolute',
            top: 0, left: 0, right: 0, bottom: 0,
            justifyContent: 'center',
            alignItems: 'center',
            opacity: confettiAnim.interpolate({ inputRange: [0, 0.5, 1], outputRange: [0, 1, 0] }),
            transform: [{ scale: confettiAnim.interpolate({ inputRange: [0, 0.3, 1], outputRange: [0.5, 1.2, 1] }) }],
          }}
        >
          <Text style={{ fontSize: 80 }}>🎉</Text>
          <Text style={{ fontSize: 22, fontWeight: '800', color: '#EAB308', marginTop: 12 }}>All Settled!</Text>
        </Animated.View>
      )}
    </ScreenWrapper>
  );
}

// Compact Table Row for Settled Entries
const SettledRow = React.memo(({
  item,
  colors,
  typography,
  spacing,
  borderRadius,
  onDelete
}: any) => {
  return (
    <View style={{
      flexDirection: 'row',
      alignItems: 'center',
      paddingVertical: spacing.sm,
      paddingHorizontal: spacing.md,
      backgroundColor: colors.card,
      borderRadius: borderRadius.md,
      marginBottom: spacing.xs,
      borderWidth: 1,
      borderColor: colors.border
    }}>
      <View style={{ flex: 1 }}>
        <Text style={[typography.bodyBold, { color: colors.text, fontSize: 14 }]} numberOfLines={1}>
          {item.person_name}
        </Text>
        <Text style={[typography.caption, { color: colors.subtext, fontSize: 11 }]}>
          Given: {new Date(item.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
        </Text>
      </View>
      <View style={{ flex: 1, alignItems: 'flex-end', paddingRight: spacing.md }}>
        <Text style={[typography.bodyBold, { color: colors.success, fontSize: 14 }]}>
          ₹{Number(item.total_amount).toFixed(0)}
        </Text>
        <Text style={[typography.caption, { color: colors.subtext, fontSize: 11 }]}>
          {item.settled_at
            ? `Cleared on: ${new Date(item.settled_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}`
            : 'Cleared'}
        </Text>
      </View>
      <TouchableOpacity onPress={() => onDelete(item)} style={{ padding: spacing.xs }}>
        <MaterialCommunityIcons name="delete" size={20} color={colors.danger} />
      </TouchableOpacity>
    </View>
  );
});

// Memoized Card Component
const LedgerCard = React.memo(({
  item,
  colors,
  typography,
  spacing,
  onAddPayment,
  onSettle,
  onDelete,
  onViewHistory,
  onRemind,
  getAvatarColor,
  getPersonInitial
}: any) => {
  const progress = Number(item.paid_amount) / Number(item.total_amount);
  const overdue = isOverdue(item);
  const dueToday = isDueToday(item);
  const daysUntilDue = getDaysUntilDue(item);
  const expectedByToday = calculateExpectedByToday(item);

  // Animated progress bar: fills from 0 → progress on mount / when paid_amount changes
  const progressAnim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(progressAnim, {
      toValue: isNaN(progress) ? 0 : Math.min(progress, 1),
      duration: 800,
      useNativeDriver: false, // width cannot use native driver
    }).start();
  }, [item.paid_amount, item.total_amount, progress, progressAnim]);

  return (
    <Card style={{ marginBottom: spacing.md }}>
      <View style={styles.cardHeader}>
        <View style={styles.personInfo}>
          <View style={[styles.avatar, { backgroundColor: getAvatarColor(item.person_name) }]}>
            <Text style={[typography.h3, { color: '#fff' }]}>{getPersonInitial(item.person_name)}</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[typography.bodyBold, { color: colors.text }]}>{item.person_name}</Text>
            <Text style={[typography.caption, { color: colors.subtext, fontSize: 10, marginTop: 2, marginBottom: 4 }]}>
              Given on: {new Date(item.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
            </Text>
            <View style={styles.badgeContainer}>
              <View style={[styles.badge, { backgroundColor: colors.success + '20' }]}>
                <Text style={[typography.caption, { color: colors.success }]}>Lent</Text>
              </View>
              {item.is_settled ? (
                <View style={[styles.badge, { backgroundColor: colors.subtext + '30' }]}>
                  <Text style={[typography.caption, { color: colors.subtext, fontWeight: 'bold' }]}>SETTLED</Text>
                </View>
              ) : (
                <>
                  {overdue && (
                    <View style={[styles.badge, { backgroundColor: colors.danger + '20' }]}>
                      <Text style={[typography.caption, { color: colors.danger }]}>Overdue</Text>
                    </View>
                  )}
                  {dueToday && (
                    <View style={[styles.badge, { backgroundColor: colors.warning + '20' }]}>
                      <Text style={[typography.caption, { color: colors.warning }]}>Due Today</Text>
                    </View>
                  )}
                </>
              )}
            </View>
          </View>
        </View>
      </View>

      <View style={[styles.amountRow, { marginTop: spacing.md }]}>
        <View style={styles.amountItem}>
          <Text style={[typography.caption, { color: colors.subtext, fontSize: 10 }]} numberOfLines={1}>Total</Text>
          <Text style={[typography.bodyBold, { color: colors.text, fontSize: 16 }]} numberOfLines={1} adjustsFontSizeToFit>
            ₹{Number(item.total_amount).toFixed(0)}
          </Text>
        </View>
        <View style={styles.amountItem}>
          <Text style={[typography.caption, { color: colors.subtext, fontSize: 10 }]} numberOfLines={1}>Paid</Text>
          <Text style={[typography.bodyBold, { color: colors.success, fontSize: 16 }]} numberOfLines={1} adjustsFontSizeToFit>
            ₹{Number(item.paid_amount).toFixed(0)}
          </Text>
        </View>
        <View style={styles.amountItem}>
          <Text style={[typography.caption, { color: colors.subtext, fontSize: 10 }]} numberOfLines={1}>{item.is_settled ? 'Cleared' : 'Remaining'}</Text>
          <Text style={[typography.bodyBold, { color: item.is_settled ? colors.subtext : colors.danger, fontSize: 16 }]} numberOfLines={1} adjustsFontSizeToFit>
            ₹{item.is_settled ? '0' : Number(item.remaining_amount).toFixed(0)}
          </Text>
        </View>
      </View>

      {/* Animated progress bar */}
      <View style={[styles.progressBar, { backgroundColor: colors.border, marginTop: spacing.md }]}>
        <Animated.View
          style={[
            styles.progressFill,
            {
              backgroundColor: colors.success,
              width: progressAnim.interpolate({
                inputRange: [0, 1],
                outputRange: ['0%', '100%'],
              }),
            },
          ]}
        />
      </View>

      {item.repayment_type === 'one_time' && item.due_date && (
        <Text style={[typography.caption, { color: colors.subtext, marginTop: spacing.sm }]}>
          Due: {new Date(item.due_date).toLocaleDateString()}
          {daysUntilDue !== null && ` (${daysUntilDue > 0 ? `${daysUntilDue} days left` : `${Math.abs(daysUntilDue)} days overdue`})`}
        </Text>
      )}

      {item.repayment_type === 'installment' && (
        <Text style={[typography.caption, { color: colors.subtext, marginTop: spacing.sm }]}>
          ₹{item.installment_amount}/day • Expected by today: ₹{expectedByToday.toFixed(0)}
        </Text>
      )}

      {item.notes && (
        <Text style={[typography.caption, { color: colors.subtext, marginTop: spacing.sm, fontStyle: 'italic' }]}>
          {item.notes}
        </Text>
      )}

      {Number(item.paid_amount) > 0 && (
        <TouchableOpacity
          onPress={() => onViewHistory(item)}
          style={{ marginTop: spacing.sm }}>
          <Text style={[typography.caption, { color: colors.accent }]}>
            💰 ₹{Number(item.paid_amount).toFixed(0)} paid • Tap to view history
          </Text>
        </TouchableOpacity>
      )}

      <View style={[styles.actionButtons, { marginTop: spacing.md }]}>
        {!item.is_settled && (
          <>
            <AppButton
              title="Add Payment"
              onPress={() => onAddPayment(item)}
              variant="primary"
              style={{ flex: 1, marginRight: spacing.xs, paddingVertical: spacing.sm }}
            />
            <AppButton
              title="Settle"
              onPress={() => onSettle(item)}
              variant="secondary"
              style={{ flex: 1, marginRight: spacing.xs, paddingVertical: spacing.sm }}
            />
            {/* WhatsApp Remind button */}
            <TouchableOpacity
              onPress={() => onRemind(item)}
              style={{
                padding: spacing.sm,
                justifyContent: 'center',
                alignItems: 'center',
                backgroundColor: '#25D36620',
                borderRadius: 8,
                marginRight: spacing.xs,
              }}>
              <MaterialCommunityIcons name="whatsapp" size={22} color="#25D366" />
            </TouchableOpacity>
          </>
        )}
        <TouchableOpacity
          onPress={() => onDelete(item)}
          style={{
            padding: spacing.sm,
            justifyContent: 'center',
            alignItems: 'center',
          }}>
          <MaterialCommunityIcons name="delete" size={20} color={colors.danger} />
        </TouchableOpacity>
      </View>
    </Card>
  );
});

// Add Entry Modal Component
function AddEntryModal({ visible, onClose, onSuccess }: { visible: boolean; onClose: () => void; onSuccess: () => void }) {
  const { colors, typography, spacing, borderRadius } = useTheme();
  const [formData, setFormData] = useState<Partial<AddLedgerEntryData>>({
    type: 'lent',
    repayment_type: 'one_time',
    installment_days: ['mon', 'tue', 'wed', 'thu', 'fri', 'sat'],
  });
  const [loading, setLoading] = useState(false);

  const handleSubmit = async () => {
    if (!formData.person_name?.trim()) {
      Alert.alert('Error', 'Person name is required');
      return;
    }
    if (!formData.total_amount || formData.total_amount <= 0) {
      Alert.alert('Error', 'Amount must be greater than 0');
      return;
    }

    try {
      setLoading(true);
      await addLedgerEntry(formData as AddLedgerEntryData);
      Alert.alert('Success', 'Entry added successfully');
      onClose();
      onSuccess();
      setFormData({ type: 'lent', repayment_type: 'one_time', installment_days: ['mon', 'tue', 'wed', 'thu', 'fri', 'sat'] });
    } catch {
      Alert.alert('Error', 'Failed to add entry');
    } finally {
      setLoading(false);
    }
  };

  const handleClose = () => {
    // Reset form on close so stale data doesn't show on next open
    setFormData({ type: 'lent', repayment_type: 'one_time', installment_days: ['mon', 'tue', 'wed', 'thu', 'fri', 'sat'] });
    onClose();
  };

  return (
    <Modal visible={visible} animationType="slide" transparent>
      <View style={[styles.modalOverlay, { backgroundColor: 'rgba(0,0,0,0.5)' }]}>
        <View style={[styles.modalContent, { backgroundColor: colors.background, borderRadius: borderRadius.lg }]}>
          <View style={[styles.modalHeader, { borderBottomColor: colors.border }]}>
            <Text style={[typography.h3, { color: colors.text }]}>Add Entry</Text>
            <TouchableOpacity onPress={handleClose}>
              <MaterialCommunityIcons name="close" size={24} color={colors.text} />
            </TouchableOpacity>
          </View>

          <ScrollView style={{ padding: spacing.md }}>
            <AppInput
              label="Person Name"
              value={formData.person_name}
              onChangeText={(text) => setFormData({ ...formData, person_name: text })}
              placeholder="Enter name"
            />

            <AppInput
              label="Total Amount"
              value={formData.total_amount?.toString()}
              onChangeText={(text) => setFormData({ ...formData, total_amount: parseFloat(text) || 0 })}
              placeholder="Enter amount"
              keyboardType="numeric"
            />

            <Text style={[typography.caption, { color: colors.text, marginBottom: spacing.sm }]}>Repayment Type</Text>
            <View style={[styles.segmentedControl, { marginBottom: spacing.md }]}>
              <TouchableOpacity
                onPress={() => setFormData({ ...formData, repayment_type: 'one_time' })}
                style={[
                  styles.segment,
                  { backgroundColor: formData.repayment_type === 'one_time' ? colors.accent : colors.card, borderRadius: borderRadius.md },
                ]}>
                <Text style={[typography.body, { color: formData.repayment_type === 'one_time' ? '#fff' : colors.text }]}>One Time</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => setFormData({ ...formData, repayment_type: 'installment' })}
                style={[
                  styles.segment,
                  { backgroundColor: formData.repayment_type === 'installment' ? colors.accent : colors.card, borderRadius: borderRadius.md },
                ]}>
                <Text style={[typography.body, { color: formData.repayment_type === 'installment' ? '#fff' : colors.text }]}>Installment</Text>
              </TouchableOpacity>
            </View>

            {formData.repayment_type === 'one_time' ? (
              <AppInput
                label="Due Date"
                value={formData.due_date}
                onChangeText={(text) => setFormData({ ...formData, due_date: text })}
                placeholder="YYYY-MM-DD"
              />
            ) : (
              <>
                <AppInput
                  label="Installment Amount (per day)"
                  value={formData.installment_amount?.toString()}
                  onChangeText={(text) => setFormData({ ...formData, installment_amount: parseFloat(text) || 0 })}
                  placeholder="Enter daily amount"
                  keyboardType="numeric"
                />
                <AppInput
                  label="Start Date"
                  value={formData.start_date}
                  onChangeText={(text) => setFormData({ ...formData, start_date: text })}
                  placeholder="YYYY-MM-DD"
                />
              </>
            )}

            <AppInput
              label="Notes (optional)"
              value={formData.notes}
              onChangeText={(text) => setFormData({ ...formData, notes: text })}
              placeholder="Add notes"
              multiline
            />

            <AppButton
              title="Add Entry"
              onPress={handleSubmit}
              loading={loading}
              fullWidth
              style={{ marginTop: spacing.md }}
            />
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

// Payment Modal Component
function PaymentModal({ visible, entry, onClose, onSuccess }: { visible: boolean; entry: PeopleLedger | null; onClose: () => void; onSuccess: () => void }) {
  const { colors, typography, spacing, borderRadius } = useTheme();
  const [amount, setAmount] = useState('');
  const [notes, setNotes] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (entry && entry.repayment_type === 'installment' && entry.installment_amount) {
      setAmount(entry.installment_amount.toString());
    }
  }, [entry]);

  const handleSubmit = async () => {
    if (!entry || !amount) {
      Alert.alert('Error', 'Please enter amount');
      return;
    }

    const payAmount = parseFloat(amount);
    if (isNaN(payAmount) || payAmount <= 0) {
      Alert.alert('Error', 'Amount must be greater than 0');
      return;
    }
    if (payAmount > Number(entry.remaining_amount)) {
      Alert.alert('Error', `Amount cannot exceed remaining ₹${Number(entry.remaining_amount).toFixed(0)}`);
      return;
    }

    try {
      setLoading(true);
      const payment = await addPayment(entry.id, payAmount, notes);
      await updateCache<PeopleLedgerPayment[]>(
        scopedCacheKey(CACHE_KEYS.LEDGER_PAYMENTS, entry.id),
        current => [payment, ...(current || [])]
      );
      Alert.alert('Success', 'Payment added successfully');
      onClose();
      onSuccess();
      setAmount('');
      setNotes('');
    } catch {
      Alert.alert('Error', 'Failed to add payment');
    } finally {
      setLoading(false);
    }
  };

  if (!entry) return null;

  return (
    <Modal visible={visible} animationType="slide" transparent>
      <View style={[styles.modalOverlay, { backgroundColor: 'rgba(0,0,0,0.5)' }]}>
        <View style={[styles.modalContent, { backgroundColor: colors.background, borderRadius: borderRadius.lg }]}>
          <View style={[styles.modalHeader, { borderBottomColor: colors.border }]}>
            <Text style={[typography.h3, { color: colors.text }]}>Add Payment</Text>
            <TouchableOpacity onPress={onClose}>
              <MaterialCommunityIcons name="close" size={24} color={colors.text} />
            </TouchableOpacity>
          </View>

          <View style={{ padding: spacing.md }}>
            <Text style={[typography.body, { color: colors.text, marginBottom: spacing.md }]}>
              {entry.person_name} - Remaining: ₹{Number(entry.remaining_amount).toFixed(0)}
            </Text>

            <AppInput
              label="Amount"
              value={amount}
              onChangeText={setAmount}
              placeholder="Enter amount"
              keyboardType="numeric"
            />

            <AppInput
              label="Notes (optional)"
              value={notes}
              onChangeText={setNotes}
              placeholder="Add notes"
              multiline
            />

            <AppButton
              title="Add Payment"
              onPress={handleSubmit}
              loading={loading}
              fullWidth
              style={{ marginTop: spacing.md }}
            />
          </View>
        </View>
      </View>
    </Modal>
  );
}

// Payment History Modal Component
function PaymentHistoryModal({ visible, entry, onClose }: { visible: boolean; entry: PeopleLedger | null; onClose: () => void }) {
  const { colors, typography, spacing, borderRadius } = useTheme();
  const [payments, setPayments] = useState<PeopleLedgerPayment[]>([]);
  const [loading, setLoading] = useState(false);

  const loadPayments = useCallback(async () => {
    if (!entry) return;

    try {
      const cacheKey = scopedCacheKey(CACHE_KEYS.LEDGER_PAYMENTS, entry.id);
      const cached = await getCached<PeopleLedgerPayment[]>(cacheKey);

      if (cached) {
        setPayments(cached.data);
        setLoading(false);
        if (!cached.isStale) return;
      } else {
        setLoading(true);
      }

      const data = await getPayments(entry.id);
      setPayments(data);
      await setCache(cacheKey, data);
    } catch (error) {
      console.error('Error loading payments:', error);
    } finally {
      setLoading(false);
    }
  }, [entry]);

  useEffect(() => {
    if (visible && entry) {
      loadPayments();
    }
  }, [visible, entry, loadPayments]);

  if (!entry) return null;

  return (
    <Modal visible={visible} animationType="slide" transparent>
      <View style={[styles.modalOverlay, { backgroundColor: 'rgba(0,0,0,0.5)' }]}>
        <View style={[styles.modalContent, { backgroundColor: colors.background, borderRadius: borderRadius.lg }]}>
          <View style={[styles.modalHeader, { borderBottomColor: colors.border }]}>
            <Text style={[typography.h3, { color: colors.text }]}>Payment History</Text>
            <TouchableOpacity onPress={onClose}>
              <MaterialCommunityIcons name="close" size={24} color={colors.text} />
            </TouchableOpacity>
          </View>

          <View style={{ padding: spacing.md }}>
            <Text style={[typography.body, { color: colors.text, marginBottom: spacing.md }]}>
              {entry.person_name}
            </Text>

            {/* Summary */}
            <View style={[styles.amountRow, { marginBottom: spacing.md, paddingBottom: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.border }]}>
              <View style={styles.amountItem}>
                <Text style={[typography.caption, { color: colors.subtext, fontSize: 10 }]}>Total</Text>
                <Text style={[typography.bodyBold, { color: colors.text, fontSize: 16 }]}>₹{Number(entry.total_amount).toFixed(0)}</Text>
              </View>
              <View style={styles.amountItem}>
                <Text style={[typography.caption, { color: colors.subtext, fontSize: 10 }]}>Paid</Text>
                <Text style={[typography.bodyBold, { color: colors.success, fontSize: 16 }]}>₹{Number(entry.paid_amount).toFixed(0)}</Text>
              </View>
              <View style={styles.amountItem}>
                <Text style={[typography.caption, { color: colors.subtext, fontSize: 10 }]}>{entry.is_settled ? 'Cleared' : 'Remaining'}</Text>
                <Text style={[typography.bodyBold, { color: entry.is_settled ? colors.subtext : colors.danger, fontSize: 16 }]}>₹{entry.is_settled ? '0' : Number(entry.remaining_amount).toFixed(0)}</Text>
              </View>
            </View>

            {/* Payment List */}
            {loading ? (
              <Text style={[typography.body, { color: colors.subtext, textAlign: 'center' }]}>Loading...</Text>
            ) : payments.length === 0 ? (
              <View style={{ alignItems: 'center', paddingVertical: spacing.lg }}>
                <MaterialCommunityIcons name="cash-remove" size={48} color={colors.subtext} />
                <Text style={[typography.body, { color: colors.subtext, marginTop: spacing.sm }]}>
                  No payments yet
                </Text>
              </View>
            ) : (
              <ScrollView style={{ maxHeight: 300 }}>
                {payments.map((payment, index) => (
                  <View
                    key={payment.id}
                    style={[
                      {
                        padding: spacing.md,
                        backgroundColor: colors.card,
                        borderRadius: borderRadius.md,
                        marginBottom: spacing.sm,
                      }
                    ]}>
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                      <View style={{ flex: 1 }}>
                        <Text style={[typography.bodyBold, { color: colors.success }]}>
                          ₹{Number(payment.amount).toFixed(0)}
                        </Text>
                        <Text style={[typography.caption, { color: colors.subtext, marginTop: spacing.xs }]}>
                          Paid on {new Date(payment.created_at).toLocaleString('en-IN', {
                            day: 'numeric',
                            month: 'short',
                            year: 'numeric',
                            hour: 'numeric',
                            minute: '2-digit',
                            hour12: true
                          })}
                        </Text>
                        {payment.notes && (
                          <Text style={[typography.caption, { color: colors.subtext, marginTop: spacing.xs, fontStyle: 'italic' }]}>
                            {payment.notes}
                          </Text>
                        )}
                      </View>
                      <View style={[styles.badge, { backgroundColor: colors.success + '20' }]}>
                        <Text style={[typography.caption, { color: colors.success, fontSize: 10 }]}>
                          Payment #{payments.length - index}
                        </Text>
                      </View>
                    </View>
                  </View>
                ))}
              </ScrollView>
            )}
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  summaryRow: {
    flexDirection: 'row',
    gap: 12,
  },
  summaryCard: {
    flex: 1,
    padding: 16,
    minWidth: 0, // Allow flex shrinking
  },
  filterTabs: {
    flexDirection: 'row',
    gap: 8,
  },
  filterTab: {
    flex: 1,
    alignItems: 'center',
    minWidth: 0, // Allow flex shrinking
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  personInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    gap: 12,
    minWidth: 0, // Allow flex shrinking
  },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0, // Don't shrink avatar
  },
  badgeContainer: {
    flexDirection: 'row',
    gap: 6,
    marginTop: 4,
    flexWrap: 'wrap', // Allow badges to wrap if needed
  },
  badge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 4,
  },
  amountRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    flexWrap: 'wrap', // Allow wrapping on small screens
  },
  amountItem: {
    alignItems: 'center',
    minWidth: 60, // Minimum width for each amount item
  },
  progressBar: {
    height: 6,
    borderRadius: 3,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
  },
  actionButtons: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  modalOverlay: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  modalContent: {
    maxHeight: '80%',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    borderBottomWidth: 1,
  },
  segmentedControl: {
    flexDirection: 'row',
    gap: 8,
  },
  segment: {
    flex: 1,
    padding: 12,
    alignItems: 'center',
  },
});
