/**
 * @format
 */

import 'react-native-gesture-handler';
import { AppRegistry } from 'react-native';
import App from './App';
import { name as appName } from './app.json';
import { RNAndroidNotificationListenerHeadlessJsName } from 'react-native-android-notification-listener';
import SmsProcessorTask from './src/lib/SmsProcessorTask';
import NotificationProcessorTask from './src/lib/NotificationProcessorTask';
import notifee from '@notifee/react-native';
import { onBackgroundEvent } from './src/lib/BackgroundEventHandler';

console.log('📱 [Index] Registering app components...');

// Register background event handler for Notifee
// This allows the app to handle events even when closed
notifee.onBackgroundEvent(onBackgroundEvent);
console.log('✅ [Index] Notifee background event handler registered');

// Register main app component
AppRegistry.registerComponent(appName, () => App);
console.log('✅ [Index] Main app component registered');

// Register Headless JS Task for SMS Processing
AppRegistry.registerHeadlessTask('SmsProcessorTask', () => SmsProcessorTask);
console.log('✅ [Index] SMS Processor Task registered');

// Register Headless JS Task for Notification Processing - MUST use exact constant
console.log('🔔 [Index] Registering Notification Processor Task with name:', RNAndroidNotificationListenerHeadlessJsName);
AppRegistry.registerHeadlessTask(
  RNAndroidNotificationListenerHeadlessJsName,
  () => NotificationProcessorTask
);
console.log('✅ [Index] Notification Processor Task registered successfully');
