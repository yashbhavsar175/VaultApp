// ═══════════════════════════════════════════════════════════════════════════════
// FINANCIAL SCREENS MODULE
// Consolidated: BanksScreen + AddCreditCard + AnalyticsScreen
// ═══════════════════════════════════════════════════════════════════════════════

import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  FlatList,
  Modal,
  ActivityIndicator,
  Alert,
  RefreshControl,
  InteractionManager,
  TextInput,
  ScrollView,
  Dimensions,
  Animated,
} from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';
import Toast from 'react-native-toast-message';
import { 
  getBankAccounts, 
  addBankAccount, 
  updateBankAccount, 
  deleteBankAccount,
  addCreditCard,
} from '../../lib/database/financial';
import { getTransactions } from '../../lib/core';
import { scheduleDueReminders } from '../../lib/services/scheduledNotifications';
import { BankAccount, Transaction } from '../../types';
import { useTheme } from '../../context/ThemeContext';
import { ScreenWrapper, Card, AppButton, AppInput, AppHeader, AppConfirmModal } from '../../components';
import { getBankColor, getBankSuggestions } from '../../config';
import { getCached, setCache, CACHE_KEYS } from '../../lib/services/cache';
import { formatCurrency as formatAmount } from '../../utils/format';
import { BarChart, PieChart } from 'react-native-gifted-charts';

// ═══════════════════════════════════════════════════════════════════════════════
// BANKS SCREEN
// ═══════════════════════════════════════════════════════════════════════════════

