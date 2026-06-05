import React from 'react';
import { TouchableOpacity } from 'react-native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { CommonActions, getFocusedRouteNameFromRoute } from '@react-navigation/native';
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
const HIDDEN_SETTINGS_TAB_SCREENS = ['Banks', 'BankConfigScreen', 'DetectedAccountsScreen', 'SMSTestScreen', 'DebtFreedomCoach', 'Places', 'PorterTest'];
const SETTINGS_TAB_ROUTE = 'Settings';
const SETTINGS_ROOT_ROUTE = 'SettingsHome';

type SettingsTabRoute = {
  key?: string;
  state?: {
    key?: string;
    index?: number;
    routes?: Array<{ name?: string }>;
  };
};

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

function isSettingsTabFocused(navigation: any): boolean {
  const state = navigation.getState?.();
  const activeRoute = state?.routes?.[state.index ?? 0];
  return activeRoute?.name === SETTINGS_TAB_ROUTE;
}

function getSettingsNestedRouteName(route: SettingsTabRoute): string {
  const nestedRoutes = route.state?.routes;
  if (!nestedRoutes?.length) return SETTINGS_ROOT_ROUTE;
  return nestedRoutes[route.state?.index ?? nestedRoutes.length - 1]?.name || SETTINGS_ROOT_ROUTE;
}

function resetSettingsTabToRoot(navigation: any, route: SettingsTabRoute) {
  const isFocused = isSettingsTabFocused(navigation);
  const nestedRouteName = getSettingsNestedRouteName(route);

  if (isFocused && nestedRouteName === SETTINGS_ROOT_ROUTE) {
    return false;
  }

  const settingsStackKey = route.state?.key;

  if (settingsStackKey) {
    if (nestedRouteName !== SETTINGS_ROOT_ROUTE) {
      navigation.dispatch({
        ...CommonActions.reset({
          index: 0,
          routes: [{ name: SETTINGS_ROOT_ROUTE }],
        }),
        target: settingsStackKey,
      });
    }
    if (!isFocused) {
      navigation.dispatch(CommonActions.navigate({ name: SETTINGS_TAB_ROUTE }));
    }
    return true;
  }

  navigation.dispatch(
    CommonActions.navigate({
      name: SETTINGS_TAB_ROUTE,
      params: { screen: SETTINGS_ROOT_ROUTE },
    }),
  );
  return true;
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
          listeners={({ navigation, route }) => ({
            tabPress: event => {
              const handled = resetSettingsTabToRoot(navigation, route as SettingsTabRoute);
              if (handled) {
                event.preventDefault();
              }
            },
          })}
          options={({ route }) => {
            const routeName = getFocusedRouteNameFromRoute(route) ?? SETTINGS_ROOT_ROUTE;
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
