# SMS Processing Architecture - Visual Guide

## 🏗️ System Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         USER'S PHONE                            │
│                                                                 │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │                    SMS Arrives                           │  │
│  │  "Rs 500 debited from A/c XX1234 to AMAZON PAY"         │  │
│  └────────────────────────┬─────────────────────────────────┘  │
│                           │                                     │
│                           ▼                                     │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │         NATIVE ANDROID LAYER (Kotlin)                    │  │
│  │                                                           │  │
│  │  ┌─────────────────────────────────────────────────┐    │  │
│  │  │  SmsReceiver.kt                                 │    │  │
│  │  │  - BroadcastReceiver                            │    │  │
│  │  │  - Listens for SMS_RECEIVED_ACTION              │    │  │
│  │  │  - Extracts: sender, body, timestamp            │    │  │
│  │  └──────────────────┬──────────────────────────────┘    │  │
│  │                     │                                     │  │
│  │                     ▼                                     │  │
│  │  ┌─────────────────────────────────────────────────┐    │  │
│  │  │  SmsProcessorService.kt                         │    │  │
│  │  │  - HeadlessJsTaskService                        │    │  │
│  │  │  - Bridges Native → JavaScript                  │    │  │
│  │  │  - Starts "SmsProcessorTask"                    │    │  │
│  │  └──────────────────┬──────────────────────────────┘    │  │
│  └────────────────────────┼─────────────────────────────────┘  │
│                           │                                     │
│                           ▼                                     │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │         JAVASCRIPT LAYER (React Native)                  │  │
│  │                                                           │  │
│  │  ┌─────────────────────────────────────────────────┐    │  │
│  │  │  SmsProcessorTask.ts                            │    │  │
│  │  │                                                  │    │  │
│  │  │  Step 1: Parse SMS                              │    │  │
│  │  │  ├─ Extract amount (Rs/INR/₹)                   │    │  │
│  │  │  ├─ Detect type (debit/credit)                  │    │  │
│  │  │  ├─ Find merchant name                          │    │  │
│  │  │  ├─ Extract reference (UPI Ref/UTR)             │    │  │
│  │  │  └─ Get balance                                 │    │  │
│  │  │                                                  │    │  │
│  │  │  Step 2: Identify Source                        │    │  │
│  │  │  ├─ Check if Bank SMS (HDFCBK, ICICIB, etc)    │    │  │
│  │  │  └─ Check if UPI SMS (PAYTMB, GPAYID, etc)     │    │  │
│  │  │                                                  │    │  │
│  │  │  Step 3: Check for Duplicates                   │    │  │
│  │  │  ├─ Query last 5 minutes                        │    │  │
│  │  │  ├─ Match: user_id + amount                     │    │  │
│  │  │  └─ Return existing transaction if found        │    │  │
│  │  │                                                  │    │  │
│  │  │  Step 4: Apply De-duplication Rules             │    │  │
│  │  │  ├─ UPI after Bank? → IGNORE                    │    │  │
│  │  │  ├─ Bank after UPI? → UPDATE                    │    │  │
│  │  │  ├─ Same source? → IGNORE                       │    │  │
│  │  │  └─ No duplicate? → INSERT                      │    │  │
│  │  │                                                  │    │  │
│  │  │  Step 5: Save to Database                       │    │  │
│  │  │  └─ Insert/Update Supabase                      │    │  │
│  │  └──────────────────┬──────────────────────────────┘    │  │
│  └────────────────────────┼─────────────────────────────────┘  │
└───────────────────────────┼───────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│                      SUPABASE CLOUD                             │
│                                                                 │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │  transactions table                                      │  │
│  │  ┌────────────────────────────────────────────────────┐ │  │
│  │  │ id, user_id, amount, type, merchant                │ │  │
│  │  │ sms_source, sms_sender, raw_sms                    │ │  │
│  │  │ reference_number, balance, created_at              │ │  │
│  │  └────────────────────────────────────────────────────┘ │  │
│  └──────────────────────────────────────────────────────────┘  │
│                           │                                     │
│                           ▼                                     │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │  Real-time Sync                                          │  │
│  └──────────────────────────────────────────────────────────┘  │
└───────────────────────────┬───────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│                    SPENDSENSE APP UI                            │
│                                                                 │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │  Dashboard Screen                                        │  │
│  │  ✅ New transaction appears automatically                │  │
│  │  ✅ No manual entry needed                               │  │
│  │  ✅ Real-time updates                                    │  │
│  └──────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

## 🔄 De-duplication Flow

