/**
 * Scheduled Notifications — Consolidated
 * Merged from: notifications.ts, ccNotifications.ts
 * 
 * All scheduled notification helpers (people ledger + credit card reminders).
 */

import notifee, {
  TriggerType,
  RepeatFrequency,
  AndroidImportance,
  AuthorizationStatus,
  TimestampTrigger,
} from '@notifee/react-native';
import { Platform } from 'react-native';
import { PeopleLedger } from '../../types';
import { isOverdue, isDueToday, getDaysUntilDue } from '../database/userdata';
import { CreditCard, getCCDaysUntilDue } from '../database/financial';

const CHANNELS = {
  PEOPLE_LEDGER: 'people-ledger',
  CREDIT_CARD: 'cc-reminders',
  TRANSACTION_REMINDER: 'transaction-reminders',
} as const;

const REMINDER_TIMES = {
  PEOPLE_MORNING: { hour: 9, minute: 0 },
  CREDIT_CARD_LATE_MORNING: { hour: 10, minute: 0 },
} as const;

const MAX_LEDGER_NOTIFICATIONS = 5;
const LEDGER_SUMMARY_ID = 'people-ledger-summary';
const LEDGER_NOTIFICATION_SUFFIXES = ['-due', '-reminder', '-installment', '-overdue'] as const;
const NON_LEDGER_NOTIFICATION_PREFIXES = ['cc-reminder-', 'tx-meetup-'] as const;

type AndroidPermissionOptions = Parameters<typeof notifee.requestPermission>[0] & {
  alarm?: boolean;
};

interface LedgerNotificationPlan {
  id: string;
  priority: number;
  notification: Parameters<typeof notifee.createTriggerNotification>[0];
  trigger: TimestampTrigger;
}

// ─── Channels ───────────────────────────────────────────────────────────────────

async function ensurePeopleLedgerChannel() {
  await notifee.createChannel({
    id: CHANNELS.PEOPLE_LEDGER,
    name: 'People Ledger Reminders',
    importance: AndroidImportance.HIGH,
  });
}

async function ensureCreditCardChannel(): Promise<string> {
  return notifee.createChannel({
    id: CHANNELS.CREDIT_CARD,
    name: 'Credit Card Reminders',
    importance: AndroidImportance.HIGH,
    sound: 'default',
    vibration: true,
  });
}

async function ensureAllChannels(): Promise<void> {
  await Promise.all([
    ensurePeopleLedgerChannel(),
    ensureCreditCardChannel(),
    ensureTransactionReminderChannel(),
  ]);
}

// ─── Shared Helpers ─────────────────────────────────────────────────────────────

function safeErrorCode(error: unknown): string {
  if (!error || typeof error !== 'object') return 'unknown_error';
  const code = (error as { code?: unknown; name?: unknown; status?: unknown }).code
    || (error as { name?: unknown }).name
    || (error as { status?: unknown }).status;
  return typeof code === 'string' || typeof code === 'number'
    ? String(code).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 48) || 'unknown_error'
    : 'unknown_error';
}

function suffixId(value?: string | null): string {
  const safe = value?.replace(/[^A-Za-z0-9_-]/g, '');
  return safe ? safe.slice(-8) : 'unknown';
}

function getNextNotificationTime(hour: number, minute = 0, from = new Date()): Date {
  const target = new Date(from);
  target.setHours(hour, minute, 0, 0);
  if (target <= from) target.setDate(target.getDate() + 1);
  return target;
}

function isLedgerNotificationId(id: string): boolean {
  if (id === LEDGER_SUMMARY_ID) return true;
  if (NON_LEDGER_NOTIFICATION_PREFIXES.some(prefix => id.startsWith(prefix))) return false;
  return LEDGER_NOTIFICATION_SUFFIXES.some(suffix => id.endsWith(suffix));
}

async function cancelLedgerNotifications(): Promise<void> {
  const pendingIds = await notifee.getTriggerNotificationIds();
  const ledgerIds = pendingIds.filter(isLedgerNotificationId);
  await Promise.all(ledgerIds.map(id => notifee.cancelNotification(id)));
}

async function canScheduleNotifications(): Promise<boolean> {
  try {
    const settings = await notifee.getNotificationSettings();
    const status = settings?.authorizationStatus;
    return status === AuthorizationStatus.AUTHORIZED || status === AuthorizationStatus.PROVISIONAL;
  } catch (error) {
    if (__DEV__) console.warn('[Notifee] Notification settings unavailable', {
      errorCode: safeErrorCode(error),
    });
    return false;
  }
}

