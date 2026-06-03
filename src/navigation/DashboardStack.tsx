import React from 'react';
import { createStackNavigator, CardStyleInterpolators } from '@react-navigation/stack';
import Dashboard from '../screens/Dashboard';
import { BanksScreen, AnalyticsScreen, DetectedAccountsScreen, SMSTestScreen, BankAutoDetectScreen } from '../screens/AllScreens';
import Transactions from '../screens/transactions/Transactions';
import TransactionDetail from '../screens/transactions/TransactionDetail';
import { AccountsAndCardsRouteRedirect } from './RouteRedirects';

export type DashboardStackParamList = {
  DashboardHome: undefined;
  Banks: undefined;
  BankConfigScreen: undefined;
  DetectedAccountsScreen: undefined;
  BankAutoDetectScreen: undefined;
  SMSTestScreen: undefined;
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
      <Stack.Screen name="BankConfigScreen" component={AccountsAndCardsRouteRedirect} />
      <Stack.Screen name="DetectedAccountsScreen" component={DetectedAccountsScreen} />
      <Stack.Screen name="BankAutoDetectScreen" component={BankAutoDetectScreen} />
      <Stack.Screen name="SMSTestScreen" component={SMSTestScreen} />
      <Stack.Screen name="Transactions" component={Transactions} />
      <Stack.Screen name="Analytics" component={AnalyticsScreen} />
      <Stack.Screen name="TransactionDetail" component={TransactionDetail} />
    </Stack.Navigator>
  );
}
