import React from 'react';
import { View, Text, StyleSheet, ViewStyle } from 'react-native';
import { useTheme } from '../../context/ThemeContext';

interface BadgeProps {
  label: string;
  variant?: 'success' | 'danger' | 'warning' | 'info';
  style?: ViewStyle;
}

export default function Badge({ label, variant = 'info', style }: BadgeProps) {
  const { colors, borderRadius, spacing } = useTheme();

  const getBackgroundColor = () => {
    switch (variant) {
      case 'success':
        return colors.success;
      case 'danger':
        return colors.danger;
      case 'warning':
        return colors.warning;
      case 'info':
        return colors.info;
      default:
        return colors.info;
    }
  };

  return (
    <View
      style={[
        styles.badge,
        {
          backgroundColor: getBackgroundColor(),
          borderRadius: borderRadius.full,
          paddingHorizontal: spacing.md,
          paddingVertical: spacing.xs,
        },
        style,
      ]}>
      <Text style={[styles.text, { color: '#ffffff' }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    alignSelf: 'flex-start',
  },
  text: {
    fontSize: 12,
    fontWeight: '600',
    textTransform: 'capitalize',
  },
});