async function showSchedulingFailureSummary(
  failureCount: number,
  channelId: string
): Promise<void> {
  try {
    await notifee.displayNotification({
      title: 'Reminder scheduling issue',
      body: `${failureCount} reminder${failureCount === 1 ? '' : 's'} could not be scheduled. Open the app to review notification settings.`,
      android: {
        channelId,
        importance: AndroidImportance.DEFAULT,
        pressAction: { id: 'default' },
      },
    });
  } catch (error) {
    if (__DEV__) console.warn('[Notifee] Could not show scheduling failure summary', {
      errorCode: safeErrorCode(error),
    });
  }
}

function hasValidLedgerFields(entry: PeopleLedger): boolean {
  return Boolean(
    entry.id &&
    entry.person_name &&
    Number.isFinite(Number(entry.remaining_amount)) &&
    Number(entry.remaining_amount) > 0
  );
}

function makeLedgerTrigger(timestamp: number, repeatFrequency?: RepeatFrequency): TimestampTrigger {
  return {
    type: TriggerType.TIMESTAMP,
    timestamp,
    ...(repeatFrequency ? { repeatFrequency } : {}),
    alarmManager: { allowWhileIdle: true },
  } as TimestampTrigger;
}

// ─── Permissions ────────────────────────────────────────────────────────────────

export async function requestNotificationPermission() {
  await notifee.requestPermission();
  // Android 12+: Request SCHEDULE_EXACT_ALARM permission so
  // TimestampTrigger fires precisely even in Doze mode
  if (Platform.OS === 'android') {
    try {
      const requestAndroidPermission = notifee.requestPermission as (
        permissions?: AndroidPermissionOptions
      ) => ReturnType<typeof notifee.requestPermission>;
      await requestAndroidPermission({ alarm: true });
    } catch (e) {
      if (__DEV__) console.warn('[Notifee] Exact alarm permission request failed', {
        errorCode: safeErrorCode(e),
      });
    }
  }
}

export async function initializeScheduledNotificationChannels(): Promise<void> {
  await ensureAllChannels();
}

// ─── People Ledger Notifications ────────────────────────────────────────────────

