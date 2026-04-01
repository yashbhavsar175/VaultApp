import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  SafeAreaView,
  Modal,
  ScrollView,
} from 'react-native';
import Toast from 'react-native-toast-message';
import { supabase } from '../lib/supabase';
import { signInWithGoogle, configureGoogleSignIn } from '../lib/googleAuth';
import { useTheme } from '../context/ThemeContext';

interface SignupScreenProps {
  onNavigateToLogin: () => void;
}

export default function SignupScreen({ onNavigateToLogin }: SignupScreenProps) {
  const { colors } = useTheme();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [error, setError] = useState('');
  const [agreedToTerms, setAgreedToTerms] = useState(false);
  const [showTermsModal, setShowTermsModal] = useState(false);
  const [showPrivacyModal, setShowPrivacyModal] = useState(false);

  useEffect(() => {
    // Configure Google Sign-In on mount
    configureGoogleSignIn();
  }, []);

  const handleSignup = async () => {
    if (!email || !password || !confirmPassword) {
      setError('Please fill in all fields');
      return;
    }

    if (password !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }

    if (password.length < 6) {
      setError('Password must be at least 6 characters');
      return;
    }

    if (!agreedToTerms) {
      setError('Please agree to the Terms & Conditions');
      return;
    }

    setLoading(true);
    setError('');

    const { error } = await supabase.auth.signUp({
      email,
      password,
    });

    setLoading(false);

    if (error) {
      setError(error.message);
      Toast.show({
        type: 'error',
        text1: 'Signup Failed',
        text2: error.message,
      });
    } else {
      Toast.show({
        type: 'success',
        text1: 'Account Created',
        text2: 'Welcome to VaultApp!',
      });
    }
  };

  const handleGoogleSignUp = async () => {
    if (!agreedToTerms) {
      setError('Please agree to the Terms & Conditions');
      Toast.show({
        type: 'error',
        text1: 'Terms Required',
        text2: 'Please agree to the Terms & Conditions',
      });
      return;
    }

    setGoogleLoading(true);
    setError('');

    const { data, error: googleError } = await signInWithGoogle();

    setGoogleLoading(false);

    if (googleError) {
      const errorMessage = googleError instanceof Error ? googleError.message : 'Google Sign-Up failed';
      setError(errorMessage);
      Toast.show({
        type: 'error',
        text1: 'Signup Failed',
        text2: errorMessage,
      });
    } else {
      Toast.show({
        type: 'success',
        text1: 'Account Created',
        text2: 'Welcome to VaultApp!',
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
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
      <KeyboardAvoidingView
        style={styles.keyboardView}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <View style={[styles.card, { backgroundColor: colors.card }]}>
          <Text style={[styles.title, { color: colors.text }]}>Create Account</Text>
          <Text style={[styles.subtitle, { color: colors.subtext }]}>Sign up to get started</Text>

          <TextInput
            style={[styles.input, { backgroundColor: colors.input, borderColor: colors.border, color: colors.text }]}
            placeholder="Email"
            placeholderTextColor={colors.subtext}
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            keyboardType="email-address"
          />

          <TextInput
            style={[styles.input, { backgroundColor: colors.input, borderColor: colors.border, color: colors.text }]}
            placeholder="Password"
            placeholderTextColor={colors.subtext}
            value={password}
            onChangeText={setPassword}
            secureTextEntry
          />

          <TextInput
            style={[styles.input, { backgroundColor: colors.input, borderColor: colors.border, color: colors.text }]}
            placeholder="Confirm Password"
            placeholderTextColor={colors.subtext}
            value={confirmPassword}
            onChangeText={setConfirmPassword}
            secureTextEntry
          />

          <View style={styles.checkboxContainer}>
            <TouchableOpacity
              style={[styles.checkbox, { borderColor: colors.accent }]}
              onPress={() => setAgreedToTerms(!agreedToTerms)}>
              {agreedToTerms && <View style={[styles.checkboxChecked, { backgroundColor: colors.accent }]} />}
            </TouchableOpacity>
            <View style={styles.termsTextContainer}>
              <Text style={[styles.termsText, { color: colors.subtext }]}>I agree to the </Text>
              <TouchableOpacity onPress={handleTermsPress}>
                <Text style={[styles.termsLink, { color: colors.accent }]}>Terms & Conditions</Text>
              </TouchableOpacity>
              <Text style={[styles.termsText, { color: colors.subtext }]}> and </Text>
              <TouchableOpacity onPress={handlePrivacyPress}>
                <Text style={[styles.termsLink, { color: colors.accent }]}>Privacy Policy</Text>
              </TouchableOpacity>
            </View>
          </View>

          {error ? <Text style={[styles.error, { color: colors.error }]}>{error}</Text> : null}

          <TouchableOpacity
            style={[styles.button, { backgroundColor: colors.accent }, !agreedToTerms && styles.buttonDisabled]}
            onPress={handleSignup}
            disabled={loading || !agreedToTerms}>
            {loading ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.buttonText}>Sign Up</Text>
            )}
          </TouchableOpacity>

          <View style={styles.divider}>
            <View style={[styles.dividerLine, { backgroundColor: colors.border }]} />
            <Text style={[styles.dividerText, { color: colors.subtext }]}>OR</Text>
            <View style={[styles.dividerLine, { backgroundColor: colors.border }]} />
          </View>

          <TouchableOpacity
            style={[styles.googleButton, !agreedToTerms && styles.googleButtonDisabled]}
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

          <TouchableOpacity onPress={onNavigateToLogin}>
            <Text style={[styles.link, { color: colors.accent }]}>Already have an account? Login</Text>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>

      {/* Terms & Conditions Modal */}
      <Modal
        visible={showTermsModal}
        transparent={true}
        animationType="fade"
        onRequestClose={() => setShowTermsModal(false)}>
        <View style={[styles.modalOverlay, { backgroundColor: colors.modalOverlay }]}>
          <View style={[styles.modalCard, { backgroundColor: colors.card }]}>
            <Text style={[styles.modalTitle, { color: colors.text }]}>Terms & Conditions</Text>
            <ScrollView style={styles.modalContent} showsVerticalScrollIndicator={true}>
              <Text style={[styles.modalText, { color: colors.subtext }]}>
                <Text style={[styles.modalSectionTitle, { color: colors.text }]}>Last Updated: April 1, 2026{'\n\n'}</Text>
                
                <Text style={[styles.modalSectionTitle, { color: colors.text }]}>1. Acceptance of Terms{'\n'}</Text>
                By creating an account and using SpendSense, you agree to be bound by these Terms & Conditions. If you do not agree to these terms, please do not use our app.{'\n\n'}
                
                <Text style={[styles.modalSectionTitle, { color: colors.text }]}>2. Description of Service{'\n'}</Text>
                SpendSense is a personal finance and expense tracking application that allows you to manually track your transactions, bank accounts, loans, credit cards, and budgets. The app is designed to help you manage your personal finances more effectively.{'\n\n'}
                
                <Text style={[styles.modalSectionTitle, { color: colors.text }]}>3. User Responsibilities{'\n'}</Text>
                • You are responsible for maintaining the accuracy of all data you enter into the app{'\n'}
                • You must keep your account credentials secure and confidential{'\n'}
                • You are responsible for all activities that occur under your account{'\n'}
                • You must provide accurate and complete information during registration{'\n'}
                • You must not use the app for any illegal or unauthorized purpose{'\n\n'}
                
                <Text style={[styles.modalSectionTitle, { color: colors.text }]}>4. Account Security{'\n'}</Text>
                You are responsible for maintaining the security of your account and password. SpendSense cannot and will not be liable for any loss or damage from your failure to comply with this security obligation. You must notify us immediately of any unauthorized use of your account.{'\n\n'}
                
                <Text style={[styles.modalSectionTitle, { color: colors.text }]}>5. No Financial Advice{'\n'}</Text>
                SpendSense is a tool for tracking and organizing your financial information. We do not provide financial, investment, tax, or legal advice. Any information provided by the app should not be considered as professional financial advice. You should consult with qualified professionals for specific financial advice.{'\n\n'}
                
                <Text style={[styles.modalSectionTitle, { color: colors.text }]}>6. Data Entry and Accuracy{'\n'}</Text>
                All transaction data, account balances, and financial information in SpendSense are manually entered by you. We do not automatically sync with your bank accounts or read your SMS messages. You are solely responsible for the accuracy and completeness of the data you enter.{'\n\n'}
                
                <Text style={[styles.modalSectionTitle, { color: colors.text }]}>7. Limitation of Liability{'\n'}</Text>
                SpendSense and its creators shall not be liable for any indirect, incidental, special, consequential, or punitive damages resulting from your use or inability to use the app. This includes but is not limited to financial losses, data loss, or any other damages arising from the use of the app.{'\n\n'}
                
                <Text style={[styles.modalSectionTitle, { color: colors.text }]}>8. Service Availability{'\n'}</Text>
                We strive to keep SpendSense available at all times, but we do not guarantee uninterrupted access. The app may be unavailable due to maintenance, updates, or circumstances beyond our control.{'\n\n'}
                
                <Text style={[styles.modalSectionTitle, { color: colors.text }]}>9. Changes to Terms{'\n'}</Text>
                We reserve the right to modify these Terms & Conditions at any time. We will notify users of any material changes through the app or via email. Your continued use of SpendSense after such modifications constitutes your acceptance of the updated terms.{'\n\n'}
                
                <Text style={[styles.modalSectionTitle, { color: colors.text }]}>10. Account Termination{'\n'}</Text>
                You may delete your account at any time through the app settings. We reserve the right to suspend or terminate accounts that violate these terms or engage in fraudulent or illegal activities.{'\n\n'}
                
                <Text style={[styles.modalSectionTitle, { color: colors.text }]}>11. Third-Party Services{'\n'}</Text>
                SpendSense uses third-party services including Supabase for data storage and Google Sign-In for authentication. Your use of these services is subject to their respective terms and conditions.{'\n\n'}
                
                <Text style={[styles.modalSectionTitle, { color: colors.text }]}>12. Contact Information{'\n'}</Text>
                If you have any questions about these Terms & Conditions, please contact us at support@spendsense.app
              </Text>
            </ScrollView>
            <TouchableOpacity
              style={[styles.modalButton, { backgroundColor: colors.accent }]}
              onPress={() => setShowTermsModal(false)}>
              <Text style={styles.modalButtonText}>Close</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Privacy Policy Modal */}
      <Modal
        visible={showPrivacyModal}
        transparent={true}
        animationType="fade"
        onRequestClose={() => setShowPrivacyModal(false)}>
        <View style={[styles.modalOverlay, { backgroundColor: colors.modalOverlay }]}>
          <View style={[styles.modalCard, { backgroundColor: colors.card }]}>
            <Text style={[styles.modalTitle, { color: colors.text }]}>Privacy Policy</Text>
            <ScrollView style={styles.modalContent} showsVerticalScrollIndicator={true}>
              <Text style={[styles.modalText, { color: colors.subtext }]}>
                <Text style={[styles.modalSectionTitle, { color: colors.text }]}>Last Updated: April 1, 2026{'\n\n'}</Text>
                
                <Text style={[styles.modalSectionTitle, { color: colors.text }]}>1. Introduction{'\n'}</Text>
                SpendSense ("we", "our", or "us") is committed to protecting your privacy. This Privacy Policy explains how we collect, use, store, and protect your personal information when you use our mobile application.{'\n\n'}
                
                <Text style={[styles.modalSectionTitle, { color: colors.text }]}>2. Information We Collect{'\n\n'}</Text>
                
                <Text style={[styles.modalSubtitle, { color: colors.text }]}>2.1 Account Information{'\n'}</Text>
                • Email address (for account creation and authentication){'\n'}
                • Password (encrypted and securely stored){'\n'}
                • Google account information (if you choose to sign in with Google){'\n\n'}
                
                <Text style={[styles.modalSubtitle, { color: colors.text }]}>2.2 Financial Data You Enter{'\n'}</Text>
                • Transaction details (amount, date, category, description){'\n'}
                • Bank account information (names, balances - manually entered by you){'\n'}
                • Loan and credit card details (manually entered by you){'\n'}
                • Budget information and financial goals{'\n'}
                • Any notes or tags you add to transactions{'\n\n'}
                
                <Text style={[styles.modalSubtitle, { color: colors.text }]}>2.3 Usage Information{'\n'}</Text>
                • App usage statistics and analytics{'\n'}
                • Device information (device type, operating system version){'\n'}
                • Error logs and crash reports (to improve app stability){'\n\n'}
                
                <Text style={[styles.modalSectionTitle, { color: colors.text }]}>3. What We Do NOT Collect{'\n'}</Text>
                • We do NOT read your SMS messages{'\n'}
                • We do NOT access your bank accounts directly{'\n'}
                • We do NOT automatically sync with financial institutions{'\n'}
                • We do NOT collect your contacts or phone numbers{'\n'}
                • We do NOT track your location{'\n\n'}
                
                <Text style={[styles.modalSectionTitle, { color: colors.text }]}>4. How We Use Your Information{'\n'}</Text>
                • To provide and maintain the SpendSense service{'\n'}
                • To authenticate your identity and secure your account{'\n'}
                • To store and organize your financial data{'\n'}
                • To send important service notifications{'\n'}
                • To improve app functionality and user experience{'\n'}
                • To provide customer support{'\n'}
                • To detect and prevent fraud or security issues{'\n\n'}
                
                <Text style={[styles.modalSectionTitle, { color: colors.text }]}>5. Data Storage and Security{'\n'}</Text>
                Your data is stored securely using Supabase, a trusted cloud database provider. We implement industry-standard security measures including:{'\n'}
                • End-to-end encryption for data transmission{'\n'}
                • Encrypted storage of sensitive information{'\n'}
                • Secure authentication protocols{'\n'}
                • Regular security audits and updates{'\n'}
                • Access controls and monitoring{'\n\n'}
                
                However, no method of transmission over the internet is 100% secure. While we strive to protect your data, we cannot guarantee absolute security.{'\n\n'}
                
                <Text style={[styles.modalSectionTitle, { color: colors.text }]}>6. Google Sign-In{'\n'}</Text>
                If you choose to sign in with Google, we receive basic profile information from Google (email address and name). This information is used solely for authentication purposes. We do not access any other data from your Google account. Your use of Google Sign-In is subject to Google's Privacy Policy.{'\n\n'}
                
                <Text style={[styles.modalSectionTitle, { color: colors.text }]}>7. Data Sharing and Disclosure{'\n'}</Text>
                We do NOT sell, rent, or trade your personal information to third parties. We may share your information only in the following circumstances:{'\n'}
                • With your explicit consent{'\n'}
                • To comply with legal obligations or court orders{'\n'}
                • To protect our rights, property, or safety{'\n'}
                • With service providers who help us operate the app (e.g., Supabase for hosting){'\n\n'}
                
                <Text style={[styles.modalSectionTitle, { color: colors.text }]}>8. Your Rights and Choices{'\n\n'}</Text>
                
                <Text style={[styles.modalSubtitle, { color: colors.text }]}>8.1 Access and Control{'\n'}</Text>
                • You can access and edit your data at any time through the app{'\n'}
                • You can export your data in a portable format{'\n'}
                • You can delete individual transactions or entire categories{'\n\n'}
                
                <Text style={[styles.modalSubtitle, { color: colors.text }]}>8.2 Account Deletion{'\n'}</Text>
                You have the right to delete your account and all associated data at any time. To delete your account:{'\n'}
                • Go to Settings → Account → Delete Account{'\n'}
                • All your data will be permanently removed from our servers{'\n'}
                • This action cannot be undone{'\n\n'}
                
                <Text style={[styles.modalSectionTitle, { color: colors.text }]}>9. Data Retention{'\n'}</Text>
                We retain your data for as long as your account is active. When you delete your account, we permanently delete all your personal and financial data within 30 days, except where we are required to retain it for legal purposes.{'\n\n'}
                
                <Text style={[styles.modalSectionTitle, { color: colors.text }]}>10. Children's Privacy{'\n'}</Text>
                SpendSense is not intended for users under the age of 13. We do not knowingly collect personal information from children under 13. If you believe we have collected information from a child under 13, please contact us immediately.{'\n\n'}
                
                <Text style={[styles.modalSectionTitle, { color: colors.text }]}>11. Changes to This Privacy Policy{'\n'}</Text>
                We may update this Privacy Policy from time to time. We will notify you of any material changes by posting the new Privacy Policy in the app and updating the "Last Updated" date. Your continued use of SpendSense after changes constitutes acceptance of the updated policy.{'\n\n'}
                
                <Text style={[styles.modalSectionTitle, { color: colors.text }]}>12. International Users{'\n'}</Text>
                Your data may be stored and processed in any country where we or our service providers operate. By using SpendSense, you consent to the transfer of your information to countries outside your country of residence.{'\n\n'}
                
                <Text style={[styles.modalSectionTitle, { color: colors.text }]}>13. Contact Us{'\n'}</Text>
                If you have any questions, concerns, or requests regarding this Privacy Policy or your personal data, please contact us at:{'\n\n'}
                Email: privacy@spendsense.app{'\n'}
                Support: support@spendsense.app{'\n\n'}
                
                We will respond to your inquiry within 30 days.
              </Text>
            </ScrollView>
            <TouchableOpacity
              style={[styles.modalButton, { backgroundColor: colors.accent }]}
              onPress={() => setShowPrivacyModal(false)}>
              <Text style={styles.modalButtonText}>Close</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  keyboardView: {
    flex: 1,
    justifyContent: 'center',
    padding: 20,
  },
  card: {
    borderRadius: 20,
    padding: 24,
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 16,
    marginBottom: 24,
  },
  input: {
    borderWidth: 1,
    borderRadius: 10,
    padding: 12,
    fontSize: 16,
    marginBottom: 16,
  },
  button: {
    borderRadius: 10,
    padding: 16,
    alignItems: 'center',
    marginTop: 8,
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  buttonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  error: {
    marginBottom: 12,
    fontSize: 14,
  },
  link: {
    textAlign: 'center',
    marginTop: 16,
    fontSize: 14,
  },
  checkboxContainer: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 16,
    marginTop: 4,
  },
  checkbox: {
    width: 20,
    height: 20,
    borderWidth: 2,
    borderRadius: 4,
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
  termsText: {
    fontSize: 14,
    lineHeight: 20,
  },
  termsLink: {
    fontSize: 14,
    lineHeight: 20,
    textDecorationLine: 'underline',
  },
  divider: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: 20,
  },
  dividerLine: {
    flex: 1,
    height: 1,
  },
  dividerText: {
    paddingHorizontal: 12,
    fontSize: 14,
  },
  googleButton: {
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#ffffff',
    borderRadius: 10,
    height: 48,
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    marginBottom: 8,
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
  modalCard: {
    borderRadius: 20,
    padding: 24,
    width: '100%',
    maxHeight: '80%',
  },
  modalTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    marginBottom: 16,
  },
  modalContent: {
    maxHeight: 400,
    marginBottom: 20,
  },
  modalText: {
    fontSize: 15,
    lineHeight: 22,
  },
  modalSectionTitle: {
    fontSize: 16,
    fontWeight: '600',
    lineHeight: 24,
  },
  modalSubtitle: {
    fontSize: 15,
    fontWeight: '500',
    lineHeight: 22,
  },
  modalButton: {
    borderRadius: 10,
    padding: 16,
    alignItems: 'center',
  },
  modalButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
});

