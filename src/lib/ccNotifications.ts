import notifee, { AndroidImportance, TriggerType, TimestampTrigger } from '@notifee/react-native';
import { CreditCard, getDaysUntilDue } from './creditCards';

// Schedule due date reminders for a card
export async function scheduleDueReminders(card: CreditCard): Promise<void> {
  try {
    // Create notification channel
    const channelId = await notifee.createChannel({
      id: 'cc-reminders',
      name: 'Credit Card Reminders',
      importance: AndroidImportance.HIGH,
      sound: 'default',
      vibration: true,
    });

    const daysUntilDue = getDaysUntilDue(card.due_date);
    const now = new Date();

    // Calculate notification dates
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
              importance: notif.priority === 'urgent' 
                ? AndroidImportance.HIGH 
                : AndroidImportance.DEFAULT,
              pressAction: {
                id: 'default',
              },
              smallIcon: 'ic_launcher',
            },
          },
          trigger
        );
      }
    }

    console.log(`Scheduled reminders for card ${card.last_4_digits}`);
  } catch (error) {
    console.error('Error scheduling reminders:', error);
  }
}

// Cancel all reminders for a card
export async function cancelCardReminders(cardId: string): Promise<void> {
  try {
    const notifications = await notifee.getTriggerNotificationIds();
    const cardNotifications = notifications.filter(id => id.startsWith(`cc-reminder-${cardId}`));
    
    for (const notifId of cardNotifications) {
      await notifee.cancelNotification(notifId);
    }
    
    console.log(`Cancelled ${cardNotifications.length} reminders for card ${cardId}`);
  } catch (error) {
    console.error('Error cancelling reminders:', error);
  }
}

// Reschedule all reminders (call this when card is updated)
export async function rescheduleCardReminders(card: CreditCard): Promise<void> {
  await cancelCardReminders(card.id);
  await scheduleDueReminders(card);
}
