// ═══════════════════════════════════════════════════════════════════════════════
// TRANSACTION PROCESSORS MODULE
// Consolidated: NotificationProcessorTask + SmsProcessorTask
// Handles both SMS and App Notification processing for financial transactions
// ═══════════════════════════════════════════════════════════════════════════════

import { supabase } from './core';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { 
  isSpamMessage, 
  showSmsFailedNotification, 
  showTransactionConfirmation 
} from './notifications';

// ═══════════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════════

interface SmsData {
  sender: string;
  body: string;
  timestamp: number;
}

interface NotificationData {
  packageName: string;
  title: string;
  text: string;
  timestamp: number;
}

interface ParsedTransaction {
  amount: number;
  type: 'debit' | 'credit';
  reference?: string;
  merchant?: string;
  balance?: number;
  source: 'bank' | 'upi';
  rawSender: string;
  accountLast4?: string;
}

interface BankAccount {
  id: string;
  account_last4: string;
  bank_name: string;
}

// ═══════════════════════════════════════════════════════════════════════════════
// CONFIGURATION
// ═══════════════════════════════════════════════════════════════════════════════

// Allowed app packages for notification processing
const ALLOWED_PACKAGES = [
  'com.google.android.apps.nbu.paisa.user', // Google Pay
  'com.phonepe.app', // PhonePe
  'tech.ula', // Slice (legacy)
  'indwin.c3.shareapp', // Slice (actual)
  'com.dreamplug.androidapp', // CRED
  'in.amazon.mShop.android.shopping', // Amazon Pay
  'net.one97.paytm', // Paytm
  'com.whatsapp', // WhatsApp (for UPI)
  'money.super.app', // Super.money
  'com.spendsense', // Test notifications
];

const PACKAGE_TO_SENDER: { [key: string]: string } = {
  'com.google.android.apps.nbu.paisa.user': 'GPAYID',
  'com.phonepe.app': 'PHONEPE',
  'tech.ula': 'SLICE',
  'indwin.c3.shareapp': 'SLICE',
  'com.dreamplug.androidapp': 'CRED',
  'in.amazon.mShop.android.shopping': 'AMAZONP',
  'net.one97.paytm': 'PAYTMB',
  'com.whatsapp': 'WHATSAP',
  'money.super.app': 'SUPERM',
  'com.spendsense': 'TEST',
};

const BANK_SENDERS = [
  'HDFC', 'ICICI', 'SBI', 'AXIS', 'KOTAK', 'PNB', 
  'SCBANK', 'YESBNK', 'INDBNK', 'UNIONB', 'UTKARSH', 'SFBL', 'BOB'
];

const UPI_SENDERS = [
  'PAYTMB', 'GPAYID', 'PHONEPE', 'BHARTP', 'AMAZONP', 'WHATSAP',
  'MOBIKW', 'FREECHARGE', 'PAYZAPP', 'SLCEIT', 'SLICE', 'CRED', 'SUPERM', 'TEST'
];

const BLOCKED_SENDERS = ['TEST', 'TEST-SMS', 'DM-TEST', 'VM-TEST'];
const TRAI_DLT_PREFIXES = ['JM-', 'BT-', 'AD-', 'VM-', 'DM-', 'TM-', 'AM-', 'LM-'];

// ═══════════════════════════════════════════════════════════════════════════════
// SHARED HELPER FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════════

function isBlockedSender(sender: string): boolean {
  const upperSender = sender.toUpperCase();
  return BLOCKED_SENDERS.some(blocked => upperSender.includes(blocked));
}

function isLegitimateFinancialSender(sender: string): boolean {
  if (/^[A-Za-z]{2}-/.test(sender)) return true;
  const upperSender = sender.toUpperCase();
  const isWhitelisted = BANK_SENDERS.some(bank => upperSender.includes(bank)) ||
                       UPI_SENDERS.some(upi => upperSender.includes(upi));
  if (isWhitelisted) return true;
  return TRAI_DLT_PREFIXES.some(prefix => upperSender.startsWith(prefix));
}

function identifySource(sender: string): 'bank' | 'upi' | 'unknown' {
  const upperSender = sender.toUpperCase();
  if (BANK_SENDERS.some(bank => upperSender.includes(bank))) return 'bank';
  if (UPI_SENDERS.some(upi => upperSender.includes(upi))) return 'upi';
  return 'unknown';
}

function extractAccountLast4(body: string): string | undefined {
  const accountPatterns = [
    /(?:SuperCard|Card)\s+(\d{4})/i,
    /(?:A\/?C|Acct|Account)\s*(?:no\.?|number)?\s*[-:xX*]*\s*(\d{3,5})/i,
    /XX(\d{4})/i,
  ];
  for (const pattern of accountPatterns) {
    const match = body.match(pattern);
    if (match) return match[1];
  }
  return undefined;
}

