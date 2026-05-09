import React, { useState, useEffect } from 'react';
import { View, Text, Modal, StyleSheet, TouchableOpacity, Alert } from 'react-native';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import notifee from '@notifee/react-native';
import { useTheme } from '../context/ThemeContext';
import { checkSmsPermissions, requestSmsPermissions } from '../utils/smsPermissions';
import { checkNotificationPermission, requestNotificationPermission } from '../utils/notificationPermissions';

const PERMISSION_CHECK_KEY = 'permissions_granted';

interface PermissionPromptProps {
  onAllPermissionsGranted?: () => void;
}

export default function PermissionPrompt({ onAllPermissionsGranted }: PermissionPromptProps) {
  const { colors, typography, spacing, borderRadius } = useTheme();
  const [visible, setVisible] = useState(false);
  const [currentStep, setCurrentStep] = useState<'sms' | 'notification' | 'push' | 'complete'>('sms');
  const [smsGranted, setSmsGranted] = useState(false);
  const [notificationGranted, setNotificationGranted] = useState(false);
  const [pushGranted, setPushGranted] = useState(false);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    checkPermissions();
  }, []);

  const checkPermissions = async () => {
    try {
      setChecking(true);
      
      // Always check actual permissions, ignore AsyncStorage
      const sms = await checkSmsPermissions();
      const notification = await checkNotificationPermission();
      
      // Check push notification permission (Notifee)
      const pushSettings = await notifee.getNotificationSettings();
      const push = pushSettings.authorizationStatus === 1; // 1 = AUTHORIZED

      setSmsGranted(sms);
      setNotificationGranted(notification);
      setPushGranted(push);

      // If all three granted, mark as complete and don't show
      if (sms && notification && push) {
        await AsyncStorage.setItem(PERMISSION_CHECK_KEY, 'true');
        setVisible(false);
        onAllPermissionsGranted?.();
        setChecking(false);
        return;
      }

      // Show prompt for missing permissions (in order)
      if (!sms) {
        setCurrentStep('sms');
        setVisible(true);
      } else if (!notification) {
        setCurrentStep('notification');
        setVisible(true);
      } else if (!push) {
        setCurrentStep('push');
        setVisible(true);
      }
      
      setChecking(false);
    } catch (error) {
      console.error('Error checking permissions:', error);
      setChecking(false);
    }
  };

  const handleSmsPermission = async () => {
    const granted = await requestSmsPermissions();
    setSmsGranted(granted);

    if (granted) {
      // Move to notification permission
      if (!notificationGranted) {
        setCurrentStep('notification');
      } else if (!pushGranted) {
        setCurrentStep('push');
      } else {
        // All done
        await AsyncStorage.setItem(PERMISSION_CHECK_KEY, 'true');
        setVisible(false);
        onAllPermissionsGranted?.();
      }
    } else {
      Alert.alert(
        'Permission Required',
        'SMS permission is needed to automatically track transactions from bank SMS. You can enable it later from Settings.',
        [{ text: 'OK' }]
      );
    }
  };

  const handleNotificationPermission = () => {
    requestNotificationPermission();
    // Modal will close, but will reappear on next app open if permission not granted
    setVisible(false);
  };

  const handlePushPermission = async () => {
    const settings = await notifee.requestPermission();
    const granted = settings.authorizationStatus === 1; // 1 = AUTHORIZED
    setPushGranted(granted);

    if (granted) {
      // All done
      await AsyncStorage.setItem(PERMISSION_CHECK_KEY, 'true');
      setVisible(false);
      onAllPermissionsGranted?.();
    } else {
      Alert.alert(
        'Permission Required',
        'Push notification permission is needed to send you reminders and alerts. You can enable it later from Settings.',
        [{ text: 'OK' }]
      );
    }
  };

  const handleSkip = () => {
    // Just close the modal, don't mark as complete
    // It will show again on next app open if permissions still not granted
    setVisible(false);
  };

  if (!visible) return null;

  return (
    <Modal
      visible={visible}
      animationType="fade"
      transparent={true}
      onRequestClose={() => {}}
    >
      <View style={styles.overlay}>
        <View style={[styles.container, { backgroundColor: colors.background }]}>
          {/* Icon */}
          <View style={[styles.iconContainer, { backgroundColor: colors.accent + '20' }]}>
            <MaterialCommunityIcons
              name={currentStep === 'sms' ? 'message-text' : currentStep === 'notification' ? 'bell' : 'bell-ring'}
              size={48}
              color={colors.accent}
            />
          </View>

          {/* Title */}
          <Text style={[typography.h2, { color: colors.text, marginTop: spacing.lg, textAlign: 'center' }]}>
            {currentStep === 'sms' 
              ? 'Enable SMS Tracking' 
              : currentStep === 'notification'
              ? 'Enable Notification Tracking'
              : 'Enable Push Notifications'}
          </Text>

          {/* Description */}
          <Text style={[typography.body, { color: colors.subtext, marginTop: spacing.sm, textAlign: 'center', lineHeight: 22 }]}>
            {currentStep === 'sms'
              ? 'SpendSense needs SMS permission to automatically track transactions from your bank SMS messages.'
              : currentStep === 'notification'
              ? 'Enable notification access to track transactions from payment apps like GPay, PhonePe, Slice, CRED, etc.'
              : 'Allow push notifications to receive reminders, alerts, and important updates from SpendSense.'}
          </Text>

          {/* Features */}
          <View style={{ marginTop: spacing.lg, width: '100%' }}>
            <View style={styles.featureRow}>
              <MaterialCommunityIcons name="check-circle" size={20} color="#10b981" />
              <Text style={[typography.body, { color: colors.text, marginLeft: spacing.sm, flex: 1 }]}>
                {currentStep === 'sms' 
                  ? 'Auto-track bank transactions' 
                  : currentStep === 'notification'
                  ? 'Track UPI payments'
                  : 'Get payment reminders'}
              </Text>
            </View>
            <View style={styles.featureRow}>
              <MaterialCommunityIcons name="check-circle" size={20} color="#10b981" />
              <Text style={[typography.body, { color: colors.text, marginLeft: spacing.sm, flex: 1 }]}>
                {currentStep === 'sms' 
                  ? 'No manual entry needed' 
                  : currentStep === 'notification'
                  ? 'Works in background'
                  : 'Budget alerts'}
              </Text>
            </View>
            <View style={styles.featureRow}>
              <MaterialCommunityIcons name="check-circle" size={20} color="#10b981" />
              <Text style={[typography.body, { color: colors.text, marginLeft: spacing.sm, flex: 1 }]}>
                {currentStep === 'sms' 
                  ? 'Secure & private' 
                  : currentStep === 'notification'
                  ? 'Never miss a transaction'
                  : 'Important updates'}
              </Text>
            </View>
          </View>

          {/* Buttons */}
          <TouchableOpacity
            style={[styles.button, { backgroundColor: colors.accent, borderRadius: borderRadius.md, marginTop: spacing.xl }]}
            onPress={currentStep === 'sms' ? handleSmsPermission : currentStep === 'notification' ? handleNotificationPermission : handlePushPermission}
          >
            <Text style={[typography.bodyBold, { color: '#fff', fontSize: 16 }]}>
              Enable {currentStep === 'sms' ? 'SMS' : currentStep === 'notification' ? 'Notification' : 'Push'} Access
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.skipButton, { marginTop: spacing.md }]}
            onPress={handleSkip}
          >
            <Text style={[typography.body, { color: colors.subtext }]}>
              Skip for now
            </Text>
          </TouchableOpacity>

          {/* Progress indicator */}
          <View style={styles.progressContainer}>
            <View style={[styles.progressDot, { backgroundColor: smsGranted ? '#10b981' : colors.border }]} />
            <View style={[styles.progressDot, { backgroundColor: notificationGranted ? '#10b981' : colors.border }]} />
            <View style={[styles.progressDot, { backgroundColor: pushGranted ? '#10b981' : colors.border }]} />
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  container: {
    width: '100%',
    maxWidth: 400,
    borderRadius: 20,
    padding: 24,
    alignItems: 'center',
  },
  iconContainer: {
    width: 96,
    height: 96,
    borderRadius: 48,
    justifyContent: 'center',
    alignItems: 'center',
  },
  featureRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  button: {
    width: '100%',
    paddingVertical: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  skipButton: {
    paddingVertical: 12,
  },
  progressContainer: {
    flexDirection: 'row',
    marginTop: 20,
    gap: 8,
  },
  progressDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
});
