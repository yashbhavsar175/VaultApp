# Self-Transfer Detection Setup Guide

## Current Issue
Your app is showing -₹40 because it detected 2 debit transactions from Kotak (XX1447) but didn't recognize them as self-transfers to your Slice account (XX5235).

## Steps to Fix

### 1. Create Database Tables in Supabase

Go to Supabase SQL Editor and run these files in order:

1. **supabase_user_accounts_table.sql** - For storing your bank accounts
2. **supabase_credit_cards_tables.sql** - For credit card tracking (optional)
3. **supabase_loans_tables.sql** - For loan tracking (optional)

### 2. Register Your Bank Accounts

After creating the tables, you need to register your accounts:

**Option A: Use the App (Recommended)**
1. Open the app
2. Go to Settings → Manage Accounts
3. Click "Auto-Detect from SMS" 
4. The app will scan your SMS and find:
   - XX1447 (Kotak Bank)
   - XX5235 (Slice)
5. Confirm and save

**Option B: Manual SQL Insert**
Run this in Supabase SQL Editor (replace USER_ID with your actual user ID):

```sql
-- Get your user ID first
SELECT id FROM auth.users WHERE email = 'your-email@example.com';

-- Insert your accounts (replace YOUR_USER_ID)
INSERT INTO user_accounts (user_id, account_last_digits, bank_name) VALUES
('YOUR_USER_ID', '1447', 'Kotak Bank'),
('YOUR_USER_ID', '5235', 'Slice');
```

### 3. How Self-Transfer Detection Works

Once accounts are registered:

1. **SMS arrives**: "Sent Rs.20 from Kotak Bank AC X1447"
2. **App checks**: Is 1447 in user's registered accounts? ✅ Yes
3. **SMS arrives**: "Received ₹20 via UPI in slice bank account xx5235"
4. **App checks**: Is 5235 in user's registered accounts? ✅ Yes
5. **Result**: Both accounts belong to user → Self-Transfer → Don't add to expenses

### 4. Current Behavior (Without Setup)

❌ Debit from 1447 → Added as Expense (-₹20)
❌ Debit from 1447 → Added as Expense (-₹20)
❌ Credit to 5235 → Not detected or ignored
**Result**: -₹40 (Wrong!)

### 5. Expected Behavior (After Setup)

✅ Debit from 1447 → Check: Is 1447 registered? Yes → Hold
✅ Credit to 5235 → Check: Is 5235 registered? Yes → Self-Transfer detected
✅ Show notification: "Self-Transfer Detected - Not added to expenses"
**Result**: ₹0 impact on balance (Correct!)

## Quick Test

After setup, send yourself ₹1 from Kotak to Slice:
1. App should show notification: "Self-Transfer Detected"
2. Dashboard balance should NOT change
3. Transaction should NOT appear in Recent Transactions

## Troubleshooting

**Issue**: Still showing as expense after setup
- Check if accounts are saved: Go to Settings → Manage Accounts
- Verify last 4 digits match exactly (1447, 5235)
- Check Supabase logs for errors

**Issue**: Auto-detect not finding accounts
- Grant SMS permission when prompted
- Ensure you have bank SMS in inbox
- Try manual entry instead

## Files Involved

- `src/lib/selfTransferDetection.ts` - Detection logic
- `src/lib/accountScanner.ts` - SMS scanning
- `src/screens/ManageAccounts.tsx` - Account management UI
- `src/screens/AccountDetection.tsx` - Auto-detect UI
- `src/tasks/SmsProcessorTask.ts` - SMS processing with self-transfer check

## Next Steps

1. Create the database table
2. Register your accounts (1447, 5235)
3. Delete the existing -₹40 transactions manually
4. Test with a new ₹1 transfer

The self-transfer detection will work for all future transactions once setup is complete!
