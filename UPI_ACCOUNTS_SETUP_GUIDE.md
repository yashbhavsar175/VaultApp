# UPI Accounts Setup & Self-Transfer Detection

## Overview
This feature allows users to add their UPI IDs and bank accounts to enable accurate self-transfer detection in SMS processing.

## Changes Made

### 1. Database Migration (`supabase_add_upi_accounts.sql`)
- Added `upi_accounts` JSONB column to `profiles` table
- Stores array of UPI account objects: `[{bankName, upiId, accountLast4}]`

**Run this SQL in Supabase SQL Editor:**
```sql
ALTER TABLE profiles 
ADD COLUMN IF NOT EXISTS upi_accounts jsonb DEFAULT '[]';
```

### 2. ProfileScreen.tsx Updates
- Added "My UPI IDs & Banks" section
- Users can add up to 10 UPI accounts
- Each account has:
  - Bank Name (e.g., "Slice", "Kotak")
  - UPI ID (e.g., "yashbhavsar175-3@okaxis")
  - Account Last 4 Digits (e.g., "5235")
- Saves to Supabase and caches in AsyncStorage

### 3. SmsProcessorTask.ts Enhancements
- New `loadUserUpiAccounts()` - Loads cached UPI accounts
- New `findMatchingUpiAccount()` - Matches SMS content with user's accounts
- New `detectSelfTransferWithAccounts()` - Detects self-transfers using stored accounts
- Generates smart notes: "Slice ••5235 → Kotak ••1447"

### 4. Self-Transfer Detection Logic
**How it works:**
1. SMS arrives with transaction
2. Load user's UPI accounts from AsyncStorage cache
3. Check if SMS contains any of user's UPI IDs or account numbers
4. If match found → it's a self-transfer
5. Extract source and destination banks
6. Generate formatted note with bank names and account numbers

**Note Formats:**
- Both banks found: `"Slice ••5235 → Kotak ••1447"`
- Only source: `"Transfer from Slice ••5235"`
- Only destination: `"Transfer to Kotak ••1447"`
- Fallback: `"Self Transfer ₹500"`

### 5. Dashboard & Transactions Display
- Transfer type shows with orange color (#f97316)
- Icon: `swap-horizontal`
- Amount prefix: `↔` (instead of + or -)
- Transfers excluded from net balance calculation

### 6. LoginScreen.tsx Updates
- Loads and caches UPI accounts on login
- Stores in AsyncStorage for headless task access

## User Flow

1. **Setup (One-time)**
   - User goes to Profile screen
   - Adds their bank accounts with UPI IDs
   - Saves profile

2. **SMS Processing**
   - SMS arrives: "Rs.500 debited from Slice A/c XX5235"
   - Task loads cached UPI accounts
   - Finds match: Slice account with last 4 digits 5235
   - Marks as self-transfer
   - Saves single transaction with type='transfer'

3. **Dashboard Display**
   - Shows: "Slice ••5235 → Kotak ••1447"
   - Orange color, swap icon
   - Not counted in income/expense totals

## Benefits

1. **Accurate Detection** - Uses user's actual account data
2. **Clean Notes** - Shows bank names and account numbers
3. **No Duplicates** - Single entry for self-transfers
4. **Fast Processing** - Uses AsyncStorage cache (no Supabase delay)
5. **User Control** - Users manage their own account list

## Testing

1. Add your UPI accounts in Profile screen
2. Use the 5-tap test on Dashboard "Net Balance"
3. Or send real SMS between your accounts
4. Check that transfer shows with proper note format

## Migration Steps

1. Run SQL migration in Supabase
2. Rebuild app
3. Login again (to cache UPI accounts)
4. Go to Profile → Add UPI accounts
5. Test with real or fake SMS
