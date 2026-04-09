import notifee from '@notifee/react-native';

/**
 * Send a test notification to verify notification listener is working
 */
export const sendTestNotification = async () => {
  console.log('📱 [TestNotification] Starting to send test notification...');
  
  try {
    // Request permissions first
    console.log('📱 [TestNotification] Requesting notification permission...');
    await notifee.requestPermission();
    console.log('✅ [TestNotification] Permission granted');

    // Create a channel (required for Android)
    console.log('📱 [TestNotification] Creating notification channel...');
    const channelId = await notifee.createChannel({
      id: 'test',
      name: 'Test Notifications',
      importance: 4, // High importance
    });
    console.log('✅ [TestNotification] Channel created:', channelId);

    // Display a test notification that mimics a banking transaction
    console.log('📱 [TestNotification] Displaying notification...');
    await notifee.displayNotification({
      title: 'HDFC Bank',
      body: 'Rs 500.00 debited from A/c XX1234 on 07-Apr-26. UPI/PhonePe/9876543210. Avl Bal: Rs 10,500.00',
      android: {
        channelId,
        smallIcon: 'ic_launcher',
        importance: 4,
        pressAction: {
          id: 'default',
        },
      },
    });
    console.log('✅ [TestNotification] Test notification sent successfully!');

    return true;
  } catch (error) {
    console.error('❌ [TestNotification] Error sending test notification:', error);
    return false;
  }
};

/**
 * Send multiple test notifications for different scenarios
 * These mimic real bank SMS formats for proper parsing
 */
export const sendMultipleTestNotifications = async () => {
  console.log('📱 [TestNotification] Starting to send multiple test notifications...');
  
  try {
    console.log('📱 [TestNotification] Requesting notification permission...');
    await notifee.requestPermission();
    console.log('✅ [TestNotification] Permission granted');

    console.log('📱 [TestNotification] Creating notification channel...');
    const channelId = await notifee.createChannel({
      id: 'test',
      name: 'Test Notifications',
      importance: 4,
    });
    console.log('✅ [TestNotification] Channel created:', channelId);

    // Test notification 1: HDFC debit at Amazon (expense)
    console.log('📱 [TestNotification] Sending notification 1/4: HDFC Amazon Payment...');
    await notifee.displayNotification({
      title: 'HDFC Bank',
      body: 'Rs 850.00 debited from A/c XX9876 on 08-Apr-26. Paid at Amazon. Avl Bal: Rs 25,150.00',
      android: {
        channelId,
        smallIcon: 'ic_launcher',
      },
    });
    console.log('✅ [TestNotification] Notification 1/4 sent: HDFC Amazon');

    // Wait 2 seconds
    console.log('⏳ [TestNotification] Waiting 2 seconds...');
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Test notification 2: Google Pay credit (income)
    console.log('📱 [TestNotification] Sending notification 2/4: GPay Credit...');
    await notifee.displayNotification({
      title: 'Google Pay',
      body: 'You received Rs 1,200.00 from Rahul Sharma to A/c XX9876. Avl Bal: Rs 26,350.00',
      android: {
        channelId,
        smallIcon: 'ic_launcher',
      },
    });
    console.log('✅ [TestNotification] Notification 2/4 sent: GPay Credit');

    // Wait 2 seconds
    console.log('⏳ [TestNotification] Waiting 2 seconds...');
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Test notification 3: Slice card payment (expense)
    console.log('📱 [TestNotification] Sending notification 3/4: Slice Payment...');
    await notifee.displayNotification({
      title: 'slice',
      body: 'Payment of Rs 500 made at Swiggy using Slice card ending 4567. Available limit: Rs 45,150',
      android: {
        channelId,
        smallIcon: 'ic_launcher',
      },
    });
    console.log('✅ [TestNotification] Notification 3/4 sent: Slice Payment');

    // Wait 2 seconds
    console.log('⏳ [TestNotification] Waiting 2 seconds...');
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Test notification 4: Kotak UPI debit (expense)
    console.log('📱 [TestNotification] Sending notification 4/4: Kotak UPI...');
    await notifee.displayNotification({
      title: 'KOTAK BANK',
      body: 'Rs 300.00 debited from A/c XX1447 on 08-Apr-26. UPI/PhonePe/9876543210. Avl Bal: Rs 10,500.00',
      android: {
        channelId,
        smallIcon: 'ic_launcher',
      },
    });
    console.log('✅ [TestNotification] Notification 4/4 sent: Kotak UPI');

    console.log('🎉 [TestNotification] All test notifications sent successfully!');
    return true;
  } catch (error) {
    console.error('❌ [TestNotification] Error sending test notifications:', error);
    return false;
  }
};
