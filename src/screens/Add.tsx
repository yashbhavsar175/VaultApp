import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  Modal,
  KeyboardAvoidingView,
  Platform,
  TouchableWithoutFeedback,
  Keyboard,
} from 'react-native';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Toast from 'react-native-toast-message';
import { addTransaction, getUniqueCategories } from '../lib/db';
import { parseTransactionWithAI } from '../lib/aiParser';
import { TransactionType, BankAccount } from '../types';
import { useTheme } from '../context/ThemeContext';
import { ScreenWrapper, Card, AppButton, AppHeader } from '../components';
import { getBankAccounts, updateBankAccount } from '../lib/bankDb';
import { getBankColor } from '../constants/bankLogos';
import { supabase } from '../lib/supabase';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';

const TYPE_OPTIONS = [
  { value: 'income', label: 'Income', icon: 'arrow-down-circle', color: '#10b981' },
  { value: 'expense', label: 'Expense', icon: 'arrow-up-circle', color: '#ef4444' },
  { value: 'investment', label: 'Investment', icon: 'chart-line', color: '#7c3aed' },
  { value: 'emi', label: 'EMI', icon: 'credit-card', color: '#f59e0b' },
  { value: 'lent', label: 'Lent', icon: 'account-arrow-right', color: '#06b6d4' },
];

type Mode = 'ai' | 'manual';

interface ParsedData {
  amount: number;
  note: string;
  type: TransactionType;
  category: string;
}

