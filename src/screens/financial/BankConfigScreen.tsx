import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Modal,
  Alert,
  InteractionManager,
} from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';
import Toast from 'react-native-toast-message';
import { useTheme } from '../../context/ThemeContext';
import { ScreenWrapper, AppHeader, Card } from '../../components';
import BalanceCorrectionModal, { BalanceCorrectionKindOption } from '../../components/BalanceCorrectionModal';
import { getBankAccounts, addBankAccount, updateBankAccount, deleteBankAccount } from '../../lib/database/financial';
import { getAllBankNames } from '../../lib/services/smsParser';
import { getCached, setCache, CACHE_KEYS } from '../../lib/services/cache';
import { financeDataChangedAffects, subscribeFinanceDataChanged } from '../../lib/services/dataEvents';
import {
  BankAccountBalanceView,
  getAccountBalanceViewModels,
  getBalanceConfidenceLabel,
  getBalanceSourceLabel,
  getPendingDetectedBalanceSummary,
  PendingDetectedBalanceSummary,
} from '../../lib/services/balanceViewModel';
import { BalanceKind, BalanceOwnerType, BankAccount } from '../../types';

type AccountType = BankAccount['account_type'];
type ManualCorrectionOwnerType = Extract<BalanceOwnerType, 'bank_account' | 'credit_card' | 'loan'>;

interface CorrectionTarget {
  ownerType: ManualCorrectionOwnerType;
  ownerId: string;
  ownerDisplayName: string;
  accountLast4?: string | null;
  cardLast4?: string | null;
  detectedBankName?: string | null;
  kindOptions: BalanceCorrectionKindOption[];
  defaultKind: BalanceKind;
}

const emptyPendingDetectedSummary: PendingDetectedBalanceSummary = {
  total: 0,
  bank_account: 0,
  credit_card: 0,
  debit_card: 0,
  loan: 0,
};

function formatBalanceUpdatedAt(lastUpdated: string | null): string {
  if (!lastUpdated) return 'Calculated balance';

  const updatedAt = new Date(lastUpdated).getTime();
  if (!Number.isFinite(updatedAt)) return 'Updated recently';

  const diffMs = Date.now() - updatedAt;
  if (diffMs < 60 * 1000) return 'Just now';
  const days = Math.floor(diffMs / (24 * 60 * 60 * 1000));
  if (days <= 0) return 'Updated today';
  if (days === 1) return 'Updated 1 day ago';
  return `Updated ${days} days ago`;
}

const bankCorrectionKinds: BalanceCorrectionKindOption[] = [
  { kind: 'available_balance', label: 'Available' },
  { kind: 'current_balance', label: 'Current' },
];

const creditCardCorrectionKinds: BalanceCorrectionKindOption[] = [
  { kind: 'outstanding', label: 'Outstanding' },
  { kind: 'available_limit', label: 'Available Limit' },
  { kind: 'credit_limit', label: 'Credit Limit' },
  { kind: 'due_amount', label: 'Due Amount' },
  { kind: 'minimum_due', label: 'Minimum Due' },
];

const loanCorrectionKinds: BalanceCorrectionKindOption[] = [
  { kind: 'loan_outstanding', label: 'Loan Outstanding' },
];

function correctionTargetForAccount(account: BankAccount): CorrectionTarget {
  if (account.account_type === 'loan') {
    return {
      ownerType: 'loan',
      ownerId: account.id,
      ownerDisplayName: `${account.bank_name} loan •••• ${account.account_last4}`,
      accountLast4: account.account_last4,
      detectedBankName: account.bank_name,
      kindOptions: loanCorrectionKinds,
      defaultKind: 'loan_outstanding',
    };
  }

  if (account.account_type === 'credit_card') {
    return {
      ownerType: 'credit_card',
      ownerId: account.id,
      ownerDisplayName: `${account.bank_name} card •••• ${account.account_last4}`,
      cardLast4: account.account_last4,
      detectedBankName: account.bank_name,
      kindOptions: creditCardCorrectionKinds,
      defaultKind: 'outstanding',
    };
  }

  return {
    ownerType: 'bank_account',
    ownerId: account.id,
    ownerDisplayName: `${account.bank_name} •••• ${account.account_last4}`,
    accountLast4: account.account_last4,
    detectedBankName: account.bank_name,
    kindOptions: bankCorrectionKinds,
    defaultKind: 'available_balance',
  };
}

