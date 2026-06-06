import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TextInput,
  TouchableOpacity,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  PermissionsAndroid,
} from 'react-native';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';
import Toast from 'react-native-toast-message';
import type { SpeechResultsEvent, SpeechErrorEvent } from '@react-native-voice/voice';
import { useTheme } from '../../context/ThemeContext';
import { parseNaturalLanguageTxn, ParsedTransaction } from '../../utils/nlpParser';
import { addTransaction } from '../../lib/core';
import { CACHE_KEYS, updateCache } from '../../lib/services/cache';
import { Transaction } from '../../types';

type VoiceModule = typeof import('@react-native-voice/voice').default;
let voiceModule: VoiceModule | null = null;

function getVoiceModule(): VoiceModule {
  if (!voiceModule) {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const loadedVoiceModule = require('@react-native-voice/voice').default as VoiceModule;
    voiceModule = loadedVoiceModule;
    return loadedVoiceModule;
  }
  return voiceModule;
}

interface QuickAddModalProps {
  visible: boolean;
  onClose: () => void;
  onSuccess?: () => void;
}

export default function QuickAddModal({ visible, onClose, onSuccess }: QuickAddModalProps) {
  const { colors, typography, borderRadius } = useTheme();
  const [input, setInput] = useState('');
  const [parsed, setParsed] = useState<ParsedTransaction | null>(null);
  const [saving, setSaving] = useState(false);
  const [isListening, setIsListening] = useState(false);

  const [aiWarning, setAiWarning] = useState<{ emoji: string; msg: string } | null>(null);
  const isListeningRef = useRef(false);

  // Smart contextual warning generator — instant, no API!
  const getSmartWarning = (text: string): { emoji: string; msg: string } => {
    const lower = text.toLowerCase().trim();
    const words = lower.split(/\s+/);

    // Greeting detection
    if (/\b(hello|hi|hey|hola|namaste|namaskar|ram ram|jai|hii+|helo+)\b/.test(lower)) {
      const greetings = [
        { emoji: '👋', msg: `Hello! Add an amount, like "500 tea paid".` },
        { emoji: '🙏', msg: `Hi there. Try a transaction such as "500 tea paid".` },
        { emoji: '😊', msg: `Nice greeting. Now add the amount and whether it was income or expense.` },
      ];
      return greetings[words.length % greetings.length];
    }

    // Love/emotion detection
    if (/\b(love|pyaar|pyar|ishq|dil|heart|miss|baby|jaan|sweetheart)\b/.test(lower)) {
      const love = [
        { emoji: '💕', msg: `That is sweet, but I still need an amount.` },
        { emoji: '😍', msg: `Feelings noted. Add the money amount to save this.` },
        { emoji: '💸', msg: `Love may be free, but transactions need an amount.` },
      ];
      return love[words.length % love.length];
    }

    // Name/person detection
    if (/\b(bhai|bro|brother|dost|friend|yaar|boss|sir|mam|papa|mummy|mom|dad)\b/.test(lower)) {
      return { emoji: '🤝', msg: `You mentioned a person. Add the amount and whether money came in or went out.` };
    }

    // Question detection
    if (/\b(kya|kaise|kab|kyun|why|what|how|when|where|kaha|kaun)\b/.test(lower) || lower.includes('?')) {
      return { emoji: '❓', msg: `Use a transaction phrase instead, like "500 petrol paid".` };
    }

    // Food mentions without amount
    if (/\b(pizza|burger|biryani|chai|coffee|momos|samosa|dosa|maggi|noodles)\b/.test(lower)) {
      return { emoji: '🍕', msg: `Food noted. Add the amount, like "250 lunch paid".` };
    }

    // Frustration/abuse detection  
    if (/\b(bakwas|bekar|faltu|stupid|pagal|mad|bore|boring|waste)\b/.test(lower)) {
      return { emoji: '😤', msg: `I can help. Try a transaction like "1000 shopping paid".` };
    }

    // Song/music/fun
    if (/\b(song|gaana|music|dance|party|masti|fun|game|cricket|football)\b/.test(lower)) {
      return { emoji: '🎶', msg: `Fun noted. Add the bill amount if this was a transaction.` };
    }

    // Repeated words (like "hello hello", "haha", etc)
    if (words.length >= 2 && words[0] === words[1]) {
      return { emoji: '🔁', msg: `"${words[0]}" is enough. Now add amount and type.` };
    }

    // Very short input (1-2 chars meaningful)
    if (lower.replace(/\s/g, '').length <= 3) {
      return { emoji: '🤏', msg: `A little more detail helps, like "200 auto paid".` };
    }

    // Very long gibberish
    if (words.length > 6) {
      return { emoji: '📝', msg: `Keep it short, like "500 rent paid".` };
    }

    // Default — use the actual text in the response
    const defaults = [
      { emoji: '🤔', msg: `"${text}" does not look like a transaction yet. Add an amount.` },
      { emoji: '🧐', msg: `"${text}" is missing transaction details. Try: "300 tea paid".` },
      { emoji: '🤷', msg: `I could not read a transaction from "${text}". Try: "brother gave me 500".` },
      { emoji: '😜', msg: `Add an amount and type for "${text}".` },
      { emoji: '🤖', msg: `No financial meaning found for "${text}" yet.` },
      { emoji: '🎭', msg: `Try a shorter transaction phrase, like "2000 shopping spent".` },
    ];
    const seed = text.split('').reduce((acc, c) => acc + c.charCodeAt(0), 0);
    return defaults[seed % defaults.length];
  };

  // Keep malformed-input warnings fully local. User-entered financial text must
  // not leave the device as part of an automatic background enhancement.
  useEffect(() => {
    if (parsed && !parsed.amount && !parsed.type && input.trim().length > 2) {
      setAiWarning(getSmartWarning(input.trim()));
    } else {
      setAiWarning(null);
    }
  }, [parsed, input]);

  useEffect(() => {
    isListeningRef.current = isListening;
  }, [isListening]);

  useEffect(() => {
    if (visible) {
      setInput('');
      setParsed(null);
      setIsListening(false);
      setAiWarning(null);
    } else if (isListeningRef.current) {
      getVoiceModule().stop().catch(() => {});
      setIsListening(false);
    }
  }, [visible]);

  useEffect(() => {
    if (input.trim().length > 2) {
      setParsed(parseNaturalLanguageTxn(input));
    } else {
      setParsed(null);
    }
  }, [input]);

  // Setup Voice listeners
  useEffect(() => {
    if (!visible) return;

    const voice = getVoiceModule();
    voice.onSpeechStart = () => setIsListening(true);
    voice.onSpeechEnd = () => setIsListening(false);
    voice.onSpeechError = (e: SpeechErrorEvent) => {
      setIsListening(false);
      const msg = e.error?.message || '';
      // Ignore common non-critical errors (No speech, Client error, etc.)
      if (!msg.includes('7/') && !msg.includes('5/') && !msg.includes('11/') && !msg.includes('8/')) {
        Toast.show({ type: 'error', text1: 'Voice Error', text2: msg });
      }
    };
    voice.onSpeechResults = (e: SpeechResultsEvent) => {
      const text = e.value?.[0] || '';
      setInput(text);
    };

    return () => {
      voice.destroy().then(voice.removeAllListeners);
    };
  }, [visible]);

  const requestAudioPermission = async () => {
    if (Platform.OS === 'android') {
      const granted = await PermissionsAndroid.request(
        PermissionsAndroid.PERMISSIONS.RECORD_AUDIO,
        {
          title: 'Microphone Permission',
          message: 'SpendSense needs access to your microphone to log transactions by voice.',
          buttonPositive: 'Allow',
          buttonNegative: 'Deny',
        }
      );
      return granted === PermissionsAndroid.RESULTS.GRANTED;
    }
    return true;
  };

  const toggleListening = async () => {
    try {
      if (isListening) {
        await getVoiceModule().stop();
        setIsListening(false);
      } else {
        const hasPermission = await requestAudioPermission();
        if (hasPermission) {
          setInput(''); // clear existing input when starting new voice
          await getVoiceModule().start('en-IN'); // Keep recognition aligned with Indian English input.
        } else {
          Toast.show({ type: 'error', text1: 'Permission Denied', text2: 'Microphone access is required.' });
        }
      }
    } catch {
      // Silently catch start/stop errors to avoid red screen LogBox
      setIsListening(false);
    }
  };

  const handleSave = async () => {
    if (!parsed || !parsed.amount || !parsed.type) return;

    setSaving(true);
    try {
      const newTx: Omit<Transaction, 'id' | 'user_id' | 'created_at'> = {
        amount: parsed.amount,
        type: parsed.type,
        note: parsed.note || parsed.category,
        category: parsed.category,
        sms_source: 'voice',
      };

      const savedTx = await addTransaction(newTx);

      // Update local cache for instant UI feedback
      await updateCache<Transaction[]>(CACHE_KEYS.TRANSACTIONS, current => [
        savedTx,
        ...(current || []).filter(tx => tx.id !== savedTx.id),
      ]);

      Toast.show({
        type: 'success',
        text1: 'Transaction Saved',
        text2: `₹${parsed.amount} added to ${parsed.type}`,
      });

      if (onSuccess) onSuccess();
      onClose();
    } catch (error: any) {
      Toast.show({
        type: 'error',
        text1: 'Failed to save',
        text2: error.message,
      });
    } finally {
      setSaving(false);
    }
  };

  const isReadyToSave = parsed !== null && parsed.amount !== null && parsed.type !== null;

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={onClose}
    >
      <View style={styles.overlay}>
        <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={onClose} />
        
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={[styles.bottomSheet, { backgroundColor: colors.background, borderTopLeftRadius: 24, borderTopRightRadius: 24 }]}
        >
          <View style={styles.header}>
            <Text style={[typography.h2, { color: colors.text }]}>Quick Add ⚡</Text>
            <TouchableOpacity onPress={onClose} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
              <MaterialCommunityIcons name="close-circle" size={24} color={colors.subtext} />
            </TouchableOpacity>
          </View>

          <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 16 }}>
            <TextInput
              style={[
                styles.input,
                { 
                  backgroundColor: colors.card, 
                  color: colors.text, 
                  borderColor: isListening ? '#ef4444' : parsed && isReadyToSave ? '#10b981' : colors.border,
                  borderRadius: borderRadius.md,
                  fontSize: 16,
                  flex: 1,
                  marginRight: 12
                }
              ]}
              placeholder="Type or speak... (e.g. 'Paid 500 for petrol')"
              placeholderTextColor={colors.subtext}
              value={input}
              onChangeText={setInput}
              multiline
              autoFocus={!isListening}
            />
            
            <TouchableOpacity 
              onPress={toggleListening}
              style={[
                styles.micButton, 
                { backgroundColor: isListening ? '#ef4444' + '20' : colors.card, borderColor: isListening ? '#ef4444' : colors.border, borderRadius: borderRadius.md }
              ]}
            >
              <MaterialCommunityIcons 
                name={isListening ? 'microphone-settings' : 'microphone'} 
                size={28} 
                color={isListening ? '#ef4444' : colors.accent} 
              />
              {isListening && <Text style={{ color: '#ef4444', fontSize: 10, marginTop: 4, fontWeight: 'bold' }}>Listening</Text>}
            </TouchableOpacity>
          </View>

          {/* Live Preview Card OR AI Fun Warning */}
          {parsed && !parsed.amount && !parsed.type && aiWarning ? (
            // 🎭 AI-powered Fun Warning
            <View style={[styles.previewCard, { 
              backgroundColor: '#1a1a2e', 
              borderRadius: borderRadius.md, 
              borderColor: '#f59e0b',
              borderWidth: 1.5,
              alignItems: 'center',
              paddingVertical: 20,
            }]}>
              <Text style={{ fontSize: 40, marginBottom: 8 }}>{aiWarning.emoji}</Text>
              <Text style={{ color: '#f59e0b', fontSize: 14, fontWeight: '600', textAlign: 'center', lineHeight: 20, paddingHorizontal: 8 }}>
                {aiWarning.msg}
              </Text>
              <Text style={{ color: colors.subtext, fontSize: 11, marginTop: 10, textAlign: 'center' }}>
                💡 Try: "500 shopping spent" or "brother gave me 2000"
              </Text>
            </View>
          ) : parsed ? (
            <View style={[styles.previewCard, { backgroundColor: colors.card, borderRadius: borderRadius.md, borderColor: colors.border }]}>
              <Text style={{ color: colors.subtext, fontSize: 12, marginBottom: 10, fontWeight: '600' }}>LIVE PREVIEW</Text>
              
              {/* Row 1: Amount & Type */}
              <View style={[styles.previewRow, { marginBottom: 12 }]}>
                <View style={styles.previewItem}>
                  <Text style={{ color: colors.subtext, fontSize: 11 }}>Amount</Text>
                  <Text style={{ color: parsed.amount ? colors.text : '#ef4444', fontSize: 18, fontWeight: 'bold' }}>
                    {parsed.amount ? `₹${parsed.amount.toLocaleString()}` : 'Missing'}
                  </Text>
                </View>
                
                <View style={styles.previewItem}>
                  <Text style={{ color: colors.subtext, fontSize: 11 }}>Type</Text>
                  <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 2 }}>
                    <MaterialCommunityIcons 
                      name={parsed.type === 'income' ? 'arrow-down' : parsed.type === 'expense' ? 'arrow-up' : 'swap-horizontal'} 
                      size={14} 
                      color={parsed.type === 'income' ? '#10b981' : parsed.type === 'expense' ? '#ef4444' : colors.text} 
                      style={{ marginRight: 4 }}
                    />
                    <Text style={{ color: parsed.type ? colors.text : '#ef4444', fontSize: 15, fontWeight: '600', textTransform: 'capitalize' }}>
                      {parsed.type || 'Missing'}
                    </Text>
                  </View>
                </View>
              </View>

              {/* Row 2: Category & Note */}
              <View style={[styles.previewRow]}>
                <View style={{ flex: 1, marginRight: 12 }}>
                  <Text style={{ color: colors.subtext, fontSize: 11 }}>Category</Text>
                  <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 2 }}>
                    <MaterialCommunityIcons name="tag-outline" size={13} color={colors.accent} style={{ marginRight: 4 }} />
                    <Text style={{ color: colors.accent, fontSize: 14, fontWeight: '600' }}>
                      {parsed.category || 'Other'}
                    </Text>
                  </View>
                </View>
                
                <View style={{ flex: 2 }}>
                  <Text style={{ color: colors.subtext, fontSize: 11 }}>Note</Text>
                  <Text style={{ color: colors.text, fontSize: 13, fontWeight: '500', marginTop: 2 }} numberOfLines={2}>
                    {parsed.note || '—'}
                  </Text>
                </View>
              </View>
            </View>
          ) : null}

          <TouchableOpacity
            style={[
              styles.saveButton,
              { 
                backgroundColor: isReadyToSave ? colors.accent : colors.card,
                borderRadius: borderRadius.md,
                opacity: saving ? 0.7 : 1
              }
            ]}
            disabled={!isReadyToSave || saving}
            onPress={handleSave}
          >
            {saving ? (
              <ActivityIndicator color="#fff" size="small" />
            ) : (
              <Text style={[typography.bodyBold, { color: isReadyToSave ? '#fff' : colors.subtext }]}>
                {isReadyToSave ? 'Save Transaction' : 'Type or speak to start...'}
              </Text>
            )}
          </TouchableOpacity>

        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'flex-end',
    // TODO: Replace with useTheme() colors.* token
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
  },
  bottomSheet: {
    padding: 24,
    paddingBottom: Platform.OS === 'ios' ? 40 : 24,
    elevation: 24,
    // TODO: Replace with useTheme() colors.* token
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.25,
    shadowRadius: 10,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
  },
  input: {
    borderWidth: 1.5,
    padding: 16,
    minHeight: 80,
    textAlignVertical: 'top',
  },
  micButton: {
    width: 70,
    height: 80,
    borderWidth: 1.5,
    justifyContent: 'center',
    alignItems: 'center',
  },
  previewCard: {
    padding: 16,
    borderWidth: 1,
    borderStyle: 'dashed',
    marginBottom: 20,
  },
  previewRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  previewItem: {
    flex: 1,
  },
  saveButton: {
    paddingVertical: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
