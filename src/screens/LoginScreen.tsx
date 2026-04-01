import React, { useState, useEffect } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Toast from 'react-native-toast-message';
import { supabase } from '../lib/supabase';
import { signInWithGoogle, configureGoogleSignIn } from '../lib/googleAuth';
import { useTheme } from '../context/ThemeContext';
import { ScreenWrapper, Card, AppButton, AppInput } from '../components';

interface LoginScreenProps {
  onNavigateToSignup: () => void;
}

export default function LoginScreen({ onNavigateToSignup }: LoginScreenProps) {
  const { colors, typography, spacing, borderRadius } = useTheme();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    // Configure Google Sign-In on mount
    configureGoogleSignIn();
  }, []);

  const handleLogin = async () => {
    if (!email || !password) {
      setError('Please fill in all fields');
      return;
    }

    setLoading(true);
    setError('');

    const { data, error: authError } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    setLoading(false);

    if (authError) {
      setError(authError.message);
      Toast.show({
        type: 'error',
        text1: 'Login Failed',
        text2: authError.message,
      });
    } else {
      // Save session to AsyncStorage for background tasks
      if (data.session) {
        await AsyncStorage.setItem('supabase.auth.token', JSON.stringify({
          access_token: data.session.access_token,
          refresh_token: data.session.refresh_token,
        }));
      }
      
      Toast.show({
        type: 'success',
        text1: 'Welcome Back',
        text2: 'Login successful',
      });
    }
  };

  const handleGoogleSignIn = async () => {
    setGoogleLoading(true);
    setError('');

    const { error: googleError } = await signInWithGoogle();

    setGoogleLoading(false);

    if (googleError) {
      const errorMessage = googleError instanceof Error ? googleError.message : 'Google Sign-In failed';
      setError(errorMessage);
      Toast.show({
        type: 'error',
        text1: 'Login Failed',
        text2: errorMessage,
      });
    } else {
      Toast.show({
        type: 'success',
        text1: 'Welcome Back',
        text2: 'Login successful',
      });
    }
  };

  return (
    <ScreenWrapper keyboardAvoiding>
      <View style={[styles.container, { padding: spacing.lg }]}>
        <Card style={{ padding: spacing.lg }}>
          <Text style={[typography.h1, { color: colors.text, marginBottom: spacing.xs }]}>
            Welcome Back
          </Text>
          <Text style={[typography.body, { color: colors.subtext, marginBottom: spacing.lg }]}>
            Sign in to continue
          </Text>

          <AppInput
            placeholder="Email"
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            keyboardType="email-address"
            icon="email"
          />

          <AppInput
            placeholder="Password"
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            icon="lock"
            error={error}
          />

          <AppButton
            title="Login"
            onPress={handleLogin}
            loading={loading}
            fullWidth
            style={{ marginTop: spacing.sm }}
          />

          <View style={[styles.divider, { marginVertical: spacing.lg }]}>
            <View style={[styles.dividerLine, { backgroundColor: colors.border }]} />
            <Text style={[typography.caption, { color: colors.subtext, paddingHorizontal: spacing.md }]}>
              OR
            </Text>
            <View style={[styles.dividerLine, { backgroundColor: colors.border }]} />
          </View>

          <TouchableOpacity
            style={[
              styles.googleButton,
              { borderRadius: borderRadius.md, height: 48 },
            ]}
            onPress={handleGoogleSignIn}
            disabled={googleLoading}>
            {googleLoading ? (
              <ActivityIndicator color="#111" />
            ) : (
              <>
                <View style={styles.googleIconContainer}>
                  <Text style={styles.googleIcon}>G</Text>
                </View>
                <Text style={styles.googleButtonText}>Sign in with Google</Text>
              </>
            )}
          </TouchableOpacity>

          <TouchableOpacity onPress={onNavigateToSignup} style={{ marginTop: spacing.md }}>
            <Text style={[typography.caption, { color: colors.accent, textAlign: 'center' }]}>
              Don't have an account? Sign up
            </Text>
          </TouchableOpacity>
        </Card>
      </View>
    </ScreenWrapper>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
  },
  divider: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  dividerLine: {
    flex: 1,
    height: 1,
  },
  googleButton: {
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#ffffff',
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  googleIconContainer: {
    backgroundColor: '#fff',
    borderRadius: 50,
    width: 20,
    height: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  googleIcon: {
    color: '#4285F4',
    fontSize: 14,
    fontWeight: 'bold',
    textAlign: 'center',
  },
  googleButtonText: {
    color: '#111111',
    fontSize: 15,
    fontWeight: '600',
  },
});
