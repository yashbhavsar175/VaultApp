/**
 * SMS Parser Testing Screen
 * 
 * Test the intelligent SMS parser with:
 * - Real SMS examples
 * - Custom SMS input
 * - Parsing statistics
 * - Failed SMS debugging
 */

import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Alert,
} from 'react-native';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';
import { useTheme } from '../../context/ThemeContext';
import { ScreenWrapper, AppHeader, Card } from '../../components';
import { parseSMS, isTransactionSMS, ParsedTransaction } from '../../lib/services/smsParser';
import { processTransactionSMS, getSMSParsingStats } from '../../lib/services/notifications';
import AsyncStorage from '@react-native-async-storage/async-storage';

// Sample SMS for testing
const SAMPLE_SMS = [
  {
    sender: 'JX-UTKSPR-S',
    text: 'We have received payment of INR 4,925.68 for your SuperCard ending 6055. Your available limit is now INR 7,650.95 -Utkarsh SFBL',
    description: 'Credit Card Payment (Utkarsh SFBL)',
  },
  {
    sender: 'HDFCBK',
    text: 'Rs.1,250.00 debited from A/c XX1234 on 13-05-26 at Amazon.in. Avl Bal: Rs.45,678.90. Not you? Call 18002586161',
    description: 'Debit Card Purchase (HDFC)',
  },
  {
    sender: 'SBIINB',
    text: 'Dear Customer, Rs.5000.00 credited to A/c XX9876 on 13-05-26. Info: NEFT-SALARY-MAY26. Avl Bal: Rs.67,890.50',
    description: 'Salary Credit (SBI)',
  },
  {
    sender: 'ICICIB',
    text: 'Rs 2,345.67 spent on ICICI Bank Credit Card XX4567 at SWIGGY on 13-MAY-26. Avl limit: Rs 1,23,456.78. Call 18002662',
    description: 'Credit Card Spend (ICICI)',
  },
  {
    sender: 'AXISBK',
    text: 'INR 850.00 debited from your Account XXXXXX3210 on 13-May-26 for UPI/P2P/yourname@paytm/9876543210. If not done by you, call 18604195555',
    description: 'UPI Payment (Axis)',
  },
];

