import React, { useState, useEffect, useRef, useCallback } from 'react';
import { View, Text, StyleSheet, ActivityIndicator } from 'react-native';
import { RouteProp } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';
import Toast from 'react-native-toast-message';
import HapticFeedback from 'react-native-haptic-feedback';
import { supabase, deleteTransaction, updateTransaction } from '../../lib/core';
import { BankAccount, Transaction, TransactionEvidence } from '../../types';
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
import { getUpiProviderName, maskUpiId } from '../../utils/upi';
import { getBankAccounts } from '../../lib/database/financial';
import { CACHE_KEYS, getCached, setCache, updateCache } from '../../lib/services/cache';
import { isRedactedRawTextRecord, sanitizeTransactionRawSmsForPrivacy } from '../../lib/privacy/rawText';
import { getEvidenceForTransaction } from '../../lib/services/transactionEvidence';

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

function safeDisplayText(value?: string | null, maxLength = 96): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;

  if (
    /\b(?:otp|one\s*time\s*password|verification\s*code|security\s*code)\b/i.test(trimmed) ||
    /\b(?:\+?91[-\s]?)?[6-9]\d{9}\b/.test(trimmed) ||
    /\b(?:address|flat|tower|road|street|society|sector|near|landmark|pincode|pin code)\b/i.test(trimmed) ||
    /\b\d(?:[ -]?\d){11,}\b/.test(trimmed)
  ) {
    return null;
  }

  const cleaned = trimmed
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\s+/g, ' ')
    .slice(0, maxLength);
  return cleaned || null;
}

function safePackageName(value?: string | null): string | null {
  const trimmed = value?.trim();
  if (!trimmed || !/^[A-Za-z0-9._-]{2,96}$/.test(trimmed)) return null;
  return trimmed;
}

function safeReferenceNumber(value?: string | null): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  const cleaned = trimmed.replace(/[^A-Za-z0-9_-]+/g, '').slice(0, 64);
  return cleaned || null;
}

function safeLast4(value?: string | null): string | null {
  const digits = (value || '').replace(/\D/g, '');
  return digits.length === 4 ? digits : null;
}

function maskedOwnerLabel(last4?: string | null): string | null {
  const digits = safeLast4(last4);
  return digits ? `••${digits}` : null;
}

function formatOwnerLabel(name?: string | null, last4?: string | null): string | null {
  const safeName = safeDisplayText(name, 64);
  const masked = maskedOwnerLabel(last4);
  if (safeName && masked) return `${safeName} ${masked}`;
  if (safeName) return safeName;
  return masked ? `Account ${masked}` : null;
}

function safeMaskedUpi(value?: string | null): string | null {
  const trimmed = value?.trim();
  if (!trimmed || !trimmed.includes('@')) return null;
  if (/\b(?:\+?91[-\s]?)?[6-9]\d{9}\b/.test(trimmed)) return maskUpiId(trimmed);
  if (trimmed.includes('*')) {
    return trimmed.replace(/[^A-Za-z0-9._*@-]+/g, '').slice(0, 80) || null;
  }
  return maskUpiId(trimmed);
}

function formatSourceType(value?: string | null): string {
  if (value === 'sms') return 'SMS';
  if (value === 'notification') return 'Notification';
  if (value === 'manual') return 'Manual';
  if (value === 'accessibility') return 'Accessibility';
  if (value === 'imported') return 'Imported';
  if (value === 'upi') return 'Notification';
  if (value === 'bank') return 'SMS';
  return 'Automatic';
}

function formatDirection(transaction: Transaction, evidence?: TransactionEvidence | null): string {
  const direction = evidence?.direction;
  if (direction === 'credit') return 'Credit';
  if (direction === 'debit') return 'Debit';
  if (direction === 'transfer') return 'Transfer';
  if (transaction.type === 'income') return 'Credit';
  if (transaction.type === 'expense') return 'Debit';
  if (transaction.type === 'transfer') return 'Transfer';
  return toTitleCase(transaction.type);
}

function formatInstrument(value?: string | null): string {
  switch (value) {
    case 'bank_account':
      return 'Bank account';
    case 'credit_card':
      return 'Credit card';
    case 'debit_card':
      return 'Debit card';
    case 'wallet':
      return 'Wallet';
    case 'loan':
      return 'Loan';
    default:
      return 'Unknown';
  }
}

function formatMatchStatus(transaction: Transaction, evidence?: TransactionEvidence | null): string | null {
  const status = transaction.account_match_status || evidence?.match_status || null;
  if (!status) return null;
  return toTitleCase(status);
}

function formatMatchConfidence(transaction: Transaction, evidence?: TransactionEvidence | null): string | null {
  const confidence = transaction.account_match_confidence || evidence?.confidence_level || null;
  if (!confidence) return null;
  return toTitleCase(confidence);
}

