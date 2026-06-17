/**
 * SMS Parser Testing Screen
 * 
 * Test the intelligent SMS parser with:
 * - Real SMS examples
 * - Custom SMS input
 * - Parsing statistics
 * - Failed SMS debugging
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Alert,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';
import { useTheme } from '../../context/ThemeContext';
import { ScreenWrapper, AppHeader, Card } from '../../components';
import { getSMSParsingStats } from '../../lib/services/notifications';
import { dryRunParseTransaction, ParsedTransaction } from '../../lib/processors/TransactionProcessors';
import { enqueueSms } from '../../lib/processors/TransactionQueue';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { sanitizeDebugBugReportsForPrivacy } from '../../lib/privacy/rawText';

const MAX_BUG_REPORTS = 10;
const MAX_SMS_LENGTH = 1000;
const STATS_REFRESH_DELAY_MS = 6000;
const SENDER_PATTERN = /^[A-Za-z0-9._-]{2,64}$/;

interface SampleSms {
  sender: string;
  text: string;
  description: string;
}

interface PendingSms {
  body: string;
  sender: string;
}

function formatSampleDate(): string {
  const now = new Date();
  const day = String(now.getDate()).padStart(2, '0');
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const year = String(now.getFullYear()).slice(-2);
  return `${day}-${month}-${year}`;
}

function buildSampleSms(sampleDate: string): SampleSms[] {
  return [
    {
      sender: 'JX-UTKSPR-S',
      text: `We have received payment of INR 4,925.68 for your SuperCard ending 0000 on ${sampleDate}. Available limit updated. -Utkarsh SFBL`,
      description: 'Credit Card Payment (Utkarsh SFBL)',
    },
    {
      sender: 'HDFCBK',
      text: `Rs.1,250.00 debited from A/c XX0000 on ${sampleDate} at PLACEHOLDER_MERCHANT. Avl Bal: Rs.45,678.90.`,
      description: 'Debit Card Purchase (HDFC)',
    },
    {
      sender: 'SBIINB',
      text: `Dear Customer, Rs.5000.00 credited to A/c XX0000 on ${sampleDate}. Info: PLACEHOLDER_SALARY. Avl Bal: Rs.67,890.50`,
      description: 'Salary Credit (SBI)',
    },
    {
      sender: 'ICICIB',
      text: `Rs 2,345.67 spent on ICICI Bank Credit Card XX0000 at PLACEHOLDER_FOOD_APP on ${sampleDate}. Avl limit: Rs 1,23,456.78.`,
      description: 'Credit Card Spend (ICICI)',
    },
    {
      sender: 'AXISBK',
      text: `INR 850.00 debited from your Account XXXXXX0000 on ${sampleDate} for UPI/P2P/placeholder@bank.`,
      description: 'UPI Payment (Axis)',
    },
    {
      sender: 'AD-INDDEM-S',
      text: 'Hi Investor, Refund from PLACEHOLDER Wallet Balance to your registered bank account. Amount: Rs.42.14',
      description: 'Investment payout placeholder',
    },
    {
      sender: 'VK-KOTAKB-S',
      text: `Rs: 38.55 has been transferred to your account XXXXXX0000 on ${sampleDate}. From Kotak Bank`,
      description: 'Kotak Rs: format credit',
    },
  ];
}

function parseBugReports(value: string | null): any[] {
  if (!value) return [];
  try {
    const reports = JSON.parse(value);
    return Array.isArray(reports) ? reports : [];
  } catch (error) {
    if (__DEV__) console.warn('[SMSTestScreen] Ignoring corrupt bug report cache', {
      errorCode: error instanceof Error ? error.name : 'unknown_error',
    });
    return [];
  }
}

function formatCurrencyValue(value: number | null | undefined): string {
  return typeof value === 'number' && Number.isFinite(value)
    ? `₹${value}`
    : 'Not detected';
}

export default function SMSTestScreen() {
  const { colors, typography, spacing } = useTheme();
  const sampleSms = useMemo(() => buildSampleSms(formatSampleDate()), []);
  const [customSMS, setCustomSMS] = useState('');
  const [customSender, setCustomSender] = useState('');
  const [parseResult, setParseResult] = useState<ParsedTransaction | null>(null);
  const [parseSource, setParseSource] = useState<'bank' | 'upi' | 'unknown'>('unknown');
  const [wouldAttemptParse, setWouldAttemptParse] = useState(false);
  const [stats, setStats] = useState({ total: 0, successful: 0, failed: 0, successRate: 0 });
  const [bugReports, setBugReports] = useState<any[]>([]);
  const [pendingSms, setPendingSms] = useState<PendingSms | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);

  const loadStats = useCallback(async () => {
    try {
      const data = await getSMSParsingStats();
      setStats(data);
    } catch (error) {
      if (__DEV__) console.error('[SMSTestScreen] Error loading stats:', {
        errorCode: error instanceof Error ? error.name : 'unknown_error',
      });
    }
  }, []);

  const loadBugReports = useCallback(async () => {
    try {
      const reportsStr = await AsyncStorage.getItem('debug_bug_reports');
      const reports = parseBugReports(reportsStr);
      const safeReports = sanitizeDebugBugReportsForPrivacy(reports);
      setBugReports(safeReports.slice(0, MAX_BUG_REPORTS));
    } catch (error) {
      if (__DEV__) console.error('[SMSTestScreen] Error loading bug reports:', {
        errorCode: error instanceof Error ? error.name : 'unknown_error',
      });
    }
  }, []);

  const refreshDiagnostics = useCallback(async () => {
    setIsLoading(true);
    try {
      await Promise.all([loadStats(), loadBugReports()]);
    } finally {
      setIsLoading(false);
    }
  }, [loadBugReports, loadStats]);

  useEffect(() => {
    refreshDiagnostics();
  }, [refreshDiagnostics]);

  const validateInput = useCallback((smsText: string, senderId: string): boolean => {
    const trimmedSms = smsText.trim();
    const trimmedSender = senderId.trim();
    if (!trimmedSms || !trimmedSender) {
      Alert.alert('Error', 'Please enter both sender ID and SMS text');
      return false;
    }
    if (!SENDER_PATTERN.test(trimmedSender)) {
      Alert.alert('Invalid Sender', 'Use 2-64 letters, numbers, dots, underscores, or hyphens.');
      return false;
    }
    if (trimmedSms.length > MAX_SMS_LENGTH) {
      Alert.alert('SMS Too Long', `Please keep test text under ${MAX_SMS_LENGTH} characters.`);
      return false;
    }
    return true;
  }, []);

  const testSMS = useCallback((smsText: string, senderId: string) => {
    const trimmedSms = smsText.trim();
    const trimmedSender = senderId.trim();
    if (!validateInput(trimmedSms, trimmedSender)) return;

    try {
      const dryRun = dryRunParseTransaction(trimmedSms, trimmedSender);
      const parsed = dryRun.parsed;
      setParseResult(parsed);
      setParseSource(dryRun.source);
      setWouldAttemptParse(dryRun.wouldAttemptParse);
      setPendingSms({ body: trimmedSms, sender: trimmedSender });

      if (!parsed) {
        Alert.alert('No Parse Result', 'Parser did not produce a transaction from this SMS.');
      }
    } catch (error) {
      setParseResult(null);
      setParseSource('unknown');
      setWouldAttemptParse(false);
      setPendingSms(null);
      if (__DEV__) console.error('[SMSTestScreen] Dry run failed:', {
        errorCode: error instanceof Error ? error.name : 'unknown_error',
      });
      Alert.alert('Parse Failed', 'The parser could not safely process this test input.');
    }
  }, [validateInput]);

  const processPendingSms = useCallback(async () => {
    if (!__DEV__) {
      Alert.alert('Blocked', 'Real transaction processing is disabled outside development.');
      return;
    }
    if (!pendingSms) {
      Alert.alert('Nothing to Process', 'Run a parser test first.');
      return;
    }

    Alert.alert(
      'Create Real Transaction Data?',
      'This queues the test SMS through the real processor and may create financial records. Continue only with placeholder/test data.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Queue Test SMS',
          style: 'destructive',
          onPress: async () => {
            setIsProcessing(true);
            try {
              await enqueueSms({
                body: pendingSms.body,
                sender: pendingSms.sender,
                timestamp: Date.now(),
              });
              Alert.alert(
                'Queued',
                'SMS added to processing queue. Transaction will appear shortly if valid.'
              );
              setTimeout(() => {
                refreshDiagnostics();
              }, STATS_REFRESH_DELAY_MS);
            } catch (error) {
              if (__DEV__) console.error('[SMSTestScreen] Queue failed:', {
                errorCode: error instanceof Error ? error.name : 'unknown_error',
              });
              Alert.alert('Queue Failed', 'Could not queue this SMS for processing.');
            } finally {
              setIsProcessing(false);
            }
          },
        },
      ]
    );
  }, [pendingSms, refreshDiagnostics]);

  const clearBugReports = useCallback(async () => {
    try {
      await AsyncStorage.setItem('debug_bug_reports', JSON.stringify([]));
      await refreshDiagnostics();
      Alert.alert('Success', 'Bug reports cleared');
    } catch (error) {
      if (__DEV__) console.error('[SMSTestScreen] Clear bug reports failed:', {
        errorCode: error instanceof Error ? error.name : 'unknown_error',
      });
      Alert.alert('Error', 'Could not clear bug reports.');
    }
  }, [refreshDiagnostics]);

  return (
    <ScreenWrapper>
      <AppHeader title="SMS Parser Test" showBack={true} />
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ paddingHorizontal: spacing.lg, paddingTop: spacing.lg }}>
        {/* Statistics Card */}
        <Card style={{ marginBottom: spacing.lg }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.sm }}>
            <Text style={[typography.bodyBold, { color: colors.text }]}>
              Parsing Statistics
            </Text>
            <TouchableOpacity
              accessible
              accessibilityRole="button"
              accessibilityLabel="Refresh SMS parser diagnostics"
              onPress={refreshDiagnostics}
              disabled={isLoading}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 6,
                opacity: isLoading ? 0.6 : 1,
              }}>
              {isLoading ? (
                <ActivityIndicator size="small" color={colors.accent} />
              ) : (
                <MaterialCommunityIcons name="refresh" size={18} color={colors.accent} />
              )}
              <Text style={[typography.caption, { color: colors.accent, fontWeight: 'bold' }]}>
                REFRESH
              </Text>
            </TouchableOpacity>
          </View>
          <View style={{ flexDirection: 'row', justifyContent: 'space-around', marginTop: spacing.sm }}>
            <View style={{ alignItems: 'center' }}>
              <Text style={[typography.h2, { color: colors.accent }]}>{stats.total}</Text>
              <Text style={[typography.caption, { color: colors.subtext }]}>Total</Text>
            </View>
            <View style={{ alignItems: 'center' }}>
              <Text style={[typography.h2, { color: '#10b981' }]}>{stats.successful}</Text>
              <Text style={[typography.caption, { color: colors.subtext }]}>Success</Text>
            </View>
            <View style={{ alignItems: 'center' }}>
              <Text style={[typography.h2, { color: '#ef4444' }]}>{stats.failed}</Text>
              <Text style={[typography.caption, { color: colors.subtext }]}>Failed</Text>
            </View>
            <View style={{ alignItems: 'center' }}>
              <Text style={[typography.h2, { color: colors.accent }]}>{stats.successRate.toFixed(0)}%</Text>
              <Text style={[typography.caption, { color: colors.subtext }]}>Rate</Text>
            </View>
          </View>
        </Card>

        {/* Custom SMS Test */}
        <Text style={[typography.bodyBold, { color: colors.text, marginBottom: spacing.sm }]}>
          Test Custom SMS
        </Text>
        <Card style={{ marginBottom: spacing.lg }}>
          <Text style={[typography.caption, { color: colors.subtext, marginBottom: 4 }]}>
            Sender ID
          </Text>
          <TextInput
            value={customSender}
            onChangeText={setCustomSender}
            placeholder="e.g., HDFCBK, SBIINB"
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

          <Text style={[typography.caption, { color: colors.subtext, marginBottom: 4 }]}>
            SMS Text
          </Text>
          <TextInput
            value={customSMS}
            onChangeText={setCustomSMS}
            placeholder="Paste SMS text here..."
            placeholderTextColor={colors.subtext}
            multiline
            numberOfLines={4}
            style={[
              typography.body,
              {
                backgroundColor: colors.background,
                borderRadius: 8,
                padding: spacing.md,
                color: colors.text,
                marginBottom: spacing.md,
                textAlignVertical: 'top',
              },
            ]}
          />

          <TouchableOpacity
            onPress={() => {
              testSMS(customSMS, customSender);
            }}
            accessible
            accessibilityRole="button"
            accessibilityLabel="Test custom SMS parser input"
            style={{
              backgroundColor: colors.accent,
              borderRadius: 12,
              padding: spacing.md,
              alignItems: 'center',
            }}>
            <Text style={[typography.bodyBold, { color: '#fff' }]}>Test SMS</Text>
          </TouchableOpacity>
        </Card>

        {/* Sample SMS */}
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.sm }}>
          <Text style={[typography.bodyBold, { color: colors.text }]}>
            Sample SMS
          </Text>
          <Text style={[typography.caption, { color: colors.subtext }]}>
            Tap to test
          </Text>
        </View>
        {sampleSms.map((sample, index) => (
          <TouchableOpacity
            key={index}
            onPress={() => testSMS(sample.text, sample.sender)}
            accessible
            accessibilityRole="button"
            accessibilityLabel={`Test sample SMS: ${sample.description}`}
            style={{
              backgroundColor: colors.card,
              borderRadius: 12,
              padding: spacing.md,
              marginBottom: spacing.sm,
              borderWidth: 1,
              borderColor: colors.border,
            }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
              <Text style={[typography.caption, { color: colors.accent, fontWeight: 'bold' }]}>
                {sample.sender}
              </Text>
              <MaterialCommunityIcons name="chevron-right" size={20} color={colors.subtext} />
            </View>
            <Text style={[typography.caption, { color: colors.subtext, marginBottom: 4 }]}>
              {sample.description}
            </Text>
            <Text style={[typography.caption, { color: colors.text }]} numberOfLines={2}>
              {sample.text}
            </Text>
          </TouchableOpacity>
        ))}

        {/* Bug Reports */}
        {bugReports.length > 0 && (
          <View style={{ marginTop: spacing.lg }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.sm }}>
              <Text style={[typography.bodyBold, { color: colors.text }]}>
                Recent Bug Reports
              </Text>
              <TouchableOpacity onPress={clearBugReports}>
                <Text style={[typography.caption, { color: '#ef4444', fontWeight: 'bold' }]}>
                  CLEAR
                </Text>
              </TouchableOpacity>
            </View>
            {bugReports.map((report) => (
              <Card key={report.id} style={{ marginBottom: spacing.sm }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 }}>
                  <Text style={[typography.caption, { 
                    color: report.type === 'sms_failed' ? '#ef4444' : '#10b981',
                    fontWeight: 'bold',
                  }]}>
                    {report.type === 'sms_failed' ? 'Failed Parse' : 'Success'}
                  </Text>
                  <Text style={[typography.caption, { color: colors.subtext, fontSize: 10 }]}>
                    {report.timestamp ? new Date(report.timestamp).toLocaleString() : 'Unknown time'}
                  </Text>
                </View>
                <Text style={[typography.caption, { color: colors.subtext, marginBottom: 4 }]}>
                  From: {report.sender}
                </Text>
                <Text style={[typography.caption, { color: colors.text }]} numberOfLines={3}>
                  {report.rawSms}
                </Text>
                {report.logicLog && (
                  <Text style={[typography.caption, { color: colors.accent, marginTop: 4, fontSize: 10 }]}>
                    {report.logicLog}
                  </Text>
                )}
              </Card>
            ))}
          </View>
        )}

        {/* Parse Result Display */}
        {parseResult && (
          <View style={{ marginTop: spacing.lg }}>
            <Text style={[typography.bodyBold, { color: colors.text, marginBottom: spacing.sm }]}>
              Last Parse Result
            </Text>
            <Card>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: spacing.sm }}>
                <Text style={[typography.caption, { color: colors.subtext }]}>Source</Text>
                <Text style={[typography.bodyBold, { color: colors.text }]}>
                  {parseSource}
                </Text>
              </View>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: spacing.sm }}>
                <Text style={[typography.caption, { color: colors.subtext }]}>Would Parse</Text>
                <Text style={[typography.body, { color: colors.text }]}>
                  {wouldAttemptParse ? 'Yes' : 'No'}
                </Text>
              </View>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: spacing.sm }}>
                <Text style={[typography.caption, { color: colors.subtext }]}>Amount</Text>
                <Text style={[typography.body, { color: colors.text }]}>
                  {formatCurrencyValue(parseResult.amount)}
                </Text>
              </View>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: spacing.sm }}>
                <Text style={[typography.caption, { color: colors.subtext }]}>Balance</Text>
                <Text style={[typography.body, { color: colors.text }]}>
                  {formatCurrencyValue(parseResult.balance)}
                </Text>
              </View>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: spacing.sm }}>
                <Text style={[typography.caption, { color: colors.subtext }]}>Account Last 4</Text>
                <Text style={[typography.body, { color: colors.text }]}>
                  {parseResult.accountLast4 || 'Not detected'}
                </Text>
              </View>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: spacing.sm }}>
                <Text style={[typography.caption, { color: colors.subtext }]}>Type</Text>
                <Text style={[typography.body, { color: colors.text }]}>
                  {parseResult.type}
                </Text>
              </View>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: spacing.sm }}>
                <Text style={[typography.caption, { color: colors.subtext }]}>Reference</Text>
                <Text style={[typography.body, { color: colors.text }]}>
                  {parseResult.reference || 'Not detected'}
            </Text>
          </View>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <Text style={[typography.caption, { color: colors.subtext }]}>Merchant</Text>
                <Text style={[typography.body, { color: colors.text }]}>
                  {parseResult.merchant || 'Not detected'}
                </Text>
              </View>
              {pendingSms && (
                <TouchableOpacity
                  onPress={processPendingSms}
                  disabled={isProcessing}
                  accessible
                  accessibilityRole="button"
                  accessibilityLabel={__DEV__
                    ? 'Queue parsed SMS through real transaction processor'
                    : 'Real transaction processing disabled outside development'}
                  style={{
                    backgroundColor: __DEV__ ? '#ef4444' : colors.border,
                    borderRadius: 12,
                    padding: spacing.md,
                    alignItems: 'center',
                    marginTop: spacing.md,
                    opacity: isProcessing ? 0.7 : 1,
                  }}>
                  <Text style={[typography.bodyBold, { color: __DEV__ ? '#fff' : colors.subtext }]}>
                    {isProcessing
                      ? 'Queueing...'
                      : __DEV__
                        ? 'Queue Real Processor Test'
                        : 'Processing Disabled Outside Dev'}
                  </Text>
                </TouchableOpacity>
              )}
            </Card>
          </View>
        )}
      </ScrollView>
      </KeyboardAvoidingView>
    </ScreenWrapper>
  );
}
