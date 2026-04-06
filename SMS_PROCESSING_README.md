# SMS Processing Pipeline - Complete Implementation

## 🎯 Overview

This implementation provides automatic transaction tracking from SMS messages with intelligent de-duplication for Indian banking and UPI transactions.

## 📁 Files Created

### Native Android (Kotlin)
1. **`android/app/src/main/java/com/spendsense/SmsReceiver.kt`**
   - BroadcastReceiver that listens for incoming SMS
   - Extracts sender and message body
   - Triggers Headless JS task

2. **`android/app/src/main/java/com/spendsense/SmsProcessorService.kt`**
   - Headless JS service that bridges native and JavaScript
   - Runs even when app is killed

### JavaScript/TypeScript
3. **`src/lib/SmsProcessorTask.ts`**
   - Main SMS processing logic
   - Parses transaction details from SMS
   - Implements de-duplication algorithm
   - Saves to Supabase

4. **`src/utils/smsPermissions.ts`**
   - Permission request utilities
   - Permission check functions

5. **`index.js`** (Modified)
   - Registered Headless JS task

### Configuration
6. **`android/app/src/main/AndroidManifest.xml`** (Modified)
   - Added SMS permissions
   - Registered BroadcastReceiver
   - Registered Headless JS service

7. **`src/screens/Settings.tsx`** (Modified)
   - Added SMS tracking toggle
   - Permission request UI

### Database
8. **`supabase-sms-tracking.sql`**
   - Database migration for SMS tracking columns
   - Indexes for performance

### Documentation
9. **`SMS_IMPLEMENTATION_GUIDE.md`**
   - Detailed implementation guide
   - Testing instructions
   - Troubleshooting tips

## 🚀 Quick Start

### Step 1: Run Database Migration

Execute the SQL migration in your Supabase SQL Editor:

```bash
# Copy contents of supabase-sms-tracking.sql and run in Supabase
```

### Step 2: Rebuild Android App

```bash
# Uninstall existing app first (signature mismatch)
adb uninstall com.spendsense

# Clean and rebuild
cd android
./gradlew clean
cd ..

# Run on device
npx react-native run-android
```

### Step 3: Enable SMS Tracking

1. Open the app
2. Navigate to Settings
3. Toggle "SMS Tracking" ON
4. Grant SMS permissions when prompted

### Step 4: Test

Send a test SMS from another phone:

```
Rs 500.00 debited from A/c XX1234 on 06-04-26 to AMAZON PAY. 
UPI Ref: 123456789012. Avbl Bal: Rs 10,000.00
```

Check your transactions list - it should appear automatically!

## 🧠 How De-duplication Works

### The Problem
In India, one transaction = two SMS messages:
- **Bank SMS** (e.g., from AD-HDFCBK) - More reliable, has balance
- **UPI App SMS** (e.g., from VK-PAYTMB) - Faster, has merchant details

### The Solution

The system checks for duplicates within a **5-minute window** based on:
- Same user
- Same amount
- Recent timestamp

**De-duplication Rules:**

| Scenario | Action |
|----------|--------|
| UPI SMS arrives AFTER Bank SMS | ❌ Ignore UPI SMS |
| Bank SMS arrives AFTER UPI SMS | ✅ Update record with Bank data |
| Same source duplicate | ❌ Ignore (genuine duplicate) |
| No duplicate found | ✅ Insert new transaction |

### Code Flow

```
SMS Received
    ↓
SmsReceiver.kt (Native)
    ↓
SmsProcessorService.kt (Bridge)
    ↓
SmsProcessorTask.ts (JavaScript)
    ↓
Parse SMS → Extract amount, type, merchant, reference
    ↓
Check for duplicates (last 5 minutes)
    ↓
Apply de-duplication rules
    ↓
Insert/Update/Ignore in Supabase
```

## 📊 Database Schema

New columns added to `transactions` table:

```sql
sms_source         TEXT      -- 'bank' or 'upi'
sms_sender         TEXT      -- Sender ID (e.g., 'AD-HDFCBK')
raw_sms            TEXT      -- Original SMS body
reference_number   TEXT      -- UPI Ref/UTR/Transaction ID
balance            DECIMAL   -- Account balance after transaction
```

## 🔍 SMS Parsing

### Supported Patterns

**Amount Extraction:**
- `INR 500.00`
- `Rs. 500.00`
- `₹500.00`
- `amount: 500.00`
- `debited Rs 500.00`

**Transaction Type:**
- Debit: `debited`, `deducted`, `paid`, `spent`, `withdrawn`, `purchase`
- Credit: `credited`, `received`, `deposited`, `refund`

**Reference Number:**
- `UPI Ref: 123456789012`
- `UTR: 123456789012`
- `Transaction ID: ABC123`
- `Ref No: 123456789012`

**Merchant Name:**
- `to AMAZON PAY`
- `at SWIGGY`
- `from JOHN DOE`
- `paid to UBER`

**Balance:**
- `Avbl Bal: Rs 10,000.00`
- `Balance: INR 10,000.00`

### Supported Banks & UPI Apps

