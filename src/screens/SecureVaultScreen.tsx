import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, Modal, ScrollView,
  TextInput, Alert, RefreshControl, Clipboard,
} from 'react-native';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Toast from 'react-native-toast-message';
import { useTheme } from '../context/ThemeContext';
import { ScreenWrapper, Card, AppHeader } from '../components';
import AppConfirmModal from '../components/ui/AppConfirmModal';
import AppButton from '../components/ui/AppButton';

const VAULT_STORAGE_KEY = 'secure_vault_items_v1';

type VaultCategory = 'bank_pin' | 'upi_pin' | 'card' | 'netbanking' | 'app_password' | 'other';

interface VaultItem {
  id: string;
  title: string;
  category: VaultCategory;
  fields: { label: string; value: string; isSecret: boolean }[];
  notes: string;
  createdAt: string;
  updatedAt: string;
}

const CATEGORY_CONFIG: Record<VaultCategory, { label: string; icon: string; color: string }> = {
  bank_pin: { label: 'Bank PIN / MPIN', icon: 'bank', color: '#10b981' },
  upi_pin: { label: 'UPI PIN', icon: 'cellphone-nfc', color: '#6366f1' },
  card: { label: 'Card Details', icon: 'credit-card', color: '#f59e0b' },
  netbanking: { label: 'Net Banking', icon: 'web', color: '#3b82f6' },
  app_password: { label: 'App Password', icon: 'lock', color: '#ec4899' },
  other: { label: 'Other', icon: 'key-variant', color: '#8b5cf6' },
};

const TEMPLATES: Record<VaultCategory, { label: string; isSecret: boolean }[]> = {
  bank_pin: [
    { label: 'Bank Name', isSecret: false },
    { label: 'Account Number', isSecret: true },
    { label: 'ATM PIN', isSecret: true },
    { label: 'MPIN', isSecret: true },
    { label: 'Transaction PIN', isSecret: true },
  ],
  upi_pin: [
    { label: 'App Name (GPay/PhonePe)', isSecret: false },
    { label: 'UPI ID', isSecret: false },
    { label: 'UPI PIN', isSecret: true },
  ],
  card: [
    { label: 'Card Name', isSecret: false },
    { label: 'Card Number', isSecret: true },
    { label: 'Expiry (MM/YY)', isSecret: false },
    { label: 'CVV', isSecret: true },
    { label: 'Card PIN', isSecret: true },
  ],
  netbanking: [
    { label: 'Bank Name', isSecret: false },
    { label: 'Customer ID / Username', isSecret: false },
    { label: 'Login Password', isSecret: true },
    { label: 'Transaction Password', isSecret: true },
  ],
  app_password: [
    { label: 'App / Website Name', isSecret: false },
    { label: 'Username / Email', isSecret: false },
    { label: 'Password', isSecret: true },
  ],
  other: [
    { label: 'Title', isSecret: false },
    { label: 'Value', isSecret: true },
  ],
};

