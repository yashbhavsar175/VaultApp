import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  FlatList,
  ActivityIndicator,
  RefreshControl,
  ScrollView,
} from 'react-native';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';
import Toast from 'react-native-toast-message';
import HapticFeedback from 'react-native-haptic-feedback';
import { financeDataChangedAffects, subscribeFinanceDataChanged } from '../../lib/services/dataEvents';
import {
  getReviewQueue,
  markIgnored,
  markPosted,
  ReviewItem,
  updateReviewCandidatePaymentAppMatch,
} from '../../lib/services/autoTransactionReviewQueue';
import {
  CreditCard,
  getBankAccounts,
  getCreditCards,
  getLoans,
  Loan,
} from '../../lib/database/financial';
import {
  linkLegacyCreditCardAccount,
  recordReviewQueueCardPayment,
  resolveCreditCardMatch,
} from '../../lib/services/reviewQueueCardPayments';
import {
  canRecordEMIWithLoan,
  recordReviewQueueEMIPayment,
  resolveLoanMatch,
} from '../../lib/services/reviewQueueEmiPayments';
import {
  canRecordTransfer,
  getEligibleTransferAccounts,
  recordReviewQueueTransfer,
  resolveTransferSelection,
} from '../../lib/services/reviewQueueTransfers';
import {
  findLocalDuplicateLinkedRefund,
  getRefundExpenseMatches,
  isRefundSchemaMissingError,
  recordReviewQueueRefund,
} from '../../lib/services/reviewQueueRefunds';
import {
  isReviewedDebitCandidate,
  recordReviewQueueExpense,
  sanitizeReviewedExpenseSourceToken,
} from '../../lib/services/reviewQueueExpenses';
import {
  getReviewClassificationPreferenceSuggestions,
  ReviewClassificationPreference,
} from '../../lib/services/reviewClassificationPreferences';
import {
  confirmPaymentAppBankAccountMapping,
  recordMappedPaymentAppBalanceEstimateForCurrentUser,
} from '../../lib/services/paymentAppAccountMappings';
import { saveIncomeReviewDecision } from '../../lib/services/incomeReview';
import { addTransaction, getTransactions } from '../../lib/core';
import { BankAccount, Transaction } from '../../types';
import { useTheme } from '../../context/ThemeContext';
import { ScreenWrapper, AppHeader } from '../../components';
import { formatCurrency } from '../../utils/format';

type ReviewQueueScreenProps = {
  embedded?: boolean;
  filter?: 'all' | 'payments' | 'card_payments';
};

