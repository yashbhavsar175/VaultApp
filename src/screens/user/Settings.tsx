import React, { useState, useEffect, useRef, useCallback } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Modal, Alert, AppState, AppStateStatus, Share, ScrollView } from 'react-native';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';
import Toast from 'react-native-toast-message';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '../../lib/core';
import { useTheme } from '../../context/ThemeContext';
import { ScreenWrapper, Card, AppButton, AppInput, AppHeader, AppConfirmModal } from '../../components';
import { useNavigation } from '@react-navigation/native';
import { runAllNotificationTests } from '../../utils/testUtils';
import { isAccessibilityServiceEnabled, openAccessibilitySettings } from '../../lib/services/porter';

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
    try {
      const enabled = await isAccessibilityServiceEnabled();
      setPorterServiceEnabled(enabled);
    } catch (error) {
      console.log('Error checking Porter service', error);
    }
  }, []);

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
      const cachedProfile = await AsyncStorage.getItem('cache_user_profile');
      if (cachedProfile) {
        const { email, name } = JSON.parse(cachedProfile);
        if (email) setUserEmail(email);
        if (name) setUserName(name);
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
        AsyncStorage.setItem('cache_user_profile', JSON.stringify({
          email: user.email,
          name: profile?.full_name || '',
        }));
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
          await supabase.auth.signOut();
          Toast.show({
            type: 'success',
            text1: 'Signed Out',
            text2: 'You have been logged out successfully',
          });
        } catch (error) {
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
      AsyncStorage.setItem('cache_user_profile', JSON.stringify({
        email: userEmail,
        name: editedName.trim(),
      }));
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

              // Delete user data
              await Promise.all([
                supabase.from('transactions').delete().eq('user_id', user.id),
                supabase.from('bank_accounts').delete().eq('user_id', user.id),
                supabase.from('profiles').delete().eq('id', user.id),
              ]);

              // Sign out
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
        setBugReports(JSON.parse(logsStr));
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
      await Share.share({ title: 'VaultApp Bug Reports', message: logsStr });
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

            <View style={{ height: 1, backgroundColor: colors.border, marginVertical: 4 }} />

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

        {/* Porter Assistant (Experimental) */}
        <View style={{ marginTop: spacing.xl }}>
          <Text style={[typography.caption, { color: colors.subtext, marginBottom: spacing.md, textTransform: 'uppercase', fontWeight: '600', letterSpacing: 1 }]}>
            Experimental Features
          </Text>

          <Card>
            <View style={[styles.accountRow, { paddingBottom: spacing.sm, flexWrap: 'wrap' }]}>
              <MaterialCommunityIcons name="truck-fast" size={24} color="#06b6d4" />
              <View style={{ flex: 1, marginLeft: spacing.md }}>
                <Text style={[typography.bodyBold, { color: colors.text }]}>Porter Trip Distance</Text>
                <Text style={[typography.caption, { color: colors.subtext, marginTop: 2 }]}>
                  Automatically show trip distance over Porter app
                </Text>
              </View>
              <TouchableOpacity
                onPress={() => {
                  openAccessibilitySettings();
                  Toast.show({
                    type: 'info',
                    text1: 'Enable SpendSense',
                    text2: 'Find SpendSense in Accessibility settings and turn it on',
                  });
                }}
                style={{
                  backgroundColor: porterServiceEnabled ? '#10b981' + '20' : colors.card,
                  borderColor: porterServiceEnabled ? '#10b981' : colors.border,
                  borderWidth: 1,
                  paddingHorizontal: 12,
                  paddingVertical: 6,
                  borderRadius: 16,
                  marginLeft: 4,
                }}>
                <Text style={[typography.caption, { color: porterServiceEnabled ? '#10b981' : colors.text, fontWeight: 'bold' }]}>
                  {porterServiceEnabled ? 'Active' : 'Enable'}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => (navigation as any).navigate('PorterTest')}
                style={{
                  backgroundColor: colors.accent + '20',
                  borderColor: colors.accent,
                  borderWidth: 1,
                  paddingHorizontal: 12,
                  paddingVertical: 6,
                  borderRadius: 16,
                  marginLeft: 4,
                }}>
                <Text style={[typography.caption, { color: colors.accent, fontWeight: 'bold' }]}>
                  Test
                </Text>
              </TouchableOpacity>
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
          <Toast />
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