function buildLedgerNotificationPlans(entries: PeopleLedger[]): LedgerNotificationPlan[] {
  const now = new Date();
  const scheduledTime = getNextNotificationTime(
    REMINDER_TIMES.PEOPLE_MORNING.hour,
    REMINDER_TIMES.PEOPLE_MORNING.minute,
    now
  );
  const dayMap: { [key: string]: number } = {
    sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6,
  };
  const todayDayName = Object.keys(dayMap).find(key => dayMap[key] === now.getDay());
  const plans: LedgerNotificationPlan[] = [];

  for (const entry of entries) {
    if (entry.is_settled || !hasValidLedgerFields(entry)) continue;

    if (entry.repayment_type === 'one_time' && entry.due_date) {
      const dueDate = new Date(entry.due_date);
      if (Number.isFinite(dueDate.getTime())) {
        dueDate.setHours(
          REMINDER_TIMES.PEOPLE_MORNING.hour,
          REMINDER_TIMES.PEOPLE_MORNING.minute,
          0,
          0
        );

        if (dueDate >= now) {
          const daysUntil = getDaysUntilDue(entry);

          plans.push({
            id: `${entry.id}-due`,
            priority: daysUntil === 0 ? 100 : 80,
            notification: {
              id: `${entry.id}-due`,
              title: 'Payment Due Today',
              body: `${entry.person_name} needs to ${entry.type === 'lent' ? 'return' : 'receive'} ₹${Number(entry.remaining_amount).toFixed(0)} today`,
              android: { channelId: CHANNELS.PEOPLE_LEDGER, importance: AndroidImportance.HIGH },
            },
            trigger: makeLedgerTrigger(dueDate.getTime()),
          });

          if (daysUntil && daysUntil > 1) {
            const reminderDate = new Date(dueDate);
            reminderDate.setDate(reminderDate.getDate() - 1);
            plans.push({
              id: `${entry.id}-reminder`,
              priority: 60,
              notification: {
                id: `${entry.id}-reminder`,
                title: 'Payment Due Tomorrow',
                body: `${entry.person_name} - ₹${Number(entry.remaining_amount).toFixed(0)} due tomorrow`,
                android: { channelId: CHANNELS.PEOPLE_LEDGER, importance: AndroidImportance.DEFAULT },
              },
              trigger: makeLedgerTrigger(reminderDate.getTime()),
            });
          }
        }
      }
    }

    if (entry.repayment_type === 'installment' && entry.installment_amount) {
      const installmentDays = entry.installment_days || ['mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
      if (todayDayName && installmentDays.includes(todayDayName)) {
        plans.push({
          id: `${entry.id}-installment`,
          priority: 40,
          notification: {
            id: `${entry.id}-installment`,
            title: 'Daily Installment Reminder',
            body: `${entry.person_name}'s daily ₹${Number(entry.installment_amount).toFixed(0)} - ₹${Number(entry.remaining_amount).toFixed(0)} remaining`,
            android: { channelId: CHANNELS.PEOPLE_LEDGER, importance: AndroidImportance.DEFAULT },
          },
          trigger: makeLedgerTrigger(scheduledTime.getTime()),
        });
      }
    }

    if (isOverdue(entry)) {
      const daysOverdue = Math.abs(getDaysUntilDue(entry) || 0);
      plans.push({
        id: `${entry.id}-overdue`,
        priority: 120,
        notification: {
          id: `${entry.id}-overdue`,
          title: 'Payment Overdue',
          body: `${entry.person_name} payment overdue by ${daysOverdue} days. ₹${Number(entry.remaining_amount).toFixed(0)} pending`,
          android: { channelId: CHANNELS.PEOPLE_LEDGER, importance: AndroidImportance.HIGH },
        },
        trigger: makeLedgerTrigger(scheduledTime.getTime(), RepeatFrequency.DAILY),
      });
    }
  }

  return plans.sort((a, b) => b.priority - a.priority);
}

function buildLedgerSummaryPlan(hiddenPlansCount: number, entries: PeopleLedger[]): LedgerNotificationPlan | null {
  if (hiddenPlansCount <= 0) return null;
  const totalPending = entries
    .filter(entry => !entry.is_settled && hasValidLedgerFields(entry))
    .reduce((sum, entry) => sum + Number(entry.remaining_amount), 0);
  const scheduledTime = getNextNotificationTime(
    REMINDER_TIMES.PEOPLE_MORNING.hour,
    REMINDER_TIMES.PEOPLE_MORNING.minute
  );

  return {
    id: LEDGER_SUMMARY_ID,
    priority: 10,
    notification: {
      id: LEDGER_SUMMARY_ID,
      title: `${hiddenPlansCount} more payment reminders`,
      body: `Total pending across ledger: ₹${totalPending.toFixed(0)}. Open People to review all.`,
      android: {
        channelId: CHANNELS.PEOPLE_LEDGER,
        importance: AndroidImportance.DEFAULT,
        pressAction: { id: 'default' },
      },
    },
    trigger: makeLedgerTrigger(scheduledTime.getTime()),
  };
}

/**
 * Schedule daily notifications for all active ledger entries
 */
export async function scheduleLedgerNotifications(entries: PeopleLedger[]) {
  if (!(await canScheduleNotifications())) return;

  await cancelLedgerNotifications();
  await ensurePeopleLedgerChannel();

  const plans = buildLedgerNotificationPlans(entries);
  const visiblePlans = plans.slice(0, MAX_LEDGER_NOTIFICATIONS);
  const summaryPlan = buildLedgerSummaryPlan(plans.length - visiblePlans.length, entries);
  const plansToSchedule = summaryPlan ? [...visiblePlans, summaryPlan] : visiblePlans;
  let failureCount = 0;

  for (const plan of plansToSchedule) {
    try {
      await notifee.createTriggerNotification(plan.notification, plan.trigger);
    } catch (e) {
      failureCount += 1;
      if (__DEV__) console.warn('[Notifee] Could not schedule ledger reminder', {
        notificationIdSuffix: suffixId(plan.id),
        errorCode: safeErrorCode(e),
      });
    }
  }

  if (failureCount > 0) {
    await showSchedulingFailureSummary(failureCount, CHANNELS.PEOPLE_LEDGER);
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
      title: 'Overdue Payment',
      body: `${entry.person_name} - ₹${Number(entry.remaining_amount).toFixed(0)} overdue`,
      android: { channelId: CHANNELS.PEOPLE_LEDGER, importance: AndroidImportance.HIGH },
    });
  } else if (dueTodayEntries.length > 0) {
    const entry = dueTodayEntries[0];
    await notifee.displayNotification({
      title: 'Payment Due Today',
      body: `${entry.person_name} - ₹${Number(entry.remaining_amount).toFixed(0)} due today`,
      android: { channelId: CHANNELS.PEOPLE_LEDGER, importance: AndroidImportance.DEFAULT },
    });
  }
}

/**
 * Cancel all scheduled people-ledger notifications.
 */
export async function cancelAllLedgerNotifications() {
  await cancelLedgerNotifications();
}

// ─── Credit Card Notifications ──────────────────────────────────────────────────

/**
 * Schedule due date reminders for a credit card
 */
