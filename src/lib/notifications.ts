import notifee, { TriggerType, RepeatFrequency, AndroidImportance } from '@notifee/react-native';
import { PeopleLedger } from '../types';
import { isOverdue, isDueToday, getDaysUntilDue } from './peopleLedger';

/**
 * Request notification permissions
 */
export async function requestNotificationPermission() {
  await notifee.requestPermission();
}

/**
 * Create notification channel for Android
 */
export async function createNotificationChannel() {
  await notifee.createChannel({
    id: 'people-ledger',
    name: 'People Ledger Reminders',
    importance: AndroidImportance.HIGH,
  });
}

/**
 * Schedule daily notifications for all active ledger entries
 */
export async function scheduleLedgerNotifications(entries: PeopleLedger[]) {
  // Cancel all existing notifications first
  await notifee.cancelAllNotifications();

  // Create channel
  await createNotificationChannel();

  const now = new Date();
  const scheduledTime = new Date();
  scheduledTime.setHours(9, 0, 0, 0); // 9:00 AM

  // If it's already past 9 AM today, schedule for tomorrow
  if (now > scheduledTime) {
    scheduledTime.setDate(scheduledTime.getDate() + 1);
  }

  for (const entry of entries) {
    if (entry.is_settled) continue;

    // One-time due notifications
    if (entry.repayment_type === 'one_time' && entry.due_date) {
      const dueDate = new Date(entry.due_date);
      dueDate.setHours(9, 0, 0, 0);

      if (dueDate >= now) {
        const daysUntil = getDaysUntilDue(entry);
        
        // Notification on due date
        await notifee.createTriggerNotification(
          {
            id: `${entry.id}-due`,
            title: '⚠️ Payment Due Today',
            body: `${entry.person_name} needs to ${entry.type === 'lent' ? 'return' : 'receive'} ₹${Number(entry.remaining_amount).toFixed(0)} today!`,
            android: {
              channelId: 'people-ledger',
              importance: AndroidImportance.HIGH,
            },
          },
          {
            type: TriggerType.TIMESTAMP,
            timestamp: dueDate.getTime(),
          }
        );

        // Reminder 1 day before
        if (daysUntil && daysUntil > 1) {
          const reminderDate = new Date(dueDate);
          reminderDate.setDate(reminderDate.getDate() - 1);

          await notifee.createTriggerNotification(
            {
              id: `${entry.id}-reminder`,
              title: '📅 Payment Due Tomorrow',
              body: `${entry.person_name} - ₹${Number(entry.remaining_amount).toFixed(0)} due tomorrow`,
              android: {
                channelId: 'people-ledger',
                importance: AndroidImportance.DEFAULT,
              },
            },
            {
              type: TriggerType.TIMESTAMP,
              timestamp: reminderDate.getTime(),
            }
          );
        }
      }
    }

    // Installment reminders
    if (entry.repayment_type === 'installment' && entry.installment_amount) {
      const installmentDays = entry.installment_days || ['mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
      const dayMap: { [key: string]: number } = {
        sun: 0,
        mon: 1,
        tue: 2,
        wed: 3,
        thu: 4,
        fri: 5,
        sat: 6,
      };

      // Check if today is an installment day
      const todayDay = now.getDay();
      const todayDayName = Object.keys(dayMap).find(key => dayMap[key] === todayDay);
      
      if (todayDayName && installmentDays.includes(todayDayName)) {
        // Schedule daily repeating notification
        await notifee.createTriggerNotification(
          {
            id: `${entry.id}-installment`,
            title: '💰 Daily Installment Reminder',
            body: `${entry.person_name}'s daily ₹${entry.installment_amount} — ₹${Number(entry.remaining_amount).toFixed(0)} remaining`,
            android: {
              channelId: 'people-ledger',
              importance: AndroidImportance.DEFAULT,
            },
          },
          {
            type: TriggerType.TIMESTAMP,
            timestamp: scheduledTime.getTime(),
            repeatFrequency: RepeatFrequency.DAILY,
          }
        );
      }
    }

    // Overdue notifications
    if (isOverdue(entry)) {
      const daysOverdue = Math.abs(getDaysUntilDue(entry) || 0);
      
      await notifee.createTriggerNotification(
        {
          id: `${entry.id}-overdue`,
          title: '🔴 Payment Overdue',
          body: `${entry.person_name} payment overdue by ${daysOverdue} days! ₹${Number(entry.remaining_amount).toFixed(0)} pending`,
          android: {
            channelId: 'people-ledger',
            importance: AndroidImportance.HIGH,
          },
        },
        {
          type: TriggerType.TIMESTAMP,
          timestamp: scheduledTime.getTime(),
          repeatFrequency: RepeatFrequency.DAILY,
        }
      );
    }
  }
}

/**
 * Show immediate notification for overdue/due today entries
 */
export async function showImmediateReminder(entries: PeopleLedger[]) {
  const overdueEntries = entries.filter(isOverdue);
  const dueTodayEntries = entries.filter(isDueToday);

  if (overdueEntries.length > 0) {
    const entry = overdueEntries[0];
    await notifee.displayNotification({
      title: '🔴 Overdue Payment',
      body: `${entry.person_name} - ₹${Number(entry.remaining_amount).toFixed(0)} overdue`,
      android: {
        channelId: 'people-ledger',
        importance: AndroidImportance.HIGH,
      },
    });
  } else if (dueTodayEntries.length > 0) {
    const entry = dueTodayEntries[0];
    await notifee.displayNotification({
      title: '⚠️ Payment Due Today',
      body: `${entry.person_name} - ₹${Number(entry.remaining_amount).toFixed(0)} due today`,
      android: {
        channelId: 'people-ledger',
        importance: AndroidImportance.DEFAULT,
      },
    });
  }
}

/**
 * Cancel all scheduled notifications
 */
export async function cancelAllLedgerNotifications() {
  await notifee.cancelAllNotifications();
}
