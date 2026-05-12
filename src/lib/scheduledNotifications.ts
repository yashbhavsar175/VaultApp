/**
 * Scheduled Notifications — Consolidated
 * Merged from: notifications.ts, ccNotifications.ts
 * 
 * All scheduled notification helpers (people ledger + credit card reminders).
 */

import notifee, { TriggerType, RepeatFrequency, AndroidImportance, TimestampTrigger } from '@notifee/react-native';
import { PeopleLedger } from '../types';
import { isOverdue, isDueToday, getDaysUntilDue } from './database/userdata';
import { CreditCard, getCCDaysUntilDue } from './database/financial';

// ─── Channels ───────────────────────────────────────────────────────────────────

async function ensurePeopleLedgerChannel() {
  await notifee.createChannel({
    id: 'people-ledger',
    name: 'People Ledger Reminders',
    importance: AndroidImportance.HIGH,
  });
}

async function ensureCreditCardChannel(): Promise<string> {
  return notifee.createChannel({
    id: 'cc-reminders',
    name: 'Credit Card Reminders',
    importance: AndroidImportance.HIGH,
    sound: 'default',
    vibration: true,
  });
}

// ─── Permissions ────────────────────────────────────────────────────────────────

export async function requestNotificationPermission() {
  await notifee.requestPermission();
}

// ─── People Ledger Notifications ────────────────────────────────────────────────

/**
 * Schedule daily notifications for all active ledger entries
 */
export async function scheduleLedgerNotifications(entries: PeopleLedger[]) {
  // Cancel all existing notifications first
  await notifee.cancelAllNotifications();
  await ensurePeopleLedgerChannel();

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
            android: { channelId: 'people-ledger', importance: AndroidImportance.HIGH },
          },
          { type: TriggerType.TIMESTAMP, timestamp: dueDate.getTime() }
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
              android: { channelId: 'people-ledger', importance: AndroidImportance.DEFAULT },
            },
            { type: TriggerType.TIMESTAMP, timestamp: reminderDate.getTime() }
          );
        }
      }
    }

    // Installment reminders
    if (entry.repayment_type === 'installment' && entry.installment_amount) {
      const installmentDays = entry.installment_days || ['mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
      const dayMap: { [key: string]: number } = {
        sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6,
      };

      const todayDay = now.getDay();
      const todayDayName = Object.keys(dayMap).find(key => dayMap[key] === todayDay);
      
      if (todayDayName && installmentDays.includes(todayDayName)) {
        await notifee.createTriggerNotification(
          {
            id: `${entry.id}-installment`,
            title: '💰 Daily Installment Reminder',
            body: `${entry.person_name}'s daily ₹${entry.installment_amount} — ₹${Number(entry.remaining_amount).toFixed(0)} remaining`,
            android: { channelId: 'people-ledger', importance: AndroidImportance.DEFAULT },
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
          android: { channelId: 'people-ledger', importance: AndroidImportance.HIGH },
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
      android: { channelId: 'people-ledger', importance: AndroidImportance.HIGH },
    });
  } else if (dueTodayEntries.length > 0) {
    const entry = dueTodayEntries[0];
    await notifee.displayNotification({
      title: '⚠️ Payment Due Today',
      body: `${entry.person_name} - ₹${Number(entry.remaining_amount).toFixed(0)} due today`,
      android: { channelId: 'people-ledger', importance: AndroidImportance.DEFAULT },
    });
  }
}

/**
 * Cancel all scheduled notifications
 */
export async function cancelAllLedgerNotifications() {
  await notifee.cancelAllNotifications();
}

// ─── Credit Card Notifications ──────────────────────────────────────────────────

/**
 * Schedule due date reminders for a credit card
 */
export async function scheduleDueReminders(card: CreditCard): Promise<void> {
  try {
    const channelId = await ensureCreditCardChannel();

    const daysUntilDue = getCCDaysUntilDue(card.due_date);
    const now = new Date();

    const notifications = [
      { days: 7, title: 'Credit Card Due Soon', priority: 'normal' },
      { days: 3, title: 'Credit Card Due in 3 Days!', priority: 'high' },
      { days: 0, title: 'Credit Card Due Today!', priority: 'urgent' },
    ];

    for (const notif of notifications) {
      if (daysUntilDue >= notif.days) {
        const triggerDate = new Date(now);
        triggerDate.setDate(triggerDate.getDate() + (daysUntilDue - notif.days));
        triggerDate.setHours(10, 0, 0, 0); // 10 AM

        const trigger: TimestampTrigger = {
          type: TriggerType.TIMESTAMP,
          timestamp: triggerDate.getTime(),
        };

        await notifee.createTriggerNotification(
          {
            id: `cc-reminder-${card.id}-${notif.days}`,
            title: notif.title,
            body: `${card.bank_name} •••• ${card.last_4_digits}\nOutstanding: ₹${card.current_outstanding.toFixed(0)}`,
            android: {
              channelId,
              importance: notif.priority === 'urgent' ? AndroidImportance.HIGH : AndroidImportance.DEFAULT,
              pressAction: { id: 'default' },
              smallIcon: 'ic_launcher',
            },
          },
          trigger
        );
      }
    }
  } catch (error) {
    console.error('Error scheduling CC reminders:', error);
  }
}

/**
 * Cancel all reminders for a card
 */
export async function cancelCardReminders(cardId: string): Promise<void> {
  try {
    const notifications = await notifee.getTriggerNotificationIds();
    const cardNotifications = notifications.filter(id => id.startsWith(`cc-reminder-${cardId}`));
    
    for (const notifId of cardNotifications) {
      await notifee.cancelNotification(notifId);
    }
  } catch (error) {
    console.error('Error cancelling CC reminders:', error);
  }
}

/**
 * Reschedule all reminders (call when card is updated)
 */
export async function rescheduleCardReminders(card: CreditCard): Promise<void> {
  await cancelCardReminders(card.id);
  await scheduleDueReminders(card);
}
