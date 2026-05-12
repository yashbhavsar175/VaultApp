import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Modal,
  ScrollView,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Toast from 'react-native-toast-message';
import { supabase, signInWithGoogle } from '../../lib/core';
import { useTheme } from '../../context/ThemeContext';
import { ScreenWrapper, Card, AppButton, AppInput } from '../../components';

// ═══════════════════════════════════════════════════════════════════════════════
// LOGIN SCREEN
// ═══════════════════════════════════════════════════════════════════════════════

interface LoginScreenProps {
  onNavigateToSignup: () => void;
}

export function LoginScreen({ onNavigateToSignup }: LoginScreenProps) {
  const { colors, typography, spacing, borderRadius } = useTheme();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [error, setError] = useState('');

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
    } else if (data.user) {
      // Save user ID for background tasks (SMS processing)
      await AsyncStorage.setItem('app_user_id', data.user.id);
      console.log('User ID saved for background tasks:', data.user.id);
      
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

    const { error: googleError, data } = await signInWithGoogle();

    setGoogleLoading(false);

    if (googleError) {
      const errorMessage = googleError instanceof Error ? googleError.message : 'Google Sign-In failed';
      setError(errorMessage);
      Toast.show({
        type: 'error',
        text1: 'Login Failed',
        text2: errorMessage,
      });
    } else if (data?.user) {
      // Save user ID for background tasks
      await AsyncStorage.setItem('app_user_id', data.user.id);
      console.log('User ID saved for background tasks:', data.user.id);
      
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

          <GoogleSignInButton
            onPress={handleGoogleSignIn}
            loading={googleLoading}
            text="Sign in with Google"
          />

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

// ═══════════════════════════════════════════════════════════════════════════════
// SIGNUP SCREEN
// ═══════════════════════════════════════════════════════════════════════════════

interface SignupScreenProps {
  onNavigateToLogin: () => void;
}

export function SignupScreen({ onNavigateToLogin }: SignupScreenProps) {
  const { colors, typography, spacing, borderRadius } = useTheme();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [agreedToTerms, setAgreedToTerms] = useState(false);
  const [showTermsModal, setShowTermsModal] = useState(false);
  const [showPrivacyModal, setShowPrivacyModal] = useState(false);
  const [emailError, setEmailError] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [confirmPasswordError, setConfirmPasswordError] = useState('');

  const handleSignup = async () => {
    setEmailError('');
    setPasswordError('');
    setConfirmPasswordError('');

    if (!email || !password || !confirmPassword) {
      if (!email) setEmailError('Email is required');
      if (!password) setPasswordError('Password is required');
      if (!confirmPassword) setConfirmPasswordError('Please confirm password');
      return;
    }

    if (password !== confirmPassword) {
      setConfirmPasswordError('Passwords do not match');
      return;
    }

    if (password.length < 6) {
      setPasswordError('Password must be at least 6 characters');
      return;
    }

    if (!agreedToTerms) {
      Toast.show({
        type: 'error',
        text1: 'Terms Required',
        text2: 'Please agree to the Terms & Conditions',
      });
      return;
    }

    setLoading(true);

    const { data, error } = await supabase.auth.signUp({
      email,
      password,
    });

    setLoading(false);

    if (error) {
      setEmailError(error.message);
      Toast.show({
        type: 'error',
        text1: 'Signup Failed',
        text2: error.message,
      });
    } else if (data.user) {
      // Save user ID for background tasks (SMS processing)
      await AsyncStorage.setItem('app_user_id', data.user.id);
      console.log('User ID saved for background tasks:', data.user.id);
      
      Toast.show({
        type: 'success',
        text1: 'Account Created',
        text2: 'Welcome to SpendSense!',
      });
    }
  };

  const handleGoogleSignUp = async () => {
    if (!agreedToTerms) {
      Toast.show({
        type: 'error',
        text1: 'Terms Required',
        text2: 'Please agree to the Terms & Conditions',
      });
      return;
    }

    setGoogleLoading(true);

    const { error: googleError, data } = await signInWithGoogle();

    setGoogleLoading(false);

    if (googleError) {
      const errorMessage = googleError instanceof Error ? googleError.message : 'Google Sign-Up failed';
      Toast.show({
        type: 'error',
        text1: 'Signup Failed',
        text2: errorMessage,
      });
    } else if (data?.user) {
      // Save user ID for background tasks
      await AsyncStorage.setItem('app_user_id', data.user.id);
      console.log('User ID saved for background tasks:', data.user.id);
      
      Toast.show({
        type: 'success',
        text1: 'Account Created',
        text2: 'Welcome to SpendSense!',
      });
    }
  };

  return (
    <ScreenWrapper keyboardAvoiding>
      <View style={[styles.container, { padding: spacing.lg }]}>
        <Card style={{ padding: spacing.lg }}>
          <Text style={[typography.h1, { color: colors.text, marginBottom: spacing.xs }]}>
            Create Account
          </Text>
          <Text style={[typography.body, { color: colors.subtext, marginBottom: spacing.lg }]}>
            Sign up to get started
          </Text>

          <AppInput
            placeholder="Email"
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            keyboardType="email-address"
            icon="email"
            error={emailError}
          />

          <AppInput
            placeholder="Password"
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            icon="lock"
            error={passwordError}
          />

          <AppInput
            placeholder="Confirm Password"
            value={confirmPassword}
            onChangeText={setConfirmPassword}
            secureTextEntry
            icon="lock-check"
            error={confirmPasswordError}
          />

          <View style={[styles.checkboxContainer, { marginBottom: spacing.md }]}>
            <TouchableOpacity
              style={[styles.checkbox, { borderColor: colors.accent, borderRadius: borderRadius.sm }]}
              onPress={() => setAgreedToTerms(!agreedToTerms)}>
              {agreedToTerms && <View style={[styles.checkboxChecked, { backgroundColor: colors.accent }]} />}
            </TouchableOpacity>
            <View style={styles.termsTextContainer}>
              <Text style={[typography.caption, { color: colors.subtext }]}>I agree to the </Text>
              <TouchableOpacity onPress={() => setShowTermsModal(true)}>
                <Text style={[typography.caption, { color: colors.accent, textDecorationLine: 'underline' }]}>
                  Terms & Conditions
                </Text>
              </TouchableOpacity>
              <Text style={[typography.caption, { color: colors.subtext }]}> and </Text>
              <TouchableOpacity onPress={() => setShowPrivacyModal(true)}>
                <Text style={[typography.caption, { color: colors.accent, textDecorationLine: 'underline' }]}>
                  Privacy Policy
                </Text>
              </TouchableOpacity>
            </View>
          </View>

          <AppButton
            title="Sign Up"
            onPress={handleSignup}
            loading={loading}
            disabled={!agreedToTerms}
            fullWidth
            style={{ marginBottom: spacing.sm }}
          />

          <View style={[styles.divider, { marginVertical: spacing.lg }]}>
            <View style={[styles.dividerLine, { backgroundColor: colors.border }]} />
            <Text style={[typography.caption, { color: colors.subtext, paddingHorizontal: spacing.md }]}>
              OR
            </Text>
            <View style={[styles.dividerLine, { backgroundColor: colors.border }]} />
          </View>

          <GoogleSignInButton
            onPress={handleGoogleSignUp}
            loading={googleLoading}
            disabled={!agreedToTerms}
            text="Sign up with Google"
          />

          <TouchableOpacity onPress={onNavigateToLogin} style={{ marginTop: spacing.md }}>
            <Text style={[typography.caption, { color: colors.accent, textAlign: 'center' }]}>
              Already have an account? Login
            </Text>
          </TouchableOpacity>
        </Card>
      </View>

      <LegalModal
        visible={showTermsModal}
        onClose={() => setShowTermsModal(false)}
        title="Terms & Conditions"
        content={TERMS_CONTENT}
      />

      <LegalModal
        visible={showPrivacyModal}
        onClose={() => setShowPrivacyModal(false)}
        title="Privacy Policy"
        content={PRIVACY_CONTENT}
      />
    </ScreenWrapper>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// SHARED COMPONENTS
// ═══════════════════════════════════════════════════════════════════════════════

interface GoogleSignInButtonProps {
  onPress: () => void;
  loading: boolean;
  disabled?: boolean;
  text: string;
}

function GoogleSignInButton({ onPress, loading, disabled, text }: GoogleSignInButtonProps) {
  const { borderRadius } = useTheme();
  
  return (
    <TouchableOpacity
      style={[
        styles.googleButton,
        { borderRadius: borderRadius.md, height: 48 },
        disabled && styles.googleButtonDisabled,
      ]}
      onPress={onPress}
      disabled={loading || disabled}>
      {loading ? (
        <ActivityIndicator color="#111" />
      ) : (
        <>
          <View style={styles.googleIconContainer}>
            <Text style={styles.googleIcon}>G</Text>
          </View>
          <Text style={styles.googleButtonText}>{text}</Text>
        </>
      )}
    </TouchableOpacity>
  );
}

interface LegalModalProps {
  visible: boolean;
  onClose: () => void;
  title: string;
  content: string;
}

function LegalModal({ visible, onClose, title, content }: LegalModalProps) {
  const { colors, typography, spacing } = useTheme();
  
  return (
    <Modal
      visible={visible}
      transparent={true}
      animationType="fade"
      onRequestClose={onClose}>
      <View style={[styles.modalOverlay, { backgroundColor: colors.modalOverlay }]}>
        <Card style={{ width: '90%', maxHeight: '80%', padding: spacing.lg }}>
          <Text style={[typography.h2, { color: colors.text, marginBottom: spacing.md }]}>
            {title}
          </Text>
          <ScrollView style={styles.modalContent} showsVerticalScrollIndicator={true}>
            <Text style={[typography.caption, { color: colors.subtext, lineHeight: 22 }]}>
              {content}
            </Text>
          </ScrollView>
          <AppButton
            title="Close"
            onPress={onClose}
            variant="primary"
            fullWidth
            style={{ marginTop: spacing.md }}
          />
        </Card>
      </View>
    </Modal>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// LEGAL CONTENT
// ═══════════════════════════════════════════════════════════════════════════════

const TERMS_CONTENT = `Last Updated: April 1, 2026

1. Acceptance of Terms
By creating an account and using SpendSense, you agree to be bound by these Terms & Conditions.

2. Description of Service
SpendSense is a personal finance and expense tracking application.

3. User Responsibilities
• You are responsible for maintaining the accuracy of all data
• You must keep your account credentials secure
• You must provide accurate information during registration

4. Account Security
You are responsible for maintaining the security of your account and password.

5. No Financial Advice
SpendSense is a tool for tracking financial information. We do not provide financial advice.

6. Contact Information
If you have questions, contact us at support@spendsense.app`;

const PRIVACY_CONTENT = `Last Updated: April 1, 2026

1. Introduction
SpendSense is committed to protecting your privacy.

2. Information We Collect
• Email address and password
• Transaction data you manually enter
• Usage statistics

3. What We Do NOT Collect
• We do NOT read your SMS messages
• We do NOT access your bank accounts directly
• We do NOT track your location

4. Data Storage and Security
Your data is stored securely using Supabase with encryption.

5. Contact Us
Email: privacy@spendsense.app`;

// ═══════════════════════════════════════════════════════════════════════════════
// STYLES
// ═══════════════════════════════════════════════════════════════════════════════

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
  googleButtonDisabled: {
    backgroundColor: '#cccccc',
    borderColor: '#cccccc',
    opacity: 0.6,
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
  checkboxContainer: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  checkbox: {
    width: 20,
    height: 20,
    borderWidth: 2,
    marginRight: 10,
    marginTop: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxChecked: {
    width: 12,
    height: 12,
    borderRadius: 2,
  },
  termsTextContainer: {
    flex: 1,
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
  },
  modalOverlay: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  modalContent: {
    maxHeight: 400,
  },
});
