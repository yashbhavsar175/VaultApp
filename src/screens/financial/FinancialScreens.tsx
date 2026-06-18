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
  addCreditCard,
} from '../../lib/database/financial';
import { getTransactions } from '../../lib/core';
import { scheduleDueReminders } from '../../lib/services/scheduledNotifications';
import { BalanceKind, BalanceOwnerType, BalanceSnapshot, BankAccount, Transaction } from '../../types';
import { useTheme } from '../../context/ThemeContext';
import { ScreenWrapper, Card, AppButton, AppInput, AppHeader, AppConfirmModal } from '../../components';
import BalanceCorrectionModal, { BalanceCorrectionKindOption } from '../../components/BalanceCorrectionModal';
import BalanceHistoryModal from '../../components/BalanceHistoryModal';
import { getBankColor, getBankSuggestions } from '../../config';
import { getCached, setCache, CACHE_KEYS } from '../../lib/services/cache';
import { financeDataChangedAffects, subscribeFinanceDataChanged } from '../../lib/services/dataEvents';
import { runWhenIdle } from '../../utils/runWhenIdle';
import { formatCurrencyDisplay as formatAmount } from '../../utils/format';
import {
  BankAccountBalanceView,
  BankAccountDetailView,
  CreditCardBalanceView,
  CreditCardDetailView,
  PendingDetectedBalanceSummary,
  getAccountBalanceViewModels,
  getBalanceFreshnessLabel,
  getBalanceKindLabel,
  getBalanceConfidenceLabel,
  getBalanceSourceLabel,
  getBankAccountAssetBalance,
  getBankAccountDisplayBalance,
  getBankAccountDetailView,
  getLegacyCreditCardPosition,
  getCreditCardDetailView,
  getCreditCardBalanceViewModels,
  getPendingDetectedBalanceSummary,
  getTotalAssetBankBalance,
  isAssetBankAccount,
} from '../../lib/services/balanceViewModel';
import {
  getCategoryIcon,
  getTransactionDisplayName,
  getTransactionSourceLabel,
  inferTransactionCategory,
} from '../../utils/transactionPresentation';
import {
  AccountRemovalImpact,
  RemovableOwnerType,
  getAccountRemovalImpact,
  removeOrArchiveOwner,
} from '../../lib/services/accountRemoval';
import { BarChart, PieChart } from 'react-native-gifted-charts';

// ═══════════════════════════════════════════════════════════════════════════════
// BANKS SCREEN
// ═══════════════════════════════════════════════════════════════════════════════

const EMPTY_PENDING_BALANCE_SUMMARY: PendingDetectedBalanceSummary = {
  total: 0,
  bank_account: 0,
  credit_card: 0,
  debit_card: 0,
  loan: 0,
};

function parseAmountField(value: string, allowBlank = false): number | null {
  const trimmed = value.trim();
  if (!trimmed) return allowBlank ? null : NaN;
  let normalized = trimmed.replace(/[,\s₹Rs.]/gi, '');
  if (normalized.toLowerCase().endsWith('k')) {
    normalized = (parseFloat(normalized) * 1000).toString();
  }
  if (!/^\d+(\.\d+)?$/.test(normalized)) return NaN;
  return Number(normalized);
}

const FINANCIAL_ACTION_SIZE = 44;

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

type HistoryTarget =
  | { type: 'bank_account'; account: BankAccount }
  | { type: 'credit_card'; card: CreditCardBalanceView };

type RemovalTarget = {
  ownerType: RemovableOwnerType;
  ownerId: string;
  label: string;
};

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

function formatBalanceUpdatedLabel(lastUpdated?: string | null): string {
  if (!lastUpdated) return 'No update yet';

  const updated = new Date(lastUpdated);
  if (Number.isNaN(updated.getTime())) return 'Updated recently';

  const diffMs = Date.now() - updated.getTime();
  if (diffMs < 60 * 1000) return 'Just now';
  const diffDays = Math.floor(diffMs / (24 * 60 * 60 * 1000));
  if (diffDays <= 0) return 'Updated today';
  if (diffDays === 1) return 'Updated 1 day ago';
  return `Updated ${diffDays} days ago`;
}

function correctionTargetForBankAccount(account: BankAccount): CorrectionTarget {
  if (account.account_type === 'loan') {
    return {
      ownerType: 'loan',
      ownerId: account.id,
      ownerDisplayName: `${account.bank_name} loan ••${account.account_last4}`,
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
      ownerDisplayName: `${account.bank_name} card ••${account.account_last4}`,
      cardLast4: account.account_last4,
      detectedBankName: account.bank_name,
      kindOptions: creditCardCorrectionKinds,
      defaultKind: 'outstanding',
    };
  }

  return {
    ownerType: 'bank_account',
    ownerId: account.id,
    ownerDisplayName: `${account.bank_name} ••${account.account_last4}`,
    accountLast4: account.account_last4,
    detectedBankName: account.bank_name,
    kindOptions: bankCorrectionKinds,
    defaultKind: 'available_balance',
  };
}

function correctionTargetForCreditCard(card: CreditCardBalanceView): CorrectionTarget {
  return {
    ownerType: 'credit_card',
    ownerId: card.creditCardId,
    ownerDisplayName: `${card.cardName || card.bankName} ••${card.cardLast4}`,
    cardLast4: card.cardLast4,
    detectedBankName: card.bankName,
    kindOptions: creditCardCorrectionKinds,
    defaultKind: 'outstanding',
  };
}

function formatDueDateLabel(paymentDueDate?: string | null): string | null {
  if (!paymentDueDate) return null;
  const dueDate = new Date(`${paymentDueDate}T00:00:00`);
  if (Number.isNaN(dueDate.getTime())) return null;
  return dueDate.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
}

function buildRemovalMessage(label: string, impact: AccountRemovalImpact): string {
  const historyCount = Object.values(impact.counts).reduce((sum, count) => sum + count, 0);
  const countLine = `Safety dependencies found: ${historyCount}.`;
  
  return [
    `Delete ${label}?`,
    'The account and all its transaction history, snapshots, and statements will be permanently deleted.',
    countLine,
    'This action cannot be undone.',
  ].join('\n\n');
}

