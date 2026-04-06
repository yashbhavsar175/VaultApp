# VaultApp - SMS Auto-Capture Implementation Summary

## ✅ Completed Implementation

### 1. Native Android Components

#### SmsReceiver.java
- BroadcastReceiver that listens for `android.provider.Telephony.SMS_RECEIVED`
- Filters SMS from 10+ bank sender IDs (HDFC, SBI, ICICI, Axis, Paytm, GPay, etc.)
- Starts HeadlessJS service when bank SMS is detected
- Works even when app is completely closed

#### SmsProcessorService.java
- HeadlessJS service that bridges native Android to React Native
- Passes SMS data to JavaScript task
- 60-second timeout for processing
- Allows execution in foreground

### 2. React Native HeadlessJS Task

#### SmsProcessorTask.ts
Smart SMS parsing with:
- **Amount extraction**: Multiple regex patterns for Rs., INR, ₹
- **Type detection**: 
  - Income: credited, received, deposited, refund, cashback
  - Expense: debited, spent, paid, withdrawn, purchase
- **Note extraction**: Merchant name or transaction purpose
- **Category detection**: Auto-categorizes (food, transport, shopping, bills, etc.)
- **Silent auto-save**: Directly calls `addTransaction()` - no user confirmation

### 3. Permissions & Configuration

#### AndroidManifest.xml
Added:
- `RECEIVE_SMS` permission
- `READ_SMS` permission
- `WAKE_LOCK` permission
- Service declaration for `SmsProcessorService`
- Receiver declaration for `SmsReceiver` with priority 999

#### index.js
- Registered HeadlessJS task: `SmsProcessor`
- Imports task file to ensure registration

### 4. User Interface

#### Settings Screen Enhancement
- SMS Auto-Capture toggle switch
- Runtime permission request
- Permission status indicator
- Info card showing monitored banks
- User-friendly permission flow

#### Permission Utilities (permissions.ts)
- `requestSmsPermissions()`: Request SMS permissions
- `checkSmsPermissions()`: Check current permission status
- Android 6.0+ runtime permission support

## 📁 Files Created/Modified

### New Files
```
src/tasks/SmsProcessorTask.ts
src/utils/permissions.ts
android/app/src/main/java/com/vaultapp/SmsReceiver.java
android/app/src/main/java/com/vaultapp/SmsProcessorService.java
SMS_AUTO_CAPTURE.md
IMPLEMENTATION_SUMMARY.md
```

### Modified Files
```
android/app/src/main/AndroidManifest.xml
src/screens/Settings.tsx
index.js
```

## 🎯 Key Features

### Background Processing
- ✅ Works when app is closed
- ✅ Works when device is sleeping (WAKE_LOCK)
- ✅ High priority receiver (999)
- ✅ No user interaction required

### Smart Parsing
- ✅ Multiple amount detection patterns
- ✅ Intelligent type detection (income/expense)
- ✅ Merchant/purpose extraction
- ✅ Auto-categorization
- ✅ Handles various SMS formats

### Privacy & Security
- ✅ Only processes bank SMS
- ✅ Local processing on device
- ✅ Direct to user's Supabase database
- ✅ User control via Settings toggle
- ✅ No third-party data sharing

### Supported Banks
- HDFC Bank (HDFCBK)
- State Bank of India (SBIINB)
- ICICI Bank (ICICIB)
- Axis Bank (AXISBK)
- Slice (SLICEBANK)
- Paytm (PAYTM)
- Google Pay (GPAY)
- PhonePe (PHONEPE)
- Amazon Pay (AMAZONPAY)
- Kotak Bank (KOTAK)

## 🚀 How to Use

1. Build and install the app:
   ```bash
   cd android && ./gradlew clean
   cd .. && npx react-native run-android
   ```

2. Open Settings in the app

3. Enable "SMS Auto-Capture" toggle

4. Grant SMS permissions when prompted

5. Send a test SMS from a bank sender ID or wait for real bank SMS

6. Check Dashboard - transactions appear automatically!

## 🧪 Testing

### Test with ADB
```bash
# Send test SMS from HDFC
adb emu sms send HDFCBK "Rs.500.00 debited from A/c **1234 on 17-03-26 at ZOMATO. Avl Bal: Rs.10,000.00"

# Send test SMS from SBI
adb emu sms send SBIINB "Rs.35,000.00 credited to A/c **5678 on 17-03-26. Salary credited by EMPLOYER"

# Send test SMS from ICICI
adb emu sms send ICICIB "Rs.250 debited from A/c **9012 via UPI to merchant@paytm"
```

### Check Logs
```bash
# View SMS receiver logs
adb logcat | grep SmsReceiver

# View HeadlessJS task logs
adb logcat | grep SmsProcessor

# View all app logs
adb logcat | grep VaultApp
```

## 📊 Example Parsing Results

### Input SMS
```
HDFC Bank: Rs.500.00 debited from A/c **1234 on 17-03-26 at ZOMATO. Avl Bal: Rs.10,000.00
```

### Parsed Output
```javascript
{
  amount: 500,
  type: 'expense',
  note: 'ZOMATO',
  category: 'food'
}
```

## 🔧 Troubleshooting

### SMS not captured
1. Check permissions in Android Settings
2. Verify sender ID matches supported banks
3. Check logs: `adb logcat | grep SmsReceiver`

### Transactions not saving
1. Ensure user is logged in
2. Check internet connection
3. Verify Supabase credentials
4. Check logs: `adb logcat | grep SmsProcessor`

### Permission issues
1. Manually grant in Settings > Apps > VaultApp > Permissions
2. Restart app after granting permissions

## 🎉 Success Criteria

- ✅ SMS received from bank triggers BroadcastReceiver
- ✅ HeadlessJS task processes SMS in background
- ✅ Amount, type, note, and category extracted correctly
- ✅ Transaction saved to Supabase database
- ✅ Works when app is closed
- ✅ No user confirmation required
- ✅ User can enable/disable in Settings

## 🔮 Future Enhancements

- Add more bank sender IDs
- Support for credit card SMS
- Custom regex patterns per bank
- Duplicate transaction detection
- SMS history import on first launch
- Transaction editing before save (optional mode)
- ML-based categorization
- Multi-language SMS support
