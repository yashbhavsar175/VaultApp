import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, ActivityIndicator, Alert } from 'react-native';
import { RouteProp } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';
import Toast from 'react-native-toast-message';
import { supabase } from '../lib/supabase';
import { deleteTransaction, updateTransaction } from '../lib/db';
import { Transaction } from '../types';
import { useTheme } from '../context/ThemeContext';
import { ScreenWrapper, Card, AppHeader, AppButton } from '../components';
import EditTransactionModal from '../components/ui/EditTransactionModal';
import AppConfirmModal from '../components/ui/AppConfirmModal';

type TransactionDetailRouteProp = RouteProp<
  { TransactionDetail: { transactionId: string } },
  'TransactionDetail'
>;

type TransactionDetailNavigationProp = StackNavigationProp<any, 'TransactionDetail'>;

interface Props {
  route: TransactionDetailRouteProp;
  navigation: TransactionDetailNavigationProp;
}

export default function TransactionDetail({ route, navigation }: Props) {
  const { transactionId } = route.params || {};
  const { colors, typography, spacing, borderRadius } = useTheme();
  const [transaction, setTransaction] = useState<Transaction | null>(null);
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

  useEffect(() => {
    loadTransaction();
  }, [transactionId]);

  const loadTransaction = async () => {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('transactions')
        .select('*')
        .eq('id', transactionId)
        .single();

      if (error) throw error;
      setTransaction(data);
    } catch (error) {
      console.error('Error loading transaction:', error);
      Toast.show({
        type: 'error',
        text1: 'Error',
        text2: 'Failed to load transaction details',
      });
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = () => {
    if (!transaction) return;
    setConfirmDialog({
      visible: true,
      title: 'Delete Transaction',
      message: `Delete "${transaction.note}"? This action cannot be undone.`,
      confirmText: 'Delete',
      isDestructive: true,
      onConfirm: async () => {
        // Dismiss dialog and navigate back immediately for a faster feel
        setConfirmDialog(null);
        navigation.goBack();
        try {
          await deleteTransaction(transaction.id);
          Toast.show({
            type: 'success',
            text1: 'Deleted',
            text2: 'Transaction deleted successfully',
          });
        } catch (error) {
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
      await updateTransaction(id, updates);
      Toast.show({
        type: 'success',
        text1: 'Updated',
        text2: 'Transaction updated successfully',
      });
      setIsEditModalVisible(false);
      loadTransaction(); // Reload to show new data
    } catch (error) {
      Toast.show({
        type: 'error',
        text1: 'Error',
        text2: 'Failed to update transaction',
      });
    }
  };

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
      case 'investment': return '#7c3aed';
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
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    });
  };

  const formatTime = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleTimeString('en-IN', {
      hour: '2-digit',
      minute: '2-digit',
    });
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
            {transaction.type === 'income' ? '+' : '-'}{formatAmount(Number(transaction.amount))}
          </Text>
          <View style={[styles.typeBadge, { backgroundColor: txColor + '20', borderRadius: borderRadius.full, marginTop: spacing.sm }]}>
            <Text style={[typography.caption, { color: txColor, fontWeight: '600' }]}>
              {transaction.type.charAt(0).toUpperCase() + transaction.type.slice(1)}
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
            value={formatDate(transaction.created_at)}
            colors={colors}
            typography={typography}
            spacing={spacing}
          />
          <DetailRow
            icon="clock-outline"
            label="Time"
            value={formatTime(transaction.created_at)}
            colors={colors}
            typography={typography}
            spacing={spacing}
          />
          <DetailRow
            icon="radar"
            label="Tracked Via"
            value={(() => {
              if (!transaction.sms_source) return 'Manual Entry';
              
              const source = transaction.sms_source.toLowerCase();
              let sender = transaction.sms_sender || '';
              
              // Map package names to readable names
              if (sender.includes('nbu.paisa.user')) sender = 'Google Pay';
              else if (sender.includes('phonepe')) sender = 'PhonePe';
              else if (sender.includes('paytm')) sender = 'Paytm';
              else if (sender.includes('whatsapp')) sender = 'WhatsApp';
              else if (sender.includes('cred')) sender = 'CRED';
              else if (sender.includes('gmail')) sender = 'Gmail';
              else if (sender.length > 0) sender = sender.replace('com.', '').split('.')[0];
              
              if (source === 'notification' || source === 'sms' || source === 'mail' || source === 'bank' || source === 'upi') {
                const sourceCap = source.charAt(0).toUpperCase() + source.slice(1);
                return sender ? `${sourceCap} (${sender})` : sourceCap;
              }
              
              return transaction.sms_source.charAt(0).toUpperCase() + transaction.sms_source.slice(1);
            })()}
            colors={colors}
            typography={typography}
            spacing={spacing}
            isLast
          />
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

function DetailRow({ icon, label, value, colors, typography, spacing, isLast = false }: any) {
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
});
