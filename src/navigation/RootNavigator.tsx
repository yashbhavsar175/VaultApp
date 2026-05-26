import React from 'react';
import { createStackNavigator } from '@react-navigation/stack';
import BottomTabNavigator from './BottomTabNavigator';
import PorterTestScreen from '../screens/porter/PorterTestScreen';
import PlacesScreen from '../screens/places/PlacesScreen';
import ReviewQueueScreen from '../screens/transactions/ReviewQueueScreen';

export type RootStackParamList = {
  MainTabs: undefined;
  PorterTest: undefined;
  Places: undefined;
  ReviewQueue: undefined;
};

const Stack = createStackNavigator<RootStackParamList>();

export default function RootNavigator() {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false, detachPreviousScreen: true }}>
      <Stack.Screen name="MainTabs" component={BottomTabNavigator} />
      <Stack.Screen name="PorterTest" component={PorterTestScreen} />
      <Stack.Screen name="Places" component={PlacesScreen} />
      <Stack.Screen name="ReviewQueue" component={ReviewQueueScreen} />
    </Stack.Navigator>
  );
}