```
                    SMS Arrives
                         │
                         ▼
              ┌──────────────────────┐
              │  Parse SMS Details   │
              │  - Amount: Rs 500    │
              │  - Type: Debit       │
              │  - Source: Bank/UPI  │
              └──────────┬───────────┘
                         │
                         ▼
              ┌──────────────────────┐
              │ Query Database       │
              │ Last 5 minutes       │
              │ Same amount?         │
              └──────────┬───────────┘
                         │
            ┌────────────┴────────────┐
            │                         │
         Found                    Not Found
            │                         │
            ▼                         ▼
    ┌───────────────┐         ┌──────────────┐
    │  Duplicate!   │         │  New Trans   │
    └───────┬───────┘         │  INSERT      │
            │                 └──────────────┘
            │
    ┌───────┴────────┐
    │                │
  UPI SMS        Bank SMS
    │                │
    ▼                ▼
┌─────────┐    ┌──────────┐
│ Existing│    │ Existing │
│ = Bank? │    │ = UPI?   │
└────┬────┘    └────┬─────┘
     │              │
    YES            YES
     │              │
     ▼              ▼
┌─────────┐    ┌──────────┐
│ IGNORE  │    │ UPDATE   │
│ UPI SMS │    │ with Bank│
└─────────┘    └──────────┘
```

## 📱 User Experience Flow

```
┌─────────────────────────────────────────────────────────────┐
│  Step 1: User Makes Purchase                                │
│  💳 Swipes card at Amazon Pay                               │
└────────────────────────┬────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────┐
│  Step 2: Bank Processes Transaction                         │
│  🏦 HDFC Bank debits Rs 500                                 │
└────────────────────────┬────────────────────────────────────┘
                         │
            ┌────────────┴────────────┐
            │                         │
            ▼                         ▼
┌──────────────────────┐    ┌──────────────────────┐
│  Bank SMS            │    │  UPI App SMS         │
│  From: AD-HDFCBK     │    │  From: VK-PAYTMB     │
│  Time: 10:00:00      │    │  Time: 10:00:02      │
└──────────┬───────────┘    └──────────┬───────────┘
           │                           │
           ▼                           ▼
┌──────────────────────┐    ┌──────────────────────┐
│  Process Bank SMS    │    │  Process UPI SMS     │
│  ✅ INSERT           │    │  ⚠️  Check duplicate │
│  Transaction #1      │    │  ❌ IGNORE (Bank     │
│                      │    │     already exists)  │
└──────────┬───────────┘    └──────────────────────┘
           │
           ▼
┌─────────────────────────────────────────────────────────────┐
│  Step 3: User Opens App                                     │
│  📱 Dashboard shows 1 transaction (not 2!)                  │
│  ✅ Rs 500 to Amazon Pay                                    │
│  ✅ Reference: 123456789012                                 │
│  ✅ Balance: Rs 10,000                                      │
└─────────────────────────────────────────────────────────────┘
```

## 🎯 Data Flow Diagram

```
┌─────────────┐
│   SMS       │
│  "Rs 500    │
│  debited"   │
└──────┬──────┘
       │
       ▼
┌─────────────────────────────────────────────────────────┐
│  PARSING ENGINE                                         │
│                                                         │
│  Input: "Rs 500.00 debited from A/c XX1234 to AMAZON"  │
│                                                         │
│  Regex Patterns:                                        │
│  ├─ Amount: /Rs\.?\s*([0-9,]+\.[0-9]{2})/             │
│  ├─ Type: /(debited|credited)/                         │
│  ├─ Merchant: /to\s+([A-Z][A-Za-z\s]+)/               │
│  └─ Reference: /UPI Ref:\s*([A-Z0-9]+)/               │
│                                                         │
│  Output:                                                │
│  {                                                      │
│    amount: 500.00,                                      │
│    type: 'debit',                                       │
│    merchant: 'AMAZON',                                  │
│    reference: '123456789012',                           │
│    source: 'bank'                                       │
│  }                                                      │
└────────────────────────┬────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────┐
│  DUPLICATE DETECTION ENGINE                             │
│                                                         │
│  Query:                                                 │
│  SELECT * FROM transactions                             │
│  WHERE user_id = $1                                     │
│    AND amount = $2                                      │
│    AND created_at >= NOW() - INTERVAL '5 minutes'       │
│  LIMIT 1;                                               │
│                                                         │
│  Result: Found existing transaction                     │
│  {                                                      │
│    id: 'abc-123',                                       │
│    amount: 500.00,                                      │
│    sms_source: 'upi',                                   │
│    created_at: '2026-04-06 10:00:00'                    │
│  }                                                      │
└────────────────────────┬────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────┐
│  DECISION ENGINE                                        │
│                                                         │
│  IF new.source === 'bank' AND existing.source === 'upi'│
│  THEN:                                                  │
│    UPDATE transactions                                  │
│    SET sms_source = 'bank',                             │
│        sms_sender = 'AD-HDFCBK',                        │
│        reference_number = '123456789012',               │
│        balance = 10000.00                               │
│    WHERE id = 'abc-123';                                │
│                                                         │
│  Result: ✅ Transaction updated with Bank data          │
└─────────────────────────────────────────────────────────┘
```

