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
import { ScreenWrapper, AppHeader, Card, AppConfirmModal } from '../../components';
import BalanceCorrectionModal, { BalanceCorrectionKindOption } from '../../components/BalanceCorrectionModal';
import BalanceHistoryModal from '../../components/BalanceHistoryModal';
import { getBankAccounts, addBankAccount, updateBankAccount } from '../../lib/database/financial';
import { getAllBankNames } from '../../lib/services/smsParser';
import { getCached, setCache, CACHE_KEYS } from '../../lib/services/cache';
import { financeDataChangedAffects, subscribeFinanceDataChanged } from '../../lib/services/dataEvents';
import { formatCurrencyDisplay } from '../../utils/format';
import { formatUpiIdsForDisplay } from '../../utils/upi';
import {
  AccountRemovalImpact,
  ArchivedFinancialOwners,
  RemovableOwnerType,
  getAccountRemovalImpact,
  getArchivedOwners,
  removeOrArchiveOwner,
  restoreArchivedOwner,
} from '../../lib/services/accountRemoval';
import {
  BankAccountBalanceView,
  BankAccountDetailView,
  getAccountBalanceViewModels,
  getBalanceFreshnessLabel,
  getBalanceKindLabel,
  getBalanceConfidenceLabel,
  getBalanceSourceLabel,
  getBankAccountDetailView,
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

interface RemovalTarget {
  ownerType: RemovableOwnerType;
  ownerId: string;
  label: string;
}

const emptyPendingDetectedSummary: PendingDetectedBalanceSummary = {
  total: 0,
  bank_account: 0,
  credit_card: 0,
  debit_card: 0,
  loan: 0,
};

const ACCOUNT_ACTION_SIZE = 44;

function formatBalanceUpdatedAt(lastUpdated: string | null): string {
  if (!lastUpdated) return 'No update yet';

  const updatedAt = new Date(lastUpdated).getTime();
  if (!Number.isFinite(updatedAt)) return 'Updated recently';

  const diffMs = Date.now() - updatedAt;
  if (diffMs < 60 * 1000) return 'Just now';
  const days = Math.floor(diffMs / (24 * 60 * 60 * 1000));
  if (days <= 0) return 'Updated today';
  if (days === 1) return 'Updated 1 day ago';
  return `Updated ${days} days ago`;
}

function buildRemovalMessage(label: string, impact: AccountRemovalImpact): string {
  const historyCount = Object.values(impact.counts).reduce((sum, count) => sum + count, 0);
  const action = impact.canHardDelete
      ? 'This item has no linked history or stored balance, so it can be permanently removed.'
    : impact.willArchive
      ? 'This hides the account/card from your active list. It does not delete transactions or change balances.'
      : 'This item has history or a stored balance and cannot be removed until archive support is added for this type.';
  const warnings = impact.warnings.length > 0 ? `\n\n${impact.warnings.join('\n')}` : '';

  return [
    impact.willArchive ? `Hide ${label} from active lists?` : `Remove ${label}?`,
    action,
    `Safety dependencies found: ${historyCount}.`,
    'If this account/card has history, it will be hidden instead of permanently deleted.',
    'This will not delete transactions.',
    'This will not change your balances.',
  ].join('\n\n') + warnings;
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
  const [archivedOwners, setArchivedOwners] = useState<ArchivedFinancialOwners>({
    bankAccounts: [],
    creditCards: [],
  });
  const [showArchived, setShowArchived] = useState(false);
  const [balanceViews, setBalanceViews] = useState<Record<string, BankAccountBalanceView>>({});
  const [pendingDetectedSummary, setPendingDetectedSummary] = useState<PendingDetectedBalanceSummary>(emptyPendingDetectedSummary);
  const [loading, setLoading] = useState(true);
  const [isInitialLoad, setIsInitialLoad] = useState(true);
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingAccount, setEditingAccount] = useState<BankAccount | null>(null);
  const [correctionTarget, setCorrectionTarget] = useState<CorrectionTarget | null>(null);
  const [historyAccount, setHistoryAccount] = useState<BankAccount | null>(null);
  const [historyDetail, setHistoryDetail] = useState<BankAccountDetailView | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
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

  const loadArchivedOwners = useCallback(async () => {
    try {
      setArchivedOwners(await getArchivedOwners());
    } catch (error) {
      console.warn('[Accounts] Failed to load archived owners', {
        message: error instanceof Error ? error.message : 'unknown_error',
      });
      setArchivedOwners({ bankAccounts: [], creditCards: [] });
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
        loadArchivedOwners(),
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
  }, [loadArchivedOwners, loadBalanceViews]);

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
        loadArchivedOwners();

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
  }, [loadAccountsSilently, loadArchivedOwners, loadBalanceViews]);

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

  const openRemoveConfirm = async (target: RemovalTarget) => {
    try {
      const impact = await getAccountRemovalImpact(target.ownerType, target.ownerId);
      const canRemove = impact.canHardDelete || impact.willArchive;
      setConfirmDialog({
        visible: true,
        title: canRemove ? (impact.willArchive ? 'Hide Account/Card' : 'Remove Account/Card') : 'Cannot Remove Yet',
        message: buildRemovalMessage(target.label, impact),
        confirmText: canRemove ? (impact.willArchive ? 'Hide' : 'Remove') : 'OK',
        isDestructive: canRemove && impact.canHardDelete,
        onConfirm: async () => {
          setConfirmDialog(null);
          if (!canRemove) return;

          try {
            const result = await removeOrArchiveOwner(target.ownerType, target.ownerId);
            Toast.show({
              type: 'success',
              text1: result.action === 'archived' ? 'Hidden' : 'Removed',
              text2: result.action === 'archived'
                ? 'Item was hidden from active lists'
                : 'Item was removed safely',
            });
            loadAccountsSilently();
          } catch {
            loadAccountsSilently();
            Toast.show({
              type: 'error',
              text1: 'Remove failed',
              text2: 'No transactions or balances were changed',
            });
          }
        },
      });
    } catch {
      Toast.show({
        type: 'error',
        text1: 'Remove unavailable',
        text2: 'Could not check linked history',
      });
    }
  };

  const handleDelete = (account: BankAccount) => {
    openRemoveConfirm({
      ownerType: 'bank_account',
      ownerId: account.id,
      label: `${account.bank_name} ••${account.account_last4}`,
    });
  };

  const handleRestoreArchivedOwner = async (target: RemovalTarget) => {
    try {
      await restoreArchivedOwner(target.ownerType, target.ownerId);
      Toast.show({
        type: 'success',
        text1: 'Restored',
        text2: 'Item is back in your active list',
      });
      await loadAccountsSilently();
    } catch {
      Toast.show({
        type: 'error',
        text1: 'Restore failed',
        text2: 'No transactions or balances were changed',
      });
      await loadArchivedOwners();
    }
  };

  const handleCorrectionSaved = async () => {
    await loadBalanceViews();
    Toast.show({
      type: 'success',
      text1: 'Balance updated',
    });
  };

  const openBalanceHistory = async (account: BankAccount) => {
    setHistoryAccount(account);
    setHistoryDetail(null);
    setHistoryLoading(true);
    try {
      setHistoryDetail(await getBankAccountDetailView(account.id));
    } catch (error) {
      console.warn('[Balances] Failed to load balance history', {
        message: error instanceof Error ? error.message : 'unknown_error',
      });
      Toast.show({
        type: 'error',
        text1: 'Could not load balance history',
      });
    } finally {
      setHistoryLoading(false);
    }
  };

  const closeBalanceHistory = () => {
    setHistoryAccount(null);
    setHistoryDetail(null);
    setHistoryLoading(false);
  };

  const openCorrectionFromHistory = () => {
    if (!historyAccount) return;
    const target = correctionTargetForAccount(historyAccount);
    closeBalanceHistory();
    setCorrectionTarget(target);
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
        ) : accounts.length === 0 && archivedOwners.bankAccounts.length + archivedOwners.creditCards.length === 0 ? (
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
                accessibilityRole="button"
                style={{
                  minHeight: 48,
                  flexDirection: 'row',
                  alignItems: 'center',
                  backgroundColor: colors.accent + '12',
                  borderColor: colors.accent + '30',
                  borderWidth: 1,
                  borderRadius: 14,
                  paddingHorizontal: spacing.md,
                  paddingVertical: spacing.sm,
                  marginBottom: spacing.lg,
                }}>
                <View style={{
                  width: 32,
                  height: 32,
                  borderRadius: 16,
                  backgroundColor: colors.accent + '18',
                  alignItems: 'center',
                  justifyContent: 'center',
                  marginRight: spacing.sm,
                }}>
                  <MaterialCommunityIcons name="radar" size={18} color={colors.accent} />
                </View>
                <Text
                  numberOfLines={1}
                  style={[typography.bodyBold, { color: colors.accent, flex: 1, fontSize: 14 }]}>
                  {pendingDetectedSummary.total} detected {pendingDetectedSummary.total === 1 ? 'account needs' : 'accounts need'} review
                </Text>
                <MaterialCommunityIcons name="chevron-right" size={20} color={colors.accent} style={{ marginLeft: spacing.sm }} />
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
              const upiDisplay = formatUpiIdsForDisplay(account.upi_ids);

              return (
                <Card key={account.id} style={{ marginBottom: spacing.lg, padding: spacing.lg }}>
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
                    
                    <View style={{ flex: 1, marginLeft: spacing.md, minWidth: 0 }}>
                      <Text
                        numberOfLines={1}
                        style={[typography.bodyBold, { color: colors.text, fontSize: 17 }]}>
                        {account.bank_name}
                      </Text>
                      <Text
                        numberOfLines={1}
                        style={[typography.caption, { color: colors.subtext, marginTop: 4, fontSize: 12 }]}>
                        {account.account_type === 'credit_card' ? 'Credit card' :
                         account.account_type === 'current' ? 'Current account' :
                         account.account_type === 'loan' ? 'Loan account' : 'Savings account'} · •••• {account.account_last4}
                      </Text>
                      
                      {!!upiDisplay && (
                        <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 6 }}>
                          <MaterialCommunityIcons name="qrcode" size={14} color={colors.accent} />
                          <Text
                            numberOfLines={1}
                            style={[typography.caption, { color: colors.accent, marginLeft: 4, fontSize: 11, flexShrink: 1 }]}>
                            {upiDisplay}
                          </Text>
                        </View>
                      )}
                      
                      {account.account_type === 'credit_card' && account.credit_limit && (
                        <Text style={[typography.caption, { color: colors.subtext, marginTop: 4, fontSize: 11 }]}>
                          Limit: {formatCurrencyDisplay(account.credit_limit)}
                        </Text>
                      )}

                      <View style={{ marginTop: spacing.md }}>
                        <Text style={[typography.caption, { color: colors.subtext, fontSize: 11 }]}>
                          {account.account_type === 'loan' ? 'Outstanding' : isCredit ? 'Balance' : 'Latest Balance'}
                        </Text>
                        <Text
                          numberOfLines={1}
                          adjustsFontSizeToFit
                          minimumFontScale={0.78}
                          style={[typography.h3, { color: colors.text, fontSize: 24, lineHeight: 30, marginTop: 2 }]}>
                          {formatCurrencyDisplay(displayBalance)}
                        </Text>
                        <Text
                          numberOfLines={1}
                          style={[typography.caption, { color: freshnessColor, marginTop: 6, fontSize: 12 }]}>
                          {sourceLabel} · {confidenceLabel} · {freshnessLabel}
                        </Text>
                      </View>
                    </View>
                  </View>

                  <View style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: spacing.sm,
                    marginTop: spacing.md,
                    paddingTop: spacing.md,
                    borderTopWidth: 1,
                    borderTopColor: colors.border,
                  }}>
                      <TouchableOpacity
                        onPress={() => openBalanceHistory(account)}
                        accessibilityLabel="View balance history"
                        accessibilityRole="button"
                        style={{
                          minHeight: ACCOUNT_ACTION_SIZE,
                          flex: 1,
                          backgroundColor: colors.accent + '12',
                          borderRadius: 12,
                          paddingHorizontal: spacing.sm,
                          flexDirection: 'row',
                          alignItems: 'center',
                          justifyContent: 'center',
                        }}>
                        <MaterialCommunityIcons name="history" size={18} color={colors.accent} />
                        <Text numberOfLines={1} style={[typography.caption, { color: colors.accent, marginLeft: spacing.xs, fontWeight: '700' }]}>
                          History
                        </Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        onPress={() => setCorrectionTarget(correctionTargetForAccount(account))}
                        accessibilityLabel="Update balance"
                        accessibilityRole="button"
                        style={{
                          minHeight: ACCOUNT_ACTION_SIZE,
                          flex: 1,
                          backgroundColor: '#10b981' + '15',
                          borderRadius: 12,
                          paddingHorizontal: spacing.sm,
                          flexDirection: 'row',
                          alignItems: 'center',
                          justifyContent: 'center',
                        }}>
                        <MaterialCommunityIcons name="wallet-plus-outline" size={18} color="#10b981" />
                        <Text numberOfLines={1} style={[typography.caption, { color: '#10b981', marginLeft: spacing.xs, fontWeight: '700' }]}>
                          Update
                        </Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        onPress={() => openEditModal(account)}
                        accessibilityLabel="Edit account"
                        accessibilityRole="button"
                        style={{
                          width: ACCOUNT_ACTION_SIZE,
                          minHeight: ACCOUNT_ACTION_SIZE,
                          backgroundColor: colors.accent + '15',
                          borderRadius: 12,
                          alignItems: 'center',
                          justifyContent: 'center',
                        }}>
                        <MaterialCommunityIcons name="pencil" size={18} color={colors.accent} />
                      </TouchableOpacity>
                      <TouchableOpacity
                        onPress={() => handleDelete(account)}
                        accessibilityLabel="Hide or remove account"
                        accessibilityRole="button"
                        style={{
                          width: ACCOUNT_ACTION_SIZE,
                          minHeight: ACCOUNT_ACTION_SIZE,
                          backgroundColor: '#ef4444' + '10',
                          borderRadius: 12,
                          alignItems: 'center',
                          justifyContent: 'center',
                        }}>
                        <MaterialCommunityIcons name="trash-can-outline" size={18} color="#ef4444" />
                      </TouchableOpacity>
                  </View>
                </Card>
              );
            })}
            {archivedOwners.bankAccounts.length + archivedOwners.creditCards.length > 0 && (
              <View style={{ marginTop: spacing.sm, marginBottom: spacing.lg }}>
                <TouchableOpacity
                  onPress={() => setShowArchived(value => !value)}
                  accessibilityLabel="Show hidden accounts and cards"
                  accessibilityRole="button"
                  style={{
                    minHeight: 44,
                    flexDirection: 'row',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    paddingVertical: spacing.sm,
                  }}>
                  <Text style={[typography.caption, { color: colors.subtext, textTransform: 'uppercase', fontWeight: '600', letterSpacing: 1 }]}>
                    Hidden ({archivedOwners.bankAccounts.length + archivedOwners.creditCards.length})
                  </Text>
                  <MaterialCommunityIcons name={showArchived ? 'chevron-up' : 'chevron-down'} size={20} color={colors.subtext} />
                </TouchableOpacity>

                {showArchived && (
                  <View>
                    {archivedOwners.bankAccounts.map(account => (
                      <Card key={`hidden-bank-${account.id}`} style={{ marginBottom: spacing.md, padding: spacing.md }}>
                        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                          <MaterialCommunityIcons name="bank-off" size={20} color={colors.subtext} />
                          <View style={{ flex: 1, marginLeft: spacing.sm, minWidth: 0 }}>
                            <Text numberOfLines={1} style={[typography.bodyBold, { color: colors.text }]}>
                              {account.bank_name}
                            </Text>
                            <Text numberOfLines={1} style={[typography.caption, { color: colors.subtext }]}>
                              Hidden account •••• {account.account_last4}
                            </Text>
                          </View>
                          <TouchableOpacity
                            onPress={() => handleRestoreArchivedOwner({
                              ownerType: 'bank_account',
                              ownerId: account.id,
                              label: `${account.bank_name} ••${account.account_last4}`,
                            })}
                            accessibilityLabel="Restore hidden account"
                            accessibilityRole="button"
                            style={{
                              minHeight: 40,
                              paddingHorizontal: spacing.md,
                              borderRadius: 10,
                              backgroundColor: colors.accent + '12',
                              justifyContent: 'center',
                            }}>
                            <Text style={[typography.caption, { color: colors.accent, fontWeight: '700' }]}>Restore</Text>
                          </TouchableOpacity>
                        </View>
                      </Card>
                    ))}
                    {archivedOwners.creditCards.map(card => (
                      <Card key={`hidden-card-${card.id}`} style={{ marginBottom: spacing.md, padding: spacing.md }}>
                        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                          <MaterialCommunityIcons name="credit-card-off-outline" size={20} color={colors.subtext} />
                          <View style={{ flex: 1, marginLeft: spacing.sm, minWidth: 0 }}>
                            <Text numberOfLines={1} style={[typography.bodyBold, { color: colors.text }]}>
                              {card.card_name || card.bank_name}
                            </Text>
                            <Text numberOfLines={1} style={[typography.caption, { color: colors.subtext }]}>
                              Hidden card ••{card.last_4_digits}
                            </Text>
                          </View>
                          <TouchableOpacity
                            onPress={() => handleRestoreArchivedOwner({
                              ownerType: 'credit_card',
                              ownerId: card.id,
                              label: `${card.card_name || card.bank_name} ••${card.last_4_digits}`,
                            })}
                            accessibilityLabel="Restore hidden credit card"
                            accessibilityRole="button"
                            style={{
                              minHeight: 40,
                              paddingHorizontal: spacing.md,
                              borderRadius: 10,
                              backgroundColor: colors.accent + '12',
                              justifyContent: 'center',
                            }}>
                            <Text style={[typography.caption, { color: colors.accent, fontWeight: '700' }]}>Restore</Text>
                          </TouchableOpacity>
                        </View>
                      </Card>
                    ))}
                  </View>
                )}
              </View>
            )}
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

      {historyAccount && (
        <BalanceHistoryModal
          visible={Boolean(historyAccount)}
          title={historyAccount.bank_name}
          subtitle={`${historyAccount.account_type === 'current' ? 'Current' : historyAccount.account_type === 'loan' ? 'Loan' : historyAccount.account_type === 'credit_card' ? 'Credit Card' : 'Savings'} •••• ${historyAccount.account_last4}`}
          balanceLabel={historyAccount.account_type === 'loan' ? 'Outstanding' : historyAccount.account_type === 'credit_card' ? 'Balance' : 'Current displayed balance'}
          balanceAmount={historyDetail?.displayBalance ?? balanceViews[historyAccount.id]?.displayBalance ?? historyAccount.balance ?? historyAccount.starting_balance ?? 0}
          balanceKindLabel={historyDetail ? getBalanceKindLabel(historyDetail.balanceKind) : getBalanceKindLabel(balanceViews[historyAccount.id]?.balanceKind || 'current_balance')}
          sourceLabel={historyDetail?.sourceLabel ?? balanceViews[historyAccount.id]?.sourceLabel ?? getBalanceSourceLabel('calculated')}
          confidenceLabel={historyDetail?.confidenceLabel ?? balanceViews[historyAccount.id]?.confidenceLabel ?? getBalanceConfidenceLabel('estimated')}
          freshnessLabel={historyDetail?.lastUpdated ? getBalanceFreshnessLabel(historyDetail.lastUpdated) : formatBalanceUpdatedAt(balanceViews[historyAccount.id]?.lastUpdated ?? null)}
          loading={historyLoading}
          history={historyDetail?.history ?? []}
          metrics={[
            { label: 'Type', value: historyAccount.account_type === 'current' ? 'Current' : historyAccount.account_type === 'loan' ? 'Loan' : historyAccount.account_type === 'credit_card' ? 'Credit Card' : 'Savings' },
            { label: 'Starting', value: formatCurrencyDisplay(historyAccount.starting_balance ?? 0) },
          ]}
          emptyFallbackLabel="No balance history yet"
          onClose={closeBalanceHistory}
          onUpdateBalance={openCorrectionFromHistory}
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
