import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';
import { useTheme } from '../context/ThemeContext';

interface AppHeaderProps {
  title: string;
  showBack?: boolean;
  showBackButton?: boolean;
  rightAction?: {
    icon: string;
    onPress: () => void;
  };
  rightActions?: Array<{
    icon: string;
    onPress: () => void;
  }>;
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
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
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
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
            <MaterialCommunityIcons name={action.icon} size={24} color={colors.text} />
          </TouchableOpacity>
        ))}
        {rightAction && (
          <TouchableOpacity 
            onPress={rightAction.onPress} 
            style={styles.iconButton}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
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
