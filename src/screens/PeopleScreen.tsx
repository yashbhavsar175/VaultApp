import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  Modal,
  ScrollView,
  Alert,
} from 'react-native';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';
import { useTheme } from '../context/ThemeContext';
import ScreenWrapper from '../components/layout/ScreenWrapper';
import AppHeader from '../components/layout/AppHeader';
import Card from '../components/ui/Card';
import AppButton from '../components/ui/AppButton';
import AppInput from '../components/ui/AppInput';
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
} from '../lib/peopleLedger';
import { PeopleLedger, PeopleLedgerPayment } from '../types';
import { scheduleLedgerNotifications, requestNotificationPermission } from '../lib/notifications';

type FilterType = 'all' | 'lent' | 'settled';

export default function PeopleScreen() {
  const { colors, typography, spacing, borderRadius } = useTheme();
  const [ledgerEntries, setLedgerEntries] = useState<PeopleLedger[]>([]);
  const [filteredEntries, setFilteredEntries] = useState<PeopleLedger[]>([]);
  const [filter, setFilter] = useState<FilterType>('all');
  const [loading, setLoading] = useState(true);
  const [summary, setSummary] = useState({ totalLent: 0, totalBorrowed: 0, lentCount: 0, borrowedCount: 0 });
  
  const [showAddModal, setShowAddModal] = useState(false);
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [showPaymentHistoryModal, setShowPaymentHistoryModal] = useState(false);
  const [selectedEntry, setSelectedEntry] = useState<PeopleLedger | null>(null);

  useEffect(() => {
    loadData();
    requestNotificationPermission();
  }, []);

  useEffect(() => {
    applyFilter();
  }, [filter, ledgerEntries]);

  const loadData = async () => {
    try {
      setLoading(true);
      const [entries, summaryData] = await Promise.all([
        getPeopleLedger(true),
        getLedgerSummary(),
      ]);
      setLedgerEntries(entries);
      setSummary(summaryData);
      
      // Schedule notifications for active entries
      const activeEntries = entries.filter(e => !e.is_settled);
      await scheduleLedgerNotifications(activeEntries);
    } catch (error) {
      console.error('Error loading ledger:', error);
      Alert.alert('Error', 'Failed to load people ledger');
    } finally {
      setLoading(false);
    }
  };

  const applyFilter = () => {
    let filtered = ledgerEntries.filter(e => e.type === 'lent'); // Only show lent entries
    if (filter === 'lent') {
      filtered = ledgerEntries.filter(e => e.type === 'lent' && !e.is_settled);
    } else if (filter === 'settled') {
      filtered = ledgerEntries.filter(e => e.type === 'lent' && e.is_settled);
    } else {
      filtered = ledgerEntries.filter(e => e.type === 'lent' && !e.is_settled);
    }
    console.log('Filter:', filter, 'Total entries:', ledgerEntries.length, 'Filtered:', filtered.length);
    setFilteredEntries(filtered);
  };

  const handleAddEntry = () => {
    setSelectedEntry(null);
    setShowAddModal(true);
  };

  const handleAddPayment = (entry: PeopleLedger) => {
    setSelectedEntry(entry);
    setShowPaymentModal(true);
  };

  const handleSettle = async (entry: PeopleLedger) => {
    Alert.alert(
      'Settle Entry',
      `Mark ${entry.person_name} as settled?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Settle',
          onPress: async () => {
            try {
              await markAsSettled(entry.id);
              await loadData();
            } catch (error) {
              Alert.alert('Error', 'Failed to settle entry');
            }
          },
        },
      ]
    );
  };

  const handleDelete = async (entry: PeopleLedger) => {
    Alert.alert(
      'Delete Entry',
      `Delete ${entry.person_name}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              await deleteLedgerEntry(entry.id);
              await loadData();
            } catch (error) {
              Alert.alert('Error', 'Failed to delete entry');
            }
          },
        },
      ]
    );
  };

  const getPersonInitial = (name: string) => {
    return name.charAt(0).toUpperCase();
  };

  const getAvatarColor = (name: string) => {
    const colors = ['#FF6B6B', '#4ECDC4', '#45B7D1', '#FFA07A', '#98D8C8', '#F7DC6F'];
    const index = name.charCodeAt(0) % colors.length;
    return colors[index];
  };

  const renderLedgerCard = ({ item }: { item: PeopleLedger }) => {
    const progress = Number(item.paid_amount) / Number(item.total_amount);
    const overdue = isOverdue(item);
    const dueToday = isDueToday(item);
    const daysUntilDue = getDaysUntilDue(item);
    const expectedByToday = calculateExpectedByToday(item);

    return (
      <Card style={{ marginBottom: spacing.md }}>
        <View style={styles.cardHeader}>
          <View style={styles.personInfo}>
            <View style={[styles.avatar, { backgroundColor: getAvatarColor(item.person_name) }]}>
              <Text style={[typography.h3, { color: '#fff' }]}>{getPersonInitial(item.person_name)}</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[typography.h4, { color: colors.text }]}>{item.person_name}</Text>
              <View style={styles.badgeContainer}>
                <View style={[styles.badge, { backgroundColor: colors.success + '20' }]}>
                  <Text style={[typography.caption, { color: colors.success }]}>
                    Lent
                  </Text>
                </View>
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
              </View>
            </View>
          </View>
        </View>

        <View style={[styles.amountRow, { marginTop: spacing.md }]}>
          <View style={styles.amountItem}>
            <Text style={[typography.caption, { color: colors.subtext, fontSize: 10 }]} numberOfLines={1}>Total</Text>
            <Text style={[typography.h4, { color: colors.text, fontSize: 16 }]} numberOfLines={1} adjustsFontSizeToFit>
              ₹{Number(item.total_amount).toFixed(0)}
            </Text>
          </View>
          <View style={styles.amountItem}>
            <Text style={[typography.caption, { color: colors.subtext, fontSize: 10 }]} numberOfLines={1}>Paid</Text>
            <Text style={[typography.h4, { color: colors.success, fontSize: 16 }]} numberOfLines={1} adjustsFontSizeToFit>
              ₹{Number(item.paid_amount).toFixed(0)}
            </Text>
          </View>
          <View style={styles.amountItem}>
            <Text style={[typography.caption, { color: colors.subtext, fontSize: 10 }]} numberOfLines={1}>Remaining</Text>
            <Text style={[typography.h4, { color: colors.danger, fontSize: 16 }]} numberOfLines={1} adjustsFontSizeToFit>
              ₹{Number(item.remaining_amount).toFixed(0)}
            </Text>
          </View>
        </View>

        <View style={[styles.progressBar, { backgroundColor: colors.border, marginTop: spacing.md }]}>
          <View style={[styles.progressFill, { width: `${progress * 100}%`, backgroundColor: colors.success }]} />
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

        {/* Payment Info */}
        {Number(item.paid_amount) > 0 && (
          <TouchableOpacity 
            onPress={() => {
              setSelectedEntry(item);
              setShowPaymentHistoryModal(true);
            }}
            style={{ marginTop: spacing.sm }}>
            <Text style={[typography.caption, { color: colors.accent }]}>
              💰 {Number(item.paid_amount) > 0 ? `₹${Number(item.paid_amount).toFixed(0)} paid` : 'No payments yet'} • Tap to view history
            </Text>
          </TouchableOpacity>
        )}

        {!item.is_settled && (
          <View style={[styles.actionButtons, { marginTop: spacing.md }]}>
            <AppButton
              title="Add Payment"
              onPress={() => handleAddPayment(item)}
              variant="primary"
              style={{ flex: 1, marginRight: spacing.xs, paddingVertical: spacing.sm }}
            />
            <AppButton
              title="Settle"
              onPress={() => handleSettle(item)}
              variant="secondary"
              style={{ flex: 1, paddingVertical: spacing.sm }}
            />
            <TouchableOpacity 
              onPress={() => handleDelete(item)} 
              style={{ 
                marginLeft: spacing.xs, 
                padding: spacing.sm,
                justifyContent: 'center',
                alignItems: 'center',
              }}>
              <MaterialCommunityIcons name="delete" size={20} color={colors.danger} />
            </TouchableOpacity>
          </View>
        )}
      </Card>
    );
  };

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
              You Lent
            </Text>
            <Text style={[typography.h2, { color: colors.success, fontSize: 36, fontWeight: '800', marginTop: 4 }]}>
              ₹{summary.totalLent.toFixed(0)}
            </Text>
            <Text style={[typography.caption, { color: colors.subtext, fontSize: 14, marginTop: 6 }]}>
              {summary.lentCount} people
            </Text>
          </Card>
        </View>

        {/* Filter Tabs */}
        <View style={[styles.filterTabs, { marginBottom: spacing.md }]}>
          {(['all', 'lent', 'settled'] as FilterType[]).map((f) => {
            const isActive = filter === f;
            return (
              <TouchableOpacity
                key={f}
                onPress={() => {
                  console.log('Filter changed to:', f);
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
          <Text style={[typography.body, { color: colors.subtext, textAlign: 'center', marginTop: spacing.xl }]}>
            Loading...
          </Text>
        ) : filteredEntries.length === 0 ? (
          <View style={{ alignItems: 'center', marginTop: spacing.xl }}>
            <MaterialCommunityIcons name="account-group-outline" size={64} color={colors.subtext} />
            <Text style={[typography.body, { color: colors.subtext, marginTop: spacing.md }]}>
              {filter === 'settled' 
                ? 'No settled entries' 
                : filter === 'lent'
                ? 'No lent entries'
                : 'No entries found'}
            </Text>
            {filter !== 'all' && ledgerEntries.length > 0 && (
              <TouchableOpacity onPress={() => setFilter('all')} style={{ marginTop: spacing.sm }}>
                <Text style={[typography.caption, { color: colors.accent }]}>
                  View all entries
                </Text>
              </TouchableOpacity>
            )}
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
        onSuccess={loadData}
      />

      <PaymentModal
        visible={showPaymentModal}
        entry={selectedEntry}
        onClose={() => setShowPaymentModal(false)}
        onSuccess={loadData}
      />

      <PaymentHistoryModal
        visible={showPaymentHistoryModal}
        entry={selectedEntry}
        onClose={() => setShowPaymentHistoryModal(false)}
      />
    </ScreenWrapper>
  );
}

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
    if (!formData.person_name || !formData.total_amount) {
      Alert.alert('Error', 'Please fill all required fields');
      return;
    }

    try {
      setLoading(true);
      await addLedgerEntry(formData as AddLedgerEntryData);
      Alert.alert('Success', 'Entry added successfully');
      onClose();
      onSuccess();
      setFormData({ type: 'lent', repayment_type: 'one_time', installment_days: ['mon', 'tue', 'wed', 'thu', 'fri', 'sat'] });
    } catch (error) {
      Alert.alert('Error', 'Failed to add entry');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" transparent>
      <View style={[styles.modalOverlay, { backgroundColor: 'rgba(0,0,0,0.5)' }]}>
        <View style={[styles.modalContent, { backgroundColor: colors.background, borderRadius: borderRadius.lg }]}>
          <View style={[styles.modalHeader, { borderBottomColor: colors.border }]}>
            <Text style={[typography.h3, { color: colors.text }]}>Add Entry</Text>
            <TouchableOpacity onPress={onClose}>
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

    try {
      setLoading(true);
      await addPayment(entry.id, parseFloat(amount), notes);
      Alert.alert('Success', 'Payment added successfully');
      onClose();
      onSuccess();
      setAmount('');
      setNotes('');
    } catch (error) {
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

  useEffect(() => {
    if (visible && entry) {
      loadPayments();
    }
  }, [visible, entry]);

  const loadPayments = async () => {
    if (!entry) return;
    
    try {
      setLoading(true);
      const data = await getPayments(entry.id);
      setPayments(data);
    } catch (error) {
      console.error('Error loading payments:', error);
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
                <Text style={[typography.h4, { color: colors.text, fontSize: 16 }]}>₹{Number(entry.total_amount).toFixed(0)}</Text>
              </View>
              <View style={styles.amountItem}>
                <Text style={[typography.caption, { color: colors.subtext, fontSize: 10 }]}>Paid</Text>
                <Text style={[typography.h4, { color: colors.success, fontSize: 16 }]}>₹{Number(entry.paid_amount).toFixed(0)}</Text>
              </View>
              <View style={styles.amountItem}>
                <Text style={[typography.caption, { color: colors.subtext, fontSize: 10 }]}>Remaining</Text>
                <Text style={[typography.h4, { color: colors.danger, fontSize: 16 }]}>₹{Number(entry.remaining_amount).toFixed(0)}</Text>
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
                          {new Date(payment.paid_date).toLocaleDateString('en-IN', { 
                            day: 'numeric', 
                            month: 'short', 
                            year: 'numeric' 
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
