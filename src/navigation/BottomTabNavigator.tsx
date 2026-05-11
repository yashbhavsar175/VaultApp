import React from 'react';
import { TouchableOpacity, StyleSheet } from 'react-native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { getFocusedRouteNameFromRoute } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';
import { useTheme } from '../context/ThemeContext';

import DashboardStack from './DashboardStack';
import PeopleScreen from '../screens/PeopleScreen';
import Add from '../screens/Add';
import SecureVaultScreen from '../screens/SecureVaultScreen';
import Settings from '../screens/Settings';

const Tab = createBottomTabNavigator();

export default function BottomTabNavigator() {
  const insets = useSafeAreaInsets();
  const { colors, typography, spacing, borderRadius } = useTheme();

  return (
    <>
      <Tab.Navigator
        screenOptions={{
          headerShown: false,
          tabBarActiveTintColor: colors.accent,
          tabBarInactiveTintColor: '#888',
          tabBarStyle: {
            backgroundColor: colors.card,
            borderTopColor: 'transparent',
            borderTopWidth: 0,
            height: 60 + insets.bottom,
            paddingBottom: insets.bottom || 8,
            paddingTop: 6,
            elevation: 8,
            shadowOpacity: 0,
          },
          tabBarLabelStyle: {
            fontSize: 11,
            marginTop: 2,
          },
          tabBarHideOnKeyboard: true,
          tabBarButton: (props) => {
            // Strip null values from navigation props — TouchableOpacity only accepts undefined
            const cleanProps = Object.fromEntries(
              Object.entries(props).map(([k, v]) => [k, v === null ? undefined : v])
            );
            return <TouchableOpacity {...cleanProps as any} activeOpacity={1} />;
          },
        }}>
        <Tab.Screen
          name="Dashboard"
          component={DashboardStack}
          options={({ route }) => {
            const routeName = getFocusedRouteNameFromRoute(route) ?? 'DashboardHome';
            // Hide bottom tab bar on sub-screens inside DashboardStack
            const hideOnScreens = ['Transactions', 'TransactionDetail', 'Banks', 'Analytics'];
            return {
              tabBarIcon: ({ color, size }: { color: string; size: number }) => (
                <MaterialCommunityIcons name="view-dashboard" color={color} size={size} />
              ),
              tabBarStyle: hideOnScreens.includes(routeName)
                ? { display: 'none' as const }
                : {
                    backgroundColor: colors.card,
                    borderTopColor: 'transparent',
                    borderTopWidth: 0,
                    height: 60 + insets.bottom,
                    paddingBottom: insets.bottom || 8,
                    paddingTop: 6,
                    elevation: 8,
                    shadowOpacity: 0,
                  },
            };
          }}
        />
        <Tab.Screen
          name="Add"
          component={Add}
          options={{
            tabBarIcon: ({ focused, color, size }) => (
              <MaterialCommunityIcons 
                name="plus-circle" 
                size={26} 
                color={focused ? colors.accent : '#888888'} 
              />
            ),
          }}
        />
        <Tab.Screen
          name="People"
          component={PeopleScreen}
          options={{
            tabBarIcon: ({ color, size }) => (
              <MaterialCommunityIcons name="account-group" color={color} size={size} />
            ),
          }}
        />
        <Tab.Screen
          name="Vault"
          component={SecureVaultScreen}
          options={{
            tabBarIcon: ({ color, size }) => (
              <MaterialCommunityIcons name="shield-lock" color={color} size={size} />
            ),
          }}
        />
        <Tab.Screen
          name="Settings"
          component={Settings}
          options={{
            tabBarIcon: ({ color, size }) => (
              <MaterialCommunityIcons name="cog" color={color} size={size} />
            ),
          }}
        />
      </Tab.Navigator>

      {/* Exit Confirmation Modal */}
    </>
  );
}

const styles = StyleSheet.create({});
