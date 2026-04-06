import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Dimensions } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { getTransactions } from '../lib/db';
import { Transaction } from '../types';
import { useTheme } from '../context/ThemeContext';
import { ScreenWrapper, Card, AppHeader } from '../components';

type TimeRange = 'week' | 'month' | '3months' | 'year';

interface CategoryData {
  name: string;
  amount: number;
  color: string;
  percentage: number;
}

export default function AnalyticsScreen() {
  const { colors, typography, spacing, borderRadius } = useTheme();
  const [timeRange, setTimeRange] = useState<TimeRange>('month');
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);

  useFocusEffect(
    React.useCallback(() => {
      loadData();
    }, [timeRange])
  );

  const loadData = async () => {
    setLoading(true);
    try {
      const data = await getTransactions();
      const filtered = filterByTimeRange(data, timeRange);
      setTransactions(filtered);
    } catch (error) {
      console.error('Error loading analytics data:', error);
    } finally {
      setLoading(false);
    }
  };

  const filterByTimeRange = (data: Transaction[], range: TimeRange): Transaction[] => {
    const now = new Date();
    const startDate = new Date();

    switch (range) {
      case 'week':
        startDate.setDate(now.getDate() - 7);
        break;
      case 'month':
        startDate.setMonth(now.getMonth() - 1);
        break;
      case '3months':
        startDate.setMonth(now.getMonth() - 3);
        break;
      case 'year':
        startDate.setFullYear(now.getFullYear() - 1);
        break;
    }

    return data.filter(t => new Date(t.created_at) >= startDate);
  };

  const formatAmount = (amount: number) => {
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: 'INR',
      maximumFractionDigits: 0,
    }).format(amount);
  };

  // Calculate summary
  const totalSpent = transactions
    .filter(t => t.type === 'expense')
    .reduce((sum, t) => sum + Number(t.amount), 0);

  const totalIncome = transactions
    .filter(t => t.type === 'income')
    .reduce((sum, t) => sum + Number(t.amount), 0);

  const netSavings = totalIncome - totalSpent;

  // Group by category for chart
  const categoryData: { [key: string]: number } = {};
  transactions
    .filter(t => t.type === 'expense')
    .forEach(t => {
      const cat = t.category || 'Uncategorized';
      categoryData[cat] = (categoryData[cat] || 0) + Number(t.amount);
    });

  const CHART_COLORS = ['#ef4444', '#f59e0b', '#10b981', '#3b82f6', '#8b5cf6', '#ec4899', '#06b6d4', '#f97316'];

  const categoryChartData: CategoryData[] = Object.entries(categoryData)
    .sort(([, a], [, b]) => b - a)
    .map(([name, amount], index) => ({
      name,
      amount,
      color: CHART_COLORS[index % CHART_COLORS.length],
      percentage: totalSpent > 0 ? (amount / totalSpent) * 100 : 0,
    }));

  // Top categories
  const topCategories = Object.entries(categoryData)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 5)
    .map(([name, amount]) => ({
      name,
      amount,
      percentage: totalSpent > 0 ? (amount / totalSpent) * 100 : 0,
    }));

  // Daily spending data for bar chart
  const getDailyData = () => {
    const dailyExpense: { [key: string]: number } = {};
    const dailyIncome: { [key: string]: number } = {};

    transactions.forEach(t => {
      const date = new Date(t.created_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
      if (t.type === 'expense') {
        dailyExpense[date] = (dailyExpense[date] || 0) + Number(t.amount);
      } else if (t.type === 'income') {
        dailyIncome[date] = (dailyIncome[date] || 0) + Number(t.amount);
      }
    });

    const allDates = Array.from(new Set([...Object.keys(dailyExpense), ...Object.keys(dailyIncome)])).slice(-7);
    const maxAmount = Math.max(
      ...allDates.map(date => Math.max(dailyExpense[date] || 0, dailyIncome[date] || 0)),
      1
    );

    return {
      labels: allDates,
      expense: allDates.map(date => dailyExpense[date] || 0),
      income: allDates.map(date => dailyIncome[date] || 0),
      maxAmount,
    };
  };

  const barData = getDailyData();

  return (
    <ScreenWrapper scrollable>
      <AppHeader title="Analytics" showBackButton />

      <View style={{ padding: spacing.lg }}>
        {/* Time Range Selector */}
        <Card style={{ padding: spacing.xs, marginBottom: spacing.lg }}>
          <View style={styles.timeRangeContainer}>
            {(['week', 'month', '3months', 'year'] as TimeRange[]).map((range) => (
              <TouchableOpacity
                key={range}
                style={[
                  styles.timeRangeButton,
                  { borderRadius: borderRadius.sm },
                  timeRange === range && { backgroundColor: colors.accent },
                ]}
                onPress={() => setTimeRange(range)}
              >
                <Text
                  style={[
                    typography.caption,
                    { color: colors.subtext },
                    timeRange === range && { color: '#fff', fontWeight: '600' },
                  ]}
                >
                  {range === '3months' ? '3 Months' : range.charAt(0).toUpperCase() + range.slice(1)}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </Card>

        {/* Summary Cards */}
        <View style={styles.summaryRow}>
          <Card style={[styles.summaryCard, { borderLeftWidth: 4, borderLeftColor: '#ef4444' }]}>
            <Text style={[typography.caption, { color: colors.subtext, marginBottom: spacing.xs }]}>
              Total Spent
            </Text>
            <Text style={[typography.h3, { color: '#ef4444', fontSize: 18 }]}>
              {formatAmount(totalSpent)}
            </Text>
          </Card>

          <Card style={[styles.summaryCard, { borderLeftWidth: 4, borderLeftColor: '#10b981' }]}>
            <Text style={[typography.caption, { color: colors.subtext, marginBottom: spacing.xs }]}>
              Total Income
            </Text>
            <Text style={[typography.h3, { color: '#10b981', fontSize: 18 }]}>
              {formatAmount(totalIncome)}
            </Text>
          </Card>

          <Card style={[styles.summaryCard, { borderLeftWidth: 4, borderLeftColor: '#8b5cf6' }]}>
            <Text style={[typography.caption, { color: colors.subtext, marginBottom: spacing.xs }]}>
              Net Savings
            </Text>
            <Text style={[typography.h3, { color: netSavings >= 0 ? '#10b981' : '#ef4444', fontSize: 18 }]}>
              {formatAmount(netSavings)}
            </Text>
          </Card>
        </View>

        {/* Horizontal Bar Chart - Spending by Category */}
        {categoryChartData.length > 0 ? (
          <Card style={{ padding: spacing.lg, marginBottom: spacing.lg }}>
            <Text style={[typography.h3, { color: colors.text, marginBottom: spacing.md }]}>
              Where your money goes
            </Text>
            
            {/* Horizontal segmented bar */}
            <View style={{ 
              flexDirection: 'row', 
              height: 40, 
              borderRadius: borderRadius.md, 
              overflow: 'hidden',
              marginBottom: spacing.lg,
            }}>
              {categoryChartData.map((item, index) => (
                <View
                  key={index}
                  style={{
                    flex: item.percentage,
                    backgroundColor: item.color,
                  }}
                />
              ))}
            </View>

            {/* Center total */}
            <View style={{ alignItems: 'center', marginBottom: spacing.lg }}>
              <Text style={[typography.caption, { color: colors.subtext }]}>Total Expenses</Text>
              <Text style={[typography.h2, { color: colors.text }]}>{formatAmount(totalSpent)}</Text>
            </View>

            {/* Legend */}
            <View>
              {categoryChartData.map((item, index) => (
                <View key={index} style={styles.legendRow}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', flex: 1 }}>
                    <View style={[styles.legendDot, { backgroundColor: item.color }]} />
                    <Text style={[typography.body, { color: colors.text }]}>{item.name}</Text>
                  </View>
                  <Text style={[typography.body, { color: colors.text }]}>
                    {formatAmount(item.amount)}
                  </Text>
                  <Text style={[typography.caption, { color: colors.subtext, marginLeft: spacing.sm, minWidth: 40, textAlign: 'right' }]}>
                    {item.percentage.toFixed(0)}%
                  </Text>
                </View>
              ))}
            </View>
          </Card>
        ) : (
          <Card style={{ padding: spacing.lg, marginBottom: spacing.lg, alignItems: 'center' }}>
            <Text style={[typography.h3, { color: colors.text, marginBottom: spacing.sm }]}>
              Where your money goes
            </Text>
            <Text style={[typography.body, { color: colors.subtext }]}>No expense data available</Text>
          </Card>
        )}

        {/* Custom Bar Chart - Daily Spending */}
        {barData.labels.length > 0 ? (
          <Card style={{ padding: spacing.lg, marginBottom: spacing.lg }}>
            <Text style={[typography.h3, { color: colors.text, marginBottom: spacing.md }]}>
              Daily spending trend
            </Text>
            
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              <View style={{ paddingVertical: spacing.md }}>
                <View style={{ flexDirection: 'row', height: 200, alignItems: 'flex-end', gap: 16 }}>
                  {barData.labels.map((label, index) => {
                    const expenseHeight = (barData.expense[index] / barData.maxAmount) * 180;
                    const incomeHeight = (barData.income[index] / barData.maxAmount) * 180;
                    
                    return (
                      <View key={index} style={{ alignItems: 'center', gap: 4 }}>
                        <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 4, height: 180 }}>
                          {/* Expense bar */}
                          <View style={{ width: 20, alignItems: 'center', justifyContent: 'flex-end' }}>
                            {barData.expense[index] > 0 && (
                              <View
                                style={{
                                  width: 20,
                                  height: expenseHeight,
                                  backgroundColor: '#ef4444',
                                  borderRadius: 4,
                                }}
                              />
                            )}
                          </View>
                          
                          {/* Income bar */}
                          <View style={{ width: 20, alignItems: 'center', justifyContent: 'flex-end' }}>
                            {barData.income[index] > 0 && (
                              <View
                                style={{
                                  width: 20,
                                  height: incomeHeight,
                                  backgroundColor: '#10b981',
                                  borderRadius: 4,
                                }}
                              />
                            )}
                          </View>
                        </View>
                        
                        {/* Label */}
                        <Text style={[typography.caption, { color: colors.subtext, fontSize: 10 }]}>
                          {label}
                        </Text>
                      </View>
                    );
                  })}
                </View>
              </View>
            </ScrollView>

            {/* Legend */}
            <View style={{ flexDirection: 'row', justifyContent: 'center', marginTop: spacing.md, gap: 16 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <View style={[styles.legendDot, { backgroundColor: '#ef4444' }]} />
                <Text style={[typography.caption, { color: colors.text }]}>Expense</Text>
              </View>
              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <View style={[styles.legendDot, { backgroundColor: '#10b981' }]} />
                <Text style={[typography.caption, { color: colors.text }]}>Income</Text>
              </View>
            </View>
          </Card>
        ) : (
          <Card style={{ padding: spacing.lg, marginBottom: spacing.lg, alignItems: 'center' }}>
            <Text style={[typography.h3, { color: colors.text, marginBottom: spacing.sm }]}>
              Daily spending trend
            </Text>
            <Text style={[typography.body, { color: colors.subtext }]}>No transaction data available</Text>
          </Card>
        )}

        {/* Top Categories List */}
        {topCategories.length > 0 && (
          <Card style={{ padding: spacing.lg }}>
            <Text style={[typography.h3, { color: colors.text, marginBottom: spacing.md }]}>
              Top spending categories
            </Text>
            {topCategories.map((cat, index) => (
              <View key={index} style={styles.topCategoryRow}>
                <View
                  style={[
                    styles.rankBadge,
                    { backgroundColor: CHART_COLORS[index % CHART_COLORS.length] + '20', borderRadius: borderRadius.sm },
                  ]}
                >
                  <Text style={[typography.bodyBold, { color: CHART_COLORS[index % CHART_COLORS.length] }]}>
                    {index + 1}
                  </Text>
                </View>
                <View style={{ flex: 1, marginLeft: spacing.md }}>
                  <Text style={[typography.body, { color: colors.text, marginBottom: spacing.xs }]}>
                    {cat.name}
                  </Text>
                  <View style={[styles.progressBar, { backgroundColor: colors.border, borderRadius: borderRadius.sm }]}>
                    <View
                      style={[
                        styles.progressFill,
                        {
                          width: `${cat.percentage}%`,
                          backgroundColor: CHART_COLORS[index % CHART_COLORS.length],
                          borderRadius: borderRadius.sm,
                        },
                      ]}
                    />
                  </View>
                </View>
                <Text style={[typography.bodyBold, { color: colors.text, marginLeft: spacing.md }]}>
                  {formatAmount(cat.amount)}
                </Text>
              </View>
            ))}
          </Card>
        )}
      </View>
    </ScreenWrapper>
  );
}

const styles = StyleSheet.create({
  timeRangeContainer: {
    flexDirection: 'row',
    padding: 4,
  },
  timeRangeButton: {
    flex: 1,
    paddingVertical: 10,
    alignItems: 'center',
  },
  summaryRow: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 16,
  },
  summaryCard: {
    flex: 1,
    padding: 12,
  },
  legendRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  legendDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 8,
  },
  topCategoryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
  },
  rankBadge: {
    width: 32,
    height: 32,
    justifyContent: 'center',
    alignItems: 'center',
  },
  progressBar: {
    height: 6,
    width: '100%',
  },
  progressFill: {
    height: '100%',
  },
});
