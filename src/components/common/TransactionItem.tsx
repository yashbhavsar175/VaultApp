import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useTheme } from '../../context/ThemeContext';
import Card from '../ui/Card';

interface TransactionItemProps {
  title: string;
  amount: number;
  date: string;
  type: 'income' | 'expense' | 'investment' | 'emi' | 'lent' | 'borrowed';
  category?: string;
  onPress?: () => void;
}

export default function TransactionItem({
  title,
  amount,
  date,
  type,
  category,
  onPress,
}: TransactionItemProps) {
  const { colors, typography, spacing } = useTheme();

  const getTypeColor = () => {
    switch (type) {
      case 'income':
        return colors.income;
      case 'expense':
        return colors.expense;
      case 'investment':
        return colors.investment;
      case 'emi':
        return colors.emi;
      case 'lent':
        return '#06b6d4';
      case 'borrowed':
        return '#ec4899';
      default:
        return colors.text;
    }
  };

  const getAmountPrefix = () => {
    if (type === 'income' || type === 'borrowed') return '+';
    return '-';
  };

  const formatAmount = (amt: number) => {
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: 'INR',
      maximumFractionDigits: 0,
    }).format(amt);
  };

  return (
    <Card onPress={onPress} style={{ marginBottom: spacing.sm }}>
      <View style={styles.container}>
        <View style={styles.leftSection}>
          <Text style={[typography.bodyBold, { color: colors.text }]}>{title}</Text>
          {category && (
            <Text style={[typography.caption, { color: colors.subtext, marginTop: spacing.xs }]}>
              {category}
            </Text>
          )}
          <Text style={[typography.caption, { color: colors.subtext, marginTop: spacing.xs }]}>
            {date}
          </Text>
        </View>
        <View style={styles.rightSection}>
          <Text style={[typography.bodyBold, { color: getTypeColor() }]}>
            {getAmountPrefix()}{formatAmount(amount)}
          </Text>
        </View>
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  leftSection: {
    flex: 1,
  },
  rightSection: {
    alignItems: 'flex-end',
  },
});
