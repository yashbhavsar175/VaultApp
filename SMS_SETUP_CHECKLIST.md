# ✅ SMS Processing Setup Checklist

## Pre-Setup Verification

- [ ] React Native project is working
- [ ] Supabase is configured and connected
- [ ] Android device/emulator available
- [ ] User authentication is working
- [ ] `transactions` table exists in Supabase

## 📦 Files Verification

### Native Android Files (Kotlin)
- [ ] `android/app/src/main/java/com/spendsense/SmsReceiver.kt` exists
- [ ] `android/app/src/main/java/com/spendsense/SmsProcessorService.kt` exists

### JavaScript/TypeScript Files
- [ ] `src/lib/SmsProcessorTask.ts` exists
- [ ] `src/utils/smsPermissions.ts` exists

### Configuration Files
- [ ] `android/app/src/main/AndroidManifest.xml` updated with:
  - [ ] SMS permissions added
  - [ ] BroadcastReceiver registered
  - [ ] Headless JS service registered
- [ ] `index.js` updated with Headless JS task registration
- [ ] `src/screens/Settings.tsx` updated with SMS toggle

### Database Files
- [ ] `supabase-sms-tracking.sql` exists

## 🗄️ Database Setup

- [ ] Open Supabase Dashboard
- [ ] Navigate to SQL Editor
- [ ] Copy contents of `supabase-sms-tracking.sql`
- [ ] Execute the migration
- [ ] Verify new columns exist:
  ```sql
  SELECT column_name 
  FROM information_schema.columns 
  WHERE table_name = 'transactions' 
  AND column_name IN ('sms_source', 'sms_sender', 'raw_sms', 'reference_number', 'balance');
  ```
- [ ] Verify indexes created:
  ```sql
  SELECT indexname 
  FROM pg_indexes 
  WHERE tablename = 'transactions' 
  AND indexname LIKE '%duplicate%';
  ```

## 🔨 Build Setup

### Clean Previous Build
- [ ] Uninstall existing app: `adb uninstall com.spendsense`
- [ ] Clean Android build: `cd android && ./gradlew clean && cd ..`
- [ ] Clear Metro cache: `npx react-native start --reset-cache` (in separate terminal)

### Build and Install
- [ ] Build and install: `npx react-native run-android`
- [ ] Wait for build to complete (may take 2-5 minutes)
- [ ] App launches successfully
- [ ] No build errors in terminal

## 📱 App Configuration

### Enable SMS Tracking
- [ ] Open SpendSense app
- [ ] Navigate to Settings (bottom tab)
- [ ] Find "SMS Tracking" section under "Features"
- [ ] Toggle "SMS Tracking" to ON
- [ ] Permission dialog appears
- [ ] Grant both permissions:
  - [ ] RECEIVE_SMS
  - [ ] READ_SMS
- [ ] Success toast appears
- [ ] Toggle shows as enabled

### Verify Permissions
```bash
# Run this command to verify permissions
adb shell dumpsys package com.spendsense | grep "android.permission.RECEIVE_SMS"
adb shell dumpsys package com.spendsense | grep "android.permission.READ_SMS"
```
- [ ] Both permissions show as "granted=true"

## 🧪 Testing

### Test 1: Basic SMS Processing
- [ ] Send test SMS from another phone:
  ```
  Rs 500.00 debited from A/c XX1234 on 06-04-26 
  to AMAZON PAY. UPI Ref: 123456789012. 
  Avbl Bal: Rs 10,000.00
  ```
- [ ] Wait 5 seconds
- [ ] Open SpendSense app
- [ ] Navigate to Dashboard
- [ ] Verify transaction appears:
  - [ ] Amount: Rs 500.00
  - [ ] Type: Debit
  - [ ] Merchant: AMAZON PAY

### Test 2: Check Database
```sql
SELECT * FROM transactions 
WHERE sms_source IS NOT NULL 
ORDER BY created_at DESC 
LIMIT 1;
```
- [ ] Transaction exists in database
- [ ] `sms_source` is 'bank' or 'upi'
- [ ] `sms_sender` contains sender ID
- [ ] `raw_sms` contains original SMS
- [ ] `reference_number` is captured
- [ ] `balance` is recorded

### Test 3: De-duplication (Bank SMS)
- [ ] Send Bank SMS:
  ```
  Rs 750.00 debited from A/c XX1234 to SWIGGY. 
  Ref: 987654321098. Bal: Rs 9,250.00
  -AD-HDFCBK
  ```
- [ ] Wait 10 seconds
- [ ] Verify 1 transaction in app
- [ ] Note the transaction ID

### Test 4: De-duplication (UPI SMS after Bank)
- [ ] Send UPI SMS with same amount:
  ```
  You paid Rs 750.00 to SWIGGY via UPI. 
  Ref: 987654321098
  -VK-PAYTMB
  ```
- [ ] Wait 10 seconds
- [ ] Verify still only 1 transaction (not 2!)
- [ ] Transaction ID is same as before
- [ ] UPI SMS was ignored

### Test 5: De-duplication (Bank SMS after UPI)
- [ ] Send UPI SMS first:
  ```
  You paid Rs 1000.00 to UBER via UPI. 
  Ref: 111222333444
  -PHONEPE
  ```
