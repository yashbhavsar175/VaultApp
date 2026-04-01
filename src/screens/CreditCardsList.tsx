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
  getCreditCards,
  getDaysUntilDue,
  getAvailableCredit,
  getCreditUtilization,
  CreditCard,
} from '../lib/creditCards';
import { useTheme } from '../context/ThemeContext';

export default function CreditCardsList() {
  const navigation = useNavigation();
  const { colors } = useTheme();
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
      loadCards();
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
        style={[styles.card, { backgroundColor: colors.card }]}
        onPress={() => (navigation as any).navigate('CreditCardDetail', { cardId: item.id })}>
        <View style={styles.cardHeader}>
          <View>
            <Text style={[styles.bankName, { color: colors.text }]}>{item.bank_name}</Text>
            {item.card_name && (
              <Text style={[styles.cardName, { color: colors.subtext }]}>{item.card_name}</Text>
            )}
            <Text style={[styles.cardNumber, { color: colors.accent }]}>•••• {item.last_4_digits}</Text>
          </View>
          <View style={[styles.utilizationBadge, { backgroundColor: colors.background }]}>
            <Text style={[styles.utilizationText, { color: colors.accent }]}>{utilization.toFixed(0)}%</Text>
          </View>
        </View>

        <View style={styles.cardBody}>
          <View style={styles.amountRow}>
            <Text style={[styles.label, { color: colors.subtext }]}>Outstanding</Text>
            <Text style={[styles.outstanding, { color: colors.text }, isHighUtilization && styles.highOutstanding]}>
              {formatCurrency(item.current_outstanding)}
            </Text>
          </View>

          <View style={styles.progressBar}>
            <View
              style={[
                styles.progressFill,
                { width: `${Math.min(utilization, 100)}%`, backgroundColor: colors.accent },
                isHighUtilization && styles.progressFillHigh,
              ]}
            />
          </View>

          <View style={styles.statsRow}>
            <View style={styles.stat}>
              <Text style={[styles.statLabel, { color: colors.subtext }]}>Available</Text>
              <Text style={[styles.statValue, { color: colors.text }]}>{formatCurrency(availableCredit)}</Text>
            </View>
            <View style={styles.stat}>
              <Text style={[styles.statLabel, { color: colors.subtext }]}>Limit</Text>
              <Text style={[styles.statValue, { color: colors.text }]}>{formatCurrency(item.credit_limit)}</Text>
            </View>
          </View>
        </View>

        <View style={[styles.cardFooter, isDueSoon && styles.cardFooterUrgent]}>
          <Text style={[styles.dueText, { color: colors.subtext }, isDueSoon && styles.dueTextUrgent]}>
            Due in {daysUntilDue} day{daysUntilDue !== 1 ? 's' : ''} (Day {item.due_date})
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
        <Text style={[styles.title, { color: colors.text }]}>Credit Cards</Text>
        <TouchableOpacity
          style={[styles.addButton, { backgroundColor: colors.accent }]}
          onPress={() => (navigation as any).navigate('AddCreditCard')}>
          <Text style={styles.addButtonText}>+ Add Card</Text>
        </TouchableOpacity>
      </View>

      {cards.length === 0 ? (
        <View style={styles.emptyState}>
          <Text style={styles.emptyIcon}>💳</Text>
          <Text style={[styles.emptyText, { color: colors.text }]}>No credit cards added</Text>
          <Text style={[styles.emptySubtext, { color: colors.subtext }]}>
            Add your credit cards to track spending and due dates
          </Text>
          <TouchableOpacity
            style={[styles.primaryButton, { backgroundColor: colors.accent }]}
            onPress={() => (navigation as any).navigate('AddCreditCard')}>
            <Text style={styles.primaryButtonText}>Add Your First Card</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          data={cards}
          renderItem={renderCard}
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
  card: {
    borderRadius: 16,
    marginBottom: 16,
    overflow: 'hidden',
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    padding: 16,
    paddingBottom: 12,
  },
  bankName: {
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 4,
  },
  cardName: {
    fontSize: 14,
    marginBottom: 4,
  },
  cardNumber: {
    fontSize: 16,
    fontWeight: '600',
  },
  utilizationBadge: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 12,
  },
  utilizationText: {
    fontSize: 14,
    fontWeight: '600',
  },
  cardBody: {
    padding: 16,
    paddingTop: 0,
  },
  amountRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  label: {
    fontSize: 14,
  },
  outstanding: {
    fontSize: 24,
    fontWeight: 'bold',
  },
  highOutstanding: {
    color: '#ef4444',
  },
  progressBar: {
    height: 6,
    backgroundColor: '#2a2a3d',
    borderRadius: 3,
    marginBottom: 16,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: 3,
  },
  progressFillHigh: {
    backgroundColor: '#ef4444',
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
    fontSize: 16,
    fontWeight: '600',
  },
  cardFooter: {
    backgroundColor: '#2a2a3d',
    padding: 12,
    alignItems: 'center',
  },
  cardFooterUrgent: {
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
