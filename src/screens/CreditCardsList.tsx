import React, { useState, useCallback } from 'react';
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
  getCreditCards,
  getDaysUntilDue,
  getAvailableCredit,
  getCreditUtilization,
  CreditCard,
} from '../lib/creditCards';
import { useTheme } from '../context/ThemeContext';
import { ScreenWrapper, AppHeader, Card, AppButton } from '../components';

export default function CreditCardsList() {
  const navigation = useNavigation();
  const { colors, typography, spacing, borderRadius } = useTheme();
  const [cards, setCards] = useState<CreditCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const loadCards = async () => {
    try {
      const data = await getCreditCards();
      setCards(data);
    } catch (error) {
      console.error('Error loading cards:', error);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useFocusEffect(
    useCallback(() => {
      const task = InteractionManager.runAfterInteractions(() => {
        loadCards();
      });
      return () => task.cancel();
    }, [])
  );

  const onRefresh = () => {
    setRefreshing(true);
    loadCards();
  };

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: 'INR',
      maximumFractionDigits: 0,
    }).format(amount);
  };

  const renderCard = ({ item }: { item: CreditCard }) => {
    const daysUntilDue = getDaysUntilDue(item.due_date);
    const availableCredit = getAvailableCredit(item);
    const utilization = getCreditUtilization(item);
    const isHighUtilization = utilization > 50;
    const isDueSoon = daysUntilDue <= 5;

    return (
      <TouchableOpacity
        onPress={() => (navigation as any).navigate('CreditCardDetail', { cardId: item.id })}>
        <Card style={{ marginBottom: spacing.md }}>
          <View style={[styles.cardHeader, { padding: spacing.md }]}>
            <View>
              <Text style={[typography.h3, { color: colors.text, marginBottom: spacing.xs }]}>{item.bank_name}</Text>
              {item.card_name && (
                <Text style={[typography.caption, { color: colors.subtext, marginBottom: spacing.xs }]}>{item.card_name}</Text>
              )}
              <Text style={[typography.body, { color: colors.accent }]}>•••• {item.last_4_digits}</Text>
            </View>
            <View style={[styles.utilizationBadge, { backgroundColor: colors.background, borderRadius: borderRadius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.sm }]}>
              <Text style={[typography.caption, { color: colors.accent }]}>{utilization.toFixed(0)}%</Text>
            </View>
          </View>

          <View style={{ padding: spacing.md, paddingTop: 0 }}>
            <View style={styles.amountRow}>
              <Text style={[typography.caption, { color: colors.subtext }]}>Outstanding</Text>
              <Text style={[typography.h2, { color: colors.text }, isHighUtilization && { color: colors.error }]}>
                {formatCurrency(item.current_outstanding)}
              </Text>
            </View>

            <View style={[styles.progressBar, { backgroundColor: colors.border, borderRadius: borderRadius.sm, marginBottom: spacing.md }]}>
              <View
                style={[
                  styles.progressFill,
                  { width: `${Math.min(utilization, 100)}%`, backgroundColor: colors.accent, borderRadius: borderRadius.sm },
                  isHighUtilization && { backgroundColor: colors.error },
                ]}
              />
            </View>

            <View style={styles.statsRow}>
              <View style={styles.stat}>
                <Text style={[typography.caption, { color: colors.subtext, marginBottom: spacing.xs }]}>Available</Text>
                <Text style={[typography.body, { color: colors.text }]}>{formatCurrency(availableCredit)}</Text>
              </View>
              <View style={styles.stat}>
                <Text style={[typography.caption, { color: colors.subtext, marginBottom: spacing.xs }]}>Limit</Text>
                <Text style={[typography.body, { color: colors.text }]}>{formatCurrency(item.credit_limit)}</Text>
              </View>
            </View>
          </View>

          <View style={[styles.cardFooter, { backgroundColor: colors.border, padding: spacing.md }, isDueSoon && { backgroundColor: colors.error }]}>
            <Text style={[typography.caption, { color: colors.subtext }, isDueSoon && { color: '#fff' }]}>
              Due in {daysUntilDue} day{daysUntilDue !== 1 ? 's' : ''} (Day {item.due_date})
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
        title="Credit Cards"
        rightAction={{ icon: 'plus', onPress: () => (navigation as any).navigate('AddCreditCard') }}
      />

      {cards.length === 0 ? (
        <View style={styles.emptyState}>
          <Text style={styles.emptyIcon}>💳</Text>
          <Text style={[typography.h3, { color: colors.text, marginBottom: spacing.sm }]}>No credit cards added</Text>
          <Text style={[typography.caption, { color: colors.subtext, textAlign: 'center', marginBottom: spacing.xl }]}>
            Add your credit cards to track spending and due dates
          </Text>
          <AppButton
            title="Add Your First Card"
            onPress={() => (navigation as any).navigate('AddCreditCard')}
          />
        </View>
      ) : (
        <FlatList
          data={cards}
          renderItem={renderCard}
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
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  utilizationBadge: {},
  amountRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
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
  cardFooter: {
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
