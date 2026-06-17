import notifee from '@notifee/react-native';
import { PeopleLedger } from '../../types';
import {
  cancelAllLedgerNotifications,
  scheduleLedgerNotifications,
} from './scheduledNotifications';

jest.mock('@notifee/react-native', () => ({
  __esModule: true,
  default: {
    requestPermission: jest.fn(() => Promise.resolve({ authorizationStatus: 1 })),
    getNotificationSettings: jest.fn(() => Promise.resolve({ authorizationStatus: 1 })),
    createChannel: jest.fn((channel) => Promise.resolve(channel.id)),
    createTriggerNotification: jest.fn(() => Promise.resolve()),
    displayNotification: jest.fn(() => Promise.resolve()),
    getTriggerNotificationIds: jest.fn(() => Promise.resolve([])),
    cancelNotification: jest.fn(() => Promise.resolve()),
    cancelAllNotifications: jest.fn(() => Promise.resolve()),
  },
  AndroidImportance: { DEFAULT: 3, HIGH: 4 },
  AuthorizationStatus: { DENIED: 0, AUTHORIZED: 1, PROVISIONAL: 2 },
  RepeatFrequency: { DAILY: 1 },
  TriggerType: { TIMESTAMP: 0 },
}));

jest.mock('../database/userdata', () => ({
  isOverdue: jest.fn((entry: PeopleLedger) => entry.id.startsWith('overdue')),
  isDueToday: jest.fn(() => false),
  getDaysUntilDue: jest.fn((entry: PeopleLedger) => (
    entry.id.startsWith('overdue') ? -2 : 3
  )),
}));

function ledgerEntry(id: string): PeopleLedger {
  return {
    id,
    user_id: 'user_test',
    person_name: 'PLACEHOLDER_PERSON',
    type: 'lent',
    total_amount: 100,
    paid_amount: 0,
    remaining_amount: 100,
    repayment_type: 'one_time',
    due_date: '2026-06-15',
    installment_amount: null,
    installment_days: null,
    start_date: null,
    notes: null,
    is_settled: false,
    settled_at: null,
    created_at: '2026-06-01T00:00:00.000Z',
  };
}

describe('scheduled notification safety', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (notifee.getNotificationSettings as jest.Mock).mockResolvedValue({ authorizationStatus: 1 });
    (notifee.getTriggerNotificationIds as jest.Mock).mockResolvedValue([]);
    (notifee.createTriggerNotification as jest.Mock).mockResolvedValue(undefined);
  });

  it('cancels only people-ledger reminders and preserves other notification families', async () => {
    (notifee.getTriggerNotificationIds as jest.Mock).mockResolvedValue([
      'overdue_1-overdue',
      'entry_1-reminder',
      'entry_2-due',
      'cc-reminder-card_1-7',
      'tx-meetup-transaction_1',
      'unrelated-notification',
    ]);

    await cancelAllLedgerNotifications();

    expect(notifee.cancelAllNotifications).not.toHaveBeenCalled();
    expect(notifee.cancelNotification).toHaveBeenCalledTimes(3);
    expect(notifee.cancelNotification).toHaveBeenCalledWith('overdue_1-overdue');
    expect(notifee.cancelNotification).toHaveBeenCalledWith('entry_1-reminder');
    expect(notifee.cancelNotification).toHaveBeenCalledWith('entry_2-due');
    expect(notifee.cancelNotification).not.toHaveBeenCalledWith('cc-reminder-card_1-7');
    expect(notifee.cancelNotification).not.toHaveBeenCalledWith('tx-meetup-transaction_1');
  });

  it('caps ledger scheduling and creates one summary reminder for overflow', async () => {
    const entries = Array.from({ length: 7 }, (_, index) => ledgerEntry(`overdue_${index}`));

    await scheduleLedgerNotifications(entries);

    expect(notifee.cancelAllNotifications).not.toHaveBeenCalled();
    expect(notifee.createTriggerNotification).toHaveBeenCalledTimes(6);

    const notificationIds = (notifee.createTriggerNotification as jest.Mock).mock.calls
      .map(([notification]) => notification.id);
    expect(notificationIds.filter((id: string) => id.endsWith('-overdue'))).toHaveLength(5);
    expect(notificationIds).toContain('people-ledger-summary');
  });

  it('does not schedule or cancel in bulk when notification permission is denied', async () => {
    (notifee.getNotificationSettings as jest.Mock).mockResolvedValue({ authorizationStatus: 0 });

    await scheduleLedgerNotifications([ledgerEntry('overdue_permission')]);

    expect(notifee.getTriggerNotificationIds).not.toHaveBeenCalled();
    expect(notifee.cancelNotification).not.toHaveBeenCalled();
    expect(notifee.createTriggerNotification).not.toHaveBeenCalled();
  });
});
