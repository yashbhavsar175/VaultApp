import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';
import { useTheme } from '../../context/ThemeContext';

interface AppHeaderProps {
  title: string;
  showBack?: boolean;
  showBackButton?: boolean;
  rightAction?: {
    icon: string;
    onPress: () => void;
    accessibilityLabel?: string;
  };
  rightActions?: Array<{
    icon: string;
    onPress: () => void;
    accessibilityLabel?: string;
  }>;
}

function getDefaultIconLabel(icon: string): string {
  const labels: Record<string, string> = {
    pencil: 'Edit',
    plus: 'Add',
    close: 'Close',
    'dots-vertical': 'More options',
    magnify: 'Search',
    filter: 'Filter',
    cog: 'Settings',
    refresh: 'Refresh',
    delete: 'Delete',
  };

  return labels[icon] || icon.replace(/-/g, ' ');
}

export default function AppHeader({ title, showBack = false, showBackButton = false, rightAction, rightActions }: AppHeaderProps) {
  const navigation = useNavigation();
  const { colors, typography, spacing } = useTheme();
  
  const showBackBtn = showBack || showBackButton;

  return (
    <View style={[styles.container, { backgroundColor: colors.background, paddingHorizontal: spacing.md }]}>
      <View style={styles.leftSection}>
        {showBackBtn && (
          <TouchableOpacity
            onPress={() => navigation.goBack()}
            style={[styles.iconButton, { marginRight: spacing.sm }]}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            accessibilityRole="button"
            accessibilityLabel="Go back">
            <MaterialCommunityIcons name="arrow-left" size={24} color={colors.text} />
          </TouchableOpacity>
        )}
        <Text style={[typography.h2, { color: colors.text }]} numberOfLines={1}>{title}</Text>
      </View>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        {rightActions && rightActions.map((action, index) => (
          <TouchableOpacity 
            key={index} 
            onPress={action.onPress} 
            style={styles.iconButton}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            accessibilityRole="button"
            accessibilityLabel={action.accessibilityLabel || getDefaultIconLabel(action.icon)}>
            <MaterialCommunityIcons name={action.icon} size={24} color={colors.text} />
          </TouchableOpacity>
        ))}
        {rightAction && (
          <TouchableOpacity 
            onPress={rightAction.onPress} 
            style={styles.iconButton}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            accessibilityRole="button"
            accessibilityLabel={rightAction.accessibilityLabel || getDefaultIconLabel(rightAction.icon)}>
            <MaterialCommunityIcons name={rightAction.icon} size={24} color={colors.text} />
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 16,
  },
  leftSection: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  iconButton: {
    padding: 4,
  },
});
