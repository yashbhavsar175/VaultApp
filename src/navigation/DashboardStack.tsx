import React from 'react';
import { createStackNavigator, CardStyleInterpolators } from '@react-navigation/stack';
import Dashboard from '../screens/Dashboard';
import BanksScreen from '../screens/BanksScreen';
import Transactions from '../screens/Transactions';
import AnalyticsScreen from '../screens/AnalyticsScreen';
import TransactionDetail from '../screens/TransactionDetail';

export type DashboardStackParamList = {
  DashboardHome: undefined;
  Banks: undefined;
  Transactions: undefined;
  Analytics: undefined;
  TransactionDetail: { transactionId: string };
};

const Stack = createStackNavigator<DashboardStackParamList>();

export default function DashboardStack() {
  return (
    <Stack.Navigator
      screenOptions={{
        headerShown: false,
        cardStyleInterpolator: CardStyleInterpolators.forHorizontalIOS,
        gestureEnabled: true,
        transitionSpec: {
          open: { animation: 'spring', config: { stiffness: 1000, damping: 500, mass: 3, overshootClamping: true } },
          close: { animation: 'spring', config: { stiffness: 1000, damping: 500, mass: 3, overshootClamping: true } },
        },
      }}>
      <Stack.Screen name="DashboardHome" component={Dashboard} />
      <Stack.Screen name="Banks" component={BanksScreen} />
      <Stack.Screen name="Transactions" component={Transactions} />
      <Stack.Screen name="Analytics" component={AnalyticsScreen} />
      <Stack.Screen name="TransactionDetail" component={TransactionDetail} />
    </Stack.Navigator>
  );
}
