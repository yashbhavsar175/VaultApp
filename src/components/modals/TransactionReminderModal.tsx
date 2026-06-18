import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TouchableOpacity,
  TouchableWithoutFeedback,
  Platform,
  ScrollView,
} from 'react-native';
import DateTimePicker, { DateTimePickerEvent } from '@react-native-community/datetimepicker';
import AsyncStorage from '@react-native-async-storage/async-storage';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';
import HapticFeedback from 'react-native-haptic-feedback';
import Toast from 'react-native-toast-message';
import { useTheme } from '../../context/ThemeContext';
import {
  scheduleTransactionReminder,
  cancelTransactionReminder,
  isTransactionReminderScheduled,
} from '../../lib/services/scheduledNotifications';

// AsyncStorage key format for storing reminder metadata locally
export const REMINDER_STORAGE_KEY = (txId: string) => `tx_reminder_${txId}`;

export interface TransactionReminderData {
  transactionId: string;
  scheduledAt: string; // ISO string
  note: string;
}

interface Props {
  visible: boolean;
  transactionId: string;
  transactionAmount: number;
  transactionNote: string;
  onClose: () => void;
  onReminderChanged?: () => void; // callback when set/cancelled
}

// ─── Helpers ────────────────────────────────────────────────────────────────────

export async function getStoredTransactionReminder(
  transactionId: string,
): Promise<TransactionReminderData | null> {
  try {
    const raw = await AsyncStorage.getItem(REMINDER_STORAGE_KEY(transactionId));
    if (!raw) return null;
    return JSON.parse(raw) as TransactionReminderData;
  } catch {
    return null;
  }
}

export async function storeTransactionReminder(data: TransactionReminderData): Promise<void> {
  await AsyncStorage.setItem(REMINDER_STORAGE_KEY(data.transactionId), JSON.stringify(data));
}

export async function removeStoredTransactionReminder(transactionId: string): Promise<void> {
  await AsyncStorage.removeItem(REMINDER_STORAGE_KEY(transactionId));
}

function formatReminderTime(date: Date): string {
  return date.toLocaleString('en-IN', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  });
}

// ─── Component ──────────────────────────────────────────────────────────────────

