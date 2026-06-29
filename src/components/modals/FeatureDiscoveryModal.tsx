import React from 'react';
import { View, Text, StyleSheet, Modal, TouchableOpacity } from 'react-native';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';
import { useTheme } from '../../context/ThemeContext';
import { Card, AppButton } from '../';
import type { FeatureTip } from '../../lib/services/featureDiscovery';

interface FeatureDiscoveryModalProps {
  visible: boolean;
  tip: FeatureTip | null;
  /** "Try it" — open the feature. */
  onTry: () => void;
  /** "Maybe later" — dismiss for now (will reappear later). */
  onLater: () => void;
  /** "Don't show again" — never suggest this feature again. */
  onDismissForever: () => void;
}

export default function FeatureDiscoveryModal({
  visible,
  tip,
  onTry,
  onLater,
  onDismissForever,
}: FeatureDiscoveryModalProps) {
  const { colors, typography, spacing, borderRadius } = useTheme();

  if (!tip) return null;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onLater}>
      <View style={[styles.overlay, { backgroundColor: colors.modalOverlay }]}>
        <Card style={{ width: '90%', maxWidth: 400, padding: spacing.lg }}>
          <View style={[styles.iconCircle, { backgroundColor: `${colors.accent}18` }]}>
            <MaterialCommunityIcons name={tip.icon} size={30} color={colors.accent} />
          </View>

          <Text style={[typography.caption, { color: colors.accent, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 1, textAlign: 'center', marginTop: spacing.md }]}>
            Did you know?
          </Text>
          <Text style={[typography.h3, { color: colors.text, textAlign: 'center', marginTop: spacing.xs }]}>
            {tip.title}
          </Text>
          <Text style={[typography.body, { color: colors.subtext, textAlign: 'center', marginTop: spacing.sm }]}>
            {tip.benefit}
          </Text>

          <AppButton
            title={tip.routeLabel}
            onPress={onTry}
            variant="primary"
            style={{ marginTop: spacing.lg }}
          />

          <View style={styles.secondaryRow}>
            <TouchableOpacity onPress={onLater} style={{ padding: spacing.sm }}>
              <Text style={[typography.caption, { color: colors.subtext, fontWeight: '600' }]}>
                Maybe later
              </Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={onDismissForever} style={{ padding: spacing.sm }}>
              <Text style={[typography.caption, { color: colors.subtext }]}>
                Don't show again
              </Text>
            </TouchableOpacity>
          </View>
        </Card>
      </View>
    </Modal>
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
  secondaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 4,
  },
});
