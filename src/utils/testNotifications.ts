import notifee, { AndroidImportance, AuthorizationStatus } from '@notifee/react-native';

// Request notification permissions
export const requestNotificationPermission = async () => {
  const settings = await notifee.requestPermission();
  
  if (settings.authorizationStatus >= AuthorizationStatus.AUTHORIZED) {
    console.log('Notification permission granted');
    return true;
  } else {
    console.log('Notification permission denied');
    return false;
  }
};

// Test notification utility for development
export const sendTestNotification = async (type: 'debit' | 'credit') => {
  // Request permission first
  const hasPermission = await requestNotificationPermission();
  if (!hasPermission) {
    console.log('Cannot send notification - permission denied');
    return;
  }

  // Create a channel for test notifications
  const channelId = await notifee.createChannel({
    id: 'test-sms',
    name: 'Test SMS Notifications',
    importance: AndroidImportance.HIGH,
    sound: 'default',
    vibration: true,
  });

  const testMessages = {
    debit: {
      title: 'Test Debit SMS',
      body: 'Rs.2,500.00 debited from A/c XX1234 on 28-Mar-26. UPI/Amazon/123456789. Avl Bal: Rs.15,000.00',
      sender: 'VM-TESTBANK',
    },
    credit: {
      title: 'Test Credit SMS',
      body: 'Rs.5,000.00 credited to A/c XX1234 on 28-Mar-26. UPI/SALARY/987654321. Avl Bal: Rs.20,000.00',
      sender: 'VM-TESTBANK',
    },
  };

  const message = testMessages[type];

  await notifee.displayNotification({
    title: message.title,
    body: message.body,
    android: {
      channelId,
      importance: AndroidImportance.HIGH,
      pressAction: {
        id: 'default',
      },
      smallIcon: 'ic_launcher',
      sound: 'default',
      vibrationPattern: [300, 500],
      showTimestamp: true,
    },
    data: {
      sender: message.sender,
      body: message.body,
      isTest: 'true',
    },
  });

  console.log(`Test ${type} notification sent`);
};

// Send both test notifications
export const sendBothTestNotifications = async () => {
  await sendTestNotification('debit');
  
  // Wait 2 seconds before sending second notification
  setTimeout(async () => {
    await sendTestNotification('credit');
  }, 2000);
};
