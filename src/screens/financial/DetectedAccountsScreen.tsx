import React, { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';
import Toast from 'react-native-toast-message';
import { ScreenWrapper, AppHeader, Card, AppButton, AppConfirmModal } from '../../components';
import { useTheme } from '../../context/ThemeContext';
import { BankAccount, DetectedAccount } from '../../types';
import {
  DetectedAccountDuplicateError,
  DetectedAccountReviewData,
  DetectedAccountReviewItem,
  ExistingOwnerOption,
  buildMergeOwnerOptions,
  confirmDetectedBankAccount,
  confirmDetectedCreditCard,
  confirmDetectedDebitCard,
  getDetectedAccountReviewData,
  ignoreDetectedAccount,
  mergeDetectedAccount,
  sanitizeDetectedDisplayText,
} from '../../lib/services/detectedAccountReview';

type EditorKind = 'bank_account' | 'credit_card' | 'debit_card';

interface EditorState {
  detection: DetectedAccount;
  kind: EditorKind;
}

interface ConfirmDialogState {
  title: string;
  message: string;
  confirmText: string;
  isDestructive?: boolean;
  onConfirm: () => Promise<void>;
}

const emptyReviewData: DetectedAccountReviewData = {
  detections: [],
  items: [],
  accounts: [],
  creditCards: [],
  debitCards: [],
};

function safeLast4(value?: string | null): string {
  const digits = (value || '').replace(/\D/g, '').slice(-4);
  return digits.length === 4 ? digits : '';
}

function inferAccountTypeHint(hint?: string | null): Extract<BankAccount['account_type'], 'savings' | 'current'> {
  return hint?.toLowerCase().includes('current') ? 'current' : 'savings';
}

function shortErrorMessage(error: unknown): string {
  if (error instanceof DetectedAccountDuplicateError) return error.message;
  if (error instanceof Error && error.message) return error.message;
  return 'Could not update this detection';
}

export default function DetectedAccountsScreen() {
  const { colors, typography, spacing } = useTheme();
  const [data, setData] = useState<DetectedAccountReviewData>(emptyReviewData);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [working, setWorking] = useState(false);
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [mergeDetection, setMergeDetection] = useState<DetectedAccount | null>(null);
  const [confirmDialog, setConfirmDialog] = useState<ConfirmDialogState | null>(null);

  const [bankName, setBankName] = useState('');
  const [accountLast4, setAccountLast4] = useState('');
  const [accountType, setAccountType] = useState<Extract<BankAccount['account_type'], 'savings' | 'current'>>('savings');
  const [cardName, setCardName] = useState('');
  const [cardLast4, setCardLast4] = useState('');
  const [creditLimit, setCreditLimit] = useState('');
  const [dueDate, setDueDate] = useState('1');
  const [billingCycleDate, setBillingCycleDate] = useState('1');
  const [linkedBankAccountId, setLinkedBankAccountId] = useState('');
  const [debitCardLabel, setDebitCardLabel] = useState('');

  const loadData = useCallback(async (showSpinner = false) => {
    if (showSpinner) setRefreshing(true);
    try {
      const reviewData = await getDetectedAccountReviewData();
      setData(reviewData);
    } catch {
      Toast.show({
        type: 'error',
        text1: 'Could not load detections',
        text2: 'Please try again.',
      });
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadData();
    }, [loadData])
  );

  const detectionsById = useMemo(() => {
    return Object.fromEntries(data.detections.map(detection => [detection.id, detection]));
  }, [data.detections]);

  const groupedItems = useMemo(() => {
    return data.items.reduce<Record<DetectedAccount['detection_type'], DetectedAccountReviewItem[]>>(
      (groups, item) => {
        groups[item.detectionType].push(item);
        return groups;
      },
      { bank_account: [], credit_card: [], debit_card: [], loan: [] }
    );
  }, [data.items]);

  const linkableBankAccounts = useMemo(
    () => data.accounts.filter(account => account.account_type !== 'credit_card' && account.account_type !== 'loan'),
    [data.accounts]
  );

  const openEditor = (detection: DetectedAccount, kind: EditorKind) => {
    const displayBankName = sanitizeDetectedDisplayText(detection.detected_bank_name, '');
    const accountDigits = safeLast4(detection.account_last4);
    const cardDigits = safeLast4(detection.card_last4 || detection.account_last4);

    setBankName(displayBankName);
    setAccountLast4(accountDigits);
    setAccountType(inferAccountTypeHint(detection.account_type_hint));
    setCardLast4(cardDigits);
    setCardName(displayBankName && cardDigits ? `${displayBankName} card ${cardDigits}` : 'Detected card');
    setCreditLimit(
      detection.balance_kind === 'credit_limit' && detection.confidence === 'exact' && detection.balance_amount !== null
        ? String(detection.balance_amount)
        : ''
    );
    setDueDate('1');
    setBillingCycleDate('1');
    setDebitCardLabel(cardDigits ? `Debit card ${cardDigits}` : '');

    const matchedAccount = linkableBankAccounts.find(account =>
      safeLast4(account.account_last4) === accountDigits &&
      sanitizeDetectedDisplayText(account.bank_name, '').toLowerCase() === displayBankName.toLowerCase()
    );
    setLinkedBankAccountId(matchedAccount?.id || '');
    setEditor({ detection, kind });
  };

  const closeEditor = () => {
    if (working) return;
    setEditor(null);
  };

  const runAction = async (action: () => Promise<unknown>, successMessage: string) => {
    setWorking(true);
    try {
      await action();
      setConfirmDialog(null);
      setEditor(null);
      setMergeDetection(null);
      await loadData();
      Toast.show({ type: 'success', text1: successMessage });
    } catch (error) {
      setConfirmDialog(null);
      Toast.show({
        type: 'error',
        text1: 'Review not updated',
        text2: shortErrorMessage(error),
      });
    } finally {
      setWorking(false);
    }
  };

  const requestCreate = () => {
    if (!editor) return;

    const detection = editor.detection;
    if (editor.kind === 'bank_account') {
      setConfirmDialog({
        title: 'Create bank account?',
        message: `Create ${bankName || 'this bank account'} ending ${accountLast4 || '----'} from this detection? No transaction will be created.`,
        confirmText: 'Create',
        onConfirm: () => runAction(
          () => confirmDetectedBankAccount({
            detectedAccountId: detection.id,
            bankName,
            accountLast4,
            accountType,
          }),
          'Bank account confirmed'
        ),
      });
      return;
    }

    if (editor.kind === 'credit_card') {
      setConfirmDialog({
        title: 'Create credit card?',
        message: `Create ${cardName || 'this credit card'} ending ${cardLast4 || '----'} from this detection? No card transaction will be created.`,
        confirmText: 'Create',
        onConfirm: () => runAction(
          () => confirmDetectedCreditCard({
            detectedAccountId: detection.id,
            bankName,
            cardName,
            cardLast4,
            creditLimit: creditLimit.trim() ? Number(creditLimit) : null,
            dueDate: Number(dueDate || 1),
            billingCycleDate: Number(billingCycleDate || 1),
          }),
          'Credit card confirmed'
        ),
      });
      return;
    }

    setConfirmDialog({
      title: 'Create debit card?',
      message: `Link debit card ending ${cardLast4 || '----'} to the selected bank account? No transaction will be created.`,
      confirmText: 'Link',
      onConfirm: () => runAction(
        () => confirmDetectedDebitCard({
          detectedAccountId: detection.id,
          bankAccountId: linkedBankAccountId,
          cardLast4,
          cardLabel: debitCardLabel,
        }),
        'Debit card linked'
      ),
    });
  };

  const requestMerge = (detection: DetectedAccount, owner: ExistingOwnerOption) => {
    setConfirmDialog({
      title: 'Link detection?',
      message: `Link this detection to ${owner.label}? No account, card, or transaction will be created.`,
      confirmText: 'Link',
      onConfirm: () => runAction(
        () => mergeDetectedAccount({
          detectedAccountId: detection.id,
          ownerType: owner.ownerType,
          ownerId: owner.ownerId,
        }),
        'Detection linked'
      ),
    });
  };

  const requestIgnore = (detection: DetectedAccount) => {
    setConfirmDialog({
      title: 'Ignore detection?',
      message: 'This keeps the detection for history but removes it from pending review.',
      confirmText: 'Ignore',
      isDestructive: true,
      onConfirm: () => runAction(
        () => ignoreDetectedAccount(detection.id),
        'Detection ignored'
      ),
    });
  };

  const renderChip = (label: string, color: string) => (
    <View style={[styles.chip, { backgroundColor: `${color}18` }]}>
      <Text style={[typography.caption, { color, fontSize: 10, fontWeight: '700' }]}>{label}</Text>
    </View>
  );

  const renderActionButton = (
    label: string,
    icon: string,
    onPress: () => void,
    color: string,
    disabled = false
  ) => (
    <TouchableOpacity
      onPress={onPress}
      disabled={disabled}
      style={[
        styles.actionButton,
        {
          backgroundColor: `${color}14`,
          opacity: disabled ? 0.45 : 1,
        },
      ]}>
      <MaterialCommunityIcons name={icon} size={15} color={color} />
      <Text style={[typography.caption, { color, marginLeft: 4, fontWeight: '700', fontSize: 11 }]}>
        {label}
      </Text>
    </TouchableOpacity>
  );

  const renderReviewItem = (item: DetectedAccountReviewItem) => {
    const detection = detectionsById[item.id];
    if (!detection) return null;

    const last4 = item.cardLast4 || item.accountLast4;
    const last4Label = last4 ? `Ending ${last4}` : 'Last4 unknown';

    return (
      <Card key={item.id} style={{ marginBottom: spacing.md, padding: spacing.md }}>
        <View style={{ flexDirection: 'row', alignItems: 'flex-start' }}>
          <View style={[styles.iconCircle, { backgroundColor: `${colors.accent}18` }]}>
            <MaterialCommunityIcons
              name={item.detectionType === 'credit_card' || item.detectionType === 'debit_card' ? 'credit-card-outline' : 'bank-outline'}
              size={22}
              color={colors.accent}
            />
          </View>
          <View style={{ flex: 1, marginLeft: spacing.md }}>
            <Text style={[typography.bodyBold, { color: colors.text }]}>{item.bankName}</Text>
            <Text style={[typography.caption, { color: colors.subtext, marginTop: 2 }]}>
              {item.detectionTypeLabel} - {last4Label}
              {item.accountTypeHint ? ` - ${item.accountTypeHint}` : ''}
            </Text>

            {item.balanceLabel && (
              <Text style={[typography.caption, { color: colors.text, marginTop: spacing.xs }]}>
                {item.balanceLabel}
              </Text>
            )}

            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: spacing.sm }}>
              {renderChip(item.sourceLabel, colors.accent)}
              {renderChip(item.confidenceLabel, item.confidenceLabel === 'Exact' ? colors.success : colors.warning)}
              {renderChip(item.lastSeenLabel, colors.subtext)}
            </View>

            {item.duplicateOwner && (
              <Text style={[typography.caption, { color: colors.warning, marginTop: spacing.sm }]}>
                Matching owner exists: {item.duplicateOwner.label}. Link instead of creating a duplicate.
              </Text>
            )}

            {item.loanUnsupported && (
              <Text style={[typography.caption, { color: colors.subtext, marginTop: spacing.sm }]}>
                Loan confirmation is intentionally pending for a later task.
              </Text>
            )}

            <View style={styles.actionRow}>
              {item.loanUnsupported ? (
                renderActionButton('Keep pending', 'clock-outline', () => undefined, colors.subtext, true)
              ) : (
                <>
                  {renderActionButton(
                    item.detectionType === 'debit_card' ? 'Link card' : 'Confirm new',
                    'check-circle-outline',
                    () => openEditor(detection, item.detectionType as EditorKind),
                    colors.success,
                    Boolean(item.duplicateOwner)
                  )}
                  {renderActionButton(
                    'Edit',
                    'pencil-outline',
                    () => openEditor(detection, item.detectionType as EditorKind),
                    colors.accent
                  )}
                  {renderActionButton(
                    'Link',
                    'link-variant',
                    () => setMergeDetection(detection),
                    colors.warning
                  )}
                </>
              )}
              {renderActionButton('Ignore', 'eye-off-outline', () => requestIgnore(detection), colors.error)}
            </View>
          </View>
        </View>
      </Card>
    );
  };

  const renderSection = (
    title: string,
    icon: string,
    items: DetectedAccountReviewItem[]
  ) => {
    if (!items.length) return null;

    return (
      <View style={{ marginBottom: spacing.lg }}>
        <View style={styles.sectionHeader}>
          <MaterialCommunityIcons name={icon} size={18} color={colors.subtext} />
          <Text style={[typography.caption, styles.sectionTitle, { color: colors.subtext }]}>
            {title} ({items.length})
          </Text>
        </View>
        {items.map(renderReviewItem)}
      </View>
    );
  };

  const renderEditorModal = () => (
    <Modal visible={Boolean(editor)} animationType="slide" onRequestClose={closeEditor}>
      <ScreenWrapper keyboardAvoiding>
        <View style={[styles.modalHeader, { borderBottomColor: colors.border, padding: spacing.md }]}>
          <TouchableOpacity onPress={closeEditor} disabled={working}>
            <MaterialCommunityIcons name="close" size={24} color={colors.text} />
          </TouchableOpacity>
          <Text style={[typography.h3, { color: colors.text }]}>Review Detection</Text>
          <View style={{ width: 24 }} />
        </View>

        <ScrollView contentContainerStyle={{ padding: spacing.lg }}>
          <Text style={[typography.caption, { color: colors.warning, marginBottom: spacing.md }]}>
            This only creates or links an account/card after you confirm. It does not create a transaction.
          </Text>

          {editor?.kind === 'bank_account' && (
            <>
              <LabeledInput label="Bank name" value={bankName} onChangeText={setBankName} />
              <LabeledInput label="Account last4" value={accountLast4} onChangeText={setAccountLast4} keyboardType="number-pad" maxLength={4} />
              <Text style={[typography.caption, { color: colors.text, marginBottom: spacing.sm }]}>Account type</Text>
              <View style={styles.segmentRow}>
                {(['savings', 'current'] as const).map(type => (
                  <TouchableOpacity
                    key={type}
                    onPress={() => setAccountType(type)}
                    style={[
                      styles.segmentButton,
                      {
                        borderColor: accountType === type ? colors.accent : colors.border,
                        backgroundColor: accountType === type ? `${colors.accent}18` : colors.card,
                      },
                    ]}>
                    <Text style={[typography.caption, { color: accountType === type ? colors.accent : colors.text, fontWeight: '700' }]}>
                      {type === 'current' ? 'Current' : 'Savings'}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </>
          )}

          {editor?.kind === 'credit_card' && (
            <>
              <LabeledInput label="Bank name" value={bankName} onChangeText={setBankName} />
              <LabeledInput label="Card name" value={cardName} onChangeText={setCardName} />
              <LabeledInput label="Card last4" value={cardLast4} onChangeText={setCardLast4} keyboardType="number-pad" maxLength={4} />
              <LabeledInput label="Credit limit" value={creditLimit} onChangeText={setCreditLimit} keyboardType="decimal-pad" placeholder="0" />
              <View style={styles.twoColumnRow}>
                <LabeledInput label="Due day" value={dueDate} onChangeText={setDueDate} keyboardType="number-pad" maxLength={2} containerStyle={styles.halfInput} />
                <LabeledInput label="Billing day" value={billingCycleDate} onChangeText={setBillingCycleDate} keyboardType="number-pad" maxLength={2} containerStyle={styles.halfInput} />
              </View>
            </>
          )}

          {editor?.kind === 'debit_card' && (
            <>
              <LabeledInput label="Debit card last4" value={cardLast4} onChangeText={setCardLast4} keyboardType="number-pad" maxLength={4} />
              <LabeledInput label="Card label" value={debitCardLabel} onChangeText={setDebitCardLabel} />
              <Text style={[typography.caption, { color: colors.text, marginBottom: spacing.sm }]}>Linked bank account</Text>
              {linkableBankAccounts.length === 0 ? (
                <Text style={[typography.caption, { color: colors.warning, marginBottom: spacing.md }]}>
                  Create a bank account first, then return to link this debit card.
                </Text>
              ) : (
                linkableBankAccounts.map(account => (
                  <TouchableOpacity
                    key={account.id}
                    onPress={() => setLinkedBankAccountId(account.id)}
                    style={[
                      styles.ownerOption,
                      {
                        backgroundColor: linkedBankAccountId === account.id ? `${colors.accent}18` : colors.card,
                        borderColor: linkedBankAccountId === account.id ? colors.accent : colors.border,
                      },
                    ]}>
                    <Text style={[typography.bodyBold, { color: colors.text }]}>{account.bank_name}</Text>
                    <Text style={[typography.caption, { color: colors.subtext }]}>
                      Ending {account.account_last4} - {account.account_type === 'current' ? 'Current' : 'Savings'}
                    </Text>
                  </TouchableOpacity>
                ))
              )}
            </>
          )}

          <AppButton
            title={editor?.kind === 'debit_card' ? 'Review Link' : 'Review Create'}
            onPress={requestCreate}
            disabled={working || (editor?.kind === 'debit_card' && !linkedBankAccountId)}
            loading={working}
            fullWidth
            style={{ marginTop: spacing.lg }}
          />
        </ScrollView>
      </ScreenWrapper>
    </Modal>
  );

  const mergeOptions = mergeDetection
    ? buildMergeOwnerOptions(mergeDetection, data.accounts, data.creditCards, data.debitCards)
    : [];

  const renderMergeModal = () => (
    <Modal visible={Boolean(mergeDetection)} animationType="slide" onRequestClose={() => setMergeDetection(null)}>
      <ScreenWrapper>
        <View style={[styles.modalHeader, { borderBottomColor: colors.border, padding: spacing.md }]}>
          <TouchableOpacity onPress={() => setMergeDetection(null)} disabled={working}>
            <MaterialCommunityIcons name="close" size={24} color={colors.text} />
          </TouchableOpacity>
          <Text style={[typography.h3, { color: colors.text }]}>Link Existing</Text>
          <View style={{ width: 24 }} />
        </View>

        <ScrollView contentContainerStyle={{ padding: spacing.lg }}>
          <Text style={[typography.caption, { color: colors.subtext, marginBottom: spacing.lg }]}>
            Choose an existing owner. This only marks the detection as linked and may copy a safe balance snapshot.
          </Text>
          {mergeOptions.length === 0 ? (
            <Card style={{ padding: spacing.lg, alignItems: 'center' }}>
              <MaterialCommunityIcons name="link-off" size={32} color={colors.subtext} />
              <Text style={[typography.bodyBold, { color: colors.text, marginTop: spacing.md }]}>No existing match</Text>
              <Text style={[typography.caption, { color: colors.subtext, marginTop: spacing.xs, textAlign: 'center' }]}>
                Confirm as new after editing, or keep this detection pending.
              </Text>
            </Card>
          ) : (
            mergeOptions.map(owner => (
              <TouchableOpacity
                key={`${owner.ownerType}:${owner.ownerId}`}
                onPress={() => mergeDetection && requestMerge(mergeDetection, owner)}
                style={[styles.ownerOption, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <Text style={[typography.bodyBold, { color: colors.text }]}>{owner.label}</Text>
                <Text style={[typography.caption, { color: colors.subtext, marginTop: 2 }]}>{owner.subtitle}</Text>
              </TouchableOpacity>
            ))
          )}
        </ScrollView>
      </ScreenWrapper>
    </Modal>
  );

  function LabeledInput({
    label,
    value,
    onChangeText,
    keyboardType,
    maxLength,
    placeholder,
    containerStyle,
  }: {
    label: string;
    value: string;
    onChangeText: (value: string) => void;
    keyboardType?: 'default' | 'number-pad' | 'decimal-pad';
    maxLength?: number;
    placeholder?: string;
    containerStyle?: object;
  }) {
    return (
      <View style={[{ marginBottom: spacing.md }, containerStyle]}>
        <Text style={[typography.caption, { color: colors.text, marginBottom: spacing.xs }]}>{label}</Text>
        <TextInput
          value={value}
          onChangeText={onChangeText}
          keyboardType={keyboardType}
          maxLength={maxLength}
          placeholder={placeholder}
          placeholderTextColor={colors.subtext}
          style={[
            typography.body,
            {
              backgroundColor: colors.card,
              borderColor: colors.border,
              borderWidth: 1,
              borderRadius: 8,
              color: colors.text,
              paddingHorizontal: spacing.md,
              paddingVertical: spacing.sm,
            },
          ]}
        />
      </View>
    );
  }

  return (
    <ScreenWrapper>
      <AppHeader title="Detected Accounts" showBack />
      {loading ? (
        <View style={styles.loadingState}>
          <ActivityIndicator color={colors.accent} />
          <Text style={[typography.caption, { color: colors.subtext, marginTop: spacing.sm }]}>Loading detections...</Text>
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={{ padding: spacing.lg }}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => loadData(true)}
              colors={[colors.accent]}
              tintColor={colors.accent}
            />
          }>
          {data.items.length === 0 ? (
            <Card style={{ padding: spacing.xl, alignItems: 'center' }}>
              <MaterialCommunityIcons name="radar" size={42} color={colors.subtext} />
              <Text style={[typography.bodyBold, { color: colors.text, marginTop: spacing.md }]}>No pending detections</Text>
              <Text style={[typography.caption, { color: colors.subtext, textAlign: 'center', marginTop: spacing.xs }]}>
                New accounts and cards detected from safe balance signals will appear here for review.
              </Text>
            </Card>
          ) : (
            <>
              {renderSection('Bank accounts', 'bank-outline', groupedItems.bank_account)}
              {renderSection('Credit cards', 'credit-card-outline', groupedItems.credit_card)}
              {renderSection('Debit cards', 'card-account-details-outline', groupedItems.debit_card)}
              {renderSection('Loans', 'cash-clock', groupedItems.loan)}
            </>
          )}
        </ScrollView>
      )}

      {renderEditorModal()}
      {renderMergeModal()}
      <AppConfirmModal
        visible={Boolean(confirmDialog)}
        title={confirmDialog?.title || ''}
        message={confirmDialog?.message || ''}
        confirmText={confirmDialog?.confirmText || 'Confirm'}
        isDestructive={confirmDialog?.isDestructive}
        loading={working}
        onConfirm={() => {
          confirmDialog?.onConfirm();
        }}
        onCancel={() => {
          if (!working) setConfirmDialog(null);
        }}
      />
    </ScreenWrapper>
  );
}

const styles = StyleSheet.create({
  loadingState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10,
  },
  sectionTitle: {
    marginLeft: 6,
    textTransform: 'uppercase',
    fontWeight: '700',
    letterSpacing: 1,
  },
  iconCircle: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chip: {
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  actionRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 12,
  },
  actionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 8,
    paddingHorizontal: 9,
    paddingVertical: 7,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  segmentRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 16,
  },
  segmentButton: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 8,
    paddingVertical: 10,
    alignItems: 'center',
  },
  twoColumnRow: {
    flexDirection: 'row',
    gap: 12,
  },
  halfInput: {
    flex: 1,
  },
  ownerOption: {
    borderWidth: 1,
    borderRadius: 10,
    padding: 14,
    marginBottom: 10,
  },
});
