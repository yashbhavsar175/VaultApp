import React, { useState, useEffect } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator, Modal, ScrollView } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Toast from 'react-native-toast-message';
import { supabase } from '../lib/supabase';
import { signInWithGoogle, configureGoogleSignIn } from '../lib/googleAuth';
import { useTheme } from '../context/ThemeContext';
import { ScreenWrapper, Card, AppButton, AppInput } from '../components';

interface SignupScreenProps {
  onNavigateToLogin: () => void;
}

export default function SignupScreen({ onNavigateToLogin }: SignupScreenProps) {
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

  useEffect(() => {
    configureGoogleSignIn();
  }, []);

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

  const handleTermsPress = () => {
    setShowTermsModal(true);
  };

  const handlePrivacyPress = () => {
    setShowPrivacyModal(true);
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
              <TouchableOpacity onPress={handleTermsPress}>
                <Text style={[typography.caption, { color: colors.accent, textDecorationLine: 'underline' }]}>
                  Terms & Conditions
                </Text>
              </TouchableOpacity>
              <Text style={[typography.caption, { color: colors.subtext }]}> and </Text>
              <TouchableOpacity onPress={handlePrivacyPress}>
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

          <TouchableOpacity
            style={[
              styles.googleButton,
              { borderRadius: borderRadius.md, height: 48 },
              !agreedToTerms && styles.googleButtonDisabled,
            ]}
            onPress={handleGoogleSignUp}
            disabled={googleLoading || !agreedToTerms}>
            {googleLoading ? (
              <ActivityIndicator color="#111" />
            ) : (
              <>
                <View style={styles.googleIconContainer}>
                  <Text style={styles.googleIcon}>G</Text>
                </View>
                <Text style={styles.googleButtonText}>Sign up with Google</Text>
              </>
            )}
          </TouchableOpacity>

          <TouchableOpacity onPress={onNavigateToLogin} style={{ marginTop: spacing.md }}>
            <Text style={[typography.caption, { color: colors.accent, textAlign: 'center' }]}>
              Already have an account? Login
            </Text>
          </TouchableOpacity>
        </Card>
      </View>

      <Modal
        visible={showTermsModal}
        transparent={true}
        animationType="fade"
        onRequestClose={() => setShowTermsModal(false)}>
        <View style={[styles.modalOverlay, { backgroundColor: colors.modalOverlay }]}>
          <Card style={{ width: '90%', maxHeight: '80%', padding: spacing.lg }}>
            <Text style={[typography.h2, { color: colors.text, marginBottom: spacing.md }]}>
              Terms & Conditions
            </Text>
            <ScrollView style={styles.modalContent} showsVerticalScrollIndicator={true}>
              <Text style={[typography.caption, { color: colors.subtext, lineHeight: 22 }]}>
                <Text style={[typography.bodyBold, { color: colors.text }]}>Last Updated: April 1, 2026{'\n\n'}</Text>
                
                <Text style={[typography.bodyBold, { color: colors.text }]}>1. Acceptance of Terms{'\n'}</Text>
                By creating an account and using SpendSense, you agree to be bound by these Terms & Conditions.{'\n\n'}
                
                <Text style={[typography.bodyBold, { color: colors.text }]}>2. Description of Service{'\n'}</Text>
                SpendSense is a personal finance and expense tracking application.{'\n\n'}
                
                <Text style={[typography.bodyBold, { color: colors.text }]}>3. User Responsibilities{'\n'}</Text>
                • You are responsible for maintaining the accuracy of all data{'\n'}
                • You must keep your account credentials secure{'\n'}
                • You must provide accurate information during registration{'\n\n'}
                
                <Text style={[typography.bodyBold, { color: colors.text }]}>4. Account Security{'\n'}</Text>
                You are responsible for maintaining the security of your account and password.{'\n\n'}
                
                <Text style={[typography.bodyBold, { color: colors.text }]}>5. No Financial Advice{'\n'}</Text>
                SpendSense is a tool for tracking financial information. We do not provide financial advice.{'\n\n'}
                
                <Text style={[typography.bodyBold, { color: colors.text }]}>6. Contact Information{'\n'}</Text>
                If you have questions, contact us at support@spendsense.app
              </Text>
            </ScrollView>
            <AppButton
              title="Close"
              onPress={() => setShowTermsModal(false)}
              variant="primary"
              fullWidth
              style={{ marginTop: spacing.md }}
            />
          </Card>
        </View>
      </Modal>

      <Modal
        visible={showPrivacyModal}
        transparent={true}
        animationType="fade"
        onRequestClose={() => setShowPrivacyModal(false)}>
        <View style={[styles.modalOverlay, { backgroundColor: colors.modalOverlay }]}>
          <Card style={{ width: '90%', maxHeight: '80%', padding: spacing.lg }}>
            <Text style={[typography.h2, { color: colors.text, marginBottom: spacing.md }]}>
              Privacy Policy
            </Text>
            <ScrollView style={styles.modalContent} showsVerticalScrollIndicator={true}>
              <Text style={[typography.caption, { color: colors.subtext, lineHeight: 22 }]}>
                <Text style={[typography.bodyBold, { color: colors.text }]}>Last Updated: April 1, 2026{'\n\n'}</Text>
                
                <Text style={[typography.bodyBold, { color: colors.text }]}>1. Introduction{'\n'}</Text>
                SpendSense is committed to protecting your privacy.{'\n\n'}
                
                <Text style={[typography.bodyBold, { color: colors.text }]}>2. Information We Collect{'\n'}</Text>
                • Email address and password{'\n'}
                • Transaction data you manually enter{'\n'}
                • Usage statistics{'\n\n'}
                
                <Text style={[typography.bodyBold, { color: colors.text }]}>3. What We Do NOT Collect{'\n'}</Text>
                • We do NOT read your SMS messages{'\n'}
                • We do NOT access your bank accounts directly{'\n'}
                • We do NOT track your location{'\n\n'}
                
                <Text style={[typography.bodyBold, { color: colors.text }]}>4. Data Storage and Security{'\n'}</Text>
                Your data is stored securely using Supabase with encryption.{'\n\n'}
                
                <Text style={[typography.bodyBold, { color: colors.text }]}>5. Contact Us{'\n'}</Text>
                Email: privacy@spendsense.app
              </Text>
            </ScrollView>
            <AppButton
              title="Close"
              onPress={() => setShowPrivacyModal(false)}
              variant="primary"
              fullWidth
              style={{ marginTop: spacing.md }}
            />
          </Card>
        </View>
      </Modal>
    </ScreenWrapper>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
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
      