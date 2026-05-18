/**
 * Bank Auto-Detection Service
 * 
 * Automatically detects user's banks from:
 * 1. SMS history scanning
 * 2. Incoming transaction SMS
 * 3. Pattern learning
 */

import { PermissionsAndroid, Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { parseSMS, detectBankFromSender, detectBankFromContent, extractLast4Digits, INDIAN_BANKS } from './smsParser';
import { getBankAccounts, addBankAccount } from '../database/financial';

// Dynamically import SMS module to handle cases where it's not available
let SmsAndroid: any = null;
try {
  SmsAndroid = require('react-native-get-sms-android');
} catch (error) {
  console.warn('react-native-get-sms-android not available:', error);
}

// ═══════════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════════

export interface DetectedBank {
  bankName: string;
  senderIds: string[];
  last4Digits: string[];
  sampleSMS: string;
  confidence: number;
  firstSeen: string;
  lastSeen: string;
  transactionCount: number;
}

export interface AutoDetectionResult {
  detectedBanks: DetectedBank[];
  totalSMSScanned: number;
  timeElapsed: number;
}

// ═══════════════════════════════════════════════════════════════════════════════
// SMS HISTORY SCANNING
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Request SMS permission
 */
async function requestSMSPermission(): Promise<boolean> {
  if (Platform.OS !== 'android') {
    return false;
  }

  try {
    const granted = await PermissionsAndroid.request(
      PermissionsAndroid.PERMISSIONS.READ_SMS,
      {
        title: 'SMS Permission',
        message: 'SpendSense needs access to read SMS to automatically detect your banks and transactions.',
        buttonPositive: 'Allow',
      }
    );
    return granted === PermissionsAndroid.RESULTS.GRANTED;
  } catch (error) {
    console.error('Error requesting SMS permission:', error);
    return false;
  }
}

/**
 * Scan SMS history to detect banks
 * Scans last 30 days of SMS
 */
export async function scanSMSHistory(): Promise<AutoDetectionResult> {
  const startTime = Date.now();
  
  try {
    // Check if SMS module is available
    if (!SmsAndroid) {
      throw new Error('SMS module not available. Please rebuild the app.');
    }

    // Request permission
    const hasPermission = await requestSMSPermission();
    if (!hasPermission) {
      throw new Error('SMS permission denied');
    }

    // Calculate date range (last 30 days)
    const thirtyDaysAgo = Date.now() - (30 * 24 * 60 * 60 * 1000);

    // Scan SMS
    const messages = await new Promise<any[]>((resolve, reject) => {
      const filter = {
        box: 'inbox',
        minDate: thirtyDaysAgo,
        maxCount: 500, // Limit to 500 SMS for performance
      };

      SmsAndroid.list(
        JSON.stringify(filter),
        (fail: any) => reject(new Error(fail || 'Failed to read SMS')),
        (count: number, smsList: string) => {
          try {
            const messages = JSON.parse(smsList);
            resolve(messages);
          } catch (error) {
            reject(new Error('Failed to parse SMS data'));
          }
        }
      );
    });

    // Detect banks from SMS
    const bankMap = new Map<string, DetectedBank>();

    for (const msg of messages) {
      const { address, body, date } = msg;
      
      // Detect bank
      const bankFromSender = detectBankFromSender(address);
      const bankFromContent = detectBankFromContent(body);
      const bankName = bankFromSender || bankFromContent;
      
      if (!bankName) continue;

      // Extract last 4 digits
      const last4 = extractLast4Digits(body);
      
      // Parse SMS for confidence
      const parsed = parseSMS(body, address);
      
      // Only consider transaction SMS
      if (parsed.confidence < 30) continue;

      // Update or create bank entry
      if (bankMap.has(bankName)) {
        const existing = bankMap.get(bankName)!;
        existing.transactionCount++;
        existing.lastSeen = new Date(date).toISOString();
        
        // Add sender ID if new
        if (!existing.senderIds.includes(address)) {
          existing.senderIds.push(address);
        }
        
        // Add last 4 digits if new
        if (last4 && !existing.last4Digits.includes(last4)) {
          existing.last4Digits.push(last4);
        }
        
        // Update confidence (average)
        existing.confidence = (existing.confidence + parsed.confidence) / 2;
      } else {
        bankMap.set(bankName, {
          bankName,
          senderIds: [address],
          last4Digits: last4 ? [last4] : [],
          sampleSMS: body.substring(0, 200),
          confidence: parsed.confidence,
          firstSeen: new Date(date).toISOString(),
          lastSeen: new Date(date).toISOString(),
          transactionCount: 1,
        });
      }
    }

    // Convert to array and sort by transaction count
    const detectedBanks = Array.from(bankMap.values())
      .sort((a, b) => b.transactionCount - a.transactionCount);

    const result: AutoDetectionResult = {
      detectedBanks,
      totalSMSScanned: messages.length,
      timeElapsed: Date.now() - startTime,
    };

    // Cache result
    await AsyncStorage.setItem('bank_auto_detection_result', JSON.stringify(result));
    await AsyncStorage.setItem('bank_auto_detection_date', new Date().toISOString());

    return result;
  } catch (error) {
    console.error('Error scanning SMS history:', error);
    throw error;
  }
}

/**
 * Get cached detection result
 */
export async function getCachedDetectionResult(): Promise<AutoDetectionResult | null> {
  try {
    const cached = await AsyncStorage.getItem('bank_auto_detection_result');
    if (!cached) return null;
    return JSON.parse(cached);
  } catch {
    return null;
  }
}

/**
 * Check if detection is stale (older than 7 days)
 */
export async function isDetectionStale(): Promise<boolean> {
  try {
    const dateStr = await AsyncStorage.getItem('bank_auto_detection_date');
    if (!dateStr) return true;
    
    const date = new Date(dateStr);
    const sevenDaysAgo = Date.now() - (7 * 24 * 60 * 60 * 1000);
    
    return date.getTime() < sevenDaysAgo;
  } catch {
    return true;
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// SMART SUGGESTIONS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Get banks that are detected but not added by user
 */
export async function getUnaddedBanks(): Promise<DetectedBank[]> {
  try {
    const detected = await getCachedDetectionResult();
    if (!detected) return [];

    const userAccounts = await getBankAccounts();
    const userBankNames = new Set(userAccounts.map(acc => acc.bank_name.toLowerCase()));

    return detected.detectedBanks.filter(bank => 
      !userBankNames.has(bank.bankName.toLowerCase())
    );
  } catch {
    return [];
  }
}

/**
 * Auto-add bank with best guess configuration
 */
export async function autoAddBank(detectedBank: DetectedBank): Promise<boolean> {
  try {
    // Use most common last 4 digits
    const last4 = detectedBank.last4Digits[0] || '0000';
    
    // Determine account type based on keywords in sample SMS
    let accountType: 'savings' | 'checking' | 'credit_card' = 'savings';
    const sampleLower = detectedBank.sampleSMS.toLowerCase();
    
    if (sampleLower.includes('credit card') || sampleLower.includes('card')) {
      accountType = 'credit_card';
    } else if (sampleLower.includes('current')) {
      accountType = 'checking';
    }

    await addBankAccount({
      bank_name: detectedBank.bankName,
      account_last4: last4,
      account_type: accountType,
      starting_balance: 0,
      upi_ids: [],
    });

    return true;
  } catch (error) {
    console.error('Error auto-adding bank:', error);
    return false;
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// REAL-TIME DETECTION
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Detect bank from incoming SMS and suggest if not added
 */
export async function detectAndSuggestBank(
  smsText: string,
  senderId: string
): Promise<{ shouldSuggest: boolean; detectedBank: DetectedBank | null }> {
  try {
    // Parse SMS
    const parsed = parseSMS(smsText, senderId);
    
    // Low confidence - ignore
    if (parsed.confidence < 50) {
      return { shouldSuggest: false, detectedBank: null };
    }

    // No bank detected - ignore
    if (!parsed.bankName) {
      return { shouldSuggest: false, detectedBank: null };
    }

    // Check if bank already added
    const userAccounts = await getBankAccounts();
    const isAdded = userAccounts.some(acc => 
      acc.bank_name.toLowerCase() === parsed.bankName!.toLowerCase()
    );

    if (isAdded) {
      return { shouldSuggest: false, detectedBank: null };
    }

    // Create detected bank object
    const detectedBank: DetectedBank = {
      bankName: parsed.bankName,
      senderIds: [senderId],
      last4Digits: parsed.last4Digits ? [parsed.last4Digits] : [],
      sampleSMS: smsText.substring(0, 200),
      confidence: parsed.confidence,
      firstSeen: new Date().toISOString(),
      lastSeen: new Date().toISOString(),
      transactionCount: 1,
    };

    return { shouldSuggest: true, detectedBank };
  } catch (error) {
    console.error('Error detecting bank from SMS:', error);
    return { shouldSuggest: false, detectedBank: null };
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// STATISTICS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Get detection statistics
 */
export async function getDetectionStats(): Promise<{
  totalDetected: number;
  totalAdded: number;
  pendingSuggestions: number;
  lastScanDate: string | null;
}> {
  try {
    const detected = await getCachedDetectionResult();
    const userAccounts = await getBankAccounts();
    const unadded = await getUnaddedBanks();
    const lastScanDate = await AsyncStorage.getItem('bank_auto_detection_date');

    return {
      totalDetected: detected?.detectedBanks.length || 0,
      totalAdded: userAccounts.length,
      pendingSuggestions: unadded.length,
      lastScanDate,
    };
  } catch {
    return {
      totalDetected: 0,
      totalAdded: 0,
      pendingSuggestions: 0,
      lastScanDate: null,
    };
  }
}
