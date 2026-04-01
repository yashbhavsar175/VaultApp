# Fix Self-Transfer Detection Issue

## Problem
Your self-transfer from Kotak (••1447) to BOB account is showing as ₹30 expense instead of being filtered out.

## Root Cause
The SMS shows:
- **Debit**: "Sent Rs.3.00 from Kotak Bank AC X1447 to **yashbhavser175@oksbi**"
- **Credit**: "Your account is credited with INR 3.00... BOB"

The app doesn't know that **yashbhavser175@oksbi** belongs to your BOB account, so it treats this as a regular expense.

## Solution: Add UPI IDs to Your Bank Accounts

### Option 1: Using Supabase Dashboard (Recommended)

1. Go to your Supabase project dashboard
2. Navigate to **Table Editor** → **bank_accounts**
3. Find your BOB account row
4. Click on the **upi_ids** column
5. Add your UPI ID: `["yashbhavser175@oksbi"]`
6. Save

If you have multiple UPI IDs for the same account:
```json
["yashbhavser175@oksbi", "yash@paytm", "yash@okaxis"]
```

### Option 2: Using SQL Editor

Run this query in Supabase SQL Editor (replace with your actual user_id):

```sql
-- First, find your user_id
SELECT id FROM auth.users WHERE email = 'your-email@example.com';

-- Update BOB account with UPI ID
UPDATE bank_accounts 
SET upi_ids = ARRAY['yashbhavser175@oksbi']
WHERE user_id = 'YOUR_USER_ID_HERE' 
AND bank_name = 'BOB';

-- Verify it was added
SELECT bank_name, account_last4, upi_ids 
FROM bank_accounts 
WHERE user_id = 'YOUR_USER_ID_HERE';
```

### Option 3: Add UI in Settings Screen

You can also add a feature in the app to manage UPI IDs:

1. Go to Settings → Manage Accounts
2. Select BOB account
3. Add UPI ID: yashbhavser175@oksbi
4. Save

(This feature needs to be implemented if not already available)

## How It Works After Fix

Once you add the UPI ID:

1. **Debit SMS arrives**: "Sent Rs.3.00 from Kotak Bank AC X1447 to yashbhavser175@oksbi"
   - App checks: Is X1447 user's account? ✅ Yes (Kotak)
   - App checks: Is yashbhavser175@oksbi user's UPI? ✅ Yes (BOB)
   - **Result**: Both belong to user → Self-Transfer detected

2. **Credit SMS arrives**: "Your account is credited with INR 3.00... BOB"
   - Confirms the transfer
   - Groups with debit SMS

3. **Final Transaction**: 
   - Type: `transfer`
   - Note: "Kotak ••1447 → BOB ••XXXX"
   - **Does NOT affect balance** ✅

## Quick Test

After adding the UPI ID:

1. Delete the existing ₹30 transaction
2. Send yourself ₹1 from Kotak to yashbhavser175@oksbi
3. Check if it's detected as self-transfer
4. Balance should remain unchanged

## All Your UPI IDs

Make sure to add ALL your UPI IDs to their respective bank accounts:

**Kotak Bank (••1447)**:
- Add any UPI IDs linked to this account

**BOB Account**:
- yashbhavser175@oksbi ← **Add this one!**

**Other accounts**:
- Add their UPI IDs too

## Why This Happens

The SMS processor looks for:
1. Account numbers (X1447, XX5235, etc.)
2. **UPI IDs** (username@bank)

If it finds 2+ of YOUR accounts/UPIs in the same transaction → Self-Transfer
If it finds only 1 → Regular expense/income

Without the UPI ID registered, the app only sees:
- Kotak X1447 (yours) → yashbhavser175@oksbi (unknown) = Expense ❌

With the UPI ID registered:
- Kotak X1447 (yours) → yashbhavser175@oksbi (yours) = Self-Transfer ✅

## Need Help?

If you're still seeing issues after adding the UPI ID:
1. Check the app logs for "Matched X user banks"
2. Verify the UPI ID is exactly: yashbhavser175@oksbi (lowercase)
3. Restart the app to clear cache
4. Test with a new ₹1 transaction