function dashboardStatus(transaction: Transaction): string {
  if (transaction.account_match_status === 'review_required') return 'Not counted: needs review';
  if (transaction.is_transfer_pending) return 'Not counted: waiting for matching transfer';
  if (transaction.type === 'income') return 'Counted as income';
  if (transaction.type === 'expense') return 'Counted as expense';
  if (transaction.type === 'transfer') return 'Not counted: personal transfer';
  if (transaction.type === 'refund') return 'Counted as refund adjustment';
  return `Counted as ${getTransactionTypeLabel(transaction.type).toLowerCase()}`;
}

function selectPrimaryEvidence(
  transaction: Transaction,
  evidenceRows: TransactionEvidence[]
): TransactionEvidence | null {
  if (transaction.primary_evidence_id) {
    const primary = evidenceRows.find(row => row.id === transaction.primary_evidence_id);
    if (primary) return primary;
  }
  return evidenceRows[0] || null;
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
  if (normalized.includes('super.money') || normalized.includes('superm') || normalized.includes('money.super') || normalized.includes('super')) return 'Super.money';
  if (normalized.includes('slice') || normalized.includes('slce')) return 'slice';

  return null;
}

function formatSender(sender?: string | null): string | null {
  const trimmed = sender?.trim();
  if (!trimmed) return null;
  const safeSender = safeDisplayText(trimmed, 64);
  if (!safeSender) return null;

  const knownName = getKnownSenderName(safeSender);
  if (knownName) {
    return `${knownName} (${safeSender})`;
  }

  return safeSender;
}

function getSourceAppLabel(evidence?: TransactionEvidence | null, transaction?: Transaction | null): string | null {
  const explicit = safeDisplayText(evidence?.source_app, 64);
  if (explicit) return explicit;

  const packageName = safePackageName(evidence?.source_package);
  if (packageName) return getKnownSenderName(packageName) || packageName;

  return getKnownSenderName(transaction?.sms_sender) || null;
}

function getEntrySourceTrace(
  transaction: Transaction,
  evidence: TransactionEvidence | null,
  accountLabel: string | null,
  colors: ThemeColors
): SourceTrace {
  const evidenceSource = evidence?.source_type;
  const transactionSource = transaction.sms_source?.toLowerCase();
  const source = evidenceSource || transactionSource;
  const sourceApp = getSourceAppLabel(evidence, transaction);
  const senderName = getKnownSenderName(transaction.sms_sender);
  const evidenceBank = safeDisplayText(evidence?.bank_name, 64);

  if (!source || source === 'manual') {
    return {
      icon: 'pencil-circle',
      title: 'Manual Entry',
      subtitle: accountLabel ? `Added manually for ${accountLabel}` : 'Added manually in the app',
      color: colors.accent,
    };
  }

  if (source === 'sms' || source === 'bank') {
    const sourceName = senderName || evidenceBank || accountLabel || 'SMS source';
    return {
      icon: 'message-text-clock',
      title: `SMS from ${sourceName}`,
      subtitle: accountLabel ? `Matched account: ${accountLabel}` : 'Captured from a bank message',
      color: colors.info,
    };
  }

  if (source === 'notification' || source === 'upi') {
    const sourceName = sourceApp || 'Notification source';
    const packageName = safePackageName(evidence?.source_package);
    return {
      icon: 'cellphone-message',
      title: `Notification from ${sourceName}`,
      subtitle: packageName ? `Package: ${packageName}` : 'Captured from a payment app notification',
      color: colors.success,
    };
  }

  return {
    icon: 'radar',
    title: `${toTitleCase(source)} Entry`,
    subtitle: sourceApp ? `Captured from ${sourceApp}` : 'Captured automatically',
    color: colors.warning,
  };
}

