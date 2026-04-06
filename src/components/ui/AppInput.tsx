import React from 'react';
import { View, Text, TextInput, StyleSheet, TextInputProps, ViewStyle } from 'react-native';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';
import { useTheme } from '../../context/ThemeContext';

interface AppInputProps extends TextInputProps {
  label?: string;
  error?: string;
  icon?: string;
  containerStyle?: ViewStyle;
}

export default function AppInput({
  label,
  error,
  icon,
  containerStyle,
  style,
  ...textInputProps
}: AppInputProps) {
  const { colors, typography, borderRadius, spacing } = useTheme();

  return (
    <View style={[styles.container, containerStyle]}>
      {label && (
        <Text style={[typography.caption, { color: colors.text, marginBottom: spacing.sm }]}>
          {label}
        </Text>
      )}
      <View
        style={[
          styles.inputContainer,
          {
            backgroundColor: colors.card,
            borderColor: error ? colors.error : colors.border,
            borderRadius: borderRadius.md,
            paddingHorizontal: spacing.md,
          },
        ]}>
        {icon && (
          <MaterialCommunityIcons
            name={icon}
            size={20}
            color={colors.subtext}
            style={{ marginRight: spacing.sm }}
          />
        )}
        <TextInput
          style={[
            styles.input,
            typography.body,
            { color: colors.text, flex: 1 },
            style,
          ]}
          placeholderTextColor={colors.subtext}
          {...textInputProps}
        />
      </View>
      {error && (
        <Text style={[typography.caption, { color: colors.error, marginTop: spacing.xs }]}>
          {error}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginBottom: 16,
  },
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
  },
  input: {
    paddingVertical: 12,
  },
});
