import React from 'react';
import { createStackNavigator } from '@react-navigation/stack';
import BottomTabNavigator from './BottomTabNavigator';
import PlacesScreen from '../screens/places/PlacesScreen';

const PorterTestScreen = __DEV__
  ? require('../screens/porter/PorterTestScreen').default
  : null;

export type RootStackParamList = {
  MainTabs: undefined;
  PorterTest: undefined;
  Places: undefined;
};

const Stack = createStackNavigator<RootStackParamList>();

export default function RootNavigator() {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false, detachPreviousScreen: true }}>
      <Stack.Screen name="MainTabs" component={BottomTabNavigator} />
      {__DEV__ && PorterTestScreen ? <Stack.Screen name="PorterTest" component={PorterTestScreen} /> : null}
      <Stack.Screen name="Places" component={PlacesScreen} />
    </Stack.Navigator>
  );
}
