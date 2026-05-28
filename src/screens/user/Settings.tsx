import React, { useState, useEffect, useRef, useCallback } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Modal, Alert, AppState, AppStateStatus, Share, ScrollView, Switch, Platform, PermissionsAndroid, NativeModules } from 'react-native';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';
import Toast from 'react-native-toast-message';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '../../lib/core';
import { useTheme } from '../../context/ThemeContext';
import { ScreenWrapper, Card, AppButton, AppInput, AppHeader, AppConfirmModal } from '../../components';
import { useNavigation } from '@react-navigation/native';
import { runAllNotificationTests } from '../../utils/testUtils';
import {
  isAccessibilityServiceEnabled,
  isVolumeGuardEnabled,
  clearDeliveryDebugLogs,
  exportDeliveryDebugLogs,
  markDeliveryIssue,
  openAccessibilitySettings,
  refreshVolumeGuardCaps,
  setVolumeGuardEnabled,
  canDrawOverlays,
  openOverlaySettings,
  showIssueBubble,
  hideIssueBubble,
  getDeliveryDebugBlackBox,
} from '../../lib/services/porter';
import {
  getDeliveryDebugSummary,
  getLastDistanceSummary,
  getLastIncidentSummary,
  DeliveryDebugSummary,
  DeliveryDistanceSummary,
  DeliveryIncidentSummary,
} from '../../lib/services/deliveryDebugBlackBox';
import { CACHE_KEYS, clearCache, getCached, setCache } from '../../lib/services/cache';
import { sanitizeDebugBugReportsForPrivacy } from '../../lib/privacy/rawText';

interface CachedProfile {
  email?: string;
  name?: string;
  full_name?: string;
}

const DELIVERY_DEBUG_MODE_UNTIL_KEY = 'debug_delivery_mode_until';
const DELIVERY_DEBUG_MODE_DURATION_MS = 4 * 60 * 60 * 1000;

