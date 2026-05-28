import React, { useState, useEffect, useRef, useCallback } from 'react';
import { View, Text, StyleSheet, ActivityIndicator, TouchableOpacity } from 'react-native';
import { RouteProp } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';
import Toast from 'react-native-toast-message';
import HapticFeedback from 'react-native-haptic-feedback';
import { supabase, deleteTransaction, updateTransaction } from '../../lib/core';
import { BankAccount, Transaction } from '../../types';
import { useTheme } from '../../context/ThemeContext';
import { ScreenWrapper, Card, AppHeader, AppButton, EditTransactionModal, AppConfirmModal } from '../../components';
import { formatCurrency as formatAmount } from '../../utils/format';
import {
  getTransactionAmountPrefix,
  getTransactionColor,
  getTransactionIcon,
  getTransactionTypeLabel,
  formatTransactionDateTime,
} from '../../utils/transactionHelpers';
import { extractUpiIdFromText, getUpiHandle, getUpiProviderName } from '../../utils/upi';
import { getBankAccounts } from '../../lib/database/financial';
import { CACHE_KEYS, getCached, setCache, updateCache } from '../../lib/services/cache';
import { isRedactedRawTextRecord, sanitizeTransactionRawSmsForPrivacy } from '../../lib/privacy/rawText';

type TransactionDetailRouteProp = RouteProp<
  { TransactionDetail: { transactionId: string } },
  'TransactionDetail'
>;

type TransactionDetailNavigationProp = StackNavigationProp<any, 'TransactionDetail'>;

interface Props {
  route: TransactionDetailRouteProp;
  navigation: TransactionDetailNavigationProp;
}

type ThemeColors = ReturnType<typeof useTheme>['colors'];

interface SourceTrace {
  icon: string;
  title: string;
  subtitle: string;
  color: string;
}

interface TraceRow {
  icon: string;
  label: string;
  value: string;
}

function toTitleCase(value: string): string {
  return value
    .replace(/[_-]/g, ' ')
    .replace(/\b\w/g, char => char.toUpperCase());
}

function getKnownSenderName(sender?: string | null): string | null {
  if (!sender) return null;
  const normalized = sender.toLowerCase();

  if (normalized.includes('nbu.paisa.user') || normalized.includes('gpay')) return 'Google Pay';
  if (normalized.includes('phonepe')) return 'PhonePe';
  if (normalized.includes('paytm')) return 'Paytm';
  if (normalized.includes('whatsapp')) return 'WhatsApp';
  if (normalized.includes('dreamplug') || normalized.includes('cred')) return 'CRED';
  if (normalized.includes('amazon')) return 'Amazon Pay';
  if (normalized.includes('utkspr') || normalized.includes('utk') || normalized.includes('supercard')) return 'SuperCard / Utkarsh';
  if (normalized.includes('super.money') || normalized.includes('superm') || normalized.includes('money.super') || normalized.includes('super')) return 'super.money';
  if (normalized.includes('slice') || normalized.includes('slce')) return 'slice';

  return null;
}

function formatSender(sender?: string | null): string | null {
  const trimmed = sender?.trim();
  if (!trimmed) return null;

  const knownName = getKnownSenderName(trimmed);
  if (knownName) {
    return `${knownName} (${trimmed})`;
  }

  return trimmed;
}

