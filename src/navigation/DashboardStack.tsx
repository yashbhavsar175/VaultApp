import React from 'react';
import { createStackNavigator, CardStyleInterpolators } from '@react-navigation/stack';
import Dashboard from '../screens/Dashboard';
import { BanksScreen, AnalyticsScreen } from '../screens/financial/FinancialScreens';
import Transactions from '../screens/transactions/Transactions';
import TransactionDetail from '../screens/transactions/TransactionDetail';

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
        detachPreviousScreen: true,
        transitionSpec: {
          open: { animation: 'timing', config: { duration: 200 } },
          close: { animation: 'timing', config: { duration: 180 } },
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
