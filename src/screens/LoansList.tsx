import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  FlatList,
  ActivityIndicator,
  RefreshControl,
} from 'react-native';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import {
  getLoans,
  getDaysUntilEMI,
  getLoanProgress,
  getRemainingMonths,
  Loan,
} from '../lib/loans';
import { useTheme } from '../context/ThemeContext';

export default function LoansList() {
  const navigation = useNavigation();
  const { colors } = useTheme();
  const [loans, setLoans] = useState<Loan[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const loadLoans = async () => {
    try {
      const data = await getLoans();
      setLoans(data);
    } catch (error) {
      console.error('Error loading loans:', error);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useFocusEffect(
    useCallback(() => {
      loadLoans();
    }, [])
  );

  const onRefresh = () => {
    setRefreshing(true);
    loadLoans();
  };

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: 'INR',
      maximumFractionDigits: 0,
    }).format(amount);
  };

  const getLoanTypeColor = (type: string) => {
    const colors: { [key: string]: string } = {
      Home: '#10b981',
      Car: '#3b82f6',
      Personal: '#f59e0b',
      Education: '#8b5cf6',
      Other: '#6b7280',
    };
    return colors[type] || '#6b7280';
  };

  const renderLoan = ({ item }: { item: Loan }) => {
    const daysUntilEMI = getDaysUntilEMI(item.emi_due_date);
    const progress = getLoanProgress(item);
    const remainingMonths = getRemainingMonths(item);
    const isDueSoon = daysUntilEMI <= 5;

    return (
      <TouchableOpacity
        style={[styles.loanCard, { backgroundColor: colors.card }]}
        onPress={() => (navigation as any).navigate('LoanDetail', { loanId: item.id })}>
        <View style={styles.loanHeader}>
          <View style={styles.loanInfo}>
            <Text style={[styles.loanName, { color: colors.text }]}>{item.loan_name}</Text>
            <Text style={[styles.lenderName, { color: colors.accent }]}>{item.lender_name}</Text>
          </View>
          <View style={[styles.typeBadge, { backgroundColor: getLoanTypeColor(item.loan_type) }]}>
            <Text style={styles.typeBadgeText}>{item.loan_type}</Text>
          </View>
        </View>

        <View style={styles.loanBody}>
          <View style={styles.amountRow}>
            <View>
              <Text style={[styles.label, { color: colors.subtext }]}>Outstanding</Text>
              <Text style={[styles.outstanding, { color: colors.text }]}>{formatCurrency(item.current_outstanding)}</Text>
            </View>
            <View style={styles.emiInfo}>
              <Text style={[styles.label, { color: colors.subtext }]}>EMI</Text>
              <Text style={styles.emiAmount}>{formatCurrency(item.emi_amount)}</Text>
            </View>
          </View>

          <View style={styles.progressContainer}>
            <View style={styles.progressBar}>
              <View style={[styles.progressFill, { width: `${progress}%` }]} />
            </View>
            <Text style={styles.progressText}>{progress.toFixed(0)}% paid</Text>
          </View>

          <View style={styles.statsRow}>
            <View style={styles.stat}>
              <Text style={[styles.statLabel, { color: colors.subtext }]}>Remaining</Text>
              <Text style={[styles.statValue, { color: colors.text }]}>{remainingMonths} months</Text>
            </View>
            <View style={styles.stat}>
              <Text style={[styles.statLabel, { color: colors.subtext }]}>Total</Text>
              <Text style={[styles.statValue, { color: colors.text }]}>{formatCurrency(item.principal_amount)}</Text>
            </View>
          </View>
        </View>

        <View style={[styles.loanFooter, isDueSoon && styles.loanFooterUrgent]}>
          <Text style={[styles.dueText, { color: colors.subtext }, isDueSoon && styles.dueTextUrgent]}>
            Next EMI in {daysUntilEMI} day{daysUntilEMI !== 1 ? 's' : ''} (Day {item.emi_due_date})
          </Text>
        </View>
      </TouchableOpacity>
    );
  };

  if (loading) {
    return (
      <View style={[styles.loadingContainer, { backgroundColor: colors.background }]}>
        <ActivityIndicator size="large" color={colors.accent} />
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={styles.header}>
        <Text style={[styles.title, { color: colors.text }]}>Loans & EMIs</Text>
        <TouchableOpacity
          style={[styles.addButton, { backgroundColor: colors.accent }]}
          onPress={() => (navigation as any).navigate('AddLoan')}>
          <Text style={styles.addButtonText}>+ Add Loan</Text>
        </TouchableOpacity>
      </View>

      {loans.length === 0 ? (
        <View style={styles.emptyState}>
          <Text style={styles.emptyIcon}>🏦</Text>
          <Text style={[styles.emptyText, { color: colors.text }]}>No loans added</Text>
          <Text style={[styles.emptySubtext, { color: colors.subtext }]}>
            Track your loans and EMI payments in one place
          </Text>
          <TouchableOpacity
            style={[styles.primaryButton, { backgroundColor: colors.accent }]}
            onPress={() => (navigation as any).navigate('AddLoan')}>
            <Text style={styles.primaryButtonText}>Add Your First Loan</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          data={loans}
          renderItem={renderLoan}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.listContainer}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[colors.accent]} />
          }
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 20,
    paddingBottom: 10,
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
  },
  addButton: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
  },
  addButtonText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  listContainer: {
    padding: 20,
    paddingTop: 10,
  },
  loanCard: {
    borderRadius: 16,
    marginBottom: 16,
    overflow: 'hidden',
  },
  loanHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    padding: 16,
    paddingBottom: 12,
  },
  loanInfo: {
    flex: 1,
  },
  loanName: {
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 4,
  },
  lenderName: {
    fontSize: 14,
  },
  typeBadge: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 12,
  },
  typeBadgeText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#fff',
  },
  loanBody: {
    padding: 16,
    paddingTop: 0,
  },
  amountRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  label: {
    fontSize: 12,
    marginBottom: 4,
  },
  outstanding: {
    fontSize: 24,
    fontWeight: 'bold',
  },
  emiInfo: {
    alignItems: 'flex-end',
  },
  emiAmount: {
    fontSize: 20,
    fontWeight: '600',
    color: '#f59e0b',
  },
  progressContainer: {
    marginBottom: 16,
  },
  progressBar: {
    height: 6,
    backgroundColor: '#2a2a3d',
    borderRadius: 3,
    marginBottom: 8,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: '#10b981',
    borderRadius: 3,
  },
  progressText: {
    fontSize: 12,
    color: '#10b981',
    textAlign: 'right',
  },
  statsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  stat: {
    flex: 1,
  },
  statLabel: {
    fontSize: 12,
    marginBottom: 4,
  },
  statValue: {
    fontSize: 14,
    fontWeight: '600',
  },
  loanFooter: {
    backgroundColor: '#2a2a3d',
    padding: 12,
    alignItems: 'center',
  },
  loanFooterUrgent: {
    backgroundColor: '#ef4444',
  },
  dueText: {
    fontSize: 14,
    fontWeight: '600',
  },
  dueTextUrgent: {
    color: '#fff',
  },
  emptyState: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 40,
  },
  emptyIcon: {
    fontSize: 64,
    marginBottom: 16,
  },
  emptyText: {
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 8,
  },
  emptySubtext: {
    fontSize: 14,
    textAlign: 'center',
    marginBottom: 32,
  },
  primaryButton: {
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 12,
  },
  primaryButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
});
