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
    const isDebit = /debited|deducted|paid|spent|withdrawn|purchase|sent|dr\s/i.test(body);
    const isCredit = /credited|received|deposited|refund|added|cr\s/i.test(body);
    
    const type: 'debit' | 'credit' = isDebit ? 'debit' : isCredit ? 'credit' : 'debit';

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
 */
async function checkForDuplicates(
  userId: string,
  amount: number,
  timestamp: number
): Promise<any | null> {
  try {
    const fiveMinutesAgo = new Date(timestamp - 5 * 60 * 1000).toISOString();
    
    const { data, error } = await supabase
      .from('transactions')
      .select('*')
      .eq('user_id', userId)
      .eq('amount', amount)
      .gte('created_at', fiveMinutesAgo)
      .order('created_at', { ascending: false })
      .limit(1);

    if (error) {
      console.error('Error checking duplicates:', error);
      return null;
    }

    return data && data.length > 0 ? data[0] : null;
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
    const oppositeType = currentType === 'debit' ? 'credit' : 'debit';
    
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
    const oppositeType = currentType === 'debit' ? 'credit' : 'debit';
    
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
    console.log('Converting to transfer:', { debitTxn: debitTxn.id, creditTxn: creditTxn.id });

    // Delete the credit transaction (we'll keep the debit one as transfer)
    const { error: deleteError } = await supabase
      .from('transactions')
      .delete()
      .eq('id', creditTxn.id);

    if (deleteError) {
      console.error('Error deleting credit transaction:', deleteError);
      return false;
    }

    // Update the debit transaction to be a transfer
    const { error: updateError } = await supabase
      .from('transactions')
      .update({
        type: 'transfer',
        from_account_id: fromAccountId,
        to_account_id: toAccountId,
        is_transfer_pending: false,
        note: `Transfer from ${debitTxn.account_last4 || 'account'} to ${creditTxn.account_last4 || 'account'}`,
        category: 'transfer',
      })
      .eq('id', debitTxn.id);

    if (updateError) {
      console.error('Error updating to transfer:', updateError);
      return false;
    }

    console.log('Successfully converted to transfer');
    return true;
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
          
          // Determine which is debit and which is credit
          const debitTxn = parsed.type === 'debit' ? 
            { ...parsed, id: null, account_last4: parsed.accountLast4 } : 
            matchingTxn;
          const creditTxn = parsed.type === 'credit' ? 
            { ...parsed, id: null, account_last4: parsed.accountLast4 } : 
            matchingTxn;
          
          const fromAccountId = parsed.type === 'debit' ? currentAccount.id : matchingAccount.id;
          const toAccountId = parsed.type === 'credit' ? currentAccount.id : matchingAccount.id;

          if (matchingTxn.id) {
            // Update existing transaction to transfer
            const success = await convertToTransfer(
              matchingTxn,
              { id: null, account_last4: parsed.accountLast4 },
              fromAccountId,
              toAccountId
            );

            if (success) {
              console.log('Successfully converted to transfer by UTR');
              return;
            }
          } else {
            // Create new transfer transaction
            const { error: insertError } = await supabase
              .from('transactions')
              .insert({
                user_id: userId,
                amount: parsed.amount,
                type: 'transfer',
                from_account_id: fromAccountId,
                to_account_id: toAccountId,
                account_last4: parsed.accountLast4,
                note: `Transfer between accounts`,
                category: 'transfer',
                reference_number: parsed.reference,
                balance: parsed.balance,
                sms_source: parsed.source,
                sms_sender: parsed.rawSender,
                raw_sms: taskData.body,
                transaction_date: new Date(taskData.timestamp).toISOString(),
                created_at: new Date().toISOString(),
                is_transfer_pending: false,
              });

            if (insertError) {
              console.error('Error inserting transfer:', insertError);
            } else {
              console.log('Transfer transaction created by UTR');
              return;
            }
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
          
          const debitTxn = parsed.type === 'debit' ? 
            { ...parsed, id: null } : 
            pendingTransfer;
          const creditTxn = parsed.type === 'credit' ? 
            { ...parsed, id: null } : 
            pendingTransfer;

          const success = await convertToTransfer(
            pendingTransfer,
            { id: null, account_last4: parsed.accountLast4 },
            fromAccountId,
            toAccountId
          );

          if (success) {
            console.log('Successfully converted pending transfer');
            return;
          }
        }
      }
    }

    // Check for duplicates (existing logic)
    const duplicate = await checkForDuplicates(userId, parsed.amount, taskData.timestamp);

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

    const insertPayload: any = {
      user_id: userId,
      amount: parsed.amount,
      type: parsed.type,
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
            console.log(`Bank balance updated successfully to ${newBalance}`);
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
