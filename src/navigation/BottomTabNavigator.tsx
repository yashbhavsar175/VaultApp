import React from 'react';
import { TouchableOpacity } from 'react-native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { getFocusedRouteNameFromRoute } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';
import { useTheme } from '../context/ThemeContext';

import DashboardStack from './DashboardStack';
import SettingsStack from './SettingsStack';
import PeopleScreen from '../screens/people/PeopleScreen';
import Add from '../screens/transactions/Add';
import SecureVaultScreen from '../screens/vault/SecureVaultScreen';

const Tab = createBottomTabNavigator();

type TabIconProps = {
  color: string;
  size: number;
};

const HIDDEN_DASHBOARD_TAB_SCREENS = ['Transactions', 'TransactionDetail', 'Banks', 'Analytics', 'DetectedAccountsScreen'];
const HIDDEN_SETTINGS_TAB_SCREENS = ['BankConfigScreen', 'DetectedAccountsScreen', 'SMSTestScreen', 'Places', 'PorterTest'];

function TabBarButton(props: any) {
  // Strip null values from navigation props — TouchableOpacity only accepts undefined
  const cleanProps = Object.fromEntries(
    Object.entries(props).map(([key, value]) => [key, value === null ? undefined : value])
  );
  return <TouchableOpacity {...cleanProps as any} activeOpacity={0.6} />;
}

function DashboardTabIcon({ color, size }: TabIconProps) {
  return <MaterialCommunityIcons name="view-dashboard" color={color} size={size} />;
}

function AddTabIcon({ color, size }: TabIconProps) {
  return <MaterialCommunityIcons name="plus-circle" size={size} color={color} />;
}

function PeopleTabIcon({ color, size }: TabIconProps) {
  return <MaterialCommunityIcons name="account-group" color={color} size={size} />;
}

function VaultTabIcon({ color, size }: TabIconProps) {
  return <MaterialCommunityIcons name="shield-lock" color={color} size={size} />;
}

function SettingsTabIcon({ color, size }: TabIconProps) {
  return <MaterialCommunityIcons name="cog" color={color} size={size} />;
}

export default function BottomTabNavigator() {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();

  const visibleTabBarStyle = {
    backgroundColor: colors.card,
    borderTopColor: 'transparent',
    borderTopWidth: 0,
    height: 60 + insets.bottom,
    paddingBottom: insets.bottom || 8,
    paddingTop: 6,
    elevation: 8,
    shadowOpacity: 0,
  };

  return (
    <>
      <Tab.Navigator
        screenOptions={{
          headerShown: false,
          tabBarActiveTintColor: colors.accent,
          tabBarInactiveTintColor: '#888',
          tabBarStyle: visibleTabBarStyle,
          tabBarLabelStyle: {
            fontSize: 11,
            marginTop: 2,
          },
          tabBarHideOnKeyboard: true,
          tabBarButton: TabBarButton,
        }}>
        <Tab.Screen
          name="Dashboard"
          component={DashboardStack}
          options={({ route }) => {
            const routeName = getFocusedRouteNameFromRoute(route) ?? 'DashboardHome';
            return {
              tabBarIcon: DashboardTabIcon,
              tabBarStyle: HIDDEN_DASHBOARD_TAB_SCREENS.includes(routeName)
                ? { display: 'none' as const }
                : visibleTabBarStyle,
            };
          }}
        />
        <Tab.Screen
          name="Add"
          component={Add}
          options={{
            tabBarIcon: AddTabIcon,
          }}
        />
        <Tab.Screen
          name="People"
          component={PeopleScreen}
          options={{
            tabBarIcon: PeopleTabIcon,
          }}
        />
        <Tab.Screen
          name="Vault"
          component={SecureVaultScreen}
          options={{
            tabBarIcon: VaultTabIcon,
          }}
        />
        <Tab.Screen
          name="Settings"
          component={SettingsStack}
          options={({ route }) => {
            const routeName = getFocusedRouteNameFromRoute(route) ?? 'SettingsHome';
            return {
              tabBarIcon: SettingsTabIcon,
              tabBarStyle: HIDDEN_SETTINGS_TAB_SCREENS.includes(routeName)
                ? { display: 'none' as const }
                : visibleTabBarStyle,
            };
          }}
        />
      </Tab.Navigator>

      {/* Exit Confirmation Modal */}
    </>
  );
}