## 🔐 Permission Flow

```
┌─────────────────────────────────────────────────────────┐
│  User Opens Settings                                    │
└────────────────────┬────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────┐
│  Toggles "SMS Tracking" ON                              │
└────────────────────┬────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────┐
│  requestSmsPermissions()                                │
│  ├─ RECEIVE_SMS                                         │
│  └─ READ_SMS                                            │
└────────────────────┬────────────────────────────────────┘
                     │
        ┌────────────┴────────────┐
        │                         │
     Granted                  Denied
        │                         │
        ▼                         ▼
┌──────────────┐         ┌──────────────┐
│ ✅ Enabled   │         │ ❌ Show      │
│ Start        │         │ Error Toast  │
│ Listening    │         └──────────────┘
└──────────────┘
```

## 📊 Database Schema Visualization

```
┌─────────────────────────────────────────────────────────────┐
│  transactions table                                         │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  Existing Columns:                                          │
│  ├─ id              UUID PRIMARY KEY                        │
│  ├─ user_id         UUID REFERENCES users(id)               │
│  ├─ amount          DECIMAL(10,2)                           │
│  ├─ type            TEXT (debit/credit)                     │
│  ├─ category        TEXT                                    │
│  ├─ merchant        TEXT                                    │
│  ├─ created_at      TIMESTAMP                               │
│  └─ ...                                                     │
│                                                             │
│  NEW SMS Columns:                                           │
│  ├─ sms_source      TEXT ('bank' or 'upi')        ← NEW    │
│  ├─ sms_sender      TEXT (e.g., 'AD-HDFCBK')      ← NEW    │
│  ├─ raw_sms         TEXT (original SMS body)      ← NEW    │
│  ├─ reference_number TEXT (UPI Ref/UTR)           ← NEW    │
│  └─ balance         DECIMAL(12,2)                 ← NEW    │
│                                                             │
│  Indexes:                                                   │
│  ├─ idx_transactions_duplicate_check                        │
│  │   ON (user_id, amount, created_at DESC)                 │
│  └─ idx_transactions_reference                              │
│      ON (reference_number) WHERE reference_number IS NOT NULL│
└─────────────────────────────────────────────────────────────┘
```

## ⚡ Performance Timeline

```
Time (ms)    Event
─────────────────────────────────────────────────────────
0            📱 SMS arrives on phone
1            🔔 Android broadcasts SMS_RECEIVED
2            📥 SmsReceiver catches broadcast
5            🚀 Starts SmsProcessorService
10           ⚙️  Headless JS task begins
15           📝 Parse SMS with regex
50           🔍 Query database for duplicates
100          💾 Insert/Update transaction
150          ✅ Task complete
200          🔄 Supabase real-time sync
300          📱 UI updates automatically
─────────────────────────────────────────────────────────
Total: < 500ms from SMS to UI update
```

## 🎨 Component Interaction

```
┌──────────────────────────────────────────────────────────┐
│  Settings Screen (Settings.tsx)                          │
│  ┌────────────────────────────────────────────────────┐  │
│  │  [SMS Tracking Toggle]                             │  │
│  │  ├─ Calls: requestSmsPermissions()                 │  │
│  │  └─ Updates: smsTrackingEnabled state              │  │
│  └────────────────────────────────────────────────────┘  │
└────────────────────────┬─────────────────────────────────┘
                         │
                         ▼
┌──────────────────────────────────────────────────────────┐
│  smsPermissions.ts                                       │
│  ┌────────────────────────────────────────────────────┐  │
│  │  requestSmsPermissions()                           │  │
│  │  ├─ PermissionsAndroid.requestMultiple()           │  │
│  │  └─ Returns: boolean (granted/denied)              │  │
│  └────────────────────────────────────────────────────┘  │
└────────────────────────┬─────────────────────────────────┘
                         │
                         ▼
┌──────────────────────────────────────────────────────────┐
│  Android System                                          │
│  ┌────────────────────────────────────────────────────┐  │
│  │  Permission Dialog                                 │  │
│  │  "Allow SpendSense to access SMS?"                 │  │
│  │  [Deny] [Allow]                                    │  │
│  └────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────┘
```

---

**Legend:**
- 📱 Mobile Device
- 🏦 Bank/Financial Institution
- 💾 Database
- ⚙️  Processing
- ✅ Success
- ❌ Rejected/Ignored
- 🔄 Real-time Sync
- 🔍 Query
- 📝 Parse
