import React from 'react';
import { View, Text, StyleSheet, Modal, TouchableOpacity, ActivityIndicator } from 'react-native';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';
import { useTheme } from '../../context/ThemeContext';
import { Card } from '../';
import type { DetectedAccountReviewItem } from '../../lib/services/detectedAccountReview';

interface DetectedAccountApprovalModalProps {
  visible: boolean;
  item: DetectedAccountReviewItem | null;
  /** 1-based position of the current item. */
  position: number;
  /** Total pending detections in the queue. */
  total: number;
  /** Which action is currently in flight, so only that button shows a spinner. */
  workingAction: 'approve' | 'decline' | null;
  onApprove: () => void;
  onDecline: () => void;
  /** Open the manage screen to fill in / edit details. */
  onManage: () => void;
  /** Dismiss for now (keeps detections pending). */
  onClose: () => void;
}

function detectionMeta(type: DetectedAccountReviewItem['detectionType']): {
  icon: string;
  label: string;
  accent: string;
} {
  switch (type) {
    case 'credit_card':
      return { icon: 'credit-card-outline', label: 'Credit Card', accent: '#6366f1' };
    case 'debit_card':
      return { icon: 'card-account-details-outline', label: 'Debit Card', accent: '#06b6d4' };
    case 'loan':
      return { icon: 'cash-clock', label: 'Loan', accent: '#f59e0b' };
    case 'bank_account':
    default:
      return { icon: 'bank-outline', label: 'Bank Account', accent: '#10b981' };
  }
}

function maskedNumber(last4: string | null): string | null {
  return last4 ? `•••• ${last4}` : null;
}

export default function DetectedAccountApprovalModal({
  visible,
  item,
  position,
  total,
  workingAction,
  onApprove,
  onDecline,
  onManage,
  onClose,
}: DetectedAccountApprovalModalProps) {
  const { colors, typography, spacing } = useTheme();

  if (!item) return null;

  const working = workingAction !== null;

  const meta = detectionMeta(item.detectionType);
  const masked = maskedNumber(item.cardLast4 || item.accountLast4);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={[styles.overlay, { backgroundColor: colors.modalOverlay }]}>
        <Card style={{ width: '90%', maxWidth: 420, padding: spacing.lg }}>
          {/* Header */}
          <View style={[styles.iconCircle, { backgroundColor: `${meta.accent}18` }]}>
            <MaterialCommunityIcons name={meta.icon} size={30} color={meta.accent} />
          </View>

          <Text
            style={[
              typography.caption,
              {
                color: meta.accent,
                fontWeight: '700',
                textTransform: 'uppercase',
                letterSpacing: 1,
                textAlign: 'center',
                marginTop: spacing.md,
              },
            ]}>
            New account detected
          </Text>
          <Text style={[typography.h3, { color: colors.text, textAlign: 'center', marginTop: spacing.xs }]}>
            {item.bankName}
          </Text>
          <Text style={[typography.body, { color: colors.subtext, textAlign: 'center', marginTop: 2 }]}>
            {meta.label}
            {masked ? `  ·  ${masked}` : ''}
          </Text>

          {/* Detail rows */}
          <View style={[styles.detailBox, { borderColor: colors.border }]}>
            <DetailRow label="Type" value={meta.label} colors={colors} typography={typography} spacing={spacing} />
            {masked && (
              <DetailRow label="Number" value={masked} colors={colors} typography={typography} spacing={spacing} />
            )}
            {item.accountTypeHint && (
              <DetailRow label="Account" value={item.accountTypeHint} colors={colors} typography={typography} spacing={spacing} />
            )}
            {item.balanceLabel && (
              <DetailRow
                label={item.balanceLabel.split(':')[0]}
                value={(item.balanceLabel.split(':')[1] || '').trim() || item.balanceLabel}
                colors={colors}
                typography={typography}
                spacing={spacing}
              />
            )}
            <DetailRow
              label="Detected via"
              value={`${item.sourceLabel} · ${item.lastSeenLabel}`}
              colors={colors}
              typography={typography}
              spacing={spacing}
              last
            />
          </View>

          {total > 1 && (
            <Text style={[typography.caption, { color: colors.subtext, textAlign: 'center', marginTop: spacing.sm }]}>
              {position} of {total} to review
            </Text>
          )}

          {/* Approve / Decline */}
          <View style={[styles.actionRow, { marginTop: spacing.lg }]}>
            <TouchableOpacity
              onPress={onDecline}
              disabled={working}
              style={[styles.actionButton, { borderColor: '#ef4444', backgroundColor: '#ef444412' }]}>
              {workingAction === 'decline' ? (
                <ActivityIndicator color="#ef4444" size="small" />
              ) : (
                <>
                  <MaterialCommunityIcons name="close-circle-outline" size={18} color="#ef4444" />
                  <Text style={[typography.bodyBold, { color: '#ef4444', marginLeft: 6 }]}>Decline</Text>
                </>
              )}
            </TouchableOpacity>

            <TouchableOpacity
              onPress={onApprove}
              disabled={working}
              style={[styles.actionButton, { borderColor: '#10b981', backgroundColor: '#10b981' }]}>
              {workingAction === 'approve' ? (
                <ActivityIndicator color="#fff" size="small" />
              ) : (
                <>
                  <MaterialCommunityIcons name="check-circle-outline" size={18} color="#fff" />
                  <Text style={[typography.bodyBold, { color: '#fff', marginLeft: 6 }]}>Approve</Text>
                </>
              )}
            </TouchableOpacity>
          </View>

          <View style={styles.secondaryRow}>
            <TouchableOpacity onPress={onManage} disabled={working} style={{ padding: spacing.sm }}>
              <Text style={[typography.caption, { color: colors.accent, fontWeight: '600' }]}>
                Edit details
              </Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={onClose} disabled={working} style={{ padding: spacing.sm }}>
              <Text style={[typography.caption, { color: colors.subtext }]}>
                Later
              </Text>
            </TouchableOpacity>
          </View>
        </Card>
      </View>
    </Modal>
  );
}

function DetailRow({
  label,
  value,
  colors,
  typography,
  spacing,
  last,
}: {
  label: string;
  value: string;
  colors: any;
  typography: any;
  spacing: any;
  last?: boolean;
}) {
  return (
    <View
      style={[
        styles.detailRow,
        {
          borderBottomColor: colors.border,
          borderBottomWidth: last ? 0 : StyleSheet.hairlineWidth,
          paddingVertical: spacing.sm,
        },
      ]}>
      <Text style={[typography.caption, { color: colors.subtext }]}>{label}</Text>
      <Text style={[typography.caption, { color: colors.text, fontWeight: '600', flexShrink: 1, textAlign: 'right', marginLeft: spacing.md }]} numberOfLines={1}>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  iconCircle: {
    width: 60,
    height: 60,
    borderRadius: 30,
    justifyContent: 'center',
    alignItems: 'center',
    alignSelf: 'center',
  },
  detailBox: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
    marginTop: 16,
  },
  detailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  actionRow: {
    flexDirection: 'row',
    gap: 12,
  },
  actionButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderRadius: 12,
    paddingVertical: 12,
  },
  secondaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 4,
  },
});
