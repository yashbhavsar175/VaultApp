import React, { useState, useEffect, useCallback } from 'react';
import { PermissionsAndroid, Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import notifee from '@notifee/react-native';
import { checkNotificationPermission, requestNotificationPermission } from '../../utils/permissions';
import { isAccessibilityServiceEnabled, openAccessibilitySettings } from '../../lib/services/porter';
import Toast from 'react-native-toast-message';
import AppConfirmModal from './AppConfirmModal';

const PERMISSION_CHECK_KEY = 'permissions_granted_v3';

type PermissionStep = 'sms' | 'location' | 'camera' | 'microphone' | 'notification' | 'push' | 'accessibility' | 'done';

interface PermissionPromptProps {
  onAllPermissionsGranted?: () => void;
}

export default function PermissionPrompt({ onAllPermissionsGranted }: PermissionPromptProps) {
  const [currentStep, setCurrentStep] = useState<PermissionStep>('done');
  const [checking, setChecking] = useState(true);

  const checkNextPermission = useCallback(async () => {
    try {
      setChecking(true);
      
      const hasAskedBefore = await AsyncStorage.getItem(PERMISSION_CHECK_KEY);
      if (hasAskedBefore === 'true') {
        setCurrentStep('done');
        setChecking(false);
        return;
      }

      if (Platform.OS !== 'android') {
        setCurrentStep('done');
        setChecking(false);
        return;
      }

      // Check SMS
      const sms = await PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.RECEIVE_SMS);
      if (!sms) {
        setCurrentStep('sms');
        setChecking(false);
        return;
      }

      // Check Location
      const location = await PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION);
      if (!location) {
        setCurrentStep('location');
        setChecking(false);
        return;
      }

      // Check Microphone
      const mic = await PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.RECORD_AUDIO);
      if (!mic) {
        setCurrentStep('microphone');
        setChecking(false);
        return;
      }

      // Check Camera
      const camera = await PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.CAMERA);
      if (!camera) {
        setCurrentStep('camera');
        setChecking(false);
        return;
      }

      // Check Notification Listener
      const notification = await checkNotificationPermission();
      if (!notification) {
        setCurrentStep('notification');
        setChecking(false);
        return;
      }

      // Check Push Notifications
      const pushSettings = await notifee.getNotificationSettings();
      const push = pushSettings.authorizationStatus === 1;
      if (!push) {
        setCurrentStep('push');
        setChecking(false);
        return;
      }

      // Check Accessibility
      const accessibility = await isAccessibilityServiceEnabled();
      if (!accessibility) {
        setCurrentStep('accessibility');
        setChecking(false);
        return;
      }

      // All done!
      await AsyncStorage.setItem(PERMISSION_CHECK_KEY, 'true');
      setCurrentStep('done');
      onAllPermissionsGranted?.();
      setChecking(false);
    } catch (error) {
      console.error('Error checking permissions:', error);
      setChecking(false);
    }
  }, [onAllPermissionsGranted]);

  useEffect(() => {
    checkNextPermission();
  }, [checkNextPermission]);

  const handleGrant = async () => {
    if (Platform.OS !== 'android') return;

    try {
      if (currentStep === 'sms') {
        await PermissionsAndroid.requestMultiple([
          PermissionsAndroid.PERMISSIONS.RECEIVE_SMS,
          PermissionsAndroid.PERMISSIONS.READ_SMS,
        ]);
      } else if (currentStep === 'location') {
        await PermissionsAndroid.requestMultiple([
          PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
          PermissionsAndroid.PERMISSIONS.ACCESS_COARSE_LOCATION,
        ]);
      } else if (currentStep === 'microphone') {
        await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.RECORD_AUDIO);
      } else if (currentStep === 'camera') {
        await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.CAMERA);
      } else if (currentStep === 'notification') {
        requestNotificationPermission();
        Toast.show({
          type: 'info',
          text1: 'Enable Notification Access',
          text2: 'Find SpendSense and toggle it ON',
        });
      } else if (currentStep === 'push') {
        await notifee.requestPermission();
      } else if (currentStep === 'accessibility') {
        openAccessibilitySettings();
        Toast.show({
          type: 'info',
          text1: 'Enable SpendSense',
          text2: 'Find SpendSense in Accessibility settings and turn it ON',
        });
      }

      // After requesting, check the NEXT missing permission
      // Give a slight delay for settings screens to open/close
      setTimeout(() => {
        checkNextPermission();
      }, 500);
      
    } catch (err) {
      console.warn(err);
      checkNextPermission();
    }
  };

  const handleSkip = () => {
    // DO NOT set PERMISSION_CHECK_KEY so it asks again next time app opens
    // Move to the next step
    if (currentStep === 'sms') setCurrentStep('location');
    else if (currentStep === 'location') setCurrentStep('microphone');
    else if (currentStep === 'microphone') setCurrentStep('camera');
    else if (currentStep === 'camera') setCurrentStep('notification');
    else if (currentStep === 'notification') setCurrentStep('push');
    else if (currentStep === 'push') setCurrentStep('accessibility');
    else if (currentStep === 'accessibility') setCurrentStep('done');
  };

  if (checking || currentStep === 'done') return null;

  let title = '';
  let message = '';
  let confirmText = 'Enable';

  switch (currentStep) {
    case 'sms':
      title = 'Enable SMS Tracking';
      message = 'SpendSense needs SMS access to automatically track your bank transactions in the background.';
      break;
    case 'location':
      title = 'Enable Location';
      message = 'Allow location access to automatically pinpoint where your transactions happened.';
      break;
    case 'microphone':
      title = 'Enable Microphone';
      message = 'Allow microphone access so you can add transactions using the AI Voice Assistant.';
      break;
    case 'camera':
      title = 'Enable Camera';
      message = 'Allow camera access to easily attach photos of receipts or places to your transactions.';
      break;
    case 'notification':
      title = 'Notification Access';
      message = 'To track UPI payments from GPay, PhonePe, Slice, etc., we need Notification Access. Please find SpendSense and turn it ON.';
      confirmText = 'Open Settings';
      break;
    case 'push':
      title = 'Push Notifications';
      message = 'Allow push notifications to receive reminders, budget alerts, and important updates.';
      break;
    case 'accessibility':
      title = 'Porter Trip Tracking';
      message = 'To automatically track your Porter trips, we need Accessibility Service access. Please find SpendSense and turn it ON.';
      confirmText = 'Open Settings';
      break;
  }

  return (
    <AppConfirmModal
      visible={true}
      title={title}
      message={message}
      confirmText={confirmText}
      cancelText="Skip for now"
      onConfirm={handleGrant}
      onCancel={handleSkip}
    />
  );
}