export default function TransactionReminderModal({
  visible,
  transactionId,
  transactionAmount,
  transactionNote,
  onClose,
  onReminderChanged,
}: Props) {
  const { colors, typography, spacing, borderRadius } = useTheme();

  const [selectedDate, setSelectedDate] = useState<Date>(() => {
    const d = new Date();
    d.setHours(d.getHours() + 1, 0, 0, 0); // default: 1 hour from now
    return d;
  });
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [showTimePicker, setShowTimePicker] = useState(false);
  const [existingReminder, setExistingReminder] = useState<TransactionReminderData | null>(null);
  const [saving, setSaving] = useState(false);
  const [cancelling, setCancelling] = useState(false);

  const loadExistingReminder = useCallback(async () => {
    const stored = await getStoredTransactionReminder(transactionId);
    if (stored) {
      // Verify it's still actually scheduled in Notifee (could have fired already)
      const isStillActive = await isTransactionReminderScheduled(transactionId);
      if (isStillActive) {
        setExistingReminder(stored);
        // Pre-fill picker with existing time
        setSelectedDate(new Date(stored.scheduledAt));
      } else {
        // Notification already fired — clean up storage
        await removeStoredTransactionReminder(transactionId);
        setExistingReminder(null);
      }
    } else {
      setExistingReminder(null);
    }
  }, [transactionId]);

  useEffect(() => {
    if (visible) {
      loadExistingReminder();
    }
  }, [visible, loadExistingReminder]);

  const handleDateChange = (_: DateTimePickerEvent, date?: Date) => {
    setShowDatePicker(false);
    if (date) {
      setSelectedDate(prev => {
        const updated = new Date(date);
        updated.setHours(prev.getHours(), prev.getMinutes(), 0, 0);
        return updated;
      });
    }
  };

  const handleTimeChange = (_: DateTimePickerEvent, date?: Date) => {
    setShowTimePicker(false);
    if (date) {
      setSelectedDate(prev => {
        const updated = new Date(prev);
        updated.setHours(date.getHours(), date.getMinutes(), 0, 0);
        return updated;
      });
    }
  };

  const handleSetReminder = async () => {
    if (selectedDate <= new Date()) {
      Toast.show({
        type: 'error',
        text1: 'Invalid Time',
        text2: 'Please select a future date & time',
      });
      return;
    }

    setSaving(true);
    try {
      await scheduleTransactionReminder(
        transactionId,
        transactionAmount,
        transactionNote,
        selectedDate,
      );

      const data: TransactionReminderData = {
        transactionId,
        scheduledAt: selectedDate.toISOString(),
        note: transactionNote,
      };
      await storeTransactionReminder(data);
      setExistingReminder(data);

      HapticFeedback.trigger('notificationSuccess', {
        enableVibrateFallback: true,
        ignoreAndroidSystemSettings: false,
      });
      Toast.show({
        type: 'success',
        text1: '🔔 Reminder Set!',
        text2: `We will remind you at ${formatReminderTime(selectedDate)}`,
      });
      onReminderChanged?.();
      onClose();
    } catch (e) {
      console.error('[TransactionReminderModal] schedule error:', e);
      HapticFeedback.trigger('notificationError', {
        enableVibrateFallback: true,
        ignoreAndroidSystemSettings: false,
      });
      Toast.show({
        type: 'error',
        text1: 'Error',
        text2: 'Failed to set reminder. Please try again.',
      });
    } finally {
      setSaving(false);
    }
  };

  const handleCancelReminder = async () => {
    setCancelling(true);
    try {
      await cancelTransactionReminder(transactionId);
      await removeStoredTransactionReminder(transactionId);
      setExistingReminder(null);

      HapticFeedback.trigger('notificationWarning', {
        enableVibrateFallback: true,
        ignoreAndroidSystemSettings: false,
      });
      Toast.show({
        type: 'info',
        text1: 'Reminder Cancelled',
        text2: 'Meetup reminder has been removed.',
      });
      onReminderChanged?.();
      onClose();
    } catch (e) {
      console.error('[TransactionReminderModal] cancel error:', e);
      Toast.show({
        type: 'error',
        text1: 'Error',
        text2: 'Failed to cancel reminder.',
      });
    } finally {
      setCancelling(false);
    }
  };

  const accentColor = '#f59e0b'; // amber — meetup reminder brand colour

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      statusBarTranslucent
      onRequestClose={onClose}
    >
      <TouchableWithoutFeedback onPress={onClose}>
        <View style={styles.backdrop} />
      </TouchableWithoutFeedback>

      <View style={[styles.sheet, { backgroundColor: colors.card, borderRadius: borderRadius.xl }]}>
        {/* Handle bar */}
        <View style={[styles.handleBar, { backgroundColor: colors.border }]} />

        {/* Header */}
        <View style={[styles.header, { marginBottom: spacing.lg }]}>
          <View style={[styles.headerIcon, { backgroundColor: accentColor + '20' }]}>
            <MaterialCommunityIcons name="account-clock-outline" size={28} color={accentColor} />
          </View>
          <View style={{ flex: 1, marginLeft: spacing.md }}>
            <Text style={[typography.h3, { color: colors.text }]}>Meetup Reminder</Text>
            <Text style={[typography.caption, { color: colors.subtext, marginTop: 2 }]}>
              We will remind you when you meet so you can ask for your money back!
            </Text>
          </View>
          <TouchableOpacity onPress={onClose} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
            <MaterialCommunityIcons name="close" size={22} color={colors.subtext} />
          </TouchableOpacity>
        </View>

        <ScrollView showsVerticalScrollIndicator={false}>
          {/* Transaction info pill */}
          <View
            style={[
              styles.txPill,
              {
                backgroundColor: accentColor + '12',
                borderColor: accentColor + '40',
                borderRadius: borderRadius.md,
                marginBottom: spacing.lg,
              },
            ]}
          >
            <MaterialCommunityIcons name="cash-multiple" size={18} color={accentColor} />
            <Text style={[typography.bodyBold, { color: colors.text, marginLeft: spacing.sm, flex: 1 }]} numberOfLines={1}>
              {transactionNote}
            </Text>
            <Text style={[typography.bodyBold, { color: accentColor }]}>
              ₹{Number(transactionAmount).toFixed(0)}
            </Text>
          </View>

          {/* Existing reminder banner */}
          {existingReminder && (
            <View
              style={[
                styles.existingBanner,
                {
                  backgroundColor: colors.success + '15',
                  borderColor: colors.success + '40',
                  borderRadius: borderRadius.md,
                  marginBottom: spacing.lg,
                  padding: spacing.md,
                },
              ]}
            >
              <MaterialCommunityIcons name="bell-ring-outline" size={18} color={colors.success} />
              <View style={{ flex: 1, marginLeft: spacing.sm }}>
                <Text style={[typography.caption, { color: colors.success, fontWeight: '700' }]}>
                  Reminder Already Set
                </Text>
                <Text style={[typography.caption, { color: colors.subtext, marginTop: 2 }]}>
                  {formatReminderTime(new Date(existingReminder.scheduledAt))}
                </Text>
              </View>
            </View>
          )}

          {/* Date Selector */}
          <Text style={[typography.caption, { color: colors.subtext, marginBottom: spacing.xs }]}>
            {existingReminder ? 'Set a new date' : 'When will you meet?'} — Date
          </Text>
          <TouchableOpacity
            style={[
              styles.pickerButton,
              {
                backgroundColor: colors.background,
                borderColor: colors.border,
                borderRadius: borderRadius.md,
                marginBottom: spacing.md,
              },
            ]}
            onPress={() => setShowDatePicker(true)}
          >
            <MaterialCommunityIcons name="calendar-outline" size={20} color={accentColor} />
            <Text style={[typography.body, { color: colors.text, marginLeft: spacing.sm, flex: 1 }]}>
              {selectedDate.toLocaleDateString('en-IN', {
                weekday: 'short',
                day: 'numeric',
                month: 'long',
                year: 'numeric',
              })}
            </Text>
            <MaterialCommunityIcons name="chevron-right" size={18} color={colors.subtext} />
          </TouchableOpacity>

          {/* Time Selector */}
          <Text style={[typography.caption, { color: colors.subtext, marginBottom: spacing.xs }]}>
            At what time? — Time
          </Text>
          <TouchableOpacity
            style={[
              styles.pickerButton,
              {
                backgroundColor: colors.background,
                borderColor: colors.border,
                borderRadius: borderRadius.md,
                marginBottom: spacing.xl,
              },
            ]}
            onPress={() => setShowTimePicker(true)}
          >
            <MaterialCommunityIcons name="clock-outline" size={20} color={accentColor} />
            <Text style={[typography.body, { color: colors.text, marginLeft: spacing.sm, flex: 1 }]}>
              {selectedDate.toLocaleTimeString('en-IN', {
                hour: '2-digit',
                minute: '2-digit',
                hour12: true,
              })}
            </Text>
            <MaterialCommunityIcons name="chevron-right" size={18} color={colors.subtext} />
          </TouchableOpacity>

          {/* Action Buttons */}
          <TouchableOpacity
            style={[
              styles.primaryBtn,
              {
                backgroundColor: saving ? accentColor + '80' : accentColor,
                borderRadius: borderRadius.md,
                marginBottom: spacing.sm,
              },
            ]}
            onPress={handleSetReminder}
            disabled={saving || cancelling}
            activeOpacity={0.85}
          >
            <MaterialCommunityIcons name="bell-plus-outline" size={20} color="#fff" />
            <Text style={[typography.bodyBold, { color: '#fff', marginLeft: spacing.sm }]}>
              {saving ? 'Setting...' : existingReminder ? 'Update Reminder' : 'Set Reminder'}
            </Text>
          </TouchableOpacity>

          {existingReminder && (
            <TouchableOpacity
              style={[
                styles.cancelBtn,
                {
                  borderColor: colors.error + '60',
                  borderRadius: borderRadius.md,
                  marginBottom: spacing.sm,
                },
              ]}
              onPress={handleCancelReminder}
              disabled={saving || cancelling}
              activeOpacity={0.85}
            >
              <MaterialCommunityIcons name="bell-off-outline" size={20} color={colors.error} />
              <Text style={[typography.bodyBold, { color: colors.error, marginLeft: spacing.sm }]}>
                {cancelling ? 'Cancelling...' : 'Cancel Reminder'}
              </Text>
            </TouchableOpacity>
          )}

          <View style={{ height: spacing.xl }} />
        </ScrollView>

        {/* Native Date / Time Pickers */}
        {showDatePicker && (
          <DateTimePicker
            value={selectedDate}
            mode="date"
            display={Platform.OS === 'ios' ? 'spinner' : 'default'}
            minimumDate={new Date()}
            onChange={handleDateChange}
          />
        )}
        {showTimePicker && (
          <DateTimePicker
            value={selectedDate}
            mode="time"
            display={Platform.OS === 'ios' ? 'spinner' : 'default'}
            onChange={handleTimeChange}
          />
        )}
        {/* Toast must be inside the Modal to be visible over it per .cursorrules Mistake 8 */}
        <Toast />
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  sheet: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    maxHeight: '85%',
    paddingHorizontal: 20,
    paddingBottom: 8,
    paddingTop: 12,
    // Shadows for iOS
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.2,
    shadowRadius: 12,
    // Elevation for Android
    elevation: 24,
  },
  handleBar: {
    width: 40,
    height: 4,
    borderRadius: 2,
    alignSelf: 'center',
    marginBottom: 16,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  headerIcon: {
    width: 48,
    height: 48,
    borderRadius: 24,
    justifyContent: 'center',
    alignItems: 'center',
  },
  txPill: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    padding: 12,
  },
  existingBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
  },
  pickerButton: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 14,
  },
  primaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    paddingHorizontal: 20,
  },
  cancelBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    paddingVertical: 14,
    paddingHorizontal: 20,
  },
});
