import { supabase } from './supabase';
import AsyncStorage from '@react-native-async-storage/async-storage';

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

// Allowed app packages for notification processing
const ALLOWED_PACKAGES = [
  'com.google.android.apps.nbu.paisa.user', // Google Pay
  'com.phonepe.app', // PhonePe
  'tech.ula', // Slice (legacy)
  'indwin.c3.shareapp', // Slice (actual package name)
  'com.dreamplug.androidapp', // CRED
  'in.amazon.mShop.android.shopping', // Amazon Pay
  'net.one97.paytm', // Paytm
  'com.whatsapp', // WhatsApp (for UPI)
  'money.super.app', // Super.money
  'com.spendsense', // Test notifications from our own app
];

// Package name to sender ID mapping
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
  'com.spendsense': 'TEST', // Test notifications
};

// Known bank and UPI sender IDs
const BANK_SENDERS = [
  'HDFCBK', 'ICICIB', 'SBIINB', 'AXISBK', 'KOTAKB', 'PNBSMS', 
  'SCBANK', 'YESBNK', 'INDBNK', 'UNIONB'
];

const UPI_SENDERS = [
  'PAYTMB', 'GPAYID', 'PHONEPE', 'BHARTP', 'AMAZONP', 'WHATSAP',
  'MOBIKW', 'FREECHARGE', 'PAYZAPP', 'SLCEIT', 'SLICE', 'CRED', 'SUPERM', 'TEST'
];

/**
 * Determines if sender is from a bank or UPI app
 */
function identifySource(sender: string): 'bank' | 'upi' | 'unknown' {
  const upperSender = sender.toUpperCase();
  
  if (BANK_SENDERS.some(bank => upperSender.includes(bank))) {
    return 'bank';
  }
  
  if (UPI_SENDERS.some(upi => upperSender.includes(upi))) {
    return 'upi';
  }
  
  return 'unknown';
}

/**
 * Extract last 4 digits of account number from text
 */
function extractAccountLast4(body: string): string | undefined {
  const accountPatterns = [
    /A\/?C\s*[-:xX*]*\s*(\d{4})/i,
    /A\/c\s*(?:no\.?|number)?\s*[xX*]*(\d{4})/i,
    /account\s*(?:no\.?|number)?\s*[xX*]*(\d{4})/i,
    /A\/c\s*[xX*]+(\d{4})/i,
    /XX(\d{4})/i,
  ];

  for (const pattern of accountPatterns) {
    const match = body.match(pattern);
    if (match) {
      return match[1];
    }
  }

  return undefined;
}

/**
 * Parse notification text to extract transaction details
 * Reuses the same logic as SMS parsing
 */
