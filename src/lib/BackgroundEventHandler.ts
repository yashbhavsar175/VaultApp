/**
 * Background Event Handler
 * Handles events when app is in background or closed
 */

import notifee, { EventType } from '@notifee/react-native';
import RNAndroidNotificationListener from 'react-native-android-notification-listener';
import { handleTransactionNotificationEvent } from './transactionNotifications';

/**
 * Background event handler for Notifee
 * This runs even when the app is closed
 */
export async function onBackgroundEvent(event: any) {
  const { type, detail } = event;
  console.log('🔔 [Background] Notifee event received:', type);
  
  // Handle transaction notification actions (delete, ok)
  if (type === EventType.ACTION_PRESS || type === EventType.PRESS) {
    const action = detail?.notification?.data?.action;
    
    if (action === 'transaction_confirmation' || action === 'sms_failed') {
      await handleTransactionNotificationEvent(event);
      return;
    }
  }
  
  // Handle notification events in background
  if (type === EventType.DELIVERED) {
    console.log('📬 [Background] Notification delivered');
  }
}

/**
 * Initialize foreground listeners for notifee
 * Call this inside a useEffect in the main App component
 */
export function initializeForegroundListener() {
  return notifee.onForegroundEvent(async (event) => {
    const { type, detail } = event;
    console.log('🔔 [Foreground] Notifee event received:', type);
    
    if (type === EventType.ACTION_PRESS || type === EventType.PRESS) {
      const action = detail?.notification?.data?.action;
      
      if (action === 'transaction_confirmation' || action === 'sms_failed') {
        await handleTransactionNotificationEvent(event);
      }
    }
  });
}

/**
 * Initialize background listeners
 * Call this when app starts to ensure listeners are active
 */
export async function initializeBackgroundListeners() {
  console.log('🚀 [Background] Initializing background listeners...');
  
  try {
    // Check if notification listener permission is granted
    const hasPermission = await RNAndroidNotificationListener.getPermissionStatus();
    
    if (hasPermission === 'authorized') {
      console.log('✅ [Background] Notification listener permission granted');
      console.log('✅ [Background] Listener service is already active');
      // DO NOT call requestPermission() here - it opens settings screen!
      // The service is automatically active when permission is granted
    } else {
      console.log('⚠️ [Background] Notification listener permission not granted');
      console.log('ℹ️ [Background] User needs to enable it from first-time dialog');
    }
  } catch (error) {
    console.error('❌ [Background] Error initializing listeners:', error);
  }
}