export async function scheduleDueReminders(card: CreditCard): Promise<void> {
  try {
    if (!(await canScheduleNotifications())) return;

    const channelId = await ensureCreditCardChannel();

    const daysUntilDue = getCCDaysUntilDue(card.due_date);

    const notifications = [
      { days: 7, title: 'Credit Card Due Soon', priority: 'normal' },
      { days: 3, title: 'Credit Card Due in 3 Days!', priority: 'high' },
      { days: 0, title: 'Credit Card Due Today!', priority: 'urgent' },
    ];

    for (const notif of notifications) {
      if (daysUntilDue >= notif.days) {
        const triggerDate = getNextNotificationTime(
          REMINDER_TIMES.CREDIT_CARD_LATE_MORNING.hour,
          REMINDER_TIMES.CREDIT_CARD_LATE_MORNING.minute
        );
        triggerDate.setDate(triggerDate.getDate() + (daysUntilDue - notif.days));

        const trigger: TimestampTrigger = {
          type: TriggerType.TIMESTAMP,
          timestamp: triggerDate.getTime(),
          alarmManager: { allowWhileIdle: true }, // Fires in Doze mode (Android 12+)
        };

        try {
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
        } catch (e) {
          if (__DEV__) console.warn('[Notifee] Could not schedule CC reminder', {
            cardIdSuffix: suffixId(card.id),
            daysBeforeDue: notif.days,
            errorCode: safeErrorCode(e),
          });
        }
      }
    }
  } catch (error) {
    if (__DEV__) console.error('Error scheduling CC reminders:', {
      errorCode: safeErrorCode(error),
    });
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
    if (__DEV__) console.error('Error cancelling CC reminders:', {
      errorCode: safeErrorCode(error),
    });
  }
}

/**
 * Reschedule all reminders (call when card is updated)
 */
export async function rescheduleCardReminders(card: CreditCard): Promise<void> {
  await cancelCardReminders(card.id);
  await scheduleDueReminders(card);
}

// ─── Transaction Meetup Reminders ───────────────────────────────────────────────

async function ensureTransactionReminderChannel() {
  await notifee.createChannel({
    id: CHANNELS.TRANSACTION_REMINDER,
    name: 'Transaction Meetup Reminders',
    importance: AndroidImportance.HIGH,
    sound: 'default',
    vibration: true,
  });
}

function getTransactionReminderId(transactionId: string): string {
  return `tx-meetup-${transactionId}`;
}

/**
 * Schedule a meetup reminder notification for a specific transaction.
 * @param transactionId  The transaction's unique ID
 * @param amount         Transaction amount (for display in notification)
 * @param note           Transaction note / person name
 * @param reminderTime   Date object representing when to fire the notification
 */
export async function scheduleTransactionReminder(
  transactionId: string,
  amount: number,
  note: string,
  reminderTime: Date,
): Promise<void> {
  await ensureTransactionReminderChannel();
  await requestNotificationPermission();
  if (!(await canScheduleNotifications())) {
    throw new Error('Notification permission denied');
  }

  const notifId = getTransactionReminderId(transactionId);

  // Cancel any existing reminder for this transaction first
  try {
    await notifee.cancelNotification(notifId);
  } catch {
    // ignore — notification may not exist yet
  }

  const amountStr = `₹${Number(amount).toFixed(0)}`;

  await notifee.createTriggerNotification(
    {
      id: notifId,
      title: '💸 Action Required: Meetup Reminder',
      body: `${note} — You need to recover ${amountStr}. Don't forget to ask them now!`,
      android: {
        channelId: CHANNELS.TRANSACTION_REMINDER,
        importance: AndroidImportance.HIGH,
        pressAction: { id: 'default' },
        smallIcon: 'ic_launcher',
      },
    },
    {
      type: TriggerType.TIMESTAMP,
      timestamp: reminderTime.getTime(),
      alarmManager: { allowWhileIdle: true },
    } as TimestampTrigger,
  );
}

/**
 * Cancel a previously scheduled meetup reminder for a transaction.
 */
export async function cancelTransactionReminder(transactionId: string): Promise<void> {
  const notifId = getTransactionReminderId(transactionId);
  try {
    await notifee.cancelNotification(notifId);
  } catch (e) {
    if (__DEV__) console.warn('[Notifee] cancelTransactionReminder failed', {
      notificationIdSuffix: suffixId(notifId),
      errorCode: safeErrorCode(e),
    });
  }
}

/**
 * Check whether a trigger notification is still scheduled for a given transaction.
 * Returns true if the reminder exists in the trigger queue.
 */
export async function isTransactionReminderScheduled(transactionId: string): Promise<boolean> {
  const notifId = getTransactionReminderId(transactionId);
  const ids = await notifee.getTriggerNotificationIds();
  return ids.includes(notifId);
}
