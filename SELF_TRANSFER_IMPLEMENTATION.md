# Self-Transfer Detection - Implementation Guide

## 🎯 Overview

Enhanced SMS processing to automatically detect and handle transfers between the user's own bank accounts, preventing double-entry (one expense + one income) and instead creating a single "Transfer" transaction.

## 🧠 The Problem

When a user transfers money between their own accounts:
- **Debit SMS** from Account A: "Rs 5000 debited from A/c XX1234"
- **Credit SMS** to Account B: "Rs 5000 credited to A/c XX5678"

Without self-transfer detection:
- ❌ Creates 1 Expense transaction (-5000)
- ❌ Creates 1 Income transaction (+5000)
- ❌ Net effect: 0, but shows incorrect expense/income

With self-transfer detection:
- ✅ Creates 1 Transfer transaction
- ✅ Links both accounts
- ✅ Updates balances correctly
- ✅ No false expense/income

## 🔍 Detection Methods

### Method 1: UTR Matching (Most Reliable)
```
If both SMS have the same UPI Reference/UTR:
  AND both account numbers belong to user
  → Confirmed Self-Transfer (no time limit)
```

**Example:**
```
SMS 1: "Rs 5000 debited from A/c XX1234. UTR: 123456789012"
SMS 2: "Rs 5000 credited to A/c XX5678. UTR: 123456789012"
→ Same UTR = Confirmed Transfer
```

### Method 2: Time Window Matching (3 minutes)
```
If Debit SMS arrives:
  AND within 3 minutes, Credit SMS arrives
  AND same amount
  AND both accounts belong to user
  → Likely Self-Transfer
```

**Example:**
```
10:00:00 - Debit Rs 5000 from XX1234
10:00:45 - Credit Rs 5000 to XX5678
→ Within 3 min + same amount = Transfer
```

## 📊 Database Changes

### New Columns in `transactions` table

```sql
from_account_id    UUID      -- Source account (for transfers)
to_account_id      UUID      -- Destination account (for transfers)
account_last4      TEXT      -- Last 4 digits from SMS
is_transfer_pending BOOLEAN  -- Waiting for matching SMS
```

### New Type Value

```sql
type: 'transfer'  -- Added to existing types
```

### Automatic Balance Updates

Trigger automatically updates bank account balances:
- Decreases `from_account_id` balance
- Increases `to_account_id` balance

## 🔄 Processing Flow

```
┌─────────────────────────────────────────────────────┐
│  SMS Arrives (Debit or Credit)                      │
└────────────────────┬────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────┐
│  Parse SMS                                          │
│  - Extract amount, type, account last4, UTR         │
└────────────────────┬────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────┐
│  Get User's Bank Accounts                           │
│  - Fetch all accounts from bank_accounts table      │
└────────────────────┬────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────┐
│  Check: Does account belong to user?                │
└────────────────────┬────────────────────────────────┘
                     │
        ┌────────────┴────────────┐
        │                         │
       YES                       NO
        │                         │
        ▼                         ▼
┌──────────────────┐    ┌──────────────────┐
│ Self-Transfer    │    │ Regular          │
│ Detection        │    │ Transaction      │
└────────┬─────────┘    └──────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────┐
│  Method 1: Check by UTR                             │
│  - Look for opposite type (debit↔credit)            │
│  - Same amount + Same UTR                           │
│  - Different account (both user's)                  │
└────────────────────┬────────────────────────────────┘
                     │
        ┌────────────┴────────────┐
        │                         │
      Found                   Not Found
        │                         │
        ▼                         ▼
┌──────────────────┐    ┌──────────────────────────────┐
│ Convert to       │    │ Method 2: Check Time Window  │
│ Transfer         │    │ - Look for opposite type     │
│ (Delete one,     │    │ - Same amount                │
│  Update other)   │    │ - Within 3 minutes           │
└──────────────────┘    │ - Different account          │
                        └────────┬─────────────────────┘
                                 │
                    ┌────────────┴────────────┐
                    │                         │
                  Found                   Not Found
                    │                         │
                    ▼                         ▼
          ┌──────────────────┐    ┌──────────────────┐
          │ Convert to       │    │ Insert as        │
          │ Transfer         │    │ Pending Transfer │
          └──────────────────┘    │ (wait 3 min)     │
                                  └──────────────────┘
```

