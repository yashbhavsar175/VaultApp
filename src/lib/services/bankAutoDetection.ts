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
import { parseSMS, detectBankFromSender, detectBankFromContent, extractLast4Digits } from './smsParser';
import { getBankAccounts, addBankAccount, updateBankAccount } from '../database/financial';
import { createRedactedRawTextRecord, isRedactedRawTextRecord } from '../privacy/rawText';

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

function normalizeBankName(name: string): string {
  if (!name) return '';
  return name.toLowerCase().replace(/\b(bank|ltd|limited|the)\b/g, '').replace(/[^a-z0-9]/g, '');
}

export interface DetectedBank {
  bankName: string;
  senderIds: string[];
  last4Digits: string[];
  accountBalances?: DetectedAccountBalance[];
  lastKnownBalance?: number | null;
  balanceLastSeen?: string | null;
  sampleSMS: string;
  accountTypeHint?: 'savings' | 'current' | 'credit_card';
  confidence: number;
  firstSeen: string;
  lastSeen: string;
  transactionCount: number;
}

export interface DetectedAccountBalance {
  last4Digits: string | null;
  balance: number;
  lastSeen: string;
}

export interface AutoDetectionResult {
  detectedBanks: DetectedBank[];
  totalSMSScanned: number;
  timeElapsed: number;
}

// ═══════════════════════════════════════════════════════════════════════════════
// SMS HISTORY SCANNING
// ═══════════════════════════════════════════════════════════════════════════════

function isNewerDate(nextDate: string, currentDate?: string | null): boolean {
  if (!currentDate) return true;
  return new Date(nextDate).getTime() > new Date(currentDate).getTime();
}

function recordDetectedBalance(
  detectedBank: DetectedBank,
  last4Digits: string | null,
  balance: number | null,
  seenAt: string
) {
  if (balance === null || balance === undefined) return;

  if (!detectedBank.accountBalances) {
    detectedBank.accountBalances = [];
  }

  const existing = detectedBank.accountBalances.find(item => item.last4Digits === last4Digits);
  if (!existing) {
    detectedBank.accountBalances.push({ last4Digits, balance, lastSeen: seenAt });
  } else if (isNewerDate(seenAt, existing.lastSeen)) {
    existing.balance = balance;
    existing.lastSeen = seenAt;
  }

  if (isNewerDate(seenAt, detectedBank.balanceLastSeen)) {
    detectedBank.lastKnownBalance = balance;
    detectedBank.balanceLastSeen = seenAt;
  }
}

function getDetectedBalanceForLast4(detectedBank: DetectedBank, last4Digits?: string | null): number | null {
  const accountBalance = detectedBank.accountBalances?.find(item => item.last4Digits === (last4Digits || null));
  return accountBalance?.balance ?? detectedBank.lastKnownBalance ?? null;
}

function inferAccountTypeHint(smsText: string): DetectedBank['accountTypeHint'] {
  const sampleLower = smsText.toLowerCase();

  if (sampleLower.includes('credit card') || sampleLower.includes('card')) {
    return 'credit_card';
  }

  if (sampleLower.includes('current')) {
    return 'current';
  }

  return 'savings';
}

function createRedactedSampleSMS(smsText: string, senderId?: string | null, source = 'bank_auto_detection'): string {
  return createRedactedRawTextRecord({
    kind: 'sms',
    text: smsText,
    sender: senderId,
    source,
  });
}

function sanitizeDetectedBankSample(bank: DetectedBank): DetectedBank {
  if (!bank.sampleSMS || isRedactedRawTextRecord(bank.sampleSMS)) return bank;

  return {
    ...bank,
    accountTypeHint: bank.accountTypeHint || inferAccountTypeHint(bank.sampleSMS),
    sampleSMS: createRedactedSampleSMS(bank.sampleSMS, bank.senderIds?.[0], 'bank_auto_detection_cache'),
  };
}

function sanitizeDetectionResult(result: AutoDetectionResult): AutoDetectionResult {
  return {
    ...result,
    detectedBanks: Array.isArray(result.detectedBanks)
      ? result.detectedBanks.map(sanitizeDetectedBankSample)
      : [],
  };
}

