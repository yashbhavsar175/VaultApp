import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Modal,
  ScrollView,
  Animated,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Toast from 'react-native-toast-message';
import HapticFeedback from 'react-native-haptic-feedback';
import ReactNativeBiometrics from 'react-native-biometrics';
import { supabase, signInWithGoogle } from '../../lib/core';
import { useTheme } from '../../context/ThemeContext';
import { ScreenWrapper, Card, AppButton, AppInput } from '../../components';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';

const AUTH_ACTION_TIMEOUT_MS = 15000;
const AUTH_EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_SIGNUP_PASSWORD_STRENGTH = 3;
const HAPTIC_DEBOUNCE_MS = 400;
const LOGIN_FLAG_KEY = 'has_logged_in_before';
const APP_USER_ID_KEY = 'app_user_id';
const SESSION_EXPIRY_BUFFER_MS = 30 * 1000;

const withAuthActionTimeout = async <T,>(promise: Promise<T>, label: string): Promise<T> => {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;

  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error(`${label} timed out. Please check your connection and try again.`));
    }, AUTH_ACTION_TIMEOUT_MS);
    activeAuthActionTimeouts.add(timeoutId);
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
      activeAuthActionTimeouts.delete(timeoutId);
    }
  }
};

const activeAuthActionTimeouts = new Set<ReturnType<typeof setTimeout>>();
let lastHapticAt = 0;

function triggerHaptic(pattern: Parameters<typeof HapticFeedback.trigger>[0]): void {
  const now = Date.now();
  if (now - lastHapticAt < HAPTIC_DEBOUNCE_MS) return;
  lastHapticAt = now;
  HapticFeedback.trigger(pattern, {
    enableVibrateFallback: true,
    ignoreAndroidSystemSettings: false,
  });
}

function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

function isValidEmail(value: string): boolean {
  return AUTH_EMAIL_PATTERN.test(normalizeEmail(value));
}

function isValidPersistedSession(session: { user?: unknown; expires_at?: number | null } | null | undefined): boolean {
  if (!session?.user || typeof session.expires_at !== 'number') return false;
  return session.expires_at * 1000 > Date.now() + SESSION_EXPIRY_BUFFER_MS;
}

// ═══════════════════════════════════════════════════════════════════════════════
// LOGIN SCREEN
// ═══════════════════════════════════════════════════════════════════════════════

interface LoginScreenProps {
  onNavigateToSignup: () => void;
  onAuthenticated?: () => void;
}