function getEntrySourceTrace(transaction: Transaction, bankName: string | null, colors: ThemeColors): SourceTrace {
  const source = transaction.sms_source?.toLowerCase();
  const senderName = getKnownSenderName(transaction.sms_sender);
  const upiId = transaction.upi_id || extractUpiIdFromText(transaction.raw_sms);
  const upiProvider = getUpiProviderName(upiId);

  if (!source || source === 'manual') {
    return {
      icon: 'pencil-circle',
      title: 'Manual Entry',
      subtitle: bankName ? `Added manually for ${bankName}` : 'Added manually in the app',
      color: colors.accent,
    };
  }

  if (source === 'sms' || source === 'bank') {
    // Build detailed subtitle with all available info
    let subtitle = '';
    
    if (senderName) {
      subtitle = `Detected from ${senderName}`;
    } else if (bankName) {
      subtitle = `From ${bankName}`;
    } else if (transaction.account_last4) {
      subtitle = `Account ending ${transaction.account_last4}`;
    } else {
      subtitle = 'Captured from a bank message';
    }
    
    // Add UPI info if available
    if (upiId && upiProvider) {
      subtitle += ` • ${upiProvider}`;
    }
    
    return {
      icon: 'message-text-clock',
      title: senderName ? `${senderName} SMS` : bankName ? `${bankName} SMS` : 'Bank SMS',
      subtitle,
      color: colors.info,
    };
  }

  if (source === 'upi') {
    return {
      icon: 'cellphone-message',
      title: senderName ? `${senderName} Alert` : 'UPI/App Alert',
      subtitle: senderName && upiProvider && senderName !== upiProvider
        ? `Detected by ${senderName}; UPI handle looks like ${upiProvider}`
        : upiProvider
          ? `UPI handle looks like ${upiProvider}`
          : 'Captured from a payment app notification',
      color: colors.success,
    };
  }

  return {
    icon: 'radar',
    title: `${toTitleCase(source)} Entry`,
    subtitle: transaction.sms_sender ? `Sender ${transaction.sms_sender}` : 'Captured automatically',
    color: colors.warning,
  };
}

