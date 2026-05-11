import React, { useState, useCallback, useRef } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  FlatList,
  ActivityIndicator,
  RefreshControl,
  InteractionManager,
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
import { ScreenWrapper, AppHeader, Card, AppButton } from '../components';

export default function LoansList() {
  const navigation = useNavigation();
  const { colors, typography, spacing, borderRadius } = useTheme();
  const [loans, setLoans] = useState<Loan[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const lastDataStringRef = useRef<string | null>(null);

  const loadLoans = async () => {
    try {
      const data = await getLoans();
      const dataStr = JSON.stringify(data);
      
      if (lastDataStringRef.current !== dataStr) {
        lastDataStringRef.current = dataStr;
        setLoans(data);
      }
    } catch (error) {
      console.error('Error loading loans:', error);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useFocusEffect(
    useCallback(() => {
      const task = InteractionManager.runAfterInteractions(() => {
        loadLoans();
      });
      return () => task.cancel();
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
        onPress={() => (navigation as any).navigate('LoanDetail', { loanId: item.id })}>
        <Card style={{ marginBottom: spacing.md }}>
          <View style={[styles.loanHeader, { padding: spacing.md }]}>
            <View style={styles.loanInfo}>
              <Text style={[typography.h3, { color: colors.text, marginBottom: spacing.xs }]}>{item.loan_name}</Text>
              <Text style={[typography.body, { color: colors.accent }]}>{item.lender_name}</Text>
            </View>
            <View style={[styles.typeBadge, { backgroundColor: getLoanTypeColor(item.loan_type), borderRadius: borderRadius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.sm }]}>
              <Text style={[typography.caption, { color: '#fff' }]}>{item.loan_type}</Text>
            </View>
          </View>

          <View style={{ padding: spacing.md, paddingTop: 0 }}>
            <View style={styles.amountRow}>
              <View>
                <Text style={[typography.caption, { color: colors.subtext, marginBottom: spacing.xs }]}>Outstanding</Text>
                <Text style={[typography.h2, { color: colors.text }]}>{formatCurrency(item.current_outstanding)}</Text>
              </View>
              <View style={styles.emiInfo}>
                <Text style={[typography.caption, { color: colors.subtext, marginBottom: spacing.xs }]}>EMI</Text>
                <Text style={[typography.h3, { color: '#f59e0b' }]}>{formatCurrency(item.emi_amount)}</Text>
              </View>
            </View>

            <View style={{ marginBottom: spacing.md }}>
              <View style={[styles.progressBar, { backgroundColor: colors.border, borderRadius: borderRadius.sm, marginBottom: spacing.sm }]}>
                <View style={[styles.progressFill, { width: `${progress}%`, backgroundColor: colors.success, borderRadius: borderRadius.sm }]} />
              </View>
              <Text style={[typography.caption, { color: colors.success, textAlign: 'right' }]}>{progress.toFixed(0)}% paid</Text>
            </View>

            <View style={styles.statsRow}>
              <View style={styles.stat}>
                <Text style={[typography.caption, { color: colors.subtext, marginBottom: spacing.xs }]}>Remaining</Text>
                <Text style={[typography.caption, { color: colors.text }]}>{remainingMonths} months</Text>
              </View>
              <View style={styles.stat}>
                <Text style={[typography.caption, { color: colors.subtext, marginBottom: spacing.xs }]}>Total</Text>
                <Text style={[typography.caption, { color: colors.text }]}>{formatCurrency(item.principal_amount)}</Text>
              </View>
            </View>
          </View>

          <View style={[styles.loanFooter, { backgroundColor: colors.border, padding: spacing.md }, isDueSoon && { backgroundColor: colors.error }]}>
            <Text style={[typography.caption, { color: colors.subtext }, isDueSoon && { color: '#fff' }]}>
              Next EMI in {daysUntilEMI} day{daysUntilEMI !== 1 ? 's' : ''} (Day {item.emi_due_date})
            </Text>
          </View>
        </Card>
      </TouchableOpacity>
    );
  };

  if (loading) {
    return (
      <ScreenWrapper>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={colors.accent} />
        </View>
      </ScreenWrapper>
    );
  }

  return (
    <ScreenWrapper>
      <AppHeader 
        title="Loans & EMIs"
        rightAction={{ icon: 'plus', onPress: () => (navigation as any).navigate('AddLoan') }}
      />

      {loans.length === 0 ? (
        <View style={styles.emptyState}>
          <Text style={styles.emptyIcon}>🏦</Text>
          <Text style={[typography.h3, { color: colors.text, marginBottom: spacing.sm }]}>No loans added</Text>
          <Text style={[typography.caption, { color: colors.subtext, textAlign: 'center', marginBottom: spacing.xl }]}>
            Track your loans and EMI payments in one place
          </Text>
          <AppButton
            title="Add Your First Loan"
            onPress={() => (navigation as any).navigate('AddLoan')}
          />
        </View>
      ) : (
        <FlatList
          data={loans}
          renderItem={renderLoan}
          keyExtractor={(item) => item.id}
          contentContainerStyle={{ padding: spacing.lg }}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[colors.accent]} />
          }
        />
      )}
    </ScreenWrapper>
  );
}

const styles = StyleSheet.create({
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loanHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  loanInfo: {
    flex: 1,
  },
  typeBadge: {},
  amountRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  emiInfo: {
    alignItems: 'flex-end',
  },
  progressBar: {
    height: 6,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
  },
  statsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  stat: {
    flex: 1,
  },
  loanFooter: {
    alignItems: 'center',
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
});
