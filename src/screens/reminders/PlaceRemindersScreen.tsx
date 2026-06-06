import React, { useState, useCallback } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity, Alert } from 'react-native';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';
import { useTheme } from '../../context/ThemeContext';
import { ScreenWrapper, AppHeader, Card, AppButton } from '../../components';
import { getPlaceReminders, deletePlaceReminder, PlaceReminder, savePlaceReminder } from '../../lib/services/placeReminders';
import { requestPlaceReminderPermissions } from '../../lib/services/placeReminderPermissions';

export default function PlaceRemindersScreen() {
  const navigation = useNavigation<any>();
  const { colors, typography, spacing, borderRadius } = useTheme();
  const [reminders, setReminders] = useState<PlaceReminder[]>([]);
  const [loading, setLoading] = useState(true);

  const loadReminders = useCallback(async () => {
    setLoading(true);
    try {
      const data = await getPlaceReminders();
      setReminders(data);
    } catch (e) {
      console.warn(e);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadReminders();
      // Check permissions silently on focus
      requestPlaceReminderPermissions();
    }, [loadReminders])
  );

  const handleDelete = (id: string) => {
    Alert.alert('Delete Reminder', 'Are you sure you want to delete this reminder?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          await deletePlaceReminder(id);
          loadReminders();
        },
      },
    ]);
  };

  const handleToggle = async (reminder: PlaceReminder) => {
    try {
      await savePlaceReminder({ ...reminder, is_enabled: !reminder.is_enabled });
      loadReminders();
    } catch (error) {
      console.warn(error);
    }
  };

  const renderItem = ({ item }: { item: PlaceReminder }) => (
    <Card style={styles.card}>
      <View style={styles.cardHeader}>
        <View style={styles.titleContainer}>
          <Text style={[typography.h3, { color: colors.text }]}>{item.title}</Text>
          <Text style={[typography.caption, { color: colors.subtext }]}>{item.note}</Text>
        </View>
        <TouchableOpacity onPress={() => handleToggle(item)}>
          <MaterialCommunityIcons
            name={item.is_enabled ? 'bell-ring' : 'bell-off-outline'}
            size={24}
            color={item.is_enabled ? colors.accent : colors.subtext}
          />
        </TouchableOpacity>
      </View>
      <View style={styles.detailsContainer}>
        <View style={styles.detailRow}>
          <MaterialCommunityIcons name="map-marker-outline" size={16} color={colors.subtext} />
          <Text style={[typography.caption, { color: colors.subtext, marginLeft: 4 }]} numberOfLines={1}>
            {item.address || 'Unknown address'}
          </Text>
        </View>
        <View style={styles.detailRow}>
          <MaterialCommunityIcons name="radius-outline" size={16} color={colors.subtext} />
          <Text style={[typography.caption, { color: colors.subtext, marginLeft: 4 }]}>
            {item.radius_meters}m • {item.trigger_type}
          </Text>
        </View>
      </View>
      <View style={styles.actions}>
        <TouchableOpacity style={styles.actionBtn} onPress={() => handleDelete(item.id)}>
          <MaterialCommunityIcons name="trash-can-outline" size={20} color={colors.error} />
        </TouchableOpacity>
        <TouchableOpacity style={styles.actionBtn} onPress={() => navigation.navigate('EditPlaceReminder', { reminder: item })}>
          <MaterialCommunityIcons name="pencil-outline" size={20} color={colors.text} />
        </TouchableOpacity>
      </View>
    </Card>
  );

  return (
    <ScreenWrapper>
      <AppHeader title="Place Reminders" showBack />
      
      <View style={{ backgroundColor: colors.accent + '20', padding: spacing.sm, marginHorizontal: spacing.md, marginTop: spacing.md, borderRadius: borderRadius.md, flexDirection: 'row', alignItems: 'center' }}>
        <MaterialCommunityIcons name="information-outline" size={20} color={colors.accent} style={{ marginRight: spacing.sm }} />
        <Text style={[typography.caption, { color: colors.text, flex: 1 }]}>
          Note: Place reminders are currently in a foreground-only MVP phase and will only trigger while the app is open and active.
        </Text>
      </View>
      
      {reminders.length === 0 && !loading ? (
        <View style={styles.emptyContainer}>
          <MaterialCommunityIcons name="map-marker-radius-outline" size={64} color={colors.subtext} />
          <Text style={[typography.h3, { color: colors.text, marginTop: spacing.md }]}>No Reminders</Text>
          <Text style={[typography.body, { color: colors.subtext, textAlign: 'center', marginTop: spacing.sm, marginHorizontal: spacing.xl }]}>
            Get notified when you reach or pass a specific place. Add your first place reminder to get started.
          </Text>
        </View>
      ) : (
        <FlatList
          data={reminders}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          contentContainerStyle={{ padding: spacing.md, paddingBottom: 100 }}
        />
      )}

      <View style={[styles.fabContainer, { padding: spacing.md }]}>
        <AppButton
          title="+ Add Reminder"
          onPress={() => navigation.navigate('EditPlaceReminder')}
        />
      </View>
    </ScreenWrapper>
  );
}

const styles = StyleSheet.create({
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  fabContainer: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
  },
  card: {
    marginBottom: 12,
    padding: 16,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  titleContainer: {
    flex: 1,
    marginRight: 12,
  },
  detailsContainer: {
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: 'rgba(150,150,150,0.2)',
  },
  detailRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 4,
  },
  actions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    marginTop: 12,
  },
  actionBtn: {
    padding: 8,
    marginLeft: 8,
  },
});