**Banks:**
- HDFC Bank (HDFCBK)
- ICICI Bank (ICICIB)
- State Bank of India (SBIINB)
- Axis Bank (AXISBK)
- Kotak Bank (KOTAKB)
- Punjab National Bank (PNBSMS)
- Standard Chartered (SCBANK)
- Yes Bank (YESBNK)
- IndusInd Bank (INDBNK)
- Union Bank (UNIONB)

**UPI Apps:**
- Paytm (PAYTMB)
- Google Pay (GPAYID)
- PhonePe (PHONEPE)
- BHIM (BHARTP)
- Amazon Pay (AMAZONP)
- WhatsApp Pay (WHATSAP)
- Mobikwik (MOBIKW)
- FreeCharge (FREECHARGE)
- PayZapp (PAYZAPP)

## 🔐 Security & Privacy

### Permissions Required
- `RECEIVE_SMS` - Listen for incoming SMS
- `READ_SMS` - Read SMS content
- `RECEIVE_BOOT_COMPLETED` - Start service on device boot

### Privacy Considerations
1. **Raw SMS Storage**: Original SMS is stored in database
   - Consider encrypting this field
   - Add data retention policy

2. **User Consent**: Always explain why SMS permissions are needed
   - Clear opt-in/opt-out mechanism
   - Transparent about data usage

3. **Session Management**: Uses AsyncStorage for user session
   - Ensure secure storage
   - Handle session expiry

## 🧪 Testing

### Manual Testing

1. **Test Bank SMS:**
```
Rs 500.00 debited from A/c XX1234 on 06-04-26 to AMAZON PAY. 
UPI Ref: 123456789012. Avbl Bal: Rs 10,000.00
-AD-HDFCBK
```

2. **Test UPI SMS:**
```
You paid Rs 500.00 to AMAZON PAY via UPI. 
Ref: 123456789012
-VK-PAYTMB
```

3. **Test De-duplication:**
   - Send Bank SMS first
   - Wait 30 seconds
   - Send UPI SMS with same amount
   - Verify only ONE transaction in database

### Debugging

**Check logs:**
```bash
# Android logs
adb logcat | grep SmsReceiver

# React Native logs
npx react-native log-android
```

**Check database:**
```sql
SELECT * FROM transactions 
WHERE sms_source IS NOT NULL 
ORDER BY created_at DESC 
LIMIT 10;
```

## 🐛 Troubleshooting

### SMS not being processed

**Check permissions:**
```bash
adb shell dumpsys package com.spendsense | grep permission
```

**Verify receiver is registered:**
```bash
adb shell dumpsys package com.spendsense | grep SmsReceiver
```

### Duplicates still appearing

1. Check if both SMS arrive within 5 minutes
2. Verify sender IDs are recognized
3. Check database indexes exist
4. Review logs for parsing errors

### App crashes on SMS

1. Check Supabase connection
2. Verify user session exists
3. Check database schema
4. Review error logs

## 📈 Performance

### Optimizations Implemented

1. **Indexed Queries**: Duplicate check uses indexed columns
2. **Limited Lookback**: Only checks last 5 minutes
3. **Early Exit**: Skips non-financial SMS immediately
4. **Async Processing**: Runs in background, doesn't block UI

### Expected Performance

- SMS processing: < 500ms
- Duplicate check: < 100ms
- Database insert: < 200ms
- Total: < 1 second from SMS to database

## 🔮 Future Enhancements

### Phase 2
- [ ] ML-based SMS parsing
- [ ] Auto-categorization based on merchant
- [ ] Push notifications for new transactions
- [ ] Manual review queue for uncertain transactions

### Phase 3
- [ ] Multi-account support
- [ ] Recurring transaction detection
- [ ] Budget alerts based on SMS transactions
- [ ] Export SMS transaction history

### Phase 4
- [ ] Bank statement reconciliation
- [ ] Merchant logo detection
- [ ] Split transaction support
- [ ] Family account sharing

## 📝 Code Examples

### Manually Trigger SMS Processing (for testing)

```typescript
import SmsProcessorTask from './src/lib/SmsProcessorTask';

// Test SMS processing
const testSms = {
  sender: 'AD-HDFCBK',
  body: 'Rs 500.00 debited from A/c XX1234 on 06-04-26 to AMAZON PAY. UPI Ref: 123456789012. Avbl Bal: Rs 10,000.00',
  timestamp: Date.now(),
};

SmsProcessorTask(testSms);
```

### Add Custom Bank/UPI Sender

Edit `src/lib/SmsProcessorTask.ts`:

```typescript
const BANK_SENDERS = [
  'HDFCBK', 'ICICIB', 'SBIINB', 'AXISBK', 'KOTAKB',
  'MYNEWBANK', // Add your bank here
];

const UPI_SENDERS = [
  'PAYTMB', 'GPAYID', 'PHONEPE', 'BHARTP',
  'MYNEWUPI', // Add your UPI app here
];
```

## 🤝 Contributing

To add support for new banks or UPI apps:

1. Identify the sender ID from SMS
2. Add to `BANK_SENDERS` or `UPI_SENDERS` array
3. Test with real SMS
4. Submit PR with test cases

## 📄 License

This implementation is part of the SpendSense app.

## 🆘 Support

For issues or questions:
1. Check troubleshooting section
2. Review logs
3. Check database schema
4. Open GitHub issue with logs

---

**Built with ❤️ for automatic expense tracking**