export default function Settings() {
  const navigation = useNavigation();
  const { colors, typography, spacing, borderRadius, themeMode, setThemeMode } = useTheme();
  const [userEmail, setUserEmail] = useState('');
  const [userName, setUserName] = useState('');
  const [showEditModal, setShowEditModal] = useState(false);
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [editedName, setEditedName] = useState('');
  const [saving, setSaving] = useState(false);
  const [porterServiceEnabled, setPorterServiceEnabled] = useState(false);
  const [overlayPermissionGranted, setOverlayPermissionGranted] = useState(false);
  const [volumeGuardEnabled, setVolumeGuardState] = useState(false);
  const [floatingBubbleEnabled, setFloatingBubbleEnabled] = useState(false);
  const [deliveryDebugModeUntil, setDeliveryDebugModeUntil] = useState<number | null>(null);
  const [deliveryDebugSummary, setDeliveryDebugSummary] = useState<DeliveryDebugSummary | null>(null);
  const [lastDeliveryIncident, setLastDeliveryIncident] = useState<DeliveryIncidentSummary | undefined>();
  const [lastDistanceResult, setLastDistanceResult] = useState<DeliveryDistanceSummary>({ status: 'none' });
  const [deliveryStatusLoading, setDeliveryStatusLoading] = useState(false);

  // Password change state
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [changingPassword, setChangingPassword] = useState(false);

  // Confirm dialog state
  const [confirmDialog, setConfirmDialog] = useState<{
    visible: boolean;
    title: string;
    message: string;
    confirmText?: string;
    isDestructive: boolean;
    onConfirm: () => void;
  } | null>(null);

  // Bug Reports State
  const [showBugReportsModal, setShowBugReportsModal] = useState(false);
  const [bugReports, setBugReports] = useState<any[]>([]);

  const appStateRef = useRef(AppState.currentState);

  const checkPorterService = useCallback(async () => {
    setDeliveryStatusLoading(true);
    try {
      const [
        enabled,
        guardEnabled,
        canDraw,
        bubbleStr,
        debugModeUntilStr,
        nativeSnapshot,
      ] = await Promise.all([
        isAccessibilityServiceEnabled(),
        isVolumeGuardEnabled(),
        canDrawOverlays(),
        AsyncStorage.getItem('debug_floating_bubble'),
        AsyncStorage.getItem(DELIVERY_DEBUG_MODE_UNTIL_KEY),
        getDeliveryDebugBlackBox(),
      ]);

      setPorterServiceEnabled(enabled);
      setVolumeGuardState(guardEnabled);
      setOverlayPermissionGranted(canDraw);

      const now = Date.now();
      const debugModeUntil = Number(debugModeUntilStr || 0);
      if (debugModeUntil > now) {
        setDeliveryDebugModeUntil(debugModeUntil);
      } else {
        setDeliveryDebugModeUntil(null);
        if (debugModeUntilStr) {
          await AsyncStorage.removeItem(DELIVERY_DEBUG_MODE_UNTIL_KEY);
          await AsyncStorage.setItem('debug_floating_bubble', 'false');
          await hideIssueBubble();
        }
      }

      const bubbleEnabled = bubbleStr === 'true' && (!debugModeUntil || debugModeUntil > now);
      if (bubbleEnabled && Platform.OS === 'android') {
        if (canDraw) {
          const shown = await showIssueBubble();
          setFloatingBubbleEnabled(shown);
          if (!shown) {
            await AsyncStorage.setItem('debug_floating_bubble', 'false');
          }
        } else {
          setFloatingBubbleEnabled(false);
          await AsyncStorage.setItem('debug_floating_bubble', 'false');
        }
      } else {
        setFloatingBubbleEnabled(false);
      }

      const [summary, lastIncident, lastDistance] = await Promise.all([
        getDeliveryDebugSummary(nativeSnapshot),
        getLastIncidentSummary(nativeSnapshot),
        getLastDistanceSummary(),
      ]);
      setDeliveryDebugSummary(summary);
      setLastDeliveryIncident(lastIncident);
      setLastDistanceResult(lastDistance);
    } catch (error) {
      console.log('Error checking Porter service', error);
    } finally {
      setDeliveryStatusLoading(false);
    }
  }, []);

  const requestBluetoothRoutePermission = async (): Promise<boolean> => {
    if (Platform.OS !== 'android' || Number(Platform.Version) < 31) return true;

    const permission = PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT;
    const granted = await PermissionsAndroid.request(permission, {
      title: 'Bluetooth Route Permission',
      message: 'SpendSense uses nearby device access only to detect Bluetooth audio route state for Volume Guard diagnostics.',
      buttonPositive: 'Allow',
      buttonNegative: 'Not now',
    });

    return granted === PermissionsAndroid.RESULTS.GRANTED;
  };

  const toggleVolumeGuard = async (enabled: boolean) => {
    try {
      if (enabled) {
        const hasBluetoothPermission = await requestBluetoothRoutePermission();
        if (!hasBluetoothPermission) {
          Toast.show({
            type: 'info',
            text1: 'Volume Guard On',
            text2: 'Media volume clamp will work, but Bluetooth route diagnostics may be limited',
          });
        }
      }
      await setVolumeGuardEnabled(enabled);
      setVolumeGuardState(enabled);
      Toast.show({
        type: enabled ? 'success' : 'info',
        text1: enabled ? 'Volume Guard On' : 'Volume Guard Off',
        text2: enabled
          ? 'Current media volume is locked as the delivery-app maximum'
          : 'Delivery apps can control volume normally again',
      });
      await checkPorterService();
    } catch (error) {
      Toast.show({
        type: 'error',
        text1: 'Volume Guard needs rebuild',
        text2: error instanceof Error ? error.message : String(error),
      });
    }
  };

  const toggleFloatingBubble = async (enabled: boolean) => {
    try {
      if (enabled) {
        const canDraw = await canDrawOverlays();
        if (!canDraw) {
          Alert.alert(
            'Permission Required',
            'SpendSense needs "Display over other apps" permission to show the floating issue marker during deliveries.',
            [
              { text: 'Cancel', style: 'cancel' },
              { text: 'Open Settings', onPress: () => openOverlaySettings() }
            ]
          );
          return;
        }
        await showIssueBubble();
      } else {
        await hideIssueBubble();
      }
      setFloatingBubbleEnabled(enabled);
      await AsyncStorage.setItem('debug_floating_bubble', String(enabled));
      await checkPorterService();
    } catch (error) {
      Toast.show({
        type: 'error',
        text1: 'Could not toggle bubble',
        text2: error instanceof Error ? error.message : String(error),
      });
    }
  };

  const lockCurrentVolumes = async () => {
    try {
      await refreshVolumeGuardCaps();
      Toast.show({
        type: 'success',
        text1: 'Volumes locked',
        text2: 'Current media volume saved as the delivery-app maximum',
      });
    } catch (error) {
      Toast.show({
        type: 'error',
        text1: 'Could not lock volume',
        text2: error instanceof Error ? error.message : String(error),
      });
    }
  };

  const handleMarkDeliveryIssue = async () => {
    try {
      await markDeliveryIssue();
      Toast.show({
        type: 'success',
        text1: 'Delivery issue marked',
        text2: 'Recent safe diagnostics are pinned for export',
      });
      await checkPorterService();
    } catch (error) {
      Toast.show({
        type: 'error',
        text1: 'Could not mark issue',
        text2: error instanceof Error ? error.message : String(error),
      });
    }
  };

  const handleExportDeliveryDebugLogs = async () => {
    try {
      const payload = await exportDeliveryDebugLogs();
      const fileName = `spendsense_debug_${new Date().toISOString().replace(/[:.]/g, '-')}.json`;

      // Use native file-based sharing on Android to bypass Binder size limit
      if (Platform.OS === 'android' && typeof NativeModules.PorterModule?.shareTextFile === 'function') {
        await NativeModules.PorterModule.shareTextFile(
          payload,
          fileName,
          'SpendSense Delivery Debug Logs'
        );
        return;
      }

      // Fallback: Share.share() (works on iOS, or if native method unavailable)
      let sharePayload = payload;
      if (Platform.OS === 'android' && payload.length > 100000) {
        sharePayload = payload.substring(0, 100000) + '\n\n...[TRUNCATED due to Android share limits. Rebuild the native app to enable full file exports.]';
      }

      await Share.share({
        title: 'SpendSense Delivery Debug Logs',
        message: sharePayload,
      });
    } catch (error) {
      Toast.show({
        type: 'error',
        text1: 'Export failed',
        text2: error instanceof Error ? error.message : String(error),
      });
    }
  };

  const handleClearDeliveryDebugLogs = () => {
    setConfirmDialog({
      visible: true,
      title: 'Clear Delivery Debug Logs',
      message: 'Clear local delivery diagnostics and pinned incidents? This does not affect transactions or app data.',
      confirmText: 'Clear Logs',
      isDestructive: true,
      onConfirm: async () => {
        setConfirmDialog(null);
        try {
          await clearDeliveryDebugLogs();
          await checkPorterService();
          Toast.show({
            type: 'success',
            text1: 'Delivery logs cleared',
            text2: 'Local debug black box was reset',
          });
        } catch (error) {
          Toast.show({
            type: 'error',
            text1: 'Clear failed',
            text2: error instanceof Error ? error.message : String(error),
          });
        }
      },
    });
  };

  const startDeliveryDebugMode = async () => {
    try {
      const canDraw = await canDrawOverlays();
      setOverlayPermissionGranted(canDraw);
      if (!canDraw) {
        Alert.alert(
          'Overlay Permission Missing',
          'Turn on "Display over other apps" so the floating issue marker can stay available during delivery work.',
          [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Open Overlay Settings', onPress: () => openOverlaySettings() },
          ]
        );
        return;
      }

      const accessibilityEnabled = await isAccessibilityServiceEnabled();
      if (!accessibilityEnabled) {
        Alert.alert(
          'Accessibility Service Off',
          'Distance status needs the SpendSense Accessibility service. Debug mode will still start for manual issue marking.',
          [
            { text: 'Not Now', style: 'cancel' },
            { text: 'Open Accessibility Settings', onPress: () => openAccessibilitySettings() },
          ]
        );
      }

      const until = Date.now() + DELIVERY_DEBUG_MODE_DURATION_MS;
      await AsyncStorage.multiSet([
        ['debug_floating_bubble', 'true'],
        [DELIVERY_DEBUG_MODE_UNTIL_KEY, String(until)],
      ]);
      const shown = await showIssueBubble();
      setFloatingBubbleEnabled(shown);
      setDeliveryDebugModeUntil(until);
      Toast.show({
        type: shown ? 'success' : 'info',
        text1: shown ? 'Delivery Debug Mode On' : 'Debug mode saved',
        text2: shown
          ? 'Floating issue marker is ready for the next 4 hours'
          : 'Open overlay permission if the marker does not appear',
      });
      await checkPorterService();
    } catch (error) {
      Toast.show({
        type: 'error',
        text1: 'Could not start debug mode',
        text2: error instanceof Error ? error.message : String(error),
      });
    }
  };

  const endDeliveryDebugMode = async () => {
    try {
      await hideIssueBubble();
      await AsyncStorage.multiSet([
        ['debug_floating_bubble', 'false'],
        [DELIVERY_DEBUG_MODE_UNTIL_KEY, '0'],
      ]);
      setFloatingBubbleEnabled(false);
      setDeliveryDebugModeUntil(null);
      Toast.show({
        type: 'info',
        text1: 'Delivery Debug Mode Off',
        text2: 'Logs and pinned incidents were kept',
      });
      await checkPorterService();
    } catch (error) {
      Toast.show({
        type: 'error',
        text1: 'Could not end debug mode',
        text2: error instanceof Error ? error.message : String(error),
      });
    }
  };

  useEffect(() => {
    console.log('🔧 [Settings] Component mounted');
    loadUserInfo();
    checkPorterService();

    // Instantly re-check Porter service status when user comes back from Accessibility Settings
    const subscription = AppState.addEventListener('change', (nextState: AppStateStatus) => {
      if (appStateRef.current.match(/inactive|background/) && nextState === 'active') {
        checkPorterService();
      }
      appStateRef.current = nextState;
    });

    return () => subscription.remove();
  }, [checkPorterService]);

  const getInitials = (name: string) => {
    if (!name) return '?';
    const parts = name.trim().split(' ');
    if (parts.length === 1) return parts[0][0].toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  };

  const loadUserInfo = async () => {
    try {
      // Show cached profile instantly
      const cachedProfile = await getCached<CachedProfile>(CACHE_KEYS.USER_PROFILE);
      if (cachedProfile) {
        const { email, name, full_name } = cachedProfile.data;
        if (email) setUserEmail(email);
        if (full_name || name) setUserName(full_name || name || '');
        if (!cachedProfile.isStale) return;
      }

      // Then fetch fresh from cloud
      const { data: { user } } = await supabase.auth.getUser();
      if (user?.email) {
        setUserEmail(user.email);

        const { data: profile } = await supabase
          .from('profiles')
          .select('full_name')
          .eq('id', user.id)
          .single();

        if (profile?.full_name) {
          setUserName(profile.full_name);
        }

        // Update cache
        await setCache<CachedProfile>(CACHE_KEYS.USER_PROFILE, {
          email: user.email,
          name: profile?.full_name || '',
          full_name: profile?.full_name || '',
        });
      }
    } catch (error) {
      console.error('Error loading user info:', error);
    }
  };

  const handleLogout = async () => {
    setConfirmDialog({
      visible: true,
      title: 'Sign Out',
      message: 'Are you sure you want to sign out?',
      confirmText: 'Sign Out',
      isDestructive: true,
      onConfirm: async () => {
        // Dismiss dialog instantly for a faster feel
        setConfirmDialog(null);
        try {
          await clearCache();
          await supabase.auth.signOut();
          Toast.show({
            type: 'success',
            text1: 'Signed Out',
            text2: 'You have been logged out successfully',
          });
        } catch {
          Toast.show({
            type: 'error',
            text1: 'Error',
            text2: 'Failed to sign out',
          });
        }
      }
    });
  };

  const handleEditName = () => {
    setEditedName(userName);
    setShowEditModal(true);
  };

  const handleSaveName = async () => {
    if (!editedName.trim()) {
      Toast.show({
        type: 'error',
        text1: 'Error',
        text2: 'Name cannot be empty',
      });
      return;
    }

    setSaving(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('No user found');

      const { error } = await supabase
        .from('profiles')
        .upsert({
          id: user.id,
          full_name: editedName.trim(),
          updated_at: new Date().toISOString(),
        });

      if (error) throw error;

      setUserName(editedName.trim());
      setShowEditModal(false);
      // Update profile cache
      await setCache<CachedProfile>(CACHE_KEYS.USER_PROFILE, {
        email: userEmail,
        name: editedName.trim(),
        full_name: editedName.trim(),
      });
      Toast.show({
        type: 'success',
        text1: 'Success',
        text2: 'Name updated successfully',
      });
    } catch (error) {
      console.error('Error updating name:', error);
      Toast.show({
        type: 'error',
        text1: 'Error',
        text2: 'Failed to update name',
      });
    } finally {
      setSaving(false);
    }
  };

  const handleChangePassword = () => {
    setCurrentPassword('');
    setNewPassword('');
    setConfirmPassword('');
    setShowPasswordModal(true);
  };

  const handleSavePassword = async () => {
    if (!newPassword || newPassword.length < 6) {
      Toast.show({
        type: 'error',
        text1: 'Error',
        text2: 'New password must be at least 6 characters',
      });
      return;
    }

    if (newPassword !== confirmPassword) {
      Toast.show({
        type: 'error',
        text1: 'Error',
        text2: 'Passwords do not match',
      });
      return;
    }

    setChangingPassword(true);
    try {
      const { error } = await supabase.auth.updateUser({
        password: newPassword,
      });

      if (error) throw error;

      setShowPasswordModal(false);
      Toast.show({
        type: 'success',
        text1: 'Success',
        text2: 'Password updated successfully',
      });
    } catch (error) {
      console.error('Error updating password:', error);
      Toast.show({
        type: 'error',
        text1: 'Error',
        text2: 'Failed to update password',
      });
    } finally {
      setChangingPassword(false);
    }
  };

  const handleDeleteAccount = () => {
    Alert.alert(
      'Delete Account?',
      'This will permanently delete your account and all your data. This cannot be undone.',
      [
        {
          text: 'Cancel',
          style: 'cancel',
        },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              const { data: { user } } = await supabase.auth.getUser();
              if (!user) throw new Error('No user found');

              const { data: placePhotos, error: listPhotosError } = await supabase.storage
                .from('place-photos')
                .list(user.id);

              if (!listPhotosError && placePhotos?.length) {
                const { error: removePhotosError } = await supabase.storage
                  .from('place-photos')
                  .remove(placePhotos.map(photo => `${user.id}/${photo.name}`));

                if (removePhotosError) throw removePhotosError;
              }

              const deleteSteps = [
                { label: 'transactions', request: () => supabase.from('transactions').delete().eq('user_id', user.id) },
                { label: 'credit card transactions', request: () => supabase.from('cc_transactions').delete().eq('user_id', user.id) },
                { label: 'credit cards', request: () => supabase.from('credit_cards').delete().eq('user_id', user.id) },
                { label: 'EMI payments', request: () => supabase.from('emi_payments').delete().eq('user_id', user.id) },
                { label: 'loans', request: () => supabase.from('loans').delete().eq('user_id', user.id) },
                { label: 'people ledger', request: () => supabase.from('people_ledger').delete().eq('user_id', user.id) },
                { label: 'places', request: () => supabase.from('places').delete().eq('user_id', user.id) },
                { label: 'vault items', request: () => supabase.from('vault_items').delete().eq('user_id', user.id) },
                { label: 'bank accounts', request: () => supabase.from('bank_accounts').delete().eq('user_id', user.id) },
                { label: 'profile', request: () => supabase.from('profiles').delete().eq('id', user.id) },
              ];

              for (const step of deleteSteps) {
                const { error } = await step.request();
                if (error) {
                  throw new Error(`Failed to delete ${step.label}: ${error.message}`);
                }
              }

              // Sign out
              await clearCache();
              await supabase.auth.signOut();

              Toast.show({
                type: 'info',
                text1: 'Account Deletion Requested',
                text2: 'Contact support to complete.',
              });

              // Auth state change will redirect to login automatically
            } catch (error) {
              console.error('Error deleting account:', error);
              Toast.show({
                type: 'error',
                text1: 'Error',
                text2: 'Failed to delete account',
              });
            }
          },
        },
      ]
    );
  };

  const loadBugReports = async () => {
    try {
      const logsStr = await AsyncStorage.getItem('debug_bug_reports');
      if (logsStr) {
        const parsedReports = JSON.parse(logsStr);
        const safeReports = sanitizeDebugBugReportsForPrivacy(Array.isArray(parsedReports) ? parsedReports : []);
        setBugReports(safeReports);
        if (JSON.stringify(parsedReports) !== JSON.stringify(safeReports)) {
          await AsyncStorage.setItem('debug_bug_reports', JSON.stringify(safeReports));
        }
      } else {
        setBugReports([]);
      }
    } catch (e) {
      console.error(e);
    }
  };

  const openBugReportsModal = async () => {
    await loadBugReports();
    setShowBugReportsModal(true);
  };

  const deleteBugReport = (id: string) => {
    setConfirmDialog({
      visible: true,
      title: 'Delete Bug Report',
      message: 'Are you sure you want to delete this specific bug report?',
      confirmText: 'Delete',
      isDestructive: true,
      onConfirm: async () => {
        setConfirmDialog(null);
        try {
          const updatedReports = bugReports.filter(r => r.id !== id);
          setBugReports(updatedReports);
          await AsyncStorage.setItem('debug_bug_reports', JSON.stringify(updatedReports));
          Toast.show({ type: 'success', text1: 'Deleted', text2: 'Bug report removed' });
        } catch (error) {
          console.error('Error deleting report:', error);
          Toast.show({ type: 'error', text1: 'Error', text2: 'Failed to delete report' });
        }
      }
    });
  };

  const handleExportBugReports = async () => {
    try {
      const logsStr = await AsyncStorage.getItem('debug_bug_reports');
      if (!logsStr || logsStr === '[]') {
        Toast.show({ type: 'info', text1: 'Empty', text2: 'No bug reports found' });
        return;
      }

      const parsedReports = JSON.parse(logsStr);
      const safeReports = sanitizeDebugBugReportsForPrivacy(Array.isArray(parsedReports) ? parsedReports : []);
      const sharePayloadFull = JSON.stringify(safeReports, null, 2);
      if (sharePayloadFull !== logsStr) {
        await AsyncStorage.setItem('debug_bug_reports', JSON.stringify(safeReports));
      }

      const fileName = `spendsense_bugs_${new Date().toISOString().replace(/[:.]/g, '-')}.json`;

      // Use native file-based sharing on Android to bypass Binder size limit
      if (Platform.OS === 'android' && typeof NativeModules.PorterModule?.shareTextFile === 'function') {
        await NativeModules.PorterModule.shareTextFile(
          sharePayloadFull,
          fileName,
          'VaultApp Bug Reports'
        );
        return;
      }

      // Fallback: Share.share() (works on iOS, or if native method unavailable)
      let sharePayload = sharePayloadFull;
      if (Platform.OS === 'android' && sharePayloadFull.length > 100000) {
        sharePayload = sharePayloadFull.substring(0, 100000) + '\n\n...[TRUNCATED due to Android share limits. Rebuild the native app to enable full file exports.]';
      }
      await Share.share({ title: 'VaultApp Bug Reports', message: sharePayload });
    } catch (error) {
      console.error('Error sharing bug reports:', error);
      Toast.show({ type: 'error', text1: 'Error', text2: 'Could not export bug reports' });
    }
  };

  const handleClearBugReports = () => {
    setConfirmDialog({
      visible: true,
      title: 'Clear Bug Reports',
      message: 'Are you sure you want to clear all saved bug reports?',
      confirmText: 'Clear All',
      isDestructive: true,
      onConfirm: async () => {
        setConfirmDialog(null);
        try {
          await AsyncStorage.removeItem('debug_bug_reports');
          setBugReports([]);
          Toast.show({ type: 'success', text1: 'Cleared', text2: 'All bug reports have been deleted' });
        } catch (error) {
          console.error('Error clearing bug reports:', error);
          Toast.show({ type: 'error', text1: 'Error', text2: 'Could not clear bug reports' });
        }
      }
    });
  };

  const formatStatusTime = (time?: number) => {
    if (!time) return 'None';
    return new Date(time).toLocaleString([], {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const formatDebugModeUntil = () => {
    if (!deliveryDebugModeUntil || deliveryDebugModeUntil <= Date.now()) return 'Inactive';
    return `Active until ${formatStatusTime(deliveryDebugModeUntil)}`;
  };

  const getDistanceStatusText = () => {
    if (lastDistanceResult.status === 'none') return 'None';
    if (lastDistanceResult.status === 'success') return 'Success';
    return 'Unavailable';
  };

  const getDistanceDetailText = () => {
    if (lastDistanceResult.status === 'none') return 'No distance result recorded yet';
    const pieces = [
      lastDistanceResult.reason ? `Reason: ${lastDistanceResult.reason}` : undefined,
      lastDistanceResult.toPickup ? `Pickup: ${lastDistanceResult.toPickup}` : undefined,
      lastDistanceResult.tripDistance ? `Trip: ${lastDistanceResult.tripDistance}` : undefined,
      formatStatusTime(lastDistanceResult.time),
    ].filter(Boolean);
    return pieces.join(' | ');
  };

  const getStatusColor = (tone: 'ok' | 'warn' | 'bad' | 'neutral') => {
    switch (tone) {
      case 'ok':
        return '#10b981';
      case 'warn':
        return '#f59e0b';
      case 'bad':
        return '#ef4444';
      default:
        return colors.subtext;
    }
  };

  const renderStatusPill = (label: string, tone: 'ok' | 'warn' | 'bad' | 'neutral') => {
    const color = getStatusColor(tone);
    return (
      <View style={[styles.statusPill, { borderColor: color, backgroundColor: `${color}18` }]}>
        <View style={[styles.statusDot, { backgroundColor: color }]} />
        <Text style={[typography.caption, { color, fontWeight: '700' }]}>{label}</Text>
      </View>
    );
  };

  const renderDeliveryStatusRow = (
    icon: string,
    label: string,
    value: string,
    tone: 'ok' | 'warn' | 'bad' | 'neutral',
    detail?: string
  ) => (
    <View style={styles.deliveryStatusRow}>
      <MaterialCommunityIcons name={icon} size={22} color={getStatusColor(tone)} style={{ marginTop: 2 }} />
      <View style={styles.deliveryStatusText}>
        <Text style={[typography.bodyBold, { color: colors.text }]}>{label}</Text>
        {detail ? (
          <Text style={[typography.caption, { color: colors.subtext, marginTop: 2 }]} numberOfLines={2}>
            {detail}
          </Text>
        ) : null}
      </View>
      {renderStatusPill(value, tone)}
    </View>
  );

  const renderDeliveryActionButton = (
    label: string,
    icon: string,
    onPress: () => void,
    tone: 'primary' | 'neutral' | 'danger' = 'neutral'
  ) => {
    const color = tone === 'danger' ? '#ef4444' : tone === 'primary' ? colors.accent : colors.text;
    const borderColor = tone === 'neutral' ? colors.border : color;
    return (
      <TouchableOpacity
        onPress={onPress}
        style={[
          styles.deliveryActionButton,
          {
            borderColor,
            backgroundColor: tone === 'neutral' ? colors.card : `${color}14`,
          },
        ]}>
        <MaterialCommunityIcons name={icon} size={18} color={color} />
        <Text style={[typography.caption, styles.deliveryActionText, { color }]}>
          {label}
        </Text>
      </TouchableOpacity>
    );
  };

  const debugLogsText = deliveryDebugSummary
    ? `${deliveryDebugSummary.normalSessionCount} sessions / ${deliveryDebugSummary.incidentCount} pinned ${deliveryDebugSummary.incidentCount === 1 ? 'incident' : 'incidents'}`
    : 'Unknown';
  const debugLogsDetail = deliveryDebugSummary
    ? `${deliveryDebugSummary.rollingEventCount + deliveryDebugSummary.nativeEventCount} recent events, ${deliveryDebugSummary.realIncidentCount} issue-worthy ${deliveryDebugSummary.realIncidentCount === 1 ? 'incident' : 'incidents'}`
    : 'Summary will load when Settings refreshes';
  const lastIncidentText = lastDeliveryIncident ? formatStatusTime(lastDeliveryIncident.time) : 'None';
  const lastIncidentDetail = lastDeliveryIncident
    ? `${lastDeliveryIncident.reason}${lastDeliveryIncident.source ? ` (${lastDeliveryIncident.source})` : ''}`
    : 'No pinned delivery issue yet';
  const lastDeliveryApp = deliveryDebugSummary?.lastDeliveryApp || lastDistanceResult.app || 'None';

  return (
    <ScreenWrapper scrollable>
      <AppHeader title="Settings" />

      <View style={{ padding: spacing.lg }}>
        {/* User Profile Card */}
        <Card style={{ alignItems: 'center', position: 'relative', padding: spacing.xl }}>
          <TouchableOpacity
            style={styles.editIconButton}
            onPress={handleEditName}>
            <MaterialCommunityIcons name="pencil" size={20} color={colors.accent} />
          </TouchableOpacity>

          <View style={[styles.avatarCircle, { backgroundColor: colors.accent }]}>
            <Text style={[typography.h1, { color: '#fff', fontSize: 32 }]}>
              {getInitials(userName)}
            </Text>
          </View>

          <Text style={[typography.h2, { color: colors.text, marginTop: spacing.md, fontWeight: '700' }]}>
            {userName || 'User'}
          </Text>
          <Text style={[typography.caption, { color: colors.subtext, marginTop: spacing.xs }]}>
            {userEmail}
          </Text>
        </Card>

        {/* Appearance Section */}
        <View style={{ marginTop: spacing.xl }}>
          <Text style={[typography.caption, { color: colors.subtext, marginBottom: spacing.md, textTransform: 'uppercase', fontWeight: '600', letterSpacing: 1 }]}>
            Appearance
          </Text>

          <Card style={{ padding: spacing.sm }}>
            <View style={styles.segmentedControl}>
              <TouchableOpacity
                style={[
                  styles.segmentButton,
                  { borderRadius: borderRadius.md },
                  themeMode === 'light' && { backgroundColor: colors.accent }
                ]}
                onPress={() => setThemeMode('light')}>
                <Text style={[styles.segmentIcon, themeMode === 'light' && { fontSize: 16 }]}>☀️</Text>
                <Text style={[
                  typography.caption,
                  { color: themeMode === 'light' ? '#fff' : colors.text, fontWeight: '600' }
                ]}>
                  Light
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[
                  styles.segmentButton,
                  { borderRadius: borderRadius.md },
                  themeMode === 'dark' && { backgroundColor: colors.accent }
                ]}
                onPress={() => setThemeMode('dark')}>
                <Text style={[styles.segmentIcon, themeMode === 'dark' && { fontSize: 16 }]}>🌙</Text>
                <Text style={[
                  typography.caption,
                  { color: themeMode === 'dark' ? '#fff' : colors.text, fontWeight: '600' }
                ]}>
                  Dark
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[
                  styles.segmentButton,
                  { borderRadius: borderRadius.md },
                  themeMode === 'system' && { backgroundColor: colors.accent }
                ]}
                onPress={() => setThemeMode('system')}>
                <Text style={[styles.segmentIcon, themeMode === 'system' && { fontSize: 16 }]}>⚙️</Text>
                <Text style={[
                  typography.caption,
                  { color: themeMode === 'system' ? '#fff' : colors.text, fontWeight: '600' }
                ]}>
                  System
                </Text>
              </TouchableOpacity>
            </View>
          </Card>
        </View>

        {/* Financial Setup Section */}
        <View style={{ marginTop: spacing.xl }}>
          <Text style={[typography.caption, { color: colors.subtext, marginBottom: spacing.md, textTransform: 'uppercase', fontWeight: '600', letterSpacing: 1 }]}>
            Financial Setup
          </Text>

          <Card>
            <TouchableOpacity 
              style={[styles.accountRow, { paddingBottom: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.border }]} 
              onPress={() => (navigation as any).navigate('BankConfigScreen')}
            >
              <MaterialCommunityIcons name="bank" size={22} color="#10b981" />
              <View style={{ flex: 1, marginLeft: spacing.md }}>
                <Text style={[typography.bodyBold, { color: colors.text }]}>
                  Bank & Card Setup
                </Text>
                <Text style={[typography.caption, { color: colors.subtext, marginTop: 2 }]}>
                  Manage your accounts for auto-detection
                </Text>
              </View>
              <MaterialCommunityIcons name="chevron-right" size={22} color={colors.subtext} />
            </TouchableOpacity>

            <TouchableOpacity 
              style={[styles.accountRow, { paddingTop: spacing.sm }]} 
              onPress={() => (navigation as any).navigate('SMSTestScreen')}
            >
              <MaterialCommunityIcons name="message-text" size={22} color="#06b6d4" />
              <View style={{ flex: 1, marginLeft: spacing.md }}>
                <Text style={[typography.bodyBold, { color: colors.text }]}>
                  SMS Parser Test
                </Text>
                <Text style={[typography.caption, { color: colors.subtext, marginTop: 2 }]}>
                  Test transaction detection from SMS
                </Text>
              </View>
              <MaterialCommunityIcons name="chevron-right" size={22} color={colors.subtext} />
            </TouchableOpacity>
            
            <View style={{ height: 1, backgroundColor: colors.border, marginVertical: 4 }} />

            <TouchableOpacity
              style={[styles.accountRow, { paddingBottom: spacing.sm }]}
              onPress={() => (navigation as any).navigate('ReviewQueue')}
            >
              <MaterialCommunityIcons name="inbox-multiple-outline" size={22} color="#f59e0b" />
              <View style={{ flex: 1, marginLeft: spacing.md }}>
                <Text style={[typography.bodyBold, { color: colors.text }]}>
                  Auto Transaction Review
                </Text>
                <Text style={[typography.caption, { color: colors.subtext, marginTop: 2 }]}>
                  Manage transactions awaiting your approval
                </Text>
              </View>
              <MaterialCommunityIcons name="chevron-right" size={22} color={colors.subtext} />
            </TouchableOpacity>
          </Card>
        </View>

        {/* Account Section */}
        <View style={{ marginTop: spacing.xl }}>
          <Text style={[typography.caption, { color: colors.subtext, marginBottom: spacing.md, textTransform: 'uppercase', fontWeight: '600', letterSpacing: 1 }]}>
            Account
          </Text>

          <Card>
            <TouchableOpacity 
              style={[styles.accountRow, { paddingBottom: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.border }]} 
              onPress={() => (navigation as any).navigate('Places')}
            >
              <MaterialCommunityIcons name="map-marker-star" size={22} color={colors.accent} />
              <Text style={[typography.body, { color: colors.text, flex: 1, marginLeft: spacing.md }]}>
                Saved Places
              </Text>
              <MaterialCommunityIcons name="chevron-right" size={22} color={colors.subtext} />
            </TouchableOpacity>

            <TouchableOpacity style={[styles.accountRow, { paddingTop: spacing.sm }]} onPress={handleChangePassword}>
              <MaterialCommunityIcons name="lock-outline" size={22} color={colors.accent} />
              <Text style={[typography.body, { color: colors.text, flex: 1, marginLeft: spacing.md }]}>
                Change Password
              </Text>
              <MaterialCommunityIcons name="chevron-right" size={22} color={colors.subtext} />
            </TouchableOpacity>
          </Card>
        </View>

        {/* Developer Section */}
        <View style={{ marginTop: spacing.xl }}>
          <Text style={[typography.caption, { color: colors.subtext, marginBottom: spacing.md, textTransform: 'uppercase', fontWeight: '600', letterSpacing: 1 }]}>
            Developer
          </Text>

          <Card>
            <TouchableOpacity
              style={styles.accountRow}
              onPress={async () => {
                try {
                  await runAllNotificationTests();
                  Toast.show({
                    type: 'success',
                    text1: 'Tests Running',
                    text2: 'Check notifications and console logs',
                  });
                } catch (error) {
                  Toast.show({
                    type: 'error',
                    text1: 'Test Failed',
                    text2: String(error),
                  });
                }
              }}>
              <MaterialCommunityIcons name="test-tube" size={22} color={colors.accent} />
              <Text style={[typography.body, { color: colors.text, flex: 1, marginLeft: spacing.md }]}>
                Test Notifications
              </Text>
              <MaterialCommunityIcons name="chevron-right" size={22} color={colors.subtext} />
            </TouchableOpacity>

            <View style={{ height: 1, backgroundColor: colors.border, marginVertical: 4 }} />

            <TouchableOpacity
              style={styles.accountRow}
              onPress={async () => {
                try {
                  const { data: { user } } = await supabase.auth.getUser();
                  if (!user) throw new Error('Not logged in');

                  Toast.show({ type: 'info', text1: 'Seeding...', text2: 'Adding 120 dummy transactions' });

                  const categories = ['Food', 'Transport', 'Shopping', 'Salary', 'Freelance', 'Rent', 'Grocery', 'Fuel', 'Entertainment', 'Bills'];
                  const types = ['income', 'expense'];
                  const notes = [
                    'Swiggy order', 'Uber ride', 'Amazon purchase', 'Monthly salary', 'Freelance project',
                    'House rent', 'BigBasket', 'Petrol', 'Netflix', 'Electricity bill',
                    'Zomato', 'Ola auto', 'Flipkart', 'Bonus', 'Client payment',
                    'Water bill', 'Zepto', 'CNG fill', 'Hotstar', 'WiFi bill',
                  ];

                  const entries = [];
                  for (let i = 0; i < 120; i++) {
                    const type = types[Math.floor(Math.random() * types.length)];
                    const daysAgo = Math.floor(Math.random() * 60);
                    const date = new Date();
                    date.setDate(date.getDate() - daysAgo);
                    entries.push({
                      user_id: user.id,
                      amount: Math.floor(Math.random() * 5000) + 50,
                      type,
                      category: categories[Math.floor(Math.random() * categories.length)],
                      note: notes[Math.floor(Math.random() * notes.length)],
                      created_at: date.toISOString(),
                    });
                  }

                  // Single bulk insert — no intermediate partial loads!
                  const { error } = await supabase.from('transactions').insert(entries);
                  if (error) throw error;

                  Toast.show({ type: 'success', text1: 'Done!', text2: '120 dummy entries added' });
                } catch (error) {
                  Toast.show({ type: 'error', text1: 'Error', text2: String(error) });
                }
              }}>
              <MaterialCommunityIcons name="database-plus" size={22} color="#f59e0b" />
              <Text style={[typography.body, { color: colors.text, flex: 1, marginLeft: spacing.md }]}>
                Seed 120 Dummy Entries
              </Text>
              <MaterialCommunityIcons name="chevron-right" size={22} color={colors.subtext} />
            </TouchableOpacity>

            {__DEV__ && (
              <>
                <TouchableOpacity
                  style={styles.accountRow}
                  onPress={async () => {
                    try {
                      const { processSignal } = require('../../lib/services/transactionIntelligence');
                      const { enqueueReviewCandidate } = require('../../lib/services/autoTransactionReviewQueue');
                      const sample = processSignal({
                        rawText: "Rs.750 spent on Swiggy using HDFC Bank credit card ending 9999.",
                        senderOrPackage: "HDFCBK",
                        sourceType: "sms",
                        timestamp: Date.now()
                      });
                      sample.decision = 'review_required'; // force for testing
                      await enqueueReviewCandidate(sample);
                      Toast.show({ type: 'success', text1: 'Seeded 1 review candidate' });
                    } catch (e) {
                      Toast.show({ type: 'error', text1: 'Seed failed', text2: String(e) });
                    }
                  }}>
                  <MaterialCommunityIcons name="seed-outline" size={22} color="#f59e0b" />
                  <Text style={[typography.body, { color: colors.text, flex: 1, marginLeft: spacing.md }]}>
                    Seed Review Queue
                  </Text>
                  <MaterialCommunityIcons name="chevron-right" size={22} color={colors.subtext} />
                </TouchableOpacity>

                <View style={{ height: 1, backgroundColor: colors.border, marginVertical: 4 }} />
              </>
            )}

            <TouchableOpacity
              style={styles.accountRow}
              onPress={openBugReportsModal}>
              <MaterialCommunityIcons name="bug-check-outline" size={22} color="#f59e0b" />
              <Text style={[typography.body, { color: colors.text, flex: 1, marginLeft: spacing.md }]}>
                Manage Bug Reports
              </Text>
              <MaterialCommunityIcons name="chevron-right" size={22} color={colors.subtext} />
            </TouchableOpacity>
          </Card>
        </View>

        {/* Delivery Tools & Debug */}
        <View style={{ marginTop: spacing.xl }}>
          <Text style={[typography.caption, { color: colors.subtext, marginBottom: spacing.md, textTransform: 'uppercase', fontWeight: '600', letterSpacing: 1 }]}>
            Delivery Tools & Debug
          </Text>

          <Card>
            <View style={styles.deliveryPanelHeader}>
              <View style={{ flex: 1, marginRight: spacing.sm }}>
                <Text style={[typography.h3, { color: colors.text }]}>Delivery Debug Mode</Text>
                <Text style={[typography.caption, { color: colors.subtext, marginTop: 4 }]}>
                  Quick readiness check before Porter, Swiggy or Zomato work
                </Text>
              </View>
              {renderStatusPill(
                deliveryDebugModeUntil && deliveryDebugModeUntil > Date.now() ? 'Active' : 'Inactive',
                deliveryDebugModeUntil && deliveryDebugModeUntil > Date.now() ? 'ok' : 'neutral'
              )}
            </View>

            <View style={[styles.deliveryModeBanner, { backgroundColor: colors.background, borderColor: colors.border }]}>
              <MaterialCommunityIcons
                name={deliveryDebugModeUntil && deliveryDebugModeUntil > Date.now() ? 'timer-check-outline' : 'timer-outline'}
                size={20}
                color={deliveryDebugModeUntil && deliveryDebugModeUntil > Date.now() ? '#10b981' : colors.subtext}
              />
              <Text style={[typography.caption, { color: colors.text, flex: 1, marginLeft: spacing.sm }]}>
                {formatDebugModeUntil()}
              </Text>
              {deliveryStatusLoading ? (
                <Text style={[typography.caption, { color: colors.subtext }]}>Refreshing</Text>
              ) : null}
            </View>

            <View style={{ height: 1, backgroundColor: colors.border, marginVertical: spacing.md }} />

            {renderDeliveryStatusRow(
              'human-handsup',
              'Accessibility Service',
              porterServiceEnabled ? 'On' : 'Off',
              porterServiceEnabled ? 'ok' : 'bad',
              porterServiceEnabled ? 'Porter distance events can reach SpendSense' : 'Open Accessibility Settings before starting work'
            )}
            {renderDeliveryStatusRow(
              'picture-in-picture-bottom-right',
              'Overlay Permission',
              overlayPermissionGranted ? 'Granted' : 'Missing',
              overlayPermissionGranted ? 'ok' : 'warn',
              overlayPermissionGranted ? 'Floating issue marker can appear over delivery apps' : 'Required for the floating issue marker'
            )}
            {renderDeliveryStatusRow(
              'chat-alert-outline',
              'Floating Issue Marker',
              floatingBubbleEnabled ? 'On' : 'Off',
              floatingBubbleEnabled ? 'ok' : 'neutral',
              floatingBubbleEnabled ? 'Tap the bubble to pin a delivery issue' : 'Start debug mode or use the switch below'
            )}
            {renderDeliveryStatusRow(
              'volume-vibrate',
              'Delivery Volume Guard',
              volumeGuardEnabled ? 'On' : 'Off',
              volumeGuardEnabled ? 'ok' : 'neutral',
              volumeGuardEnabled ? 'Delivery apps are limited to the locked media volume' : 'Enable if delivery apps raise media volume'
            )}
            {renderDeliveryStatusRow(
              'black-mesa',
              'Delivery Debug Logs',
              debugLogsText,
              deliveryDebugSummary ? 'ok' : 'neutral',
              debugLogsDetail
            )}
            {renderDeliveryStatusRow(
              'alert-circle-check-outline',
              'Last Incident',
              lastIncidentText,
              lastDeliveryIncident ? 'warn' : 'neutral',
              lastIncidentDetail
            )}
            {renderDeliveryStatusRow(
              lastDistanceResult.status === 'success' ? 'map-check-outline' : 'map-marker-question-outline',
              'Last Distance Result',
              getDistanceStatusText(),
              lastDistanceResult.status === 'success' ? 'ok' : lastDistanceResult.status === 'unavailable' ? 'warn' : 'neutral',
              getDistanceDetailText()
            )}
            {renderDeliveryStatusRow(
              'cellphone-marker',
              'Last Delivery App',
              lastDeliveryApp,
              lastDeliveryApp === 'None' ? 'neutral' : 'ok',
              lastDeliveryApp === 'None' ? 'No recent supported delivery app event' : 'From privacy-safe package summary'
            )}

            <View style={{ height: 1, backgroundColor: colors.border, marginVertical: spacing.md }} />

            <View style={styles.deliveryActionGrid}>
              {renderDeliveryActionButton('Start Debug Mode', 'play-circle-outline', startDeliveryDebugMode, 'primary')}
              {renderDeliveryActionButton('End Debug Mode', 'stop-circle-outline', endDeliveryDebugMode)}
              {renderDeliveryActionButton('Mark Issue', 'alert-plus-outline', handleMarkDeliveryIssue, 'primary')}
              {renderDeliveryActionButton('Export Logs', 'export-variant', handleExportDeliveryDebugLogs)}
              {renderDeliveryActionButton('Clear Logs', 'trash-can-outline', handleClearDeliveryDebugLogs, 'danger')}
              {renderDeliveryActionButton('Accessibility', 'human-handsup', () => {
                openAccessibilitySettings();
                Toast.show({
                  type: 'info',
                  text1: 'Enable SpendSense',
                  text2: 'Find SpendSense in Accessibility settings and turn it on',
                });
              })}
              {renderDeliveryActionButton('Overlay Permission', 'picture-in-picture-bottom-right', () => {
                openOverlaySettings();
              })}
              {renderDeliveryActionButton('Porter Test', 'truck-fast-outline', () => (navigation as any).navigate('PorterTest'))}
            </View>

            <View style={{ height: 1, backgroundColor: colors.border, marginVertical: spacing.sm }} />

            <View style={[styles.deliveryToggleRow, { paddingTop: spacing.sm }]}>
              <MaterialCommunityIcons name="volume-vibrate" size={24} color="#f59e0b" style={{ marginTop: 2 }} />
              <View style={{ flex: 1, marginLeft: spacing.md, marginRight: spacing.sm }}>
                <Text style={[typography.bodyBold, { color: colors.text }]}>Volume Guard</Text>
                <Text style={[typography.caption, { color: colors.subtext, marginTop: 2 }]}>
                  Keep delivery apps from raising media volume above your locked level
                </Text>
                <TouchableOpacity
                  onPress={lockCurrentVolumes}
                  disabled={!volumeGuardEnabled}
                  style={[
                    styles.inlineControlButton,
                    {
                      borderColor: volumeGuardEnabled ? colors.accent : colors.border,
                      backgroundColor: volumeGuardEnabled ? `${colors.accent}15` : colors.card,
                      opacity: volumeGuardEnabled ? 1 : 0.5,
                    },
                  ]}>
                  <MaterialCommunityIcons name="lock-check-outline" size={16} color={volumeGuardEnabled ? colors.accent : colors.subtext} />
                  <Text style={[typography.caption, { color: volumeGuardEnabled ? colors.accent : colors.subtext, fontWeight: '700', marginLeft: 6 }]}>
                    Lock Current Volume
                  </Text>
                </TouchableOpacity>
              </View>
              <Switch
                value={volumeGuardEnabled}
                onValueChange={toggleVolumeGuard}
                trackColor={{ false: colors.border, true: '#10b98155' }}
                thumbColor={volumeGuardEnabled ? '#10b981' : colors.subtext}
              />
            </View>

            <View style={{ height: 1, backgroundColor: colors.border, marginVertical: spacing.sm }} />

            <View style={[styles.deliveryToggleRow, { paddingTop: spacing.sm }]}>
              <MaterialCommunityIcons name="chat-alert" size={24} color="#8b5cf6" style={{ marginTop: 2 }} />
              <View style={{ flex: 1, marginLeft: spacing.md, marginRight: spacing.sm }}>
                <Text style={[typography.bodyBold, { color: colors.text }]}>Floating Issue Marker</Text>
                <Text style={[typography.caption, { color: colors.subtext, marginTop: 2 }]}>
                  Show a draggable bubble to quickly mark delivery issues over other apps
                </Text>
              </View>
              <Switch
                value={floatingBubbleEnabled}
                onValueChange={toggleFloatingBubble}
                trackColor={{ false: colors.border, true: '#8b5cf655' }}
                thumbColor={floatingBubbleEnabled ? '#8b5cf6' : colors.subtext}
              />
            </View>
          </Card>
        </View>

        {/* Danger Zone */}
        <View style={{ marginTop: spacing.xl }}>
          <Text style={[typography.caption, { color: '#ef4444', marginBottom: spacing.md, textTransform: 'uppercase', fontWeight: '600', letterSpacing: 1 }]}>
            Danger Zone
          </Text>

          <TouchableOpacity
            style={[
              styles.signOutButton,
              {
                borderColor: '#ef4444',
                borderWidth: 1,
                borderRadius: borderRadius.md,
                paddingVertical: spacing.md,
                marginBottom: spacing.md,
              }
            ]}
            onPress={handleLogout}>
            <Text style={[typography.button, { color: '#ef4444', textAlign: 'center' }]}>
              Sign Out
            </Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.deleteButton} onPress={handleDeleteAccount}>
            <Text style={[typography.body, { color: '#ef4444', textAlign: 'center' }]}>
              Delete Account
            </Text>
          </TouchableOpacity>
        </View>

        {/* App Info */}
        <View style={styles.footer}>
          <Text style={[typography.caption, { color: colors.subtext, marginBottom: spacing.xs }]}>
            SpendSense v1.0.0
          </Text>
          <Text style={[typography.caption, { color: colors.subtext, fontSize: 12 }]}>
            Made with ❤️ for financial tracking
          </Text>
        </View>
      </View>

      {/* Edit Name Modal */}
      <Modal
        visible={showEditModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowEditModal(false)}>
        <View style={[styles.modalOverlay, { backgroundColor: colors.modalOverlay }]}>
          <Card style={{ width: '90%', maxWidth: 400, padding: spacing.lg }}>
            <Text style={[typography.h3, { color: colors.text, marginBottom: spacing.md }]}>
              Edit Name
            </Text>

            <AppInput
              placeholder="Enter your name"
              value={editedName}
              onChangeText={setEditedName}
              containerStyle={{ marginBottom: spacing.md }}
            />

            <View style={styles.modalButtons}>
              <AppButton
                title="Cancel"
                onPress={() => setShowEditModal(false)}
                variant="secondary"
                style={{ flex: 1, marginRight: spacing.sm }}
              />
              <AppButton
                title="Save"
                onPress={handleSaveName}
                loading={saving}
                variant="primary"
                style={{ flex: 1 }}
              />
            </View>
          </Card>
        </View>
      </Modal>

      {/* Change Password Modal */}
      <Modal
        visible={showPasswordModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowPasswordModal(false)}>
        <View style={[styles.modalOverlay, { backgroundColor: colors.modalOverlay }]}>
          <Card style={{ width: '90%', maxWidth: 400, padding: spacing.lg }}>
            <Text style={[typography.h3, { color: colors.text, marginBottom: spacing.md }]}>
              Change Password
            </Text>

            <AppInput
              placeholder="Current Password"
              value={currentPassword}
              onChangeText={setCurrentPassword}
              secureTextEntry
              containerStyle={{ marginBottom: spacing.md }}
            />

            <AppInput
              placeholder="New Password"
              value={newPassword}
              onChangeText={setNewPassword}
              secureTextEntry
              containerStyle={{ marginBottom: spacing.md }}
            />

            <AppInput
              placeholder="Confirm New Password"
              value={confirmPassword}
              onChangeText={setConfirmPassword}
              secureTextEntry
              containerStyle={{ marginBottom: spacing.md }}
            />

            <View style={styles.modalButtons}>
              <AppButton
                title="Cancel"
                onPress={() => setShowPasswordModal(false)}
                variant="secondary"
                style={{ flex: 1, marginRight: spacing.sm }}
              />
              <AppButton
                title="Save"
                onPress={handleSavePassword}
                loading={changingPassword}
                variant="primary"
                style={{ flex: 1 }}
              />
            </View>
          </Card>
        </View>
      </Modal>

      <AppConfirmModal
        visible={!!confirmDialog}
        title={confirmDialog?.title || ''}
        message={confirmDialog?.message || ''}
        confirmText={confirmDialog?.confirmText}
        isDestructive={confirmDialog?.isDestructive}
        onConfirm={() => confirmDialog?.onConfirm()}
        onCancel={() => setConfirmDialog(null)}
      />

      {/* Bug Reports Modal */}
      <Modal
        visible={showBugReportsModal}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setShowBugReportsModal(false)}>
        <View style={{ flex: 1, backgroundColor: colors.background }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: spacing.lg, borderBottomWidth: 1, borderBottomColor: colors.border, backgroundColor: colors.card }}>
            <Text style={[typography.h2, { color: colors.text }]}>Bug Reports</Text>
            <TouchableOpacity onPress={() => setShowBugReportsModal(false)} style={{ padding: 8 }}>
              <MaterialCommunityIcons name="close" size={24} color={colors.text} />
            </TouchableOpacity>
          </View>

          <ScrollView contentContainerStyle={{ padding: spacing.lg }}>
            {bugReports.length === 0 ? (
              <View style={{ alignItems: 'center', justifyContent: 'center', paddingVertical: 40 }}>
                <MaterialCommunityIcons name="check-circle-outline" size={64} color={colors.subtext} />
                <Text style={[typography.body, { color: colors.subtext, marginTop: spacing.md }]}>No bug reports found!</Text>
              </View>
            ) : (
              bugReports.map((report) => (
                <Card key={report.id} style={{ marginBottom: spacing.md, padding: spacing.md }}>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <View style={{ flex: 1 }}>
                      <Text style={[typography.bodyBold, { color: colors.text, marginBottom: 4 }]}>
                        {report.sender} {report.type === 'sms_failed' ? '(Failed)' : '(Added)'}
                      </Text>
                      <Text style={[typography.caption, { color: colors.subtext }]}>
                        {new Date(report.timestamp).toLocaleString()}
                      </Text>
                    </View>
                    <TouchableOpacity onPress={() => deleteBugReport(report.id)} style={{ padding: 8, backgroundColor: 'rgba(239, 68, 68, 0.1)', borderRadius: 20 }}>
                      <MaterialCommunityIcons name="trash-can-outline" size={20} color="#ef4444" />
                    </TouchableOpacity>
                  </View>
                  <View style={{ marginTop: spacing.md, backgroundColor: colors.background, padding: spacing.sm, borderRadius: borderRadius.sm }}>
                    <Text style={[typography.caption, { color: colors.text, fontFamily: 'monospace' }]} numberOfLines={2}>
                      {report.rawSms}
                    </Text>
                  </View>
                </Card>
              ))
            )}
          </ScrollView>

          {bugReports.length > 0 && (
            <View style={{ padding: spacing.lg, borderTopWidth: 1, borderTopColor: colors.border, backgroundColor: colors.card, flexDirection: 'row', gap: spacing.md }}>
              <AppButton
                title="Clear All"
                variant="secondary"
                onPress={handleClearBugReports}
                style={{ flex: 1, borderColor: '#ef4444' }}
              />
              <AppButton
                title="Export All"
                variant="primary"
                onPress={handleExportBugReports}
                style={{ flex: 1 }}
              />
            </View>
          )}

          {/* Render a localized Toast so it appears above this Modal */}
          <Toast autoHide visibilityTime={3000} swipeable={false} onPress={() => Toast.hide()} />
        </View>
      </Modal>
    </ScreenWrapper>
  );
}

