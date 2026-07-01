import React, { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Animated, Easing } from 'react-native';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';
import { useTheme } from '../context/ThemeContext';

interface DetectedAccountsTickerProps {
  /** Number of pending detections; the strip hides when this is 0. */
  count: number;
  onPress: () => void;
}

const ACCENT = '#f59e0b';

/**
 * A thin strip pinned at the top of the dashboard while auto-detected accounts
 * await the user's decision. The message scrolls continuously right → left and
 * the whole strip is tappable to open the approval popup.
 */
export default function DetectedAccountsTicker({ count, onPress }: DetectedAccountsTickerProps) {
  const { typography } = useTheme();
  const translateX = useRef(new Animated.Value(0)).current;
  const [textWidth, setTextWidth] = useState(0);

  const message =
    count === 1
      ? 'New account detected — review and confirm. Tap to approve or decline.'
      : `${count} new accounts detected — review and confirm. Tap to approve or decline.`;
  const spacedMessage = `${message}        `;

  useEffect(() => {
    if (textWidth <= 0) return undefined;
    translateX.setValue(0);
    const animation = Animated.loop(
      Animated.timing(translateX, {
        toValue: -textWidth,
        duration: Math.max(7000, textWidth * 22),
        easing: Easing.linear,
        useNativeDriver: true,
      })
    );
    animation.start();
    return () => animation.stop();
  }, [textWidth, translateX, spacedMessage]);

  if (count <= 0) return null;

  return (
    <TouchableOpacity
      activeOpacity={0.8}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={message}
      style={[styles.strip, { backgroundColor: `${ACCENT}1a`, borderBottomColor: `${ACCENT}40` }]}>
      <MaterialCommunityIcons name="radar" size={16} color={ACCENT} style={styles.leadingIcon} />
      <View style={styles.marqueeViewport}>
        <Animated.View style={[styles.marqueeRow, { transform: [{ translateX }] }]}>
          <Text
            numberOfLines={1}
            onLayout={event => setTextWidth(event.nativeEvent.layout.width)}
            style={[typography.caption, styles.marqueeText, { color: ACCENT }]}>
            {spacedMessage}
          </Text>
          <Text numberOfLines={1} style={[typography.caption, styles.marqueeText, { color: ACCENT }]}>
            {spacedMessage}
          </Text>
        </Animated.View>
      </View>
      <MaterialCommunityIcons name="chevron-right" size={18} color={ACCENT} />
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  strip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  leadingIcon: {
    marginRight: 8,
  },
  marqueeViewport: {
    flex: 1,
    overflow: 'hidden',
  },
  marqueeRow: {
    flexDirection: 'row',
  },
  marqueeText: {
    fontWeight: '700',
  },
});
