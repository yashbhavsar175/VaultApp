# Notification Listener - Deployment Checklist

## Pre-Deployment Verification

### ✅ Code Implementation
- [x] NotificationProcessorTask.ts created with full transaction logic
- [x] NotificationListener.kt created with package filtering
- [x] NotificationProcessorService.kt created as headless bridge
- [x] AndroidManifest.xml updated with permissions and services
- [x] index.js updated with task registration
- [x] TypeScript compilation successful (no errors)

### ✅ Features Implemented
- [x] Package filtering (7 supported apps)
- [x] Notification text parsing using existing parseSms()
- [x] Self-transfer detection (UTR + time window)
- [x] 2-second retry logic for race conditions
- [x] Duplicate prevention (SMS + notification)
- [x] Bank balance updates
- [x] Retroactive transfer matching
- [x] Comprehensive error handling

### ✅ Documentation
- [x] NOTIFICATION_LISTENER_SETUP.md (detailed guide)
- [x] NOTIFICATION_QUICK_START.md (quick reference)
- [x] NOTIFICATION_IMPLEMENTATION_SUMMARY.md (technical overview)
- [x] NOTIFICATION_DEPLOYMENT_CHECKLIST.md (this file)

## Build & Deploy Steps

### Step 1: Clean Build
```bash
# Clean previous builds
cd android
./gradlew clean
cd ..

# Remove old build artifacts
rm -rf android/app/build
rm -rf node_modules/.cache
```

### Step 2: Install Dependencies
```bash
# Ensure all dependencies are installed
npm install
# or
yarn install
```

### Step 3: Build Android App
```bash
# Development build
npx react-native run-android

# Production build (optional)
cd android
./gradlew assembleRelease
cd ..
```

### Step 4: Verify Build Success
- [ ] App builds without errors
- [ ] App installs on device/emulator
- [ ] App launches successfully
- [ ] No crash on startup

## Testing Checklist

### Phase 1: Permission Setup
- [ ] Open Android Settings
- [ ] Navigate to Apps → Special access → Notification access
- [ ] Find SpendSense in the list
- [ ] Enable notification access
- [ ] Confirm permission dialog

### Phase 2: Basic Functionality
- [ ] App is running and user is logged in
- [ ] Make a test UPI payment using Google Pay (₹10-50)
- [ ] Wait 5-10 seconds
- [ ] Check if transaction appears in dashboard
- [ ] Verify amount, merchant, and type are correct

### Phase 3: Multi-App Testing
- [ ] Test with Google Pay
- [ ] Test with PhonePe
- [ ] Test with Slice (if available)
- [ ] Test with CRED (if available)
- [ ] Test with Paytm (if available)

### Phase 4: Duplicate Prevention
- [ ] Make a transaction that generates both SMS and notification
- [ ] Verify only ONE transaction is created
- [ ] Check transaction source in database (should show 'bank' or 'upi')

### Phase 5: Self-Transfer Detection
- [ ] Transfer money between two of your accounts
- [ ] Wait for both debit and credit notifications
- [ ] Verify transaction shows as "Transfer" (not separate debit/credit)
- [ ] Check from_account_id and to_account_id are set correctly

### Phase 6: Edge Cases
- [ ] Test with notification arriving before SMS
- [ ] Test with SMS arriving before notification
- [ ] Test with simultaneous arrival (within 1 second)
- [ ] Test with app in background
- [ ] Test with app completely closed
- [ ] Test with device locked

## Log Verification

### Check Notification Reception
```bash
adb logcat | grep NotificationListener
```

Expected output:
```
NotificationListener: Notification Listener Connected
NotificationListener: Notification from com.phonepe.app: Payment Successful - Rs 100 paid to...
```

### Check Transaction Processing
```bash
adb logcat | grep "NotificationProcessor\|Transaction inserted"
```

Expected output:
```
NotificationProcessor: Processing notification from allowed app: com.phonepe.app
NotificationProcessor: Parsed Transaction from Notification: {amount: 100, type: 'debit', ...}
NotificationProcessor: Transaction inserted successfully from notification
```

### Check for Errors
```bash
adb logcat | grep -E "Error|Exception" | grep -E "Notification|Transaction"
```

Should show no errors related to notification processing.

## Database Verification

### Check Transaction in Supabase

1. Open Supabase dashboard
2. Navigate to Table Editor → transactions
3. Find the latest transaction
4. Verify fields:
   - `amount`: Correct amount
   - `type`: 'debit', 'credit', or 'transfer'
   - `sms_source`: 'upi' or 'bank'
   - `sms_sender`: 'GPAYID', 'PHONEPE', etc.
   - `raw_sms`: Contains notification title + text
   - `reference_number`: UPI reference if available
   - `merchant`: Merchant name if extracted
   - `account_last4`: Last 4 digits if available

