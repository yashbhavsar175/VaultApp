import React from 'react';
import { Modal, View, Text, StyleSheet } from 'react-native';
import { useTheme } from '../../context/ThemeContext';
import AppButton from './AppButton';

interface AppConfirmModalProps {
  visible: boolean;
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  isDestructive?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export default function AppConfirmModal({
  visible,
  title,
  message,
  confirmText = 'Confirm',
  cancelText = 'Cancel',
  isDestructive = false,
  onConfirm,
  onCancel
}: AppConfirmModalProps) {
  const { colors, typography, spacing, borderRadius } = useTheme();

  return (
    <Modal visible={visible} transparent animationType="fade" statusBarTranslucent onRequestClose={onCancel}>
      <View style={[styles.modalOverlay, { backgroundColor: 'rgba(0,0,0,0.5)' }]}>
        <View style={[
          styles.modalContent,
          {
            backgroundColor: colors.card,
            borderRadius: borderRadius.lg,
            padding: spacing.lg,
            shadowColor: '#000',
            shadowOffset: { width: 0, height: 4 },
            shadowOpacity: 0.3,
            shadowRadius: 8,
            elevation: 5
          }
        ]}>
          <Text style={[typography.h3, { color: colors.text, marginBottom: spacing.sm }]}>
            {title}
          </Text>
          <Text style={[typography.body, { color: colors.subtext, marginBottom: spacing.xl, lineHeight: 22 }]}>
            {message}
          </Text>

          <View style={styles.buttonRow}>
            <AppButton
              title={cancelText}
              variant="secondary"
              onPress={onCancel}
              style={styles.button}
            />
            <AppButton
              title={confirmText}
              variant="primary"
              onPress={onConfirm}
              style={[
                styles.button,
                isDestructive && { backgroundColor: colors.danger }
              ] as any}
            />
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  modalOverlay: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalContent: {
    width: '85%',
    maxWidth: 400,
  },
  buttonRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 16,
  },
  button: {
    flex: 1,
    paddingVertical: 14,
  }
});
