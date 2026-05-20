/**
 * Bank Auto-Detection Screen
 * 
 * Automatically scans SMS history to detect user's banks
 * Shows suggestions and allows one-click addition
 */

import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
} from 'react-native';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';
import { useTheme } from '../../context/ThemeContext';
import { ScreenWrapper, AppHeader, Card } from '../../components';
import {
  scanSMSHistory,
  getCachedDetectionResult,
  getUnaddedBanks,
  autoAddBank,
  getDetectionStats,
  DetectedBank,
  AutoDetectionResult,
} from '../../lib/services/bankAutoDetection';
import { useNavigation } from '@react-navigation/native';
import { formatCurrency } from '../../utils/format';

export default function BankAutoDetectScreen() {
  const { colors, typography, spacing } = useTheme();
  const navigation = useNavigation();
  const [scanning, setScanning] = useState(false);
  const [result, setResult] = useState<AutoDetectionResult | null>(null);
  const [unaddedBanks, setUnaddedBanks] = useState<DetectedBank[]>([]);
  const [stats, setStats] = useState({ totalDetected: 0, totalAdded: 0, pendingSuggestions: 0, lastScanDate: null as string | null });
  const [addingBank, setAddingBank] = useState<string | null>(null);

  useEffect(() => {
    loadCachedData();
  }, []);

  const loadCachedData = async () => {
    try {
      const cached = await getCachedDetectionResult();
      if (cached) {
        setResult(cached);
      }
      
      const unadded = await getUnaddedBanks();
      setUnaddedBanks(unadded);
      
      const detectionStats = await getDetectionStats();
      setStats(detectionStats);
    } catch (error) {
      console.error('Error loading cached data:', error);
    }
  };

  const handleScan = async () => {
    try {
      setScanning(true);
      const scanResult = await scanSMSHistory();
      setResult(scanResult);
      
      const unadded = await getUnaddedBanks();
      setUnaddedBanks(unadded);
      
      const detectionStats = await getDetectionStats();
      setStats(detectionStats);
      
      Alert.alert(
        'Scan Complete',
        `Found ${scanResult.detectedBanks.length} banks from ${scanResult.totalSMSScanned} SMS messages.\n\n${unadded.length} banks are not added yet.`,
        [{ text: 'OK' }]
      );
    } catch (error: any) {
      console.error('Error scanning SMS:', error);
      Alert.alert(
        'Scan Failed',
        error.message === 'SMS permission denied' 
          ? 'Please grant SMS permission to scan your messages.'
          : 'Failed to scan SMS history. Please try again.',
        [{ text: 'OK' }]
      );
    } finally {
      setScanning(false);
    }
  };

  const handleAddBank = async (bank: DetectedBank) => {
    try {
      setAddingBank(bank.bankName);
      
      const success = await autoAddBank(bank);
      
      if (success) {
        Alert.alert('Success', `${bank.bankName} added successfully!`, [
          {
            text: 'OK',
            onPress: () => {
              loadCachedData();
            },
          },
        ]);
      } else {
        Alert.alert('Error', 'Failed to add bank. Please try manually.');
      }
    } catch (error) {
      console.error('Error adding bank:', error);
      Alert.alert('Error', 'Failed to add bank. Please try manually.');
    } finally {
      setAddingBank(null);
    }
  };

  const handleAddManually = (bank: DetectedBank) => {
    Alert.alert(
      'Add Manually',
      `Would you like to add ${bank.bankName} with custom details?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Yes',
          onPress: () => {
            // Navigate to BankConfigScreen with pre-filled data
            (navigation as any).navigate('BankConfigScreen', {
              prefillBank: bank.bankName,
              prefillLast4: bank.last4Digits[0],
            });
          },
        },
      ]
    );
  };

  const formatDetectedBalances = (bank: DetectedBank): string | null => {
    if (!bank.accountBalances || bank.accountBalances.length === 0) return null;

    return bank.accountBalances
      .map(item => {
        const account = item.last4Digits ? `••${item.last4Digits}` : 'Account';
        return `${account}: ${formatCurrency(item.balance)}`;
      })
      .join(' • ');
  };

  return (
    <ScreenWrapper>
      <AppHeader title="Auto-Detect Banks" showBack={true} />
      
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
          <MaterialCommunityIcons name="information-outline" size={18} color="#06b6d4" />
          <Text style={[typography.caption, { color: '#06b6d4', flex: 1, marginLeft: spacing.sm, lineHeight: 18 }]}>
            Scan your SMS history to automatically detect banks. We'll analyze transaction messages from the last 30 days.
          </Text>
        </View>

        {/* Statistics Card */}
        {stats.lastScanDate && (
          <Card style={{ marginBottom: spacing.lg }}>
            <Text style={[typography.bodyBold, { color: colors.text, marginBottom: spacing.sm }]}>
              Detection Statistics
            </Text>
            <View style={{ flexDirection: 'row', justifyContent: 'space-around', marginTop: spacing.sm }}>
              <View style={{ alignItems: 'center' }}>
                <Text style={[typography.h2, { color: colors.accent }]}>{stats.totalDetected}</Text>
                <Text style={[typography.caption, { color: colors.subtext, fontSize: 10 }]}>Detected</Text>
              </View>
              <View style={{ alignItems: 'center' }}>
                <Text style={[typography.h2, { color: '#10b981' }]}>{stats.totalAdded}</Text>
                <Text style={[typography.caption, { color: colors.subtext, fontSize: 10 }]}>Added</Text>
              </View>
              <View style={{ alignItems: 'center' }}>
                <Text style={[typography.h2, { color: '#f59e0b' }]}>{stats.pendingSuggestions}</Text>
                <Text style={[typography.caption, { color: colors.subtext, fontSize: 10 }]}>Pending</Text>
              </View>
            </View>
            <Text style={[typography.caption, { color: colors.subtext, marginTop: spacing.sm, textAlign: 'center' }]}>
              Last scan: {new Date(stats.lastScanDate).toLocaleString()}
            </Text>
          </Card>
        )}

        {/* Scan Button */}
        <TouchableOpacity
          onPress={handleScan}
          disabled={scanning}
          style={{
            backgroundColor: colors.accent,
            borderRadius: 12,
            padding: spacing.md,
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'center',
            marginBottom: spacing.lg,
            opacity: scanning ? 0.6 : 1,
          }}>
          {scanning ? (
            <>
              <ActivityIndicator size="small" color="#fff" style={{ marginRight: 8 }} />
              <Text style={[typography.bodyBold, { color: '#fff' }]}>
                Scanning SMS...
              </Text>
            </>
          ) : (
            <>
              <MaterialCommunityIcons name="radar" size={24} color="#fff" />
              <Text style={[typography.bodyBold, { color: '#fff', marginLeft: spacing.sm }]}>
                {result ? 'Scan Again' : 'Start Scan'}
              </Text>
            </>
          )}
        </TouchableOpacity>

        {/* Unadded Banks */}
        {unaddedBanks.length > 0 && (
          <View>
            <Text style={[typography.bodyBold, { color: colors.text, marginBottom: spacing.sm }]}>
              Suggested Banks ({unaddedBanks.length})
            </Text>
            <Text style={[typography.caption, { color: colors.subtext, marginBottom: spacing.md }]}>
              These banks were detected but not added yet. Tap to add.
            </Text>
            
            {unaddedBanks.map((bank, index) => (
              <Card key={index} style={{ marginBottom: spacing.md }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <View style={{ flex: 1 }}>
                    <Text style={[typography.bodyBold, { color: colors.text }]}>
                      {bank.bankName}
                    </Text>
                    <Text style={[typography.caption, { color: colors.subtext, marginTop: 4 }]}>
                      {bank.transactionCount} transaction{bank.transactionCount > 1 ? 's' : ''} found
                    </Text>
                    {bank.last4Digits.length > 0 && (
                      <Text style={[typography.caption, { color: colors.subtext, marginTop: 2 }]}>
                        Accounts: {bank.last4Digits.map(d => `••${d}`).join(', ')}
                      </Text>
                    )}
                    {formatDetectedBalances(bank) && (
                      <Text style={[typography.caption, { color: '#10b981', marginTop: 2, fontWeight: '600' }]}>
                        Last known balance: {formatDetectedBalances(bank)}
                      </Text>
                    )}
                    <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 4 }}>
                      <View style={{
                        width: bank.confidence,
                        height: 4,
                        backgroundColor: bank.confidence >= 70 ? '#10b981' : bank.confidence >= 50 ? '#f59e0b' : '#ef4444',
                        borderRadius: 2,
                        marginRight: 8,
                      }} />
                      <Text style={[typography.caption, { color: colors.subtext, fontSize: 10 }]}>
                        {bank.confidence.toFixed(0)}% confidence
                      </Text>
                    </View>
                  </View>
                  
                  <View style={{ flexDirection: 'row', gap: 8 }}>
                    <TouchableOpacity
                      onPress={() => handleAddBank(bank)}
                      disabled={addingBank === bank.bankName}
                      style={{
                        backgroundColor: colors.accent + '20',
                        borderColor: colors.accent,
                        borderWidth: 1,
                        borderRadius: 8,
                        padding: 8,
                        minWidth: 80,
                        alignItems: 'center',
                      }}>
                      {addingBank === bank.bankName ? (
                        <ActivityIndicator size="small" color={colors.accent} />
                      ) : (
                        <Text style={[typography.caption, { color: colors.accent, fontWeight: 'bold' }]}>
                          Quick Add
                        </Text>
                      )}
                    </TouchableOpacity>
                    
                    <TouchableOpacity
                      onPress={() => handleAddManually(bank)}
                      style={{
                        backgroundColor: colors.card,
                        borderColor: colors.border,
                        borderWidth: 1,
                        borderRadius: 8,
                        padding: 8,
                      }}>
                      <MaterialCommunityIcons name="pencil" size={18} color={colors.text} />
                    </TouchableOpacity>
                  </View>
                </View>
              </Card>
            ))}
          </View>
        )}

        {/* All Detected Banks */}
        {result && result.detectedBanks.length > 0 && (
          <View style={{ marginTop: spacing.lg }}>
            <Text style={[typography.bodyBold, { color: colors.text, marginBottom: spacing.sm }]}>
              All Detected Banks ({result.detectedBanks.length})
            </Text>
            <Text style={[typography.caption, { color: colors.subtext, marginBottom: spacing.md }]}>
              Complete list of banks found in your SMS history.
            </Text>
            
            {result.detectedBanks.map((bank, index) => (
              <Card key={index} style={{ marginBottom: spacing.sm }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                  <View style={{ flex: 1 }}>
                    <Text style={[typography.body, { color: colors.text, fontWeight: '600' }]}>
                      {bank.bankName}
                    </Text>
                    <Text style={[typography.caption, { color: colors.subtext, fontSize: 11 }]}>
                      {bank.transactionCount} SMS • {bank.last4Digits.length} account{bank.last4Digits.length > 1 ? 's' : ''}
                    </Text>
                    {formatDetectedBalances(bank) && (
                      <Text style={[typography.caption, { color: '#10b981', fontSize: 11, marginTop: 2 }]} numberOfLines={1}>
                        Balance: {formatDetectedBalances(bank)}
                      </Text>
                    )}
                  </View>
                  <View style={{
                    backgroundColor: bank.confidence >= 70 ? '#10b98120' : bank.confidence >= 50 ? '#f59e0b20' : '#ef444420',
                    borderRadius: 8,
                    paddingHorizontal: 8,
                    paddingVertical: 4,
                  }}>
                    <Text style={[typography.caption, { 
                      color: bank.confidence >= 70 ? '#10b981' : bank.confidence >= 50 ? '#f59e0b' : '#ef4444',
                      fontSize: 10,
                      fontWeight: 'bold',
                    }]}>
                      {bank.confidence.toFixed(0)}%
                    </Text>
                  </View>
                </View>
              </Card>
            ))}
          </View>
        )}

        {/* Empty State */}
        {!scanning && !result && (
          <View style={{ alignItems: 'center', paddingVertical: spacing.xl }}>
            <MaterialCommunityIcons name="radar" size={64} color={colors.border} />
            <Text style={[typography.h3, { color: colors.subtext, marginTop: spacing.md }]}>
              No scan yet
            </Text>
            <Text style={[typography.caption, { color: colors.subtext, marginTop: spacing.sm, textAlign: 'center' }]}>
              Tap "Start Scan" to automatically detect your banks from SMS history
            </Text>
          </View>
        )}
      </ScrollView>
    </ScreenWrapper>
  );
}

const styles = StyleSheet.create({
  infoBanner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
});
