import React, { useState, useEffect } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator, Modal, ScrollView } from 'react-native';
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
    // Configure Google Sign-In on mount
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

    const { error } = await supabase.auth.signUp({
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
    } else {
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

    const { error: googleError } = await signInWithGoogle();

    setGoogleLoading(false);

    if (googleError) {
      const errorMessage = googleError instanceof Error ? googleError.message : 'Google Sign-Up failed';
      Toast.show({
        type: 'error',
        text1: 'Signup Failed',
        text2: errorMessage,
      });
    } else {
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

  return null;
}
