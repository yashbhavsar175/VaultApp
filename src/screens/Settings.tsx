import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  SafeAreaView,
  ScrollView,
  Modal,
} from 'react-native';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';
import Toast from 'react-native-toast-message';
import { supabase } from '../lib/supabase';
import { useTheme } from '../context/ThemeContext';

export default function Settings() {
  const { colors, themeMode, setThemeMode } = useTheme();
  const [userEmail, setUserEmail] = useState('');
  const [userName, setUserName] = useState('');
  const [showEditModal, setShowEditModal] = useState(false);
  const [editedName, setEditedName] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    loadUserInfo();
  }, []);

  const loadUserInfo = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (user?.email) {
      setUserEmail(user.email);
      
      // Load profile name
      const { data: profile } = await supabase
        .from('profiles')
        .select('full_name')
        .eq('id', user.id)
        .single();
      
      if (profile?.full_name) {
        setUserName(profile.full_name);
      }
    }
  };

  const handleLogout = async () => {
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

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
      <ScrollView style={styles.scrollView}>
        <View style={styles.header}>
          <Text style={[styles.title, { color: colors.text }]}>Settings</Text>
        </View>

        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: colors.subtext }]}>Appearance</Text>
          
          <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <TouchableOpacity 
              style={styles.row} 
              onPress={() => setThemeMode('light')}>
              <MaterialCommunityIcons name="white-balance-sunny" size={24} color={colors.accent} />
              <View style={styles.rowContent}>
                <Text style={[styles.rowValue, { color: colors.text }]}>Light</Text>
              </View>
              {themeMode === 'light' && (
                <MaterialCommunityIcons name="check" size={24} color={colors.accent} />
              )}
            </TouchableOpacity>

            <View style={[styles.divider, { backgroundColor: colors.border }]} />

            <TouchableOpacity 
              style={styles.row} 
              onPress={() => setThemeMode('dark')}>
              <MaterialCommunityIcons name="moon-waning-crescent" size={24} color={colors.accent} />
              <View style={styles.rowContent}>
                <Text style={[styles.rowValue, { color: colors.text }]}>Dark</Text>
              </View>
              {themeMode === 'dark' && (
                <MaterialCommunityIcons name="check" size={24} color={colors.accent} />
              )}
            </TouchableOpacity>

            <View style={[styles.divider, { backgroundColor: colors.border }]} />

            <TouchableOpacity 
              style={styles.row} 
              onPress={() => setThemeMode('system')}>
              <MaterialCommunityIcons name="theme-light-dark" size={24} color={colors.accent} />
              <View style={styles.rowContent}>
                <Text style={[styles.rowValue, { color: colors.text }]}>System</Text>
              </View>
              {themeMode === 'system' && (
                <MaterialCommunityIcons name="check" size={24} color={colors.accent} />
              )}
            </TouchableOpacity>
          </View>
        </View>

        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: colors.subtext }]}>Account</Text>
          
          <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <TouchableOpacity style={styles.row} onPress={handleEditName}>
              <MaterialCommunityIcons name="account-circle" size={24} color={colors.accent} />
              <View style={styles.rowContent}>
                <Text style={[styles.rowLabel, { color: colors.subtext }]}>Name</Text>
                <Text style={[styles.rowValue, { color: colors.text }]}>{userName || 'Not set'}</Text>
              </View>
              <MaterialCommunityIcons name="pencil" size={20} color={colors.accent} />
            </TouchableOpacity>

            <View style={[styles.divider, { backgroundColor: colors.border }]} />

            <View style={styles.row}>
              <MaterialCommunityIcons name="email" size={24} color={colors.accent} />
              <View style={styles.rowContent}>
                <Text style={[styles.rowLabel, { color: colors.subtext }]}>Email</Text>
                <Text style={[styles.rowValue, { color: colors.text }]}>{userEmail}</Text>
              </View>
            </View>
          </View>
        </View>

        <View style={styles.section}>
          <TouchableOpacity style={styles.logoutButton} onPress={handleLogout}>
            <MaterialCommunityIcons name="logout" size={20} color="#fff" />
            <Text style={styles.logoutText}>Sign Out</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.footer}>
          <Text style={[styles.appVersion, { color: colors.subtext }]}>SpendSense v1.0.0</Text>
          <Text style={[styles.footerText, { color: colors.subtext }]}>Made with ❤️ for financial tracking</Text>
        </View>
      </ScrollView>

      <Modal
        visible={showEditModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowEditModal(false)}>
        <View style={[styles.modalOverlay, { backgroundColor: colors.modalOverlay }]}>
          <View style={[styles.modalContent, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={[styles.modalTitle, { color: colors.text }]}>Edit Name</Text>
            
            <TextInput
              style={[styles.modalInput, { backgroundColor: colors.input, borderColor: colors.border, color: colors.text }]}
              placeholder="Enter your name"
              placeholderTextColor={colors.subtext}
              value={editedName}
              onChangeText={setEditedName}
              autoFocus
            />

            <View style={styles.modalButtons}>
              <TouchableOpacity
                style={[styles.modalButton, styles.cancelButton, { backgroundColor: colors.border }]}
                onPress={() => setShowEditModal(false)}>
                <Text style={[styles.cancelButtonText, { color: colors.text }]}>Cancel</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.modalButton, styles.saveButton, { backgroundColor: colors.accent }]}
                onPress={handleSaveName}
                disabled={saving}>
                <Text style={styles.saveButtonText}>
                  {saving ? 'Saving...' : 'Save'}
                </Text>
              </TouchableOpacity>
            </View>
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
  scrollView: {
    flex: 1,
  },
  header: {
    padding: 20,
    paddingTop: 16,
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
  },
  section: {
    paddingHorizontal: 20,
    marginBottom: 24,
  },
  sectionTitle: {
    fontSize: 14,
    marginBottom: 12,
    textTransform: 'uppercase',
    fontWeight: '600',
  },
  card: {
    borderRadius: 12,
    borderWidth: 1,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
  },
  rowContent: {
    flex: 1,
    marginLeft: 12,
  },
  rowLabel: {
    fontSize: 12,
    marginBottom: 4,
  },
  rowValue: {
    fontSize: 16,
    fontWeight: '500',
  },
  logoutButton: {
    backgroundColor: '#ef4444',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
    borderRadius: 12,
    gap: 8,
  },
  logoutText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  footer: {
    alignItems: 'center',
    paddingVertical: 32,
  },
  appVersion: {
    fontSize: 14,
    marginBottom: 8,
  },
  footerText: {
    fontSize: 12,
  },
  rowDescription: {
    fontSize: 12,
    marginTop: 2,
  },
  divider: {
    height: 1,
    marginVertical: 8,
  },
  modalOverlay: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  modalContent: {
    borderRadius: 16,
    padding: 24,
    width: '100%',
    maxWidth: 400,
    borderWidth: 1,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    marginBottom: 16,
  },
  modalInput: {
    borderWidth: 1,
    borderRadius: 10,
    padding: 12,
    fontSize: 16,
    marginBottom: 20,
  },
  modalButtons: {
    flexDirection: 'row',
    gap: 12,
  },
  modalButton: {
    flex: 1,
    padding: 14,
    borderRadius: 10,
    alignItems: 'center',
  },
  cancelButton: {},
  saveButton: {},
  cancelButtonText: {
    fontSize: 16,
    fontWeight: '600',
  },
  saveButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
});
