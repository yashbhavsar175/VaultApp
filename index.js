/**
 * @format
 */

import 'react-native-gesture-handler';
import { AppRegistry } from 'react-native';
import App from './App';
import { name as appName } from './app.json';
import SmsProcessorTask from './src/lib/SmsProcessorTask';
import NotificationProcessorTask from './src/lib/NotificationProcessorTask';

// Register main app component
AppRegistry.registerComponent(appName, () => App);

// Register Headless JS Task for SMS Processing
AppRegistry.registerHeadlessTask('SmsProcessorTask', () => SmsProcessorTask);

// Register Headless JS Task for Notification Processing
AppRegistry.registerHeadlessTask('NotificationProcessor', () => NotificationProcessorTask);
