# SMS Auto-Capture Feature

VaultApp automatically captures and tracks bank transactions from SMS messages, even when the app is closed.

## How It Works

### 1. Native Android BroadcastReceiver
- `SmsReceiver.java` listens for incoming SMS messages
- Filters messages from known bank sender IDs (HDFC, SBI, ICICI, Axis, Paytm, GPay, etc.)
- Runs in the background even when app is closed

### 2. HeadlessJS Task
- `SmsProcessorTask.ts` processes SMS in the background
- Extracts transaction details using regex patterns
- Automatically saves to Supabase database

### 3. Smart Parsing
The task intelligently extracts:
- **Amount**: Detects Rs., INR, ₹ followed by numbers
- **Type**: 
  - Income: credited, received, deposited, refund, cashback
  - Expense: debited, spent, paid, withdrawn, purchase
- **Note**: Extracts merchant name or transaction purpose
- **Category**: Auto-categorizes based on keywords (food, transport, shopping, etc.)

## Supported Banks & Services

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

## Permissions Required

The app requests these permissions:
- `RECEIVE_SMS`: To receive SMS messages
- `READ_SMS`: To read SMS content
- `WAKE_LOCK`: To process SMS when device is sleeping

## Usage

1. Open Settings in the app
2. Enable "SMS Auto-Capture" toggle
3. Grant SMS permissions when prompted
4. Transactions will be automatically tracked from bank SMS

## Privacy & Security

- SMS data is processed locally on your device
- Only bank transaction SMS are captured
- Data is sent directly to your private Supabase database
- No SMS content is stored or shared with third parties
- You can disable the feature anytime in Settings

## Example SMS Patterns

### Debit Transaction
```
HDFC Bank: Rs.500.00 debited from A/c **1234 on 17-03-26 at ZOMATO. 
Avl Bal: Rs.10,000.00
```
**Parsed as**: Expense, ₹500, "ZOMATO", Category: food

### Credit Transaction
```
SBI: Rs.35,000.00 credited to A/c **5678 on 17-03-26. 
Salary credited by EMPLOYER NAME
```
**Parsed as**: Income, ₹35,000, "Salary credited by EMPLOYER NAME", Category: salary

### UPI Payment
```
ICICI Bank: Rs.250 debited from A/c **9012 via UPI to merchant@paytm. 
Ref No: 123456789
```
**Parsed as**: Expense, ₹250, "merchant@paytm", Category: general

## Technical Details

### Files Created
- `src/tasks/SmsProcessorTask.ts` - HeadlessJS task for SMS processing
- `src/utils/permissions.ts` - Permission request utilities
- `android/app/src/main/java/com/vaultapp/SmsReceiver.java` - Native SMS receiver
- `android/app/src/main/java/com/vaultapp/SmsProcessorService.java` - HeadlessJS service

### Configuration
- Registered in `index.js` as HeadlessJS task
- Declared in `AndroidManifest.xml` with high priority (999)
- Integrated with Settings screen for user control

## Troubleshooting

### SMS not being captured
1. Check if SMS permissions are granted in Android Settings
2. Verify the sender ID matches supported banks
3. Check logs: `adb logcat | grep SmsReceiver`

### Transactions not appearing
1. Ensure you're logged in to the app
2. Check internet connection (required for Supabase)
3. Verify Supabase credentials in `src/lib/supabase.ts`

### Permission denied
1. Go to Android Settings > Apps > VaultApp > Permissions
2. Enable SMS permissions manually
3. Restart the app

## Future Enhancements

- Add more bank sender IDs
- Support for credit card SMS
- Custom regex patterns for specific banks
- Transaction categorization improvements
- Duplicate detection
- SMS history import
