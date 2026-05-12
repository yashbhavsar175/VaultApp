import 'react-native-gesture-handler';
import React, { useState, useEffect, useRef } from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ActivityIndicator, View, StyleSheet, AppState, Alert, Text, Animated, Easing } from 'react-native';
import { Session } from '@supabase/supabase-js';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Toast, { BaseToast, ErrorToast, InfoToast } from 'react-native-toast-message';
import RootNavigator from './src/navigation/RootNavigator';
import { LoginScreen, SignupScreen } from './src/screens/auth/AuthScreens';
import ProfileScreen from './src/screens/user/ProfileScreen';
import { supabase, configureGoogleSignIn } from './src/lib/core';
import { initializeBackgroundListeners, initializeForegroundListener } from './src/lib/notifications';
import { initPorterDistanceCalculator, stopPorterDistanceCalculator } from './src/lib/porter';
import PermissionPrompt from './src/components/PermissionPrompt';
import { prefetchAllData } from './src/lib/cache';
import { ThemeProvider } from './src/context/ThemeContext';

const toastConfig = {
  success: (props: any) => (
    <BaseToast
      {...props}
      style={{ borderLeftColor: '#10b981', backgroundColor: '#1e1e2e', borderRadius: 12, marginTop: 8 }}
      contentContainerStyle={{ paddingHorizontal: 15 }}
      text1Style={{ color: '#ffffff', fontSize: 14, fontWeight: '600' }}
      text2Style={{ color: '#a0a0b0', fontSize: 12 }}
    />
  ),
  error: (props: any) => (
    <ErrorToast
      {...props}
      style={{ borderLeftColor: '#ef4444', backgroundColor: '#1e1e2e', borderRadius: 12, marginTop: 8 }}
      contentContainerStyle={{ paddingHorizontal: 15 }}
      text1Style={{ color: '#ffffff', fontSize: 14, fontWeight: '600' }}
      text2Style={{ color: '#a0a0b0', fontSize: 12 }}
    />
  ),
  info: (props: any) => (
    <InfoToast
      {...props}
      style={{ borderLeftColor: '#6366f1', backgroundColor: '#1e1e2e', borderRadius: 12, marginTop: 8 }}
      contentContainerStyle={{ paddingHorizontal: 15 }}
      text1Style={{ color: '#ffffff', fontSize: 14, fontWeight: '600' }}
      text2Style={{ color: '#a0a0b0', fontSize: 12 }}
    />
  ),
};