export default function ReviewQueueScreen({ embedded = false, filter = 'all' }: ReviewQueueScreenProps) {
  const { colors, typography, spacing, borderRadius } = useTheme();
  const [items, setItems] = useState<ReviewItem[]>([]);
  const [bankAccounts, setBankAccounts] = useState<BankAccount[]>([]);
  const [legacyCreditCardAccounts, setLegacyCreditCardAccounts] = useState<BankAccount[]>([]);
  const [creditCards, setCreditCards] = useState<CreditCard[]>([]);
  const [loans, setLoans] = useState<Loan[]>([]);
  const [selectedAccounts, setSelectedAccounts] = useState<Record<string, string>>({}); // itemId -> accountId or 'cash'
  const [selectedCreditCards, setSelectedCreditCards] = useState<Record<string, string>>({}); // itemId -> cardId
  const [selectedLoans, setSelectedLoans] = useState<Record<string, string>>({}); // itemId -> loanId
  const [selectedTransferFromAccounts, setSelectedTransferFromAccounts] = useState<Record<string, string>>({});
  const [selectedTransferToAccounts, setSelectedTransferToAccounts] = useState<Record<string, string>>({});
  const [selectedRefundExpenses, setSelectedRefundExpenses] = useState<Record<string, string>>({});
  const [refundSchemaErrors, setRefundSchemaErrors] = useState<Record<string, boolean>>({});
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [preferenceSuggestions, setPreferenceSuggestions] = useState<Record<string, ReviewClassificationPreference>>({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [postingId, setPostingId] = useState<string | null>(null);
  const cardPaymentPostingRef = useRef(false);
  const emiPaymentPostingRef = useRef(false);
  const transferPostingRef = useRef(false);
  const refundPostingRef = useRef(false);
  const isMountedRef = useRef(true);

  useEffect(() => {
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const loadQueueAndBanks = useCallback(async () => {
    try {
      const [allItems, banks, cards, loanData, txData] = await Promise.all([
        getReviewQueue(),
        getBankAccounts(),
        getCreditCards(),
        getLoans(),
        getTransactions(),
      ]);
      if (!isMountedRef.current) return;
      // Only show pending items in the active queue
      const pendingItems = allItems.filter(item => item.status === 'pending');
      setItems(pendingItems);
      // Phase 1 safety: only show standard bank accounts (savings/current), not credit_card or loan
      const allowedAccounts = banks.filter(
        bank => bank.account_type === 'savings' || bank.account_type === 'current'
      );
      setBankAccounts(allowedAccounts);
      setLegacyCreditCardAccounts(banks.filter(bank => bank.account_type === 'credit_card'));
      setCreditCards(cards);
      setLoans(loanData);
      setTransactions(txData);
      setPreferenceSuggestions(await getReviewClassificationPreferenceSuggestions(pendingItems));
    } catch (e) {
      if (!isMountedRef.current) return;
      console.error('Failed to load review data:', e);
      Toast.show({
        type: 'error',
        text1: 'Error',
        text2: 'Failed to load review data',
      });
    } finally {
      if (isMountedRef.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, []);

  useEffect(() => {
    loadQueueAndBanks();
  }, [loadQueueAndBanks]);

  useEffect(() => {
    return subscribeFinanceDataChanged(payload => {
      if (financeDataChangedAffects(payload, ['review', 'accounts'])) {
        loadQueueAndBanks();
      }
    });
  }, [loadQueueAndBanks]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    loadQueueAndBanks();
  }, [loadQueueAndBanks]);

  const visibleItems = useMemo(() => {
    const seen = new Set<string>();
    return items.filter(item => {
      if (seen.has(item.id)) return false;
      seen.add(item.id);

      if (filter === 'card_payments') {
        return item.candidate.autoClass === 'credit_card_bill_payment';
      }

      if (filter === 'payments') {
        return item.candidate.direction !== 'credit'
          && item.candidate.autoClass !== 'credit_card_bill_payment';
      }

      return true;
    });
  }, [filter, items]);

  const getPreselectedAccount = useCallback((item: ReviewItem) => {
    const candidate = item.candidate;
    const mappedBankAccountId = candidate.paymentAppAccountMatch?.mappedBankAccountId;
    if (mappedBankAccountId && bankAccounts.some(bank => bank.id === mappedBankAccountId)) {
      return mappedBankAccountId;
    }
    const accountLast4 = candidate.accountLast4 || (!candidate.cardLast4 ? candidate.last4 : null);
    if (accountLast4) {
      const matches = bankAccounts.filter(bank => bank.account_last4 === accountLast4);
      if (matches.length === 1) return matches[0].id;
    }
    return 'cash';
  }, [bankAccounts]);

  const handleLinkPaymentAppAccount = async (item: ReviewItem) => {
    if (postingId) return;
    const accountSelection = selectedAccounts[item.id] || getPreselectedAccount(item);
    const selectedBank = bankAccounts.find(bank => bank.id === accountSelection);
    const paymentAppMatch = item.candidate.paymentAppAccountMatch;
    if (!selectedBank || !paymentAppMatch) {
      Toast.show({
        type: 'info',
        text1: 'Choose destination account',
        text2: 'Select one of your savings or current accounts.',
      });
      return;
    }

    setPostingId(item.id);
    try {
      const confirmedMatch = await confirmPaymentAppBankAccountMapping({
        sourcePackage: paymentAppMatch.sourcePackage,
        sourceLabel: paymentAppMatch.sourceLabel,
        bankHint: paymentAppMatch.bankHint,
        bankAccountId: selectedBank.id,
      });
      await updateReviewCandidatePaymentAppMatch(item.id, confirmedMatch);
      const sourceHash = item.candidate.redactedPreview.hashSummary.match(/\bhash=([a-f0-9]{8,64})\b/i)?.[1] || null;
      await recordMappedPaymentAppBalanceEstimateForCurrentUser({
        bankAccountId: selectedBank.id,
        amount: item.candidate.amount,
        direction: item.candidate.direction,
        sourcePackage: confirmedMatch.sourcePackage,
        sourceHash,
        timestamp: item.createdAt,
      }).catch(() => false);
      setItems(current => current.map(currentItem => currentItem.id === item.id
        ? {
          ...currentItem,
          candidate: {
            ...currentItem.candidate,
            paymentAppAccountMatch: confirmedMatch,
          },
        }
        : currentItem));
      Toast.show({
        type: 'success',
        text1: 'Destination account linked',
        text2: 'Future matching notifications will suggest this account.',
      });
    } catch {
      Toast.show({
        type: 'error',
        text1: 'Could not link destination account',
        text2: 'The item stays in your queue so you can retry.',
      });
    } finally {
      setPostingId(null);
    }
  };

  const getPreselectedCreditCard = useCallback((item: ReviewItem) => {
    const result = resolveCreditCardMatch(item, creditCards, legacyCreditCardAccounts);
    return result.status === 'matched' ? result.card.id : undefined;
  }, [creditCards, legacyCreditCardAccounts]);

  const getPreselectedLoan = useCallback((item: ReviewItem) => {
    const result = resolveLoanMatch(item, loans);
    return result.status === 'matched' ? result.loan.id : undefined;
  }, [loans]);

  const getPreselectedTransferFrom = useCallback((item: ReviewItem) => {
    const result = resolveTransferSelection(item, bankAccounts);
    return result.fromAccountId;
  }, [bankAccounts]);

  const getPreselectedTransferTo = useCallback((item: ReviewItem) => {
    const result = resolveTransferSelection(item, bankAccounts);
    return result.toAccountId;
  }, [bankAccounts]);

  const handleCreateTransaction = async (item: ReviewItem, type: 'expense' | 'income') => {
    if (postingId) return;
    setPostingId(item.id);
    HapticFeedback.trigger('impactMedium', { enableVibrateFallback: true, ignoreAndroidSystemSettings: false });

    try {
      const accountSelection = selectedAccounts[item.id] || getPreselectedAccount(item);
      const selectedBank = bankAccounts.find(b => b.id === accountSelection);
      const result = type === 'expense'
        ? await recordReviewQueueExpense(item, selectedBank)
        : await (async () => {
          const candidate = item.candidate;
          if (!candidate.amount || candidate.amount <= 0) {
            throw new Error('Valid amount required');
          }
          const transaction = await addTransaction({
            amount: candidate.amount,
            type: 'income',
            note: 'Reviewed income',
            category: 'Reviewed Income',
            account_id: selectedBank?.id,
            account_last4: selectedBank?.account_last4 ||
              candidate.paymentAppAccountMatch?.mappedBankAccountLast4 ||
              candidate.last4 ||
              undefined,
            reference_number: candidate.reference || undefined,
            sms_source: candidate.sourceType === 'notification' ? 'notification' : 'sms',
            sms_sender: candidate.paymentAppAccountMatch?.sourcePackage,
            primary_evidence_id: candidate.evidenceId || undefined,
            account_match_status: candidate.paymentAppAccountMatch?.mappingStatus === 'user_confirmed'
              ? 'manual_confirmed'
              : undefined,
            account_match_confidence: candidate.paymentAppAccountMatch?.mappingStatus === 'user_confirmed'
              ? 'medium'
              : undefined,
            account_match_reason: candidate.paymentAppAccountMatch?.mappingStatus === 'user_confirmed'
              ? 'user_confirmed_app_mapping'
              : undefined,
          });
          await markPosted(item.id, transaction.id);
          try {
            await saveIncomeReviewDecision({
              transaction_id: transaction.id,
              evidence_id: candidate.evidenceId || null,
              decision: 'count_as_income',
              income_source_type: 'other',
              confidence: 'user_confirmed',
              reason_code: 'review_queue_income_confirmed',
            });
          } catch (decisionError) {
            console.error('Failed to save reviewed income decision:', decisionError);
          }
          return { status: 'posted' as const, transactionId: transaction.id };
        })();

      Toast.show({
        type: result.status === 'duplicate' ? 'info' : 'success',
        text1: result.status === 'duplicate' ? 'Already Exists' : 'Transaction Created',
        text2: result.status === 'duplicate'
          ? 'This transaction was already recorded in SpendSense.'
          : `Recorded ${type} of ₹${item.candidate.amount}`,
      });

      setItems(prev => prev.filter(x => x.id !== item.id));
    } catch (e) {
      // DB write failure: candidate intentionally remains 'pending' so user can retry later
      console.error('Failed to create transaction:', e);
      Toast.show({
        type: 'error',
        text1: 'Failed to create transaction',
        text2: 'The item stays in your queue so you can retry.',
      });
    } finally {
      setPostingId(null);
    }
  };

  const handleIgnore = async (id: string) => {
    try {
      HapticFeedback.trigger('impactLight', { enableVibrateFallback: true, ignoreAndroidSystemSettings: false });
      const success = await markIgnored(id);
      if (success) {
        setItems(prev => prev.filter(item => item.id !== id));
        Toast.show({
          type: 'info',
          text1: 'Candidate Ignored',
        });
      }
    } catch (e) {
      console.error('Failed to ignore candidate:', e);
    }
  };

  const handleRecordCardPayment = async (item: ReviewItem) => {
    if (postingId || cardPaymentPostingRef.current) return;
    const cardSelection = selectedCreditCards[item.id] || getPreselectedCreditCard(item);

    if (!cardSelection) {
      Toast.show({
        type: 'info',
        text1: creditCards.length === 0 ? 'Needs credit card setup' : 'Choose Credit Card',
        text2: creditCards.length === 0
          ? 'Add a credit card before recording this payment.'
          : 'Select the credit card this payment belongs to.',
      });
      return;
    }

    cardPaymentPostingRef.current = true;
    setPostingId(item.id);
    HapticFeedback.trigger('impactMedium', { enableVibrateFallback: true, ignoreAndroidSystemSettings: false });

    try {
      const result = await recordReviewQueueCardPayment(item, cardSelection);

      Toast.show({
        type: result.status === 'duplicate' ? 'info' : 'success',
        text1: result.status === 'duplicate' ? 'Already recorded' : 'Card Payment Recorded',
        text2: result.status === 'duplicate'
          ? 'This card payment already exists.'
          : `Recorded card payment of ₹${item.candidate.amount}`,
      });

      setItems(prev => prev.filter(x => x.id !== item.id));
    } catch (e) {
      console.error('Failed to record card payment:', e);
      Toast.show({
        type: 'error',
        text1: 'Failed to record card payment',
        text2: 'The item stays in your queue so you can retry.',
      });
    } finally {
      cardPaymentPostingRef.current = false;
      setPostingId(null);
    }
  };

  const handleLinkLegacyCreditCard = async (item: ReviewItem) => {
    if (postingId || cardPaymentPostingRef.current) return;
    const match = resolveCreditCardMatch(item, creditCards, legacyCreditCardAccounts);

    if (match.status !== 'needs_legacy_link') {
      Toast.show({
        type: 'info',
        text1: 'Needs credit card setup',
        text2: 'Add a credit card before recording this payment.',
      });
      return;
    }

    cardPaymentPostingRef.current = true;
    setPostingId(item.id);
    HapticFeedback.trigger('impactMedium', { enableVibrateFallback: true, ignoreAndroidSystemSettings: false });

    try {
      const result = await linkLegacyCreditCardAccount(match.legacyAccount, creditCards);
      setCreditCards(prev => prev.some(card => card.id === result.card.id) ? prev : [result.card, ...prev]);
      setSelectedCreditCards(prev => ({ ...prev, [item.id]: result.card.id }));
      if (result.archivedLegacy) {
        setLegacyCreditCardAccounts(prev => prev.filter(account => account.id !== match.legacyAccount.id));
      }

      Toast.show({
        type: 'success',
        text1: result.reusedExisting ? 'Credit card linked' : 'Credit card setup linked',
        text2: result.outstandingInference.needsUserConfirmation
          ? 'Confirm current outstanding before using this card in debt calculations.'
          : `Card ••${result.card.last_4_digits} can now record bill payments.`,
      });
    } catch (e) {
      console.error('Failed to link legacy credit card setup:', e);
      Toast.show({
        type: 'error',
        text1: 'Could not link card setup',
        text2: 'The item stays in your queue so you can retry.',
      });
    } finally {
      cardPaymentPostingRef.current = false;
      setPostingId(null);
    }
  };

  const handleRecordEMIPayment = async (item: ReviewItem) => {
    if (postingId || emiPaymentPostingRef.current) return;
    const loanSelection = selectedLoans[item.id] || getPreselectedLoan(item);
    const selectedLoan = loans.find(loan => loan.id === loanSelection);

    if (!selectedLoan) {
      Toast.show({
        type: 'info',
        text1: loans.length === 0 ? 'Needs loan setup' : 'Choose Loan',
        text2: loans.length === 0
          ? 'Add a loan before recording this EMI.'
          : 'Select the loan this EMI belongs to.',
      });
      return;
    }

    if (!canRecordEMIWithLoan(item, selectedLoan)) {
      Toast.show({
        type: 'info',
        text1: 'Needs loan setup',
        text2: 'Add an interest rate to this loan or record an EMI split first.',
      });
      return;
    }

    emiPaymentPostingRef.current = true;
    setPostingId(item.id);
    HapticFeedback.trigger('impactMedium', { enableVibrateFallback: true, ignoreAndroidSystemSettings: false });

    try {
      const result = await recordReviewQueueEMIPayment(item, selectedLoan);

      Toast.show({
        type: result.status === 'duplicate' ? 'info' : 'success',
        text1: result.status === 'duplicate' ? 'Already recorded' : 'EMI Recorded',
        text2: result.status === 'duplicate'
          ? 'This EMI payment already exists.'
          : `Recorded EMI of ₹${item.candidate.amount}`,
      });

      setItems(prev => prev.filter(x => x.id !== item.id));
    } catch (e) {
      console.error('Failed to record EMI payment:', e);
      Toast.show({
        type: 'error',
        text1: 'Failed to record EMI',
        text2: 'The item stays in your queue so you can retry.',
      });
    } finally {
      emiPaymentPostingRef.current = false;
      setPostingId(null);
    }
  };

  const handleCreateTransfer = async (item: ReviewItem) => {
    if (postingId || transferPostingRef.current) return;
    const eligibleTransferAccounts = getEligibleTransferAccounts(bankAccounts);
    const fromAccountId = selectedTransferFromAccounts[item.id] || getPreselectedTransferFrom(item);
    const toAccountId = selectedTransferToAccounts[item.id] || getPreselectedTransferTo(item);

    if (eligibleTransferAccounts.length < 2) {
      Toast.show({
        type: 'info',
        text1: 'Needs at least two bank accounts',
        text2: 'Add two savings or current accounts before creating a transfer.',
      });
      return;
    }

    if (!fromAccountId || !toAccountId) {
      Toast.show({
        type: 'info',
        text1: 'Choose accounts',
        text2: 'Select both From and To accounts.',
      });
      return;
    }

    if (fromAccountId === toAccountId) {
      Toast.show({
        type: 'info',
        text1: 'Choose accounts',
        text2: 'From and To accounts must be different.',
      });
      return;
    }

    if (!canRecordTransfer(item, bankAccounts, fromAccountId, toAccountId)) {
      Toast.show({
        type: 'info',
        text1: 'Choose accounts',
        text2: 'Select savings or current bank accounts for this transfer.',
      });
      return;
    }

    transferPostingRef.current = true;
    setPostingId(item.id);
    HapticFeedback.trigger('impactMedium', { enableVibrateFallback: true, ignoreAndroidSystemSettings: false });

    try {
      const result = await recordReviewQueueTransfer(item, fromAccountId, toAccountId, bankAccounts);

      Toast.show({
        type: result.status === 'duplicate' ? 'info' : 'success',
        text1: result.status === 'duplicate' ? 'Already recorded' : 'Transfer Created',
        text2: result.status === 'duplicate'
          ? 'This transfer already exists.'
          : `Moved ${formatCurrency(item.candidate.amount || 0)} between your accounts`,
      });

      setItems(prev => prev.filter(x => x.id !== item.id));
    } catch (e) {
      console.error('Failed to create transfer:', e);
      Toast.show({
        type: 'error',
        text1: 'Failed to create transfer',
        text2: 'The item stays in your queue so you can retry.',
      });
    } finally {
      transferPostingRef.current = false;
      setPostingId(null);
    }
  };

  const handleLinkRefund = async (item: ReviewItem) => {
    if (postingId || refundPostingRef.current) return;
    const originalExpenseId = selectedRefundExpenses[item.id];
    const originalExpense = transactions.find(tx => tx.id === originalExpenseId);

    if (!originalExpense) {
      Toast.show({
        type: 'info',
        text1: 'Choose Original Expense',
        text2: 'Select the expense this refund belongs to.',
      });
      return;
    }

    refundPostingRef.current = true;
    setPostingId(item.id);
    HapticFeedback.trigger('impactMedium', { enableVibrateFallback: true, ignoreAndroidSystemSettings: false });

    try {
      const result = await recordReviewQueueRefund(item, originalExpense, transactions);

      Toast.show({
        type: result.status === 'duplicate' ? 'info' : 'success',
        text1: result.status === 'duplicate' ? 'Already recorded' : 'Refund Linked',
        text2: result.status === 'duplicate'
          ? 'This refund was already linked to the original expense.'
          : `Linked refund of ${formatCurrency(item.candidate.amount || 0)}`,
      });

      setItems(prev => prev.filter(x => x.id !== item.id));
      await loadQueueAndBanks();
    } catch (e) {
      console.error('Failed to link refund:', e);
      const schemaMissing = isRefundSchemaMissingError(e);
      if (schemaMissing) {
        setRefundSchemaErrors(prev => ({ ...prev, [item.id]: true }));
      }
      Toast.show({
        type: 'error',
        text1: schemaMissing ? 'Run refund migration first' : 'Failed to link refund',
        text2: schemaMissing
          ? 'Database update required before refunds can be posted.'
          : 'The item stays in your queue so you can retry.',
      });
    } finally {
      refundPostingRef.current = false;
      setPostingId(null);
    }
  };

  const getAutoClassLabel = (autoClass: string) => {
    switch (autoClass) {
      case 'bank_debit': return 'Bank Debit';
      case 'bank_credit': return 'Bank Credit';
      case 'credit_card_spend': return 'Credit Card Spend';
      case 'credit_card_bill_payment': return 'Credit card bill payment';
      case 'loan_emi_payment': return 'Loan EMI Payment';
      case 'loan_disbursal': return 'Loan Disbursal';
      case 'upi_payment': return 'UPI Payment';
      case 'upi_received': return 'UPI Received';
      case 'refund': return 'Refund';
      case 'cashback_reward': return 'Cashback Reward';
      case 'wallet_load': return 'Wallet Load';
      case 'self_transfer': return 'Self Transfer';
      case 'unknown_financial': return 'Financial Transaction';
      default: return 'Transaction';
    }
  };

  const isClassSupported = (item: ReviewItem) => {
    if (isReviewedDebitCandidate(item)) return true;
    const supportedClasses = [
      'bank_debit',
      'upi_payment',
      'credit_card_spend',
      'bank_credit',
      'upi_received',
      'cashback_reward',
    ];
    return supportedClasses.includes(item.candidate.autoClass);
  };

  const getPreferenceSuggestionLabel = (preference?: ReviewClassificationPreference) => {
    if (!preference) return null;
    if (preference.action === 'count_as_expense') return 'Saved preference: suggest expense next time';
    if (preference.action === 'not_expense') return 'Saved preference: suggest not expense next time';
    if (preference.action === 'suggest_category' && preference.suggestedCategory) {
      return `Saved preference: suggest ${preference.suggestedCategory} next time`;
    }
    return 'Saved preference: always ask before saving';
  };

  const renderItem = ({ item }: { item: ReviewItem }) => {
    const { candidate, reasons } = item;
    const isCredit = candidate.direction === 'credit';
    const isCardBillPayment = candidate.autoClass === 'credit_card_bill_payment';
    const isLoanEMIPayment = candidate.autoClass === 'loan_emi_payment';
    const isSelfTransfer = candidate.autoClass === 'self_transfer';
    const isRefund = candidate.autoClass === 'refund';
    const isNeutralClass = isCardBillPayment || isLoanEMIPayment || isSelfTransfer;
    const amountColor = isRefund ? '#14b8a6' : isNeutralClass ? colors.accent : isCredit ? '#10b981' : '#ef4444';
    const isSupported = isClassSupported(item);
    const preferenceSuggestion = getPreferenceSuggestionLabel(preferenceSuggestions[item.id]);
    const paymentAppMatch = candidate.paymentAppAccountMatch;
    const destinationNeedsConfirmation = Boolean(
      isCredit && paymentAppMatch && paymentAppMatch.mappingStatus !== 'user_confirmed'
    );

    const activeSelection = selectedAccounts[item.id] || getPreselectedAccount(item);
    const activeCardSelection = selectedCreditCards[item.id] || getPreselectedCreditCard(item);
    const activeCardMatch = isCardBillPayment
      ? resolveCreditCardMatch(item, creditCards, legacyCreditCardAccounts)
      : null;
    const legacyCardLink = activeCardMatch?.status === 'needs_legacy_link' ? activeCardMatch : null;
    const activeDebitBank = bankAccounts.find(bank => bank.id === activeSelection);
    const activeCreditCard = creditCards.find(card => card.id === activeCardSelection);
    const activeLoanSelection = selectedLoans[item.id] || getPreselectedLoan(item);
    const activeLoan = loans.find(loan => loan.id === activeLoanSelection);
    const canRecordActiveEMI = activeLoan ? canRecordEMIWithLoan(item, activeLoan) : false;
    const eligibleTransferAccounts = getEligibleTransferAccounts(bankAccounts);
    const activeTransferFrom = selectedTransferFromAccounts[item.id] || getPreselectedTransferFrom(item);
    const activeTransferTo = selectedTransferToAccounts[item.id] || getPreselectedTransferTo(item);
    const canCreateActiveTransfer = canRecordTransfer(item, bankAccounts, activeTransferFrom, activeTransferTo);
    const refundMatches = isRefund ? getRefundExpenseMatches(item, transactions) : [];
    const activeRefundExpenseId = selectedRefundExpenses[item.id];
    const activeRefundExpense = transactions.find(tx => tx.id === activeRefundExpenseId);
    const activeRefundDuplicate = activeRefundExpense
      ? findLocalDuplicateLinkedRefund(item, activeRefundExpense, transactions)
      : null;
    const refundSchemaMissing = !!refundSchemaErrors[item.id];
    const canLinkActiveRefund = !!activeRefundExpense && !refundSchemaMissing;
    const negativeActionLabel = isCardBillPayment
      ? 'Not a card payment'
      : isCredit
        ? 'Not income'
        : 'Not expense';

    return (
      <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <View style={styles.cardHeader}>
          <View style={[styles.iconContainer, { backgroundColor: colors.border + '50' }]}>
            <MaterialCommunityIcons
              name={candidate.instrumentHint === 'credit_card'
                ? 'credit-card-outline'
                : isLoanEMIPayment
                  ? 'bank-check'
                  : isSelfTransfer
                    ? 'swap-horizontal'
                    : isRefund
                      ? 'cash-refund'
                      : 'bank-outline'}
              size={24}
              color={colors.accent}
            />
          </View>
          <View style={styles.headerText}>
            <Text style={[typography.bodyBold, { color: colors.text }]}>
              {getAutoClassLabel(candidate.autoClass)}
            </Text>
            <Text style={[typography.caption, { color: colors.subtext }]}>
              Source: {sanitizeReviewedExpenseSourceToken(candidate.redactedPreview.detectedSource) || 'Redacted source'}
            </Text>
          </View>
          {candidate.amount !== null && (
            <Text style={[typography.bodyBold, { color: amountColor }]}>
              {isRefund ? 'Refund ' : isNeutralClass ? '' : isCredit ? '+' : '-'}{formatCurrency(candidate.amount)}
            </Text>
          )}
        </View>

        <View style={[styles.divider, { backgroundColor: colors.border }]} />

        <View style={styles.detailsContainer}>
          {candidate.merchantOrPerson && (
            <View style={styles.detailRow}>
              <Text style={[typography.caption, { color: colors.subtext }]}>Merchant / Person</Text>
              <Text style={[typography.body, { color: colors.text, fontWeight: '500' }]}>
                {candidate.merchantOrPerson}
              </Text>
            </View>
          )}

          {candidate.accountLast4 && (
            <View style={styles.detailRow}>
              <Text style={[typography.caption, { color: colors.subtext }]}>Bank account</Text>
              <Text style={[typography.body, { color: colors.text, fontWeight: '500' }]}>
                {activeDebitBank?.bank_name || 'Bank'} ••{candidate.accountLast4}
              </Text>
            </View>
          )}

          {(candidate.cardLast4 || (isCardBillPayment && candidate.last4)) && (
            <View style={styles.detailRow}>
              <Text style={[typography.caption, { color: colors.subtext }]}>Credit card</Text>
              <Text style={[typography.body, { color: colors.text, fontWeight: '500' }]}>
                {(activeCreditCard?.card_name || activeCreditCard?.bank_name || 'Credit Card')} ••{candidate.cardLast4 || candidate.last4}
              </Text>
            </View>
          )}

          {!candidate.accountLast4 && !candidate.cardLast4 && !isCardBillPayment && candidate.last4 && (
            <View style={styles.detailRow}>
              <Text style={[typography.caption, { color: colors.subtext }]}>Instrument Ending</Text>
              <Text style={[typography.body, { color: colors.text, fontWeight: '500' }]}>
                XXXX {candidate.last4}
              </Text>
            </View>
          )}

          {candidate.reference && (
            <View style={styles.detailRow}>
              <Text style={[typography.caption, { color: colors.subtext }]}>Ref / UTR</Text>
              <Text style={[typography.body, { color: colors.text, fontWeight: '500' }]}>
                {candidate.reference}
              </Text>
            </View>
          )}

          {paymentAppMatch && (
            <View style={styles.selectorContainer}>
              <Text style={[typography.bodyBold, { color: colors.text }]}>
                {destinationNeedsConfirmation ? 'Destination account needs confirmation' : 'Destination account linked'}
              </Text>
              <Text style={[typography.caption, { color: colors.subtext, marginTop: 4 }]}>
                Source app: {paymentAppMatch.sourceLabel}
              </Text>
              <Text style={[typography.caption, { color: colors.subtext, marginTop: 2 }]}>
                Bank hint: {paymentAppMatch.bankHintLabel}
              </Text>
              {paymentAppMatch.mappingStatus === 'user_confirmed' && paymentAppMatch.mappedBankAccountLast4 && (
                <Text style={[typography.caption, { color: colors.subtext, marginTop: 2 }]}>
                  Credited to: {paymentAppMatch.mappedBankName || paymentAppMatch.bankHintLabel} ••{paymentAppMatch.mappedBankAccountLast4}
                </Text>
              )}
            </View>
          )}

          {destinationNeedsConfirmation && (
            <View style={styles.selectorContainer}>
              <Text style={[typography.caption, { color: colors.subtext, marginBottom: 6 }]}>
                Link destination account:
              </Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipsScroll}>
                {bankAccounts.map(bank => (
                  <TouchableOpacity
                    key={bank.id}
                    style={[
                      styles.chip,
                      {
                        borderColor: activeSelection === bank.id ? colors.accent : colors.border,
                        backgroundColor: activeSelection === bank.id ? colors.accent + '15' : colors.card,
                      },
                    ]}
                    onPress={() => setSelectedAccounts(prev => ({ ...prev, [item.id]: bank.id }))}
                  >
                    <MaterialCommunityIcons name="bank-outline" size={14} color={activeSelection === bank.id ? colors.accent : colors.subtext} />
                    <Text style={[typography.caption, { color: activeSelection === bank.id ? colors.accent : colors.text, fontWeight: '600', marginLeft: 4 }]}>
                      {bank.bank_name} ••{bank.account_last4}
                    </Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
              <View style={styles.actionsRow}>
                <TouchableOpacity
                  style={[styles.actionButton, styles.approveButton, { backgroundColor: colors.accent }]}
                  onPress={() => handleLinkPaymentAppAccount(item)}
                  disabled={postingId === item.id || activeSelection === 'cash'}
                >
                  <MaterialCommunityIcons name="link-variant" size={18} color="#fff" />
                  <Text style={[typography.bodyBold, { color: '#fff', marginLeft: 6 }]}>Link to account</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.actionButton, { borderColor: colors.border, borderWidth: 1 }]}
                  onPress={() => Toast.show({ type: 'info', text1: 'Kept for review' })}
                >
                  <Text style={[typography.caption, { color: colors.subtext }]}>Not my account / Keep reviewing</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}

          {/* Account Selector Chips (Only for Expense/Debit Items) */}
          {isSupported && !isCredit && (
            <View style={styles.selectorContainer}>
              <Text style={[typography.caption, { color: colors.subtext, marginBottom: 6 }]}>
                Select Account to Deduct From:
              </Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipsScroll}>
                <TouchableOpacity
                  style={[
                    styles.chip,
                    {
                      borderColor: activeSelection === 'cash' ? colors.accent : colors.border,
                      backgroundColor: activeSelection === 'cash' ? colors.accent + '15' : colors.card,
                    }
                  ]}
                  onPress={() => setSelectedAccounts(prev => ({ ...prev, [item.id]: 'cash' }))}
                >
                  <MaterialCommunityIcons
                    name="cash-multiple"
                    size={14}
                    color={activeSelection === 'cash' ? colors.accent : colors.subtext}
                  />
                  <Text
                    style={[
                      typography.caption,
                      { color: activeSelection === 'cash' ? colors.accent : colors.text, fontWeight: '600', marginLeft: 4 }
                    ]}
                  >
                    Cash
                  </Text>
                </TouchableOpacity>

                {bankAccounts.map(bank => (
                  <TouchableOpacity
                    key={bank.id}
                    style={[
                      styles.chip,
                      {
                        borderColor: activeSelection === bank.id ? colors.accent : colors.border,
                        backgroundColor: activeSelection === bank.id ? colors.accent + '15' : colors.card,
                      }
                    ]}
                    onPress={() => setSelectedAccounts(prev => ({ ...prev, [item.id]: bank.id }))}
                  >
                    <MaterialCommunityIcons
                      name="bank-outline"
                      size={14}
                      color={activeSelection === bank.id ? colors.accent : colors.subtext}
                    />
                    <Text
                      style={[
                        typography.caption,
                        { color: activeSelection === bank.id ? colors.accent : colors.text, fontWeight: '600', marginLeft: 4 }
                      ]}
                    >
                      {bank.bank_name} ({bank.account_last4})
                    </Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            </View>
          )}

          {isCardBillPayment && (
            <View style={styles.selectorContainer}>
              <View style={[styles.transferNotice, { borderColor: colors.border, backgroundColor: colors.border + '30', marginBottom: 8 }]}>
                <MaterialCommunityIcons name="information-outline" size={14} color={colors.accent} />
                <Text style={[typography.caption, { color: colors.subtext, fontWeight: '600', marginLeft: 6, flex: 1 }]}>
                  This is not counted as an expense. Confirm to save it as a card payment.
                </Text>
              </View>
              <View style={[styles.transferNotice, { borderColor: colors.border, backgroundColor: colors.border + '30', marginBottom: 8 }]}>
                <MaterialCommunityIcons name="history-clock-outline" size={14} color={colors.accent} />
                <Text style={[typography.caption, { color: colors.subtext, fontWeight: '600', marginLeft: 6, flex: 1 }]}>
                  Balance updated from bank evidence. Payment still needs review.
                </Text>
              </View>
              <Text style={[typography.caption, { color: colors.subtext, marginBottom: 6 }]}>
                Choose Credit Card:
              </Text>
              {legacyCardLink ? (
                <View style={[styles.setupPill, { borderColor: colors.border, backgroundColor: colors.border + '30' }]}>
                  <MaterialCommunityIcons name="link-variant" size={14} color={colors.accent} />
                  <Text style={[typography.caption, { color: colors.text, fontWeight: '600', marginLeft: 6 }]}>
                    Link existing card setup: {legacyCardLink.legacyAccount.bank_name} ••{legacyCardLink.last4}
                  </Text>
                </View>
              ) : creditCards.length === 0 ? (
                <View style={[styles.setupPill, { borderColor: colors.border, backgroundColor: colors.border + '30' }]}>
                  <MaterialCommunityIcons name="credit-card-plus-outline" size={14} color={colors.subtext} />
                  <Text style={[typography.caption, { color: colors.subtext, fontWeight: '600', marginLeft: 6 }]}>
                    Needs credit card setup
                  </Text>
                </View>
              ) : (
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipsScroll}>
                  {creditCards.map(card => (
                    <TouchableOpacity
                      key={card.id}
                      style={[
                        styles.chip,
                        {
                          borderColor: activeCardSelection === card.id ? colors.accent : colors.border,
                          backgroundColor: activeCardSelection === card.id ? colors.accent + '15' : colors.card,
                        }
                      ]}
                      onPress={() => setSelectedCreditCards(prev => ({ ...prev, [item.id]: card.id }))}
                    >
                      <MaterialCommunityIcons
                        name="credit-card-outline"
                        size={14}
                        color={activeCardSelection === card.id ? colors.accent : colors.subtext}
                      />
                      <Text
                        style={[
                          typography.caption,
                          { color: activeCardSelection === card.id ? colors.accent : colors.text, fontWeight: '600', marginLeft: 4 }
                        ]}
                      >
                        {(card.card_name || card.bank_name)} ({card.last_4_digits})
                      </Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>
              )}
            </View>
          )}

          {isLoanEMIPayment && (
            <View style={styles.selectorContainer}>
              <Text style={[typography.caption, { color: colors.subtext, marginBottom: 6 }]}>
                Choose Loan:
              </Text>
              {loans.length === 0 ? (
                <View style={[styles.setupPill, { borderColor: colors.border, backgroundColor: colors.border + '30' }]}>
                  <MaterialCommunityIcons name="bank-plus" size={14} color={colors.subtext} />
                  <Text style={[typography.caption, { color: colors.subtext, fontWeight: '600', marginLeft: 6 }]}>
                    Needs loan setup
                  </Text>
                </View>
              ) : (
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipsScroll}>
                  {loans.map(loan => {
                    const isActive = activeLoanSelection === loan.id;
                    const canRecordLoan = canRecordEMIWithLoan(item, loan);

                    return (
                      <TouchableOpacity
                        key={loan.id}
                        style={[
                          styles.chip,
                          {
                            borderColor: isActive ? colors.accent : colors.border,
                            backgroundColor: isActive ? colors.accent + '15' : colors.card,
                            opacity: canRecordLoan ? 1 : 0.65,
                          }
                        ]}
                        onPress={() => setSelectedLoans(prev => ({ ...prev, [item.id]: loan.id }))}
                      >
                        <MaterialCommunityIcons
                          name="bank-check"
                          size={14}
                          color={isActive ? colors.accent : colors.subtext}
                        />
                        <Text
                          style={[
                            typography.caption,
                            { color: isActive ? colors.accent : colors.text, fontWeight: '600', marginLeft: 4 }
                          ]}
                        >
                          {loan.loan_name || loan.lender_name} ({formatCurrency(loan.emi_amount)})
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </ScrollView>
              )}
              {activeLoan && !canRecordActiveEMI && (
                <Text style={[typography.caption, { color: colors.subtext, marginTop: 4 }]}>
                  Needs loan setup
                </Text>
              )}
            </View>
          )}

          {isSelfTransfer && (
            <View style={styles.selectorContainer}>
              <View style={[styles.transferNotice, { borderColor: colors.border, backgroundColor: colors.border + '30' }]}>
                <MaterialCommunityIcons name="swap-horizontal" size={14} color={colors.accent} />
                <Text style={[typography.caption, { color: colors.subtext, fontWeight: '600', marginLeft: 6, flex: 1 }]}>
                  Moves money between your accounts and won't affect income or expense
                </Text>
              </View>

              {eligibleTransferAccounts.length < 2 ? (
                <View style={[styles.setupPill, { borderColor: colors.border, backgroundColor: colors.border + '30', marginTop: 8 }]}>
                  <MaterialCommunityIcons name="bank-plus" size={14} color={colors.subtext} />
                  <Text style={[typography.caption, { color: colors.subtext, fontWeight: '600', marginLeft: 6 }]}>
                    Needs at least two bank accounts
                  </Text>
                </View>
              ) : (
                <>
                  <Text style={[typography.caption, { color: colors.subtext, marginTop: 8, marginBottom: 6 }]}>
                    From
                  </Text>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipsScroll}>
                    {eligibleTransferAccounts.map(bank => (
                      <TouchableOpacity
                        key={`from-${bank.id}`}
                        style={[
                          styles.chip,
                          {
                            borderColor: activeTransferFrom === bank.id ? colors.accent : colors.border,
                            backgroundColor: activeTransferFrom === bank.id ? colors.accent + '15' : colors.card,
                          }
                        ]}
                        onPress={() => setSelectedTransferFromAccounts(prev => ({ ...prev, [item.id]: bank.id }))}
                      >
                        <MaterialCommunityIcons
                          name="bank-outline"
                          size={14}
                          color={activeTransferFrom === bank.id ? colors.accent : colors.subtext}
                        />
                        <Text
                          style={[
                            typography.caption,
                            { color: activeTransferFrom === bank.id ? colors.accent : colors.text, fontWeight: '600', marginLeft: 4 }
                          ]}
                        >
                          {bank.bank_name} ({bank.account_last4})
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </ScrollView>

                  <Text style={[typography.caption, { color: colors.subtext, marginTop: 8, marginBottom: 6 }]}>
                    To
                  </Text>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipsScroll}>
                    {eligibleTransferAccounts.map(bank => (
                      <TouchableOpacity
                        key={`to-${bank.id}`}
                        style={[
                          styles.chip,
                          {
                            borderColor: activeTransferTo === bank.id ? colors.accent : colors.border,
                            backgroundColor: activeTransferTo === bank.id ? colors.accent + '15' : colors.card,
                          }
                        ]}
                        onPress={() => setSelectedTransferToAccounts(prev => ({ ...prev, [item.id]: bank.id }))}
                      >
                        <MaterialCommunityIcons
                          name="bank-transfer-in"
                          size={14}
                          color={activeTransferTo === bank.id ? colors.accent : colors.subtext}
                        />
                        <Text
                          style={[
                            typography.caption,
                            { color: activeTransferTo === bank.id ? colors.accent : colors.text, fontWeight: '600', marginLeft: 4 }
                          ]}
                        >
                          {bank.bank_name} ({bank.account_last4})
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </ScrollView>
                </>
              )}
            </View>
          )}

          {isRefund && (
            <View style={styles.selectorContainer}>
              <View style={[styles.refundNotice, { borderColor: colors.border, backgroundColor: colors.border + '30' }]}>
                <MaterialCommunityIcons name="cash-refund" size={14} color="#14b8a6" />
                <Text style={[typography.caption, { color: colors.subtext, fontWeight: '600', marginLeft: 6, flex: 1 }]}>
                  Refunds reduce spending; they are not normal income
                </Text>
              </View>

              <Text style={[typography.caption, { color: colors.subtext, marginTop: 8, marginBottom: 6 }]}>
                Choose original expense:
              </Text>

              {refundMatches.length === 0 ? (
                <View style={[styles.setupPill, { borderColor: colors.border, backgroundColor: colors.border + '30' }]}>
                  <MaterialCommunityIcons name="clipboard-search-outline" size={14} color={colors.subtext} />
                  <Text style={[typography.caption, { color: colors.subtext, fontWeight: '600', marginLeft: 6 }]}>
                    No eligible expense found
                  </Text>
                </View>
              ) : (
                <>
                  <Text style={[typography.caption, { color: colors.subtext, marginBottom: 4 }]}>
                    Likely original expense preview
                  </Text>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipsScroll}>
                    {refundMatches.map(match => {
                      const tx = match.transaction;
                      const isActive = activeRefundExpenseId === tx.id;

                      return (
                        <TouchableOpacity
                          key={tx.id}
                          style={[
                            styles.refundMatchChip,
                            {
                              borderColor: isActive ? '#14b8a6' : colors.border,
                              backgroundColor: isActive ? '#14b8a615' : colors.card,
                            }
                          ]}
                          onPress={() => setSelectedRefundExpenses(prev => ({ ...prev, [item.id]: tx.id }))}
                        >
                          <MaterialCommunityIcons
                            name={isActive ? 'check-circle-outline' : 'receipt-text-outline'}
                            size={14}
                            color={isActive ? '#14b8a6' : colors.subtext}
                          />
                          <Text
                            numberOfLines={1}
                            style={[
                              typography.caption,
                              {
                                color: isActive ? '#14b8a6' : colors.text,
                                fontWeight: '600',
                                marginLeft: 4,
                                maxWidth: 180,
                              }
                            ]}
                          >
                            {(tx.note || tx.category || 'Expense')} ({formatCurrency(tx.amount)})
                          </Text>
                        </TouchableOpacity>
                      );
                    })}
                  </ScrollView>
                </>
              )}
            </View>
          )}

          <View style={[styles.reasonsContainer, { backgroundColor: colors.border + '30', borderRadius: borderRadius.sm }]}>
            <Text style={[typography.caption, { color: colors.text, fontWeight: '600', marginBottom: 4 }]}>
              Review reasons
            </Text>
            {reasons.map((reason, index) => (
              <View key={index} style={styles.reasonBullet}>
                <Text style={{ color: colors.subtext, fontSize: 12, marginRight: 6 }}>•</Text>
                <Text style={[typography.caption, { color: colors.subtext, flex: 1 }]}>
                  {reason}
                </Text>
              </View>
            ))}
          </View>

          {preferenceSuggestion && (
            <View style={[styles.preferenceNotice, { borderColor: colors.border, backgroundColor: colors.border + '30' }]}>
              <MaterialCommunityIcons name="lightbulb-on-outline" size={14} color={colors.accent} />
              <Text style={[typography.caption, { color: colors.subtext, marginLeft: 6, flex: 1 }]}>
                {preferenceSuggestion}
              </Text>
            </View>
          )}
        </View>

        <View style={styles.actions}>
          <TouchableOpacity
            style={[styles.actionButton, styles.ignoreButton, { borderColor: colors.border }]}
            onPress={() => handleIgnore(item.id)}
            disabled={postingId === item.id}
          >
            <MaterialCommunityIcons name="close-circle-outline" size={18} color={colors.subtext} />
            <Text style={[typography.body, { color: colors.subtext, marginLeft: 6 }]}>
              {negativeActionLabel}
            </Text>
          </TouchableOpacity>

          {isCardBillPayment ? (
            <TouchableOpacity
              style={[
                styles.actionButton,
                activeCardSelection || legacyCardLink ? styles.approveButton : styles.disabledButton,
                {
                  backgroundColor: activeCardSelection || legacyCardLink ? colors.accent : colors.border + '40',
                  opacity: postingId === item.id ? 0.7 : 1
                }
              ]}
              onPress={() => activeCardSelection ? handleRecordCardPayment(item) : handleLinkLegacyCreditCard(item)}
              disabled={postingId === item.id || (!activeCardSelection && !legacyCardLink)}
            >
              {postingId === item.id ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <>
                  <MaterialCommunityIcons
                    name={activeCardSelection ? 'credit-card-check-outline' : legacyCardLink ? 'link-variant' : 'lock-outline'}
                    size={18}
                    color={activeCardSelection || legacyCardLink ? '#fff' : colors.subtext}
                  />
                  <Text style={[typography.bodyBold, { color: activeCardSelection || legacyCardLink ? '#fff' : colors.subtext, marginLeft: 6, fontSize: 12 }]}>
                    {legacyCardLink
                      ? 'Link existing card setup'
                      : creditCards.length === 0
                        ? 'Needs credit card setup'
                      : activeCardSelection
                        ? 'Confirm card payment'
                        : 'Choose credit card'}
                  </Text>
                </>
              )}
            </TouchableOpacity>
          ) : isLoanEMIPayment ? (
            <TouchableOpacity
              style={[
                styles.actionButton,
                activeLoanSelection && canRecordActiveEMI ? styles.approveButton : styles.disabledButton,
                {
                  backgroundColor: activeLoanSelection && canRecordActiveEMI ? colors.accent : colors.border + '40',
                  opacity: postingId === item.id ? 0.7 : 1
                }
              ]}
              onPress={() => handleRecordEMIPayment(item)}
              disabled={postingId === item.id || !activeLoanSelection || !canRecordActiveEMI}
            >
              {postingId === item.id ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <>
                  <MaterialCommunityIcons
                    name={activeLoanSelection && canRecordActiveEMI ? 'cash-check' : 'lock-outline'}
                    size={18}
                    color={activeLoanSelection && canRecordActiveEMI ? '#fff' : colors.subtext}
                  />
                  <Text style={[typography.bodyBold, { color: activeLoanSelection && canRecordActiveEMI ? '#fff' : colors.subtext, marginLeft: 6, fontSize: 12 }]}>
                    {loans.length === 0
                      ? 'Needs loan setup'
                      : activeLoanSelection && canRecordActiveEMI
                        ? 'Record EMI'
                        : activeLoanSelection
                          ? 'Needs loan setup'
                          : 'Choose Loan'}
                  </Text>
                </>
              )}
            </TouchableOpacity>
          ) : isSelfTransfer ? (
            <TouchableOpacity
              style={[
                styles.actionButton,
                canCreateActiveTransfer ? styles.approveButton : styles.disabledButton,
                {
                  backgroundColor: canCreateActiveTransfer ? colors.accent : colors.border + '40',
                  opacity: postingId === item.id ? 0.7 : 1
                }
              ]}
              onPress={() => handleCreateTransfer(item)}
              disabled={postingId === item.id || !canCreateActiveTransfer}
            >
              {postingId === item.id ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <>
                  <MaterialCommunityIcons
                    name={canCreateActiveTransfer ? 'bank-transfer' : 'lock-outline'}
                    size={18}
                    color={canCreateActiveTransfer ? '#fff' : colors.subtext}
                  />
                  <Text
                    numberOfLines={1}
                    adjustsFontSizeToFit
                    minimumFontScale={0.75}
                    style={[typography.bodyBold, { color: canCreateActiveTransfer ? '#fff' : colors.subtext, marginLeft: 6, fontSize: 12 }]}
                  >
                    {eligibleTransferAccounts.length < 2
                      ? 'Needs at least two bank accounts'
                      : canCreateActiveTransfer
                        ? 'Create Transfer'
                        : 'Choose accounts'}
                  </Text>
                </>
              )}
            </TouchableOpacity>
          ) : isRefund ? (
            <TouchableOpacity
              style={[
                styles.actionButton,
                canLinkActiveRefund ? styles.approveButton : styles.disabledButton,
                {
                  backgroundColor: canLinkActiveRefund ? '#14b8a6' : colors.border + '40',
                  opacity: postingId === item.id ? 0.7 : 1
                }
              ]}
              onPress={() => handleLinkRefund(item)}
              disabled={postingId === item.id || !canLinkActiveRefund}
            >
              {postingId === item.id ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <>
                  <MaterialCommunityIcons
                    name={refundSchemaMissing
                      ? 'database-alert-outline'
                      : activeRefundDuplicate
                        ? 'check-circle-outline'
                        : canLinkActiveRefund
                          ? 'cash-refund'
                          : 'lock-outline'}
                    size={18}
                    color={canLinkActiveRefund ? '#fff' : colors.subtext}
                  />
                  <Text
                    numberOfLines={1}
                    adjustsFontSizeToFit
                    minimumFontScale={0.75}
                    style={[typography.bodyBold, { color: canLinkActiveRefund ? '#fff' : colors.subtext, marginLeft: 6, fontSize: 12 }]}
                  >
                    {refundSchemaMissing
                      ? 'Database update required'
                      : activeRefundDuplicate
                        ? 'Already recorded'
                        : activeRefundExpense
                          ? 'Link Refund'
                          : 'Choose Original Expense'}
                  </Text>
                </>
              )}
            </TouchableOpacity>
          ) : isSupported && !destinationNeedsConfirmation ? (
            <TouchableOpacity
              style={[
                styles.actionButton,
                styles.approveButton,
                { backgroundColor: colors.accent, opacity: postingId === item.id ? 0.7 : 1 }
              ]}
              onPress={() => handleCreateTransaction(item, isCredit ? 'income' : 'expense')}
              disabled={postingId === item.id}
            >
              {postingId === item.id ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <>
                  <MaterialCommunityIcons
                    name={isCredit ? 'arrow-down-bold-circle-outline' : 'arrow-up-bold-circle-outline'}
                    size={18}
                    color="#fff"
                  />
                  <Text style={[typography.bodyBold, { color: '#fff', marginLeft: 6 }]}>
                    {isCredit ? 'Count as income' : 'Count as expense'}
                  </Text>
                </>
              )}
            </TouchableOpacity>
          ) : destinationNeedsConfirmation ? (
            <View style={[styles.actionButton, styles.disabledButton, { backgroundColor: colors.border + '40' }]}>
              <MaterialCommunityIcons name="lock-outline" size={18} color={colors.subtext} />
              <Text style={[typography.body, { color: colors.subtext, marginLeft: 6, fontSize: 12 }]}>
                Link account before income review
              </Text>
            </View>
          ) : (
            <View
              style={[
                styles.actionButton,
                styles.disabledButton,
                { backgroundColor: colors.border + '40' }
              ]}
            >
              <MaterialCommunityIcons name="lock-outline" size={18} color={colors.subtext} />
              <Text style={[typography.body, { color: colors.subtext, marginLeft: 6, fontSize: 12 }]}>
                Unsupported in this version
              </Text>
            </View>
          )}
        </View>
      </View>
    );
  };

  const renderEmptyState = () => (
    <View style={styles.emptyState}>
      <View style={[styles.emptyIconContainer, { backgroundColor: colors.border + '30' }]}>
        <MaterialCommunityIcons name="inbox-multiple-outline" size={48} color={colors.accent} />
      </View>
      <Text style={[typography.h3, { color: colors.text, marginTop: spacing.md }]}>
        Queue is empty!
      </Text>
      <Text style={[typography.caption, { color: colors.subtext, marginTop: spacing.xs, textAlign: 'center' }]}>
        No transactions are currently awaiting manual review.
      </Text>
    </View>
  );

  const content = (
    <>
      {!embedded ? <AppHeader title="Money Movement Review" showBack={true} /> : null}
      
      {loading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={colors.accent} />
        </View>
      ) : (
        <FlatList
          data={visibleItems}
          renderItem={renderItem}
          keyExtractor={item => item.id}
          scrollEnabled={!embedded}
          contentContainerStyle={[
            styles.listContent,
            embedded ? styles.embeddedListContent : null,
            { padding: embedded ? 0 : spacing.md },
          ]}
          ListEmptyComponent={renderEmptyState}
          refreshControl={
            embedded
              ? undefined
              : (
                <RefreshControl
                  refreshing={refreshing}
                  onRefresh={onRefresh}
                  tintColor={colors.accent}
                  colors={[colors.accent]}
                />
              )
          }
        />
      )}
    </>
  );

  if (embedded) {
    return <View style={styles.embeddedRoot}>{content}</View>;
  }

  return (
    <ScreenWrapper>
      {content}
    </ScreenWrapper>
  );
}

const styles = StyleSheet.create({
  loadingContainer: {
    flex: 1,
    minHeight: 220,
    justifyContent: 'center',
    alignItems: 'center',
  },
  listContent: {
    flexGrow: 1,
  },
  embeddedListContent: {
    flexGrow: 0,
  },
  embeddedRoot: {},
  card: {
    borderWidth: 1,
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  iconContainer: {
    width: 44,
    height: 44,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerText: {
    flex: 1,
    marginLeft: 12,
  },
  divider: {
    height: 1,
    marginVertical: 12,
  },
  detailsContainer: {
    gap: 8,
  },
  detailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  selectorContainer: {
    marginTop: 6,
  },
  chipsScroll: {
    gap: 8,
    paddingVertical: 4,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  refundMatchChip: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 6,
    maxWidth: 240,
  },
  setupPill: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    borderWidth: 1,
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  transferNotice: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  refundNotice: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  preferenceNotice: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    marginTop: 8,
  },
  reasonsContainer: {
    padding: 10,
    marginTop: 8,
  },
  reasonBullet: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginTop: 4,
  },
  actions: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 16,
  },
  actionsRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 8,
  },
  actionButton: {
    flex: 1,
    height: 40,
    borderRadius: 8,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
  },
  ignoreButton: {
    borderWidth: 1,
  },
  approveButton: {},
  disabledButton: {},
  emptyState: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 32,
    paddingTop: 100,
  },
  emptyIconContainer: {
    width: 80,
    height: 80,
    borderRadius: 40,
    justifyContent: 'center',
    alignItems: 'center',
  },
});