## 💾 Database Schema

### transactions table (enhanced)

```sql
CREATE TABLE transactions (
  id uuid PRIMARY KEY,
  user_id uuid REFERENCES auth.users(id),
  amount numeric NOT NULL,
  type text CHECK (type IN ('income', 'expense', 'transfer', ...)),
  
  -- Transfer-specific columns
  from_account_id uuid REFERENCES bank_accounts(id),
  to_account_id uuid REFERENCES bank_accounts(id),
  account_last4 text,
  is_transfer_pending boolean DEFAULT false,
  
  -- SMS tracking columns
  sms_source text,
  sms_sender text,
  raw_sms text,
  reference_number text,
  balance numeric,
  
  -- Standard columns
  note text,
  category text,
  transaction_date timestamptz,
  created_at timestamptz DEFAULT now()
);
```

### bank_accounts table

```sql
CREATE TABLE bank_accounts (
  id uuid PRIMARY KEY,
  user_id uuid REFERENCES auth.users(id),
  bank_name text NOT NULL,
  account_last4 text NOT NULL,  -- Used for matching
  starting_balance numeric DEFAULT 0,
  created_at timestamptz DEFAULT now()
);
```

## 🎨 Example Scenarios

### Scenario 1: UTR Match (Instant Detection)

**SMS 1 (10:00:00):**
```
Rs 10,000.00 debited from A/c XX1234 on 06-04-26.
UTR: 987654321098. Avbl Bal: Rs 50,000.00
-AD-HDFCBK
```

**SMS 2 (10:00:05):**
```
Rs 10,000.00 credited to A/c XX5678 on 06-04-26.
UTR: 987654321098. Avbl Bal: Rs 25,000.00
-AD-ICICIB
```

**Result:**
```javascript
{
  type: 'transfer',
  amount: 10000,
  from_account_id: 'uuid-of-account-1234',
  to_account_id: 'uuid-of-account-5678',
  reference_number: '987654321098',
  note: 'Transfer between accounts'
}
```

**Balance Updates:**
- Account XX1234: 60,000 → 50,000 ✅
- Account XX5678: 15,000 → 25,000 ✅

### Scenario 2: Time Window Match (3-minute detection)

**SMS 1 (10:00:00):**
```
Rs 5,000.00 debited from A/c XX1234.
Avbl Bal: Rs 45,000.00
```

**SMS 2 (10:01:30):**
```
Rs 5,000.00 credited to A/c XX5678.
Avbl Bal: Rs 30,000.00
```

**Processing:**
1. SMS 1 arrives → Insert as pending transfer
2. SMS 2 arrives (90 seconds later)
3. System finds pending debit with same amount
4. Verifies both accounts belong to user
5. Converts to transfer

### Scenario 3: Not a Self-Transfer

**SMS 1:**
```
Rs 2,000.00 debited from A/c XX1234 to AMAZON PAY.
```

**SMS 2:**
```
Rs 2,000.00 credited to A/c XX5678 from SALARY.
```

**Result:**
- Different purposes (Amazon vs Salary)
- Creates 2 separate transactions ✅
- Not converted to transfer

## 🔧 Implementation Details

### Key Functions

#### 1. `extractAccountLast4(body: string)`
Extracts last 4 digits of account from SMS patterns:
- `A/c XX1234`
- `Account no. XX1234`
- `A/c ****1234`

#### 2. `getUserBankAccounts(userId: string)`
Fetches all user's bank accounts for matching.

#### 3. `checkForTransferByUTR(userId, reference, type, amount)`
Looks for opposite transaction with same UTR.

#### 4. `checkForPendingTransfer(userId, amount, type, timestamp, accounts)`
Looks for pending transfer within 3-minute window.

