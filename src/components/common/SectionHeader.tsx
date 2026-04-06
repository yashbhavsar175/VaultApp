import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useTheme } from '../../context/ThemeContext';

interface SectionHeaderProps {
  title: string;
  actionLabel?: string;
  onAction?: () => void;
}

export default function SectionHeader({ title, actionLabel, onAction }: SectionHeaderProps) {
  const { colors, typography, spacing } = useTheme();

  return (
    <View style={[styles.container, { marginBottom: spacing.md }]}>
      <Text style={[typography.h3, { color: colors.text }]}>{title}</Text>
      {actionLabel && onAction && (
        <TouchableOpacity onPress={onAction}>
          <Text style={[typography.caption, { color: colors.accent }]}>{actionLabel}</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
});