const styles = StyleSheet.create({
  editIconButton: {
    position: 'absolute',
    top: 16,
    right: 16,
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(124, 106, 247, 0.1)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarCircle: {
    width: 80,
    height: 80,
    borderRadius: 40,
    justifyContent: 'center',
    alignItems: 'center',
  },
  segmentedControl: {
    flexDirection: 'row',
    gap: 8,
  },
  segmentButton: {
    flex: 1,
    paddingVertical: 12,
    paddingHorizontal: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  segmentIcon: {
    fontSize: 14,
    marginBottom: 4,
  },
  accountRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 16,
  },
  deliveryPanelHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 12,
  },
  deliveryModeBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 16,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderWidth: 1,
    borderRadius: 8,
  },
  deliveryStatusRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingHorizontal: 16,
    paddingVertical: 9,
  },
  deliveryStatusText: {
    flex: 1,
    marginLeft: 12,
    marginRight: 8,
  },
  statusPill: {
    minHeight: 28,
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 9,
    paddingVertical: 5,
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    maxWidth: 150,
  },
  statusDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    marginRight: 6,
  },
  deliveryActionGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    paddingHorizontal: 16,
  },
  deliveryActionButton: {
    minHeight: 40,
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    flexGrow: 1,
    flexBasis: '47%',
  },
  deliveryActionText: {
    fontWeight: '700',
    marginLeft: 6,
    flexShrink: 1,
  },
  deliveryToggleRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingHorizontal: 16,
    paddingBottom: 14,
  },
  inlineControlButton: {
    alignSelf: 'flex-start',
    marginTop: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
  },
  divider: {
    height: 1,
    marginHorizontal: 16,
  },
  signOutButton: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  deleteButton: {
    paddingVertical: 12,
  },
  footer: {
    alignItems: 'center',
    paddingVertical: 32,
    marginTop: 16,
  },
  modalOverlay: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  modalButtons: {
    flexDirection: 'row',
  },
});