function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [showSignup, setShowSignup] = useState(false);
  const [needsProfile, setNeedsProfile] = useState(false);

  // Splash screen animations
  const logoScale = useRef(new Animated.Value(0.3)).current;
  const logoOpacity = useRef(new Animated.Value(0)).current;
  const textOpacity = useRef(new Animated.Value(0)).current;
  const pulseAnim = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    // Entrance animation sequence
    Animated.sequence([
      Animated.parallel([
        Animated.timing(logoScale, {
          toValue: 1,
          duration: 600,
          easing: Easing.out(Easing.back(1.5)),
          useNativeDriver: true,
        }),
        Animated.timing(logoOpacity, {
          toValue: 1,
          duration: 400,
          useNativeDriver: true,
        }),
      ]),
      Animated.timing(textOpacity, {
        toValue: 1,
        duration: 400,
        useNativeDriver: true,
      }),
    ]).start();

    // Continuous pulse on the logo glow
    Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, {
          toValue: 1.08,
          duration: 1200,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(pulseAnim, {
          toValue: 1,
          duration: 1200,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ])
    ).start();
  }, []);

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
    initPorterDistanceCalculator();

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
      stopPorterDistanceCalculator();
    };
  }, []);

  // Initialize foreground listener for notifee events
  useEffect(() => {
    console.log('🚀 [App] Initializing foreground listener for notifications...');
    const unsubscribe = initializeForegroundListener();
    return () => {
      unsubscribe();
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
    // Try cached session first for instant startup
    const initAuth = async () => {
      try {
        const cachedToken = await AsyncStorage.getItem('supabase.auth.token');
        if (cachedToken) {
          // We have a cached session — show app immediately, verify in background
          const parsed = JSON.parse(cachedToken);
          if (parsed?.access_token) {
            // Quick set — user sees app right away
            const { data: { session } } = await supabase.auth.getSession();
            setSession(session);
            if (session?.user) {
              checkProfile(session.user.id);
              prefetchAllData(); // Prefetch all data for instant screen loads
              AsyncStorage.setItem('supabase.auth.token', JSON.stringify({
                access_token: session.access_token,
                refresh_token: session.refresh_token,
              }));
            }
            setLoading(false);
            return;
          }
        }
      } catch (e) {
        console.log('Cache read failed, falling back to normal auth');
      }

      // No cached session — normal flow
      const { data: { session } } = await supabase.auth.getSession();
      setSession(session);
      if (session?.user) {
        checkProfile(session.user.id);
        prefetchAllData(); // Prefetch all data for instant screen loads
        AsyncStorage.setItem('supabase.auth.token', JSON.stringify({
          access_token: session.access_token,
          refresh_token: session.refresh_token,
        }));
      }
      setLoading(false);
    };

    initAuth();

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
      <View style={styles.splashContainer}>
        {/* Glow effect behind logo */}
        <Animated.View style={[
          styles.glowCircle,
          { transform: [{ scale: pulseAnim }], opacity: logoOpacity }
        ]} />
        
        {/* Logo icon */}
        <Animated.View style={[
          styles.logoContainer,
          { transform: [{ scale: logoScale }], opacity: logoOpacity }
        ]}>
          <Text style={styles.logoEmoji}>💰</Text>
        </Animated.View>

        {/* App name */}
        <Animated.Text style={[styles.splashTitle, { opacity: textOpacity }]}>
          SpendSense
        </Animated.Text>
        <Animated.Text style={[styles.splashSubtitle, { opacity: textOpacity }]}>
          Smart Financial Tracking
        </Animated.Text>

        {/* Loading dots */}
        <Animated.View style={[styles.loadingRow, { opacity: textOpacity }]}>
          <ActivityIndicator size="small" color="#7c6af7" />
          <Text style={styles.loadingText}>Loading your data...</Text>
        </Animated.View>
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
              <RootNavigator />
            )
          ) : showSignup ? (
            <SignupScreen onNavigateToLogin={() => setShowSignup(false)} />
          ) : (
            <LoginScreen onNavigateToSignup={() => setShowSignup(true)} />
          )}
        </NavigationContainer>
        <Toast config={toastConfig} />
        
        {/* Render the global permission prompt only if user is fully authenticated and profile setup is done */}
        {session && !needsProfile && <PermissionPrompt />}
      </SafeAreaProvider>
    </ThemeProvider>
  );
}

const styles = StyleSheet.create({
  splashContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#0a0a0f',
  },
  glowCircle: {
    position: 'absolute',
    width: 180,
    height: 180,
    borderRadius: 90,
    backgroundColor: '#7c6af720',
    shadowColor: '#7c6af7',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.5,
    shadowRadius: 40,
    elevation: 20,
  },
  logoContainer: {
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: '#7c6af715',
    borderWidth: 2,
    borderColor: '#7c6af740',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 20,
  },
  logoEmoji: {
    fontSize: 48,
  },
  splashTitle: {
    fontSize: 28,
    fontWeight: '800',
    color: '#ffffff',
    letterSpacing: 1,
  },
  splashSubtitle: {
    fontSize: 14,
    color: '#888',
    marginTop: 6,
    letterSpacing: 0.5,
  },
  loadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 40,
    gap: 10,
  },
  loadingText: {
    color: '#666',
    fontSize: 13,
  },
});

export default App;