function parseNotification(body: string, sender: string): ParsedTransaction | null {
  try {
    const source = identifySource(sender);
    
    // Skip if not from known financial source
    if (source === 'unknown') {
      return null;
    }

    // Amount patterns (INR/Rs/₹)
    const amountPatterns = [
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

    if (amount === 0) {
      return null;
    }

    // Determine transaction type
    // Check for "paid you" pattern first (indicates credit/income)
    const isPaidToYou = /paid\s+(?:to\s+)?you/i.test(body);
    const isCredit = isPaidToYou || /credited|received|deposited|refund|added|cr\s/i.test(body);
    const isDebit = /debited|deducted|spent|withdrawn|purchase|sent|dr\s/i.test(body) || 
                    (!isCredit && /paid/i.test(body)); // "paid" alone is debit only if not credit
    
    const type: 'debit' | 'credit' = isCredit ? 'credit' : isDebit ? 'debit' : 'debit';

    // Extract reference number
    const refPatterns = [
      /(?:UPI Ref|UPI ID|UTR|Ref No|Transaction ID|TXN ID)[\s:]*([A-Z0-9]+)/i,
      /Ref[\s#:]*([0-9]{12,})/i,
    ];

    let reference: string | undefined;
    for (const pattern of refPatterns) {
      const match = body.match(pattern);
      if (match) {
        reference = match[1];
        break;
      }
    }

    // Extract merchant/payee name
    const merchantPatterns = [
      /(?:at|made at)\s+([A-Za-z0-9\s&]+?)(?:\s+using|\s+on|\.|$)/i, // "at Amazon" or "made at Swiggy"
      /(?:to)\s+([A-Z][A-Za-z\s&]+?)(?:\s*\(UPI Ref)/i,
      /(?:to|from|paid to|sent to)\s+([a-zA-Z0-9.-]+@[a-zA-Z0-9.-]+|[A-Za-z0-9\s&]+?)(?:\s+on|\s+via|[\s(]+UPI|\s+to A\/c|\.|$)/i,
      /(?:paid to|sent to|received from)\s+([A-Za-z0-9\s&]+?)(?:\s+on|\s+via|\s+to A\/c|\.|$)/i,
    ];

    let merchant: string | undefined;
    for (const pattern of merchantPatterns) {
      const match = body.match(pattern);
      if (match) {
        merchant = match[1].trim();
        break;
      }
    }

    // Extract balance
    const balancePattern = /(?:balance|bal|avbl bal)[\s:]*(?:INR|Rs\.?|₹)?\s*([0-9,]+(?:\.[0-9]{2})?)/i;
    const balanceMatch = body.match(balancePattern);
    const balance = balanceMatch ? parseFloat(balanceMatch[1].replace(/,/g, '')) : undefined;

    // Extract account last 4 digits
    const accountLast4 = extractAccountLast4(body);

    return {
      amount,
      type,
      reference,
      merchant,
      balance,
      source,
      rawSender: sender,
      accountLast4,
    };
  } catch (error) {
    console.error('Error parsing notification:', error);
    return null;
  }
}

/**
 * Check for duplicate transactions in the last 5 minutes
 * Prevents false positives by checking:
 * 1. Transaction type (debit vs credit)
 * 2. Reference number (UTR) if available
 * 3. Amount and time window as fallback
 * 4. SMS source (to allow SMS + Notification for same transaction)
 */
async function checkForDuplicates(
  userId: string,
  amount: number,
  timestamp: number,
  type: 'expense' | 'income', // Changed to match DB type
  referenceNumber?: string,
  smsSource?: 'bank' | 'upi'
): Promise<any | null> {
  try {
    const fiveMinutesAgo = new Date(timestamp - 5 * 60 * 1000).toISOString();
    
    // Build the base query
    let query = supabase
      .from('transactions')
      .select('*')
      .eq('user_id', userId)
      .eq('amount', amount)
      .eq('type', type) // Must match transaction type
      .gte('created_at', fiveMinutesAgo)
      .order('created_at', { ascending: false });

    // If we have a reference number, use it for precise matching
    if (referenceNumber) {
      query = query.eq('reference_number', referenceNumber);
    }

    const { data, error } = await query.limit(1);

    if (error) {
      console.error('Error checking duplicates:', error);
      return null;
    }

    // If we found a match with reference number, check if it's from the same source
    if (data && data.length > 0) {
      const existingTxn = data[0];
      
      // If both have sms_source and they're different, this IS a duplicate
      // (e.g., Slice SMS 'bank' + Slice Notification 'upi' for the same transaction)
      // Same reference number + amount + type + time = same transaction from different sources
      if (smsSource && existingTxn.sms_source && smsSource !== existingTxn.sms_source) {
        console.log(`Different sources detected: ${smsSource} vs ${existingTxn.sms_source} - IS a duplicate (same transaction)`);
        return existingTxn; // Return as duplicate
      }
      
      return existingTxn;
    }

    // If no reference number was provided, check for duplicates without it
    // This handles cases where SMS doesn't contain UTR
    if (!referenceNumber) {
      const { data: fallbackData, error: fallbackError } = await supabase
        .from('transactions')
        .select('*')
        .eq('user_id', userId)
        .eq('amount', amount)
        .eq('type', type)
        .gte('created_at', fiveMinutesAgo)
        .is('reference_number', null) // Only match transactions without reference numbers
        .order('created_at', { ascending: false })
        .limit(1);

      if (fallbackError) {
        console.error('Error in fallback duplicate check:', fallbackError);
        return null;
      }

      if (fallbackData && fallbackData.length > 0) {
        const existingTxn = fallbackData[0];
        
        // Same source check for fallback - different sources = duplicate
        if (smsSource && existingTxn.sms_source && smsSource !== existingTxn.sms_source) {
          console.log(`Different sources detected in fallback: ${smsSource} vs ${existingTxn.sms_source} - IS a duplicate`);
          return existingTxn; // Return as duplicate
        }
        
        return existingTxn;
      }
    }

    return null;
  } catch (error) {
    console.error('Error in checkForDuplicates:', error);
    return null;
  }
}

/**
 * Get user's bank accounts
 */
async function getUserBankAccounts(userId: string): Promise<BankAccount[]> {
  try {
    const { data, error } = await supabase
      .from('bank_accounts')
      .select('id, account_last4, bank_name')
      .eq('user_id', userId);

    if (error) {
      console.error('Error fetching bank accounts:', error);
      return [];
    }

    return data || [];
  } catch (error) {
    console.error('Error in getUserBankAccounts:', error);
    return [];
  }
}

/**
 * Find bank account by last 4 digits
 */
function findBankAccountByLast4(
  accounts: BankAccount[],
  last4?: string
): BankAccount | undefined {
  if (!last4) return undefined;
  return accounts.find(acc => acc.account_last4 === last4);
}

/**
 * Check for potential self-transfer by UTR matching
 */
async function checkForTransferByUTR(
  userId: string,
  reference: string,
  currentType: 'debit' | 'credit',
  amount: number
): Promise<any | null> {
  try {
    // Map credit/debit to income/expense (DB column values)
    const oppositeType = currentType === 'debit' ? 'income' : 'expense';
    
    const { data, error } = await supabase
      .from('transactions')
      .select('*')
      .eq('user_id', userId)
      .eq('reference_number', reference)
      .eq('amount', amount)
      .eq('type', oppositeType)
      .order('created_at', { ascending: false })
      .limit(1);

    if (error) {
      console.error('Error checking transfer by UTR:', error);
      return null;
    }

    return data && data.length > 0 ? data[0] : null;
  } catch (error) {
    console.error('Error in checkForTransferByUTR:', error);
    return null;
  }
}

/**
 * Check for potential self-transfer within 3-minute window
 */
async function checkForPendingTransfer(
  userId: string,
  amount: number,
  currentType: 'debit' | 'credit',
  timestamp: number,
  userAccounts: BankAccount[]
): Promise<any | null> {
  try {
    const threeMinutesAgo = new Date(timestamp - 3 * 60 * 1000).toISOString();
    // Map credit/debit to income/expense (DB column values)
    const oppositeType = currentType === 'debit' ? 'income' : 'expense';
    
    const { data, error } = await supabase
      .from('transactions')
      .select('*')
      .eq('user_id', userId)
      .eq('amount', amount)
      .eq('type', oppositeType)
      .gte('created_at', threeMinutesAgo)
      .order('created_at', { ascending: false })
      .limit(1);

    if (error) {
      console.error('Error checking pending transfer:', error);
      return null;
    }

    if (data && data.length > 0) {
      const matchingTxn = data[0];
      
      const matchingAccountExists = userAccounts.some(
        acc => acc.account_last4 === matchingTxn.account_last4
      );
      
      if (matchingAccountExists) {
        return matchingTxn;
      }
    }

    return null;
  } catch (error) {
    console.error('Error in checkForPendingTransfer:', error);
    return null;
  }
}

/**
 * Convert two separate transactions into a single transfer
 */
async function convertToTransfer(
  debitTxn: any,
  creditTxn: any,
  fromAccountId: string,
  toAccountId: string
): Promise<boolean> {
  try {
    console.log('Converting to transfer:', { 
      debitTxn: debitTxn?.id || 'no debit txn', 
      creditTxn: creditTxn?.id || 'no credit txn' 
    });

    // Only delete the credit transaction if it exists and has a valid ID
    if (creditTxn && creditTxn.id) {
      const { error: deleteError } = await supabase
        .from('transactions')
        .delete()
        .eq('id', creditTxn.id);

      if (deleteError) {
        console.error('Error deleting credit transaction:', deleteError);
        return false;
      }
    }

    // Only update the debit transaction if it exists and has a valid ID
    if (debitTxn && debitTxn.id) {
      const { error: updateError } = await supabase
        .from('transactions')
        .update({
          type: 'transfer',
          from_account_id: fromAccountId,
          to_account_id: toAccountId,
          is_transfer_pending: false,
          note: `Transfer from ${debitTxn.account_last4 || 'account'} to ${creditTxn?.account_last4 || 'account'}`,
          category: 'transfer',
        })
        .eq('id', debitTxn.id);

      if (updateError) {
        console.error('Error updating to transfer:', updateError);
        return false;
      }

      console.log('Successfully converted to transfer');
      return true;
    }

    // If neither transaction has an ID, we can't convert
    console.log('Cannot convert to transfer: no valid transaction IDs');
    return false;
  } catch (error) {
    console.error('Error in convertToTransfer:', error);
    return false;
  }
}

/**
 * Main Notification Processor Task
 */
export default async (taskData: any) => {
  // CRITICAL: First line for debugging - confirms bridge is working
  console.log('🔔 NOTIFICATION WOKE UP:', taskData);
  console.log('Notification Processor Task Started', taskData);

  try {
    // Parse the incoming notification string
    const notif = JSON.parse(taskData.notification);
    console.log('Parsed notification object:', notif);

    // Filter: Only process allowed packages
    if (!ALLOWED_PACKAGES.includes(notif.app)) {
      console.log('Notification from non-financial app, ignoring:', notif.app);
      return;
    }

    console.log('Processing notification from allowed app:', notif.app);

    // Combine title and text into a single string
    const combinedText = `${notif.title || ''} ${notif.text || ''}`.trim();
    
    // STRICT GUARD CLAUSE FOR WHATSAPP
    // WhatsApp notifications include normal chats which can contain numbers or money-related words
    // Only process actual WhatsApp Pay notifications with strong UPI indicators
    if (notif.app === 'com.whatsapp') {
      const textLower = combinedText.toLowerCase();
      
      // WhatsApp Pay notifications MUST contain UPI-specific keywords
      // Normal chats mentioning money should be ignored
      const hasUPIReference = textLower.includes('upi ref') || 
                             textLower.includes('upi id') || 
                             textLower.includes('transaction id') ||
                             textLower.includes('utr');
      
      const hasPaymentKeyword = textLower.includes('payment') || 
                               textLower.includes('₹') || 
                               textLower.includes('rs.');
      
      // Only proceed if it has BOTH UPI reference AND payment indicators
      if (!hasUPIReference || !hasPaymentKeyword) {
        console.log('⚠️ Ignoring WhatsApp notification - not a valid payment (normal chat detected)');
        console.log('Text:', combinedText);
        return;
      }
      
      console.log('✅ WhatsApp notification passed strict validation - processing as payment');
    }
    
    // Map package name to sender ID
    const sender = PACKAGE_TO_SENDER[notif.app] || 'UNKNOWN';

    // Parse the notification using the same logic as SMS
    const parsed = parseNotification(combinedText, sender);
    
    if (!parsed) {
      console.log('Notification not recognized as financial transaction');
      console.log('Combined text was:', combinedText);
      console.log('Sender was:', sender);
      return;
    }

    console.log('✅ Parsed Transaction from Notification:', {
      amount: parsed.amount,
      type: parsed.type,
      merchant: parsed.merchant,
      source: parsed.source,
      accountLast4: parsed.accountLast4,
    });

    // Get current user session
    let userId: string | null = null;

    try {
      const { data: { session }, error } = await supabase.auth.getSession();
      
      if (session?.user?.id) {
        userId = session.user.id;
        console.log('User ID retrieved from Supabase session:', userId);
      } else if (error) {
        console.warn('Supabase session error:', error);
      } else {
        console.warn('No active Supabase session found');
      }
    } catch (error) {
      console.error('Error getting Supabase session:', error);
    }

    if (!userId) {
      try {
        const storedUserId = await AsyncStorage.getItem('app_user_id');
        if (storedUserId) {
          userId = storedUserId;
          console.log('User ID retrieved from fallback storage:', userId);
        } else {
          console.warn('No user ID in fallback storage');
        }
      } catch (error) {
        console.error('Error reading fallback user ID:', error);
      }
    }

    if (!userId) {
      console.log('No user ID found - user may not be logged in');
      return;
    }

    // Get user's bank accounts
    const userAccounts = await getUserBankAccounts(userId);
    console.log(`User has ${userAccounts.length} bank accounts`);

    const currentAccount = findBankAccountByLast4(userAccounts, parsed.accountLast4);
    
    // SELF-TRANSFER DETECTION
    
    // Method 1: Check by UTR
    if (parsed.reference && userAccounts.length > 1) {
      let matchingTxn = await checkForTransferByUTR(
        userId,
        parsed.reference,
        parsed.type,
        parsed.amount
      );

      // Quick retry logic for simultaneous notifications
      if (!matchingTxn) {
        await new Promise<void>(resolve => setTimeout(() => resolve(), 2000));
        matchingTxn = await checkForTransferByUTR(
          userId,
          parsed.reference,
          parsed.type,
          parsed.amount
        );
      }

      if (matchingTxn && matchingTxn.account_last4) {
        const matchingAccount = findBankAccountByLast4(userAccounts, matchingTxn.account_last4);
        
        if (currentAccount && matchingAccount && currentAccount.id !== matchingAccount.id) {
          console.log('Self-transfer detected by UTR!');
          
          const fromAccountId = parsed.type === 'debit' ? currentAccount.id : matchingAccount.id;
          const toAccountId = parsed.type === 'credit' ? currentAccount.id : matchingAccount.id;

          // First, reverse the balance update from the first transaction
          const firstTxnAccountId = matchingAccount.id;
          const firstTxnType = parsed.type === 'debit' ? 'credit' : 'debit';
          
          const { data: firstBankData } = await supabase
            .from('bank_accounts')
            .select('balance')
            .eq('id', firstTxnAccountId)
            .single();

          if (firstBankData) {
            // Reverse the first transaction's balance update
            const currentBal = Number(firstBankData.balance) || 0;
            const reversedBalance = firstTxnType === 'debit' 
              ? currentBal + parsed.amount 
              : currentBal - parsed.amount;
            
            await supabase
              .from('bank_accounts')
              .update({ balance: reversedBalance })
              .eq('id', firstTxnAccountId);
            console.log(`Reversed first transaction balance: ${currentBal} -> ${reversedBalance}`);
          }

          // Now apply the correct transfer balance updates
          // Debit account (from)
          const { data: fromBankData } = await supabase
            .from('bank_accounts')
            .select('balance')
            .eq('id', fromAccountId)
            .single();

          if (fromBankData) {
            const fromBalance = Number(fromBankData.balance) || 0;
            const newFromBalance = fromBalance - parsed.amount;
            await supabase
              .from('bank_accounts')
              .update({ balance: newFromBalance })
              .eq('id', fromAccountId);
            console.log(`From account balance updated: ${fromBalance} -> ${newFromBalance}`);
          }

          // Credit account (to)
          const { data: toBankData } = await supabase
            .from('bank_accounts')
            .select('balance')
            .eq('id', toAccountId)
            .single();

          if (toBankData) {
            const toBalance = Number(toBankData.balance) || 0;
            const newToBalance = toBalance + parsed.amount;
            await supabase
              .from('bank_accounts')
              .update({ balance: newToBalance })
              .eq('id', toAccountId);
            console.log(`To account balance updated: ${toBalance} -> ${newToBalance}`);
          }

          // Update the existing matching transaction to be a transfer
          const { error: updateError } = await supabase
            .from('transactions')
            .update({
              type: 'transfer',
              from_account_id: fromAccountId,
              to_account_id: toAccountId,
              is_transfer_pending: false,
              note: `Transfer from ${parsed.type === 'debit' ? parsed.accountLast4 : matchingTxn.account_last4} to ${parsed.type === 'credit' ? parsed.accountLast4 : matchingTxn.account_last4}`,
              category: 'transfer',
            })
            .eq('id', matchingTxn.id);

          if (updateError) {
            console.error('Error updating to transfer:', updateError);
          } else {
            console.log('Successfully converted to transfer by UTR');
            return;
          }
        }
      }
    }

    // Method 2: Check for pending transfer
    if (currentAccount && userAccounts.length > 1) {
      const pendingTransfer = await checkForPendingTransfer(
        userId,
        parsed.amount,
        parsed.type,
        notif.time || Date.now(),
        userAccounts
      );

      if (pendingTransfer && pendingTransfer.account_last4 !== parsed.accountLast4) {
        console.log('Matching pending transfer found!');
        
        const pendingAccount = findBankAccountByLast4(userAccounts, pendingTransfer.account_last4);
        
        if (pendingAccount && pendingAccount.id !== currentAccount.id) {
          const fromAccountId = parsed.type === 'credit' ? pendingAccount.id : currentAccount.id;
          const toAccountId = parsed.type === 'credit' ? currentAccount.id : pendingAccount.id;

          // First, reverse the balance update from the first transaction
          const firstTxnAccountId = pendingAccount.id;
          const firstTxnType = parsed.type === 'debit' ? 'credit' : 'debit';
          
          console.log(`Attempting to reverse first transaction for account ID: ${firstTxnAccountId}`);
          
          const { data: firstBankData, error: firstBankError } = await supabase
            .from('bank_accounts')
            .select('balance, bank_name, account_last4')
            .eq('id', firstTxnAccountId)
            .single();

          if (firstBankError) {
            console.error('Error fetching first bank data:', firstBankError);
          }

          if (firstBankData) {
            const currentBal = Number(firstBankData.balance) || 0;
            const reversedBalance = firstTxnType === 'debit' 
              ? currentBal + parsed.amount 
              : currentBal - parsed.amount;
            
            const { error: reverseError } = await supabase
              .from('bank_accounts')
              .update({ balance: reversedBalance })
              .eq('id', firstTxnAccountId);
            
            if (reverseError) {
              console.error('Error reversing balance:', reverseError);
            } else {
              console.log(`[${firstBankData.bank_name} ••${firstBankData.account_last4}] Reversed first transaction: ₹${currentBal} -> ₹${reversedBalance}`);
            }
          } else {
            console.log('First bank data not found');
          }

          // Now apply the correct transfer balance updates
          // Debit account (from)
          console.log(`Fetching FROM account data for ID: ${fromAccountId}`);
          
          const { data: fromBankData, error: fromBankError } = await supabase
            .from('bank_accounts')
            .select('balance, bank_name, account_last4')
            .eq('id', fromAccountId)
            .single();

          if (fromBankError) {
            console.error('Error fetching FROM bank data:', fromBankError);
          }

          if (fromBankData) {
            const fromBalance = Number(fromBankData.balance) || 0;
            const newFromBalance = fromBalance - parsed.amount;
            const { error: fromUpdateError } = await supabase
              .from('bank_accounts')
              .update({ balance: newFromBalance })
              .eq('id', fromAccountId);
            
            if (fromUpdateError) {
              console.error('Error updating FROM balance:', fromUpdateError);
            } else {
              console.log(`[${fromBankData.bank_name} ••${fromBankData.account_last4}] Transfer FROM: ₹${fromBalance} -> ₹${newFromBalance} (Debited ₹${parsed.amount})`);
            }
          } else {
            console.log('FROM bank data not found');
          }

          // Credit account (to)
          console.log(`Fetching TO account data for ID: ${toAccountId}`);
          
          const { data: toBankData, error: toBankError } = await supabase
            .from('bank_accounts')
            .select('balance, bank_name, account_last4')
            .eq('id', toAccountId)
            .single();

          if (toBankError) {
            console.error('Error fetching TO bank data:', toBankError);
          }

          if (toBankData) {
            const toBalance = Number(toBankData.balance) || 0;
            const newToBalance = toBalance + parsed.amount;
            const { error: toUpdateError } = await supabase
              .from('bank_accounts')
              .update({ balance: newToBalance })
              .eq('id', toAccountId);
            
            if (toUpdateError) {
              console.error('Error updating TO balance:', toUpdateError);
            } else {
              console.log(`[${toBankData.bank_name} ••${toBankData.account_last4}] Transfer TO: ₹${toBalance} -> ₹${newToBalance} (Credited ₹${parsed.amount})`);
            }
          } else {
            console.log('TO bank data not found');
          }

          // Update the existing pending transaction to be a transfer
          const { error: updateError } = await supabase
            .from('transactions')
            .update({
              type: 'transfer',
              from_account_id: fromAccountId,
              to_account_id: toAccountId,
              is_transfer_pending: false,
              note: `Transfer from ${parsed.type === 'credit' ? pendingTransfer.account_last4 : parsed.accountLast4} to ${parsed.type === 'credit' ? parsed.accountLast4 : pendingTransfer.account_last4}`,
              category: 'transfer',
            })
            .eq('id', pendingTransfer.id);

          if (updateError) {
            console.error('Error updating to transfer:', updateError);
          } else {
            console.log('Successfully converted pending transfer');
            return;
          }
        }
      }
    }

    // Map debit/credit to expense/income BEFORE duplicate check
    const transactionType = parsed.type === 'debit' ? 'expense' : 'income';

    // Check for duplicates
    const duplicate = await checkForDuplicates(
      userId, 
      parsed.amount, 
      notif.time || Date.now(),
      transactionType, // Use converted type for duplicate check
      parsed.reference,
      parsed.source // Pass the source to check for different sources
    );

    if (duplicate) {
      console.log('Duplicate transaction found, ignoring notification');
      return;
    }

    // Insert new transaction
    console.log('Inserting new transaction from notification');

    // transactionType already defined above before duplicate check
    const transactionCategory = parsed.type === 'debit' ? 'other' : 'income';

    const insertPayload: any = {
      user_id: userId,
      amount: parsed.amount,
      type: transactionType, // Use 'expense' or 'income' instead of 'debit' or 'credit'
      category: transactionCategory,
      note: parsed.merchant || 'Unknown',
      reference_number: parsed.reference,
      balance: parsed.balance,
      sms_source: parsed.source,
      sms_sender: parsed.rawSender,
      raw_sms: combinedText,
      account_last4: parsed.accountLast4,
      is_transfer_pending: false,
    };

    if (currentAccount) {
      insertPayload.account_id = currentAccount.id;
      
      if (parsed.type === 'debit') {
        insertPayload.from_account_id = currentAccount.id;
      } else {
        insertPayload.to_account_id = currentAccount.id;
      }
    }

    const { data: insertData, error: insertError } = await supabase
      .from('transactions')
      .insert(insertPayload)
      .select();

    if (insertError) {
      console.error('Error inserting transaction:', insertError);
    } else {
      console.log('Transaction inserted successfully from notification:', insertData);
      
      // Update bank balance
      if (currentAccount) {
        const { data: bankData, error: fetchError } = await supabase
          .from('bank_accounts')
          .select('balance, bank_name, account_last4')
          .eq('id', currentAccount.id)
          .single();

        if (bankData && !fetchError) {
          const currentBalance = Number(bankData.balance) || 0;
          const newBalance = parsed.type === 'debit' 
            ? currentBalance - parsed.amount 
            : currentBalance + parsed.amount;

          const { error: updateError } = await supabase
            .from('bank_accounts')
            .update({ balance: newBalance })
            .eq('id', currentAccount.id);

          if (updateError) {
            console.error('Failed to update bank balance:', updateError);
          } else {
            console.log(`[${bankData.bank_name} ••${bankData.account_last4}] Balance updated: ₹${currentBalance} -> ₹${newBalance} (${parsed.type === 'debit' ? 'Debited' : 'Credited'} ₹${parsed.amount})`);
          }
        }
      }
      
      // Check for retroactive transfer matching
      if (currentAccount && userAccounts.length > 1) {
        const matchingTransfer = await checkForPendingTransfer(
          userId,
          parsed.amount,
          parsed.type,
          notif.time || Date.now(),
          userAccounts
        );

        if (matchingTransfer && matchingTransfer.account_last4 !== parsed.accountLast4) {
          console.log('Found matching opposite transaction - converting to transfer retroactively');
          
          const matchingAccount = findBankAccountByLast4(userAccounts, matchingTransfer.account_last4);
          
          if (matchingAccount && matchingAccount.id !== currentAccount.id && insertData && insertData[0]) {
            const fromAccountId = parsed.type === 'credit' ? matchingAccount.id : currentAccount.id;
            const toAccountId = parsed.type === 'credit' ? currentAccount.id : matchingAccount.id;
            
            const success = await convertToTransfer(
              matchingTransfer,
              insertData[0],
              fromAccountId,
              toAccountId
            );

            if (success) {
              console.log('Successfully converted to transfer retroactively');
            }
          }
        }
      }
    }

  } catch (error) {
    console.error('Error in Notification Processor Task:', error);
  }
};
