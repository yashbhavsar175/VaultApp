# Testing SMS Auto-Capture

## Prerequisites
1. Build and install the app
2. Enable SMS Auto-Capture in Settings
3. Grant SMS permissions

## Test Commands

### Using Android Emulator

```bash
# Test Slice bank - received format
adb emu sms send SLICE "Received ₹1 via UPI"

# Test Slice bank - alternative format
adb emu sms send SLICEPAY "₹1.00 received from MR HARSH"

# Test HDFC debit transaction
adb emu sms send HDFCBK "HDFC Bank: Rs.500.00 debited from A/c **1234 on 17-03-26 at ZOMATO. Avl Bal: Rs.10,000.00"

# Test SBI credit transaction (salary)
adb emu sms send SBIINB "SBI: Rs.35,000.00 credited to A/c **5678 on 17-03-26. Salary credited by EMPLOYER NAME"

# Test ICICI UPI payment
adb emu sms send ICICIB "ICICI Bank: Rs.250 debited from A/c **9012 via UPI to merchant@paytm. Ref No: 123456789"

# Test Axis Bank transaction
adb emu sms send AXISBK "Dear Customer, Rs.1,200.00 has been debited from your A/c **3456 at AMAZON on 17-03-26"

# Test Paytm transaction
adb emu sms send PAYTM "Rs.150 debited from Paytm Wallet for recharge. Balance: Rs.500"

# Test GPay transaction
adb emu sms send GPAY "You paid Rs.300 to SWIGGY via Google Pay. UPI Ref: 123456"

# Test refund/cashback
adb emu sms send HDFCBK "Rs.100.00 cashback credited to A/c **1234 on 17-03-26"

# Test fuel purchase
adb emu sms send SBIINB "Rs.2,500 debited from A/c **5678 at INDIAN OIL PETROL PUMP on 17-03-26"

# Test generic UPI sender
adb emu sms send UPI "₹50 sent to merchant via UPI"

# Test any bank sender
adb emu sms send ANYBANK "₹100 debited from account"
```

### Using Real Device

Send SMS from these test numbers (if you have access):
- HDFCBK
- SBIINB
- ICICIB
- AXISBK
- PAYTM
- GPAY

## Viewing Logs

### View all SMS processing logs
```bash
adb logcat | grep -E "SmsReceiver|SmsProcessor|SMS Task"
```

### View only SMS Receiver logs
```bash
adb logcat | grep SmsReceiver
```

### View only HeadlessJS task logs
```bash
adb logcat | grep "SMS Task"
```

### View React Native logs
```bash
adb logcat | grep ReactNativeJS
```

### Clear logs and start fresh
```bash
adb logcat -c
adb logcat | grep -E "SmsReceiver|SmsProcessor|SMS Task"
```

## Expected Log Output

### Successful Processing
```
SmsReceiver: SMS received from: SLICE
SmsReceiver: SMS body: Received ₹1 via UPI
SmsProcessorService: Starting HeadlessJS task with SMS data
SMS Task raw payload: {"smsData":{"sender":"SLICE","body":"Received ₹1 via UPI","timestamp":1234567890}}
SMS Processor Task started
Processing SMS from: SLICE
SMS body: Received ₹1 via UPI
Parsed transaction: {"amount":1,"type":"income","note":"Received via UPI","category":"income"}
Transaction saved successfully
Notification sent
```

### SMS Ignored (Not from Bank)
```
SmsReceiver: SMS received from: +1234567890
SmsReceiver: SMS body: Your OTP is 123456
SmsProcessorService: Starting HeadlessJS task with SMS data
SMS Processor Task started
Processing SMS from: +1234567890
SMS body: Your OTP is 123456
No amount found in SMS, skipping
```

### No Amount Found
```
SMS Processor Task started
Processing SMS from: HDFCBK
SMS body: Your OTP is 123456
No amount found in SMS, skipping
```

## Troubleshooting

### SMS not being captured

1. **Check permissions**
   ```bash
   adb shell dumpsys package com.vaultapp | grep permission
   ```
   Should show:
   - android.permission.RECEIVE_SMS: granted=true
   - android.permission.READ_SMS: granted=true

2. **Check if receiver is registered**
   ```bash
   adb shell dumpsys package com.vaultapp | grep SmsReceiver
   ```

3. **Verify app is installed**
   ```bash
   adb shell pm list packages | grep vaultapp
   ```

### HeadlessJS task not starting

1. **Check if service is declared**
   ```bash
   adb shell dumpsys package com.vaultapp | grep SmsProcessorService
   ```

2. **Check React Native packager is running**
   ```bash
   # Should see Metro bundler running on port 8081
   curl http://localhost:8081/status
   ```

3. **Restart app and try again**
   ```bash
   adb shell am force-stop com.vaultapp
   adb shell am start -n com.vaultapp/.MainActivity
   ```

### Transaction not saving

1. **Check if user is logged in**
   - Open app and verify you're on Dashboard (not Login screen)

2. **Check Supabase connection**
   - Verify `src/lib/supabase.ts` has correct URL and key
   - Check internet connection

3. **Check database logs**
   ```bash
   adb logcat | grep -E "supabase|database|transaction"
   ```

### Invalid payload error

If you see "Invalid SMS payload - no sender or body found":

1. **Check Java side is passing data correctly**
   ```bash
   adb logcat | grep SmsProcessorService
   ```
   Should show: "Starting HeadlessJS task with SMS data: {smsData={...}}"

2. **Check payload structure in logs**
   Look for: "SMS Task raw payload: {...}"
   Verify it contains smsData with sender and body

## Manual Testing Checklist

- [ ] Install app and grant SMS permissions
- [ ] Send test SMS from HDFC (debit)
- [ ] Verify transaction appears in Dashboard
- [ ] Send test SMS from SBI (credit)
- [ ] Verify income transaction appears
- [ ] Close app completely
- [ ] Send test SMS from ICICI
- [ ] Open app and verify transaction was captured
- [ ] Send non-bank SMS
- [ ] Verify it's ignored (no transaction created)
- [ ] Send SMS without amount
- [ ] Verify it's ignored
- [ ] Disable SMS Auto-Capture in Settings
- [ ] Send test SMS
- [ ] Verify it's NOT captured

## Performance Testing

### Test with multiple SMS
```bash
# Send 5 SMS in quick succession
for i in {1..5}; do
  adb emu sms send HDFCBK "Rs.$((100 * i)) debited from A/c **1234 at MERCHANT$i"
  sleep 2
done
```

### Check processing time
```bash
# Look for time between "SMS received" and "Transaction saved"
adb logcat | grep -E "SMS received|Transaction saved" --line-buffered | ts '[%Y-%m-%d %H:%M:%S]'
```

## Success Criteria

✅ SMS from bank triggers receiver
✅ HeadlessJS task processes SMS
✅ Amount extracted correctly
✅ Type detected correctly (income/expense)
✅ Transaction saved to database
✅ Works when app is closed
✅ Non-bank SMS ignored
✅ SMS without amount ignored
✅ User can enable/disable feature
