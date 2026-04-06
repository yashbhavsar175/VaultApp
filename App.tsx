import 'react-native-gesture-handler';
import React, { useState, useEffect } from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ActivityIndicator, View, StyleSheet } from 'react-native';
import { Session } from '@supabase/supabase-js';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Toast from 'react-native-toast-message';
import BottomTabNavigator from './src/navigation/BottomTabNavigator';
import LoginScreen from './src/screens/LoginScreen';
import SignupScreen from './src/screens/SignupScreen';
import ProfileScreen from './src/screens/ProfileScreen';
import { supabase } from './src/lib/supabase';
import { ThemeProvider } from './src/context/ThemeContext';

function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [showSignup, setShowSignup] = useState(false);
  const [needsProfile, setNeedsProfile] = useState(false);

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
