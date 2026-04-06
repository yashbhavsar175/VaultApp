import React, { ReactNode } from 'react';
import { View, TouchableOpacity, StyleSheet, ViewStyle } from 'react-native';
import { useTheme } from '../../context/ThemeContext';

interface CardProps {
  children: ReactNode;
  style?: ViewStyle;
  onPress?: () => void;
}

export default function Card({ children, style, onPress }: CardProps) {
  const { colors, borderRadius, shadows, spacing } = useTheme();

  const cardStyle = [
    styles.card,
    {
      backgroundColor: colors.card,
      borderRadius: borderRadius.lg,
      padding: spacing.md,
    },
    shadows.sm,
    style,
  ];

  if (onPress) {
    return (
      <TouchableOpacity style={cardStyle} onPress={onPress} activeOpacity={0.7}>
        {children}
      </TouchableOpacity>
    );
  }

  return <View style={cardStyle}>{children}</View>;
}

const styles = StyleSheet.create({
  card: {
    overflow: 'hidden',
  },
});
