import { supabase } from './supabase';
import AsyncStorage from '@react-native-async-storage/async-storage';

interface SmsData {
  sender: string;
  body: string;
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

// Known bank and UPI sender IDs
const BANK_SENDERS = [
  'HDFCBK', 'ICICIB', 'SBIINB', 'AXISBK', 'KOTAKB', 'PNBSMS', 
  'SCBANK', 'YESBNK', 'INDBNK', 'UNIONB'
];

const UPI_SENDERS = [
  'PAYTMB', 'GPAYID', 'PHONEPE', 'BHARTP', 'AMAZONP', 'WHATSAP',
  'MOBIKW', 'FREECHARGE', 'PAYZAPP', 'SLCEIT', 'SLICE', 'CRED'
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
 * Extract last 4 digits of account number from SMS
 */
function extractAccountLast4(body: string): string | undefined {
  const accountPatterns = [
    /A\/?C\s*[-:xX*]*\s*(\d{4})/i, // Highly permissive: catches "AC X1447", "A/C 1447", "A/c xx5235"
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
 * Parse SMS body to extract transaction details
 */
function parseSms(body: string, sender: string): ParsedTransaction | null {
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
      return null; // No valid amount found
    }

    // Determine transaction type
    // Check for "paid you" pattern first (indicates credit/income)
    const isPaidToYou = /paid\s+(?:to\s+)?you/i.test(body);
    const isCredit = isPaidToYou || /credited|received|deposited|refund|added|cr\s/i.test(body);
    const isDebit = /debited|deducted|spent|withdrawn|purchase|sent|dr\s/i.test(body) || 
                    (!isCredit && /paid/i.test(body)); // "paid" alone is debit only if not credit
    
    const type: 'debit' | 'credit' = isCredit ? 'credit' : isDebit ? 'debit' : 'debit';

    // Extract reference number (UPI Ref/UTR/Transaction ID)
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

    // Extract merchant/payee name (including UPI IDs)
    const merchantPatterns = [
      /(?:to)\s+([A-Z][A-Za-z\s&]+?)(?:\s*\(UPI Ref)/i,
      /(?:to|at|from|paid to|sent to)\s+([a-zA-Z0-9.-]+@[a-zA-Z0-9.-]+|[A-Za-z0-9\s&]+?)(?:\s+on|\s+via|[\s(]+UPI|\.|$)/i, // Improved: handles adjacent parentheses
      /(?:paid to|sent to|received from)\s+([A-Za-z0-9\s&]+?)(?:\s+on|\s+via|\.|$)/i,
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
    console.error('Error parsing SMS:', error);
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
    // Look for opposite transaction type with same UTR and amount
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
 * Searches for ANY opposite transaction (not just pending ones)
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
      
      // Verify both accounts belong to user
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
 * Update bank account balance after transaction
 */
async function updateBankBalance(
  accountId: string,
  amount: number,
  type: 'debit' | 'credit'
): Promise<boolean> {
  try {
    console.log(`Updating bank balance for account ${accountId}: ${type} ${amount}`);
    
    const { error } = await supabase.rpc('update_bank_balance', {
      p_account_id: accountId,
      p_amount: amount,
      p_transaction_type: type,
    });

    if (error) {
      console.error('Error updating bank balance:', error);
      return false;
    }

    console.log('Bank balance updated successfully');
    return true;
  } catch (error) {
    console.error('Error in updateBankBalance:', error);
    return false;
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
 * Main SMS Processor Task
 */
export default async (taskData: SmsData) => {
  console.log('SMS Processor Task Started', taskData);

  try {
    // Parse the SMS
    const parsed = parseSms(taskData.body, taskData.sender);
    
    if (!parsed) {
      console.log('SMS not recognized as financial transaction');
      return;
    }

    console.log('Parsed Transaction:', parsed);

    // Get current user session
    let userId: string | null = null;

    try {
      // Method 1: Try official Supabase session (preferred)
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

    // Method 2: Fallback to local storage (for background tasks)
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

    // Get user's bank accounts for self-transfer detection
    const userAccounts = await getUserBankAccounts(userId);
    console.log(`User has ${userAccounts.length} bank accounts`);

    // Find the account mentioned in this SMS
    const currentAccount = findBankAccountByLast4(userAccounts, parsed.accountLast4);
    
    // SELF-TRANSFER DETECTION
    
    // Method 1: Check by UTR (most reliable)
    if (parsed.reference && userAccounts.length > 1) {
      let matchingTxn = await checkForTransferByUTR(
        userId,
        parsed.reference,
        parsed.type,
        parsed.amount
      );

      // Quick retry logic for simultaneous SMS
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
          // The first transaction already updated one account's balance
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
              ? currentBal + parsed.amount  // Reverse debit by adding back
              : currentBal - parsed.amount; // Reverse credit by subtracting
            
            await supabase
              .from('bank_accounts')
              .update({ balance: reversedBalance })
              .eq('id', firstTxnAccountId);
            console.log(`[${matchingAccount.bank_name} ••${matchingAccount.account_last4}] Reversed first transaction: ₹${currentBal} -> ₹${reversedBalance}`);
          }

          // Now apply the correct transfer balance updates
          // Debit account (from)
          const { data: fromBankData } = await supabase
            .from('bank_accounts')
            .select('balance, bank_name, account_last4')
            .eq('id', fromAccountId)
            .single();

          if (fromBankData) {
            const fromBalance = Number(fromBankData.balance) || 0;
            const newFromBalance = fromBalance - parsed.amount;
            await supabase
              .from('bank_accounts')
              .update({ balance: newFromBalance })
              .eq('id', fromAccountId);
            console.log(`[${fromBankData.bank_name} ••${fromBankData.account_last4}] Transfer FROM: ₹${fromBalance} -> ₹${newFromBalance} (Debited ₹${parsed.amount})`);
          }

          // Credit account (to)
          const { data: toBankData } = await supabase
            .from('bank_accounts')
            .select('balance, bank_name, account_last4')
            .eq('id', toAccountId)
            .single();

          if (toBankData) {
            const toBalance = Number(toBankData.balance) || 0;
            const newToBalance = toBalance + parsed.amount;
            await supabase
              .from('bank_accounts')
              .update({ balance: newToBalance })
              .eq('id', toAccountId);
            console.log(`[${toBankData.bank_name} ••${toBankData.account_last4}] Transfer TO: ₹${toBalance} -> ₹${newToBalance} (Credited ₹${parsed.amount})`);
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

    // Method 2: Check for pending transfer within 3-minute window
    if (currentAccount && userAccounts.length > 1) {
      const pendingTransfer = await checkForPendingTransfer(
        userId,
        parsed.amount,
        parsed.type,
        taskData.timestamp,
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

    // Check for duplicates (existing logic)
    const duplicate = await checkForDuplicates(
      userId, 
      parsed.amount, 
      taskData.timestamp,
      transactionType, // Use converted type for duplicate check
      parsed.reference,
      parsed.source // Pass the source to check for different sources
    );

    if (duplicate) {
      console.log('Duplicate transaction found:', duplicate);

      // De-duplication logic
      if (parsed.source === 'upi' && duplicate.sms_source === 'bank') {
        console.log('Ignoring UPI SMS as Bank SMS already exists');
        return;
      }

      if (parsed.source === 'bank' && duplicate.sms_source === 'upi') {
        console.log('Updating transaction with Bank SMS data');
        
        const { error: updateError } = await supabase
          .from('transactions')
          .update({
            sms_source: 'bank',
            sms_sender: parsed.rawSender,
            reference_number: parsed.reference || duplicate.reference_number,
            balance: parsed.balance || duplicate.balance,
            merchant: parsed.merchant || duplicate.merchant,
            raw_sms: taskData.body,
            account_last4: parsed.accountLast4 || duplicate.account_last4,
          })
          .eq('id', duplicate.id);

        if (updateError) {
          console.error('Error updating transaction:', updateError);
        } else {
          console.log('Transaction updated successfully');
        }
        return;
      }

      console.log('Duplicate from same source, ignoring');
      return;
    }

    // No duplicate or transfer found -> Insert new transaction as standard expense/income
    // Always insert with is_transfer_pending: false
    
    console.log('Inserting new transaction');

    // transactionType already defined above before duplicate check

    const insertPayload: any = {
      user_id: userId,
      amount: parsed.amount,
      type: transactionType, // Use 'expense' or 'income' instead of 'debit' or 'credit'
      category: parsed.type === 'debit' ? 'other' : 'income',
      note: parsed.merchant || 'Unknown',
      reference_number: parsed.reference,
      balance: parsed.balance,
      sms_source: parsed.source,
      sms_sender: parsed.rawSender,
      raw_sms: taskData.body,
      account_last4: parsed.accountLast4,
      is_transfer_pending: false, // Always false - no ghosting
    };

    // Add account_id for UI compatibility
    if (currentAccount) {
      insertPayload.account_id = currentAccount.id;
      
      // Also set from/to account for consistency
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
      console.error('Error details:', JSON.stringify(insertError, null, 2));
    } else {
      console.log('Transaction inserted successfully:', insertData);
      
      // Update bank balance
      if (currentAccount) {
        // 1. Fetch current balance
        const { data: bankData, error: fetchError } = await supabase
          .from('bank_accounts')
          .select('balance')
          .eq('id', currentAccount.id)
          .single();

        if (bankData && !fetchError) {
          // 2. Calculate new balance
          const currentBalance = Number(bankData.balance) || 0;
          const newBalance = parsed.type === 'debit' 
            ? currentBalance - parsed.amount 
            : currentBalance + parsed.amount;

          // 3. Update the database
          const { error: updateError } = await supabase
            .from('bank_accounts')
            .update({ balance: newBalance })
            .eq('id', currentAccount.id);

          if (updateError) {
            console.error('Failed to update bank balance:', updateError);
          } else {
            console.log(`[${currentAccount.bank_name} ••${currentAccount.account_last4}] Balance updated: ₹${currentBalance} -> ₹${newBalance} (${parsed.type === 'debit' ? 'Debited' : 'Credited'} ₹${parsed.amount})`);
          }
        }
      }
      
      // After inserting, check if there's a matching opposite transaction for transfer
      if (currentAccount && userAccounts.length > 1) {
        const matchingTransfer = await checkForPendingTransfer(
          userId,
          parsed.amount,
          parsed.type,
          taskData.timestamp,
          userAccounts
        );

        if (matchingTransfer && matchingTransfer.account_last4 !== parsed.accountLast4) {
          console.log('Found matching opposite transaction - converting to transfer retroactively');
          
          const matchingAccount = findBankAccountByLast4(userAccounts, matchingTransfer.account_last4);
          
          if (matchingAccount && matchingAccount.id !== currentAccount.id && insertData && insertData[0]) {
            const fromAccountId = parsed.type === 'credit' ? matchingAccount.id : currentAccount.id;
            const toAccountId = parsed.type === 'credit' ? currentAccount.id : matchingAccount.id;
            
            // Convert the older transaction to transfer and delete the newer one
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
    console.error('Error in SMS Processor Task:', error);
  }
};
