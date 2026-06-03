import React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useRoute } from '@react-navigation/native';
import { AppHeader, ScreenWrapper } from '../../components';
import { useTheme } from '../../context/ThemeContext';
import IncomeReviewScreen from './IncomeReviewScreen';
import ReviewQueueScreen from '../transactions/ReviewQueueScreen';

type ReviewSection = 'all' | 'credits' | 'payments' | 'card_payments' | 'recently_reviewed';

type MoneyMovementReviewRouteParams = {
  initialSection?: ReviewSection;
};

export default function MoneyMovementReviewScreen() {
  const route = useRoute<any>();
  const { colors, typography, spacing } = useTheme();
  const initialSection = (route.params as MoneyMovementReviewRouteParams | undefined)?.initialSection;
  const showCreditsFirst = initialSection === 'credits' || initialSection === 'recently_reviewed';

  const queueSection = (
    <View style={styles.section}>
      <Text style={[typography.h3, { color: colors.text }]}>Pending money movements</Text>
      <Text style={[typography.caption, styles.sectionCopy, { color: colors.subtext }]}>
        Review payments, card payments, refunds, transfers, and queued credits here.
      </Text>
      <ReviewQueueScreen embedded filter="all" />
    </View>
  );

  const incomeSection = (
    <View style={styles.section}>
      <Text style={[typography.h3, { color: colors.text }]}>Income decisions</Text>
      <Text style={[typography.caption, styles.sectionCopy, { color: colors.subtext }]}>
        Review older credits and recent income decisions without leaving this page.
      </Text>
      <IncomeReviewScreen embedded />
    </View>
  );

  return (
    <ScreenWrapper>
      <AppHeader title="Money Movement Review" showBack />
      <ScrollView contentContainerStyle={[styles.content, { padding: spacing.md }]}>
        {showCreditsFirst ? incomeSection : queueSection}
        {showCreditsFirst ? queueSection : incomeSection}
      </ScrollView>
    </ScreenWrapper>
  );
}

const styles = StyleSheet.create({
  content: {
    paddingBottom: 24,
    gap: 22,
  },
  section: {
    gap: 8,
  },
  sectionCopy: {
    lineHeight: 18,
  },
});
