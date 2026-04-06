import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Alert,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { addCreditCard } from '../lib/creditCards';
import { scheduleDueReminders } from '../lib/ccNotifications';
import { useTheme } from '../context/ThemeContext';
import { ScreenWrapper, AppHeader, Card, AppButton } from '../components';

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
  const { colors, typography, spacing, borderRadius } = useTheme();
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
    <ScreenWrapper scrollable>
      <AppHeader title="Add Credit Card" showBack />
      
      <View style={{ padding: spacing.lg }}>
        <Text style={[typography.caption, { color: colors.subtext, marginBottom: spacing.sm }]}>Bank Name *</Text>
        <TouchableOpacity
          style={[styles.input, { backgroundColor: colors.card, borderColor: colors.border, borderRadius: borderRadius.md, padding: spacing.md }]}
          onPress={() => setShowBankPicker(!showBankPicker)}>
          <Text style={[typography.body, { color: bankName ? colors.text : colors.subtext }]}>
            {bankName || 'Select Bank'}
          </Text>
        </TouchableOpacity>

        {showBankPicker && (
          <Card style={{ marginTop: spacing.sm, marginBottom: spacing.md }}>
            {BANKS.map((bank) => (
              <TouchableOpacity
                key={bank}
                style={[styles.pickerItem, { borderBottomColor: colors.border, padding: spacing.md }]}
                onPress={() => {
                  setBankName(bank);
                  setShowBankPicker(false);
                }}>
                <Text style={[typography.body, { color: colors.text }]}>{bank}</Text>
              </TouchableOpacity>
            ))}
          </Card>
        )}

        {bankName === 'Custom' && (
          <>
            <Text style={[typography.caption, { color: colors.subtext, marginBottom: spacing.sm, marginTop: spacing.md }]}>Custom Bank Name *</Text>
            <TextInput
              style={[styles.input, { backgroundColor: colors.card, borderColor: colors.border, color: colors.text, borderRadius: borderRadius.md, padding: spacing.md }]}
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

        <Text style={[typography.caption, { color: colors.subtext, marginBottom: spacing.sm, marginTop: spacing.md }]}>Card Nickname (Optional)</Text>
        <TextInput
          style={[styles.input, { backgroundColor: colors.card, borderColor: colors.border, color: colors.text, borderRadius: borderRadius.md, padding: spacing.md }]}
          placeholder="e.g., Rewards Card, Travel Card"
          placeholderTextColor={colors.subtext}
          value={cardName}
          onChangeText={setCardName}
        />

        <Text style={[typography.caption, { color: colors.subtext, marginBottom: spacing.sm, marginTop: spacing.md }]}>Last 4 Digits *</Text>
        <TextInput
          style={[styles.input, { backgroundColor: colors.card, borderColor: colors.border, color: colors.text, borderRadius: borderRadius.md, padding: spacing.md }]}
          placeholder="1234"
          placeholderTextColor={colors.subtext}
          value={last4Digits}
          onChangeText={setLast4Digits}
          keyboardType="numeric"
          maxLength={4}
        />

        <Text style={[typography.caption, { color: colors.subtext, marginBottom: spacing.sm, marginTop: spacing.md }]}>Credit Limit *</Text>
        <TextInput
          style={[styles.input, { backgroundColor: colors.card, borderColor: colors.border, color: colors.text, borderRadius: borderRadius.md, padding: spacing.md }]}
          placeholder="50000"
          placeholderTextColor={colors.subtext}
          value={creditLimit}
          onChangeText={setCreditLimit}
          keyboardType="numeric"
        />

        <Text style={[typography.caption, { color: colors.subtext, marginBottom: spacing.sm, marginTop: spacing.md }]}>Current Outstanding (Optional)</Text>
        <TextInput
          style={[styles.input, { backgroundColor: colors.card, borderColor: colors.border, color: colors.text, borderRadius: borderRadius.md, padding: spacing.md }]}
          placeholder="0"
          placeholderTextColor={colors.subtext}
          value={currentOutstanding}
          onChangeText={setCurrentOutstanding}
          keyboardType="numeric"
        />

        <Text style={[typography.caption, { color: colors.subtext, marginBottom: spacing.sm, marginTop: spacing.md }]}>Due Date (Day of Month) *</Text>
        <TextInput
          style={[styles.input, { backgroundColor: colors.card, borderColor: colors.border, color: colors.text, borderRadius: borderRadius.md, padding: spacing.md }]}
          placeholder="15"
          placeholderTextColor={colors.subtext}
          value={dueDate}
          onChangeText={setDueDate}
          keyboardType="numeric"
          maxLength={2}
        />

        <Text style={[typography.caption, { color: colors.subtext, marginBottom: spacing.sm, marginTop: spacing.md }]}>Billing Cycle Date (Day of Month) *</Text>
        <TextInput
          style={[styles.input, { backgroundColor: colors.card, borderColor: colors.border, color: colors.text, borderRadius: borderRadius.md, padding: spacing.md }]}
          placeholder="1"
          placeholderTextColor={colors.subtext}
          value={billingCycleDate}
          onChangeText={setBillingCycleDate}
          keyboardType="numeric"
          maxLength={2}
        />

        <AppButton
          title="Add Card"
          onPress={handleSave}
          loading={saving}
          fullWidth
          style={{ marginTop: spacing.xl, marginBottom: spacing.xl }}
        />
      </View>
    </ScreenWrapper>
  );
}

const styles = StyleSheet.create({
  input: {
    borderWidth: 1,
  },
  pickerItem: {
    borderBottomWidth: 1,
  },
});