function isNumericUpiId(str: string): boolean {
  return /^\d+$/.test(str.trim());
}

// ═══════════════════════════════════════════════════════════════════════════════
// TRANSACTION PARSING
// ═══════════════════════════════════════════════════════════════════════════════

function parseTransaction(body: string, sender: string): ParsedTransaction | null {
  try {
    const source = identifySource(sender);
    if (source === 'unknown') return null;

    // Extract amount
    const amountPatterns = [
      /^(?:INR|Rs\.?|₹)\s*([0-9,]+(?:\.[0-9]{2})?)/i,
      /(?:INR|Rs\.?|₹)\s*([0-9,]+(?:\.[0-9]{2})?)/i,
      /(?:amount|amt)[\s:]*(?:INR|Rs\.?|₹)?\s*([0-9,]+(?:\.[0-9]{2})?)/i,
      /(?:debited|credited|paid|received)[\s:]*(?:INR|Rs\.?|₹)?\s*([0-9,]+(?:\.[0-9]{2})?)/i,
    ];

    let amount = 0;
    for (const pattern of amountPatterns) {
      const match = body.match(pattern);
      if (match) {
        amount = parseFloat(match[1].replace(/,/g, ''));
        break;
      }
    }
    if (amount === 0) return null;

    // Determine type
    const isPaidToYou = /paid\s+(?:to\s+)?you/i.test(body);
    const isCredit = isPaidToYou || 
                     /you'?ve\s+got/i.test(body) ||
                     /credited|received|deposited|refund|added|cr\.?\s/i.test(body);
    const isDebit = /debited|deducted|spent|withdrawn|purchase|sent|dr\.?\s/i.test(body) || 
                    (!isCredit && /paid/i.test(body));
    
    let type: 'debit' | 'credit';
    if (/\bdebited\b|\bdr\.?\s/i.test(body)) {
      type = 'debit';
    } else if (/\bcredited\b|\bcr\.?\s/i.test(body)) {
      type = 'credit';
    } else {
      type = isCredit ? 'credit' : isDebit ? 'debit' : 'debit';
    }

    // Extract reference
    const refPatterns = [
      /(?:for\s+)?UPI\s*-?\s*(\d+)/i,
      /(?:UPI Ref|UPI ID|UPI|UTR|Ref No|Ref|Transaction ID|TXN ID)[\s#:]*([A-Z0-9]+)/i,
    ];
    let reference: string | undefined;
    for (const pattern of refPatterns) {
      const match = body.match(pattern);
      if (match) {
        reference = match[1];
        break;
      }
    }

    // Extract merchant
    const merchantPatterns = [
      /^([A-Za-z0-9\s&/.!@#$-]+?)\s+paid\s+(?:to\s+)?you\s+(?:INR|Rs\.?|₹)/i,
      /;\s*([A-Za-z0-9\s&]+?)\s+credited/i,
      /You'?ve\s+got\s+(?:INR|Rs\.?|₹)[0-9,.]+ from\s+([A-Za-z\s]+?)(?:\s+in\s+your|\s+to\s+your|\s+on|\.|$)/i,
      /(?:received from|from)\s+([A-Z][A-Za-z\s]+?)(?:\s+in\s+your|\s+to\s+your|\s+on\s+\d|\.|$)/i,
      /(?:at|made at|for)\s+([A-Za-z0-9\s&]+?)(?:\s+using|\s+on|\.|$)/i,
      /(?:to)\s+([A-Z][A-Za-z\s&]+?)(?:\s*\(UPI Ref)/i,
      /(?:to|from|paid to|sent to)\s+(?!view\b)([a-zA-Z0-9.-]+@[a-zA-Z0-9.-]+|[A-Za-z0-9\s&]+?)(?:\s+on|\s+via|[\s(]+UPI|\s+to A\/c|\s+in\s+your|\.|$)/i,
      /(?:paid to|sent to|received from)\s+(?!view\b)([A-Za-z0-9\s&]+?)(?:\s+on|\s+via|\s+to A\/c|\.|$)/i,
      /Info[:\s]*([A-Z0-9*\/]+?)(?:\.|\s|$)/i,
    ];
    let merchant: string | undefined;
    for (const pattern of merchantPatterns) {
      const match = body.match(pattern);
      if (match) {
        merchant = match[1].trim();
        break;
      }
    }
    if (merchant && isNumericUpiId(merchant)) {
      merchant = 'UPI Payment';
    }

    // Extract balance
    const balancePattern = /(?:balance|bal|avbl bal)[\s:]*(?:INR|Rs\.?|₹)?\s*([0-9,]+(?:\.[0-9]{2})?)/i;
    const balanceMatch = body.match(balancePattern);
    const balance = balanceMatch ? parseFloat(balanceMatch[1].replace(/,/g, '')) : undefined;

    const accountLast4 = extractAccountLast4(body);

    return { amount, type, reference, merchant, balance, source, rawSender: sender, accountLast4 };
  } catch (error) {
    console.error('Error parsing transaction:', error);
    return null;
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// DATABASE OPERATIONS
// ═══════════════════════════════════════════════════════════════════════════════

async function checkForDuplicates(
  userId: string,
  amount: number,
  timestamp: number,
  type: 'expense' | 'income',
  referenceNumber?: string,
  smsSource?: 'bank' | 'upi'
): Promise<any | null> {
  try {
    const fiveMinutesAgo = new Date(timestamp - 5 * 60 * 1000).toISOString();
    let query = supabase
      .from('transactions')
      .select('*')
      .eq('user_id', userId)
      .eq('amount', amount)
      .eq('type', type)
      .gte('created_at', fiveMinutesAgo)
      .order('created_at', { ascending: false });

    if (referenceNumber) query = query.eq('reference_number', referenceNumber);
    const { data, error } = await query.limit(1);
    if (error) return null;

    if (data && data.length > 0) {
      const existingTxn = data[0];
      if (smsSource && existingTxn.sms_source && smsSource !== existingTxn.sms_source) {
        return existingTxn;
      }
      return existingTxn;
    }

    if (!referenceNumber) {
      const { data: fallbackData } = await supabase
        .from('transactions')
        .select('*')
        .eq('user_id', userId)
        .eq('amount', amount)
        .eq('type', type)
        .gte('created_at', fiveMinutesAgo)
        .is('reference_number', null)
        .order('created_at', { ascending: false })
        .limit(1);

      if (fallbackData && fallbackData.length > 0) {
        const existingTxn = fallbackData[0];
        if (smsSource && existingTxn.sms_source && smsSource !== existingTxn.sms_source) {
          return existingTxn;
        }
        return existingTxn;
      }
    }
    return null;
  } catch (error) {
    return null;
  }
}

async function getUserBankAccounts(userId: string): Promise<BankAccount[]> {
  try {
    const { data } = await supabase
      .from('bank_accounts')
      .select('id, account_last4, bank_name')
      .eq('user_id', userId);
    return data || [];
  } catch {
    return [];
  }
}

function findBankAccountByLast4(accounts: BankAccount[], last4?: string): BankAccount | undefined {
  if (!last4) return undefined;
  return accounts.find(acc => acc.account_last4 === last4);
}

// ═══════════════════════════════════════════════════════════════════════════════
// SMS PROCESSOR
// ═══════════════════════════════════════════════════════════════════════════════

export const processSms = async (taskData: SmsData) => {
  console.log('SMS Processor Started', taskData);

  try {
    if (isBlockedSender(taskData.sender)) {
      console.log('⛔ Blocked sender - skipping:', taskData.sender);
      return;
    }

    if (!isLegitimateFinancialSender(taskData.sender)) {
      console.log('⛔ Non-financial sender - skipping:', taskData.sender);
      return;
    }

    if (isSpamMessage(taskData.body)) {
      console.log('⚠️ Spam SMS - skipping');
      return;
    }

    const parsed = parseTransaction(taskData.body, taskData.sender);
    if (!parsed) {
      console.log('SMS not recognized as financial transaction');
      return;
    }

    console.log('Parsed Transaction:', parsed);

    let userId: string | null = null;
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (session?.user?.id) userId = session.user.id;
    } catch {}

    if (!userId) {
      const storedUserId = await AsyncStorage.getItem('app_user_id');
      if (storedUserId) userId = storedUserId;
    }

    if (!userId) {
      console.log('No user ID found');
      return;
    }

    // Check for duplicates
    const dbType = parsed.type === 'debit' ? 'expense' : 'income';
    const duplicate = await checkForDuplicates(
      userId,
      parsed.amount,
      taskData.timestamp,
      dbType,
      parsed.reference,
      parsed.source
    );

    if (duplicate) {
      console.log('Duplicate transaction detected - skipping');
      return;
    }

    // Save transaction
    const { data: newTxn, error } = await supabase
      .from('transactions')
      .insert({
        user_id: userId,
        amount: parsed.amount,
        type: dbType,
        note: parsed.merchant || 'Transaction',
        category: parsed.merchant || 'general',
        reference_number: parsed.reference,
        account_last4: parsed.accountLast4,
        sms_source: parsed.source,
      })
      .select()
      .single();

    if (error) {
      console.error('Error saving transaction:', error);
      return;
    }

    console.log('✅ Transaction saved:', newTxn.id);
    await showTransactionConfirmation(parsed, newTxn.id);
  } catch (error) {
    console.error('Error in SMS processor:', error);
  }
};

// ═══════════════════════════════════════════════════════════════════════════════
// NOTIFICATION PROCESSOR
// ═══════════════════════════════════════════════════════════════════════════════

export const processNotification = async (taskData: any) => {
  console.log('🔔 Notification Processor Started:', taskData);

  try {
    const notif = JSON.parse(taskData.notification);
    console.log('Parsed notification:', notif);

    if (!ALLOWED_PACKAGES.includes(notif.app)) {
      console.log('Notification from non-financial app - ignoring:', notif.app);
      return;
    }

    const combinedText = `${notif.title || ''} ${notif.text || ''}`.trim();
    
    if (isSpamMessage(combinedText)) {
      console.log('⚠️ Spam notification - skipping');
      return;
    }

    // Non-transaction filter
    const NON_TRANSACTION_PATTERNS = [
      /emi\s+of\s+(?:INR|Rs\.?|₹)\s*[0-9,]+.*(?:is\s+)?due/i,
      /(?:INR|Rs\.?|₹)\s*[0-9,]+.*(?:is\s+)?due\s+on/i,
      /(?:loan|emi|bill|payment)\s+due/i,
      /due\s+on\s+\d{1,2}(?:st|nd|rd|th)?\s+\w+/i,
      /pay\s+now\s+with\s+(?:INR|Rs\.?|₹)\s*0/i,
      /(?:upcoming|pending|scheduled)\s+(?:emi|payment|bill)/i,
      /(?:autopay|auto-pay|auto\s+debit|mandate)\s+(?:for|of|on)/i,
      /(?:renew|recharge|subscribe)\s+(?:now|before|by)/i,
      /(?:avoid|prevent)\s+(?:late|penalty|interest)/i,
    ];
    
    if (NON_TRANSACTION_PATTERNS.some(pattern => pattern.test(combinedText))) {
      console.log('⚠️ Reminder notification - skipping');
      return;
    }

    // WhatsApp strict validation
    if (notif.app === 'com.whatsapp') {
      const textLower = combinedText.toLowerCase();
      const hasUPIReference = textLower.includes('upi ref') || 
                             textLower.includes('upi id') || 
                             textLower.includes('transaction id') ||
                             textLower.includes('utr');
      const hasPaymentKeyword = textLower.includes('payment') || 
                               textLower.includes('₹') || 
                               textLower.includes('rs.');
      
      if (!hasUPIReference || !hasPaymentKeyword) {
        console.log('⚠️ WhatsApp notification not a valid payment - skipping');
        return;
      }
    }

    const sender = PACKAGE_TO_SENDER[notif.app] || 'UNKNOWN';

    if (isBlockedSender(sender)) {
      console.log('⛔ Blocked sender - skipping:', sender);
      return;
    }

    if (!isLegitimateFinancialSender(sender)) {
      console.log('⛔ Non-financial sender - skipping:', sender);
      return;
    }

    const parsed = parseTransaction(combinedText, sender);
    if (!parsed) {
      console.log('Notification not recognized as financial transaction');
      await showSmsFailedNotification(combinedText, sender, 'Parse failed');
      return;
    }

    console.log('✅ Parsed Transaction:', parsed);

    let userId: string | null = null;
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (session?.user?.id) userId = session.user.id;
    } catch {}

    if (!userId) {
      const storedUserId = await AsyncStorage.getItem('app_user_id');
      if (storedUserId) userId = storedUserId;
    }

    if (!userId) {
      console.log('No user ID found');
      return;
    }

    // Check for duplicates
    const dbType = parsed.type === 'debit' ? 'expense' : 'income';
    const duplicate = await checkForDuplicates(
      userId,
      parsed.amount,
      notif.time || Date.now(),
      dbType,
      parsed.reference,
      parsed.source
    );

    if (duplicate) {
      console.log('Duplicate transaction detected - skipping');
      return;
    }

    // Save transaction
    const { data: newTxn, error } = await supabase
      .from('transactions')
      .insert({
        user_id: userId,
        amount: parsed.amount,
        type: dbType,
        note: parsed.merchant || 'Transaction',
        category: parsed.merchant || 'general',
        reference_number: parsed.reference,
        account_last4: parsed.accountLast4,
        sms_source: parsed.source,
      })
      .select()
      .single();

    if (error) {
      console.error('Error saving transaction:', error);
      return;
    }

    console.log('✅ Transaction saved:', newTxn.id);
    await showTransactionConfirmation(parsed, newTxn.id);
  } catch (error) {
    console.error('Error in notification processor:', error);
  }
};

// ═══════════════════════════════════════════════════════════════════════════════
// EXPORTS (for backward compatibility)
// ═══════════════════════════════════════════════════════════════════════════════

export default processSms; // Default export for SMS
