# Transaction Notification Testing Guide

## Quick Test

To test the notification system, you can use the test utilities:

### 1. Test from React Native Debugger Console

```javascript
// Import the test functions
import { runAllNotificationTests } from './src/utils/testTransactionNotification';

// Run all tests
runAllNotificationTests();
```

### 2. Test Individual Functions

```javascript
import { 
  testSuccessNotification, 
  testFailedNotification, 
  testSpamFilter 
} from './src/utils/testTransactionNotification';

// Test success notification
await testSuccessNotification();

// Test failed notification
await testFailedNotification();

// Test spam filter
testSpamFilter();
```

## Manual Testing

### Test Confirmation Notification

1. Send a test SMS or trigger a notification with valid transaction data
2. Wait for auto-parse to complete
3. Check notification tray for confirmation notification
4. Verify:
   - Title shows transaction type (e.g., "Expense Added")
   - Body shows merchant, amount, and account
   - Two action buttons: "✓ OK" and "✗ Delete"

### Test Delete Action

1. Tap "✗ Delete" on confirmation notification
2. Open app and check Transactions screen
3. Verify transaction was deleted from database

### Test OK Action

1. Tap "✓ OK" on confirmation notification
2. Verify notification is dismissed
3. Open app and check Transactions screen
4. Verify transaction still exists

### Test Failed Notification

1. Send SMS with valid amount but no merchant info
2. Wait for auto-parse to complete
3. Check notification tray for failure notification
4. Verify:
   - Title: "⚠️ Transaction SMS Not Recognized"
   - Body shows sender and raw SMS snippet
   - No transaction created in database

### Test Spam Filter

Send these test SMS messages and verify they are skipped:

```
"Get your instant loan offer! Apply now."
"Limited time offer! Click here to claim."
"Congratulations! You are pre-approved for a loan."
```

Check logs for:
```
⚠️ SMS identified as spam/promo - skipping parse
```

### Test Valid Transactions

Send these test SMS messages and verify they create transactions:

```
"Your account XX1234 debited for Rs 500.00 at Amazon"
"INR 1000.00 credited to A/c XX5678. Balance: Rs 5000.00"
"Rs 250.00 debited from card XX9999 for UPI payment"
```

## Notification Channels

Check Android Settings → Apps → SpendSense → Notifications:

1. **Transaction Confirmations** (sms_parsed)
   - Priority: Default
   - Sound: Enabled
   - Vibration: Enabled

2. **SMS Parsing Failures** (sms_failed)
   - Priority: High
   - Sound: Enabled
   - Vibration: Enabled

## Expected Logs

### Successful Parse
```
SMS Processor Task Started
✅ Parsed Transaction: { amount: 500, type: 'debit', merchant: 'Amazon' }
Transaction inserted successfully
✅ Transaction confirmation notification shown for txn-123
```

### Failed Parse (Unknown Merchant)
```
SMS Processor Task Started
Merchant is null or Unknown - firing SMS failed notification
✅ SMS failed notification displayed
```

### Spam Detected
```
SMS Processor Task Started
⚠️ SMS identified as spam/promo - skipping parse
Spam SMS body: Get your instant loan offer...
```

### Delete Action
```
🔔 [Background] Notifee event received: ACTION_PRESS
🔔 [Transaction Notification] Action pressed: delete
🗑️ Deleting transaction: txn-123
✅ Transaction deleted successfully
```

## Troubleshooting

### Notifications Not Showing

1. Check notification permissions:
   ```bash
   adb shell dumpsys notification_listener
   ```

2. Verify channels are created:
   - Open Android Settings → Apps → SpendSense → Notifications
   - Should see "Transaction Confirmations" and "SMS Parsing Failures"

3. Check logs for errors:
   ```bash
   npx react-native log-android | grep -i notif
   ```

### Delete Action Not Working

1. Check background event handler is registered:
   - Look for "✅ [Index] Notifee background event handler registered" in logs

2. Verify Supabase connection:
   - Check if user is authenticated
   - Verify RLS policies allow deletion

3. Check transaction ID is passed:
   - Look for "Transaction ID: txn-123" in logs

### Spam Filter Too Aggressive

If valid transactions are being filtered:

1. Check the SMS text against spam keywords in `transactionNotifications.ts`
2. Remove or modify keywords as needed
3. Restart app to apply changes

### Spam Filter Not Working

If spam messages are getting through:

1. Add more keywords to `SPAM_KEYWORDS` array
2. Make keywords more specific
3. Test with `testSpamFilter()` function

## Production Checklist

Before deploying to production:

- [ ] Test all notification types (success, failure, spam)
- [ ] Test all actions (OK, Delete, tap notification)
- [ ] Test with app in foreground, background, and closed
- [ ] Verify notification channels are created
- [ ] Test spam filter with real promotional SMS
- [ ] Verify delete action removes transaction from DB
- [ ] Test with multiple transactions in quick succession
- [ ] Verify no duplicate notifications
- [ ] Check notification appearance in light/dark mode
- [ ] Test on different Android versions (if possible)

## Performance Notes

- Notifications are shown immediately after transaction insert
- Delete action is processed in background (no UI freeze)
- Spam filter runs before parsing (minimal overhead)
- Notification channels are created once and reused

## Security Notes

- Transaction IDs are passed in notification data (not visible to user)
- Delete action requires valid transaction ID
- RLS policies ensure users can only delete their own transactions
- No sensitive data (full account numbers, passwords) in notifications
