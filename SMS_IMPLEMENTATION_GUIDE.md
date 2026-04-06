# SMS Processing Pipeline Implementation Guide

## Overview
This implementation provides automatic SMS-based transaction tracking with intelligent de-duplication for Indian banking and UPI transactions.

## Architecture

### 1. Native Android Layer
- **SmsReceiver.kt**: BroadcastReceiver that listens for incoming SMS
- **SmsProcessorService.kt**: Headless JS service that bridges native and JS

### 2. JavaScript Layer
- **SmsProcessorTask.ts**: Main processing logic with de-duplication
- **smsPermissions.ts**: Permission handling utilities

## De-duplication Strategy

### Problem
In India, a single transaction generates two SMS:
1. Bank SMS (e.g., from AD-HDFCBK)
2. UPI App SMS (e.g., from VK-PAYTMB)

### Solution
The system checks for duplicates within a 5-minute window:

1. **UPI SMS after Bank SMS**: Ignore the UPI SMS
2. **Bank SMS after UPI SMS**: Update the existing record with Bank data (more reliable)
3. **Same source duplicate**: Ignore (likely a genuine duplicate)

## Database Schema Required

Add these columns to your `transactions` table:

```sql
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS sms_source TEXT; -- 'bank' or 'upi'
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS sms_sender TEXT; -- sender ID
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS raw_sms TEXT; -- original SMS body
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS reference_number TEXT; -- UPI ref/UTR
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS balance DECIMAL(10,2); -- account balance
```

## Setup Instructions

### Step 1: Request Permissions
Add this to your Settings or onboarding screen:

```typescript
import { requestSmsPermissions } from '../utils/smsPermissions';

const handleEnableSmsTracking = async () => {
  const granted = await requestSmsPermissions();
  if (granted) {
    Alert.alert('Success', 'SMS tracking enabled!');
  } else {
    Alert.alert('Error', 'SMS permissions are required for automatic tracking');
  }
};
```

### Step 2: Rebuild Android App
```bash
cd android
./gradlew clean
cd ..
npx react-native run-android
```

### Step 3: Test
1. Grant SMS permissions when prompted
2. Send a test SMS from another phone with transaction-like content:
   ```
   Rs 500.00 debited from A/c XX1234 on 06-04-26 to AMAZON PAY. 
   UPI Ref: 123456789012. Avbl Bal: Rs 10,000.00
   ```

## Supported SMS Patterns

### Banks
- HDFC Bank (HDFCBK)
- ICICI Bank (ICICIB)
- SBI (SBIINB)
- Axis Bank (AXISBK)
- Kotak Bank (KOTAKB)
- And more...

### UPI Apps
- Paytm (PAYTMB)
- Google Pay (GPAYID)
- PhonePe (PHONEPE)
- BHIM (BHARTP)
- Amazon Pay (AMAZONP)
- WhatsApp Pay (WHATSAP)

## Parsing Logic

The SMS parser extracts:
- **Amount**: INR/Rs/₹ patterns
- **Type**: Debit/Credit keywords
- **Reference**: UPI Ref/UTR/Transaction ID
- **Merchant**: Payee/merchant name
- **Balance**: Available balance

## Security Considerations

1. **Permissions**: SMS permissions are sensitive - explain clearly to users
2. **Data Privacy**: Raw SMS is stored - ensure proper encryption
3. **Session Management**: Uses AsyncStorage for user session
4. **Background Processing**: Works even when app is killed

## Troubleshooting

### SMS not being processed
1. Check permissions: Settings > Apps > SpendSense > Permissions
2. Check logs: `adb logcat | grep SmsReceiver`
3. Verify Headless JS is registered in index.js

### Duplicates still appearing
1. Check if both SMS arrive within 5 minutes
2. Verify sender IDs are in BANK_SENDERS or UPI_SENDERS arrays
3. Check database for `sms_source` column

### App crashes on SMS
1. Check Supabase connection
2. Verify user session exists
3. Check database schema matches expected columns

## Future Enhancements

1. **ML-based parsing**: Train model on user's SMS patterns
2. **Category detection**: Auto-categorize based on merchant
3. **Notification**: Alert user when transaction is added
4. **Manual review**: Flag uncertain transactions for user review
5. **Multi-account**: Support multiple bank accounts

## Testing Checklist

- [ ] SMS permissions requested and granted
- [ ] Bank SMS creates transaction
- [ ] UPI SMS after Bank SMS is ignored
- [ ] Bank SMS after UPI SMS updates record
- [ ] Works when app is killed
- [ ] Works when app is in background
- [ ] No duplicates in database
- [ ] Correct amount, type, and merchant extracted
- [ ] Reference numbers captured
- [ ] Balance updated correctly