export default function BankConfigScreen() {
  const { colors, typography, spacing } = useTheme();
  const navigation = useNavigation();
  const [accounts, setAccounts] = useState<BankAccount[]>([]);
  const [balanceViews, setBalanceViews] = useState<Record<string, BankAccountBalanceView>>({});
  const [pendingDetectedSummary, setPendingDetectedSummary] = useState<PendingDetectedBalanceSummary>(emptyPendingDetectedSummary);
  const [loading, setLoading] = useState(true);
  const [isInitialLoad, setIsInitialLoad] = useState(true);
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingAccount, setEditingAccount] = useState<BankAccount | null>(null);
  const [correctionTarget, setCorrectionTarget] = useState<CorrectionTarget | null>(null);
  
  // Form state
  const [bankName, setBankName] = useState('');
  const [accountLast4, setAccountLast4] = useState('');
  const [accountType, setAccountType] = useState<AccountType>('savings');
  const [startingBalance, setStartingBalance] = useState('');
  const [creditLimit, setCreditLimit] = useState('');
  const [upiIds, setUpiIds] = useState('');
  
  // Bank search
  const [showBankSearch, setShowBankSearch] = useState(false);
  const [bankSearchQuery, setBankSearchQuery] = useState('');
  const [filteredBanks, setFilteredBanks] = useState<string[]>([]);

  // Deep equality tracking for cache updates
  const lastDataStringRef = useRef<string | null>(null);

  const loadBalanceViews = useCallback(async () => {
    try {
      const [accountViews, pendingSummary] = await Promise.all([
        getAccountBalanceViewModels(),
        getPendingDetectedBalanceSummary(),
    ]);
      setBalanceViews(Object.fromEntries(accountViews.map(view => [view.accountId, view])));
      setPendingDetectedSummary(pendingSummary);
    } catch (error) {
      console.warn('[Balances] Failed to load account balance view metadata', {
        message: error instanceof Error ? error.message : 'unknown_error',
      });
    }
  }, []);

  useEffect(() => {
    if (bankSearchQuery.length > 0) {
      const allBanks = getAllBankNames();
      const filtered = allBanks.filter(bank =>
        bank.toLowerCase().includes(bankSearchQuery.toLowerCase())
      );
      setFilteredBanks(filtered);
    } else {
      setFilteredBanks(getAllBankNames());
    }
  }, [bankSearchQuery]);

  const loadAccountsSilently = useCallback(async () => {
    try {
      const [data] = await Promise.all([
        getBankAccounts(),
        loadBalanceViews(),
      ]);
      const dataStr = JSON.stringify(data);
      
      if (lastDataStringRef.current !== dataStr) {
        lastDataStringRef.current = dataStr;
        setAccounts(data);
      }
      
      // Save to cache for next instant load
      setCache(CACHE_KEYS.BANK_ACCOUNTS, data);
    } catch (error) {
      console.error('Error loading accounts silently:', error);
    }
  }, [loadBalanceViews]);

  // Load data with cache support
  const loadAccounts = useCallback(async () => {
    try {
      // Step 1: Try cache first for INSTANT display
      const cached = await getCached<BankAccount[]>(CACHE_KEYS.BANK_ACCOUNTS);
      if (cached) {
        const cachedStr = JSON.stringify(cached.data);
        if (lastDataStringRef.current !== cachedStr) {
          lastDataStringRef.current = cachedStr;
          setAccounts(cached.data);
        }
        setLoading(false); // Skip skeleton!
        loadBalanceViews();

        // Step 2: Silently refresh in background if stale
        if (cached.isStale) {
          loadAccountsSilently();
        }
        return;
      }

      // No cache — show skeleton and fetch
      setLoading(true);
      await loadAccountsSilently();
    } catch (error) {
      console.error('Error loading accounts:', error);
      Alert.alert('Error', 'Failed to load bank accounts');
    } finally {
      setLoading(false);
    }
  }, [loadAccountsSilently, loadBalanceViews]);

  // Keep ref always pointing to the latest loadAccountsSilently
  const loadAccountsSilentlyRef = useRef(loadAccountsSilently);
  useEffect(() => { loadAccountsSilentlyRef.current = loadAccountsSilently; }, [loadAccountsSilently]);

  // Debounce ref for bulk operations
  const loadTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const debouncedLoadSilently = useCallback(() => {
    if (loadTimerRef.current) {
      clearTimeout(loadTimerRef.current);
    }
    loadTimerRef.current = setTimeout(() => {
      loadAccountsSilentlyRef.current();
    }, 500);
  }, []);

  // Initial load
  useEffect(() => {
    if (isInitialLoad) {
      loadAccounts();
      setIsInitialLoad(false);
    }
  }, [isInitialLoad, loadAccounts]);

  // Reload on focus (with debounce)
  useFocusEffect(
    useCallback(() => {
      const task = InteractionManager.runAfterInteractions(() => {
        if (!isInitialLoad) {
          debouncedLoadSilently();
        }
      });
      return () => task.cancel();
    }, [isInitialLoad, debouncedLoadSilently])
  );

  useFocusEffect(
    useCallback(() => {
      return subscribeFinanceDataChanged(payload => {
        if (financeDataChangedAffects(payload, ['accounts'])) {
          debouncedLoadSilently();
        }
      });
    }, [debouncedLoadSilently])
  );

  // Cleanup debounce timer
  useEffect(() => {
    return () => {
      if (loadTimerRef.current) {
        clearTimeout(loadTimerRef.current);
      }
    };
  }, []);

  const openAddModal = () => {
    resetForm();
    setEditingAccount(null);
    setShowAddModal(true);
  };

  const openEditModal = (account: BankAccount) => {
    setEditingAccount(account);
    setBankName(account.bank_name);
    setAccountLast4(account.account_last4);
    setAccountType(account.account_type || 'savings');
    setStartingBalance(account.starting_balance?.toString() || '0');
    setCreditLimit(account.credit_limit?.toString() || '0');
    setUpiIds(account.upi_ids?.join(', ') || '');
    setShowAddModal(true);
  };

  const resetForm = () => {
    setBankName('');
    setAccountLast4('');
    setAccountType('savings');
    setStartingBalance('0');
    setCreditLimit('0');
    setUpiIds('');
  };

  const handleSave = async () => {
    // Validation
    if (!bankName.trim()) {
      Alert.alert('Error', 'Please select a bank');
      return;
    }
    if (!accountLast4.trim() || accountLast4.length !== 4) {
      Alert.alert('Error', 'Please enter last 4 digits of account/card');
      return;
    }

    try {
      const upiArray = upiIds
        .split(',')
        .map(id => id.trim())
        .filter(id => id.length > 0);

      const accountData = {
        bank_name: bankName,
        account_last4: accountLast4,
        account_type: accountType,
        starting_balance: parseFloat(startingBalance) || 0,
        credit_limit: accountType === 'credit_card' ? parseFloat(creditLimit) || 0 : 0,
        loan_total: 0,
        upi_ids: upiArray,
      };

      if (editingAccount) {
        await updateBankAccount(editingAccount.id, accountData);
      } else {
        await addBankAccount(accountData);
      }

      setShowAddModal(false);
      loadAccountsSilently(); // Reload with cache update
      Alert.alert('Success', editingAccount ? 'Account updated' : 'Account added');
    } catch (error) {
      console.error('Error saving account:', error);
      Alert.alert('Error', 'Failed to save account');
    }
  };

  const handleDelete = (account: BankAccount) => {
    Alert.alert(
      'Delete Account',
      `Are you sure you want to delete ${account.bank_name} (${account.account_last4})? All associated transactions will also be deleted.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              await deleteBankAccount(account.id);
              loadAccountsSilently(); // Reload with cache update
              Alert.alert('Success', 'Account deleted');
            } catch (error) {
              console.error('Error deleting account:', error);
              Alert.alert('Error', 'Failed to delete account');
            }
          },
        },
      ]
    );
  };

  const handleCorrectionSaved = async () => {
    await loadBalanceViews();
    Toast.show({
      type: 'success',
      text1: 'Balance updated',
    });
  };

  const selectBank = (bank: string) => {
    setBankName(bank);
    setShowBankSearch(false);
    setBankSearchQuery('');
  };

  return (
    <ScreenWrapper>
      <AppHeader title="Bank & Card Setup" showBack={true} />
      
      <ScrollView contentContainerStyle={{ padding: spacing.lg }}>
        {/* Info Banner */}
        <View style={[styles.infoBanner, {
          backgroundColor: '#06b6d4' + '15',
          borderColor: '#06b6d4',
          borderWidth: 1,
          borderRadius: 12,
          padding: spacing.md,
          marginBottom: spacing.lg,
        }]}>
          <MaterialCommunityIcons name="information-outline" size={20} color="#06b6d4" />
          <Text style={[typography.caption, { color: '#06b6d4', flex: 1, marginLeft: spacing.sm, lineHeight: 18 }]}>
            Add your bank accounts and credit cards. The app will automatically detect transactions from SMS and match them using the last 4 digits.
          </Text>
        </View>

        {/* Add Button */}
        <TouchableOpacity
          onPress={openAddModal}
          style={{
            backgroundColor: colors.accent,
            borderRadius: 12,
            padding: spacing.md,
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'center',
            marginBottom: spacing.lg,
            elevation: 2,
            shadowColor: colors.accent,
            shadowOffset: { width: 0, height: 2 },
            shadowOpacity: 0.3,
            shadowRadius: 4,
          }}>
          <MaterialCommunityIcons name="plus-circle" size={24} color="#fff" />
          <Text style={[typography.bodyBold, { color: '#fff', marginLeft: spacing.sm, fontSize: 16 }]}>
            Add Bank or Card
          </Text>
        </TouchableOpacity>

        {/* Accounts List */}
        {loading ? (
          <View style={{ paddingVertical: spacing.xl }}>
            <Text style={[typography.body, { color: colors.subtext, textAlign: 'center' }]}>
              Loading accounts...
            </Text>
          </View>
        ) : accounts.length === 0 ? (
          <Card style={{ padding: spacing.xl, alignItems: 'center' }}>
            <MaterialCommunityIcons name="bank-off" size={48} color={colors.subtext} style={{ opacity: 0.5 }} />
            <Text style={[typography.bodyBold, { color: colors.text, marginTop: spacing.md, textAlign: 'center' }]}>
              No Accounts Yet
            </Text>
            <Text style={[typography.caption, { color: colors.subtext, marginTop: spacing.xs, textAlign: 'center' }]}>
              Add your first bank or card to start tracking transactions automatically
            </Text>
          </Card>
        ) : (
          <>
            {pendingDetectedSummary.total > 0 && (
              <TouchableOpacity
                onPress={() => (navigation as any).navigate('DetectedAccountsScreen')}
                accessibilityLabel="Review detected accounts"
                style={{
                alignSelf: 'flex-start',
                flexDirection: 'row',
                alignItems: 'center',
                backgroundColor: colors.accent + '14',
                borderRadius: 999,
                paddingHorizontal: spacing.md,
                paddingVertical: spacing.xs,
                marginBottom: spacing.md,
              }}>
                <MaterialCommunityIcons name="radar" size={14} color={colors.accent} />
                <Text style={[typography.caption, { color: colors.accent, marginLeft: spacing.xs, fontWeight: '600' }]}>
                  {pendingDetectedSummary.total} detected {pendingDetectedSummary.total === 1 ? 'account needs' : 'accounts need'} review
                </Text>
                <MaterialCommunityIcons name="chevron-right" size={14} color={colors.accent} style={{ marginLeft: spacing.xs }} />
              </TouchableOpacity>
            )}
            <Text style={[typography.caption, { color: colors.subtext, marginBottom: spacing.md, textTransform: 'uppercase', fontWeight: '600', letterSpacing: 1 }]}>
              Your Accounts ({accounts.length})
            </Text>
            {accounts.map((account) => {
              const balanceView = balanceViews[account.id];
              const isCredit = account.account_type === 'credit_card';
              const iconName = isCredit ? 'credit-card' : 'bank';
              const iconColor = isCredit ? '#f59e0b' : '#10b981';
              const displayBalance = balanceView?.displayBalance ?? account.balance ?? account.starting_balance ?? 0;
              const sourceLabel = balanceView?.sourceLabel ?? getBalanceSourceLabel('calculated');
              const confidenceLabel = balanceView?.confidenceLabel ?? getBalanceConfidenceLabel('estimated');
              const freshnessLabel = formatBalanceUpdatedAt(balanceView?.lastUpdated ?? null);
              const freshnessColor = balanceView?.staleWarning ? '#f59e0b' : colors.subtext;
              
              return (
                <Card key={account.id} style={{ marginBottom: spacing.md, padding: spacing.md }}>
                  <View style={{ flexDirection: 'row', alignItems: 'flex-start' }}>
                    <View style={{
                      width: 48,
                      height: 48,
                      borderRadius: 24,
                      backgroundColor: iconColor + '20',
                      justifyContent: 'center',
                      alignItems: 'center',
                    }}>
                      <MaterialCommunityIcons name={iconName} size={24} color={iconColor} />
                    </View>
                    
                    <View style={{ flex: 1, marginLeft: spacing.md }}>
                      <Text style={[typography.bodyBold, { color: colors.text, fontSize: 16 }]}>
                        {account.bank_name}
                      </Text>
                      <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 4 }}>
                        <View style={{
                          backgroundColor: iconColor + '15',
                          paddingHorizontal: 8,
                          paddingVertical: 2,
                          borderRadius: 6,
                        }}>
                          <Text style={[typography.caption, { color: iconColor, fontSize: 10, fontWeight: '600' }]}>
                            {account.account_type === 'credit_card' ? 'CREDIT CARD' : 
                             account.account_type === 'current' ? 'CURRENT' :
                             account.account_type === 'loan' ? 'LOAN' : 'SAVINGS'}
                          </Text>
                        </View>
                        <Text style={[typography.caption, { color: colors.subtext, marginLeft: 8 }]}>
                          •••• {account.account_last4}
                        </Text>
                      </View>
                      
                      {account.upi_ids && account.upi_ids.length > 0 && (
                        <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 6 }}>
                          <MaterialCommunityIcons name="qrcode" size={14} color={colors.accent} />
                          <Text style={[typography.caption, { color: colors.accent, marginLeft: 4, fontSize: 11 }]}>
                            {account.upi_ids.join(', ')}
                          </Text>
                        </View>
                      )}
                      
                      {account.account_type === 'credit_card' && account.credit_limit && (
                        <Text style={[typography.caption, { color: colors.subtext, marginTop: 4, fontSize: 11 }]}>
                          Limit: ₹{account.credit_limit.toLocaleString('en-IN')}
                        </Text>
                      )}

                      <View style={{ marginTop: spacing.sm }}>
                        <Text style={[typography.caption, { color: colors.subtext, fontSize: 11 }]}>
                          {account.account_type === 'loan' ? 'Outstanding' : isCredit ? 'Balance' : 'Latest Balance'}
                        </Text>
                        <Text style={[typography.bodyBold, { color: colors.text, fontSize: 18, marginTop: 2 }]}>
                          ₹{displayBalance.toLocaleString('en-IN')}
                        </Text>
                        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 6 }}>
                          <View style={{
                            backgroundColor: colors.accent + '15',
                            borderRadius: 999,
                            paddingHorizontal: 8,
                            paddingVertical: 3,
                          }}>
                            <Text style={[typography.caption, { color: colors.accent, fontSize: 10, fontWeight: '700' }]}>
                              {sourceLabel}
                            </Text>
                          </View>
                          <View style={{
                            backgroundColor: (balanceView?.confidence === 'exact' ? '#10b981' : '#f59e0b') + '15',
                            borderRadius: 999,
                            paddingHorizontal: 8,
                            paddingVertical: 3,
                          }}>
                            <Text style={[typography.caption, {
                              color: balanceView?.confidence === 'exact' ? '#10b981' : '#f59e0b',
                              fontSize: 10,
                              fontWeight: '700',
                            }]}>
                              {confidenceLabel}
                            </Text>
                          </View>
                        </View>
                        <Text style={[typography.caption, { color: freshnessColor, marginTop: 4, fontSize: 11 }]}>
                          {freshnessLabel}
                        </Text>
                      </View>
                    </View>
                    
                    <View style={{ flexDirection: 'row', gap: 8, marginLeft: spacing.sm }}>
                      <TouchableOpacity
                        onPress={() => setCorrectionTarget(correctionTargetForAccount(account))}
                        accessibilityLabel="Update balance"
                        style={{
                          backgroundColor: '#10b981' + '15',
                          borderRadius: 8,
                          padding: 10,
                        }}>
                        <MaterialCommunityIcons name="wallet-plus-outline" size={18} color="#10b981" />
                      </TouchableOpacity>
                      <TouchableOpacity
                        onPress={() => openEditModal(account)}
                        style={{
                          backgroundColor: colors.accent + '15',
                          borderRadius: 8,
                          padding: 10,
                        }}>
                        <MaterialCommunityIcons name="pencil" size={18} color={colors.accent} />
                      </TouchableOpacity>
                      <TouchableOpacity
                        onPress={() => handleDelete(account)}
                        style={{
                          backgroundColor: '#ef4444' + '15',
                          borderRadius: 8,
                          padding: 10,
                        }}>
                        <MaterialCommunityIcons name="delete" size={18} color="#ef4444" />
                      </TouchableOpacity>
                    </View>
                  </View>
                </Card>
              );
            })}
          </>
        )}
      </ScrollView>

      {/* Add/Edit Modal */}
      <Modal
        visible={showAddModal}
        animationType="slide"
        transparent={true}
        onRequestClose={() => setShowAddModal(false)}>
        <View style={[styles.modalOverlay, { backgroundColor: 'rgba(0,0,0,0.5)' }]}>
          <View style={[styles.modalContent, { backgroundColor: colors.card, borderRadius: 16, padding: spacing.lg }]}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.lg }}>
              <Text style={[typography.h3, { color: colors.text }]}>
                {editingAccount ? 'Edit Account' : 'Add Account'}
              </Text>
              <TouchableOpacity onPress={() => setShowAddModal(false)}>
                <MaterialCommunityIcons name="close" size={24} color={colors.text} />
              </TouchableOpacity>
            </View>

            <ScrollView showsVerticalScrollIndicator={false}>
              {/* Bank Name */}
              <Text style={[typography.caption, { color: colors.subtext, marginBottom: 4 }]}>
                Bank Name *
              </Text>
              <TouchableOpacity
                onPress={() => setShowBankSearch(true)}
                style={{
                  backgroundColor: colors.background,
                  borderRadius: 8,
                  padding: spacing.md,
                  marginBottom: spacing.md,
                  flexDirection: 'row',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                }}>
                <Text style={[typography.body, { color: bankName ? colors.text : colors.subtext }]}>
                  {bankName || 'Select Bank'}
                </Text>
                <MaterialCommunityIcons name="chevron-down" size={20} color={colors.subtext} />
              </TouchableOpacity>

              {/* Account Type */}
              <Text style={[typography.caption, { color: colors.subtext, marginBottom: 4 }]}>
                Account Type *
              </Text>
              <View style={{ flexDirection: 'row', gap: 8, marginBottom: spacing.md }}>
                {(['savings', 'current', 'credit_card'] as const).map((type) => (
                  <TouchableOpacity
                    key={type}
                    onPress={() => setAccountType(type)}
                    style={{
                      flex: 1,
                      backgroundColor: accountType === type ? colors.accent + '20' : colors.background,
                      borderColor: accountType === type ? colors.accent : colors.border,
                      borderWidth: 1,
                      borderRadius: 8,
                      padding: spacing.sm,
                      alignItems: 'center',
                    }}>
                    <Text style={[typography.caption, { 
                      color: accountType === type ? colors.accent : colors.text,
                      fontWeight: accountType === type ? 'bold' : 'normal',
                    }]}>
                      {type === 'credit_card' ? 'Credit Card' : 
                       type === 'current' ? 'Current' : 'Savings'}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>

              {/* Last 4 Digits */}
              <Text style={[typography.caption, { color: colors.subtext, marginBottom: 4 }]}>
                Last 4 Digits *
              </Text>
              <TextInput
                value={accountLast4}
                onChangeText={setAccountLast4}
                placeholder="1234"
                placeholderTextColor={colors.subtext}
                keyboardType="number-pad"
                maxLength={4}
                style={[
                  typography.body,
                  {
                    backgroundColor: colors.background,
                    borderRadius: 8,
                    padding: spacing.md,
                    color: colors.text,
                    marginBottom: spacing.md,
                  },
                ]}
              />

              {/* Starting Balance (for savings/current) */}
              {accountType !== 'credit_card' && (
                <>
                  <Text style={[typography.caption, { color: colors.subtext, marginBottom: 4 }]}>
                    Starting Balance
                  </Text>
                  <TextInput
                    value={startingBalance}
                    onChangeText={setStartingBalance}
                    placeholder="0"
                    placeholderTextColor={colors.subtext}
                    keyboardType="decimal-pad"
                    style={[
                      typography.body,
                      {
                        backgroundColor: colors.background,
                        borderRadius: 8,
                        padding: spacing.md,
                        color: colors.text,
                        marginBottom: spacing.md,
                      },
                    ]}
                  />
                </>
              )}

              {/* Credit Limit (for credit cards) */}
              {accountType === 'credit_card' && (
                <>
                  <Text style={[typography.caption, { color: colors.subtext, marginBottom: 4 }]}>
                    Credit Limit
                  </Text>
                  <TextInput
                    value={creditLimit}
                    onChangeText={setCreditLimit}
                    placeholder="0"
                    placeholderTextColor={colors.subtext}
                    keyboardType="decimal-pad"
                    style={[
                      typography.body,
                      {
                        backgroundColor: colors.background,
                        borderRadius: 8,
                        padding: spacing.md,
                        color: colors.text,
                        marginBottom: spacing.md,
                      },
                    ]}
                  />
                </>
              )}

              {/* UPI IDs */}
              <Text style={[typography.caption, { color: colors.subtext, marginBottom: 4 }]}>
                UPI IDs (comma separated)
              </Text>
              <TextInput
                value={upiIds}
                onChangeText={setUpiIds}
                placeholder="yourname@paytm, yourname@ybl"
                placeholderTextColor={colors.subtext}
                style={[
                  typography.body,
                  {
                    backgroundColor: colors.background,
                    borderRadius: 8,
                    padding: spacing.md,
                    color: colors.text,
                    marginBottom: spacing.lg,
                  },
                ]}
              />

              {/* Save Button */}
              <TouchableOpacity
                onPress={handleSave}
                style={{
                  backgroundColor: colors.accent,
                  borderRadius: 12,
                  padding: spacing.md,
                  alignItems: 'center',
                }}>
                <Text style={[typography.bodyBold, { color: '#fff' }]}>
                  {editingAccount ? 'Update' : 'Add'} Account
                </Text>
              </TouchableOpacity>
            </ScrollView>
          </View>
        </View>
      </Modal>

      {correctionTarget && (
        <BalanceCorrectionModal
          visible={Boolean(correctionTarget)}
          ownerType={correctionTarget.ownerType}
          ownerId={correctionTarget.ownerId}
          ownerDisplayName={correctionTarget.ownerDisplayName}
          accountLast4={correctionTarget.accountLast4}
          cardLast4={correctionTarget.cardLast4}
          detectedBankName={correctionTarget.detectedBankName}
          kindOptions={correctionTarget.kindOptions}
          defaultKind={correctionTarget.defaultKind}
          onClose={() => setCorrectionTarget(null)}
          onSaved={handleCorrectionSaved}
        />
      )}

      {/* Bank Search Modal */}
      <Modal
        visible={showBankSearch}
        animationType="slide"
        transparent={true}
        onRequestClose={() => setShowBankSearch(false)}>
        <View style={[styles.modalOverlay, { backgroundColor: 'rgba(0,0,0,0.5)' }]}>
          <View style={[styles.modalContent, { backgroundColor: colors.card, borderRadius: 16, padding: spacing.lg }]}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.md }}>
              <Text style={[typography.h3, { color: colors.text }]}>Select Bank</Text>
              <TouchableOpacity onPress={() => setShowBankSearch(false)}>
                <MaterialCommunityIcons name="close" size={24} color={colors.text} />
              </TouchableOpacity>
            </View>

            {/* Search Input */}
            <TextInput
              value={bankSearchQuery}
              onChangeText={setBankSearchQuery}
              placeholder="Search banks..."
              placeholderTextColor={colors.subtext}
              style={[
                typography.body,
                {
                  backgroundColor: colors.background,
                  borderRadius: 8,
                  padding: spacing.md,
                  color: colors.text,
                  marginBottom: spacing.md,
                },
              ]}
            />

            {/* Bank List */}
            <ScrollView style={{ maxHeight: 400 }}>
              {filteredBanks.map((bank) => (
                <TouchableOpacity
                  key={bank}
                  onPress={() => selectBank(bank)}
                  style={{
                    padding: spacing.md,
                    borderBottomWidth: 1,
                    borderBottomColor: colors.border,
                  }}>
                  <Text style={[typography.body, { color: colors.text }]}>{bank}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </ScreenWrapper>
  );
}

const styles = StyleSheet.create({
  infoBanner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  modalOverlay: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  modalContent: {
    width: '100%',
    maxHeight: '90%',
  },
});