export function BanksScreen() {
  const navigation = useNavigation();
  const { colors, typography, spacing, borderRadius } = useTheme();
  const [banks, setBanks] = useState<BankAccount[]>([]);
  const [balanceViews, setBalanceViews] = useState<Record<string, BankAccountBalanceView>>({});
  const [creditCardViews, setCreditCardViews] = useState<CreditCardBalanceView[]>([]);

  const [pendingDetectedSummary, setPendingDetectedSummary] = useState<PendingDetectedBalanceSummary>(
    EMPTY_PENDING_BALANCE_SUMMARY
  );
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
  const [correctionTarget, setCorrectionTarget] = useState<CorrectionTarget | null>(null);
  const [historyTarget, setHistoryTarget] = useState<HistoryTarget | null>(null);
  const [bankHistoryDetail, setBankHistoryDetail] = useState<BankAccountDetailView | null>(null);
  const [cardHistoryDetail, setCardHistoryDetail] = useState<CreditCardDetailView | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);

  // Form state
  const [bankName, setBankName] = useState('');
  const [accountLast4, setAccountLast4] = useState('');
  const [accountType, setAccountType] = useState<'savings' | 'current' | 'credit_card' | 'loan'>('savings');
  const [startingBalance, setStartingBalance] = useState('');
  const [currentBalance, setCurrentBalance] = useState('');
  const [creditLimit, setCreditLimit] = useState('');
  const [loanTotal, setLoanTotal] = useState('');
  const [monthlyEmiAmount, setMonthlyEmiAmount] = useState('');
  const [saving, setSaving] = useState(false);
  
  // Autocomplete state
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);

  const lastDataStringRef = useRef<string | null>(null);
  const bankDataRequestRef = useRef(0);
  const balanceViewsRequestRef = useRef(0);
  const cardsAndAccountsReloadQueueRef = useRef<Promise<void>>(Promise.resolve());

  const loadBalanceViews = useCallback(async () => {
    const requestId = ++balanceViewsRequestRef.current;
    try {
      const [accountViews, cardViews, pendingSummary] = await Promise.all([
        getAccountBalanceViewModels(),
        getCreditCardBalanceViewModels(),
        getPendingDetectedBalanceSummary(),
      ]);

      if (requestId !== balanceViewsRequestRef.current) return;
      setBalanceViews(Object.fromEntries(accountViews.map(view => [view.accountId, view])));
      setCreditCardViews(cardViews);
      setPendingDetectedSummary(pendingSummary);
      
      await setCache(CACHE_KEYS.BALANCE_VIEWS, { accountViews, cardViews, pendingSummary });
    } catch (error) {
      if (requestId !== balanceViewsRequestRef.current) return;
      console.warn('[Balances] Failed to load balance view models:', {
        message: error instanceof Error ? error.message : 'unknown_error',
      });
    }
  }, []);



  const loadData = useCallback(async (forceFresh = false) => {
    const requestId = ++bankDataRequestRef.current;
    try {
      // Show cached data instantly
      if (!forceFresh) {
        const [cachedBanks, cachedViews] = await Promise.all([
          getCached<BankAccount[]>(CACHE_KEYS.BANK_ACCOUNTS),
          getCached<any>(CACHE_KEYS.BALANCE_VIEWS),
        ]);
        if (requestId !== bankDataRequestRef.current) return;
        
        if (cachedViews && cachedViews.data) {
          const { accountViews, cardViews, pendingSummary } = cachedViews.data;
          setBalanceViews(Object.fromEntries(accountViews.map((view: any) => [view.accountId, view])));
          setCreditCardViews(cardViews);
          setPendingDetectedSummary(pendingSummary);
        }

        if (cachedBanks) {
          const cachedStr = JSON.stringify(cachedBanks.data);
          if (lastDataStringRef.current !== cachedStr) {
            lastDataStringRef.current = cachedStr;
            setBanks(cachedBanks.data);
          }
          setLoading(false);
          
          loadBalanceViews();

          // Skip network call if cache is fresh
          if (!cachedBanks.isStale) return;
        }
      }

      // Then fetch fresh from cloud
      const banksData = await getBankAccounts();
      if (requestId !== bankDataRequestRef.current) return;
      const dataStr = JSON.stringify(banksData);
      
      if (lastDataStringRef.current !== dataStr) {
        lastDataStringRef.current = dataStr;
        setBanks(banksData);
      }
      await setCache(CACHE_KEYS.BANK_ACCOUNTS, banksData);
      if (requestId !== bankDataRequestRef.current) return;
      await loadBalanceViews();
    } catch (error) {
      if (requestId !== bankDataRequestRef.current) return;
      console.error('Error loading data:', error);
      Toast.show({
        type: 'error',
        text1: 'Error',
        text2: 'Failed to load bank accounts',
      });
    } finally {
      setLoading(false);
    }
  }, [loadBalanceViews]);

  const reloadCardsAndAccounts = useCallback(() => {
    const reload = cardsAndAccountsReloadQueueRef.current.then(
      () => loadData(true),
      () => loadData(true)
    );
    cardsAndAccountsReloadQueueRef.current = reload.catch(() => undefined);
    return reload;
  }, [loadData]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  useFocusEffect(
    useCallback(() => {
      const task = runWhenIdle(() => {
        loadData();
      });
      return () => task.cancel();
    }, [loadData])
  );

  useFocusEffect(
    useCallback(() => {
      return subscribeFinanceDataChanged(payload => {
        if (financeDataChangedAffects(payload, ['accounts', 'balances'])) {
          reloadCardsAndAccounts();
        }
      });
    }, [reloadCardsAndAccounts])
  );

  const onRefresh = async () => {
    try {
      setRefreshing(true);
      const banksData = await getBankAccounts();
      const dataStr = JSON.stringify(banksData);
      lastDataStringRef.current = dataStr;
      setBanks(banksData);
      await setCache(CACHE_KEYS.BANK_ACCOUNTS, banksData);
      await loadBalanceViews();
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

  const handleCorrectionSaved = async (snapshot: BalanceSnapshot) => {
    const ownerId = snapshot.owner_id;
    const amount = Number(snapshot.amount);
    if (ownerId && Number.isFinite(amount)) {
      balanceViewsRequestRef.current += 1;
      setBalanceViews(prev => {
        const existing = prev[ownerId];
        const account = banks.find(item => item.id === ownerId);
        return {
          ...prev,
          [ownerId]: {
            accountId: ownerId,
            bankName: existing?.bankName || account?.bank_name || correctionTarget?.detectedBankName || 'Account',
            accountLast4: existing?.accountLast4 || account?.account_last4 || correctionTarget?.accountLast4 || '',
            accountType: existing?.accountType || account?.account_type || (snapshot.owner_type === 'loan' ? 'loan' : 'savings'),
            displayBalance: amount,
            balanceKind: snapshot.balance_kind,
            source: 'manual',
            confidence: 'exact',
            lastUpdated: snapshot.detected_at,
            isEstimated: false,
            sourceLabel: getBalanceSourceLabel('manual'),
            confidenceLabel: getBalanceConfidenceLabel('exact'),
            staleWarning: false,
          },
        };
      });
      if (snapshot.owner_type === 'bank_account' || snapshot.owner_type === 'loan') {
        setBanks(prev => {
          const next = prev.map(bank => bank.id === ownerId ? { ...bank, balance: amount } : bank);
          void setCache(CACHE_KEYS.BANK_ACCOUNTS, next);
          return next;
        });
      }
    }

    loadBalanceViews();
    Toast.show({
      type: 'success',
      text1: 'Balance updated',
    });
  };

  const openBankHistory = async (account: BankAccount) => {
    setHistoryTarget({ type: 'bank_account', account });
    setBankHistoryDetail(null);
    setCardHistoryDetail(null);
    setHistoryLoading(true);
    try {
      setBankHistoryDetail(await getBankAccountDetailView(account.id));
    } catch (error) {
      console.warn('[Balances] Failed to load bank account history:', {
        message: error instanceof Error ? error.message : 'unknown_error',
      });
      Toast.show({
        type: 'error',
        text1: 'History unavailable',
        text2: 'Could not load balance history',
      });
    } finally {
      setHistoryLoading(false);
    }
  };

  const openCreditCardHistory = async (card: CreditCardBalanceView) => {
    setHistoryTarget({ type: 'credit_card', card });
    setBankHistoryDetail(null);
    setCardHistoryDetail(null);
    setHistoryLoading(true);
    try {
      setCardHistoryDetail(await getCreditCardDetailView(card.creditCardId));
    } catch (error) {
      console.warn('[Balances] Failed to load credit card history:', {
        message: error instanceof Error ? error.message : 'unknown_error',
      });
      Toast.show({
        type: 'error',
        text1: 'History unavailable',
        text2: 'Could not load card history',
      });
    } finally {
      setHistoryLoading(false);
    }
  };

  const closeBalanceHistory = () => {
    setHistoryTarget(null);
    setBankHistoryDetail(null);
    setCardHistoryDetail(null);
    setHistoryLoading(false);
  };

  const openCorrectionFromHistory = () => {
    if (!historyTarget) return;
    const target = historyTarget.type === 'bank_account'
      ? correctionTargetForBankAccount(historyTarget.account)
      : correctionTargetForCreditCard(historyTarget.card);
    closeBalanceHistory();
    setCorrectionTarget(target);
  };

  const calculateCurrentBalance = (bank: BankAccount): number => {
    return getBankAccountDisplayBalance(bank, balanceViews[bank.id]);
  };

  const getTotalBalance = (): number => {
    return getTotalAssetBankBalance(banks, balanceViews);
  };

  const activeBankAccounts = banks.filter(account =>
    account.account_type === 'savings' || account.account_type === 'current' || !account.account_type
  );
  const legacyCreditCardAccounts = banks.filter(account => account.account_type === 'credit_card');
  const loanAccounts = banks.filter(account => account.account_type === 'loan');
  const hiddenCount = 0;
  const legacyCreditCardOutstanding = legacyCreditCardAccounts.reduce(
    (sum, account) => sum + getLegacyCreditCardPosition(account, balanceViews[account.id]).outstanding,
    0
  );
  const creditCardOutstanding = creditCardViews.reduce(
    (sum, card) => sum + card.outstanding,
    legacyCreditCardOutstanding
  );
  const loanOutstanding = loanAccounts.reduce(
    (sum, account) => sum + getBankAccountDisplayBalance(account, balanceViews[account.id]),
    0
  );

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
    setCurrentBalance((bank.balance ?? bank.starting_balance).toString());
    setCreditLimit(bank.credit_limit?.toString() || '0');
    setLoanTotal(bank.loan_total?.toString() || '0');
    setMonthlyEmiAmount(bank.monthly_emi_amount?.toString() || '');
    setShowAddModal(true);
  };

  const openRemoveConfirm = async (target: RemovalTarget) => {
    try {
      const impact = await getAccountRemovalImpact(target.ownerType, target.ownerId);
      const canRemove = true;
      setConfirmDialog({
        visible: true,
        title: 'Delete Account/Card',
        message: buildRemovalMessage(target.label, impact),
        confirmText: 'Delete',
        isDestructive: true,
        onConfirm: async () => {
          setConfirmDialog(null);
          if (!canRemove) return;

          try {
            await removeOrArchiveOwner(target.ownerType, target.ownerId);
            await reloadCardsAndAccounts();
            Toast.show({
              type: 'success',
              text1: 'Deleted',
              text2: 'The account and its history have been permanently deleted.',
            });
          } catch {
            await reloadCardsAndAccounts();
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

  const handleDeleteBank = (bank: BankAccount) => {
    openRemoveConfirm({
      ownerType: 'bank_account',
      ownerId: bank.id,
      label: `${bank.bank_name} ••${bank.account_last4}`,
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
    setMonthlyEmiAmount('');
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

    const balance = accountType === 'loan' ? 0 : (parseAmountField(startingBalance) ?? 0);
    if (accountType !== 'loan' && (startingBalance && balance === 0 && startingBalance !== '0')) {
      // Just a basic check in case they typed junk
    }

    const current = accountType === 'loan'
      ? parseAmountField(currentBalance)
      : parseAmountField(currentBalance);
    if (accountType === 'loan' && (current === null || !Number.isFinite(current) || current < 0)) {
      Toast.show({
        type: 'error',
        text1: 'Invalid',
        text2: 'Please enter a valid current outstanding amount',
      });
      return;
    }
    if (accountType !== 'loan' && editingBank && (typeof current !== 'number' || Number.isNaN(current))) {
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

    const loan = parseAmountField(loanTotal);
    if (accountType === 'loan' && (loan === null || !Number.isFinite(loan) || loan <= 0)) {
      Toast.show({
        type: 'error',
        text1: 'Invalid',
        text2: 'Please enter a valid total loan amount',
      });
      return;
    }

    const parsedMonthlyEmi = parseAmountField(monthlyEmiAmount, true);
    if (accountType === 'loan' && parsedMonthlyEmi !== null && (!Number.isFinite(parsedMonthlyEmi) || parsedMonthlyEmi < 0)) {
      Toast.show({
        type: 'error',
        text1: 'Invalid',
        text2: 'Please enter a valid monthly EMI amount',
      });
      return;
    }

    setSaving(true);
    setShowAddModal(false); // Close immediately for fast UI response
    try {
      if (editingBank) {
        await updateBankAccount(editingBank.id, {
          bank_name: bankName.trim(),
          account_last4: accountLast4.trim(),
          account_type: accountType,
          starting_balance: accountType === 'loan' ? current || 0 : balance,
          balance: accountType === 'loan' ? current || 0 : current || 0,
          credit_limit: limit,
          loan_total: accountType === 'loan' ? loan || 0 : 0,
          monthly_emi_amount: accountType === 'loan' ? parsedMonthlyEmi : null,
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
          starting_balance: accountType === 'loan' ? current || 0 : balance,
          credit_limit: limit,
          loan_total: accountType === 'loan' ? loan || 0 : 0,
          monthly_emi_amount: accountType === 'loan' ? parsedMonthlyEmi : null,
          upi_ids: [],
        });
        Toast.show({
          type: 'success',
          text1: 'Added',
          text2: 'Bank account added successfully',
        });
      }

      resetForm();
      loadData(true);
    } catch {
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
    const balanceView = balanceViews[item.id];
    const accountType = item.account_type || 'savings';
    const bankColor = getBankColor(item.bank_name);
    const creditPosition = getLegacyCreditCardPosition(item, balanceView);
    const currentBalance = accountType === 'credit_card'
      ? creditPosition.outstanding
      : calculateCurrentBalance(item);
    const balanceLabel = accountType === 'loan'
      ? 'Outstanding'
      : accountType === 'credit_card'
        ? 'Outstanding'
        : 'Latest Balance';
    
    let balanceColor = currentBalance >= 0 ? '#10b981' : '#ef4444';
    
    if (accountType === 'credit_card') {
      balanceColor = '#ef4444';
    } else if (accountType === 'loan') {
      balanceColor = '#ef4444';
    }

    return (
      <Card style={{ marginBottom: spacing.lg, padding: spacing.lg }}>
        <View style={{ flexDirection: 'row', alignItems: 'flex-start' }}>
          <View style={{
              width: 44,
              height: 44,
              borderRadius: 22,
              backgroundColor: bankColor,
              justifyContent: 'center',
              alignItems: 'center',
              marginRight: spacing.md,
            }}>
              <Text style={{ color: '#fff', fontSize: 16, fontWeight: 'bold' }}>
                {item.bank_name.charAt(0).toUpperCase()}
              </Text>
            </View>
          <View style={{ flex: 1, minWidth: 0 }}>
              <Text
                numberOfLines={1}
                style={[typography.body, { color: colors.text, fontWeight: '700', fontSize: 16 }]}>
                {item.bank_name}
              </Text>
              <Text numberOfLines={1} style={[typography.caption, { color: colors.subtext, fontSize: 12, marginTop: 4 }]}>
                ••{item.account_last4} · {accountType === 'current' ? 'Current' : accountType === 'loan' ? 'Loan' : accountType === 'credit_card' ? 'Credit Card' : 'Savings'}
              </Text>
              <View style={{ marginTop: spacing.md }}>
                <Text style={[typography.caption, { color: colors.subtext, fontSize: 11 }]}>
                  {balanceLabel}
                </Text>
                <Text
                  numberOfLines={1}
                  adjustsFontSizeToFit
                  minimumFontScale={0.78}
                  style={[typography.h3, { color: balanceColor, fontSize: 24, lineHeight: 30, fontWeight: '700', marginTop: 2 }]}>
                  {formatAmount(currentBalance)}
                </Text>
                <Text
                  numberOfLines={1}
                  style={[typography.caption, {
                    color: balanceView?.staleWarning ? '#f59e0b' : colors.subtext,
                    fontSize: 12,
                    marginTop: 6,
                  }]}>
                  {balanceView?.sourceLabel || 'Calculated'} · {balanceView?.confidenceLabel || 'Estimated'} · {formatBalanceUpdatedLabel(balanceView?.lastUpdated)}
                </Text>
                {accountType === 'credit_card' && (
                  <Text style={[typography.caption, { color: colors.subtext, marginTop: 4, fontSize: 11 }]}>
                    Available credit {formatAmount(creditPosition.availableCredit)} · Credit limit {formatAmount(creditPosition.creditLimit)}
                  </Text>
                )}
                {accountType === 'loan' && item.loan_total > 0 && (
                  <Text style={[typography.caption, { color: colors.subtext, marginTop: 4, fontSize: 11 }]}>
                    Original loan {formatAmount(item.loan_total)}
                    {item.monthly_emi_amount ? ` · EMI ${formatAmount(item.monthly_emi_amount)}` : ''}
                  </Text>
                )}
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
            onPress={() => openBankHistory(item)}
            accessibilityLabel="View balance history"
            accessibilityRole="button"
            style={{
              minHeight: FINANCIAL_ACTION_SIZE,
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
            onPress={() => setCorrectionTarget(correctionTargetForBankAccount(item))}
            accessibilityLabel="Update balance"
            accessibilityRole="button"
            style={{
              minHeight: FINANCIAL_ACTION_SIZE,
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
            onPress={() => handleEditBank(item)}
            accessibilityLabel="Edit bank account"
            accessibilityRole="button"
            style={{
              width: FINANCIAL_ACTION_SIZE,
              minHeight: FINANCIAL_ACTION_SIZE,
              backgroundColor: colors.accent + '15',
              borderRadius: 12,
              alignItems: 'center',
              justifyContent: 'center',
            }}>
            <MaterialCommunityIcons name="pencil" size={18} color={colors.accent} />
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => handleDeleteBank(item)}
            accessibilityLabel="Hide or remove bank account"
            accessibilityRole="button"
            style={{
              width: FINANCIAL_ACTION_SIZE,
              minHeight: FINANCIAL_ACTION_SIZE,
              backgroundColor: colors.error + '10',
              borderRadius: 12,
              alignItems: 'center',
              justifyContent: 'center',
            }}>
            <MaterialCommunityIcons name="archive-outline" size={18} color="#f59e0b" />
          </TouchableOpacity>
          </View>
      </Card>
    );
  };



  const totalBalance = getTotalBalance();

  return (
    <ScreenWrapper>
      <AppHeader 
        title="Accounts & Cards"
        showBack={true}
        rightAction={{
          icon: "plus",
          onPress: handleAddBank
        }}
      />
      
      <Card style={{ margin: spacing.lg, padding: spacing.lg }}>
        <Text style={[typography.caption, { color: colors.subtext, marginBottom: spacing.sm, textTransform: 'uppercase', fontWeight: '700' }]}>Summary</Text>
        <Text style={[typography.h2, { color: totalBalance >= 0 ? colors.success : colors.error }]}>
          {formatAmount(totalBalance)}
        </Text>
        <Text style={[typography.caption, { color: colors.subtext, marginTop: 2 }]}>Cash & bank balance</Text>
        <View style={{ marginTop: spacing.md, gap: spacing.sm }}>
          <View style={styles.accountsSummaryRow}>
            <Text style={[typography.caption, { color: colors.subtext }]}>Credit card outstanding</Text>
            <Text style={[typography.caption, { color: '#ef4444', fontWeight: '700' }]}>{formatAmount(creditCardOutstanding)}</Text>
          </View>
          <View style={styles.accountsSummaryRow}>
            <Text style={[typography.caption, { color: colors.subtext }]}>Loan outstanding</Text>
            <Text style={[typography.caption, { color: '#ef4444', fontWeight: '700' }]}>{formatAmount(loanOutstanding)}</Text>
          </View>
          <View style={styles.accountsSummaryRow}>
            <Text style={[typography.caption, { color: colors.subtext }]}>Hidden / Archived</Text>
            <Text style={[typography.caption, { color: colors.text, fontWeight: '700' }]}>{hiddenCount}</Text>
          </View>
        </View>
      </Card>

      {pendingDetectedSummary.total > 0 && (
        <TouchableOpacity
          onPress={() => (navigation as any).navigate('DetectedAccountsScreen')}
          accessibilityLabel="Review detected accounts"
          accessibilityRole="button"
          style={{
            minHeight: 48,
            marginHorizontal: spacing.lg,
            marginBottom: spacing.lg,
            backgroundColor: '#f59e0b14',
            borderColor: '#f59e0b35',
            borderWidth: 1,
            borderRadius: 14,
            paddingHorizontal: spacing.md,
            paddingVertical: spacing.sm,
            flexDirection: 'row',
            alignItems: 'center',
          }}>
          <View style={{
            width: 32,
            height: 32,
            borderRadius: 16,
            backgroundColor: '#f59e0b18',
            alignItems: 'center',
            justifyContent: 'center',
            marginRight: spacing.sm,
          }}>
            <MaterialCommunityIcons name="radar" size={18} color="#f59e0b" />
          </View>
          <Text numberOfLines={1} style={[typography.bodyBold, { color: '#f59e0b', flex: 1, fontSize: 14 }]}>
            {pendingDetectedSummary.total} detected account{pendingDetectedSummary.total === 1 ? '' : 's'} need review
          </Text>
          <MaterialCommunityIcons name="chevron-right" size={20} color="#f59e0b" style={{ marginLeft: spacing.sm }} />
        </TouchableOpacity>
      )}

      <FlatList
        data={activeBankAccounts}
        renderItem={renderBankCard}
        keyExtractor={item => item.id}
        contentContainerStyle={{ padding: spacing.lg, paddingTop: 0 }}
        ListHeaderComponent={() => (
          activeBankAccounts.length > 0 ? (
            <Text style={[typography.caption, {
              color: colors.subtext,
              marginBottom: spacing.md,
              textTransform: 'uppercase',
              fontWeight: '700',
            }]}>
              Accounts
            </Text>
          ) : null
        )}
        ListFooterComponent={() => (
          <>
          {(legacyCreditCardAccounts.length > 0 || creditCardViews.length > 0) ? (
            <View style={{ marginTop: spacing.sm }}>
              <Text style={[typography.caption, {
                color: colors.subtext,
                marginBottom: spacing.md,
                textTransform: 'uppercase',
                fontWeight: '700',
              }]}>
                Credit Cards
              </Text>
              {legacyCreditCardAccounts.map(account => <React.Fragment key={account.id}>{renderBankCard({ item: account })}</React.Fragment>)}
              {creditCardViews.map(card => {
                const dueDateLabel = formatDueDateLabel(card.paymentDueDate);
                return (
                  <Card key={card.creditCardId} style={{ marginBottom: spacing.lg, padding: spacing.lg }}>
                    <View style={{ flexDirection: 'row', alignItems: 'flex-start' }}>
                      <View style={{
                        width: 44,
                        height: 44,
                        borderRadius: 22,
                        backgroundColor: '#f59e0b20',
                        justifyContent: 'center',
                        alignItems: 'center',
                        marginRight: spacing.md,
                      }}>
                        <MaterialCommunityIcons name="credit-card-outline" size={22} color="#f59e0b" />
                      </View>
                      <View style={{ flex: 1, minWidth: 0 }}>
                        <Text style={[typography.body, { color: colors.text, fontWeight: '700' }]} numberOfLines={1}>
                          {card.cardName || card.bankName}
                        </Text>
                        <Text numberOfLines={1} style={[typography.caption, { color: colors.subtext, fontSize: 12, marginTop: 4 }]}>
                          {card.bankName} · ••{card.cardLast4}
                        </Text>
                        <View style={{ marginTop: spacing.md }}>
                          <Text style={[typography.caption, { color: colors.subtext, fontSize: 11 }]}>Outstanding</Text>
                          <Text
                            numberOfLines={1}
                            adjustsFontSizeToFit
                            minimumFontScale={0.78}
                            style={[typography.h3, { color: '#ef4444', fontSize: 24, lineHeight: 30, fontWeight: '700', marginTop: 2 }]}>
                            {formatAmount(card.outstanding)}
                          </Text>
                          <Text
                            numberOfLines={1}
                            style={[typography.caption, {
                              color: card.staleWarning ? '#f59e0b' : colors.subtext,
                              marginTop: 6,
                              fontSize: 12,
                            }]}>
                            {card.sourceLabel} · {card.confidenceLabel} · {formatBalanceUpdatedLabel(card.lastUpdated)}
                          </Text>
                          <Text style={[typography.caption, { color: colors.subtext, marginTop: 4, fontSize: 11 }]}>
                            Available credit {formatAmount(card.availableLimit)}
                          </Text>
                        </View>
                      </View>
                    </View>

                    <View style={{ marginTop: spacing.md }}>
                      <View style={{ height: 6, backgroundColor: colors.border, borderRadius: 6, overflow: 'hidden' }}>
                        <View style={{
                          width: `${Math.min(card.utilizationPercent, 100)}%`,
                          height: '100%',
                          backgroundColor: card.utilizationPercent >= 75 ? '#ef4444' : '#10b981',
                        }} />
                      </View>
                      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: spacing.sm }}>
                        <Text style={[typography.caption, { color: colors.subtext, fontSize: 11 }]}>
                          Credit limit {formatAmount(card.creditLimit)}
                        </Text>
                        <Text style={[typography.caption, { color: colors.subtext, fontSize: 11 }]}>
                          {card.utilizationPercent.toFixed(0)}% used
                        </Text>
                      </View>
                      {(card.dueAmount !== null || card.minimumDue !== null || dueDateLabel) && (
                        <Text style={[typography.caption, { color: colors.subtext, marginTop: spacing.xs, fontSize: 11 }]}>
                          Due {card.dueAmount !== null ? formatAmount(card.dueAmount) : '-'}
                          {card.minimumDue !== null ? ` · Min ${formatAmount(card.minimumDue)}` : ''}
                          {dueDateLabel ? ` · ${dueDateLabel}` : ''}
                        </Text>
                      )}
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
                        onPress={() => openCreditCardHistory(card)}
                        accessibilityLabel="View credit card balance history"
                        accessibilityRole="button"
                        style={{
                          minHeight: FINANCIAL_ACTION_SIZE,
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
                        onPress={() => setCorrectionTarget(correctionTargetForCreditCard(card))}
                        accessibilityLabel="Update credit card balance"
                        accessibilityRole="button"
                        style={{
                          minHeight: FINANCIAL_ACTION_SIZE,
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
                        onPress={() => openRemoveConfirm({
                          ownerType: 'credit_card',
                          ownerId: card.creditCardId,
                          label: `${card.cardName || card.bankName} ••${card.cardLast4}`,
                        })}
                        accessibilityLabel="Hide or remove credit card"
                        accessibilityRole="button"
                        style={{
                          width: FINANCIAL_ACTION_SIZE,
                          minHeight: FINANCIAL_ACTION_SIZE,
                          backgroundColor: '#f59e0b' + '12',
                          borderRadius: 12,
                          alignItems: 'center',
                          justifyContent: 'center',
                        }}>
                        <MaterialCommunityIcons name="archive-outline" size={18} color="#f59e0b" />
                      </TouchableOpacity>
                    </View>
                  </Card>
                );
              })}
            </View>
          ) : null}
          {loanAccounts.length > 0 ? (
            <View style={{ marginTop: spacing.sm }}>
              <Text style={[typography.caption, {
                color: colors.subtext,
                marginBottom: spacing.md,
                textTransform: 'uppercase',
                fontWeight: '700',
              }]}>
                Loans / EMI
              </Text>
              {loanAccounts.map(account => <React.Fragment key={account.id}>{renderBankCard({ item: account })}</React.Fragment>)}
            </View>
          ) : null}
          </>
        )}
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
                  placeholder="e.g. Enter bank name"
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
                  <AppInput
                    label="Monthly EMI Amount"
                    placeholder="Leave blank if unknown"
                    value={monthlyEmiAmount}
                    onChangeText={setMonthlyEmiAmount}
                    keyboardType="numeric"
                  />
                  <Text style={[typography.caption, { color: colors.subtext, marginTop: -spacing.sm, marginBottom: spacing.md }]}>
                    Used for Debt Freedom monthly payment estimates.
                  </Text>
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
        <Toast autoHide visibilityTime={3000} swipeable={false} onPress={() => Toast.hide()} />
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

      {historyTarget?.type === 'bank_account' && (
        <BalanceHistoryModal
          visible
          title={historyTarget.account.bank_name}
          subtitle={`${historyTarget.account.account_type === 'current' ? 'Current' : historyTarget.account.account_type === 'loan' ? 'Loan' : historyTarget.account.account_type === 'credit_card' ? 'Credit Card' : 'Savings'} ••${historyTarget.account.account_last4}`}
          balanceLabel={historyTarget.account.account_type === 'credit_card' || historyTarget.account.account_type === 'loan' ? 'Outstanding' : 'Displayed balance'}
          balanceAmount={historyTarget.account.account_type === 'credit_card'
            ? getLegacyCreditCardPosition(
              historyTarget.account,
              bankHistoryDetail ?? balanceViews[historyTarget.account.id]
            ).outstanding
            : bankHistoryDetail?.displayBalance ?? balanceViews[historyTarget.account.id]?.displayBalance ?? calculateCurrentBalance(historyTarget.account)}
          balanceKindLabel={bankHistoryDetail ? getBalanceKindLabel(bankHistoryDetail.balanceKind) : getBalanceKindLabel(balanceViews[historyTarget.account.id]?.balanceKind || 'current_balance')}
          sourceLabel={bankHistoryDetail?.sourceLabel ?? balanceViews[historyTarget.account.id]?.sourceLabel ?? 'Calculated'}
          confidenceLabel={bankHistoryDetail?.confidenceLabel ?? balanceViews[historyTarget.account.id]?.confidenceLabel ?? 'Estimated'}
          freshnessLabel={bankHistoryDetail?.lastUpdated ? getBalanceFreshnessLabel(bankHistoryDetail.lastUpdated) : formatBalanceUpdatedLabel(balanceViews[historyTarget.account.id]?.lastUpdated)}
          loading={historyLoading}
          history={bankHistoryDetail?.history ?? []}
          metrics={[
            { label: 'Type', value: historyTarget.account.account_type === 'current' ? 'Current' : historyTarget.account.account_type === 'loan' ? 'Loan' : historyTarget.account.account_type === 'credit_card' ? 'Credit Card' : 'Savings' },
            { label: 'Starting', value: formatAmount(historyTarget.account.starting_balance) },
          ]}
          onClose={closeBalanceHistory}
          onUpdateBalance={openCorrectionFromHistory}
        />
      )}

      {historyTarget?.type === 'credit_card' && (
        <BalanceHistoryModal
          visible
          title={historyTarget.card.cardName || historyTarget.card.bankName}
          subtitle={`${historyTarget.card.bankName} ••${historyTarget.card.cardLast4}`}
          balanceLabel="Outstanding"
          balanceAmount={cardHistoryDetail?.outstanding ?? historyTarget.card.outstanding}
          balanceKindLabel="Outstanding"
          sourceLabel={cardHistoryDetail?.sourceLabel ?? historyTarget.card.sourceLabel}
          confidenceLabel={cardHistoryDetail?.confidenceLabel ?? historyTarget.card.confidenceLabel}
          freshnessLabel={cardHistoryDetail?.lastUpdated ? getBalanceFreshnessLabel(cardHistoryDetail.lastUpdated) : formatBalanceUpdatedLabel(historyTarget.card.lastUpdated)}
          loading={historyLoading}
          history={cardHistoryDetail?.history ?? []}
          metrics={[
            { label: 'Available credit', value: formatAmount(cardHistoryDetail?.availableLimit ?? historyTarget.card.availableLimit) },
            { label: 'Credit limit', value: formatAmount(cardHistoryDetail?.creditLimit ?? historyTarget.card.creditLimit) },
            { label: 'Due', value: cardHistoryDetail?.dueAmount !== null && cardHistoryDetail?.dueAmount !== undefined ? formatAmount(cardHistoryDetail.dueAmount) : '-' },
            { label: 'Min due', value: cardHistoryDetail?.minimumDue !== null && cardHistoryDetail?.minimumDue !== undefined ? formatAmount(cardHistoryDetail.minimumDue) : '-' },
            { label: 'Utilization', value: `${(cardHistoryDetail?.utilizationPercent ?? historyTarget.card.utilizationPercent).toFixed(0)}%` },
            { label: 'Due date', value: formatDueDateLabel(cardHistoryDetail?.paymentDueDate ?? historyTarget.card.paymentDueDate) ?? '-' },
          ]}
          onClose={closeBalanceHistory}
          onUpdateBalance={openCorrectionFromHistory}
        />
      )}

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

const POPULAR_BANKS = [
  'HDFC',
  'SBI',
  'ICICI',
  'Axis',
  'Kotak',
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
            {POPULAR_BANKS.map((bank) => (
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
  count: number;
  icon: string;
  topMerchant: string;
}

interface CategoryBucket {
  amount: number;
  count: number;
  icon: string;
  topMerchant: string;
  topMerchantAmount: number;
}

const RANGE_DAYS: Record<TimeRange, number> = {
  week: 7,
  month: 30,
  '3months': 90,
  year: 365,
};

function getTimeRangeLabel(range: TimeRange): string {
  if (range === '3months') return '3 Months';
  return range.charAt(0).toUpperCase() + range.slice(1);
}

function getTrendLabel(current: number, previous: number): { text: string; color: string; icon: string } {
  if (previous <= 0 && current <= 0) {
    return { text: 'No movement', color: '#64748B', icon: 'minus' };
  }
  if (previous <= 0) {
    return { text: 'New activity', color: '#3b82f6', icon: 'trending-up' };
  }

  const change = ((current - previous) / previous) * 100;
  if (Math.abs(change) < 1) {
    return { text: 'Flat vs previous', color: '#64748B', icon: 'minus' };
  }

  return {
    text: `${Math.abs(change).toFixed(0)}% ${change > 0 ? 'up' : 'down'} vs previous`,
    color: change > 0 ? '#ef4444' : '#10b981',
    icon: change > 0 ? 'trending-up' : 'trending-down',
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function formatPercent(value: number): string {
  if (!isFinite(value)) return '0%';
  return `${value.toFixed(0)}%`;
}

function getHealthMeta(score: number): { label: string; color: string; icon: string } {
  if (score >= 75) return { label: 'Strong', color: '#10b981', icon: 'shield-check' };
  if (score >= 55) return { label: 'Stable', color: '#3b82f6', icon: 'shield-half-full' };
  if (score >= 35) return { label: 'Watch', color: '#f59e0b', icon: 'shield-alert-outline' };
  return { label: 'Tight', color: '#ef4444', icon: 'alert-octagon-outline' };
}

function getTransactionLabel(transaction: Transaction): string {
  return getTransactionDisplayName(transaction);
}

export function AnalyticsScreen() {
  const { colors, typography, spacing, borderRadius } = useTheme();
  const [timeRange, setTimeRange] = useState<TimeRange>('month');
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [allTransactions, setAllTransactions] = useState<Transaction[]>([]);
  const [banks, setBanks] = useState<BankAccount[]>([]);
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

  const filterByTimeRange = useCallback((data: Transaction[], range: TimeRange): Transaction[] => {
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
  }, []);

  const applyAnalyticsData = useCallback((data: Transaction[], bankData: BankAccount[]) => {
    const filtered = filterByTimeRange(data, timeRange);
    const dataStr = JSON.stringify({ filtered, bankData });

    if (lastDataStringRef.current !== dataStr) {
      lastDataStringRef.current = dataStr;
      setAllTransactions(data);
      setTransactions(filtered);
      setBanks(bankData);
    }
  }, [filterByTimeRange, timeRange]);

  const loadDataSilently = useCallback(async () => {
    const [data, bankData] = await Promise.all([
      getTransactions(),
      getBankAccounts().catch(() => [] as BankAccount[]),
    ]);

    applyAnalyticsData(data, bankData);
    await Promise.all([
      setCache(CACHE_KEYS.TRANSACTIONS, data),
      setCache(CACHE_KEYS.BANK_ACCOUNTS, bankData),
    ]);
  }, [applyAnalyticsData]);

  const loadData = useCallback(async () => {
    try {
      const [cachedTransactions, cachedBanks] = await Promise.all([
        getCached<Transaction[]>(CACHE_KEYS.TRANSACTIONS),
        getCached<BankAccount[]>(CACHE_KEYS.BANK_ACCOUNTS),
      ]);

      if (cachedTransactions || cachedBanks) {
        applyAnalyticsData(cachedTransactions?.data ?? [], cachedBanks?.data ?? []);
        setLoading(false);

        if (!cachedTransactions || !cachedBanks || cachedTransactions.isStale || cachedBanks.isStale) {
          loadDataSilently().catch(error => console.error('Error refreshing analytics data:', error));
        }
        return;
      }

      setLoading(true);
      await loadDataSilently();
    } catch (error) {
      console.error('Error loading analytics data:', error);
    } finally {
      setLoading(false);
    }
  }, [applyAnalyticsData, loadDataSilently]);

  useFocusEffect(
    useCallback(() => {
      const task = runWhenIdle(() => {
        loadData();
      });
      return () => task.cancel();
    }, [loadData])
  );

  useFocusEffect(
    useCallback(() => {
      return subscribeFinanceDataChanged(payload => {
        if (financeDataChangedAffects(payload, ['transactions', 'accounts', 'balances'])) {
          loadDataSilently().catch(error => console.error('Error refreshing analytics after data event:', error));
        }
      });
    }, [loadDataSilently])
  );

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

  const totalLent = transactions
    .filter(t => t.type === 'lent')
    .reduce((sum, t) => sum + Number(t.amount), 0);

  const totalBorrowed = transactions
    .filter(t => t.type === 'borrowed')
    .reduce((sum, t) => sum + Number(t.amount), 0);

  const totalTransfers = transactions
    .filter(t => t.type === 'transfer')
    .reduce((sum, t) => sum + Number(t.amount), 0);

  const netSavings = totalIncome - totalSpent - totalInvestment - totalEMI;
  const totalOutflow = totalSpent + totalInvestment + totalEMI;
  const savingsRate = totalIncome > 0 ? (netSavings / totalIncome) * 100 : 0;
  const expenseRatio = totalIncome > 0 ? (totalSpent / totalIncome) * 100 : 0;
  const periodDays = RANGE_DAYS[timeRange];
  const avgDailySpend = totalSpent / periodDays;
  const accountBalance = banks.reduce((sum, bank) => sum + getBankAccountAssetBalance(bank), 0);
  const assetBankAccounts = banks.filter(isAssetBankAccount);
  const incomeCoverageDays = avgDailySpend > 0 ? accountBalance / avgDailySpend : 0;
  const activeDays = new Set(
    transactions
      .filter(t => t.type === 'expense')
      .map(t => new Date(t.created_at).toDateString())
  ).size;
  const txnCount = transactions.length;
  const autoDetectedCount = transactions.filter(t => t.sms_source && t.sms_source !== 'manual').length;

  const previousTransactions = (() => {
    const endDate = new Date();
    endDate.setDate(endDate.getDate() - periodDays);
    const startDate = new Date(endDate);
    startDate.setDate(endDate.getDate() - periodDays);

    return allTransactions.filter(t => {
      const date = new Date(t.created_at);
      return date >= startDate && date < endDate;
    });
  })();

  const previousSpent = previousTransactions
    .filter(t => t.type === 'expense')
    .reduce((sum, t) => sum + Number(t.amount), 0);
  const previousIncome = previousTransactions
    .filter(t => t.type === 'income')
    .reduce((sum, t) => sum + Number(t.amount), 0);
  const previousOutflow = previousTransactions
    .filter(t => ['expense', 'investment', 'emi'].includes(t.type))
    .reduce((sum, t) => sum + Number(t.amount), 0);

  const spendTrend = getTrendLabel(totalSpent, previousSpent);
  const incomeTrend = getTrendLabel(totalIncome, previousIncome);
  const outflowTrend = getTrendLabel(totalOutflow, previousOutflow);

  // Group by clean, semantic category for chart/list.
  const categoryData: Record<string, CategoryBucket> = {};
  transactions
    .filter(t => t.type === 'expense')
    .forEach(t => {
      const categoryName = inferTransactionCategory(t);
      const merchantName = getTransactionDisplayName(t);
      const amount = Number(t.amount);

      if (!categoryData[categoryName]) {
        categoryData[categoryName] = {
          amount: 0,
          count: 0,
          icon: getCategoryIcon(categoryName),
          topMerchant: merchantName,
          topMerchantAmount: 0,
        };
      }

      categoryData[categoryName].amount += amount;
      categoryData[categoryName].count += 1;
      if (amount > categoryData[categoryName].topMerchantAmount) {
        categoryData[categoryName].topMerchant = merchantName;
        categoryData[categoryName].topMerchantAmount = amount;
      }
    });

  const CHART_COLORS = ['#ef4444', '#f59e0b', '#10b981', '#3b82f6', '#8b5cf6', '#ec4899', '#06b6d4', '#f97316'];

  const categoryChartData: CategoryData[] = Object.entries(categoryData)
    .sort(([, a], [, b]) => b.amount - a.amount)
    .map(([name, bucket], index) => ({
      name,
      amount: bucket.amount,
      color: CHART_COLORS[index % CHART_COLORS.length],
      percentage: totalSpent > 0 ? (bucket.amount / totalSpent) * 100 : 0,
      count: bucket.count,
      icon: bucket.icon,
      topMerchant: bucket.topMerchant,
    }));

  const topCategory = categoryChartData[0];
  const concentrationRisk = topCategory?.percentage || 0;
  const healthScore = clamp(
    50 +
      clamp(savingsRate, -30, 40) * 0.8 -
      clamp(expenseRatio - 60, 0, 60) * 0.45 -
      clamp(concentrationRisk - 45, 0, 55) * 0.25 +
      (accountBalance > 0 ? 8 : -6),
    0,
    100
  );
  const healthMeta = getHealthMeta(healthScore);

  // Smart Insights: dynamic text-based insight about spending
  const getSmartInsight = (): string => {
    if (transactions.length === 0) return 'Add some transactions to unlock spending patterns, category trends, and cashflow health.';
    if (categoryChartData.length === 0) return 'No expense data in this period. Income and investments are still included in cashflow metrics.';
    const top = categoryChartData[0];
    const nextBestAction = savingsRate < 20
      ? 'Protect cashflow by lowering one flexible category this period.'
      : 'Cashflow is in a good zone; keep recurring spends predictable.';
    return `${top.name} leads spending at ${formatPercent(top.percentage)} (${formatAmount(top.amount)}). Savings rate is ${formatPercent(savingsRate)}, spend is ${spendTrend.text.toLowerCase()}, and coverage is ${incomeCoverageDays > 0 ? `${incomeCoverageDays.toFixed(0)} days` : 'not available'}. ${nextBestAction}`;
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

    const allDates = Array.from(new Set([...Object.keys(dailyExpense), ...Object.keys(dailyIncome)])).slice(-10);
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
  const topCategories = categoryChartData.slice(0, 5);

  const topTransactions = transactions
    .filter(t => ['expense', 'emi', 'investment', 'lent'].includes(t.type))
    .sort((a, b) => Number(b.amount) - Number(a.amount))
    .slice(0, 5);

  const weekdaySpend = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((day, index) => {
    const amount = transactions
      .filter(t => t.type === 'expense' && new Date(t.created_at).getDay() === index)
      .reduce((sum, t) => sum + Number(t.amount), 0);
    return { day, amount };
  });
  const maxWeekdaySpend = Math.max(...weekdaySpend.map(item => item.amount), 1);

  const barData = getDailyData();

  const cashflowSegments = [
    { label: 'Expenses', value: totalSpent, color: '#ef4444', icon: 'cart-outline' },
    { label: 'Invested', value: totalInvestment, color: '#7c3aed', icon: 'chart-line' },
    { label: 'EMI', value: totalEMI, color: '#f59e0b', icon: 'credit-card-clock-outline' },
    { label: 'Saved', value: Math.max(netSavings, 0), color: '#10b981', icon: 'piggy-bank-outline' },
    { label: 'Lent', value: totalLent, color: '#06b6d4', icon: 'account-arrow-right-outline' },
  ];
  const cashflowBase = Math.max(totalIncome, totalOutflow, 1);
  const largestTransaction = transactions
    .filter(t => t.type === 'expense')
    .sort((a, b) => Number(b.amount) - Number(a.amount))[0];
  const largestTransactionShare = totalSpent > 0 && largestTransaction
    ? (Number(largestTransaction.amount) / totalSpent) * 100
    : 0;
  const typeMix = [
    { label: 'Income', value: totalIncome, color: '#10b981', icon: 'check-circle-outline' },
    { label: 'Expense', value: totalSpent, color: '#ef4444', icon: 'close-circle-outline' },
    { label: 'Investment', value: totalInvestment, color: '#7c3aed', icon: 'chart-line' },
    { label: 'EMI', value: totalEMI, color: '#f59e0b', icon: 'credit-card-clock-outline' },
    { label: 'Borrowed', value: totalBorrowed, color: '#ec4899', icon: 'account-arrow-left-outline' },
    { label: 'Transfer', value: totalTransfers, color: '#3b82f6', icon: 'swap-horizontal' },
  ].filter(item => item.value > 0);

  // gifted-charts BarChart data (depends on barData)
  const barChartData = barData.labels.flatMap((label, i) => ([
    {
      value: barData.expense[i],
      label,
      frontColor: '#ef4444',
      labelTextStyle: { color: colors.subtext as string, fontSize: 9 },
    },
    {
      value: barData.income[i],
      frontColor: '#10b981',
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
        {loading && (
          <ActivityIndicator color={colors.accent} style={{ marginBottom: spacing.md }} />
        )}

        {/* Time Range Selector */}
        <Card style={{ padding: spacing.xs, marginBottom: spacing.lg }}>
          <View style={styles.timeRangeContainer}>
            {(['week', 'month', '3months', 'year'] as TimeRange[]).map((range) => (
              <TouchableOpacity
                key={range}
                style={[
                  styles.timeRangeButton,
                  { borderRadius: borderRadius.sm },
                  timeRange === range && { backgroundColor: colors.accent },
                ]}
                onPress={() => handleTimeRangeChange(range)}
              >
                <Text
                  style={[
                    typography.caption,
                    { color: colors.subtext },
                    timeRange === range && { color: '#ffffff', fontWeight: '700' },
                  ]}
                >
                  {range === '3months' ? '3 Months' : range.charAt(0).toUpperCase() + range.slice(1)}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </Card>

        <Animated.View style={{ opacity: fadeAnim }}>
          <Card style={[styles.healthCard, { padding: spacing.lg, marginBottom: spacing.lg }]}>
            <View style={styles.healthHeader}>
              <View style={[styles.healthScore, { borderColor: healthMeta.color, backgroundColor: healthMeta.color + '12' }]}>
                <Text style={[typography.h2, { color: healthMeta.color }]}>{healthScore.toFixed(0)}</Text>
                <Text style={[typography.caption, { color: healthMeta.color, fontSize: 10 }]}>score</Text>
              </View>
              <View style={{ flex: 1, marginLeft: spacing.md }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: spacing.xs }}>
                  <MaterialCommunityIcons name={healthMeta.icon} size={20} color={healthMeta.color} />
                  <Text style={[typography.h3, { color: colors.text, marginLeft: spacing.xs }]}>
                    {healthMeta.label} Cashflow
                  </Text>
                </View>
                <Text style={[typography.caption, { color: colors.subtext, lineHeight: 18 }]}>
                  {getTimeRangeLabel(timeRange)} view • {txnCount} entries • {activeDays} active spend day{activeDays === 1 ? '' : 's'}
                </Text>
              </View>
            </View>
            <View style={[styles.healthMeterTrack, { backgroundColor: colors.border, marginTop: spacing.md }]}>
              <View
                style={[
                  styles.healthMeterFill,
                  {
                    width: `${healthScore}%`,
                    backgroundColor: healthMeta.color,
                    borderRadius: borderRadius.sm,
                  },
                ]}
              />
            </View>
          </Card>

          <View style={styles.kpiGrid}>
            {[
              { label: 'Income', value: formatAmount(totalIncome), icon: 'check-circle-outline', color: '#10b981', trend: incomeTrend.text },
              { label: 'Outflow', value: formatAmount(totalOutflow), icon: 'close-circle-outline', color: '#ef4444', trend: outflowTrend.text },
              { label: 'Net Savings', value: formatAmount(netSavings), icon: 'piggy-bank-outline', color: netSavings >= 0 ? '#3b82f6' : '#ef4444', trend: formatPercent(savingsRate) },
              { label: 'Avg Spend / Day', value: formatAmount(avgDailySpend), icon: 'calendar-clock', color: '#f59e0b', trend: `${activeDays}/${periodDays} days` },
              { label: 'Cash & Bank', value: formatAmount(accountBalance), icon: 'bank-outline', color: '#7c3aed', trend: incomeCoverageDays > 0 ? `${incomeCoverageDays.toFixed(0)} day cover` : 'No cover yet' },
              { label: 'Auto Tracked', value: `${autoDetectedCount}`, icon: 'radar', color: '#06b6d4', trend: `${txnCount} total entries` },
            ].map(item => (
              <Card key={item.label} style={[styles.kpiCard, { padding: spacing.md }]}>
                <View style={[styles.kpiIcon, { backgroundColor: item.color + '18', borderRadius: borderRadius.sm }]}>
                  <MaterialCommunityIcons name={item.icon} size={18} color={item.color} />
                </View>
                <Text style={[typography.caption, { color: colors.subtext, marginTop: spacing.sm }]} numberOfLines={1}>
                  {item.label}
                </Text>
                <Text style={[typography.bodyBold, { color: colors.text, marginTop: spacing.xs }]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.75}>
                  {item.value}
                </Text>
                <Text style={[typography.caption, { color: item.color, marginTop: 2, fontSize: 11 }]} numberOfLines={1}>
                  {item.trend}
                </Text>
              </Card>
            ))}
          </View>

          <Card style={{ padding: spacing.lg, marginBottom: spacing.lg }}>
            <View style={styles.sectionTitleRow}>
              <MaterialCommunityIcons name="lightbulb-on-outline" size={20} color="#f59e0b" />
              <Text style={[typography.h3, { color: colors.text, marginLeft: spacing.xs }]}>Smart Insight</Text>
            </View>
            <Text style={[typography.body, { color: colors.text, lineHeight: 22, fontSize: 14, marginTop: spacing.sm }]}>
              {getSmartInsight()}
            </Text>
            {largestTransaction && (
              <View style={[styles.inlineInsight, { borderColor: colors.border, marginTop: spacing.md, borderRadius: borderRadius.sm }]}>
                <MaterialCommunityIcons name="alert-circle-outline" size={18} color={largestTransactionShare > 35 ? '#f59e0b' : '#3b82f6'} />
                <Text style={[typography.caption, { color: colors.subtext, flex: 1, marginLeft: spacing.sm, lineHeight: 18 }]}>
                  Largest spend is {formatAmount(Number(largestTransaction.amount))} on {getTransactionLabel(largestTransaction)}, {formatPercent(largestTransactionShare)} of period spending.
                </Text>
              </View>
            )}
          </Card>

          <Card style={{ padding: spacing.lg, marginBottom: spacing.lg }}>
            <View style={styles.sectionTitleRow}>
              <MaterialCommunityIcons name="swap-vertical" size={20} color="#3b82f6" />
              <Text style={[typography.h3, { color: colors.text, marginLeft: spacing.xs }]}>Cashflow Allocation</Text>
            </View>
            <View style={[styles.stackedTrack, { backgroundColor: colors.border, marginTop: spacing.md, borderRadius: borderRadius.sm }]}>
              {cashflowSegments.filter(item => item.value > 0).map(item => (
                <View
                  key={item.label}
                  style={{
                    width: `${Math.max((item.value / cashflowBase) * 100, 4)}%`,
                    backgroundColor: item.color,
                  }}
                />
              ))}
            </View>
            <View style={styles.segmentGrid}>
              {cashflowSegments.map(item => (
                <View key={item.label} style={styles.segmentItem}>
                  <MaterialCommunityIcons name={item.icon} size={16} color={item.color} />
                  <Text style={[typography.caption, { color: colors.subtext, marginLeft: 4 }]}>{item.label}</Text>
                  <Text style={[typography.caption, { color: colors.text, marginLeft: 'auto', fontWeight: '600' }]}>
                    {formatAmount(item.value)}
                  </Text>
                </View>
              ))}
            </View>
          </Card>

          {categoryChartData.length > 0 ? (
            <Card style={{ padding: spacing.lg, marginBottom: spacing.lg, alignItems: 'center' }}>
              <View style={[styles.sectionTitleRow, { alignSelf: 'stretch', marginBottom: spacing.md }]}>
                <MaterialCommunityIcons name="chart-donut" size={20} color="#7c3aed" />
                <Text style={[typography.h3, { color: colors.text, marginLeft: spacing.xs }]}>Spending Breakdown</Text>
                <Text style={[typography.caption, { color: colors.subtext, marginLeft: 'auto' }]}>
                  {categoryChartData.length} categories
                </Text>
              </View>
              <PieChart
                donut
                data={pieData}
                radius={88}
                innerRadius={58}
                innerCircleColor={colors.card}
                centerLabelComponent={() => (
                  <View style={{ alignItems: 'center' }}>
                    <Text style={[typography.caption, { color: colors.subtext, fontSize: 10 }]}>Spent</Text>
                    <Text style={[typography.bodyBold, { color: colors.text, fontSize: 14 }]}>
                      {formatAmount(totalSpent)}
                    </Text>
                  </View>
                )}
              />
              <View style={{ marginTop: spacing.md, width: '100%' }}>
                {categoryChartData.slice(0, 6).map((item, index) => (
                  <View key={index} style={styles.legendRow}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', flex: 1, minWidth: 0 }}>
                      <View style={[styles.legendIcon, { backgroundColor: item.color + '18', borderRadius: borderRadius.sm }]}>
                        <MaterialCommunityIcons name={item.icon} size={15} color={item.color} />
                      </View>
                      <View style={{ flex: 1, minWidth: 0 }}>
                        <Text style={[typography.bodyBold, { color: colors.text }]} numberOfLines={1}>{item.name}</Text>
                        <Text style={[typography.caption, { color: colors.subtext, marginTop: 2 }]} numberOfLines={1}>
                          {item.count} entr{item.count === 1 ? 'y' : 'ies'} • Top: {item.topMerchant}
                        </Text>
                      </View>
                    </View>
                    <Text style={[typography.bodyBold, { color: colors.text, marginLeft: spacing.sm }]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.75}>
                      {formatAmount(item.amount)}
                    </Text>
                    <Text style={[typography.caption, { color: colors.subtext, marginLeft: spacing.sm, minWidth: 40, textAlign: 'right' }]}>
                      {formatPercent(item.percentage)}
                    </Text>
                  </View>
                ))}
              </View>
            </Card>
          ) : (
            <Card style={{ padding: spacing.lg, marginBottom: spacing.lg, alignItems: 'center' }}>
              <MaterialCommunityIcons name="chart-donut" size={42} color={colors.border} />
              <Text style={[typography.h3, { color: colors.text, marginTop: spacing.sm }]}>No expense mix yet</Text>
              <Text style={[typography.caption, { color: colors.subtext, marginTop: spacing.xs, textAlign: 'center' }]}>
                Expenses in this period will appear here.
              </Text>
            </Card>
          )}

          {barChartData.length > 0 ? (
            <Card style={{ padding: spacing.lg, marginBottom: spacing.lg }}>
              <View style={[styles.sectionTitleRow, { marginBottom: spacing.md }]}>
                <MaterialCommunityIcons name="chart-bar" size={20} color="#10b981" />
                <Text style={[typography.h3, { color: colors.text, marginLeft: spacing.xs }]}>Daily Trend</Text>
              </View>
              <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                <BarChart
                  data={barChartData}
                  barWidth={14}
                  spacing={5}
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
              <View style={{ flexDirection: 'row', justifyContent: 'center', marginTop: spacing.md, gap: 16 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                  <View style={[styles.legendDot, { backgroundColor: '#ef4444' }]} />
                  <Text style={[typography.caption, { color: colors.text }]}>Expense</Text>
                </View>
                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                  <View style={[styles.legendDot, { backgroundColor: '#10b981' }]} />
                  <Text style={[typography.caption, { color: colors.text }]}>Income</Text>
                </View>
              </View>
            </Card>
          ) : (
            <Card style={{ padding: spacing.lg, marginBottom: spacing.lg, alignItems: 'center' }}>
              <MaterialCommunityIcons name="chart-bar" size={42} color={colors.border} />
              <Text style={[typography.h3, { color: colors.text, marginTop: spacing.sm }]}>No trend yet</Text>
              <Text style={[typography.caption, { color: colors.subtext, marginTop: spacing.xs }]}>Transactions will build a daily chart.</Text>
            </Card>
          )}

          {totalSpent > 0 && (
            <Card style={{ padding: spacing.lg, marginBottom: spacing.lg }}>
              <View style={[styles.sectionTitleRow, { marginBottom: spacing.md }]}>
                <MaterialCommunityIcons name="calendar-week" size={20} color="#f59e0b" />
                <Text style={[typography.h3, { color: colors.text, marginLeft: spacing.xs }]}>Weekday Pattern</Text>
              </View>
              {weekdaySpend.map(item => (
                <View key={item.day} style={styles.weekdayRow}>
                  <Text style={[typography.caption, { color: colors.subtext, width: 34 }]}>{item.day}</Text>
                  <View style={[styles.weekdayTrack, { backgroundColor: colors.border, borderRadius: borderRadius.sm }]}>
                    <View
                      style={[
                        styles.weekdayFill,
                        {
                          width: `${(item.amount / maxWeekdaySpend) * 100}%`,
                          backgroundColor: item.amount === maxWeekdaySpend ? '#ef4444' : '#3b82f6',
                          borderRadius: borderRadius.sm,
                        },
                      ]}
                    />
                  </View>
                  <Text style={[typography.caption, { color: colors.text, width: 82, textAlign: 'right' }]} numberOfLines={1}>
                    {formatAmount(item.amount)}
                  </Text>
                </View>
              ))}
            </Card>
          )}

          {typeMix.length > 0 && (
            <Card style={{ padding: spacing.lg, marginBottom: spacing.lg }}>
              <View style={[styles.sectionTitleRow, { marginBottom: spacing.md }]}>
                <MaterialCommunityIcons name="view-dashboard-outline" size={20} color="#06b6d4" />
                <Text style={[typography.h3, { color: colors.text, marginLeft: spacing.xs }]}>Activity Mix</Text>
              </View>
              <View style={styles.typeMixGrid}>
                {typeMix.map(item => (
                  <View key={item.label} style={[styles.typeMixItem, { borderColor: colors.border, borderRadius: borderRadius.sm }]}>
                    <MaterialCommunityIcons name={item.icon} size={18} color={item.color} />
                    <Text style={[typography.caption, { color: colors.subtext, marginTop: 4 }]}>{item.label}</Text>
                    <Text style={[typography.bodyBold, { color: colors.text, marginTop: 2 }]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.75}>
                      {formatAmount(item.value)}
                    </Text>
                  </View>
                ))}
              </View>
            </Card>
          )}

          {topCategories.length > 0 && (
            <Card style={{ padding: spacing.lg, marginBottom: spacing.lg }}>
              <View style={[styles.sectionTitleRow, { marginBottom: spacing.md }]}>
                <MaterialCommunityIcons name="format-list-numbered" size={20} color="#ef4444" />
                <Text style={[typography.h3, { color: colors.text, marginLeft: spacing.xs }]}>Top Categories</Text>
              </View>
              {topCategories.map((cat, index) => (
                <View key={index} style={styles.topCategoryRow}>
                  <View
                    style={[
                      styles.rankBadge,
                      { backgroundColor: cat.color + '18', borderRadius: borderRadius.sm },
                    ]}
                  >
                    <MaterialCommunityIcons name={cat.icon} size={18} color={cat.color} />
                  </View>
                  <View style={{ flex: 1, marginLeft: spacing.md, minWidth: 0 }}>
                    <Text style={[typography.bodyBold, { color: colors.text }]} numberOfLines={1}>
                      {cat.name}
                    </Text>
                    <Text style={[typography.caption, { color: colors.subtext, marginTop: 2, marginBottom: spacing.xs }]} numberOfLines={1}>
                      {cat.count} entr{cat.count === 1 ? 'y' : 'ies'} • Top: {cat.topMerchant}
                    </Text>
                    <View style={[styles.progressBar, { backgroundColor: colors.border, borderRadius: borderRadius.sm }]}>
                      <View
                        style={[
                          styles.progressFill,
                          {
                            width: `${cat.percentage}%`,
                            backgroundColor: cat.color,
                            borderRadius: borderRadius.sm,
                          },
                        ]}
                      />
                    </View>
                  </View>
                  <Text style={[typography.bodyBold, { color: colors.text, marginLeft: spacing.md }]} numberOfLines={1}>
                    {formatAmount(cat.amount)}
                  </Text>
                </View>
              ))}
            </Card>
          )}

          {topTransactions.length > 0 && (
            <Card style={{ padding: spacing.lg, marginBottom: spacing.lg }}>
              <View style={[styles.sectionTitleRow, { marginBottom: spacing.md }]}>
              <MaterialCommunityIcons name="chart-bar" size={20} color="#7c3aed" />
                <Text style={[typography.h3, { color: colors.text, marginLeft: spacing.xs }]}>Largest Entries</Text>
              </View>
              {topTransactions.map((transaction, index) => {
                const categoryName = inferTransactionCategory(transaction);
                const sourceLabel = getTransactionSourceLabel(transaction);
                const icon = getCategoryIcon(categoryName);
                const color = CHART_COLORS[index % CHART_COLORS.length];
                const date = new Date(transaction.created_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });

                return (
                  <View key={transaction.id} style={[styles.transactionRow, index < topTransactions.length - 1 && { borderBottomColor: colors.border, borderBottomWidth: 1 }]}>
                    <View style={[styles.transactionIcon, { backgroundColor: color + '18', borderRadius: borderRadius.sm }]}>
                      <MaterialCommunityIcons name={icon} size={18} color={color} />
                    </View>
                    <View style={{ flex: 1, marginLeft: spacing.sm, minWidth: 0 }}>
                      <Text style={[typography.bodyBold, { color: colors.text }]} numberOfLines={1}>{getTransactionLabel(transaction)}</Text>
                      <Text style={[typography.caption, { color: colors.subtext, marginTop: 2 }]} numberOfLines={1}>
                        {categoryName} • {sourceLabel} • {date}
                      </Text>
                    </View>
                    <Text style={[typography.bodyBold, { color: colors.text, marginLeft: spacing.sm }]} numberOfLines={1}>
                      {formatAmount(Number(transaction.amount))}
                    </Text>
                  </View>
                );
              })}
            </Card>
          )}

          {assetBankAccounts.length > 0 && (
            <Card style={{ padding: spacing.lg }}>
              <View style={[styles.sectionTitleRow, { marginBottom: spacing.md }]}>
                <MaterialCommunityIcons name="bank-outline" size={20} color="#3b82f6" />
                <Text style={[typography.h3, { color: colors.text, marginLeft: spacing.xs }]}>Cash & Bank Snapshot</Text>
                <Text style={[typography.caption, { color: colors.subtext, marginLeft: 'auto' }]}>
                  {assetBankAccounts.length} account{assetBankAccounts.length === 1 ? '' : 's'}
                </Text>
              </View>
              {assetBankAccounts.slice(0, 4).map((bank, index) => {
                const bankBalance = getBankAccountAssetBalance(bank);
                return (
                  <View key={bank.id} style={[styles.accountRow, index < Math.min(assetBankAccounts.length, 4) - 1 && { borderBottomColor: colors.border, borderBottomWidth: 1 }]}>
                    <View style={[styles.bankDot, { backgroundColor: getBankColor(bank.bank_name) }]}>
                      <Text style={{ color: '#fff', fontWeight: '700', fontSize: 12 }}>{bank.bank_name.charAt(0).toUpperCase()}</Text>
                    </View>
                    <View style={{ flex: 1, marginLeft: spacing.sm, minWidth: 0 }}>
                      <Text style={[typography.bodyBold, { color: colors.text }]} numberOfLines={1}>{bank.bank_name}</Text>
                      <Text style={[typography.caption, { color: colors.subtext }]}>••{bank.account_last4}</Text>
                    </View>
                    <Text style={[typography.bodyBold, { color: bankBalance >= 0 ? '#10b981' : '#ef4444' }]} numberOfLines={1}>
                      {formatAmount(bankBalance)}
                    </Text>
                  </View>
                );
              })}
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
  accountsSummaryRow: {
    minHeight: 24,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
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
  healthCard: {
    overflow: 'hidden',
  },
  healthHeader: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  healthScore: {
    width: 76,
    height: 76,
    borderRadius: 38,
    borderWidth: 2,
    justifyContent: 'center',
    alignItems: 'center',
  },
  healthMeterTrack: {
    height: 8,
    overflow: 'hidden',
  },
  healthMeterFill: {
    height: '100%',
  },
  kpiGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  kpiCard: {
    width: '48%',
    marginBottom: 12,
  },
  kpiIcon: {
    width: 32,
    height: 32,
    justifyContent: 'center',
    alignItems: 'center',
  },
  sectionTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  inlineInsight: {
    borderWidth: 1,
    padding: 12,
    flexDirection: 'row',
    alignItems: 'center',
  },
  stackedTrack: {
    height: 12,
    flexDirection: 'row',
    overflow: 'hidden',
  },
  segmentGrid: {
    marginTop: 12,
  },
  segmentItem: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 8,
  },
  weekdayRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10,
  },
  weekdayTrack: {
    flex: 1,
    height: 8,
    overflow: 'hidden',
  },
  weekdayFill: {
    height: '100%',
  },
  typeMixGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
  },
  typeMixItem: {
    width: '48%',
    borderWidth: 1,
    padding: 12,
    marginBottom: 10,
  },
  transactionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
  },
  transactionIcon: {
    width: 36,
    height: 36,
    justifyContent: 'center',
    alignItems: 'center',
  },
  accountRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
  },
  bankDot: {
    width: 34,
    height: 34,
    borderRadius: 17,
    justifyContent: 'center',
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
  legendIcon: {
    width: 32,
    height: 32,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 10,
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
