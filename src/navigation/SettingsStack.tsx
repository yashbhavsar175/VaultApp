import React from 'react';
import { createStackNavigator, CardStyleInterpolators } from '@react-navigation/stack';
import Settings from '../screens/user/Settings';
import { BanksScreen, DetectedAccountsScreen, SMSTestScreen, PlacesScreen } from '../screens/AllScreens';
import DebtFreedomScreen from '../screens/financial/DebtFreedomScreen';
import PlaceRemindersScreen from '../screens/reminders/PlaceRemindersScreen';
import EditPlaceReminderScreen from '../screens/reminders/EditPlaceReminderScreen';
import PlaceReminderMapPickerScreen from '../screens/reminders/PlaceReminderMapPickerScreen';
import { AccountsAndCardsRouteRedirect } from './RouteRedirects';

const PorterTestScreen = __DEV__
  ? require('../screens/porter/PorterTestScreen').default
  : null;

export type SettingsStackParamList = {
  SettingsHome: undefined;
  Banks: undefined;
  BankConfigScreen: undefined;
  DetectedAccountsScreen: undefined;
  SMSTestScreen: undefined;
  DebtFreedomCoach: undefined;
  Places: undefined;
  PlaceReminders: undefined;
  EditPlaceReminder: { reminder?: any, selectedLocation?: { latitude: number; longitude: number; label: string; source: string } };
  PlaceReminderMapPicker: { latitude?: number; longitude?: number };
  PorterTest: undefined;
};

const Stack = createStackNavigator<SettingsStackParamList>();

export default function SettingsStack() {
  return (
    <Stack.Navigator
      screenOptions={{
        headerShown: false,
        cardStyleInterpolator: CardStyleInterpolators.forHorizontalIOS,
        gestureEnabled: true,
        detachPreviousScreen: true,
        transitionSpec: {
          open: { animation: 'timing', config: { duration: 200 } },
          close: { animation: 'timing', config: { duration: 180 } },
        },
      }}>
      <Stack.Screen name="SettingsHome" component={Settings} />
      <Stack.Screen name="Banks" component={BanksScreen} />
      <Stack.Screen name="BankConfigScreen" component={AccountsAndCardsRouteRedirect} />
      <Stack.Screen name="DetectedAccountsScreen" component={DetectedAccountsScreen} />
      <Stack.Screen name="SMSTestScreen" component={SMSTestScreen} />
      <Stack.Screen name="DebtFreedomCoach" component={DebtFreedomScreen} />
      <Stack.Screen name="Places" component={PlacesScreen} />
      <Stack.Screen name="PlaceReminders" component={PlaceRemindersScreen} />
      <Stack.Screen name="EditPlaceReminder" component={EditPlaceReminderScreen} />
      <Stack.Screen name="PlaceReminderMapPicker" component={PlaceReminderMapPickerScreen} />
      {__DEV__ && PorterTestScreen ? <Stack.Screen name="PorterTest" component={PorterTestScreen} /> : null}
    </Stack.Navigator>
  );
}
