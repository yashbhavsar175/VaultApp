import React from 'react';
import { createStackNavigator } from '@react-navigation/stack';
import Dashboard from '../screens/Dashboard';
import BanksScreen from '../screens/BanksScreen';
import Transactions from '../screens/Transactions';
import AnalyticsScreen from '../screens/AnalyticsScreen';

const Stack = createStackNavigator();

export default function DashboardStack() {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="DashboardHome" component={Dashboard} />
      <Stack.Screen name="Banks" component={BanksScreen} />
      <Stack.Screen name="Transactions" component={Transactions} />
      <Stack.Screen name="Analytics" component={AnalyticsScreen} />
    </Stack.Navigator>
  );
}
