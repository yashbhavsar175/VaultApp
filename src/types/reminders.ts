// Shared types for the reminder dependency injection pattern.
// These break the circular dependency between notifications.ts,
// scheduledNotifications.ts, and TransactionReminderModal.tsx.

export interface TransactionReminderPayload {
  transactionId: string;
  scheduledAt: string; // ISO string
  note: string;
}

export type ScheduleTransactionReminderFn = (
  transactionId: string,
  amount: number,
  note: string,
  reminderTime: Date
) => Promise<void>;

export type StoreTransactionReminderFn = (
  payload: TransactionReminderPayload
) => Promise<void>;
