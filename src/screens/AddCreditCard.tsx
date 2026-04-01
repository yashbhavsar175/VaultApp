import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { addCreditCard } from '../lib/creditCards';
import { scheduleDueReminders } from '../lib/ccNotifications';
import { useTheme } from '../context/ThemeContext';

const BANKS = [
  'HDFC Bank',
  'Utkarsh Bank',
  'SBI',
  'ICICI Bank',
  'Axis Bank',
  'Kotak Bank',
  'IndusInd Bank',
  'Yes Bank',
  'IDFC First Bank',
  'Custom',
];

export default function AddCreditCard() {
  const navigation = useNavigation();
  const { colors } = useTheme();
  const [bankName, setBankName] = useState('');
  const [cardName, setCardName] = useState('');
  const [last4Digits, setLast4Digits] = useState('');
  const [creditLimit, setCreditLimit] = useState('');
  const [currentOutstanding, setCurrentOutstanding] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [billingCycleDate, setBillingCycleDate] = useState('');
  const [saving, setSaving] = useState(false);
  const [showBankPicker, setShowBankPicker] = useState(false);

  const handleSave = async () => {
    // Validation
    if (!bankName) {
      Alert.alert('Error', 'Please select a bank');
      return;
    }
    if (!last4Digits || last4Digits.length !== 4) {
      Alert.alert('Error', 'Please enter last 4 digits of card');
      return;
    }
    if (!creditLimit || parseFloat(creditLimit) <= 0) {
      Alert.alert('Error', 'Please enter valid credit limit');
      return;
    }
    if (!dueDate || parseInt(dueDate) < 1 || parseInt(dueDate) > 31) {
      Alert.alert('Error', 'Please enter valid due date (1-31)');
      return;
    }
    if (!billingCycleDate || parseInt(billingCycleDate) < 1 || parseInt(billingCycleDate) > 31) {
      Alert.alert('Error', 'Please enter valid billing cycle date (1-31)');
      return;
    }

    setSaving(true);
    try {
      const card = await addCreditCard({
        bank_name: bankName,
        card_name: cardName || undefined,
        last_4_digits: last4Digits,
        credit_limit: parseFloat(creditLimit),
        current_outstanding: currentOutstanding ? parseFloat(currentOutstanding) : 0,
        due_date: parseInt(dueDate),
        billing_cycle_date: parseInt(billingCycleDate),
      });

      // Schedule due date reminders
      await scheduleDueReminders(card);

      Alert.alert('Success', 'Credit card added successfully', [
        {
          text: 'OK',
          onPress: () => navigation.goBack(),
        },
      ]);
    } catch (error: any) {
      console.error('Error adding card:', error);
      Alert.alert('Error', error.message || 'Failed to add credit card');
    } finally {
      setSaving(false);
    }
  };

  return (
    <ScrollView style={[styles.container, { backgroundColor: colors.background }]}>
      <Text style={[styles.title, { color: colors.text }]}>Add Credit Card</Text>

      <Text style={[styles.label, { color: colors.subtext }]}>Bank Name *</Text>
      <TouchableOpacity
        style={[styles.input, { backgroundColor: colors.card, borderColor: colors.border }]}
        onPress={() => setShowBankPicker(!showBankPicker)}>
        <Text style={[styles.inputText, { color: colors.text }, !bankName && { color: colors.subtext }]}>
          {bankName || 'Select Bank'}
        </Text>
      </TouchableOpacity>

      {showBankPicker && (
        <View style={[styles.picker, { backgroundColor: colors.card }]}>
          {BANKS.map((bank) => (
            <TouchableOpacity
              key={bank}
              style={[styles.pickerItem, { borderBottomColor: colors.border }]}
              onPress={() => {
                setBankName(bank);
                setShowBankPicker(false);
              }}>
              <Text style={[styles.pickerItemText, { color: colors.text }]}>{bank}</Text>
            </TouchableOpacity>
          ))}
        </View>
      )}

      {bankName === 'Custom' && (
        <>
          <Text style={[styles.label, { color: colors.subtext }]}>Custom Bank Name *</Text>
          <TextInput
            style={[styles.input, { backgroundColor: colors.card, borderColor: colors.border, color: colors.text }]}
            placeholder="Enter bank name"
            placeholderTextColor={colors.subtext}
            value={cardName}
            onChangeText={(text) => {
              setCardName(text);
              setBankName(text);
            }}
          />
        </>
      )}

      <Text style={[styles.label, { color: colors.subtext }]}>Card Nickname (Optional)</Text>
      <TextInput
        style={[styles.input, { backgroundColor: colors.card, borderColor: colors.border, color: colors.text }]}
        placeholder="e.g., Rewards Card, Travel Card"
        placeholderTextColor={colors.subtext}
        value={cardName}
        onChangeText={setCardName}
      />

      <Text style={[styles.label, { color: colors.subtext }]}>Last 4 Digits *</Text>
      <TextInput
        style={[styles.input, { backgroundColor: colors.card, borderColor: colors.border, color: colors.text }]}
        placeholder="1234"
        placeholderTextColor={colors.subtext}
        value={last4Digits}
        onChangeText={setLast4Digits}
        keyboardType="numeric"
        maxLength={4}
      />

      <Text style={[styles.label, { color: colors.subtext }]}>Credit Limit *</Text>
      <TextInput
        style={[styles.input, { backgroundColor: colors.card, borderColor: colors.border, color: colors.text }]}
        placeholder="50000"
        placeholderTextColor={colors.subtext}
        value={creditLimit}
        onChangeText={setCreditLimit}
        keyboardType="numeric"
      />

      <Text style={[styles.label, { color: colors.subtext }]}>Current Outstanding (Optional)</Text>
      <TextInput
        style={[styles.input, { backgroundColor: colors.card, borderColor: colors.border, color: colors.text }]}
        placeholder="0"
        placeholderTextColor={colors.subtext}
        value={currentOutstanding}
        onChangeText={setCurrentOutstanding}
        keyboardType="numeric"
      />

      <Text style={[styles.label, { color: colors.subtext }]}>Due Date (Day of Month) *</Text>
      <TextInput
        style={[styles.input, { backgroundColor: colors.card, borderColor: colors.border, color: colors.text }]}
        placeholder="15"
        placeholderTextColor={colors.subtext}
        value={dueDate}
        onChangeText={setDueDate}
        keyboardType="numeric"
        maxLength={2}
      />

      <Text style={[styles.label, { color: colors.subtext }]}>Billing Cycle Date (Day of Month) *</Text>
      <TextInput
        style={[styles.input, { backgroundColor: colors.card, borderColor: colors.border, color: colors.text }]}
        placeholder="1"
        placeholderTextColor={colors.subtext}
        value={billingCycleDate}
        onChangeText={setBillingCycleDate}
        keyboardType="numeric"
        maxLength={2}
      />

      <TouchableOpacity
        style={[styles.saveButton, { backgroundColor: colors.accent }]}
        onPress={handleSave}
        disabled={saving}>
        {saving ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={styles.saveButtonText}>Add Card</Text>
        )}
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 20,
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    marginBottom: 24,
  },
  label: {
    fontSize: 14,
    marginBottom: 8,
    marginTop: 16,
  },
  input: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    fontSize: 16,
  },
  inputText: {
    fontSize: 16,
  },
  picker: {
    borderRadius: 12,
    marginTop: 8,
    marginBottom: 16,
    overflow: 'hidden',
  },
  pickerItem: {
    padding: 16,
    borderBottomWidth: 1,
  },
  pickerItemText: {
    fontSize: 16,
  },
  saveButton: {
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
    marginTop: 32,
    marginBottom: 40,
  },
  saveButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
});
