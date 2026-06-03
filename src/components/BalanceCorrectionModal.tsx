import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';
import Toast from 'react-native-toast-message';
import { useTheme } from '../context/ThemeContext';
import { BalanceKind, BalanceOwnerType, BalanceSnapshot } from '../types';
import {
  createManualBalanceCorrectionSnapshot,
  parseManualBalanceCorrectionAmount,
} from '../lib/services/balanceSnapshots';

export interface BalanceCorrectionKindOption {
  kind: BalanceKind;
  label: string;
}

type ManualCorrectionOwnerType = Extract<BalanceOwnerType, 'bank_account' | 'credit_card' | 'loan'>;

interface BalanceCorrectionModalProps {
  visible: boolean;
  ownerType: ManualCorrectionOwnerType;
  ownerId: string;
  ownerDisplayName: string;
  accountLast4?: string | null;
  cardLast4?: string | null;
  detectedBankName?: string | null;
  kindOptions: BalanceCorrectionKindOption[];
  defaultKind?: BalanceKind;
  onClose: () => void;
  onSaved: (snapshot: BalanceSnapshot) => Promise<void> | void;
}

export default function BalanceCorrectionModal({
  visible,
  ownerType,
  ownerId,
  ownerDisplayName,
  accountLast4,
  cardLast4,
  detectedBankName,
  kindOptions,
  defaultKind,
  onClose,
  onSaved,
}: BalanceCorrectionModalProps) {
  const { colors, typography, spacing } = useTheme();
  const resolvedDefaultKind = useMemo(
    () => defaultKind || kindOptions[0]?.kind || 'available_balance',
    [defaultKind, kindOptions]
  );
  const [selectedKind, setSelectedKind] = useState<BalanceKind>(resolvedDefaultKind);
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) return;
    setSelectedKind(resolvedDefaultKind);
    setAmount('');
    setNote('');
    setError(null);
    setSaving(false);
  }, [resolvedDefaultKind, visible]);

  const parsedAmount = parseManualBalanceCorrectionAmount(amount);
  const canSave = parsedAmount !== null && !saving;

  const handleSave = async () => {
    if (parsedAmount === null) {
      setError('Enter a valid non-negative amount');
      return;
    }

    setSaving(true);
    setError(null);
    try {
      const snapshot = await createManualBalanceCorrectionSnapshot({
        owner_type: ownerType,
        owner_id: ownerId,
        balance_kind: selectedKind,
        amount: parsedAmount,
        note,
        account_last4: accountLast4,
        card_last4: cardLast4,
        detected_bank_name: detectedBankName,
      });
      await onSaved(snapshot);
      onClose();
    } catch {
      setError('Could not update balance. Try again.');
      Toast.show({
        type: 'error',
        text1: 'Could not update balance',
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={[styles.sheet, { backgroundColor: colors.card }]}>
          <View style={styles.header}>
            <View style={{ flex: 1 }}>
              <Text style={[typography.h3, { color: colors.text }]}>Update Balance</Text>
              <Text style={[typography.caption, { color: colors.subtext, marginTop: 2 }]} numberOfLines={1}>
                {ownerDisplayName}
              </Text>
            </View>
            <TouchableOpacity onPress={onClose} disabled={saving} style={styles.iconButton}>
              <MaterialCommunityIcons name="close" size={22} color={colors.text} />
            </TouchableOpacity>
          </View>

          <ScrollView showsVerticalScrollIndicator={false}>
            <Text style={[typography.caption, { color: colors.subtext, marginBottom: 4 }]}>Balance Kind</Text>
            <View style={styles.optionWrap}>
              {kindOptions.map(option => {
                const active = selectedKind === option.kind;
                return (
                  <TouchableOpacity
                    key={option.kind}
                    onPress={() => setSelectedKind(option.kind)}
                    disabled={saving}
                    style={[
                      styles.kindOption,
                      {
                        backgroundColor: active ? colors.accent + '20' : colors.background,
                        borderColor: active ? colors.accent : colors.border,
                      },
                    ]}>
                    <Text style={[typography.caption, { color: active ? colors.accent : colors.text, fontWeight: '700' }]}>
                      {option.label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            <Text style={[typography.caption, { color: colors.subtext, marginBottom: 4 }]}>Amount</Text>
            <TextInput
              value={amount}
              onChangeText={(value) => {
                setAmount(value);
                if (error) setError(null);
              }}
              placeholder="0.00"
              placeholderTextColor={colors.subtext}
              keyboardType="decimal-pad"
              editable={!saving}
              style={[styles.input, typography.body, { backgroundColor: colors.background, color: colors.text }]}
            />

            <Text style={[typography.caption, { color: colors.subtext, marginBottom: 4 }]}>Note (optional)</Text>
            <TextInput
              value={note}
              onChangeText={setNote}
              placeholder="Manual check"
              placeholderTextColor={colors.subtext}
              maxLength={120}
              editable={!saving}
              style={[styles.input, typography.body, { backgroundColor: colors.background, color: colors.text }]}
            />

            <View style={[styles.sourceRow, { backgroundColor: colors.accent + '12' }]}>
              <MaterialCommunityIcons name="pencil-circle-outline" size={18} color={colors.accent} />
              <Text style={[typography.caption, { color: colors.accent, marginLeft: 6, fontWeight: '700' }]}>
                Source: Manual / Exact
              </Text>
            </View>

            <Text style={[typography.caption, { color: colors.subtext, lineHeight: 18 }]}>
              This updates displayed balance only. It does not create a transaction.
            </Text>

            {error && (
              <Text style={[typography.caption, { color: colors.error, marginTop: spacing.sm }]}>
                {error}
              </Text>
            )}

            <TouchableOpacity
              onPress={handleSave}
              disabled={!canSave}
              style={[styles.saveButton, { backgroundColor: colors.accent, opacity: canSave ? 1 : 0.55 }]}>
              {saving ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={[typography.bodyBold, { color: '#fff' }]}>Save Balance</Text>
              )}
            </TouchableOpacity>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.5)',
    padding: 20,
  },
  sheet: {
    width: '100%',
    maxHeight: '88%',
    borderRadius: 16,
    padding: 20,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 18,
  },
  iconButton: {
    padding: 6,
    marginLeft: 10,
  },
  optionWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 16,
  },
  kindOption: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  input: {
    borderRadius: 8,
    padding: 12,
    marginBottom: 16,
  },
  sourceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    marginBottom: 10,
  },
  saveButton: {
    minHeight: 48,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 18,
  },
});
