import React from 'react';
import {
  ActivityIndicator,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';
import { useTheme } from '../context/ThemeContext';
import { BalanceHistoryItem } from '../lib/services/balanceViewModel';
import { formatCurrencyDisplay } from '../utils/format';

interface DetailMetric {
  label: string;
  value: string;
}

interface BalanceHistoryModalProps {
  visible: boolean;
  title: string;
  subtitle?: string | null;
  balanceLabel: string;
  balanceAmount: number;
  balanceKindLabel: string;
  sourceLabel: string;
  confidenceLabel: string;
  freshnessLabel: string;
  loading?: boolean;
  history: BalanceHistoryItem[];
  metrics?: DetailMetric[];
  emptyFallbackLabel?: string;
  onClose: () => void;
  onUpdateBalance?: () => void;
}

function formatDetectedAt(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Updated recently';
  return date.toLocaleString('en-IN', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default function BalanceHistoryModal({
  visible,
  title,
  subtitle,
  balanceLabel,
  balanceAmount,
  balanceKindLabel,
  sourceLabel,
  confidenceLabel,
  freshnessLabel,
  loading = false,
  history,
  metrics = [],
  emptyFallbackLabel = 'No balance history yet',
  onClose,
  onUpdateBalance,
}: BalanceHistoryModalProps) {
  const { colors, typography, spacing } = useTheme();

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={[styles.sheet, { backgroundColor: colors.card }]}>
          <View style={styles.header}>
            <View style={{ flex: 1 }}>
              <Text style={[typography.h3, { color: colors.text }]} numberOfLines={1}>
                {title}
              </Text>
              {!!subtitle && (
                <Text style={[typography.caption, { color: colors.subtext, marginTop: 2 }]} numberOfLines={1}>
                  {subtitle}
                </Text>
              )}
            </View>
            <TouchableOpacity onPress={onClose} accessibilityLabel="Close balance history" style={styles.closeButton}>
              <MaterialCommunityIcons name="close" size={22} color={colors.text} />
            </TouchableOpacity>
          </View>

          {loading ? (
            <View style={styles.loadingState}>
              <ActivityIndicator color={colors.accent} />
            </View>
          ) : (
            <ScrollView showsVerticalScrollIndicator={false}>
              <View style={[styles.summary, { backgroundColor: colors.background }]}>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={[typography.caption, { color: colors.subtext }]}>{balanceLabel}</Text>
                  <Text style={[typography.h2, { color: colors.text, marginTop: 2 }]}>
                    {formatCurrencyDisplay(balanceAmount)}
                  </Text>
                  <Text style={[typography.caption, { color: colors.subtext, marginTop: 4 }]}>
                    {balanceKindLabel} · {freshnessLabel}
                  </Text>
                </View>
                {!!onUpdateBalance && (
                  <TouchableOpacity
                    onPress={onUpdateBalance}
                    accessibilityLabel="Update balance from history"
                    style={[styles.updateButton, { backgroundColor: '#10b98120' }]}>
                    <MaterialCommunityIcons name="wallet-plus-outline" size={20} color="#10b981" />
                  </TouchableOpacity>
                )}
              </View>

              <View style={styles.chipRow}>
                <View style={[styles.chip, { backgroundColor: colors.accent + '16' }]}>
                  <Text style={[typography.caption, { color: colors.accent, fontWeight: '700' }]}>
                    {sourceLabel}
                  </Text>
                </View>
                <View style={[styles.chip, { backgroundColor: confidenceLabel === 'Exact' ? '#10b98120' : '#f59e0b20' }]}>
                  <Text style={[typography.caption, {
                    color: confidenceLabel === 'Exact' ? '#10b981' : '#f59e0b',
                    fontWeight: '700',
                  }]}>
                    {confidenceLabel}
                  </Text>
                </View>
              </View>

              {metrics.length > 0 && (
                <View style={styles.metricsGrid}>
                  {metrics.map(metric => (
                    <View key={metric.label} style={[styles.metricCell, { borderColor: colors.border }]}>
                      <Text style={[typography.caption, { color: colors.subtext }]}>{metric.label}</Text>
                      <Text style={[typography.bodyBold, { color: colors.text, marginTop: 2 }]} numberOfLines={1}>
                        {metric.value}
                      </Text>
                    </View>
                  ))}
                </View>
              )}

              <Text style={[typography.caption, styles.sectionLabel, { color: colors.subtext }]}>
                Recent History
              </Text>

              {history.length === 0 ? (
                <View style={[styles.emptyState, { borderColor: colors.border }]}>
                  <MaterialCommunityIcons name="history" size={26} color={colors.subtext} />
                  <Text style={[typography.caption, { color: colors.subtext, marginTop: spacing.sm }]}>
                    {emptyFallbackLabel}
                  </Text>
                </View>
              ) : (
                history.map((item, index) => {
                  const previous = history[index + 1];
                  const delta = previous?.balanceKind === item.balanceKind ? item.amount - previous.amount : 0;
                  return (
                    <View key={item.id} style={[styles.historyRow, { borderColor: colors.border }]}>
                      <View style={{ flex: 1, minWidth: 0 }}>
                        <View style={styles.historyTopLine}>
                          <Text style={[typography.bodyBold, { color: colors.text }]}>
                            {formatCurrencyDisplay(item.amount)}
                          </Text>
                          {previous && delta !== 0 && (
                            <Text style={[typography.caption, { color: delta > 0 ? '#10b981' : '#ef4444', marginLeft: spacing.sm }]}>
                              {delta > 0 ? '+' : ''}{formatCurrencyDisplay(delta)}
                            </Text>
                          )}
                        </View>
                        <Text style={[typography.caption, { color: colors.subtext, marginTop: 2 }]}>
                          {item.balanceKindLabel} · {item.freshnessLabel} · {formatDetectedAt(item.detectedAt)}
                        </Text>
                        {!!item.noteSafe && (
                          <Text style={[typography.caption, { color: colors.subtext, marginTop: 2 }]} numberOfLines={1}>
                            {item.noteSafe}
                          </Text>
                        )}
                      </View>
                      <View style={{ alignItems: 'flex-end', marginLeft: spacing.sm }}>
                        <View style={[styles.smallChip, { backgroundColor: colors.accent + '14' }]}>
                          <Text style={[typography.caption, { color: colors.accent, fontSize: 10, fontWeight: '700' }]}>
                            {item.sourceLabel}
                          </Text>
                        </View>
                        <View style={[styles.smallChip, {
                          backgroundColor: item.confidence === 'exact' ? '#10b98120' : '#f59e0b20',
                          marginTop: 4,
                        }]}>
                          <Text style={[typography.caption, {
                            color: item.confidence === 'exact' ? '#10b981' : '#f59e0b',
                            fontSize: 10,
                            fontWeight: '700',
                          }]}>
                            {item.confidenceLabel}
                          </Text>
                        </View>
                      </View>
                    </View>
                  );
                })
              )}
            </ScrollView>
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.5)',
    padding: 20,
  },
  sheet: {
    width: '100%',
    maxHeight: '88%',
    borderRadius: 16,
    padding: 20,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 18,
  },
  closeButton: {
    padding: 6,
    marginLeft: 10,
  },
  loadingState: {
    minHeight: 220,
    alignItems: 'center',
    justifyContent: 'center',
  },
  summary: {
    borderRadius: 12,
    padding: 14,
    flexDirection: 'row',
    alignItems: 'center',
  },
  updateButton: {
    width: 44,
    height: 44,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 12,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 12,
  },
  chip: {
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  metricsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 16,
  },
  metricCell: {
    width: '48%',
    borderWidth: 1,
    borderRadius: 8,
    padding: 10,
  },
  sectionLabel: {
    marginTop: 18,
    marginBottom: 8,
    textTransform: 'uppercase',
    fontWeight: '700',
  },
  emptyState: {
    borderWidth: 1,
    borderRadius: 12,
    minHeight: 120,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 14,
  },
  historyRow: {
    borderTopWidth: 1,
    paddingVertical: 12,
    flexDirection: 'row',
  },
  historyTopLine: {
    flexDirection: 'row',
    alignItems: 'baseline',
    flexWrap: 'wrap',
  },
  smallChip: {
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
});
