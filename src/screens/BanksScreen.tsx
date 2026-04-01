import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  SafeAreaView,
  FlatList,
  Modal,
  ActivityIndicator,
  Alert,
  ScrollView,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Toast from 'react-native-toast-message';
import { getBankAccounts, addBankAccount, updateBankAccount, deleteBankAccount } from '../lib/bankDb';
import { getTransactions } from '../lib/db';
import { BankAccount, Transaction } from '../types';
import { useTheme } from '../context/ThemeContext';

export default function BanksScreen() {
  const { colors } = useTheme();
  const [banks, setBanks] = useState<BankAccount[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingBank, setEditingBank] = useState<BankAccount | null>(null);

  // Form state
  const [bankName, setBankName] = useState('');
  const [accountLast4, setAccountLast4] = useState('');
  const [accountType, setAccountType] = useState<'savings' | 'current' | 'credit_card' | 'loan'>('savings');
  const [startingBalance, setStartingBalance] = useState('');
  const [creditLimit, setCreditLimit] = useState('');
  const [loanTotal, setLoanTotal] = useState('');
  const [upiIds, setUpiIds] = useState<string[]>(['']);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    loadData();
  }, []);

  useFocusEffect(
    React.useCallback(() => {
      loadData();
    }, [])
  );

  const loadData = async () => {
    try {
      setLoading(true);
      const [banksData, transactionsData] = await Promise.all([
        getBankAccounts(),
        getTransactions(),
      ]);
      setBanks(banksData);
      setTransactions(transactionsData);
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

  const calculateCurrentBalance = (bank: BankAccount): number => {
    // Get all transactions for this bank
    const bankTxns = transactions.filter(t => {
      if (t.note.includes(`••${bank.account_last4}`)) return true;
      for (const upi of bank.upi_ids) {
        if (t.note.toLowerCase().includes(upi.toLowerCase())) return true;
      }
      return false;
    });

    const totalSpent = bankTxns
      .filter(t => t.type === 'expense' ||
        (t.type === 'transfer' && t.note.includes(`••${bank.account_last4} →`)))
      .reduce((sum, t) => sum + Number(t.amount), 0);

    const totalReceived = bankTxns
      .filter(t => t.type === 'income' ||
        (t.type === 'transfer' && t.note.includes(`→ ${bank.bank_name} ••${bank.account_last4}`)))
      .reduce((sum, t) => sum + Number(t.amount), 0);

    const totalEMI = bankTxns
      .filter(t => t.type === 'emi')
      .reduce((sum, t) => sum + Number(t.amount), 0);

    if (bank.account_type === 'savings' || bank.account_type === 'current') {
      return bank.starting_balance + totalReceived - totalSpent;
    }

    if (bank.account_type === 'credit_card') {
      // Available credit = limit - spent + payments received
      const used = totalSpent - totalReceived;
      return bank.credit_limit - used;
    }

    if (bank.account_type === 'loan') {
      // Remaining loan = total loan - EMI paid
      return bank.loan_total - totalEMI;
    }

    return bank.starting_balance;
  };

  const getOutstandingAmount = (bank: BankAccount): number => {
    if (bank.account_type !== 'credit_card') return 0;
    
    const bankTxns = transactions.filter(t => {
      if (t.note.includes(`••${bank.account_last4}`)) return true;
      for (const upi of bank.upi_ids) {
        if (t.note.toLowerCase().includes(upi.toLowerCase())) return true;
      }
      return false;
    });

    const totalSpent = bankTxns
      .filter(t => t.type === 'expense')
      .reduce((sum, t) => sum + Number(t.amount), 0);

    const totalReceived = bankTxns
      .filter(t => t.type === 'income')
      .reduce((sum, t) => sum + Number(t.amount), 0);

    return totalSpent - totalReceived;
  };

  const getEMIPaid = (bank: BankAccount): number => {
    if (bank.account_type !== 'loan') return 0;
    
    const bankTxns = transactions.filter(t => {
      if (t.note.includes(`••${bank.account_last4}`)) return true;
      for (const upi of bank.upi_ids) {
        if (t.note.toLowerCase().includes(upi.toLowerCase())) return true;
      }
      return false;
    });

    return bankTxns
      .filter(t => t.type === 'emi')
      .reduce((sum, t) => sum + Number(t.amount), 0);
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
    setCreditLimit(bank.credit_limit?.toString() || '0');
    setLoanTotal(bank.loan_total?.toString() || '0');
    setUpiIds(bank.upi_ids.length > 0 ? bank.upi_ids : ['']);
    setShowAddModal(true);
  };

  const handleDeleteBank = (bank: BankAccount) => {
    Alert.alert(
      'Delete Bank Account',
      `Delete ${bank.bank_name} ••${bank.account_last4}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              await deleteBankAccount(bank.id);
              Toast.show({
                type: 'success',
                text1: 'Deleted',
                text2: 'Bank account deleted successfully',
              });
              loadData();
            } catch (error) {
              Toast.show({
                type: 'error',
                text1: 'Error',
                text2: 'Failed to delete bank account',
              });
            }
          },
        },
      ]
    );
  };

  const resetForm = () => {
    setEditingBank(null);
    setBankName('');
    setAccountLast4('');
    setAccountType('savings');
    setStartingBalance('');
    setCreditLimit('');
    setLoanTotal('');
    setUpiIds(['']);
  };

  const addUpiIdField = () => {
    setUpiIds([...upiIds, '']);
  };

  const removeUpiIdField = (index: number) => {
    const updated = upiIds.filter((_, i) => i !== index);
    setUpiIds(updated.length > 0 ? updated : ['']);
  };

  const updateUpiId = (index: number, value: string) => {
    const updated = [...upiIds];
    updated[index] = value;
    setUpiIds(updated);
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
      const validUpiIds = upiIds.filter(id => id.trim().length > 0);

      if (editingBank) {
        await updateBankAccount(editingBank.id, {
          bank_name: bankName.trim(),
          account_last4: accountLast4.trim(),
          account_type: accountType,
          starting_balance: balance,
          credit_limit: limit,
          loan_total: loan,
          upi_ids: validUpiIds,
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
          upi_ids: validUpiIds,
        });
        Toast.show({
          type: 'success',
          text1: 'Added',
          text2: 'Bank account added successfully',
        });
      }

      // Clear UPI accounts cache
      await AsyncStorage.removeItem('user_upi_accounts');

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
    
    let iconName = 'bank';
    let iconColor = '#7c6af7';
    let balanceLabel = 'Current Balance';
    let balanceColor = currentBalance >= 0 ? '#10b981' : '#ef4444';
    
    if (accountType === 'credit_card') {
      iconName = 'credit-card';
      iconColor = '#a855f7';
      balanceLabel = 'Available Credit';
      balanceColor = '#10b981';
    } else if (accountType === 'loan') {
      iconName = 'cash-minus';
      iconColor = '#ef4444';
      balanceLabel = 'Remaining Loan';
      balanceColor = '#ef4444';
    }

    return (
      <View style={[styles.bankCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <View style={styles.bankHeader}>
          <View style={styles.bankInfo}>
            <View style={styles.bankNameRow}>
              <MaterialCommunityIcons name={iconName} size={20} color={iconColor} />
              <Text style={[styles.bankName, { color: colors.text }]}>{item.bank_name}</Text>
            </View>
            <Text style={[styles.accountNumber, { color: colors.subtext }]}>••{item.account_last4}</Text>
          </View>
          <View style={styles.bankActions}>
            <TouchableOpacity onPress={() => handleEditBank(item)} style={styles.actionButton}>
              <MaterialCommunityIcons name="pencil" size={20} color={colors.accent} />
            </TouchableOpacity>
            <TouchableOpacity onPress={() => handleDeleteBank(item)} style={styles.actionButton}>
              <MaterialCommunityIcons name="delete" size={20} color={colors.error} />
            </TouchableOpacity>
          </View>
        </View>

        <View style={styles.balanceSection}>
          {(accountType === 'savings' || accountType === 'current') && (
            <>
              <View style={styles.balanceRow}>
                <Text style={[styles.balanceLabel, { color: colors.subtext }]}>Starting Balance</Text>
                <Text style={[styles.startingBalance, { color: colors.subtext }]}>{formatAmount(item.starting_balance)}</Text>
              </View>
              <View style={styles.balanceRow}>
                <Text style={[styles.balanceLabel, { color: colors.subtext }]}>{balanceLabel}</Text>
                <Text style={[styles.currentBalance, { color: balanceColor }]}>
                  {formatAmount(currentBalance)}
                </Text>
              </View>
            </>
          )}
          
          {accountType === 'credit_card' && (
            <>
              <View style={styles.balanceRow}>
                <Text style={[styles.balanceLabel, { color: colors.subtext }]}>Credit Limit</Text>
                <Text style={[styles.startingBalance, { color: colors.subtext }]}>{formatAmount(item.credit_limit)}</Text>
              </View>
              <View style={styles.balanceRow}>
                <Text style={[styles.balanceLabel, { color: colors.subtext }]}>{balanceLabel}</Text>
                <Text style={[styles.currentBalance, { color: balanceColor }]}>
                  {formatAmount(currentBalance)}
                </Text>
              </View>
              <View style={styles.balanceRow}>
                <Text style={[styles.balanceLabel, { color: colors.subtext }]}>Outstanding</Text>
                <Text style={[styles.outstandingAmount, { color: colors.error }]}>
                  {formatAmount(getOutstandingAmount(item))}
                </Text>
              </View>
            </>
          )}
          
          {accountType === 'loan' && (
            <>
              <View style={styles.balanceRow}>
                <Text style={[styles.balanceLabel, { color: colors.subtext }]}>Total Loan</Text>
                <Text style={[styles.startingBalance, { color: colors.subtext }]}>{formatAmount(item.loan_total)}</Text>
              </View>
              <View style={styles.balanceRow}>
                <Text style={[styles.balanceLabel, { color: colors.subtext }]}>{balanceLabel}</Text>
                <Text style={[styles.currentBalance, { color: balanceColor }]}>
                  {formatAmount(currentBalance)}
                </Text>
              </View>
              <View style={styles.balanceRow}>
                <Text style={[styles.balanceLabel, { color: colors.subtext }]}>EMI Paid</Text>
                <Text style={[styles.emiPaidAmount, { color: colors.success }]}>
                  {formatAmount(getEMIPaid(item))}
                </Text>
              </View>
            </>
          )}
        </View>

        {item.upi_ids.length > 0 && (
          <View style={[styles.upiSection, { borderTopColor: colors.border }]}>
            <Text style={[styles.upiLabel, { color: colors.subtext }]}>Linked UPI IDs:</Text>
            <View style={styles.upiChips}>
              {item.upi_ids.map((upi, index) => (
                <View key={index} style={[styles.upiChip, { borderColor: colors.accent }]}>
                  <Text style={[styles.upiChipText, { color: colors.accent }]}>{upi}</Text>
                </View>
              ))}
            </View>
          </View>
        )}
      </View>
    );
  };

  if (loading) {
    return (
      <View style={[styles.loadingContainer, { backgroundColor: colors.background }]}>
        <ActivityIndicator size="large" color={colors.accent} />
      </View>
    );
  }

  const totalBalance = getTotalBalance();

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={styles.header}>
        <Text style={[styles.title, { color: colors.text }]}>My Banks</Text>
      </View>

      <View style={[styles.totalBalanceCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <Text style={[styles.totalBalanceLabel, { color: colors.subtext }]}>Total Balance</Text>
        <Text style={[
          styles.totalBalanceAmount,
          { color: totalBalance >= 0 ? colors.success : colors.error }
        ]}>
          {formatAmount(totalBalance)}
        </Text>
      </View>

      <FlatList
        data={banks}
        renderItem={renderBankCard}
        keyExtractor={item => item.id}
        contentContainerStyle={styles.listContent}
        ListEmptyComponent={
          <View style={styles.emptyState}>
            <MaterialCommunityIcons name="bank-off" size={64} color={colors.border} />
            <Text style={[styles.emptyText, { color: colors.subtext }]}>No bank accounts yet</Text>
            <Text style={[styles.emptySubtext, { color: colors.subtext }]}>Add your first bank account to track balances</Text>
          </View>
        }
      />

      <TouchableOpacity style={[styles.fab, { backgroundColor: colors.accent }]} onPress={handleAddBank}>
        <MaterialCommunityIcons name="plus" size={28} color="#fff" />
      </TouchableOpacity>

      {/* Add/Edit Bank Modal */}
      <Modal
        visible={showAddModal}
        animationType="slide"
        onRequestClose={() => {
          setShowAddModal(false);
          resetForm();
        }}>
        <SafeAreaView style={[styles.modalContainer, { backgroundColor: colors.background }]}>
          <View style={[styles.modalHeader, { borderBottomColor: colors.border }]}>
            <TouchableOpacity onPress={() => {
              setShowAddModal(false);
              resetForm();
            }}>
              <MaterialCommunityIcons name="close" size={24} color={colors.text} />
            </TouchableOpacity>
            <Text style={[styles.modalTitle, { color: colors.text }]}>
              {editingBank ? 'Edit Bank Account' : 'Add Bank Account'}
            </Text>
            <View style={{ width: 24 }} />
          </View>

          <ScrollView style={styles.modalContent}>
            <View style={styles.inputGroup}>
              <Text style={[styles.label, { color: colors.text }]}>Bank Name *</Text>
              <TextInput
                style={[styles.input, { backgroundColor: colors.card, borderColor: colors.border, color: colors.text }]}
                placeholder="e.g. Slice, Kotak, HDFC"
                placeholderTextColor={colors.subtext}
                value={bankName}
                onChangeText={setBankName}
              />
            </View>

            <View style={styles.inputGroup}>
              <Text style={[styles.label, { color: colors.text }]}>Account Type *</Text>
              <View style={styles.accountTypeSelector}>
                <TouchableOpacity
                  style={[styles.typeButton, { backgroundColor: colors.card, borderColor: colors.border }, accountType === 'savings' && { backgroundColor: colors.accent + '20', borderColor: colors.accent }]}
                  onPress={() => setAccountType('savings')}>
                  <Text style={[styles.typeButtonText, { color: colors.subtext }, accountType === 'savings' && { color: colors.accent }]}>
                    Savings
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.typeButton, { backgroundColor: colors.card, borderColor: colors.border }, accountType === 'current' && { backgroundColor: colors.accent + '20', borderColor: colors.accent }]}
                  onPress={() => setAccountType('current')}>
                  <Text style={[styles.typeButtonText, { color: colors.subtext }, accountType === 'current' && { color: colors.accent }]}>
                    Current
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.typeButton, { backgroundColor: colors.card, borderColor: colors.border }, accountType === 'credit_card' && { backgroundColor: colors.accent + '20', borderColor: colors.accent }]}
                  onPress={() => setAccountType('credit_card')}>
                  <Text style={[styles.typeButtonText, { color: colors.subtext }, accountType === 'credit_card' && { color: colors.accent }]}>
                    Credit Card
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.typeButton, { backgroundColor: colors.card, borderColor: colors.border }, accountType === 'loan' && { backgroundColor: colors.accent + '20', borderColor: colors.accent }]}
                  onPress={() => setAccountType('loan')}>
                  <Text style={[styles.typeButtonText, { color: colors.subtext }, accountType === 'loan' && { color: colors.accent }]}>
                    Loan/EMI
                  </Text>
                </TouchableOpacity>
              </View>
            </View>

            <View style={styles.inputGroup}>
              <Text style={[styles.label, { color: colors.text }]}>Account Last 4 Digits *</Text>
              <TextInput
                style={[styles.input, { backgroundColor: colors.card, borderColor: colors.border, color: colors.text }]}
                placeholder="e.g. 5235"
                placeholderTextColor={colors.subtext}
                value={accountLast4}
                onChangeText={setAccountLast4}
                keyboardType="numeric"
                maxLength={4}
              />
            </View>

            {(accountType === 'savings' || accountType === 'current') && (
              <View style={styles.inputGroup}>
                <Text style={[styles.label, { color: colors.text }]}>Starting Balance *</Text>
                <TextInput
                  style={[styles.input, { backgroundColor: colors.card, borderColor: colors.border, color: colors.text }]}
                  placeholder="e.g. 10000"
                  placeholderTextColor={colors.subtext}
                  value={startingBalance}
                  onChangeText={setStartingBalance}
                  keyboardType="numeric"
                />
              </View>
            )}

            {accountType === 'credit_card' && (
              <View style={styles.inputGroup}>
                <Text style={[styles.label, { color: colors.text }]}>Credit Limit *</Text>
                <TextInput
                  style={[styles.input, { backgroundColor: colors.card, borderColor: colors.border, color: colors.text }]}
                  placeholder="e.g. 50000"
                  placeholderTextColor={colors.subtext}
                  value={creditLimit}
                  onChangeText={setCreditLimit}
                  keyboardType="numeric"
                />
              </View>
            )}

            {accountType === 'loan' && (
              <View style={styles.inputGroup}>
                <Text style={[styles.label, { color: colors.text }]}>Total Loan Amount *</Text>
                <TextInput
                  style={[styles.input, { backgroundColor: colors.card, borderColor: colors.border, color: colors.text }]}
                  placeholder="e.g. 500000"
                  placeholderTextColor={colors.subtext}
                  value={loanTotal}
                  onChangeText={setLoanTotal}
                  keyboardType="numeric"
                />
              </View>
            )}

            <View style={styles.inputGroup}>
              <Text style={[styles.label, { color: colors.text }]}>UPI IDs (Optional)</Text>
              {upiIds.map((upi, index) => (
                <View key={index} style={styles.upiInputRow}>
                  <TextInput
                    style={[styles.input, styles.upiInput, { backgroundColor: colors.card, borderColor: colors.border, color: colors.text }]}
                    placeholder="e.g. username@okaxis"
                    placeholderTextColor={colors.subtext}
                    value={upi}
                    onChangeText={(value) => updateUpiId(index, value)}
                    autoCapitalize="none"
                  />
                  {upiIds.length > 1 && (
                    <TouchableOpacity onPress={() => removeUpiIdField(index)}>
                      <MaterialCommunityIcons name="close-circle" size={24} color={colors.error} />
                    </TouchableOpacity>
                  )}
                </View>
              ))}
              <TouchableOpacity style={styles.addUpiButton} onPress={addUpiIdField}>
                <MaterialCommunityIcons name="plus-circle" size={20} color={colors.accent} />
                <Text style={[styles.addUpiText, { color: colors.accent }]}>Add UPI ID</Text>
              </TouchableOpacity>
            </View>

            <TouchableOpacity
              style={[styles.saveButton, { backgroundColor: colors.accent }]}
              onPress={handleSave}
              disabled={saving}>
              {saving ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.saveButtonText}>
                  {editingBank ? 'Update Bank' : 'Add Bank'}
                </Text>
              )}
            </TouchableOpacity>
          </ScrollView>
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0a0a0f',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#0a0a0f',
  },
  header: {
    padding: 20,
    paddingTop: 16,
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#fff',
  },
  totalBalanceCard: {
    backgroundColor: '#1a1a26',
    marginHorizontal: 20,
    marginBottom: 20,
    padding: 24,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#2a2a3d',
    alignItems: 'center',
  },
  totalBalanceLabel: {
    fontSize: 14,
    color: '#999',
    marginBottom: 8,
  },
  totalBalanceAmount: {
    fontSize: 36,
    fontWeight: 'bold',
  },
  listContent: {
    padding: 20,
    paddingBottom: 100,
  },
  bankCard: {
    backgroundColor: '#1a1a26',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#2a2a3d',
    padding: 16,
    marginBottom: 12,
  },
  bankHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 16,
  },
  bankInfo: {
    flex: 1,
  },
  bankNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 4,
  },
  bankName: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#fff',
  },
  accountNumber: {
    fontSize: 14,
    color: '#999',
  },
  bankActions: {
    flexDirection: 'row',
    gap: 8,
  },
  actionButton: {
    padding: 4,
  },
  balanceSection: {
    marginBottom: 12,
  },
  balanceRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  balanceLabel: {
    fontSize: 12,
    color: '#999',
  },
  startingBalance: {
    fontSize: 14,
    color: '#999',
  },
  currentBalance: {
    fontSize: 20,
    fontWeight: 'bold',
  },
  outstandingAmount: {
    fontSize: 16,
    fontWeight: '600',
  },
  emiPaidAmount: {
    fontSize: 16,
    fontWeight: '600',
  },
  upiSection: {
    borderTopWidth: 1,
    borderTopColor: '#2a2a3d',
    paddingTop: 12,
  },
  upiLabel: {
    fontSize: 12,
    color: '#999',
    marginBottom: 8,
  },
  upiChips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  upiChip: {
    backgroundColor: '#7c6af720',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#7c6af7',
  },
  upiChipText: {
    fontSize: 12,
    color: '#7c6af7',
  },
  fab: {
    position: 'absolute',
    right: 20,
    bottom: 20,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: '#7c6af7',
    justifyContent: 'center',
    alignItems: 'center',
    elevation: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
  },
  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 60,
  },
  emptyText: {
    fontSize: 18,
    color: '#999',
    marginTop: 16,
    fontWeight: '600',
  },
  emptySubtext: {
    fontSize: 14,
    color: '#666',
    marginTop: 8,
    textAlign: 'center',
  },
  modalContainer: {
    flex: 1,
    backgroundColor: '#0a0a0f',
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#2a2a3d',
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#fff',
  },
  modalContent: {
    flex: 1,
    padding: 20,
  },
  inputGroup: {
    marginBottom: 20,
  },
  label: {
    fontSize: 14,
    color: '#fff',
    marginBottom: 8,
    fontWeight: '500',
  },
  input: {
    backgroundColor: '#1a1a26',
    borderWidth: 1,
    borderColor: '#2a2a3d',
    borderRadius: 10,
    padding: 12,
    color: '#fff',
    fontSize: 16,
  },
  upiInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 8,
  },
  upiInput: {
    flex: 1,
  },
  addUpiButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 8,
  },
  addUpiText: {
    color: '#7c6af7',
    fontSize: 14,
    fontWeight: '600',
  },
  saveButton: {
    backgroundColor: '#7c6af7',
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
  accountTypeSelector: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  typeButton: {
    flex: 1,
    minWidth: '45%',
    backgroundColor: '#1a1a26',
    borderWidth: 1,
    borderColor: '#2a2a3d',
    borderRadius: 8,
    paddingVertical: 12,
    paddingHorizontal: 16,
    alignItems: 'center',
  },
  typeButtonActive: {
    backgroundColor: '#7c6af720',
    borderColor: '#7c6af7',
  },
  typeButtonText: {
    color: '#999',
    fontSize: 14,
    fontWeight: '600',
  },
  typeButtonTextActive: {
    color: '#7c6af7',
  },
});