export default function Add() {
  const navigation = useNavigation();
  const { colors, typography, spacing, borderRadius } = useTheme();
  const [mode, setMode] = useState<Mode>('manual');
  
  // AI Mode state
  const [aiInput, setAiInput] = useState('');
  const [parsing, setParsing] = useState(false);
  const [parsedData, setParsedData] = useState<ParsedData | null>(null);
  
  // Manual Mode state
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [type, setType] = useState<TransactionType>('expense');
  const [selectedType, setSelectedType] = useState<TransactionType | null>('expense');
  const [category, setCategory] = useState('');
  const [saving, setSaving] = useState(false);
  
  // Account selector state
  const [banks, setBanks] = useState<BankAccount[]>([]);
  const [selectedAccount, setSelectedAccount] = useState<string>('cash');
  const [loadingBanks, setLoadingBanks] = useState(false);
  const [isInitialBankLoad, setIsInitialBankLoad] = useState(true);
  
  // Validation errors
  const [errors, setErrors] = useState<Record<string, boolean>>({});
  
  // Category autocomplete
  const [savedCategories, setSavedCategories] = useState<string[]>([]);
  const [categorySuggestions, setCategorySuggestions] = useState<string[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  
  // Modal states
  const [showTypeModal, setShowTypeModal] = useState(false);
  const [showAccountModal, setShowAccountModal] = useState(false);

  useEffect(() => {
    loadBanks();
  }, []);

  useFocusEffect(
    React.useCallback(() => {
      if (isInitialBankLoad) {
        // First time: show loader
        loadBanks();
        setIsInitialBankLoad(false);
      } else {
        // Subsequent visits: load silently
        loadBanksSilently();
      }
      loadSavedCategories();
    }, [isInitialBankLoad])
  );

  const loadSavedCategories = async () => {
    try {
      // Load from database instead of AsyncStorage for consistency
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        const categories = await getUniqueCategories(user.id);
        setSavedCategories(categories);
      }
    } catch (error) {
      console.error('Error loading saved categories:', error);
    }
  };

  const handleCategoryChange = (text: string) => {
    setCategory(text);
    
    if (text.trim()) {
      const filtered = savedCategories.filter(cat => 
        cat.toLowerCase().includes(text.toLowerCase())
      ).slice(0, 5);
      setCategorySuggestions(filtered);
      setShowSuggestions(filtered.length > 0);
    } else {
      // Show all categories when field is empty
      setCategorySuggestions(savedCategories.slice(0, 5));
      setShowSuggestions(savedCategories.length > 0);
    }
  };

  const selectCategory = (cat: string) => {
    setCategory(cat);
    setShowSuggestions(false);
    Keyboard.dismiss();
  };

  const getSelectedTypeOption = () => {
    return TYPE_OPTIONS.find(opt => opt.value === selectedType);
  };

  const getSelectedAccountLabel = () => {
    if (selectedAccount === 'cash') return '💵 Cash';
    const bank = banks.find(b => b.id === selectedAccount);
    return bank ? `${bank.bank_name} ••${bank.account_last4}` : 'Select account...';
  };

  const loadBanks = async () => {
    setLoadingBanks(true);
    try {
      const bankAccounts = await getBankAccounts();
      setBanks(bankAccounts);
    } catch (error) {
      console.error('Error loading banks:', error);
      Toast.show({
        type: 'error',
        text1: 'Error',
        text2: 'Failed to load bank accounts',
      });
    } finally {
      setLoadingBanks(false);
    }
  };

  const loadBanksSilently = async () => {
    // Load banks in background without showing loader
    try {
      const bankAccounts = await getBankAccounts();
      setBanks(bankAccounts);
    } catch (error) {
      console.error('Error loading banks:', error);
    }
  };

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
      
      // Auto-fill the manual form with parsed data
      setAmount(result.amount.toString());
      setNote(result.note);
      setType(result.type);
      setSelectedType(result.type);
      setCategory(result.category);
      
      // Switch to manual mode for review and account selection
      setMode('manual');
      setAiInput('');
      
      Toast.show({
        type: 'success',
        text1: 'Parsed Successfully',
        text2: 'Please select an account and save',
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

  const handleSaveManual = async () => {
    // Dismiss keyboard first
    Keyboard.dismiss();
    
    // Reset errors
    setErrors({});
    
    // Validate amount
    if (!amount || amount === '0' || amount === '') {
      setErrors({ amount: true });
      Toast.show({
        type: 'error',
        text1: 'Amount Required',
        text2: 'Please enter a valid amount',
      });
      return;
    }
    
    if (parseFloat(amount) <= 0) {
      setErrors({ amount: true });
      Toast.show({
        type: 'error',
        text1: 'Invalid Amount',
        text2: 'Amount must be greater than 0',
      });
      return;
    }
    
    // Validate note
    if (!note.trim()) {
      setErrors({ note: true });
      Toast.show({
        type: 'error',
        text1: 'Note Required',
        text2: 'Please describe what this transaction is for',
      });
      return;
    }
    
    // Validate type
    if (!selectedType) {
      setErrors({ type: true });
      Toast.show({
        type: 'error',
        text1: 'Type Required',
        text2: 'Please select transaction type (Income, Expense, etc.)',
      });
      return;
    }
    
    // Validate account
    if (!selectedAccount) {
      setErrors({ account: true });
      Toast.show({
        type: 'error',
        text1: 'Account Required',
        text2: 'Please select Cash or a bank account',
      });
      return;
    }

    setSaving(true);
    try {
      const transactionAmount = parseFloat(amount);
      
      // Save transaction
      await addTransaction({
        amount: transactionAmount,
        note,
        type: selectedType,
        category: category || (selectedType === 'lent' ? 'Unknown' : 'general'),
      });

      // Reload categories to include the newly added one
      await loadSavedCategories();

      // Update bank balance if bank is selected (not cash)
      if (selectedAccount !== 'cash') {
        const selectedBank = banks.find(b => b.id === selectedAccount);
        if (selectedBank) {
          let newBalance = selectedBank.balance || selectedBank.starting_balance;
          
          // Debit transactions: subtract from balance
          if (selectedType === 'expense' || selectedType === 'emi' || selectedType === 'investment' || selectedType === 'lent') {
            newBalance -= transactionAmount;
          }
          // Credit transactions: add to balance
          else if (selectedType === 'income') {
            newBalance += transactionAmount;
          }
          
          await updateBankAccount(selectedBank.id, {
            balance: newBalance,
          });
        }
      }

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
    setAmount('');
    setNote('');
    setType('expense');
    setSelectedType('expense');
    setCategory('');
    setSelectedAccount('cash');
    setErrors({});
    setShowSuggestions(false);
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
      case 'lent':
        return '#06b6d4';
      case 'borrowed':
        return '#ec4899';
      default:
        return '#7c3aed';
    }
  };

  return (
    <ScreenWrapper scrollable keyboardAvoiding>
      <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
        <View style={{ flex: 1 }}>
          <AppHeader title="Add Transaction" />
      
      <Card style={{ margin: spacing.lg, padding: spacing.xs }}>
        <View style={styles.modeToggle}>
          <TouchableOpacity
            style={[styles.modeButton, { borderRadius: borderRadius.sm }, mode === 'ai' && { backgroundColor: colors.accent }]}
            onPress={() => setMode('ai')}>
            <Text style={[typography.caption, { color: colors.subtext }, mode === 'ai' && { color: '#fff' }]}>
              AI Mode
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.modeButton, { borderRadius: borderRadius.sm }, mode === 'manual' && { backgroundColor: colors.accent }]}
            onPress={() => setMode('manual')}>
            <Text style={[typography.caption, { color: colors.subtext }, mode === 'manual' && { color: '#fff' }]}>
              Manual Mode
            </Text>
          </TouchableOpacity>
        </View>
      </Card>

      {mode === 'ai' ? (
        <View style={{ padding: spacing.lg, paddingTop: 0 }}>
          <Text style={[typography.caption, { color: colors.subtext, marginBottom: spacing.sm }]}>Describe your transaction</Text>
          <TextInput
            style={[styles.aiInput, { backgroundColor: colors.card, borderColor: colors.border, color: colors.text, borderRadius: borderRadius.md, padding: spacing.md }]}
            placeholder="e.g., 200 rs petrol"
            placeholderTextColor={colors.subtext}
            value={aiInput}
            onChangeText={setAiInput}
            multiline
          />

          <Card style={{ marginTop: spacing.md, padding: spacing.md }}>
            <Text style={[typography.caption, { color: colors.subtext, marginBottom: spacing.sm }]}>Examples:</Text>
            <Text style={[typography.caption, { color: colors.accent }]}>• 200 rs petrol</Text>
            <Text style={[typography.caption, { color: colors.accent }]}>• 5000 SIP Zerodha</Text>
            <Text style={[typography.caption, { color: colors.accent }]}>• 35000 salary</Text>
          </Card>

          <AppButton
            title="Parse with AI"
            onPress={handleParseWithAI}
            loading={parsing}
            fullWidth
            style={{ marginTop: spacing.lg }}
          />
        </View>
      ) : (
        <ScrollView 
          style={{ flex: 1 }}
          contentContainerStyle={{ padding: spacing.lg, paddingTop: 0 }}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <Text style={[typography.caption, { color: colors.subtext, marginBottom: spacing.sm, marginTop: spacing.md }]}>
            Amount <Text style={{ color: colors.error }}>*</Text>
          </Text>
          <TextInput
            style={[
              styles.input, 
              { 
                backgroundColor: colors.card, 
                borderColor: errors.amount ? colors.error : colors.border, 
                color: colors.text, 
                borderRadius: borderRadius.md, 
                padding: spacing.md,
                borderWidth: errors.amount ? 2 : 1,
              }
            ]}
            placeholder="0"
            placeholderTextColor={colors.subtext}
            value={amount}
            onChangeText={(text) => {
              setAmount(text);
              if (errors.amount) {
                setErrors({ ...errors, amount: false });
              }
            }}
            onFocus={() => {
              setShowSuggestions(false); // Hide category suggestions
            }}
            keyboardType="numeric"
          />

          <Text style={[typography.caption, { color: colors.subtext, marginBottom: spacing.sm, marginTop: spacing.md }]}>
            Note <Text style={{ color: colors.error }}>*</Text>
          </Text>
          <TextInput
            style={[
              styles.input, 
              { 
                backgroundColor: colors.card, 
                borderColor: errors.note ? colors.error : colors.border, 
                color: colors.text, 
                borderRadius: borderRadius.md, 
                padding: spacing.md,
                borderWidth: errors.note ? 2 : 1,
              }
            ]}
            placeholder="What's this for?"
            placeholderTextColor={colors.subtext}
            value={note}
            onChangeText={(text) => {
              setNote(text);
              if (errors.note) {
                setErrors({ ...errors, note: false });
              }
            }}
            onFocus={() => {
              setShowSuggestions(false); // Hide category suggestions
            }}
          />

          <Text style={[typography.caption, { color: colors.subtext, marginBottom: spacing.sm, marginTop: spacing.md }]}>
            Type <Text style={{ color: colors.error }}>*</Text>
          </Text>
          <TouchableOpacity
            style={[
              styles.dropdownButton,
              {
                backgroundColor: colors.card,
                borderColor: errors.type ? colors.error : (getSelectedTypeOption()?.color || colors.border),
                borderRadius: borderRadius.md,
                padding: spacing.md,
                borderWidth: errors.type ? 2 : 1,
              }
            ]}
            onPress={() => {
              Keyboard.dismiss();
              setShowTypeModal(true);
              if (errors.type) {
                setErrors({ ...errors, type: false });
              }
            }}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', flex: 1 }}>
              {getSelectedTypeOption() ? (
                <>
                  <MaterialCommunityIcons 
                    name={getSelectedTypeOption()!.icon as any} 
                    size={20} 
                    color={getSelectedTypeOption()!.color} 
                  />
                  <Text style={[typography.body, { color: colors.text, marginLeft: spacing.sm }]}>
                    {getSelectedTypeOption()!.label}
                  </Text>
                </>
              ) : (
                <Text style={[typography.body, { color: colors.subtext }]}>
                  Select type...
                </Text>
              )}
            </View>
            <MaterialCommunityIcons name="chevron-down" size={20} color={colors.subtext} />
          </TouchableOpacity>

          <Text style={[typography.caption, { color: colors.subtext, marginBottom: spacing.sm, marginTop: spacing.md }]}>
            Category (optional)
          </Text>
          <View style={{ position: 'relative', zIndex: 999 }}>
            <TextInput
              style={[styles.input, { backgroundColor: colors.card, borderColor: colors.border, color: colors.text, borderRadius: borderRadius.md, padding: spacing.md }]}
              placeholder={selectedType === 'lent' ? "Person name (e.g., Rahul, Priya)" : "Enter or select category"}
              placeholderTextColor={colors.subtext}
              value={category}
              onChangeText={handleCategoryChange}
              onFocus={() => {
                // Show suggestions on focus (either filtered or all)
                if (category.trim()) {
                  const filtered = savedCategories.filter(cat => 
                    cat.toLowerCase().includes(category.toLowerCase())
                  ).slice(0, 5);
                  setCategorySuggestions(filtered);
                  setShowSuggestions(filtered.length > 0);
                } else {
                  setCategorySuggestions(savedCategories.slice(0, 5));
                  setShowSuggestions(savedCategories.length > 0);
                }
              }}
            />
            
            {showSuggestions && categorySuggestions.length > 0 && (
              <View style={{
                position: 'absolute',
                top: 50,
                left: 0,
                right: 0,
                maxHeight: 200,
                zIndex: 9999,
                backgroundColor: colors.card,
                borderRadius: borderRadius.md,
                borderWidth: 1,
                borderColor: colors.border,
                elevation: 5,
                shadowColor: '#000',
                shadowOffset: { width: 0, height: 2 },
                shadowOpacity: 0.25,
                shadowRadius: 3.84,
                overflow: 'hidden',
              }}>
                <ScrollView showsVerticalScrollIndicator={false}>
                  {categorySuggestions.map((cat, index) => (
                    <TouchableOpacity
                      key={index}
                      style={{
                        paddingHorizontal: 16,
                        paddingVertical: 14,
                        flexDirection: 'row',
                        alignItems: 'center',
                        borderBottomWidth: index < categorySuggestions.length - 1 ? 1 : 0,
                        borderBottomColor: colors.border,
                      }}
                      activeOpacity={0.7}
                      onPress={() => selectCategory(cat)}
                    >
                      <View style={{
                        width: 32,
                        height: 32,
                        borderRadius: 16,
                        backgroundColor: colors.accent + '20',
                        justifyContent: 'center',
                        alignItems: 'center',
                        marginRight: 10,
                      }}>
                        <Text style={{ fontSize: 16 }}>🏷️</Text>
                      </View>
                      <Text style={{
                        flex: 1,
                        fontSize: 15,
                        color: colors.text,
                      }}>
                        {cat}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>
              </View>
            )}
          </View>

          <Text style={[typography.caption, { color: colors.subtext, marginBottom: spacing.sm, marginTop: spacing.md }]}>
            {selectedType === 'income' ? 'Received in' : selectedType === 'lent' ? 'Lent from' : 'Paid from'} <Text style={{ color: colors.error }}>*</Text>
          </Text>
          
          {loadingBanks ? (
            <View style={{ paddingVertical: spacing.md, alignItems: 'center' }}>
              <ActivityIndicator size="small" color={colors.accent} />
            </View>
          ) : (
            <TouchableOpacity
              style={[
                styles.dropdownButton,
                {
                  backgroundColor: colors.card,
                  borderColor: errors.account ? colors.error : colors.border,
                  borderRadius: borderRadius.md,
                  padding: spacing.md,
                  borderWidth: errors.account ? 2 : 1,
                }
              ]}
              onPress={() => {
                Keyboard.dismiss();
                setShowSuggestions(false); // Hide category suggestions
                setShowAccountModal(true);
                if (errors.account) {
                  setErrors({ ...errors, account: false });
                }
              }}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center', flex: 1 }}>
                {selectedAccount === 'cash' ? (
                  <Text style={[typography.body, { color: colors.text }]}>
                    💵 Cash
                  </Text>
                ) : (
                  <>
                    {banks.find(b => b.id === selectedAccount) && (
                      <>
                        <View style={{
                          width: 20,
                          height: 20,
                          borderRadius: 10,
                          backgroundColor: getBankColor(banks.find(b => b.id === selectedAccount)!.bank_name),
                          justifyContent: 'center',
                          alignItems: 'center',
                          marginRight: spacing.sm,
                        }}>
                          <Text style={{ color: '#fff', fontSize: 10, fontWeight: 'bold' }}>
                            {banks.find(b => b.id === selectedAccount)!.bank_name.charAt(0).toUpperCase()}
                          </Text>
                        </View>
                        <Text style={[typography.body, { color: colors.text }]}>
                          {getSelectedAccountLabel()}
                        </Text>
                      </>
                    )}
                  </>
                )}
              </View>
              <MaterialCommunityIcons name="chevron-down" size={20} color={colors.subtext} />
            </TouchableOpacity>
          )}

          <AppButton
            title="Save"
            onPress={handleSaveManual}
            loading={saving}
            fullWidth
            style={{ marginTop: spacing.lg }}
          />
        </ScrollView>
      )}

      {/* Type Selection Modal */}
      <Modal
        visible={showTypeModal}
        transparent
        animationType="slide"
        onRequestClose={() => setShowTypeModal(false)}
      >
        <TouchableOpacity 
          style={styles.modalOverlay}
          activeOpacity={1}
          onPress={() => setShowTypeModal(false)}
        >
          <View style={[styles.modalContent, { backgroundColor: colors.card }]}>
            <View style={[styles.modalHeader, { borderBottomColor: colors.border }]}>
              <Text style={[typography.h3, { color: colors.text }]}>Select Type</Text>
              <TouchableOpacity onPress={() => setShowTypeModal(false)}>
                <MaterialCommunityIcons name="close" size={24} color={colors.subtext} />
              </TouchableOpacity>
            </View>
            <ScrollView>
              {TYPE_OPTIONS.map((option, index) => (
                <TouchableOpacity
                  key={option.value}
                  style={[
                    styles.modalOption,
                    { borderBottomColor: colors.border },
                    index === TYPE_OPTIONS.length - 1 && { borderBottomWidth: 0 }
                  ]}
                  onPress={() => {
                    setSelectedType(option.value as TransactionType);
                    setType(option.value as TransactionType);
                    setShowTypeModal(false);
                    if (errors.type) {
                      setErrors({ ...errors, type: false });
                    }
                  }}
                >
                  <View style={{ flexDirection: 'row', alignItems: 'center', flex: 1 }}>
                    <MaterialCommunityIcons 
                      name={option.icon as any} 
                      size={24} 
                      color={option.color} 
                    />
                    <Text style={[typography.body, { color: colors.text, marginLeft: spacing.md }]}>
                      {option.label}
                    </Text>
                  </View>
                  {selectedType === option.value && (
                    <MaterialCommunityIcons name="check" size={24} color={colors.accent} />
                  )}
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        </TouchableOpacity>
      </Modal>

      {/* Account Selection Modal */}
      <Modal
        visible={showAccountModal}
        transparent
        animationType="slide"
        onRequestClose={() => setShowAccountModal(false)}
      >
        <TouchableOpacity 
          style={styles.modalOverlay}
          activeOpacity={1}
          onPress={() => setShowAccountModal(false)}
        >
          <View style={[styles.modalContent, { backgroundColor: colors.card }]}>
            <View style={[styles.modalHeader, { borderBottomColor: colors.border }]}>
              <Text style={[typography.h3, { color: colors.text }]}>Select Account</Text>
              <TouchableOpacity onPress={() => setShowAccountModal(false)}>
                <MaterialCommunityIcons name="close" size={24} color={colors.subtext} />
              </TouchableOpacity>
            </View>
            <ScrollView>
              <TouchableOpacity
                style={[styles.modalOption, { borderBottomColor: colors.border }]}
                onPress={() => {
                  setSelectedAccount('cash');
                  setShowAccountModal(false);
                  if (errors.account) {
                    setErrors({ ...errors, account: false });
                  }
                }}
              >
                <Text style={[typography.body, { color: colors.text, flex: 1 }]}>
                  💵 Cash
                </Text>
                {selectedAccount === 'cash' && (
                  <MaterialCommunityIcons name="check" size={24} color={colors.accent} />
                )}
              </TouchableOpacity>

              {banks.map((bank, index) => {
                const bankColor = getBankColor(bank.bank_name);
                
                return (
                  <TouchableOpacity
                    key={bank.id}
                    style={[
                      styles.modalOption,
                      { borderBottomColor: colors.border },
                      index === banks.length - 1 && { borderBottomWidth: 0 }
                    ]}
                    onPress={() => {
                      setSelectedAccount(bank.id);
                      setShowAccountModal(false);
                      if (errors.account) {
                        setErrors({ ...errors, account: false });
                      }
                    }}
                  >
                    <View style={{ flexDirection: 'row', alignItems: 'center', flex: 1 }}>
                      <View style={{
                        width: 24,
                        height: 24,
                        borderRadius: 12,
                        backgroundColor: bankColor,
                        justifyContent: 'center',
                        alignItems: 'center',
                        marginRight: spacing.md,
                      }}>
                        <Text style={{ color: '#fff', fontSize: 12, fontWeight: 'bold' }}>
                          {bank.bank_name.charAt(0).toUpperCase()}
                        </Text>
                      </View>
                      <Text style={[typography.body, { color: colors.text }]}>
                        {bank.bank_name} ••{bank.account_last4}
                      </Text>
                    </View>
                    {selectedAccount === bank.id && (
                      <MaterialCommunityIcons name="check" size={24} color={colors.accent} />
                    )}
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          </View>
        </TouchableOpacity>
      </Modal>
        </View>
      </TouchableWithoutFeedback>
    </ScreenWrapper>
  );
}

const styles = StyleSheet.create({
  modeToggle: {
    flexDirection: 'row',
    padding: 4,
  },
  modeButton: {
    flex: 1,
    paddingVertical: 12,
    alignItems: 'center',
  },
  aiInput: {
    borderWidth: 1,
    minHeight: 100,
    textAlignVertical: 'top',
  },
  input: {
    borderWidth: 1,
  },
  previewRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  typeBadge: {
    paddingHorizontal: 12,
    paddingVertical: 4,
  },
  dropdownButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: '70%',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    borderBottomWidth: 1,
  },
  modalOption: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    minHeight: 52,
    borderBottomWidth: 1,
  },
});
