import React, { useState, useEffect, useCallback } from 'react';
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
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';
import Toast from 'react-native-toast-message';
import { getBankAccounts, addBankAccount, updateBankAccount, deleteBankAccount } from '../lib/bankDb';
import { BankAccount } from '../types';
import { useTheme } from '../context/ThemeContext';
import { ScreenWrapper, Card, AppButton, AppInput, AppHeader } from '../components';
import AppConfirmModal from '../components/ui/AppConfirmModal';
import { getBankColor, getBankSuggestions } from '../constants/bankLogos';

export default function BanksScreen() {
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

  const loadData = async () => {
    try {
      setLoading(true);
      const banksData = await getBankAccounts();
      setBanks(banksData);
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
    // Use the balance field from the database which is updated by background tasks
    return bank.balance || bank.starting_balance;
  };



  const getTotalBalance = (): number => {
    return banks.reduce((sum, bank) => sum + calculateCurrentBalance(bank), 0);
  };

  const formatAmount = (amount: number) => {
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: 'INR',
      maximumFractionDigits: 0,
    }).format(amount);
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
        // Dismiss dialog immediately for a faster feel
        setConfirmDialog(null);
        
        // Optimistic UI Update: Remove from list instantly
        setBanks(prev => prev.filter(b => b.id !== bank.id));
        
        try {
          await deleteBankAccount(bank.id);
          Toast.show({
            type: 'success',
            text1: 'Deleted',
            text2: 'Bank account deleted successfully',
          });
          // Background sync
          loadData();
        } catch (error) {
          // Revert optimistic update on failure
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
          {/* Left: Icon + Bank Info */}
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

          {/* Right: Balance + Actions */}
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

  // Removed early return for loading to prevent header flash

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
                
                {/* Autocomplete Suggestions */}
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

const styles = StyleSheet.create({
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  bankHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  bankInfo: {
    flex: 1,
  },
  bankNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  bankActions: {
    flexDirection: 'row',
    gap: 8,
  },
  balanceRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
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
});