### Check Bank Balance Update

1. Note bank balance before transaction
2. Make a test transaction
3. Check bank_accounts table
4. Verify balance is updated correctly:
   - Debit: balance decreased
   - Credit: balance increased
   - Transfer: both accounts updated

## Performance Monitoring

### Memory Usage
```bash
adb shell dumpsys meminfo com.spendsense
```

Check for memory leaks after processing multiple notifications.

### Battery Usage
```bash
adb shell dumpsys batterystats com.spendsense
```

Verify notification processing doesn't drain battery excessively.

### CPU Usage
```bash
adb shell top | grep spendsense
```

Check CPU usage during notification processing (should be minimal).

## Rollback Plan

If issues are found:

### Option 1: Disable Notification Listener
1. User can disable notification access in Settings
2. App will continue working with SMS only

### Option 2: Code Rollback
```bash
# Revert changes
git revert <commit-hash>

# Rebuild
cd android && ./gradlew clean && cd ..
npx react-native run-android
```

### Option 3: Feature Flag (Future)
Add a feature flag to enable/disable notification processing:
```typescript
const ENABLE_NOTIFICATION_PROCESSING = false; // Set to false to disable
```

## Known Issues & Workarounds

### Issue 1: Permission Gets Disabled
**Cause**: Some Android devices (Xiaomi, Oppo) aggressively disable notification access

**Workaround**:
1. Add app to battery optimization whitelist
2. Enable "Autostart" permission
3. Disable battery saver for the app

### Issue 2: Notifications Not Received
**Cause**: App package name might be different on some devices

**Workaround**:
1. Check actual package name: `adb shell pm list packages | grep <app>`
2. Add to ALLOWED_PACKAGES if different

### Issue 3: Parsing Failures
**Cause**: Notification format varies by app version

**Workaround**:
1. Log the raw notification text
2. Update regex patterns in parseNotification()
3. Add app-specific parsing logic if needed

## Post-Deployment Monitoring

### Week 1: Active Monitoring
- [ ] Check error logs daily
- [ ] Monitor transaction accuracy
- [ ] Collect user feedback
- [ ] Track duplicate rate
- [ ] Measure self-transfer detection accuracy

### Week 2-4: Passive Monitoring
- [ ] Check error logs weekly
- [ ] Review transaction patterns
- [ ] Identify parsing failures
- [ ] Plan improvements

### Metrics to Track
- **Success Rate**: % of notifications successfully processed
- **Duplicate Rate**: % of duplicate transactions created
- **Transfer Detection Rate**: % of self-transfers correctly identified
- **Parsing Accuracy**: % of transactions with correct amount/merchant
- **Error Rate**: % of notifications that cause errors

## Success Criteria

The deployment is successful if:

- ✅ App builds and runs without crashes
- ✅ Notification access permission can be enabled
- ✅ At least 90% of notifications are processed correctly
- ✅ Duplicate rate is < 5%
- ✅ Self-transfer detection works in > 80% of cases
- ✅ No significant battery drain
- ✅ No memory leaks
- ✅ User feedback is positive

## Support & Troubleshooting

### For Users
Provide these instructions:

1. **Enable Permission**: Settings → Apps → Special access → Notification access
2. **Check Logs**: If issues persist, enable developer mode and share logs
3. **Fallback**: SMS processing still works if notification processing fails

### For Developers
Debug steps:

1. Check logcat for errors
2. Verify notification format matches expected patterns
3. Test with different app versions
4. Check Supabase for transaction data
5. Review regex patterns for parsing failures

## Next Steps After Deployment

1. **Monitor Performance**: Track metrics for 1-2 weeks
2. **Collect Feedback**: Ask users about accuracy and reliability
3. **Add More Apps**: Based on user requests
4. **Improve Parsing**: Update regex patterns based on failures
5. **Optimize Performance**: Reduce processing time if needed
6. **Add Features**: Consider ML-based parsing, action buttons, etc.

---

## Final Checklist

Before marking as complete:

- [ ] All code files created and tested
- [ ] Android build successful
- [ ] Notification permission enabled
- [ ] Test transactions processed correctly
- [ ] No duplicates created
- [ ] Self-transfers detected
- [ ] Logs show no errors
- [ ] Database entries correct
- [ ] Bank balances updated
- [ ] Documentation complete
- [ ] Rollback plan ready
- [ ] Monitoring plan in place

**Status**: Ready for deployment ✅

**Deployed By**: _________________

**Date**: _________________

**Notes**: _________________