export default function SecureVaultScreen() {
  const { colors, typography, spacing, borderRadius } = useTheme();
  const [items, setItems] = useState<VaultItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);
  const [showCategoryPicker, setShowCategoryPicker] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState<VaultCategory | null>(null);
  const [editingItem, setEditingItem] = useState<VaultItem | null>(null);
  const [viewingItem, setViewingItem] = useState<VaultItem | null>(null);
  const [revealedFields, setRevealedFields] = useState<Set<number>>(new Set());
  const [deleteConfirm, setDeleteConfirm] = useState<VaultItem | null>(null);

  // Form state
  const [formTitle, setFormTitle] = useState('');
  const [formFields, setFormFields] = useState<{ label: string; value: string; isSecret: boolean }[]>([]);
  const [formNotes, setFormNotes] = useState('');

  useEffect(() => {
    loadItems();
  }, []);

  const loadItems = async () => {
    try {
      const stored = await AsyncStorage.getItem(VAULT_STORAGE_KEY);
      if (stored) {
        setItems(JSON.parse(stored));
      }
    } catch (e) {
      console.error('Error loading vault items:', e);
    } finally {
      setLoading(false);
    }
  };

  const saveItems = async (newItems: VaultItem[]) => {
    try {
      await AsyncStorage.setItem(VAULT_STORAGE_KEY, JSON.stringify(newItems));
      setItems(newItems);
    } catch (e) {
      console.error('Error saving vault items:', e);
    }
  };

  const onRefresh = async () => {
    setRefreshing(true);
    await loadItems();
    setRefreshing(false);
  };

  const openAddModal = (category: VaultCategory) => {
    setSelectedCategory(category);
    setFormTitle('');
    setFormFields(TEMPLATES[category].map(t => ({ ...t, value: '' })));
    setFormNotes('');
    setEditingItem(null);
    setShowCategoryPicker(false);
    setShowAddModal(true);
  };

  const openEditModal = (item: VaultItem) => {
    setSelectedCategory(item.category);
    setFormTitle(item.title);
    setFormFields([...item.fields]);
    setFormNotes(item.notes);
    setEditingItem(item);
    setViewingItem(null);
    setShowAddModal(true);
  };

  const handleSave = async () => {
    if (!formTitle.trim()) {
      Toast.show({ type: 'error', text1: 'Error', text2: 'Please enter a title' });
      return;
    }

    const now = new Date().toISOString();
    let newItems: VaultItem[];

    if (editingItem) {
      newItems = items.map(i =>
        i.id === editingItem.id
          ? { ...i, title: formTitle.trim(), fields: formFields, notes: formNotes, updatedAt: now }
          : i
      );
    } else {
      const newItem: VaultItem = {
        id: Date.now().toString(),
        title: formTitle.trim(),
        category: selectedCategory!,
        fields: formFields,
        notes: formNotes,
        createdAt: now,
        updatedAt: now,
      };
      newItems = [newItem, ...items];
    }

    await saveItems(newItems);
    setShowAddModal(false);
    Toast.show({
      type: 'success',
      text1: editingItem ? 'Updated' : 'Saved',
      text2: `${formTitle.trim()} has been ${editingItem ? 'updated' : 'saved'} securely`,
    });
  };

  const handleDelete = async (item: VaultItem) => {
    const newItems = items.filter(i => i.id !== item.id);
    await saveItems(newItems);
    setDeleteConfirm(null);
    setViewingItem(null);
    Toast.show({ type: 'success', text1: 'Deleted', text2: `${item.title} removed from vault` });
  };

  const copyToClipboard = (value: string, label: string) => {
    Clipboard.setString(value);
    Toast.show({ type: 'info', text1: 'Copied', text2: `${label} copied to clipboard` });
  };

  const toggleReveal = (index: number) => {
    setRevealedFields(prev => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  };

  const groupedItems = items.reduce((acc, item) => {
    if (!acc[item.category]) acc[item.category] = [];
    acc[item.category].push(item);
    return acc;
  }, {} as Record<VaultCategory, VaultItem[]>);

  return (
    <ScreenWrapper>
      <AppHeader title="Secure Vault" />

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ padding: spacing.lg, paddingBottom: 100 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.accent} colors={[colors.accent]} />}
      >
        {/* Hero */}
        <View style={[styles.heroCard, { backgroundColor: colors.accent }]}>
          <View style={styles.heroCircle1} />
          <View style={styles.heroCircle2} />
          <MaterialCommunityIcons name="shield-lock" size={36} color="#fff" />
          <Text style={[typography.h2, { color: '#fff', marginTop: 8 }]}>Your Digital Safe</Text>
          <Text style={[typography.caption, { color: 'rgba(255,255,255,0.8)', marginTop: 4 }]}>
            {items.length} {items.length === 1 ? 'item' : 'items'} stored securely
          </Text>
        </View>

        {/* Empty State */}
        {items.length === 0 && !loading && (
          <View style={{ alignItems: 'center', paddingVertical: 40 }}>
            <MaterialCommunityIcons name="safe-square-outline" size={64} color={colors.subtext} />
            <Text style={[typography.body, { color: colors.subtext, marginTop: spacing.md, textAlign: 'center' }]}>
              No items in your vault yet.{'\n'}Tap + to add your first secure item.
            </Text>
          </View>
        )}

        {/* Grouped Items */}
        {Object.entries(groupedItems).map(([cat, catItems]) => {
          const config = CATEGORY_CONFIG[cat as VaultCategory];
          return (
            <View key={cat} style={{ marginTop: spacing.lg }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: spacing.sm }}>
                <MaterialCommunityIcons name={config.icon as any} size={20} color={config.color} />
                <Text style={[typography.bodyBold, { color: colors.text, marginLeft: 8 }]}>{config.label}</Text>
                <View style={[styles.countBadge, { backgroundColor: config.color + '20' }]}>
                  <Text style={[typography.caption, { color: config.color, fontWeight: 'bold', fontSize: 11 }]}>{catItems.length}</Text>
                </View>
              </View>
              {catItems.map(item => (
                <TouchableOpacity
                  key={item.id}
                  onPress={() => { setViewingItem(item); setRevealedFields(new Set()); }}
                  activeOpacity={0.7}
                >
                  <Card style={{ marginBottom: spacing.sm, flexDirection: 'row', alignItems: 'center' }}>
                    <View style={[styles.itemIcon, { backgroundColor: config.color + '15' }]}>
                      <MaterialCommunityIcons name={config.icon as any} size={22} color={config.color} />
                    </View>
                    <View style={{ flex: 1, marginLeft: 12 }}>
                      <Text style={[typography.bodyBold, { color: colors.text }]}>{item.title}</Text>
                      <Text style={[typography.caption, { color: colors.subtext, fontSize: 11 }]}>
                        {item.fields.filter(f => !f.isSecret && f.value).map(f => f.value).join(' • ') || 'Tap to view'}
                      </Text>
                    </View>
                    <MaterialCommunityIcons name="chevron-right" size={22} color={colors.subtext} />
                  </Card>
                </TouchableOpacity>
              ))}
            </View>
          );
        })}
      </ScrollView>

      {/* FAB */}
      <TouchableOpacity
        style={[styles.fab, { backgroundColor: colors.accent }]}
        onPress={() => setShowCategoryPicker(true)}
        activeOpacity={0.8}
      >
        <MaterialCommunityIcons name="plus" size={28} color="#fff" />
      </TouchableOpacity>

      {/* Category Picker Modal */}
      <Modal visible={showCategoryPicker} transparent animationType="fade" onRequestClose={() => setShowCategoryPicker(false)}>
        <View style={[styles.modalOverlay, { backgroundColor: 'rgba(0,0,0,0.6)' }]}>
          <View style={[styles.modalContent, { backgroundColor: colors.card, borderRadius: borderRadius.lg, padding: spacing.lg }]}>
            <Text style={[typography.h3, { color: colors.text, marginBottom: spacing.lg }]}>What do you want to save?</Text>
            {Object.entries(CATEGORY_CONFIG).map(([key, config]) => (
              <TouchableOpacity
                key={key}
                style={[styles.categoryRow, { borderBottomColor: colors.border }]}
                onPress={() => openAddModal(key as VaultCategory)}
              >
                <View style={[styles.categoryIcon, { backgroundColor: config.color + '15' }]}>
                  <MaterialCommunityIcons name={config.icon as any} size={24} color={config.color} />
                </View>
                <Text style={[typography.body, { color: colors.text, flex: 1, marginLeft: 12 }]}>{config.label}</Text>
                <MaterialCommunityIcons name="chevron-right" size={20} color={colors.subtext} />
              </TouchableOpacity>
            ))}
            <TouchableOpacity onPress={() => setShowCategoryPicker(false)} style={{ marginTop: spacing.md, alignSelf: 'center' }}>
              <Text style={[typography.body, { color: colors.subtext }]}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Add/Edit Modal */}
      <Modal visible={showAddModal} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setShowAddModal(false)}>
        <View style={{ flex: 1, backgroundColor: colors.background }}>
          <View style={[styles.modalHeader, { borderBottomColor: colors.border, backgroundColor: colors.card }]}>
            <TouchableOpacity onPress={() => setShowAddModal(false)}>
              <MaterialCommunityIcons name="close" size={24} color={colors.text} />
            </TouchableOpacity>
            <Text style={[typography.h3, { color: colors.text, flex: 1, textAlign: 'center' }]}>
              {editingItem ? 'Edit Item' : `Add ${selectedCategory ? CATEGORY_CONFIG[selectedCategory].label : ''}`}
            </Text>
            <TouchableOpacity onPress={handleSave}>
              <Text style={[typography.bodyBold, { color: colors.accent }]}>Save</Text>
            </TouchableOpacity>
          </View>

          <ScrollView contentContainerStyle={{ padding: spacing.lg }}>
            <Text style={[typography.caption, { color: colors.subtext, marginBottom: 6 }]}>TITLE</Text>
            <TextInput
              style={[styles.input, { backgroundColor: colors.card, color: colors.text, borderColor: colors.border, borderRadius: borderRadius.md }]}
              value={formTitle}
              onChangeText={setFormTitle}
              placeholder="e.g. SBI Main Account"
              placeholderTextColor={colors.subtext}
            />

            {formFields.map((field, index) => (
              <View key={index}>
                <Text style={[typography.caption, { color: colors.subtext, marginBottom: 6, marginTop: spacing.md }]}>
                  {field.label.toUpperCase()} {field.isSecret && '🔒'}
                </Text>
                <TextInput
                  style={[styles.input, { backgroundColor: colors.card, color: colors.text, borderColor: colors.border, borderRadius: borderRadius.md }]}
                  value={field.value}
                  onChangeText={(text) => {
                    const updated = [...formFields];
                    updated[index] = { ...updated[index], value: text };
                    setFormFields(updated);
                  }}
                  placeholder={`Enter ${field.label.toLowerCase()}`}
                  placeholderTextColor={colors.subtext}
                  secureTextEntry={false}
                  keyboardType={field.label.toLowerCase().includes('pin') || field.label.toLowerCase().includes('cvv') ? 'numeric' : 'default'}
                />
              </View>
            ))}

            <Text style={[typography.caption, { color: colors.subtext, marginBottom: 6, marginTop: spacing.md }]}>NOTES (OPTIONAL)</Text>
            <TextInput
              style={[styles.input, styles.textArea, { backgroundColor: colors.card, color: colors.text, borderColor: colors.border, borderRadius: borderRadius.md }]}
              value={formNotes}
              onChangeText={setFormNotes}
              placeholder="Any extra info..."
              placeholderTextColor={colors.subtext}
              multiline
              numberOfLines={3}
            />
          </ScrollView>
        </View>
      </Modal>

      {/* View Item Modal */}
      <Modal visible={!!viewingItem} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setViewingItem(null)}>
        {viewingItem && (
          <View style={{ flex: 1, backgroundColor: colors.background }}>
            <View style={[styles.modalHeader, { borderBottomColor: colors.border, backgroundColor: colors.card }]}>
              <TouchableOpacity onPress={() => setViewingItem(null)}>
                <MaterialCommunityIcons name="close" size={24} color={colors.text} />
              </TouchableOpacity>
              <Text style={[typography.h3, { color: colors.text, flex: 1, textAlign: 'center' }]}>{viewingItem.title}</Text>
              <TouchableOpacity onPress={() => openEditModal(viewingItem)}>
                <MaterialCommunityIcons name="pencil" size={22} color={colors.accent} />
              </TouchableOpacity>
            </View>

            <ScrollView contentContainerStyle={{ padding: spacing.lg }}>
              {/* Category badge */}
              <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: spacing.lg }}>
                <View style={[styles.categoryIcon, { backgroundColor: CATEGORY_CONFIG[viewingItem.category].color + '15' }]}>
                  <MaterialCommunityIcons name={CATEGORY_CONFIG[viewingItem.category].icon as any} size={24} color={CATEGORY_CONFIG[viewingItem.category].color} />
                </View>
                <Text style={[typography.bodyBold, { color: CATEGORY_CONFIG[viewingItem.category].color, marginLeft: 8 }]}>
                  {CATEGORY_CONFIG[viewingItem.category].label}
                </Text>
              </View>

              {/* Fields */}
              {viewingItem.fields.map((field, index) => (
                <View key={index} style={[styles.fieldCard, { backgroundColor: colors.card, borderRadius: borderRadius.md, borderColor: colors.border }]}>
                  <View style={{ flex: 1 }}>
                    <Text style={[typography.caption, { color: colors.subtext, fontSize: 11 }]}>{field.label}</Text>
                    <Text style={[typography.body, { color: colors.text, marginTop: 4, fontSize: 16 }]}>
                      {field.isSecret && !revealedFields.has(index) ? '••••••••' : (field.value || '—')}
                    </Text>
                  </View>
                  <View style={{ flexDirection: 'row', gap: 8 }}>
                    {field.isSecret && (
                      <TouchableOpacity onPress={() => toggleReveal(index)} style={styles.fieldAction}>
                        <MaterialCommunityIcons name={revealedFields.has(index) ? 'eye-off' : 'eye'} size={20} color={colors.accent} />
                      </TouchableOpacity>
                    )}
                    {field.value ? (
                      <TouchableOpacity onPress={() => copyToClipboard(field.value, field.label)} style={styles.fieldAction}>
                        <MaterialCommunityIcons name="content-copy" size={18} color={colors.subtext} />
                      </TouchableOpacity>
                    ) : null}
                  </View>
                </View>
              ))}

              {/* Notes */}
              {viewingItem.notes ? (
                <View style={{ marginTop: spacing.lg }}>
                  <Text style={[typography.caption, { color: colors.subtext, marginBottom: 6 }]}>NOTES</Text>
                  <Card style={{ padding: spacing.md }}>
                    <Text style={[typography.body, { color: colors.text, lineHeight: 22 }]}>{viewingItem.notes}</Text>
                  </Card>
                </View>
              ) : null}

              {/* Delete */}
              <TouchableOpacity
                style={[styles.deleteBtn, { borderColor: '#ef4444', borderRadius: borderRadius.md }]}
                onPress={() => setDeleteConfirm(viewingItem)}
              >
                <MaterialCommunityIcons name="trash-can-outline" size={20} color="#ef4444" />
                <Text style={[typography.body, { color: '#ef4444', marginLeft: 8 }]}>Delete this item</Text>
              </TouchableOpacity>

              <Text style={[typography.caption, { color: colors.subtext, textAlign: 'center', marginTop: spacing.lg, fontSize: 11 }]}>
                Last updated: {new Date(viewingItem.updatedAt).toLocaleString()}
              </Text>
            </ScrollView>
          </View>
        )}
      </Modal>

      {/* Delete Confirmation */}
      <AppConfirmModal
        visible={!!deleteConfirm}
        title="Delete Item"
        message={`Are you sure you want to delete "${deleteConfirm?.title}"? This cannot be undone.`}
        confirmText="Delete"
        isDestructive
        onConfirm={() => deleteConfirm && handleDelete(deleteConfirm)}
        onCancel={() => setDeleteConfirm(null)}
      />
    </ScreenWrapper>
  );
}

