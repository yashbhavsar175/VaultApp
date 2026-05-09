import 'react-native-gesture-handler';
import React, { useState, useEffect } from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ActivityIndicator, View, StyleSheet, AppState, Alert } from 'react-native';
import { Session } from '@supabase/supabase-js';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Toast from 'react-native-toast-message';
import BottomTabNavigator from './src/navigation/BottomTabNavigator';
import LoginScreen from './src/screens/LoginScreen';
import SignupScreen from './src/screens/SignupScreen';
import ProfileScreen from './src/screens/ProfileScreen';
import { supabase } from './src/lib/supabase';
import { ThemeProvider } from './src/context/ThemeContext';
import { configureGoogleSignIn } from './src/lib/googleAuth';
import { initializeBackgroundListeners } from './src/lib/BackgroundEventHandler';
import { checkNotificationPermission, requestNotificationPermission } from './src/utils/notificationPermissions';

function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [showSignup, setShowSignup] = useState(false);
  const [needsProfile, setNeedsProfile] = useState(false);

  // Configure Google Sign-In once on app start
  useEffect(() => {
    configureGoogleSignIn();
  }, []);

  // Initialize background listeners on app start
  useEffect(() => {
    console.log('🚀 [App] Initializing background listeners...');
    initializeBackgroundListeners().catch(error => {
      console.error('❌ [App] Failed to initialize background listeners:', error);
    });

    // Re-initialize when app comes to foreground
    const subscription = AppState.addEventListener('change', (nextAppState) => {
      if (nextAppState === 'active') {
        console.log('📱 [App] App became active - ensuring background listeners are running');
        initializeBackgroundListeners().catch(error => {
          console.error('❌ [App] Failed to re-initialize background listeners:', error);
        });
      }
    });

    return () => {
      subscription.remove();
    };
  }, []);

  const checkProfile = async (userId: string) => {
    try {
      const { data: profile } = await supabase
        .from('profiles')
        .select('full_name')
        .eq('id', userId)
        .single();

      // Only require profile setup if no name exists
      if (profile?.full_name) {
        // Profile exists → go to main app
        setNeedsProfile(false);
      } else {
        // No profile → go to profile setup
        setNeedsProfile(true);
      }
    } catch (error) {
      console.error('Error checking profile:', error);
      setNeedsProfile(true);
    }
  };

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      if (session?.user) {
        checkProfile(session.user.id);
        // Save session to AsyncStorage for background tasks
        AsyncStorage.setItem('supabase.auth.token', JSON.stringify({
          access_token: session.access_token,
          refresh_token: session.refresh_token,
        }));
      }
      setLoading(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
      if (session?.user) {
        checkProfile(session.user.id);
        // Save session to AsyncStorage for background tasks
        AsyncStorage.setItem('supabase.auth.token', JSON.stringify({
          access_token: session.access_token,
          refresh_token: session.refresh_token,
        }));
      } else {
        setNeedsProfile(false);
        // Clear session from AsyncStorage on logout
        AsyncStorage.removeItem('supabase.auth.token');
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  const handleProfileComplete = () => {
    setNeedsProfile(false);
  };

  // Check notification permission on first app launch
  useEffect(() => {
    const checkFirstTimeNotificationPermission = async () => {
      // Only check if user is logged in and profile is complete
      if (!session || needsProfile) return;

      try {
        // Check if we've already asked for notification permission
        const hasAskedBefore = await AsyncStorage.getItem('notification_permission_asked');
        
        if (hasAskedBefore === 'true') {
          console.log('ℹ️ [App] Already asked for notification permission before');
          return;
        }

        // Check if permission is already granted
        const hasPermission = await checkNotificationPermission();
        
        if (hasPermission) {
          console.log('✅ [App] Notification permission already granted');
          await AsyncStorage.setItem('notification_permission_asked', 'true');
          return;
        }

        // Show dialog to ask for notification permission
        console.log('🔔 [App] Showing notification permission dialog');
        Alert.alert(
          'Enable Transaction Tracking',
          'SpendSense can automatically track your transactions from notifications (Slice, CRED, GPay, PhonePe, etc.).\n\nWould you like to enable this feature?',
          [
            {
              text: 'Not Now',
              style: 'cancel',
              onPress: async () => {
                await AsyncStorage.setItem('notification_permission_asked', 'true');
                console.log('❌ [App] User declined notification permission');
              },
            },
            {
              text: 'Enable',
              onPress: async () => {
                await AsyncStorage.setItem('notification_permission_asked', 'true');
                console.log('✅ [App] User accepted, opening settings');
                requestNotificationPermission();
                Toast.show({
                  type: 'info',
                  text1: 'Enable Notification Access',
                  text2: 'Find "SpendSense" and toggle it ON',
                  visibilityTime: 4000,
                });
              },
            },
          ]
        );
      } catch (error) {
        console.error('❌ [App] Error checking notification permission:', error);
      }
    };

    // Small delay to ensure UI is ready
    const timer = setTimeout(() => {
      checkFirstTimeNotificationPermission();
    }, 1000);

    return () => clearTimeout(timer);
  }, [session, needsProfile]);

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#7c6af7" />
      </View>
    );
  }

  return (
    <ThemeProvider>
      <SafeAreaProvider>
        <NavigationContainer>
          {session ? (
            needsProfile ? (
              <ProfileScreen onProfileComplete={handleProfileComplete} />
            ) : (
              <BottomTabNavigator />
            )
          ) : showSignup ? (
            <SignupScreen onNavigateToLogin={() => setShowSignup(false)} />
          ) : (
            <LoginScreen onNavigateToSignup={() => setShowSignup(true)} />
          )}
        </NavigationContainer>
        <Toast />
      </SafeAreaProvider>
    </ThemeProvider>
  );
}

const styles = StyleSheet.create({
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#0a0a0f',
  },
});

export default App;