export default function TransactionDetail({ route, navigation }: Props) {
  const { transactionId } = route.params || {};
  const { colors, typography, spacing, borderRadius } = useTheme();
  const [transaction, setTransaction] = useState<Transaction | null>(null);
  const [bankName, setBankName] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [showRawMessage, setShowRawMessage] = useState(false);
  const [isEditModalVisible, setIsEditModalVisible] = useState(false);
  const [confirmDialog, setConfirmDialog] = useState<{
    visible: boolean;
    title: string;
    message: string;
    confirmText?: string;
    isDestructive: boolean;
    onConfirm: () => void;
  } | null>(null);

  // Track mount state to prevent setState on unmounted component
  const isMountedRef = useRef(true);

  const applyBankNameFromCache = useCallback(async (tx: Transaction) => {
    if (!tx.account_id) {
      setBankName(tx.account_last4 ? `Account ending ${tx.account_last4}` : null);
      return;
    }

    const cachedBanks = await getCached<BankAccount[]>(CACHE_KEYS.BANK_ACCOUNTS);
    const bank = cachedBanks?.data.find(account => account.id === tx.account_id);
    if (bank && isMountedRef.current) {
      setBankName(`${bank.bank_name} (${bank.account_last4})`);
    }
  }, []);

  const loadTransaction = useCallback(async () => {
    let hasCachedTransaction = false;

    try {
      const cachedTransactions = await getCached<Transaction[]>(CACHE_KEYS.TRANSACTIONS);
      const cachedTransaction = cachedTransactions?.data.find(tx => tx.id === transactionId);

      if (cachedTransaction && isMountedRef.current) {
        hasCachedTransaction = true;
        setTransaction(cachedTransaction);
        await applyBankNameFromCache(cachedTransaction);
        setLoading(false);
      } else {
        setLoading(true);
      }

      // SECURITY: Always verify user_id — navigation params can be tampered
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      const { data, error } = await supabase
        .from('transactions')
        .select('*')
        .eq('id', transactionId)
        .eq('user_id', user.id)  // Must verify ownership
        .single();

      if (error) throw error;
      if (!isMountedRef.current) return; // BUG FIX: prevent state update after unmount
      const safeTransaction = sanitizeTransactionRawSmsForPrivacy(data as Transaction);
      setTransaction(safeTransaction);
      await updateCache<Transaction[]>(CACHE_KEYS.TRANSACTIONS, current =>
        current
          ? current.map(tx => tx.id === safeTransaction.id ? safeTransaction : tx)
          : [safeTransaction]
      );

      // Fetch bank account name if account_id exists
      if (safeTransaction.account_id) {
        const bankAccounts = await getBankAccounts();
        await setCache(CACHE_KEYS.BANK_ACCOUNTS, bankAccounts);
        const bankData = bankAccounts.find(account => account.id === safeTransaction.account_id);

        if (bankData && isMountedRef.current) {
          setBankName(`${bankData.bank_name} (${bankData.account_last4})`);
        }
      } else if (isMountedRef.current) {
        setBankName(safeTransaction.account_last4 ? `Account ending ${safeTransaction.account_last4}` : null);
      }
    } catch (error) {
      if (!isMountedRef.current) return;
      console.error('Error loading transaction:', error);
      if (!hasCachedTransaction) {
        Toast.show({
          type: 'error',
          text1: 'Error',
          text2: 'Failed to load transaction details',
        });
      }
    } finally {
      if (isMountedRef.current) setLoading(false);
    }
  }, [applyBankNameFromCache, transactionId]);

  useEffect(() => {
    isMountedRef.current = true;
    loadTransaction();
    return () => { isMountedRef.current = false; };
  }, [loadTransaction]);

  const handleDelete = () => {
    if (!transaction) return;
    HapticFeedback.trigger('notificationWarning', { enableVibrateFallback: true, ignoreAndroidSystemSettings: false });
    setConfirmDialog({
      visible: true,
      title: 'Delete Transaction',
      message: `Delete "${transaction.note}"? This action cannot be undone.`,
      confirmText: 'Delete',
      isDestructive: true,
      onConfirm: async () => {
        setConfirmDialog(null);
        try {
          await deleteTransaction(transaction.id);
          await updateCache<Transaction[]>(CACHE_KEYS.TRANSACTIONS, current =>
            current ? current.filter(tx => tx.id !== transaction.id) : current
          );
          HapticFeedback.trigger('notificationSuccess', { enableVibrateFallback: true, ignoreAndroidSystemSettings: false });
          Toast.show({
            type: 'success',
            text1: 'Deleted',
            text2: 'Transaction deleted successfully',
          });
          navigation.goBack();
        } catch {
          HapticFeedback.trigger('notificationError', { enableVibrateFallback: true, ignoreAndroidSystemSettings: false });
          Toast.show({
            type: 'error',
            text1: 'Error',
            text2: 'Failed to delete transaction',
          });
        }
      }
    });
  };

  const handleSaveEdit = async (id: string, updates: Partial<Transaction>) => {
    try {
      const updatedTransaction = await updateTransaction(id, updates);
      setTransaction(updatedTransaction);
      await updateCache<Transaction[]>(CACHE_KEYS.TRANSACTIONS, current =>
        current ? current.map(tx => tx.id === id ? updatedTransaction : tx) : [updatedTransaction]
      );
      Toast.show({
        type: 'success',
        text1: 'Updated',
        text2: 'Transaction updated successfully',
      });
      setIsEditModalVisible(false);
    } catch {
      Toast.show({
        type: 'error',
        text1: 'Error',
        text2: 'Failed to update transaction',
      });
    }
  };

  if (loading) {
    return (
      <ScreenWrapper>
        <AppHeader title="Transaction" showBack />
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={colors.accent} />
        </View>
      </ScreenWrapper>
    );
  }

  if (!transaction) {
    return (
      <ScreenWrapper>
        <AppHeader title="Transaction" showBack />
        <View style={styles.loadingContainer}>
          <MaterialCommunityIcons name="alert-circle-outline" size={64} color={colors.subtext} />
          <Text style={[typography.body, { color: colors.subtext, marginTop: spacing.md }]}>
            Transaction not found
          </Text>
        </View>
      </ScreenWrapper>
    );
  }

  const txColor = getTransactionColor(transaction.type);
  const txIcon = getTransactionIcon(transaction.type);
  const { date: formattedDate, time: formattedTime } = formatTransactionDateTime(transaction.created_at);
  const sourceTrace = getEntrySourceTrace(transaction, bankName, colors);
  const senderLabel = formatSender(transaction.sms_sender);
  const accountLabel = bankName || (transaction.account_last4 ? `Account ending ${transaction.account_last4}` : null);
  const rawMessage = transaction.raw_sms?.trim();
  const isRedactedRawMessage = isRedactedRawTextRecord(rawMessage);
  const upiId = transaction.upi_id || extractUpiIdFromText(rawMessage);
  const detectedApp = getKnownSenderName(transaction.sms_sender);
  const upiProvider = getUpiProviderName(upiId);
  const upiHandle = getUpiHandle(upiId);
  const appRoute = detectedApp && upiProvider && detectedApp !== upiProvider
    ? `${detectedApp} -> ${upiProvider}`
    : null;
  const balanceAfter = transaction.balance !== null && transaction.balance !== undefined
    ? formatAmount(Number(transaction.balance))
    : null;
  const savedAt = new Date(transaction.created_at).toLocaleString();
  const traceRows = [
    { icon: 'radar', label: 'Captured From', value: sourceTrace.title },
    appRoute ? { icon: 'swap-horizontal', label: 'App Route', value: appRoute } : null,
    detectedApp ? { icon: 'cellphone', label: 'Detected App', value: detectedApp } : null,
    senderLabel ? { icon: 'account-voice', label: 'Sender', value: senderLabel } : null,
    accountLabel ? { icon: 'bank', label: 'Matched Account', value: accountLabel } : null,
    upiProvider ? { icon: 'cellphone-link', label: 'UPI Provider', value: upiHandle ? `${upiProvider} (@${upiHandle})` : upiProvider } : null,
    upiId ? { icon: 'qrcode', label: 'UPI ID', value: upiId } : null,
    transaction.reference_number ? { icon: 'identifier', label: 'Reference / UTR', value: transaction.reference_number } : null,
    balanceAfter ? { icon: 'wallet-outline', label: 'Balance After', value: balanceAfter } : null,
    transaction.is_transfer_pending
      ? { icon: 'swap-horizontal-circle-outline', label: 'Transfer Status', value: 'Waiting for matching transfer entry' }
      : null,
    { icon: 'clock-check-outline', label: 'Saved At', value: savedAt },
    { icon: 'identifier', label: 'Record ID', value: transaction.id },
  ].filter(Boolean) as TraceRow[];

  return (
    <ScreenWrapper scrollable>
      <AppHeader 
        title="Transaction" 
        showBack 
        rightAction={{
          icon: 'pencil',
          onPress: () => setIsEditModalVisible(true),
        }}
      />

      <View style={{ padding: spacing.lg }}>
        {/* Amount Card */}
        <Card style={{ alignItems: 'center', padding: spacing.xl }}>
          <View style={[styles.iconCircle, { backgroundColor: txColor + '20' }]}>
            <MaterialCommunityIcons name={txIcon} size={32} color={txColor} />
          </View>
          <Text style={[typography.h1, { color: txColor, fontSize: 36, fontWeight: 'bold', marginTop: spacing.md }]}>
            {getTransactionAmountPrefix(transaction.type)}{formatAmount(Number(transaction.amount))}
          </Text>
          <View style={[styles.typeBadge, { backgroundColor: txColor + '20', borderRadius: borderRadius.full, marginTop: spacing.sm }]}>
            <Text style={[typography.caption, { color: txColor, fontWeight: '600' }]}>
              {getTransactionTypeLabel(transaction.type)}
            </Text>
          </View>
        </Card>

        {/* Details Card */}
        <Card style={{ marginTop: spacing.lg, padding: spacing.lg }}>
          <DetailRow
            icon="text"
            label="Note"
            value={transaction.note}
            colors={colors}
            typography={typography}
            spacing={spacing}
          />
          <DetailRow
            icon="tag"
            label="Category"
            value={transaction.category || 'Uncategorized'}
            colors={colors}
            typography={typography}
            spacing={spacing}
          />
          <DetailRow
            icon="calendar"
            label="Date"
            value={formattedDate}
            colors={colors}
            typography={typography}
            spacing={spacing}
          />
          <DetailRow
            icon="clock-outline"
            label="Time"
            value={formattedTime}
            colors={colors}
            typography={typography}
            spacing={spacing}
            isLast
          />
        </Card>

        {/* Source Trace Card */}
        <Card style={{ marginTop: spacing.lg, padding: spacing.lg }}>
          <View style={[styles.sectionHeader, { marginBottom: spacing.md }]}>
            <MaterialCommunityIcons name="timeline-text-outline" size={22} color={colors.text} />
            <Text style={[typography.h3, { color: colors.text, marginLeft: spacing.sm }]}>
              Source Trace
            </Text>
          </View>

          <View
            style={[
              styles.sourceSummary,
              {
                backgroundColor: sourceTrace.color + '12',
                borderColor: sourceTrace.color + '40',
                borderRadius: borderRadius.sm,
                marginBottom: spacing.sm,
                padding: spacing.md,
              },
            ]}
          >
            <View style={styles.sourceSummaryHeader}>
              <View style={[styles.sourceIcon, { backgroundColor: sourceTrace.color + '20' }]}>
                <MaterialCommunityIcons name={sourceTrace.icon} size={22} color={sourceTrace.color} />
              </View>
              <View style={[styles.sourceText, { marginLeft: spacing.sm }]}>
                <Text style={[typography.bodyBold, { color: colors.text }]}>{sourceTrace.title}</Text>
                <Text style={[typography.caption, { color: colors.subtext, marginTop: spacing.xs }]}>
                  {sourceTrace.subtitle}
                </Text>
              </View>
            </View>
          </View>

          {traceRows.map((row, index) => (
            <DetailRow
              key={`${row.label}-${index}`}
              icon={row.icon}
              label={row.label}
              value={row.value}
              colors={colors}
              typography={typography}
              spacing={spacing}
              isLast={index === traceRows.length - 1}
            />
          ))}

          {rawMessage ? (
            <View style={{ marginTop: spacing.md, paddingTop: spacing.md, borderTopWidth: 1, borderTopColor: colors.border }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                  <MaterialCommunityIcons name="message-text-outline" size={20} color={colors.subtext} />
                  <Text style={[typography.caption, { color: colors.subtext, marginLeft: spacing.sm }]}>
                    {isRedactedRawMessage ? 'Message Metadata' : 'Raw Message'}
                  </Text>
                </View>
                <TouchableOpacity
                  onPress={() => {
                    HapticFeedback.trigger('impactLight', { enableVibrateFallback: true, ignoreAndroidSystemSettings: false });
                    setShowRawMessage(!showRawMessage);
                  }}
                  style={{
                    backgroundColor: colors.border + '50',
                    paddingHorizontal: 10,
                    paddingVertical: 4,
                    borderRadius: 6,
                  }}>
                  <Text style={[typography.caption, { color: colors.accent, fontWeight: '600' }]}>
                    {showRawMessage ? 'Hide' : 'Show'}
                  </Text>
                </TouchableOpacity>
              </View>
              {showRawMessage ? (
                <Text style={[typography.body, { color: colors.text, marginTop: spacing.sm, backgroundColor: colors.border + '20', padding: 8, borderRadius: 6 }]}>
                  {rawMessage}
                </Text>
              ) : (
                <Text style={[typography.caption, { color: colors.subtext, marginTop: spacing.xs, fontStyle: 'italic' }]}>
                  {isRedactedRawMessage
                    ? 'Stored as redacted metadata; full message is not retained.'
                    : 'Hidden for privacy (OTPs, accounts, etc. are redacted by default)'}
                </Text>
              )}
            </View>
          ) : null}
        </Card>

        {/* Delete Button */}
        <AppButton
          title="Delete Transaction"
          onPress={handleDelete}
          variant="secondary"
          fullWidth
          style={{ marginTop: spacing.xl, borderColor: colors.error, borderWidth: 1 }}
        />
      </View>

      <EditTransactionModal
        visible={isEditModalVisible}
        transaction={transaction}
        onClose={() => setIsEditModalVisible(false)}
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

interface DetailRowProps {
  icon: string;
  label: string;
  value: string;
  colors: ReturnType<typeof import('../../context/ThemeContext').useTheme>['colors'];
  typography: ReturnType<typeof import('../../context/ThemeContext').useTheme>['typography'];
  spacing: ReturnType<typeof import('../../context/ThemeContext').useTheme>['spacing'];
  isLast?: boolean;
}

function DetailRow({ icon, label, value, colors, typography, spacing, isLast = false }: DetailRowProps) {
  return (
    <View style={[
      styles.detailRow,
      !isLast && { borderBottomWidth: 1, borderBottomColor: colors.border },
      { paddingVertical: spacing.md }
    ]}>
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        <MaterialCommunityIcons name={icon} size={20} color={colors.subtext} />
        <Text style={[typography.caption, { color: colors.subtext, marginLeft: spacing.sm }]}>{label}</Text>
      </View>
      <Text style={[typography.body, { color: colors.text, marginTop: spacing.xs }]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  iconCircle: {
    width: 64,
    height: 64,
    borderRadius: 32,
    justifyContent: 'center',
    alignItems: 'center',
  },
  typeBadge: {
    paddingHorizontal: 16,
    paddingVertical: 4,
  },
  detailRow: {
    paddingVertical: 12,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  sourceSummary: {
    borderWidth: 1,
  },
  sourceSummaryHeader: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  sourceIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
  },
  sourceText: {
    flex: 1,
  },
});
