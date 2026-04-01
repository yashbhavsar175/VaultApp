import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import Toast from 'react-native-toast-message';
import { addTransaction } from '../lib/db';
import { parseTransactionWithAI } from '../lib/aiParser';
import { TransactionType } from '../types';
import { useTheme } from '../context/ThemeContext';

type Mode = 'ai' | 'manual';

interface ParsedData {
  amount: number;
  note: string;
  type: TransactionType;
  category: string;
}

export default function Add() {
  const navigation = useNavigation();
  const { colors } = useTheme();
  const [mode, setMode] = useState<Mode>('ai');
  
  // AI Mode state
  const [aiInput, setAiInput] = useState('');
  const [parsing, setParsing] = useState(false);
  const [parsedData, setParsedData] = useState<ParsedData | null>(null);
  
  // Manual Mode state
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [type, setType] = useState<TransactionType>('expense');
  const [category, setCategory] = useState('');
  const [saving, setSaving] = useState(false);

  const formatAmount = (amt: number) => {
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: 'INR',
      maximumFractionDigits: 0,
    }).format(amt);
  };

  const handleParseWithAI = async () => {
    if (!aiInput.trim()) {
      Toast.show({
        type: 'error',
        text1: 'Error',
        text2: 'Please describe your transaction',
      });
      return;
    }

    setParsing(true);
    try {
      const result = await parseTransactionWithAI(aiInput);
      setParsedData(result);
      Toast.show({
        type: 'success',
        text1: 'Parsed Successfully',
        text2: 'Review and confirm the details',
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      const isConfigError = errorMessage.includes('not configured');
      
      Toast.show({
        type: 'error',
        text1: isConfigError ? 'API Key Missing' : 'Parsing Failed',
        text2: isConfigError ? 'Please configure API key or use Manual mode' : 'Please try manual mode',
      });
      console.error('Error: Failed to parse transaction with Gemini', error);
    } finally {
      setParsing(false);
    }
  };

  const handleConfirmAI = async () => {
    if (!parsedData) return;

    setSaving(true);
    try {
      await addTransaction({
        amount: parsedData.amount,
        note: parsedData.note,
        type: parsedData.type,
        category: parsedData.category,
      });
      Toast.show({
        type: 'success',
        text1: 'Success',
        text2: 'Transaction added successfully',
      });
      navigation.navigate('Dashboard' as never);
      resetForm();
    } catch (error) {
      Toast.show({
        type: 'error',
        text1: 'Error',
        text2: 'Failed to save transaction',
      });
      console.error(error);
    } finally {
      setSaving(false);
    }
  };

  const handleEditManually = () => {
    if (parsedData) {
      setAmount(parsedData.amount.toString());
      setNote(parsedData.note);
      setType(parsedData.type);
      setCategory(parsedData.category);
    }
    setMode('manual');
  };

  const handleSaveManual = async () => {
    if (!amount || !note) {
      Toast.show({
        type: 'error',
        text1: 'Error',
        text2: 'Please fill in amount and note',
      });
      return;
    }

    setSaving(true);
    try {
      await addTransaction({
        amount: parseFloat(amount),
        note,
        type,
        category: category || 'general',
      });
      Toast.show({
        type: 'success',
        text1: 'Success',
        text2: 'Transaction added successfully',
      });
      navigation.navigate('Dashboard' as never);
      resetForm();
    } catch (error) {
      Toast.show({
        type: 'error',
        text1: 'Error',
        text2: 'Failed to save transaction',
      });
      console.error(error);
    } finally {
      setSaving(false);
    }
  };

  const resetForm = () => {
    setAiInput('');
    setParsedData(null);
    setAmount('');
    setNote('');
    setType('expense');
    setCategory('');
  };

  const getTypeColor = (txType: TransactionType) => {
    switch (txType) {
      case 'income':
        return '#10b981';
      case 'expense':
        return '#ef4444';
      case 'investment':
        return '#7c6af7';
      case 'emi':
        return '#f59e0b';
    }
  };

  return (
    <KeyboardAvoidingView
      style={[styles.container, { backgroundColor: colors.background }]}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <ScrollView style={styles.scrollView}>
        <View style={[styles.modeToggle, { backgroundColor: colors.card }]}>
          <TouchableOpacity
            style={[styles.modeButton, mode === 'ai' && { backgroundColor: colors.accent }]}
            onPress={() => setMode('ai')}>
            <Text style={[{ color: colors.subtext }, mode === 'ai' && styles.modeButtonTextActive]}>
              AI Mode
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.modeButton, mode === 'manual' && { backgroundColor: colors.accent }]}
            onPress={() => setMode('manual')}>
            <Text style={[{ color: colors.subtext }, mode === 'manual' && styles.modeButtonTextActive]}>
              Manual Mode
            </Text>
          </TouchableOpacity>
        </View>

        {mode === 'ai' ? (
          <View style={styles.content}>
            <Text style={[styles.label, { color: colors.subtext }]}>Describe your transaction</Text>
            <TextInput
              style={[styles.aiInput, { backgroundColor: colors.card, borderColor: colors.border, color: colors.text }]}
              placeholder="e.g., 200 rs petrol"
              placeholderTextColor={colors.subtext}
              value={aiInput}
              onChangeText={setAiInput}
              multiline
            />

            <View style={[styles.examplesContainer, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <Text style={[styles.examplesTitle, { color: colors.subtext }]}>Examples:</Text>
              <Text style={[styles.exampleText, { color: colors.accent }]}>• 200 rs petrol</Text>
              <Text style={[styles.exampleText, { color: colors.accent }]}>• 5000 SIP Zerodha</Text>
              <Text style={[styles.exampleText, { color: colors.accent }]}>• 35000 salary</Text>
            </View>

            <TouchableOpacity
              style={[styles.primaryButton, { backgroundColor: colors.accent }]}
              onPress={handleParseWithAI}
              disabled={parsing}>
              {parsing ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.primaryButtonText}>Parse with AI</Text>
              )}
            </TouchableOpacity>

            {parsedData && (
              <View style={[styles.previewCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <Text style={[styles.previewTitle, { color: colors.text }]}>Parsed Result</Text>
                <View style={styles.previewRow}>
                  <Text style={[styles.previewLabel, { color: colors.subtext }]}>Note:</Text>
                  <Text style={[styles.previewValue, { color: colors.text }]}>{parsedData.note}</Text>
                </View>
                <View style={styles.previewRow}>
                  <Text style={[styles.previewLabel, { color: colors.subtext }]}>Amount:</Text>
                  <Text style={[styles.previewValue, { color: colors.text }]}>{formatAmount(parsedData.amount)}</Text>
                </View>
                <View style={styles.previewRow}>
                  <Text style={[styles.previewLabel, { color: colors.subtext }]}>Type:</Text>
                  <View style={[styles.typeBadge, { backgroundColor: getTypeColor(parsedData.type) }]}>
                    <Text style={styles.typeBadgeText}>{parsedData.type}</Text>
                  </View>
                </View>
                <View style={styles.previewRow}>
                  <Text style={[styles.previewLabel, { color: colors.subtext }]}>Category:</Text>
                  <Text style={[styles.previewValue, { color: colors.text }]}>{parsedData.category}</Text>
                </View>

                <TouchableOpacity
                  style={[styles.primaryButton, { backgroundColor: colors.accent }]}
                  onPress={handleConfirmAI}
                  disabled={saving}>
                  {saving ? (
                    <ActivityIndicator color="#fff" />
                  ) : (
                    <Text style={styles.primaryButtonText}>Confirm & Save</Text>
                  )}
                </TouchableOpacity>

                <TouchableOpacity style={[styles.secondaryButton, { borderColor: colors.accent }]} onPress={handleEditManually}>
                  <Text style={[styles.secondaryButtonText, { color: colors.accent }]}>Edit manually</Text>
                </TouchableOpacity>
              </View>
            )}
          </View>
        ) : (
          <View style={styles.content}>
            <Text style={[styles.label, { color: colors.subtext }]}>Amount</Text>
            <TextInput
              style={[styles.input, { backgroundColor: colors.card, borderColor: colors.border, color: colors.text }]}
              placeholder="0"
              placeholderTextColor={colors.subtext}
              value={amount}
              onChangeText={setAmount}
              keyboardType="numeric"
            />

            <Text style={[styles.label, { color: colors.subtext }]}>Note</Text>
            <TextInput
              style={[styles.input, { backgroundColor: colors.card, borderColor: colors.border, color: colors.text }]}
              placeholder="What's this for?"
              placeholderTextColor={colors.subtext}
              value={note}
              onChangeText={setNote}
            />

            <Text style={[styles.label, { color: colors.subtext }]}>Type</Text>
            <View style={styles.typePills}>
              <TouchableOpacity
                style={[
                  styles.typePill,
                  { backgroundColor: colors.card, borderColor: '#10b981' },
                  type === 'income' && { backgroundColor: colors.background },
                ]}
                onPress={() => setType('income')}>
                <Text style={[{ color: colors.subtext }, type === 'income' && { color: '#10b981' }]}>
                  Income
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[
                  styles.typePill,
                  { backgroundColor: colors.card, borderColor: '#ef4444' },
                  type === 'expense' && { backgroundColor: colors.background },
                ]}
                onPress={() => setType('expense')}>
                <Text style={[{ color: colors.subtext }, type === 'expense' && { color: '#ef4444' }]}>
                  Expense
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[
                  styles.typePill,
                  { backgroundColor: colors.card, borderColor: '#7c6af7' },
                  type === 'investment' && { backgroundColor: colors.background },
                ]}
                onPress={() => setType('investment')}>
                <Text style={[{ color: colors.subtext }, type === 'investment' && { color: '#7c6af7' }]}>
                  Investment
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[
                  styles.typePill,
                  { backgroundColor: colors.card, borderColor: '#f59e0b' },
                  type === 'emi' && { backgroundColor: colors.background },
                ]}
                onPress={() => setType('emi')}>
                <Text style={[{ color: colors.subtext }, type === 'emi' && { color: '#f59e0b' }]}>
                  EMI
                </Text>
              </TouchableOpacity>
            </View>

            <Text style={[styles.label, { color: colors.subtext }]}>Category (optional)</Text>
            <TextInput
              style={[styles.input, { backgroundColor: colors.card, borderColor: colors.border, color: colors.text }]}
              placeholder="e.g., Food, Transport, Salary"
              placeholderTextColor={colors.subtext}
              value={category}
              onChangeText={setCategory}
            />

            <TouchableOpacity
              style={[styles.primaryButton, { backgroundColor: colors.accent }]}
              onPress={handleSaveManual}
              disabled={saving}>
              {saving ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.primaryButtonText}>Save</Text>
              )}
            </TouchableOpacity>
          </View>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  scrollView: {
    flex: 1,
  },
  modeToggle: {
    flexDirection: 'row',
    margin: 20,
    borderRadius: 12,
    padding: 4,
  },
  modeButton: {
    flex: 1,
    paddingVertical: 12,
    alignItems: 'center',
    borderRadius: 8,
  },
  modeButtonTextActive: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  content: {
    padding: 20,
    paddingTop: 0,
  },
  label: {
    fontSize: 14,
    marginBottom: 8,
    marginTop: 16,
  },
  aiInput: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 16,
    fontSize: 16,
    minHeight: 100,
    textAlignVertical: 'top',
  },
  input: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    fontSize: 16,
  },
  examplesContainer: {
    marginTop: 16,
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
  },
  examplesTitle: {
    fontSize: 12,
    marginBottom: 8,
  },
  exampleText: {
    fontSize: 14,
    marginBottom: 4,
  },
  primaryButton: {
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
    marginTop: 24,
  },
  primaryButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  secondaryButton: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
    marginTop: 12,
  },
  secondaryButtonText: {
    fontSize: 16,
    fontWeight: '600',
  },
  previewCard: {
    marginTop: 24,
    padding: 20,
    borderRadius: 16,
    borderWidth: 1,
  },
  previewTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 16,
  },
  previewRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  previewLabel: {
    fontSize: 14,
  },
  previewValue: {
    fontSize: 16,
    fontWeight: '600',
  },
  typeBadge: {
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 12,
  },
  typeBadgeText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '600',
    textTransform: 'capitalize',
  },
  typePills: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  typePill: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 20,
    borderWidth: 2,
    fontSize: 14,
    fontWeight: '600',
  },
});