async function syncDetectedBalancesToExistingAccounts(detectedBanks: DetectedBank[]) {
  try {
    const accounts = await getBankAccounts();

    for (const account of accounts) {
      const detectedBank = detectedBanks.find(bank => {
        const sameBank = normalizeBankName(bank.bankName) === normalizeBankName(account.bank_name);
        const hasAccount = account.account_last4 ? bank.last4Digits.includes(account.account_last4) : true;
        return sameBank && hasAccount;
      });

      if (!detectedBank) continue;

      const detectedBalance = getDetectedBalanceForLast4(detectedBank, account.account_last4);
      if (detectedBalance === null) continue;

      await updateBankAccount(account.id, { balance: detectedBalance });
    }
  } catch (error) {
    console.warn('[BankAutoDetection] Could not sync detected balances:', error);
  }
}

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
            const smsMessages = JSON.parse(smsList);
            resolve(smsMessages);
          } catch {
            reject(new Error('Failed to parse SMS data'));
          }
        }
      );
    });

    // Detect banks from SMS
    const bankMap = new Map<string, DetectedBank>();

    for (const msg of messages) {
      const { address, body, date } = msg;
      const seenAt = new Date(date).toISOString();
      
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
        if (isNewerDate(seenAt, existing.lastSeen)) {
          existing.lastSeen = seenAt;
        }
        
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
        recordDetectedBalance(existing, last4, parsed.balance, seenAt);
      } else {
        const detectedBank: DetectedBank = {
          bankName,
          senderIds: [address],
          last4Digits: last4 ? [last4] : [],
          accountBalances: [],
          lastKnownBalance: null,
          balanceLastSeen: null,
          sampleSMS: createRedactedSampleSMS(body, address),
          accountTypeHint: inferAccountTypeHint(body),
          confidence: parsed.confidence,
          firstSeen: seenAt,
          lastSeen: seenAt,
          transactionCount: 1,
        };
        recordDetectedBalance(detectedBank, last4, parsed.balance, seenAt);
        bankMap.set(bankName, detectedBank);
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
    await syncDetectedBalancesToExistingAccounts(detectedBanks);

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
    const parsed = JSON.parse(cached);
    const result = sanitizeDetectionResult(parsed);
    if (JSON.stringify(parsed) !== JSON.stringify(result)) {
      await AsyncStorage.setItem('bank_auto_detection_result', JSON.stringify(result));
    }
    return result;
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
    const userBankNames = new Set(userAccounts.map(acc => normalizeBankName(acc.bank_name)));
    const userAccountKeys = new Set(
      userAccounts.map(acc => `${normalizeBankName(acc.bank_name)}|${acc.account_last4}`)
    );

    return detected.detectedBanks.filter(bank => {
      const normalizedDetected = normalizeBankName(bank.bankName);
      if (bank.last4Digits.length === 0) {
        return !userBankNames.has(normalizedDetected);
      }

      return bank.last4Digits.some(last4 =>
        !userAccountKeys.has(`${normalizedDetected}|${last4}`)
      );
    });
  } catch {
    return [];
  }
}

/**
 * Auto-add bank with best guess configuration
 */
export async function autoAddBank(detectedBank: DetectedBank): Promise<boolean> {
  try {
    // Determine account type based on keywords in sample SMS
    let accountType: 'savings' | 'current' | 'credit_card' = detectedBank.accountTypeHint || 'savings';
    const sampleLower = detectedBank.sampleSMS.toLowerCase();
    
    if (!detectedBank.accountTypeHint && (sampleLower.includes('credit card') || sampleLower.includes('card'))) {
      accountType = 'credit_card';
    } else if (!detectedBank.accountTypeHint && sampleLower.includes('current')) {
      accountType = 'current';
    }

    const existingAccounts = await getBankAccounts();
    const existingKeys = new Set(
      existingAccounts.map(acc => `${normalizeBankName(acc.bank_name)}|${acc.account_last4}`)
    );
    const last4Digits = detectedBank.last4Digits.length > 0 ? detectedBank.last4Digits : ['0000'];
    let addedCount = 0;

    for (const last4 of last4Digits) {
      const accountKey = `${normalizeBankName(detectedBank.bankName)}|${last4}`;
      if (existingKeys.has(accountKey)) continue;

      const detectedBalance = getDetectedBalanceForLast4(detectedBank, last4);

      await addBankAccount({
        bank_name: detectedBank.bankName,
        account_last4: last4,
        account_type: accountType,
        starting_balance: detectedBalance ?? 0,
        credit_limit: 0,
        loan_total: 0,
        upi_ids: [],
      });
      addedCount++;
    }

    return addedCount > 0;
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
      normalizeBankName(acc.bank_name) === normalizeBankName(parsed.bankName!)
    );

    if (isAdded) {
      return { shouldSuggest: false, detectedBank: null };
    }

    // Create detected bank object
    const detectedBank: DetectedBank = {
      bankName: parsed.bankName,
      senderIds: [senderId],
      last4Digits: parsed.last4Digits ? [parsed.last4Digits] : [],
      accountBalances: [],
      lastKnownBalance: null,
      balanceLastSeen: null,
      sampleSMS: createRedactedSampleSMS(smsText, senderId, 'bank_auto_detection_realtime'),
      accountTypeHint: inferAccountTypeHint(smsText),
      confidence: parsed.confidence,
      firstSeen: new Date().toISOString(),
      lastSeen: new Date().toISOString(),
      transactionCount: 1,
    };
    recordDetectedBalance(detectedBank, parsed.last4Digits, parsed.balance, detectedBank.lastSeen);

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