- [ ] Wait 10 seconds
- [ ] Verify 1 transaction created
- [ ] Note transaction details
- [ ] Send Bank SMS:
  ```
  Rs 1000.00 debited from A/c XX1234 to UBER. 
  Ref: 111222333444. Bal: Rs 8,250.00
  -AD-HDFCBK
  ```
- [ ] Wait 10 seconds
- [ ] Verify still only 1 transaction
- [ ] Transaction updated with Bank data:
  - [ ] `sms_source` changed to 'bank'
  - [ ] `balance` now shows Rs 8,250.00

### Test 6: Background Processing
- [ ] Close SpendSense app completely (swipe away)
- [ ] Send test SMS
- [ ] Wait 10 seconds
- [ ] Open SpendSense app
- [ ] Verify transaction was processed while app was closed

### Test 7: App Killed
- [ ] Force stop app: Settings > Apps > SpendSense > Force Stop
- [ ] Send test SMS
- [ ] Wait 10 seconds
- [ ] Open SpendSense app
- [ ] Verify transaction was processed

## 🔍 Debugging Checklist

### If SMS not being processed:

- [ ] Check Android logs:
  ```bash
  adb logcat | grep SmsReceiver
  ```
- [ ] Verify permissions granted:
  ```bash
  adb shell dumpsys package com.spendsense | grep permission
  ```
- [ ] Check if receiver is registered:
  ```bash
  adb shell dumpsys package com.spendsense | grep SmsReceiver
  ```
- [ ] Verify user is logged in
- [ ] Check Supabase connection
- [ ] Review Metro bundler logs

### If duplicates appearing:

- [ ] Verify both SMS arrive within 5 minutes
- [ ] Check sender IDs are in supported list
- [ ] Query database for duplicate check:
  ```sql
  SELECT * FROM transactions 
  WHERE amount = 500.00 
  AND created_at >= NOW() - INTERVAL '5 minutes'
  ORDER BY created_at DESC;
  ```
- [ ] Check `sms_source` column values
- [ ] Review de-duplication logs in Metro

### If app crashes:

- [ ] Check Metro bundler for JavaScript errors
- [ ] Check Android logcat for native crashes
- [ ] Verify Supabase connection
- [ ] Check user session exists:
  ```bash
  adb shell run-as com.spendsense cat /data/data/com.spendsense/files/RCTAsyncLocalStorage_V1/supabase.auth.token
  ```
- [ ] Verify database schema matches expected

## 📊 Performance Verification

- [ ] SMS processing completes in < 1 second
- [ ] No UI lag when SMS arrives
- [ ] Database queries are fast (< 100ms)
- [ ] App doesn't crash under load
- [ ] Battery usage is reasonable

## 🔐 Security Verification

- [ ] Permissions are opt-in (user must enable)
- [ ] Clear explanation shown to user
- [ ] Can be disabled anytime
- [ ] Only financial SMS are processed
- [ ] User session required for processing
- [ ] Data isolated per user

## 📚 Documentation Review

- [ ] Read `SMS_IMPLEMENTATION_COMPLETE.md`
- [ ] Review `SMS_QUICK_REFERENCE.md`
- [ ] Understand `SMS_ARCHITECTURE_DIAGRAM.md`
- [ ] Bookmark `SMS_PROCESSING_README.md` for reference

## 🎉 Final Verification

- [ ] All tests pass
- [ ] No errors in logs
- [ ] Transactions appear correctly
- [ ] De-duplication works
- [ ] Background processing works
- [ ] Performance is acceptable
- [ ] User experience is smooth

## 📝 Post-Setup Tasks

- [ ] Document any custom bank/UPI senders added
- [ ] Set up monitoring/analytics (optional)
- [ ] Plan for Phase 2 enhancements
- [ ] Gather user feedback
- [ ] Monitor error rates

## 🚀 Production Readiness

Before releasing to users:

- [ ] All tests pass consistently
- [ ] Tested on multiple devices
- [ ] Tested with real bank SMS
- [ ] Privacy policy updated
- [ ] User documentation created
- [ ] Support process defined
- [ ] Rollback plan ready
- [ ] Monitoring in place

## 📞 Support Resources

If you encounter issues:

1. **Check logs first:**
   ```bash
   adb logcat | grep -E "SmsReceiver|SmsProcessor"
   ```

2. **Verify database:**
   ```sql
   SELECT * FROM transactions WHERE sms_source IS NOT NULL;
   ```

3. **Review documentation:**
   - SMS_QUICK_REFERENCE.md
   - SMS_PROCESSING_README.md
   - SMS_ARCHITECTURE_DIAGRAM.md

4. **Common solutions:**
   - Rebuild app: `cd android && ./gradlew clean && cd .. && npx react-native run-android`
   - Reset permissions: Uninstall and reinstall app
   - Check Supabase: Verify connection and schema

---

## ✅ Setup Complete!

Once all items are checked:
- ✅ SMS processing is fully functional
- ✅ De-duplication is working
- ✅ Background processing enabled
- ✅ Ready for user testing

**Estimated Setup Time:** 15-20 minutes
**Estimated Time Saved:** Hours per month

---

**Last Updated:** April 6, 2026
**Version:** 1.0.0