export default function TransactionDetail({ route, navigation }: Props) {
  const { transactionId } = route.params || {};
  const { colors, typography, spacing, borderRadius } = useTheme();
  const [transaction, setTransaction] = useState<Transaction | null>(null);
  const [bankName, setBankName] = useState<string | null>(null);
  const [transactionEvidence, setTransactionEvidence] = useState<TransactionEvidence[]>([]);
  const [loading, setLoading] = useState(true);
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
      setBankName(formatOwnerLabel(null, tx.account_last4));
      return;
    }

    const cachedBanks = await getCached<BankAccount[]>(CACHE_KEYS.BANK_ACCOUNTS);
    const bank = cachedBanks?.data.find(account => account.id === tx.account_id);
    if (bank && isMountedRef.current) {
      setBankName(formatOwnerLabel(bank.bank_name, bank.account_last4));
    }
  }, []);

  const loadTransaction = useCallback(async () => {
    let hasCachedTransaction = false;

    try {
      setTransactionEvidence([]);
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
          setBankName(formatOwnerLabel(bankData.bank_name, bankData.account_last4));
        }
      } else if (isMountedRef.current) {
        setBankName(formatOwnerLabel(null, safeTransaction.account_last4));
      }

      try {
        const evidence = await getEvidenceForTransaction(safeTransaction.id);
        if (isMountedRef.current) {
          setTransactionEvidence(evidence);
        }
      } catch {
        if (isMountedRef.current) {
          setTransactionEvidence([]);
        }
        console.warn('[TransactionDetail] Source evidence unavailable');
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
  const primaryEvidence = selectPrimaryEvidence(transaction, transactionEvidence);
  const evidenceLast4 = primaryEvidence?.account_last4 || primaryEvidence?.card_last4 || null;
  const evidenceAccountLabel = formatOwnerLabel(primaryEvidence?.bank_name, evidenceLast4);
  const accountLabel = evidenceAccountLabel || bankName || formatOwnerLabel(null, transaction.account_last4);
  const sourceTrace = getEntrySourceTrace(transaction, primaryEvidence, accountLabel, colors);
  const sourcePackage = safePackageName(primaryEvidence?.source_package);
  const senderLabel = formatSender(primaryEvidence?.sender || transaction.sms_sender);
  const rawMessage = transaction.raw_sms?.trim();
  const isRedactedRawMessage = isRedactedRawTextRecord(rawMessage);
  const sourceApp = getSourceAppLabel(primaryEvidence, transaction);
  const maskedUpi = safeMaskedUpi(primaryEvidence?.upi_id_masked) || safeMaskedUpi(transaction.upi_id);
  const upiProvider = getUpiProviderName(maskedUpi || transaction.upi_id);
  const balanceAfter = transaction.balance !== null && transaction.balance !== undefined
    ? formatAmount(Number(transaction.balance))
    : null;
  const savedAt = new Date(transaction.created_at).toLocaleString();
  const sourceType = primaryEvidence?.source_type || transaction.sms_source || 'manual';
  const matchStatus = formatMatchStatus(transaction, primaryEvidence);
  const matchConfidence = formatMatchConfidence(transaction, primaryEvidence);
  const matchReason = safeDisplayText(transaction.account_match_reason || primaryEvidence?.match_reason_code, 64);
  const referenceNumber = safeReferenceNumber(primaryEvidence?.reference_number || transaction.reference_number);
  const amountFromEvidence = primaryEvidence?.amount != null
    ? formatAmount(Number(primaryEvidence.amount))
    : formatAmount(Number(transaction.amount));
  const traceRows = [
    { icon: 'radar', label: 'Source type', value: formatSourceType(sourceType) },
    sourceApp ? { icon: 'cellphone', label: 'Source app', value: sourceApp } : null,
    sourcePackage ? { icon: 'package-variant-closed', label: 'Package', value: sourcePackage } : null,
    senderLabel ? { icon: 'account-voice', label: 'Sender', value: senderLabel } : null,
    accountLabel ? { icon: 'bank', label: 'Matched Account', value: accountLabel } : null,
    matchStatus ? { icon: 'link-variant', label: 'Match status', value: matchStatus } : null,
    matchConfidence ? { icon: 'speedometer', label: 'Match confidence', value: matchConfidence } : null,
    matchReason ? { icon: 'text-box-check-outline', label: 'Match reason', value: matchReason } : null,
    { icon: 'swap-vertical', label: 'Direction', value: formatDirection(transaction, primaryEvidence) },
    { icon: 'cash-multiple', label: 'Amount', value: amountFromEvidence },
    { icon: 'credit-card-outline', label: 'Instrument', value: formatInstrument(primaryEvidence?.instrument_hint) },
    referenceNumber ? { icon: 'identifier', label: 'Ref / UTR', value: referenceNumber } : null,
    maskedUpi ? { icon: 'qrcode', label: 'UPI', value: maskedUpi } : null,
    upiProvider ? { icon: 'cellphone-link', label: 'UPI provider', value: upiProvider } : null,
    balanceAfter ? { icon: 'wallet-outline', label: 'Balance After', value: balanceAfter } : null,
    transaction.is_transfer_pending
      ? { icon: 'swap-horizontal-circle-outline', label: 'Transfer Status', value: 'Waiting for matching transfer entry' }
      : null,
    { icon: 'view-dashboard-outline', label: 'Dashboard status', value: dashboardStatus(transaction) },
    { icon: 'clock-check-outline', label: 'Saved At', value: savedAt },
    { icon: 'identifier', label: 'Record ID', value: transaction.id },
    isRedactedRawMessage ? { icon: 'message-lock-outline', label: 'Message metadata', value: 'Redacted metadata only' } : null,
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
