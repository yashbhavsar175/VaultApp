import React from 'react';
import { createStackNavigator, CardStyleInterpolators } from '@react-navigation/stack';
import Settings from '../screens/user/Settings';
import { BankConfigScreen, SMSTestScreen, PlacesScreen } from '../screens/AllScreens';
import PorterTestScreen from '../screens/porter/PorterTestScreen';

export type SettingsStackParamList = {
  SettingsHome: undefined;
  BankConfigScreen: undefined;
  SMSTestScreen: undefined;
  Places: undefined;
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
      <Stack.Screen name="BankConfigScreen" component={BankConfigScreen} />
      <Stack.Screen name="SMSTestScreen" component={SMSTestScreen} />
      <Stack.Screen name="Places" component={PlacesScreen} />
      <Stack.Screen name="PorterTest" component={PorterTestScreen} />
    </Stack.Navigator>
  );
}
