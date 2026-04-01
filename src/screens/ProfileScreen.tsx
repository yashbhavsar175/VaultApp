import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  SafeAreaView,
  ScrollView,
  ActivityIndicator,
} from 'react-native';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';
import Toast from 'react-native-toast-message';
import { supabase } from '../lib/supabase';
import { useTheme } from '../context/ThemeContext';

interface ProfileScreenProps {
  onProfileComplete?: () => void;
  isEditing?: boolean;
}

export default function ProfileScreen({ onProfileComplete, isEditing = false }: ProfileScreenProps) {
  const { colors } = useTheme();
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [monthlyBudget, setMonthlyBudget] = useState('');
  const [currency, setCurrency] = useState('INR');
  const [loading, setLoading] = useState(false);
  const [initialLoading, setInitialLoading] = useState(isEditing);

  useEffect(() => {
    if (isEditing) {
      loadProfile();
    } else {
      // Pre-fill name from Google Sign-In metadata if available
      loadGoogleUserName();
    }
  }, [isEditing]);

  const loadGoogleUserName = async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (session?.user?.user_metadata) {
        const metadata = session.user.user_metadata;
        const googleName = metadata.full_name || metadata.name;
        if (googleName) {
          setFullName(googleName);
        }
      }
    } catch (error) {
      console.error('Error loading Google user name:', error);
    }
  };

  const loadProfile = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', user.id)
        .single();

      if (error) throw error;

      if (data) {
        setFullName(data.full_name || '');
        setPhone(data.phone || '');
        setMonthlyBudget(data.monthly_budget?.toString() || '');
        setCurrency(data.currency || 'INR');
      }
    } catch (error) {
      console.error('Error loading profile:', error);
    } finally {
      setInitialLoading(false);
    }
  };

  const handleSave = async () => {
    if (!fullName.trim()) {
      Toast.show({
        type: 'error',
        text1: 'Required Field',
        text2: 'Please enter your full name',
      });
      return;
    }

    setLoading(true);

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('No user found');

      const profileData = {
        id: user.id,
        full_name: fullName.trim(),
        phone: phone.trim() || null,
        monthly_budget: monthlyBudget ? parseFloat(monthlyBudget) : null,
        currency,
        updated_at: new Date().toISOString(),
      };

      const { error } = await supabase
        .from('profiles')
        .upsert(profileData);

      if (error) throw error;

      Toast.show({
        type: 'success',
        text1: 'Profile Saved',
        text2: 'Your profile has been updated successfully',
      });

      if (onProfileComplete) {
        onProfileComplete();
      }
    } catch (error) {
      console.error('Error saving profile:', error);
      Toast.show({
        type: 'error',
        text1: 'Error',
        text2: 'Failed to save profile',
      });
    } finally {
      setLoading(false);
    }
  };

  if (initialLoading) {
    return (
      <View style={[styles.loadingContainer, { backgroundColor: colors.background }]}>
        <ActivityIndicator size="large" color={colors.accent} />
      </View>
    );
  }

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
      <ScrollView style={styles.scrollView}>
        <View style={styles.header}>
          <Text style={[styles.title, { color: colors.text }]}>
            {isEditing ? 'Edit Profile' : 'Complete Your Profile'}
          </Text>
          <Text style={[styles.subtitle, { color: colors.subtext }]}>
            {isEditing ? 'Update your information' : 'Tell us a bit about yourself'}
          </Text>
        </View>

        <View style={styles.form}>
          <View style={styles.inputGroup}>
            <Text style={[styles.label, { color: colors.text }]}>
              Full Name <Text style={styles.required}>*</Text>
            </Text>
            <View style={[styles.inputContainer, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <MaterialCommunityIcons name="account" size={20} color={colors.subtext} />
              <TextInput
                style={[styles.input, { color: colors.text }]}
                placeholder="Enter your full name"
                placeholderTextColor={colors.subtext}
                value={fullName}
                onChangeText={setFullName}
              />
            </View>
          </View>

          <View style={styles.inputGroup}>
            <Text style={[styles.label, { color: colors.text }]}>Phone Number</Text>
            <View style={[styles.inputContainer, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <MaterialCommunityIcons name="phone" size={20} color={colors.subtext} />
              <TextInput
                style={[styles.input, { color: colors.text }]}
                placeholder="Enter your phone number"
                placeholderTextColor={colors.subtext}
                value={phone}
                onChangeText={setPhone}
                keyboardType="phone-pad"
              />
            </View>
          </View>

          <View style={styles.inputGroup}>
            <Text style={[styles.label, { color: colors.text }]}>Monthly Income Budget</Text>
            <View style={[styles.inputContainer, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <MaterialCommunityIcons name="cash" size={20} color={colors.subtext} />
              <TextInput
                style={[styles.input, { color: colors.text }]}
                placeholder="Enter monthly budget"
                placeholderTextColor={colors.subtext}
                value={monthlyBudget}
                onChangeText={setMonthlyBudget}
                keyboardType="numeric"
              />
            </View>
          </View>

          <View style={styles.inputGroup}>
            <Text style={[styles.label, { color: colors.text }]}>Currency</Text>
            <View style={styles.currencyContainer}>
              <TouchableOpacity
                style={[
                  styles.currencyButton,
                  { backgroundColor: colors.card, borderColor: colors.border },
                  currency === 'INR' && { backgroundColor: colors.accent, borderColor: colors.accent }
                ]}
                onPress={() => setCurrency('INR')}>
                <Text style={[{ color: colors.subtext }, currency === 'INR' && { color: '#fff' }]}>
                  INR (₹)
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.currencyButton,
                  { backgroundColor: colors.card, borderColor: colors.border },
                  currency === 'USD' && { backgroundColor: colors.accent, borderColor: colors.accent }
                ]}
                onPress={() => setCurrency('USD')}>
                <Text style={[{ color: colors.subtext }, currency === 'USD' && { color: '#fff' }]}>
                  USD ($)
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.currencyButton,
                  { backgroundColor: colors.card, borderColor: colors.border },
                  currency === 'EUR' && { backgroundColor: colors.accent, borderColor: colors.accent }
                ]}
                onPress={() => setCurrency('EUR')}>
                <Text style={[{ color: colors.subtext }, currency === 'EUR' && { color: '#fff' }]}>
                  EUR (€)
                </Text>
              </TouchableOpacity>
            </View>
          </View>

          <TouchableOpacity
            style={[styles.saveButton, { backgroundColor: colors.accent }]}
            onPress={handleSave}
            disabled={loading}>
            {loading ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.saveButtonText}>Save Profile</Text>
            )}
          </TouchableOpacity>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
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
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 16,
  },
  form: {
    padding: 20,
  },
  inputGroup: {
    marginBottom: 24,
  },
  label: {
    fontSize: 14,
    marginBottom: 8,
    fontWeight: '500',
  },
  required: {
    color: '#ef4444',
  },
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
  },
  input: {
    flex: 1,
    fontSize: 16,
    paddingVertical: 12,
    paddingLeft: 12,
  },
  currencyContainer: {
    flexDirection: 'row',
    gap: 8,
  },
  currencyButton: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
    fontSize: 14,
    fontWeight: '500',
  },
  saveButton: {
    borderRadius: 10,
    padding: 16,
    alignItems: 'center',
    marginTop: 8,
  },
  saveButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
});
