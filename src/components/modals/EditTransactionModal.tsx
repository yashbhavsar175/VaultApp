import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  Modal,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  Keyboard,
  TouchableWithoutFeedback,
} from 'react-native';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';
import { Transaction, TransactionType } from '../../types';
import { useTheme } from '../../context/ThemeContext';
import { getUniqueCategories } from '../../lib/core';
import { getBankAccounts } from '../../lib/database/financial';
import { CACHE_KEYS, getCached, setCache } from '../../lib/services/cache';

interface EditTransactionModalProps {
  visible: boolean;
  transaction: Transaction | null;
  onClose: () => void;
  onSave: (id: string, updates: Partial<Transaction>) => void;
}

const TRANSACTION_TYPES: { value: TransactionType; label: string; icon: string; color: string }[] = [
  { value: 'income', label: 'Income', icon: 'arrow-down-circle', color: '#10b981' },
  { value: 'expense', label: 'Expense', icon: 'arrow-up-circle', color: '#ef4444' },
  { value: 'investment', label: 'Investment', icon: 'chart-line', color: '#7c6af7' },
  { value: 'emi', label: 'EMI', icon: 'credit-card', color: '#f59e0b' },
];

export default function EditTransactionModal({
  visible,
  transaction,
  onClose,
  onSave,
}: EditTransactionModalProps) {
  const { colors, typography, borderRadius } = useTheme();
  
  const [note, setNote] = useState('');
  const [type, setType] = useState<TransactionType>('expense');
  const [category, setCategory] = useState('');
  const [amount, setAmount] = useState('');
  
  const [allCategories, setAllCategories] = useState<string[]>([]);
  const [filteredCategories, setFilteredCategories] = useState<string[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  
  // Bank account state
  const [bankAccounts, setBankAccounts] = useState<any[]>([]);
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null);

  // Helper function to format date and time
  const formatDateTime = (dateString?: string) => {
    if (!dateString) return 'Unknown time';
    const date = new Date(dateString);
    return date.toLocaleString('en-IN', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  useEffect(() => {
    if (transaction) {
      setNote(transaction.note || '');
      setType(transaction.type);
      setCategory(transaction.category || '');
      setAmount(transaction.amount.toString());
      setSelectedAccountId(transaction.account_id || null);
    }
  }, [transaction]);

  useEffect(() => {
    if (visible) {
      loadCategories();
      loadBankAccounts();
    }
  }, [visible]);

  useEffect(() => {
    if (category.trim()) {
      const filtered = allCategories.filter(cat =>
        cat.toLowerCase().includes(category.toLowerCase())
      );
      setFilteredCategories(filtered);
      setShowSuggestions(filtered.length > 0 && !filtered.some(cat => cat.toLowerCase() === category.toLowerCase()));
    } else {
      setFilteredCategories([]);
      setShowSuggestions(false);
    }
  }, [category, allCategories]);

  const loadCategories = async () => {
    try {
      const cached = await getCached<string[]>(CACHE_KEYS.UNIQUE_CATEGORIES);
      if (cached) {
        setAllCategories(cached.data);
        if (!cached.isStale) return;
      }

      const categories = await getUniqueCategories();
      setAllCategories(categories);
      await setCache(CACHE_KEYS.UNIQUE_CATEGORIES, categories);
    } catch (error) {
      console.error('Error loading categories:', error);
    }
  };

  const loadBankAccounts = async () => {
    try {
      const cached = await getCached<any[]>(CACHE_KEYS.BANK_ACCOUNTS);
      if (cached) {
        setBankAccounts(cached.data);
        if (!cached.isStale) return;
      }

      const data = await getBankAccounts();
      setBankAccounts(data || []);
      await setCache(CACHE_KEYS.BANK_ACCOUNTS, data || []);
    } catch (error) {
      console.error('Error loading bank accounts:', error);
    }
  };

  const handleSave = () => {
    if (!transaction) return;

    const updates: Partial<Transaction> = {
      note: note.trim(),
      type,
      category: category.trim(),
      amount: parseFloat(amount) || transaction.amount,
      account_id: selectedAccountId || transaction.account_id,
    };

    onSave(transaction.id, updates);
  };

  const handleCategorySelect = (selectedCategory: string) => {
    setCategory(selectedCategory);
    setShowSuggestions(false);
    Keyboard.dismiss();
  };

  if (!transaction) return null;

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent={true}
      onRequestClose={onClose}>
      <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
        <View style={styles.modalOverlay}>
          <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
            style={styles.keyboardAvoidingView}>
            <View style={[styles.modalContent, { backgroundColor: colors.background }]}>
              {/* Header - Fixed */}
              <View style={[styles.modalHeader, { borderBottomColor: colors.border }]}>
                <Text style={[typography.h2, { color: colors.text, fontSize: 20 }]}>Edit Transaction</Text>
                <TouchableOpacity
                  onPress={onClose}
                  hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                  accessibilityRole="button"
                  accessibilityLabel="Close edit transaction">
                  <MaterialCommunityIcons name="close" size={24} color={colors.text} />
                </TouchableOpacity>
              </View>

              {/* Scrollable Form Content */}
              <ScrollView 
                style={styles.modalBody}
                contentContainerStyle={styles.scrollContent}
                showsVerticalScrollIndicator={false}
                keyboardShouldPersistTaps="handled">
                
                {/* Amount */}
                <View style={{ marginBottom: 20 }}>
                  <Text style={[typography.bodyBold, { color: colors.text, marginBottom: 8, fontSize: 14 }]}>
                    Amount
                  </Text>
                  <TextInput
                    style={[
                      styles.input,
                      {
                        backgroundColor: colors.card,
                        color: colors.text,
                        borderColor: colors.border,
                        borderRadius: borderRadius.md,
                      },
                    ]}
                    value={amount}
                    onChangeText={setAmount}
                    keyboardType="numeric"
                    placeholder="Enter amount"
                    placeholderTextColor={colors.subtext}
                  />
                </View>

                {/* Note/Merchant */}
                <View style={{ marginBottom: 20 }}>
                  <Text style={[typography.bodyBold, { color: colors.text, marginBottom: 8, fontSize: 14 }]}>
                    Note / Merchant
                  </Text>
                  <TextInput
                    style={[
                      styles.input,
                      {
                        backgroundColor: colors.card,
                        color: colors.text,
                        borderColor: colors.border,
                        borderRadius: borderRadius.md,
                      },
                    ]}
                    value={note}
                    onChangeText={setNote}
                    placeholder="Enter note or merchant name"
                    placeholderTextColor={colors.subtext}
                  />
                </View>

                {/* Type Selector - Horizontal Scroll */}
                <View style={{ marginBottom: 24 }}>
                  <Text style={[typography.bodyBold, { color: colors.text, marginBottom: 8, fontSize: 14 }]}>
                    Type
                  </Text>
                  <ScrollView 
                    horizontal 
                    showsHorizontalScrollIndicator={false}
                    contentContainerStyle={styles.typeScrollContent}>
                    {TRANSACTION_TYPES.map((item, index) => (
                      <TouchableOpacity
                        key={item.value}
                        style={[
                          styles.typeButton,
                          {
                            backgroundColor: type === item.value ? item.color : colors.card,
                            borderColor: type === item.value ? item.color : colors.border,
                            borderRadius: borderRadius.md,
                            marginRight: index < TRANSACTION_TYPES.length - 1 ? 12 : 0,
                          },
                        ]}
                        onPress={() => setType(item.value)}>
                        <MaterialCommunityIcons
                          name={item.icon}
                          size={22}
                          color={type === item.value ? '#fff' : colors.text}
                        />
                        <Text
                          style={[
                            typography.caption,
                            {
                              color: type === item.value ? '#fff' : colors.text,
                              marginTop: 6,
                              fontSize: 12,
                              fontWeight: '600',
                            },
                          ]}>
                          {item.label}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </ScrollView>
                </View>

                {/* Category with Autocomplete */}
                <View style={{ marginBottom: 20, zIndex: 1000 }}>
                  <Text style={[typography.bodyBold, { color: colors.text, marginBottom: 8, fontSize: 14 }]}>
                    Category
                  </Text>
                  <TextInput
                    style={[
                      styles.input,
                      {
                        backgroundColor: colors.card,
                        color: colors.text,
                        borderColor: colors.border,
                        borderRadius: borderRadius.md,
                      },
                    ]}
                    value={category}
                    onChangeText={setCategory}
                    placeholder="Enter or select category"
                    placeholderTextColor={colors.subtext}
                    onFocus={() => {
                      if (filteredCategories.length > 0) {
                        setShowSuggestions(true);
                      }
                    }}
                  />

                  {/* Autocomplete Suggestions */}
                  {showSuggestions && filteredCategories.length > 0 && (
                    <View
                      style={[
                        styles.suggestionsContainer,
                        {
                          backgroundColor: colors.card,
                          borderColor: colors.border,
                          borderRadius: borderRadius.md,
                        },
                      ]}>
                      {filteredCategories.slice(0, 5).map((item, index) => (
                        <TouchableOpacity
                          key={`${item}-${index}`}
                          style={[
                            styles.suggestionItem,
                            { 
                              borderBottomColor: colors.border,
                              borderBottomWidth: index < Math.min(4, filteredCategories.length - 1) ? 1 : 0,
                            },
                          ]}
                          onPress={() => handleCategorySelect(item)}>
                          <MaterialCommunityIcons
                            name="tag-outline"
                            size={18}
                            color={colors.subtext}
                          />
                          <Text
                            style={[
                              typography.body,
                              { color: colors.text, marginLeft: 10, fontSize: 15 },
                            ]}>
                            {item}
                          </Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                  )}
                </View>

                {/* Bank Account Selector */}
                {bankAccounts.length > 0 && (
                  <View style={{ marginBottom: 20 }}>
                    <Text style={[typography.bodyBold, { color: colors.text, marginBottom: 8, fontSize: 14 }]}>
                      Bank Account
                    </Text>
                    <ScrollView 
                      horizontal 
                      showsHorizontalScrollIndicator={false}
                      contentContainerStyle={styles.bankScrollContent}>
                      {bankAccounts.map((account, index) => (
                        <TouchableOpacity
                          key={account.id}
                          style={[
                            styles.bankButton,
                            {
                              backgroundColor: selectedAccountId === account.id ? colors.accent : colors.card,
                              borderColor: selectedAccountId === account.id ? colors.accent : colors.border,
                              borderRadius: borderRadius.md,
                              marginRight: index < bankAccounts.length - 1 ? 12 : 0,
                            },
                          ]}
                          onPress={() => setSelectedAccountId(account.id)}>
                          <MaterialCommunityIcons
                            name="bank"
                            size={20}
                            color={selectedAccountId === account.id ? '#fff' : colors.text}
                          />
                          <Text
                            style={[
                              typography.caption,
                              {
                                color: selectedAccountId === account.id ? '#fff' : colors.text,
                                marginTop: 4,
                                fontSize: 12,
                                fontWeight: '600',
                              },
                            ]}>
                            {account.bank_name}
                          </Text>
                          <Text
                            style={[
                              typography.caption,
                              {
                                color: selectedAccountId === account.id ? 'rgba(255,255,255,0.8)' : colors.subtext,
                                fontSize: 10,
                                marginTop: 2,
                              },
                            ]}>
                            ••{account.account_last4}
                          </Text>
                        </TouchableOpacity>
                      ))}
                    </ScrollView>
                  </View>
                )}

                {/* Transaction Info - Read-only Metadata */}
                <View
                  style={[
                    styles.metadataSection,
                    {
                      backgroundColor: colors.card,
                      borderColor: colors.border,
                      borderRadius: borderRadius.md,
                      marginTop: 24,
                      marginBottom: 20,
                    },
                  ]}>
                  <Text
                    style={[
                      typography.caption,
                      {
                        color: colors.subtext,
                        marginBottom: 12,
                        fontSize: 11,
                        textTransform: 'uppercase',
                        fontWeight: '600',
                        letterSpacing: 0.5,
                      },
                    ]}>
                    Transaction Info
                  </Text>

                  {/* Bank Account */}
                  <View style={styles.metadataRow}>
                    <MaterialCommunityIcons
                      name="bank-outline"
                      size={18}
                      color={colors.subtext}
                    />
                    <Text
                      style={[
                        typography.caption,
                        { color: colors.subtext, marginLeft: 10, fontSize: 12 },
                      ]}>
                      Account ••{transaction.account_last4 || 'Unknown'}
                    </Text>
                  </View>

                  {/* Source */}
                  <View style={styles.metadataRow}>
                    <MaterialCommunityIcons
                      name={transaction.sms_source === 'sms' ? 'cellphone-message' : 'bell-outline'}
                      size={18}
                      color={colors.subtext}
                    />
                    <Text
                      style={[
                        typography.caption,
                        { color: colors.subtext, marginLeft: 10, fontSize: 12 },
                      ]}>
                      {(transaction.sms_source || 'Manual').toUpperCase()} via {transaction.sms_sender || 'App'}
                    </Text>
                  </View>

                  {/* Time */}
                  <View style={[styles.metadataRow, { marginBottom: 0 }]}>
                    <MaterialCommunityIcons
                      name="clock-outline"
                      size={18}
                      color={colors.subtext}
                    />
                    <Text
                      style={[
                        typography.caption,
                        { color: colors.subtext, marginLeft: 10, fontSize: 12 },
                      ]}>
                      {formatDateTime(transaction.created_at)}
                    </Text>
                  </View>
                </View>

                {/* Extra padding at bottom for scroll */}
                <View style={{ height: 40 }} />
              </ScrollView>

              {/* Footer Actions - Fixed at Bottom */}
              <View style={[styles.modalFooter, { borderTopColor: colors.border, backgroundColor: colors.background }]}>
                <TouchableOpacity
                  style={[
                    styles.footerButton,
                    {
                      backgroundColor: colors.card,
                      borderRadius: borderRadius.md,
                      borderWidth: 1,
                      borderColor: colors.border,
                    },
                  ]}
                  onPress={onClose}>
                  <Text style={[typography.bodyBold, { color: colors.text, fontSize: 16 }]}>Cancel</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[
                    styles.footerButton,
                    {
                      backgroundColor: colors.accent,
                      borderRadius: borderRadius.md,
                    },
                  ]}
                  onPress={handleSave}>
                  <Text style={[typography.bodyBold, { color: '#fff', fontSize: 16 }]}>Save Changes</Text>
                </TouchableOpacity>
              </View>
            </View>
          </KeyboardAvoidingView>
        </View>
      </TouchableWithoutFeedback>
    </Modal>
  );
}

const styles = StyleSheet.create({
  modalOverlay: {
    flex: 1,
    // TODO: Replace with useTheme() colors.* token
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'flex-end',
  },
  keyboardAvoidingView: {
    maxHeight: '90%',
  },
  modalContent: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    height: '100%',
    overflow: 'hidden',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
  },
  modalBody: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 20,
  },
  input: {
    borderWidth: 1,
    fontSize: 16,
    paddingHorizontal: 16,
    paddingVertical: 12,
    height: 48,
  },
  typeScrollContent: {
    paddingRight: 20,
  },
  typeButton: {
    minWidth: 100,
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bankScrollContent: {
    paddingRight: 20,
  },
  bankButton: {
    minWidth: 110,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  suggestionsContainer: {
    borderWidth: 1,
    marginTop: 8,
    maxHeight: 200,
    elevation: 5,
    // TODO: Replace with useTheme() colors.* token
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
  },
  suggestionItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  metadataSection: {
    borderWidth: 1,
    padding: 16,
  },
  metadataRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10,
  },
  modalFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderTopWidth: 1,
    gap: 12,
  },
  footerButton: {
    flex: 1,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