const styles = StyleSheet.create({
  heroCard: {
    borderRadius: 16, padding: 20, alignItems: 'center',
    position: 'relative', overflow: 'hidden', elevation: 6,
    shadowColor: '#000', shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.3, shadowRadius: 4,
  },
  heroCircle1: {
    position: 'absolute', width: 150, height: 150, borderRadius: 75,
    backgroundColor: 'rgba(255,255,255,0.08)', top: -30, right: -30,
  },
  heroCircle2: {
    position: 'absolute', width: 100, height: 100, borderRadius: 50,
    backgroundColor: 'rgba(255,255,255,0.05)', bottom: -20, left: -20,
  },
  countBadge: {
    marginLeft: 8, paddingHorizontal: 8, paddingVertical: 2, borderRadius: 10,
  },
  itemIcon: {
    width: 44, height: 44, borderRadius: 12, justifyContent: 'center', alignItems: 'center',
  },
  fab: {
    position: 'absolute', bottom: 24, right: 20, width: 56, height: 56, borderRadius: 28,
    justifyContent: 'center', alignItems: 'center', elevation: 6,
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 4,
  },
  modalOverlay: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  modalContent: { width: '90%', maxWidth: 400 },
  modalHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    padding: 16, borderBottomWidth: 1,
  },
  categoryRow: {
    flexDirection: 'row', alignItems: 'center', paddingVertical: 14, borderBottomWidth: 0.5,
  },
  categoryIcon: {
    width: 40, height: 40, borderRadius: 10, justifyContent: 'center', alignItems: 'center',
  },
  input: {
    borderWidth: 1, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15,
  },
  textArea: { textAlignVertical: 'top', minHeight: 80 },
  fieldCard: {
    flexDirection: 'row', alignItems: 'center', padding: 14,
    marginBottom: 10, borderWidth: 1,
  },
  fieldAction: { padding: 6 },
  deleteBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    paddingVertical: 14, marginTop: 24, borderWidth: 1,
  },
});
