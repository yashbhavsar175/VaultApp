import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useTheme } from '../context/ThemeContext';
import { safeErrorCode } from '../utils/errorUtils';

interface Props {
  children: React.ReactNode;
  screenName?: string;
}

interface State {
  hasError: boolean;
  errorCode: string | null;
}

// Bug #M2 fix: per-screen error boundary. A crash in one screen shows a localized
// "Try Again" card instead of locking the entire app. Root ErrorBoundary stays as
// the last resort for truly unrecoverable crashes.
export class ScreenErrorBoundary extends React.Component<Props, State> {
  state: State = { hasError: false, errorCode: null };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, errorCode: safeErrorCode(error) };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error(`[ScreenErrorBoundary] ${this.props.screenName ?? 'Screen'} crashed:`, {
      errorCode: safeErrorCode(error),
      stack: info.componentStack?.slice(0, 300) ?? null,
    });
  }

  handleRetry = () => {
    this.setState({ hasError: false, errorCode: null });
  };

  render() {
    if (this.state.hasError) {
      return (
        <ScreenErrorFallback
          screenName={this.props.screenName}
          onRetry={this.handleRetry}
        />
      );
    }
    return this.props.children;
  }
}

function ScreenErrorFallback({
  screenName,
  onRetry,
}: {
  screenName?: string;
  onRetry: () => void;
}) {
  const { colors, spacing, borderRadius } = useTheme();

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <Text style={[styles.title, { color: colors.text }]}>
        {screenName ?? 'This screen'} couldn't load
      </Text>
      <Text style={[styles.subtitle, { color: colors.subtext }]}>
        Something went wrong. Your data is safe.
      </Text>
      <TouchableOpacity
        style={[
          styles.button,
          {
            borderColor: colors.accent,
            borderRadius: borderRadius.md,
            marginTop: spacing.lg,
          },
        ]}
        onPress={onRetry}
        accessibilityLabel={`Retry loading ${screenName ?? 'this screen'}`}
        accessibilityRole="button"
      >
        <Text style={[styles.buttonText, { color: colors.accent }]}>Try Again</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  title: {
    fontSize: 18,
    fontWeight: '600',
    marginBottom: 8,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 20,
  },
  button: {
    borderWidth: 1,
    paddingHorizontal: 24,
    paddingVertical: 12,
  },
  buttonText: {
    fontSize: 16,
    fontWeight: '500',
  },
});