export function LoginScreen({ onNavigateToSignup, onAuthenticated }: LoginScreenProps) {
  const { colors, typography, spacing, borderRadius } = useTheme();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [error, setError] = useState('');
  const [hasPreviousLogin, setHasPreviousLogin] = useState(false);
  const [biometricAvailable, setBiometricAvailable] = useState(false);

  // Shake animation for error states
  const shakeAnim = useRef(new Animated.Value(0)).current;
  const shake = useCallback(() => {
    triggerHaptic('notificationError');
    Animated.sequence([
      Animated.timing(shakeAnim, { toValue: 10, duration: 60, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: -10, duration: 60, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: 8, duration: 60, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: -8, duration: 60, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: 0, duration: 60, useNativeDriver: true }),
    ]).start();
  }, [shakeAnim]);

  useEffect(() => {
    let isMounted = true;
    (async () => {
      try {
        const flag = await AsyncStorage.getItem(LOGIN_FLAG_KEY);
        const rnBiometrics = new ReactNativeBiometrics();
        const { available } = await rnBiometrics.isSensorAvailable();

        // If the session is expired/missing, hide the biometric button
        // since it can't log the user in without a password.
        const { data: { session } } = await supabase.auth.getSession();

        if (!isMounted) return;
        setBiometricAvailable(available);
        setHasPreviousLogin(Boolean(flag && available && isValidPersistedSession(session)));
      } catch (err) {
        if (__DEV__) console.error('Failed to load biometric login state:', err);
        if (!isMounted) return;
        setHasPreviousLogin(false);
        setBiometricAvailable(false);
      }
    })();
    return () => {
      isMounted = false;
    };
  }, []);

  const handleBiometricLogin = async () => {
    triggerHaptic('impactLight');
    try {
      const rnBiometrics = new ReactNativeBiometrics();
      const { success } = await rnBiometrics.simplePrompt({
        promptMessage: 'Quick Login to SpendSense',
        cancelButtonText: 'Use Password',
      });
      if (success) {
        triggerHaptic('notificationSuccess');
        // Re-use existing Supabase session (persisted by the Supabase auth storage adapter)
        const { data: { session } } = await withAuthActionTimeout(
          supabase.auth.getSession(),
          'Biometric session check',
        );
        if (isValidPersistedSession(session)) {
          setHasPreviousLogin(true);
          Toast.show({ type: 'success', text1: 'Welcome Back', text2: 'Biometric login successful' });
          onAuthenticated?.();
        } else {
          setHasPreviousLogin(false);
          Toast.show({ type: 'info', text1: 'Session Expired', text2: 'Please login with password' });
        }
      } else {
        shake();
      }
    } catch (e) {
      shake();
      if (__DEV__) console.error('Biometric login error:', e);
    }
  };

  const handleLogin = async () => {
    if (loading || googleLoading) return;
    triggerHaptic('impactLight');
    const normalizedEmail = normalizeEmail(email);
    if (!normalizedEmail || !password) {
      setError('Please fill in all fields');
      shake();
      return;
    }
    if (!isValidEmail(normalizedEmail)) {
      setError('Please enter a valid email address');
      shake();
      return;
    }

    setLoading(true);
    setError('');

    try {
      const { data, error: authError } = await withAuthActionTimeout(
        supabase.auth.signInWithPassword({
          email: normalizedEmail,
          password,
        }),
        'Login',
      );

      if (authError) {
        setError(authError.message);
        shake();
        Toast.show({
          type: 'error',
          text1: 'Login Failed',
          text2: authError.message,
        });
      } else if (data.user) {
        // Save user ID + login flag for biometric quick login
        await AsyncStorage.setItem(APP_USER_ID_KEY, data.user.id);
        await AsyncStorage.setItem(LOGIN_FLAG_KEY, '1');
        triggerHaptic('notificationSuccess');
        Toast.show({
          type: 'success',
          text1: 'Welcome Back',
          text2: 'Login successful',
        });
      }
    } catch (loginError) {
      const message = loginError instanceof Error ? loginError.message : 'Login failed';
      setError(message);
      shake();
      Toast.show({
        type: 'error',
        text1: 'Login Failed',
        text2: message,
      });
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleSignIn = async () => {
    if (loading || googleLoading) return;
    triggerHaptic('impactLight');
    setGoogleLoading(true);
    setError('');

    try {
      const { error: googleError, data } = await withAuthActionTimeout(
        signInWithGoogle(),
        'Google Sign-In',
      );

      if (googleError) {
        const errorMessage = googleError instanceof Error ? googleError.message : 'Google Sign-In failed';
        setError(errorMessage);
        shake();
        Toast.show({
          type: 'error',
          text1: 'Login Failed',
          text2: errorMessage,
        });
      } else if (data?.user) {
        await AsyncStorage.setItem(APP_USER_ID_KEY, data.user.id);
        await AsyncStorage.setItem(LOGIN_FLAG_KEY, '1');
        triggerHaptic('notificationSuccess');
        Toast.show({
          type: 'success',
          text1: 'Welcome Back',
          text2: 'Login successful',
        });
      }
    } catch (googleError) {
      const errorMessage = googleError instanceof Error ? googleError.message : 'Google Sign-In failed';
      setError(errorMessage);
      shake();
      Toast.show({
        type: 'error',
        text1: 'Login Failed',
        text2: errorMessage,
      });
    } finally {
      setGoogleLoading(false);
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

          {/* Biometric Quick Login — shown only if user has logged in before */}
          {hasPreviousLogin && biometricAvailable && (
            <TouchableOpacity
              style={[
                styles.biometricButton,
                { borderColor: colors.accent, borderRadius: borderRadius.md, marginBottom: spacing.md }
              ]}
              onPress={handleBiometricLogin}
              accessible
              accessibilityRole="button"
              accessibilityLabel="Quick login with biometrics"
            >
              <MaterialCommunityIcons name="fingerprint" size={22} color={colors.accent} />
              <Text style={[typography.body, { color: colors.accent, marginLeft: 8 }]}>
                Quick Login with Biometrics
              </Text>
            </TouchableOpacity>
          )}

          <Animated.View style={{ transform: [{ translateX: shakeAnim }] }}>
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
          </Animated.View>

          <AppButton
            title="Login"
            onPress={handleLogin}
            loading={loading}
            disabled={googleLoading}
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
            disabled={loading}
            text="Sign in with Google"
          />

          <TouchableOpacity
            onPress={onNavigateToSignup}
            style={{ marginTop: spacing.md }}
            accessibilityRole="button"
            accessibilityLabel="Go to signup screen">
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

  // Shake animation
  const shakeAnim = useRef(new Animated.Value(0)).current;
  const shake = useCallback(() => {
    triggerHaptic('notificationError');
    Animated.sequence([
      Animated.timing(shakeAnim, { toValue: 10, duration: 60, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: -10, duration: 60, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: 8, duration: 60, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: -8, duration: 60, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: 0, duration: 60, useNativeDriver: true }),
    ]).start();
  }, [shakeAnim]);

  // Password strength calculator
  const getPasswordStrength = useCallback((pwd: string): { level: number; label: string; color: string } => {
    if (!pwd) return { level: 0, label: '', color: 'transparent' };
    let score = 0;
    if (pwd.length >= 8) score++;
    if (pwd.length >= 12) score++;
    if (/[0-9]/.test(pwd)) score++;
    if (/[^a-zA-Z0-9]/.test(pwd)) score++; // special char
    if (/[A-Z]/.test(pwd)) score++;
    if (score <= 1) return { level: 1, label: 'Weak', color: '#ef4444' };
    if (score === 2) return { level: 2, label: 'Fair', color: '#f59e0b' };
    if (score === 3) return { level: 3, label: 'Good', color: '#3b82f6' };
    return { level: 4, label: 'Strong', color: '#10b981' };
  }, []);
  const pwStrength = useMemo(() => getPasswordStrength(password), [getPasswordStrength, password]);

  const handleSignup = async () => {
    if (loading || googleLoading) return;
    triggerHaptic('impactLight');
    setEmailError('');
    setPasswordError('');
    setConfirmPasswordError('');
    const normalizedEmail = normalizeEmail(email);

    if (!normalizedEmail || !password || !confirmPassword) {
      if (!normalizedEmail) setEmailError('Email is required');
      if (!password) setPasswordError('Password is required');
      if (!confirmPassword) setConfirmPasswordError('Please confirm password');
      shake();
      return;
    }

    if (!isValidEmail(normalizedEmail)) {
      setEmailError('Please enter a valid email address');
      shake();
      return;
    }

    if (password !== confirmPassword) {
      setConfirmPasswordError('Passwords do not match');
      shake();
      return;
    }

    if (pwStrength.level < MIN_SIGNUP_PASSWORD_STRENGTH) {
      setPasswordError('Use at least 8 characters with uppercase, number, or special character');
      shake();
      return;
    }

    if (!agreedToTerms) {
      shake();
      Toast.show({
        type: 'error',
        text1: 'Terms Required',
        text2: 'Please agree to the Terms & Conditions',
      });
      return;
    }

    setLoading(true);

    try {
      const { data, error } = await withAuthActionTimeout(
        supabase.auth.signUp({
          email: normalizedEmail,
          password,
        }),
        'Signup',
      );

      if (error) {
        setEmailError(error.message);
        shake();
        Toast.show({
          type: 'error',
          text1: 'Signup Failed',
          text2: error.message,
        });
      } else if (data.user) {
        await AsyncStorage.setItem(APP_USER_ID_KEY, data.user.id);
        await AsyncStorage.setItem(LOGIN_FLAG_KEY, '1');
        triggerHaptic('notificationSuccess');
        Toast.show({
          type: 'success',
          text1: 'Account Created',
          text2: 'Welcome to SpendSense!',
        });
      }
    } catch (signupError) {
      const message = signupError instanceof Error ? signupError.message : 'Signup failed';
      setEmailError(message);
      shake();
      Toast.show({
        type: 'error',
        text1: 'Signup Failed',
        text2: message,
      });
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleSignUp = async () => {
    if (loading || googleLoading) return;
    triggerHaptic('impactLight');
    if (!agreedToTerms) {
      shake();
      Toast.show({
        type: 'error',
        text1: 'Terms Required',
        text2: 'Please agree to the Terms & Conditions',
      });
      return;
    }

    setGoogleLoading(true);

    try {
      const { error: googleError, data } = await withAuthActionTimeout(
        signInWithGoogle(),
        'Google Sign-Up',
      );

      if (googleError) {
        const errorMessage = googleError instanceof Error ? googleError.message : 'Google Sign-Up failed';
        Toast.show({
          type: 'error',
          text1: 'Signup Failed',
          text2: errorMessage,
        });
      } else if (data?.user) {
        // Save user ID for background tasks
        await AsyncStorage.setItem(APP_USER_ID_KEY, data.user.id);
        await AsyncStorage.setItem(LOGIN_FLAG_KEY, '1');
        triggerHaptic('notificationSuccess');

        Toast.show({
          type: 'success',
          text1: 'Account Created',
          text2: 'Welcome to SpendSense!',
        });
      }
    } catch (googleError) {
      const errorMessage = googleError instanceof Error ? googleError.message : 'Google Sign-Up failed';
      Toast.show({
        type: 'error',
        text1: 'Signup Failed',
        text2: errorMessage,
      });
    } finally {
      setGoogleLoading(false);
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

          <Animated.View style={{ transform: [{ translateX: shakeAnim }] }}>
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

            {/* Password Strength Meter */}
            {password.length > 0 && (
              <View style={{ marginBottom: spacing.sm, marginTop: -4 }}>
                <View style={{ flexDirection: 'row', gap: 4, marginBottom: 4 }}>
                  {[1, 2, 3, 4].map(level => (
                    <View
                      key={level}
                      style={{
                        flex: 1,
                        height: 4,
                        borderRadius: 2,
                        backgroundColor: level <= pwStrength.level ? pwStrength.color : colors.border,
                      }}
                    />
                  ))}
                </View>
                <Text style={[typography.caption, { color: pwStrength.color, fontSize: 11 }]}>
                  {pwStrength.label} password
                  {pwStrength.level < 3 ? ' — add numbers & special chars' : ' ✔'}
                </Text>
              </View>
            )}

            <AppInput
              placeholder="Confirm Password"
              value={confirmPassword}
              onChangeText={setConfirmPassword}
              secureTextEntry
              icon="lock-check"
              error={confirmPasswordError}
            />
          </Animated.View>

          <View style={[styles.checkboxContainer, { marginBottom: spacing.md }]}>
            <TouchableOpacity
              style={[styles.checkbox, { borderColor: colors.accent, borderRadius: borderRadius.sm }]}
              onPress={() => setAgreedToTerms(!agreedToTerms)}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: agreedToTerms }}
              accessibilityLabel="Agree to Terms and Privacy Policy"
              activeOpacity={0.7}>
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
            disabled={!agreedToTerms || googleLoading}
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
            disabled={!agreedToTerms || loading}
            text="Sign up with Google"
          />

          <TouchableOpacity
            onPress={onNavigateToLogin}
            style={{ marginTop: spacing.md }}
            accessibilityRole="button"
            accessibilityLabel="Go to login screen">
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
  const { colors, typography, borderRadius } = useTheme();
  
  return (
    <TouchableOpacity
      style={[
        styles.googleButton,
        {
          backgroundColor: colors.card,
          borderColor: colors.border,
          borderRadius: borderRadius.md,
          height: 48,
        },
        disabled && styles.googleButtonDisabled,
      ]}
      onPress={onPress}
      disabled={loading || disabled}
      accessibilityRole="button"
      accessibilityLabel={text}
      accessibilityState={{ disabled: Boolean(loading || disabled), busy: loading }}>
      {loading ? (
        <ActivityIndicator color={colors.accent} />
      ) : (
        <>
          <View style={[styles.googleIconContainer, { backgroundColor: colors.background }]}>
            <Text style={styles.googleIcon}>G</Text>
          </View>
          <Text style={[styles.googleButtonText, typography.bodyBold, { color: colors.text }]}>
            {text}
          </Text>
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
          <ScrollView
            style={styles.modalContent}
            nestedScrollEnabled
            showsVerticalScrollIndicator={true}>
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
    borderWidth: 1,
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  googleButtonDisabled: {
    opacity: 0.6,
  },
  googleIconContainer: {
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
  biometricButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    paddingVertical: 12,
    paddingHorizontal: 16,
  },
  modalContent: {
    maxHeight: 400,
  },
});