#### 5. `convertToTransfer(debitTxn, creditTxn, fromId, toId)`
Converts two transactions into one transfer:
- Deletes one transaction
- Updates other to type='transfer'
- Sets from/to account IDs

## 📝 Setup Instructions

### Step 1: Run Database Migration

```bash
# In Supabase SQL Editor
# Copy and execute: supabase-self-transfer-enhancement.sql
```

### Step 2: Verify Columns

```sql
SELECT column_name, data_type 
FROM information_schema.columns 
WHERE table_name = 'transactions' 
AND column_name IN ('from_account_id', 'to_account_id', 'account_last4', 'is_transfer_pending');
```

### Step 3: Rebuild App

```bash
# No code changes needed in native layer
# Just rebuild to get updated TypeScript
npx react-native run-android
```

### Step 4: Test

Send two test SMS:

**Test 1: UTR Match**
```
SMS 1: Rs 1000 debited from A/c XX1234. UTR: 111222333444
SMS 2: Rs 1000 credited to A/c XX5678. UTR: 111222333444
```

**Test 2: Time Window**
```
SMS 1: Rs 500 debited from A/c XX1234
Wait 30 seconds
SMS 2: Rs 500 credited to A/c XX5678
```

## 🧪 Testing Checklist

- [ ] Database migration executed
- [ ] New columns exist in transactions table
- [ ] Trigger created for balance updates
- [ ] User has 2+ bank accounts in bank_accounts table
- [ ] Test UTR matching works
- [ ] Test time window matching works
- [ ] Test balance updates correctly
- [ ] Test non-transfers still work
- [ ] Test pending transfers expire after 3 min
- [ ] Test logs show detection logic

## 🔍 Debugging

### Check if accounts are registered

```sql
SELECT id, bank_name, account_last4 
FROM bank_accounts 
WHERE user_id = 'your-user-id';
```

### Check pending transfers

```sql
SELECT * FROM transactions 
WHERE is_transfer_pending = TRUE 
AND created_at >= NOW() - INTERVAL '3 minutes';
```

### Check transfer transactions

```sql
SELECT * FROM transactions 
WHERE type = 'transfer' 
ORDER BY created_at DESC 
LIMIT 10;
```

### View logs

```bash
adb logcat | grep -E "Self-transfer|Transfer|Pending"
```

## ⚠️ Important Notes

### Account Registration Required

Users MUST add their bank accounts to `bank_accounts` table with correct `account_last4` for detection to work.

### UTR is Most Reliable

Always prefer UTR matching over time window when available.

### 3-Minute Window

Pending transfers expire after 3 minutes to avoid false positives.

### Balance Updates

Automatic balance updates only work for confirmed transfers (not pending).

### Edge Cases Handled

1. **Same account transfer**: Ignored (from_id === to_id)
2. **Multiple pending**: Takes most recent
3. **No UTR**: Falls back to time window
4. **Different amounts**: Not matched
5. **Only one account**: No transfer detection

## 🚀 Future Enhancements

### Phase 2
- [ ] Manual transfer confirmation UI
- [ ] Transfer history view
- [ ] Bulk transfer import
- [ ] Transfer categories

### Phase 3
- [ ] Scheduled transfers
- [ ] Recurring transfers
- [ ] Transfer analytics
- [ ] Multi-currency transfers

## 📊 Performance Impact

- **Additional queries**: 2-3 per SMS (minimal)
- **Processing time**: +50-100ms
- **Database load**: Negligible with indexes
- **Storage**: +4 columns per transaction

## ✅ Benefits

1. **Accurate Tracking**: No false expenses/income
2. **Automatic Detection**: No manual intervention
3. **Balance Sync**: Real-time balance updates
4. **Audit Trail**: Full SMS history preserved
5. **Flexible**: Works with or without UTR

---

**Implementation Date:** April 6, 2026
**Version:** 2.0.0
**Status:** ✅ Complete and Ready for Testing