export default function SMSTestScreen() {
  const { colors, typography, spacing } = useTheme();
  const [customSMS, setCustomSMS] = useState('');
  const [customSender, setCustomSender] = useState('');
  const [parseResult, setParseResult] = useState<ParsedTransaction | null>(null);
  const [stats, setStats] = useState({ total: 0, successful: 0, failed: 0, successRate: 0 });
  const [bugReports, setBugReports] = useState<any[]>([]);

  useEffect(() => {
    loadStats();
    loadBugReports();
  }, []);

  const loadStats = async () => {
    const data = await getSMSParsingStats();
    setStats(data);
  };

  const loadBugReports = async () => {
    try {
      const reportsStr = await AsyncStorage.getItem('debug_bug_reports');
      const reports = reportsStr ? JSON.parse(reportsStr) : [];
      setBugReports(reports.slice(0, 10)); // Last 10
    } catch (error) {
      console.error('Error loading bug reports:', error);
    }
  };

  const testSMS = async (smsText: string, senderId: string) => {
    // Parse SMS
    const parsed = parseSMS(smsText, senderId);
    setParseResult(parsed);

    // Check if it's a transaction SMS
    const isTxn = isTransactionSMS(smsText);
    
    Alert.alert(
      'Parse Result',
      `Is Transaction: ${isTxn ? 'Yes' : 'No'}\n` +
      `Confidence: ${parsed.confidence}%\n\n` +
      `Bank: ${parsed.bankName || 'Not detected'}\n` +
      `Amount: ${parsed.amount ? `₹${parsed.amount}` : 'Not detected'}\n` +
      `Last 4: ${parsed.last4Digits || 'Not detected'}\n` +
      `Type: ${parsed.transactionType}\n` +
      `Merchant: ${parsed.merchant || 'Not detected'}`,
      [
        { text: 'OK' },
        {
          text: 'Process Transaction',
          onPress: async () => {
            const result = await processTransactionSMS(smsText, senderId);
            if (result.success) {
              Alert.alert('Success', `Transaction created: ${result.transactionId}`);
            } else {
              Alert.alert('Failed', 'Could not create transaction. Check notifications for details.');
            }
            loadStats();
            loadBugReports();
          },
        },
      ]
    );
  };

  const clearBugReports = async () => {
    await AsyncStorage.setItem('debug_bug_reports', JSON.stringify([]));
    loadBugReports();
    loadStats();
    Alert.alert('Success', 'Bug reports cleared');
  };

  return (
    <ScreenWrapper>
      <AppHeader title="SMS Parser Test" showBack={true} />
      
      <ScrollView contentContainerStyle={{ padding: spacing.lg }}>
        {/* Statistics Card */}
        <Card style={{ marginBottom: spacing.lg }}>
          <Text style={[typography.bodyBold, { color: colors.text, marginBottom: spacing.sm }]}>
            Parsing Statistics
          </Text>
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
              if (!customSMS.trim() || !customSender.trim()) {
                Alert.alert('Error', 'Please enter both sender ID and SMS text');
                return;
              }
              testSMS(customSMS, customSender);
            }}
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
        {SAMPLE_SMS.map((sample, index) => (
          <TouchableOpacity
            key={index}
            onPress={() => testSMS(sample.text, sample.sender)}
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
            {bugReports.map((report, index) => (
              <Card key={report.id} style={{ marginBottom: spacing.sm }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 }}>
                  <Text style={[typography.caption, { 
                    color: report.type === 'sms_failed' ? '#ef4444' : '#10b981',
                    fontWeight: 'bold',
                  }]}>
                    {report.type === 'sms_failed' ? 'Failed Parse' : 'Success'}
                  </Text>
                  <Text style={[typography.caption, { color: colors.subtext, fontSize: 10 }]}>
                    {new Date(report.timestamp).toLocaleString()}
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
                <Text style={[typography.caption, { color: colors.subtext }]}>Confidence</Text>
                <Text style={[typography.bodyBold, { 
                  color: parseResult.confidence >= 70 ? '#10b981' : 
                         parseResult.confidence >= 50 ? '#f59e0b' : '#ef4444',
                }]}>
                  {parseResult.confidence}%
                </Text>
              </View>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: spacing.sm }}>
                <Text style={[typography.caption, { color: colors.subtext }]}>Bank</Text>
                <Text style={[typography.body, { color: colors.text }]}>
                  {parseResult.bankName || 'Not detected'}
                </Text>
              </View>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: spacing.sm }}>
                <Text style={[typography.caption, { color: colors.subtext }]}>Amount</Text>
                <Text style={[typography.body, { color: colors.text }]}>
                  {parseResult.amount ? `₹${parseResult.amount}` : 'Not detected'}
                </Text>
              </View>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: spacing.sm }}>
                <Text style={[typography.caption, { color: colors.subtext }]}>Last 4 Digits</Text>
                <Text style={[typography.body, { color: colors.text }]}>
                  {parseResult.last4Digits || 'Not detected'}
                </Text>
              </View>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: spacing.sm }}>
                <Text style={[typography.caption, { color: colors.subtext }]}>Type</Text>
                <Text style={[typography.body, { color: colors.text }]}>
                  {parseResult.transactionType}
                </Text>
              </View>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <Text style={[typography.caption, { color: colors.subtext }]}>Merchant</Text>
                <Text style={[typography.body, { color: colors.text }]}>
                  {parseResult.merchant || 'Not detected'}
                </Text>
              </View>
            </Card>
          </View>
        )}
      </ScrollView>
    </ScreenWrapper>
  );
}

const styles = StyleSheet.create({});
