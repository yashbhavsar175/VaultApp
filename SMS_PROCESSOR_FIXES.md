# SMS Processor Fixes - Complete Implementation

## Issues Fixed

### Issue 1: Pending Transfer Ghosting ✅
**Problem:** All transactions were flagged as `is_transfer_pending: true` when user had multiple accounts, causing them to not appear in the ledger.

**Solution:**
- Removed `isPotentialTransfer` logic completely
- All new SMS transactions now insert with `is_transfer_pending: false`
- Transactions hit the ledger immediately as normal expense/income
- Updated `checkForPendingTransfer()` to search for ANY opposite transaction (removed `.eq('is_transfer_pending', true)` filter)
- After inserting a transaction, the system retroactively checks for matching opposite transactions in the last 3 minutes
- If a match is found, it converts both standard transactions into a single transfer

### Issue 2: Bank Balances Not Updating ✅
**Problem:** Background task inserted transactions but didn't adjust bank account balances.

**Solution:**
- Created new `updateBankBalance()` function that calls Supabase RPC
- After successful transaction insert, automatically updates the bank account balance
- Debit transactions subtract from balance
- Credit transactions add to balance
- Uses atomic RPC function to prevent race conditions

### Issue 3: UI Schema Mapping ✅
**Problem:** History tab missing details because it expected `account_id` field.

**Solution:**
- Added `account_id` field to transaction insert payload
- Set `account_id: currentAccount.id` for all transactions
- Also maintains `from_account_id` and `to_account_id` for consistency
- Created migration to add `account_id` column if it doesn't exist

## Files Modified

### 1. `src/lib/SmsProcessorTask.ts`
- Added `updateBankBalance()` function
- Modified `checkForPendingTransfer()` to search all transactions (not just pending)
- Removed `isPotentialTransfer` logic
- Always insert with `is_transfer_pending: false`
- Added `account_id` to insert payload
- Added retroactive transfer detection after insert
- Automatic bank balance update after successful insert

### 2. `supabase-bank-balance-update.sql` (NEW)
- RPC function `update_bank_balance()`
- Handles both debit and credit transactions
- Atomic operation to prevent race conditions
- Proper error handling and validation

### 3. `supabase-add-account-id.sql` (NEW)
- Adds `account_id` column to transactions table
- Creates index for performance
- Backfills existing transactions

## Database Setup Instructions

Run these SQL scripts in your Supabase SQL Editor in this order:

1. **Add account_id column:**
   ```sql
   -- Run supabase-add-account-id.sql
   ```

2. **Create balance update function:**
   ```sql
   -- Run supabase-bank-balance-update.sql
   ```

3. **Verify setup:**
   ```sql
   -- Check if account_id column exists
   SELECT column_name, data_type 
   FROM information_schema.columns 
   WHERE table_name = 'transactions' 
   AND column_name = 'account_id';

   -- Check if RPC function exists
   SELECT routine_name 
   FROM information_schema.routines 
   WHERE routine_name = 'update_bank_balance';
   ```

## How It Works Now

### Normal Transaction Flow:
1. SMS arrives → Parsed → Inserted as standard expense/income
2. `is_transfer_pending: false` (always)
3. Transaction appears in ledger immediately
4. Bank balance updated automatically
5. System checks for matching opposite transaction in last 3 minutes
6. If match found → Retroactively converts both to transfer

### Transfer Detection:
1. **Method 1 (UTR Matching):** If same UTR found with opposite type → Transfer
2. **Method 2 (Time Window):** After insert, check for opposite transaction within 3 minutes
3. **Conversion:** Delete newer transaction, update older one to type='transfer'

### Balance Updates:
- Debit: `balance = balance - amount`
- Credit: `balance = balance + amount`
- Transfer: Handled by existing trigger (no double-counting)

## Testing Checklist

- [ ] Run all SQL migrations in Supabase
- [ ] Rebuild and reinstall the app
- [ ] Send a test SMS (single transaction)
- [ ] Verify transaction appears in history immediately
- [ ] Verify bank balance updated correctly
- [ ] Send two SMS for transfer (debit then credit within 3 min)
- [ ] Verify they convert to single transfer
- [ ] Verify no duplicate balance adjustments

## Benefits

1. **No Ghosting:** All transactions visible immediately
2. **Accurate Balances:** Bank accounts stay in sync with reality
3. **Smart Transfers:** Automatic detection and conversion
4. **UI Compatible:** Works with existing history/analytics screens
5. **Race-Safe:** Atomic RPC prevents concurrent update issues