export function BanksScreen() {
  const { colors, typography, spacing, borderRadius } = useTheme();
  const [banks, setBanks] = useState<BankAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingBank, setEditingBank] = useState<BankAccount | null>(null);
  const [confirmDialog, setConfirmDialog] = useState<{
    visible: boolean;
    title: string;
    message: string;
    confirmText?: string;
    isDestructive: boolean;
    onConfirm: () => void;
  } | null>(null);

  // Form state
  const [bankName, setBankName] = useState('');
  const [accountLast4, setAccountLast4] = useState('');
  const [accountType, setAccountType] = useState<'savings' | 'current' | 'credit_card' | 'loan'>('savings');
  const [startingBalance, setStartingBalance] = useState('');
  const [currentBalance, setCurrentBalance] = useState('');
  const [creditLimit, setCreditLimit] = useState('');
  const [loanTotal, setLoanTotal] = useState('');
  const [saving, setSaving] = useState(false);
  
  // Autocomplete state
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);

  useEffect(() => {
    loadData();
  }, []);

  useFocusEffect(
    useCallback(() => {
      const task = InteractionManager.runAfterInteractions(() => {
        loadData();
      });
      return () => task.cancel();
    }, [])
  );

  const lastDataStringRef = useRef<string | null>(null);

  const loadData = async () => {
    try {
      // Show cached data instantly
      const cached = await getCached<BankAccount[]>(CACHE_KEYS.BANK_ACCOUNTS);
      if (cached?.data && cached.data.length > 0) {
        const cachedStr = JSON.stringify(cached.data);
        if (lastDataStringRef.current !== cachedStr) {
          lastDataStringRef.current = cachedStr;
          setBanks(cached.data);
        }
        setLoading(false);
        
        // Skip network call if cache is fresh
        if (!cached.isStale) return;
      }

      // Then fetch fresh from cloud
      const banksData = await getBankAccounts();
      const dataStr = JSON.stringify(banksData);
      
      if (lastDataStringRef.current !== dataStr) {
        lastDataStringRef.current = dataStr;
        setBanks(banksData);
      }
      setCache(CACHE_KEYS.BANK_ACCOUNTS, banksData);
    } catch (error) {
      console.error('Error loading data:', error);
      Toast.show({
        type: 'error',
        text1: 'Error',
        text2: 'Failed to load bank accounts',
      });
    } finally {
      setLoading(false);
    }
  };

  const onRefresh = async () => {
    try {
      setRefreshing(true);
      const banksData = await getBankAccounts();
      const dataStr = JSON.stringify(banksData);
      lastDataStringRef.current = dataStr;
      setBanks(banksData);
      Toast.show({
        type: 'success',
        text1: 'Refreshed',
        text2: 'Bank balances updated',
      });
    } catch (error) {
      console.error('Error refreshing data:', error);
      Toast.show({
        type: 'error',
        text1: 'Error',
        text2: 'Failed to refresh',
      });
    } finally {
      setRefreshing(false);
    }
  };

  const calculateCurrentBalance = (bank: BankAccount): number => {
    return bank.balance || bank.starting_balance;
  };

  const getTotalBalance = (): number => {
    return banks.reduce((sum, bank) => sum + calculateCurrentBalance(bank), 0);
  };

  const handleAddBank = () => {
    resetForm();
    setShowAddModal(true);
  };

  const handleEditBank = (bank: BankAccount) => {
    setEditingBank(bank);
    setBankName(bank.bank_name);
    setAccountLast4(bank.account_last4);
    setAccountType(bank.account_type || 'savings');
    setStartingBalance(bank.starting_balance.toString());
    setCurrentBalance((bank.balance || bank.starting_balance).toString());
    setCreditLimit(bank.credit_limit?.toString() || '0');
    setLoanTotal(bank.loan_total?.toString() || '0');
    setShowAddModal(true);
  };

  const handleDeleteBank = (bank: BankAccount) => {
    setConfirmDialog({
      visible: true,
      title: 'Delete Bank Account',
      message: `Delete ${bank.bank_name} ••${bank.account_last4}?`,
      confirmText: 'Delete',
      isDestructive: true,
      onConfirm: async () => {
        setConfirmDialog(null);
        setBanks(prev => prev.filter(b => b.id !== bank.id));
        
        try {
          await deleteBankAccount(bank.id);
          Toast.show({
            type: 'success',
            text1: 'Deleted',
            text2: 'Bank account deleted successfully',
          });
          loadData();
        } catch (error) {
          loadData();
          Toast.show({
            type: 'error',
            text1: 'Error',
            text2: 'Failed to delete bank account',
          });
        }
      }
    });
  };

  const resetForm = () => {
    setEditingBank(null);
    setBankName('');
    setAccountLast4('');
    setAccountType('savings');
    setStartingBalance('');
    setCurrentBalance('');
    setCreditLimit('');
    setLoanTotal('');
    setSuggestions([]);
    setShowSuggestions(false);
  };

  const handleBankNameChange = (text: string) => {
    setBankName(text);
    if (text.length >= 1) {
      const newSuggestions = getBankSuggestions(text);
      setSuggestions(newSuggestions);
      setShowSuggestions(newSuggestions.length > 0);
    } else {
      setSuggestions([]);
      setShowSuggestions(false);
    }
  };

  const handleSelectSuggestion = (suggestion: string) => {
    setBankName(suggestion);
    setShowSuggestions(false);
    setSuggestions([]);
  };

  const handleSave = async () => {
    if (!bankName.trim()) {
      Toast.show({
        type: 'error',
        text1: 'Required',
        text2: 'Please enter bank name',
      });
      return;
    }

    if (!accountLast4.trim() || accountLast4.length !== 4) {
      Toast.show({
        type: 'error',
        text1: 'Invalid',
        text2: 'Account last 4 digits must be exactly 4 numbers',
      });
      return;
    }

    const balance = parseFloat(startingBalance || '0');
    if (isNaN(balance)) {
      Toast.show({
        type: 'error',
        text1: 'Invalid',
        text2: 'Please enter a valid starting balance',
      });
      return;
    }

    const current = parseFloat(currentBalance || '0');
    if (editingBank && isNaN(current)) {
      Toast.show({
        type: 'error',
        text1: 'Invalid',
        text2: 'Please enter a valid current balance',
      });
      return;
    }

    const limit = parseFloat(creditLimit || '0');
    if (accountType === 'credit_card' && (isNaN(limit) || limit <= 0)) {
      Toast.show({
        type: 'error',
        text1: 'Invalid',
        text2: 'Please enter a valid credit limit',
      });
      return;
    }

    const loan = parseFloat(loanTotal || '0');
    if (accountType === 'loan' && (isNaN(loan) || loan <= 0)) {
      Toast.show({
        type: 'error',
        text1: 'Invalid',
        text2: 'Please enter a valid loan amount',
      });
      return;
    }

    setSaving(true);
    try {
      if (editingBank) {
        await updateBankAccount(editingBank.id, {
          bank_name: bankName.trim(),
          account_last4: accountLast4.trim(),
          account_type: accountType,
          starting_balance: balance,
          balance: current,
          credit_limit: limit,
          loan_total: loan,
          upi_ids: [],
        });
        Toast.show({
          type: 'success',
          text1: 'Updated',
          text2: 'Bank account updated successfully',
        });
      } else {
        await addBankAccount({
          bank_name: bankName.trim(),
          account_last4: accountLast4.trim(),
          account_type: accountType,
          starting_balance: balance,
          credit_limit: limit,
          loan_total: loan,
          upi_ids: [],
        });
        Toast.show({
          type: 'success',
          text1: 'Added',
          text2: 'Bank account added successfully',
        });
      }

      setShowAddModal(false);
      resetForm();
      loadData();
    } catch (error) {
      Toast.show({
        type: 'error',
        text1: 'Error',
        text2: 'Failed to save bank account',
      });
    } finally {
      setSaving(false);
    }
  };

  const renderBankCard = ({ item }: { item: BankAccount }) => {
    const currentBalance = calculateCurrentBalance(item);
    const accountType = item.account_type || 'savings';
    const bankColor = getBankColor(item.bank_name);
    
    let balanceColor = currentBalance >= 0 ? '#10b981' : '#ef4444';
    
    if (accountType === 'credit_card') {
      balanceColor = '#10b981';
    } else if (accountType === 'loan') {
      balanceColor = '#ef4444';
    }

    return (
      <Card style={{ marginBottom: spacing.md, padding: spacing.md }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', flex: 1 }}>
            <View style={{ 
              width: 40, 
              height: 40, 
              borderRadius: 20, 
              backgroundColor: bankColor,
              justifyContent: 'center',
              alignItems: 'center',
              marginRight: spacing.md,
            }}>
              <Text style={{ color: '#fff', fontSize: 16, fontWeight: 'bold' }}>
                {item.bank_name.charAt(0).toUpperCase()}
              </Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[typography.body, { color: colors.text, fontWeight: '600' }]}>
                {item.bank_name}
              </Text>
              <Text style={[typography.caption, { color: colors.subtext, fontSize: 12 }]}>
                ••{item.account_last4}
              </Text>
            </View>
          </View>

          <View style={{ alignItems: 'flex-end' }}>
            <Text style={[typography.h3, { color: balanceColor, fontSize: 18, fontWeight: '700' }]}>
              {formatAmount(currentBalance)}
            </Text>
            <View style={{ flexDirection: 'row', marginTop: spacing.xs }}>
              <TouchableOpacity onPress={() => handleEditBank(item)} style={{ padding: 4 }}>
                <MaterialCommunityIcons name="pencil" size={18} color={colors.accent} />
              </TouchableOpacity>
              <TouchableOpacity onPress={() => handleDeleteBank(item)} style={{ padding: 4, marginLeft: spacing.xs }}>
                <MaterialCommunityIcons name="delete" size={18} color={colors.error} />
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Card>
    );
  };

  const totalBalance = getTotalBalance();

  return (
    <ScreenWrapper>
      <AppHeader 
        title="Banks"
        showBack={true}
        rightAction={{
          icon: "plus",
          onPress: handleAddBank
        }}
      />
      
      <Card style={{ margin: spacing.lg, padding: spacing.lg, alignItems: 'center' }}>
        <Text style={[typography.caption, { color: colors.subtext, marginBottom: spacing.sm }]}>Total Balance</Text>
        <Text style={[
          typography.h1,
          { color: totalBalance >= 0 ? colors.success : colors.error }
        ]}>
          {formatAmount(totalBalance)}
        </Text>
      </Card>

      <FlatList
        data={banks}
        renderItem={renderBankCard}
        keyExtractor={item => item.id}
        contentContainerStyle={{ padding: spacing.lg, paddingTop: 0 }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            colors={[colors.accent]}
            tintColor={colors.accent}
          />
        }
        ListEmptyComponent={() => {
          if (loading) {
            return (
              <View>
                {[1, 2, 3].map((key) => (
                  <Card key={key} style={{ marginBottom: spacing.md, padding: spacing.md, opacity: 0.8 - (key * 0.15) }}>
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', flex: 1 }}>
                        <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: colors.border, marginRight: spacing.md }} />
                        <View style={{ flex: 1 }}>
                          <View style={{ height: 14, backgroundColor: colors.border, borderRadius: 4, width: '60%', marginBottom: 6 }} />
                          <View style={{ height: 10, backgroundColor: colors.border, borderRadius: 4, width: '40%' }} />
                        </View>
                      </View>
                      <View style={{ alignItems: 'flex-end', width: 80 }}>
                        <View style={{ height: 18, backgroundColor: colors.border, borderRadius: 4, width: '100%', marginBottom: 6 }} />
                        <View style={{ height: 18, backgroundColor: colors.border, borderRadius: 4, width: '50%' }} />
                      </View>
                    </View>
                  </Card>
                ))}
              </View>
            );
          }
          return (
            <View style={styles.emptyState}>
              <MaterialCommunityIcons name="bank-off" size={64} color={colors.border} />
              <Text style={[typography.h3, { color: colors.subtext, marginTop: spacing.md }]}>No bank accounts yet</Text>
              <Text style={[typography.caption, { color: colors.subtext, marginTop: spacing.sm, textAlign: 'center' }]}>Add your first bank account to track balances</Text>
            </View>
          );
        }}
      />

      {/* Add/Edit Bank Modal */}
      <Modal
        visible={showAddModal}
        animationType="slide"
        onRequestClose={() => {
          setShowAddModal(false);
          resetForm();
        }}>
        <View style={[styles.modalContainer, { backgroundColor: colors.background }]}>
          <View style={[styles.modalHeader, { borderBottomColor: colors.border, padding: spacing.md }]}>
            <TouchableOpacity onPress={() => {
              setShowAddModal(false);
              resetForm();
            }}>
              <MaterialCommunityIcons name="close" size={24} color={colors.text} />
            </TouchableOpacity>
            <Text style={[typography.h2, { color: colors.text }]}>
              {editingBank ? 'Edit Bank Account' : 'Add Bank Account'}
            </Text>
            <View style={{ width: 24 }} />
          </View>

          <ScreenWrapper scrollable>
            <View style={{ padding: spacing.lg }}>
              <View style={{ position: 'relative', zIndex: 10 }}>
                <AppInput
                  label="Bank Name *"
                  placeholder="e.g. Slice, Kotak, HDFC"
                  value={bankName}
                  onChangeText={handleBankNameChange}
                />
                
                {showSuggestions && suggestions.length > 0 && (
                  <Card style={{ 
                    position: 'absolute', 
                    top: '100%', 
                    left: 0, 
                    right: 0, 
                    marginTop: 4,
                    maxHeight: 200,
                    padding: 0,
                  }}>
                    {suggestions.map((suggestion, index) => {
                      const suggestionColor = getBankColor(suggestion);
                      return (
                        <TouchableOpacity
                          key={index}
                          style={{
                            flexDirection: 'row',
                            alignItems: 'center',
                            padding: spacing.md,
                            borderBottomWidth: index < suggestions.length - 1 ? 1 : 0,
                            borderBottomColor: colors.border,
                          }}
                          onPress={() => handleSelectSuggestion(suggestion)}>
                          <View style={{
                            width: 20,
                            height: 20,
                            borderRadius: 10,
                            backgroundColor: suggestionColor,
                            marginRight: spacing.sm,
                            justifyContent: 'center',
                            alignItems: 'center',
                          }}>
                            <Text style={{ color: '#fff', fontSize: 10, fontWeight: 'bold' }}>
                              {suggestion.charAt(0).toUpperCase()}
                            </Text>
                          </View>
                          <Text style={[typography.body, { color: colors.text }]}>
                            {suggestion}
                          </Text>
                        </TouchableOpacity>
                      );
                    })}
                  </Card>
                )}
              </View>

              <Text style={[typography.caption, { color: colors.text, marginBottom: spacing.sm, marginTop: spacing.md }]}>Account Type *</Text>
              <View style={styles.accountTypeSelector}>
                <TouchableOpacity
                  style={[styles.typeButton, { backgroundColor: colors.card, borderColor: colors.border, borderRadius: borderRadius.sm }, accountType === 'savings' && { backgroundColor: colors.accent + '20', borderColor: colors.accent }]}
                  onPress={() => setAccountType('savings')}>
                  <Text style={[typography.caption, { color: colors.subtext }, accountType === 'savings' && { color: colors.accent }]}>
                    Savings
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.typeButton, { backgroundColor: colors.card, borderColor: colors.border, borderRadius: borderRadius.sm }, accountType === 'current' && { backgroundColor: colors.accent + '20', borderColor: colors.accent }]}
                  onPress={() => setAccountType('current')}>
                  <Text style={[typography.caption, { color: colors.subtext }, accountType === 'current' && { color: colors.accent }]}>
                    Current
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.typeButton, { backgroundColor: colors.card, borderColor: colors.border, borderRadius: borderRadius.sm }, accountType === 'credit_card' && { backgroundColor: colors.accent + '20', borderColor: colors.accent }]}
                  onPress={() => setAccountType('credit_card')}>
                  <Text style={[typography.caption, { color: colors.subtext }, accountType === 'credit_card' && { color: colors.accent }]}>
                    Credit Card
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.typeButton, { backgroundColor: colors.card, borderColor: colors.border, borderRadius: borderRadius.sm }, accountType === 'loan' && { backgroundColor: colors.accent + '20', borderColor: colors.accent }]}
                  onPress={() => setAccountType('loan')}>
                  <Text style={[typography.caption, { color: colors.subtext }, accountType === 'loan' && { color: colors.accent }]}>
                    Loan/EMI
                  </Text>
                </TouchableOpacity>
              </View>

              <AppInput
                label="Account Last 4 Digits *"
                placeholder="e.g. 5235"
                value={accountLast4}
                onChangeText={setAccountLast4}
                keyboardType="numeric"
                maxLength={4}
              />

              {(accountType === 'savings' || accountType === 'current') && (
                <>
                  {!editingBank && (
                    <AppInput
                      label="Starting Balance *"
                      placeholder="e.g. 10000"
                      value={startingBalance}
                      onChangeText={setStartingBalance}
                      keyboardType="numeric"
                    />
                  )}
                  {editingBank && (
                    <>
                      <AppInput
                        label="Current Balance *"
                        placeholder="e.g. 10000"
                        value={currentBalance}
                        onChangeText={setCurrentBalance}
                        keyboardType="numeric"
                      />
                      <Text style={[typography.caption, { color: colors.subtext, marginTop: -spacing.sm, marginBottom: spacing.md }]}>
                        Sync this with your actual bank balance
                      </Text>
                    </>
                  )}
                </>
              )}

              {accountType === 'credit_card' && (
                <>
                  <AppInput
                    label="Credit Limit *"
                    placeholder="e.g. 50000"
                    value={creditLimit}
                    onChangeText={setCreditLimit}
                    keyboardType="numeric"
                  />
                  {editingBank && (
                    <>
                      <AppInput
                        label="Current Balance *"
                        placeholder="e.g. 5000"
                        value={currentBalance}
                        onChangeText={setCurrentBalance}
                        keyboardType="numeric"
                      />
                      <Text style={[typography.caption, { color: colors.subtext, marginTop: -spacing.sm, marginBottom: spacing.md }]}>
                        Current outstanding amount on your card
                      </Text>
                    </>
                  )}
                </>
              )}

              {accountType === 'loan' && (
                <>
                  <AppInput
                    label="Total Loan Amount *"
                    placeholder="e.g. 500000"
                    value={loanTotal}
                    onChangeText={setLoanTotal}
                    keyboardType="numeric"
                  />
                  {editingBank && (
                    <>
                      <AppInput
                        label="Current Outstanding *"
                        placeholder="e.g. 450000"
                        value={currentBalance}
                        onChangeText={setCurrentBalance}
                        keyboardType="numeric"
                      />
                      <Text style={[typography.caption, { color: colors.subtext, marginTop: -spacing.sm, marginBottom: spacing.md }]}>
                        Remaining loan amount to be paid
                      </Text>
                    </>
                  )}
                </>
              )}

              <AppButton
                title={editingBank ? 'Update Bank' : 'Add Bank'}
                onPress={handleSave}
                loading={saving}
                fullWidth
                style={{ marginTop: spacing.xl }}
              />
            </View>
          </ScreenWrapper>
        </View>
        <Toast />
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
    </ScreenWrapper>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// ADD CREDIT CARD SCREEN
// ═══════════════════════════════════════════════════════════════════════════════

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

export function AddCreditCardScreen() {
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

// ═══════════════════════════════════════════════════════════════════════════════
// ANALYTICS SCREEN
// ═══════════════════════════════════════════════════════════════════════════════

type TimeRange = 'week' | 'month' | '3months' | 'year';

interface CategoryData {
  name: string;
  amount: number;
  color: string;
  percentage: number;
}

export function AnalyticsScreen() {
  const { colors, typography, spacing, borderRadius } = useTheme();
  const [timeRange, setTimeRange] = useState<TimeRange>('month');
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);
  const lastDataStringRef = useRef<string | null>(null);

  // Fade animation: plays every time timeRange changes
  const fadeAnim = useRef(new Animated.Value(1)).current;
  const fadeIn = () => {
    fadeAnim.setValue(0);
    Animated.timing(fadeAnim, { toValue: 1, duration: 400, useNativeDriver: true }).start();
  };

  const handleTimeRangeChange = (range: TimeRange) => {
    setTimeRange(range);
    fadeIn();
  };

  useFocusEffect(
    React.useCallback(() => {
      const task = InteractionManager.runAfterInteractions(() => {
        loadData();
      });
      return () => task.cancel();
    }, [timeRange])
  );

  const loadData = async () => {
    setLoading(true);
    try {
      const data = await getTransactions();
      const filtered = filterByTimeRange(data, timeRange);
      const dataStr = JSON.stringify(filtered);
      
      if (lastDataStringRef.current !== dataStr) {
        lastDataStringRef.current = dataStr;
        setTransactions(filtered);
      }
    } catch (error) {
      console.error('Error loading analytics data:', error);
    } finally {
      setLoading(false);
    }
  };

  const filterByTimeRange = (data: Transaction[], range: TimeRange): Transaction[] => {
    const now = new Date();
    const startDate = new Date();

    switch (range) {
      case 'week':
        startDate.setDate(now.getDate() - 7);
        break;
      case 'month':
        startDate.setMonth(now.getMonth() - 1);
        break;
      case '3months':
        startDate.setMonth(now.getMonth() - 3);
        break;
      case 'year':
        startDate.setFullYear(now.getFullYear() - 1);
        break;
    }

    return data.filter(t => new Date(t.created_at) >= startDate);
  };

  // Calculate summary
  const totalSpent = transactions
    .filter(t => t.type === 'expense')
    .reduce((sum, t) => sum + Number(t.amount), 0);

  const totalIncome = transactions
    .filter(t => t.type === 'income')
    .reduce((sum, t) => sum + Number(t.amount), 0);

  const totalInvestment = transactions
    .filter(t => t.type === 'investment')
    .reduce((sum, t) => sum + Number(t.amount), 0);

  const totalEMI = transactions
    .filter(t => t.type === 'emi')
    .reduce((sum, t) => sum + Number(t.amount), 0);

  const netSavings = totalIncome - totalSpent - totalInvestment - totalEMI;

  // Group by category for chart
  const categoryData: { [key: string]: number } = {};
  transactions
    .filter(t => t.type === 'expense')
    .forEach(t => {
      const cat = t.category || 'Uncategorized';
      categoryData[cat] = (categoryData[cat] || 0) + Number(t.amount);
    });

  const CHART_COLORS = ['#ef4444', '#f59e0b', '#10b981', '#3b82f6', '#8b5cf6', '#ec4899', '#06b6d4', '#f97316'];

  const categoryChartData: CategoryData[] = Object.entries(categoryData)
    .sort(([, a], [, b]) => b - a)
    .map(([name, amount], index) => ({
      name,
      amount,
      color: CHART_COLORS[index % CHART_COLORS.length],
      percentage: totalSpent > 0 ? (amount / totalSpent) * 100 : 0,
    }));

  // Smart Insights: dynamic text-based insight about spending
  const getSmartInsight = (): string => {
    if (transactions.length === 0) return 'Add some transactions to see your spending insights.';
    if (categoryChartData.length === 0) return 'No expense data for this period. You\'re doing great! 🎉';
    const top = categoryChartData[0];
    const savingsRate = totalIncome > 0 ? ((netSavings / totalIncome) * 100).toFixed(0) : '0';
    const savingsEmoji = netSavings >= 0 ? '📈' : '⚠️';
    return `Your highest spending is in **${top.name}**, representing ${top.percentage.toFixed(0)}% of expenses (${formatAmount(top.amount)}). ${savingsEmoji} Savings rate: ${savingsRate}% this period.`;
  };

  // Daily spending data for bar chart
  const getDailyData = () => {
    const dailyExpense: { [key: string]: number } = {};
    const dailyIncome: { [key: string]: number } = {};

    transactions.forEach(t => {
      const date = new Date(t.created_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
      if (t.type === 'expense') {
        dailyExpense[date] = (dailyExpense[date] || 0) + Number(t.amount);
      } else if (t.type === 'income') {
        dailyIncome[date] = (dailyIncome[date] || 0) + Number(t.amount);
      }
    });

    const allDates = Array.from(new Set([...Object.keys(dailyExpense), ...Object.keys(dailyIncome)])).slice(-7);
    const maxAmount = Math.max(
      ...allDates.map(date => Math.max(dailyExpense[date] || 0, dailyIncome[date] || 0)),
      1
    );

    return {
      labels: allDates,
      expense: allDates.map(date => dailyExpense[date] || 0),
      income: allDates.map(date => dailyIncome[date] || 0),
      maxAmount,
    };
  };

  // Top categories (kept for list)
  const topCategories = Object.entries(categoryData)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 5)
    .map(([name, amount]) => ({
      name,
      amount,
      percentage: totalSpent > 0 ? (amount / totalSpent) * 100 : 0,
    }));

  const barData = getDailyData();

  // gifted-charts BarChart data (depends on barData)
  const barChartData = barData.labels.flatMap((label, i) => ([
    {
      value: barData.expense[i],
      label,
      frontColor: '#EAB308',
      labelTextStyle: { color: colors.subtext as string, fontSize: 9 },
    },
    {
      value: barData.income[i],
      frontColor: '#64748B',
      labelTextStyle: { color: colors.subtext as string, fontSize: 9 },
    },
  ]));

  const screenWidth = Dimensions.get('window').width - spacing.lg * 2 - 32;

  // gifted-charts PieChart data
  const pieData = categoryChartData.map((item) => ({
    value: item.percentage,
    color: item.color,
    text: item.percentage > 8 ? `${item.percentage.toFixed(0)}%` : '',
  }));

  return (
    <ScreenWrapper scrollable>
      <AppHeader title="Analytics" showBackButton />

      <View style={{ padding: spacing.lg }}>
        {/* Time Range Selector */}
        <Card style={{ padding: spacing.xs, marginBottom: spacing.lg }}>
          <View style={styles.timeRangeContainer}>
            {(['week', 'month', '3months', 'year'] as TimeRange[]).map((range) => (
              <TouchableOpacity
                key={range}
                style={[
                  styles.timeRangeButton,
                  { borderRadius: borderRadius.sm },
                  timeRange === range && { backgroundColor: '#EAB308' }, // vivid yellow active
                ]}
                onPress={() => handleTimeRangeChange(range)}
              >
                <Text
                  style={[
                    typography.caption,
                    { color: colors.subtext },
                    timeRange === range && { color: '#1a1a1a', fontWeight: '700' },
                  ]}
                >
                  {range === '3months' ? '3 Months' : range.charAt(0).toUpperCase() + range.slice(1)}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </Card>

        <Animated.View style={{ opacity: fadeAnim }}>

        {/* Smart Insights Card */}
        <Card style={{
          padding: spacing.lg,
          marginBottom: spacing.lg,
          borderLeftWidth: 4,
          borderLeftColor: '#EAB308',
          backgroundColor: colors.card,
        }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: spacing.sm }}>
            <MaterialCommunityIcons name="lightbulb-on" size={20} color="#EAB308" />
            <Text style={[typography.bodyBold, { color: '#EAB308', marginLeft: 6, fontSize: 13 }]}>
              Smart Insight
            </Text>
          </View>
          <Text style={[typography.body, { color: colors.text, lineHeight: 22, fontSize: 14 }]}>
            {getSmartInsight()}
          </Text>
        </Card>

        {/* Summary Cards */}
        <View style={styles.summaryRow}>
          <Card style={[styles.summaryCard, { borderLeftWidth: 4, borderLeftColor: '#ef4444' }]}>
            <Text style={[typography.caption, { color: colors.subtext, marginBottom: spacing.xs }]}>
              Total Spent
            </Text>
            <Text style={[typography.h3, { color: '#ef4444', fontSize: 18 }]}>
              {formatAmount(totalSpent)}
            </Text>
          </Card>

          <Card style={[styles.summaryCard, { borderLeftWidth: 4, borderLeftColor: '#64748B' }]}>
            <Text style={[typography.caption, { color: colors.subtext, marginBottom: spacing.xs }]}>
              Total Income
            </Text>
            <Text style={[typography.h3, { color: '#64748B', fontSize: 18 }]}>
              {formatAmount(totalIncome)}
            </Text>
          </Card>

          <Card style={[styles.summaryCard, { borderLeftWidth: 4, borderLeftColor: '#EAB308' }]}>
            <Text style={[typography.caption, { color: colors.subtext, marginBottom: spacing.xs }]}>
              Net Savings
            </Text>
            <Text style={[typography.h3, { color: netSavings >= 0 ? '#EAB308' : '#ef4444', fontSize: 18 }]}>
              {formatAmount(netSavings)}
            </Text>
          </Card>
        </View>

        {/* Donut Chart - Spending by Category (gifted-charts PieChart) */}
        {categoryChartData.length > 0 ? (
          <Card style={{ padding: spacing.lg, marginBottom: spacing.lg, alignItems: 'center' }}>
            <Text style={[typography.h3, { color: colors.text, marginBottom: spacing.md, alignSelf: 'flex-start' }]}>
              Where your money goes
            </Text>
            <PieChart
              donut
              data={pieData}
              radius={90}
              innerRadius={56}
              innerCircleColor={colors.card}
              centerLabelComponent={() => (
                <View style={{ alignItems: 'center' }}>
                  <Text style={[typography.caption, { color: colors.subtext, fontSize: 10 }]}>Total</Text>
                  <Text style={[typography.bodyBold, { color: colors.text, fontSize: 14 }]}>
                    {formatAmount(totalSpent)}
                  </Text>
                </View>
              )}
            />
            {/* Legend */}
            <View style={{ marginTop: spacing.md, width: '100%' }}>
              {categoryChartData.map((item, index) => (
                <View key={index} style={styles.legendRow}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', flex: 1 }}>
                    <View style={[styles.legendDot, { backgroundColor: item.color }]} />
                    <Text style={[typography.body, { color: colors.text }]}>{item.name}</Text>
                  </View>
                  <Text style={[typography.body, { color: colors.text }]}>{formatAmount(item.amount)}</Text>
                  <Text style={[typography.caption, { color: colors.subtext, marginLeft: spacing.sm, minWidth: 40, textAlign: 'right' }]}>
                    {item.percentage.toFixed(0)}%
                  </Text>
                </View>
              ))}
            </View>
          </Card>
        ) : (
          <Card style={{ padding: spacing.lg, marginBottom: spacing.lg, alignItems: 'center' }}>
            <Text style={[typography.h3, { color: colors.text, marginBottom: spacing.sm }]}>
              Where your money goes
            </Text>
            <Text style={[typography.body, { color: colors.subtext }]}>No expense data available</Text>
          </Card>
        )}

        {/* Bar Chart - Daily Spending (gifted-charts BarChart) */}
        {barChartData.length > 0 ? (
          <Card style={{ padding: spacing.lg, marginBottom: spacing.lg }}>
            <Text style={[typography.h3, { color: colors.text, marginBottom: spacing.md }]}>
              Daily spending trend
            </Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              <BarChart
                data={barChartData}
                barWidth={16}
                spacing={4}
                roundedTop
                hideRules
                xAxisColor={colors.border}
                yAxisColor={colors.border}
                yAxisTextStyle={{ color: colors.subtext, fontSize: 9 }}
                noOfSections={4}
                maxValue={barData.maxAmount}
                isAnimated
                animationDuration={500}
                barBorderRadius={3}
                width={Math.max(screenWidth, barChartData.length * 22)}
              />
            </ScrollView>
            {/* Legend */}
            <View style={{ flexDirection: 'row', justifyContent: 'center', marginTop: spacing.md, gap: 16 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <View style={[styles.legendDot, { backgroundColor: '#EAB308' }]} />
                <Text style={[typography.caption, { color: colors.text }]}>Expense</Text>
              </View>
              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <View style={[styles.legendDot, { backgroundColor: '#64748B' }]} />
                <Text style={[typography.caption, { color: colors.text }]}>Income</Text>
              </View>
            </View>
          </Card>
        ) : (
          <Card style={{ padding: spacing.lg, marginBottom: spacing.lg, alignItems: 'center' }}>
            <Text style={[typography.h3, { color: colors.text, marginBottom: spacing.sm }]}>
              Daily spending trend
            </Text>
            <Text style={[typography.body, { color: colors.subtext }]}>No transaction data available</Text>
          </Card>
        )}

        {/* Top Categories List */}
        {topCategories.length > 0 && (
          <Card style={{ padding: spacing.lg }}>
            <Text style={[typography.h3, { color: colors.text, marginBottom: spacing.md }]}>
              Top spending categories
            </Text>
            {topCategories.map((cat, index) => (
              <View key={index} style={styles.topCategoryRow}>
                <View
                  style={[
                    styles.rankBadge,
                    { backgroundColor: CHART_COLORS[index % CHART_COLORS.length] + '20', borderRadius: borderRadius.sm },
                  ]}
                >
                  <Text style={[typography.bodyBold, { color: CHART_COLORS[index % CHART_COLORS.length] }]}>
                    {index + 1}
                  </Text>
                </View>
                <View style={{ flex: 1, marginLeft: spacing.md }}>
                  <Text style={[typography.body, { color: colors.text, marginBottom: spacing.xs }]}>
                    {cat.name}
                  </Text>
                  <View style={[styles.progressBar, { backgroundColor: colors.border, borderRadius: borderRadius.sm }]}>
                    <View
                      style={[
                        styles.progressFill,
                        {
                          width: `${cat.percentage}%`,
                          backgroundColor: CHART_COLORS[index % CHART_COLORS.length],
                          borderRadius: borderRadius.sm,
                        },
                      ]}
                    />
                  </View>
                </View>
                <Text style={[typography.bodyBold, { color: colors.text, marginLeft: spacing.md }]}>
                  {formatAmount(cat.amount)}
                </Text>
              </View>
            ))}
          </Card>
        )}
        </Animated.View>
      </View>
    </ScreenWrapper>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// STYLES
// ═══════════════════════════════════════════════════════════════════════════════

const styles = StyleSheet.create({
  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 60,
  },
  modalContainer: {
    flex: 1,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottomWidth: 1,
  },
  accountTypeSelector: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  typeButton: {
    flex: 1,
    minWidth: '45%',
    borderWidth: 1,
    paddingVertical: 12,
    paddingHorizontal: 16,
    alignItems: 'center',
  },
  input: {
    borderWidth: 1,
  },
  pickerItem: {
    borderBottomWidth: 1,
  },
  timeRangeContainer: {
    flexDirection: 'row',
    padding: 4,
  },
  timeRangeButton: {
    flex: 1,
    paddingVertical: 10,
    alignItems: 'center',
  },
  summaryRow: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 16,
  },
  summaryCard: {
    flex: 1,
    padding: 12,
  },
  legendRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  legendDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 8,
  },
  topCategoryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
  },
  rankBadge: {
    width: 32,
    height: 32,
    justifyContent: 'center',
    alignItems: 'center',
  },
  progressBar: {
    height: 6,
    width: '100%',
  },
  progressFill: {
    height: '100%',
  },
});