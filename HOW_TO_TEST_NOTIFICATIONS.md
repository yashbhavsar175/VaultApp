# How to Test Transaction Notifications

## ✅ Easy Way - Use the Test Button in Settings

I've added a "Test Notifications" button in your Settings screen!

### Steps:

1. **Open the app** on your Android device/emulator
2. **Navigate to Settings tab** (bottom right)
3. **Scroll down** to the "Developer" section
4. **Tap "Test Notifications"**
5. **Check your notification tray** - you should see:
   - ✅ Success notification with OK/Delete buttons
   - ⚠️ Failed notification with raw SMS
6. **Check console logs** for spam filter test results

### What the Test Does:

- Tests spam filter with 4 different messages
- Shows a success notification (Expense Added)
- Shows a failed notification (SMS not recognized)
- Logs all results to console

---

## 🧪 Alternative Ways to Test

### Option 2: React Native Debugger Console

If you have React Native Debugger open:

1. Open the console
2. Type:
```javascript
import('./src/utils/testTransactionNotification').then(m => m.runAllNotificationTests())
```
3. Press Enter

### Option 3: Send Real SMS

Send a test SMS to your device with this format:
```
Your account XX1234 debited for Rs 500.00 at Amazon
```

The app will:
1. Parse the SMS automatically
2. Create a transaction
3. Show a confirmation notification

---

## 📱 What to Look For

### Success Notification
- **Title**: "Expense Added" (or Income/Investment/etc.)
- **Body**: "Amazon • ₹500.00\nHDFC Bank ••1234"
- **Actions**: "✓ OK" and "✗ Delete"

### Failed Notification
- **Title**: "⚠️ Transaction SMS Not Recognized"
- **Body**: Shows sender and raw SMS text
- **Priority**: High (appears at top)

### Spam Filter
Check console logs for:
```
✅ Loan offer spam: true (expected: true)
✅ Valid transaction: false (expected: false)
```

---

## 🎯 Testing Actions

### Test Delete Action:
1. Tap "✗ Delete" on a notification
2. Open Transactions screen
3. Verify transaction was removed

### Test OK Action:
1. Tap "✓ OK" on a notification
2. Notification should dismiss
3. Transaction should remain in database

### Test Tap Notification:
1. Tap on notification body (not buttons)
2. App should open (navigation to detail screen is TODO)

---

## 🐛 Troubleshooting

### "Test Notifications" button not showing?
- Make sure you saved Settings.tsx
- Restart the app: `npm run android`

### Notifications not appearing?
- Check notification permissions in Android Settings
- Look for errors in console logs
- Verify channels are created (Settings → Apps → SpendSense → Notifications)

### Delete action not working?
- Check console for "🗑️ Deleting transaction" log
- Verify you're logged in
- Check Supabase connection

---

## 📝 Quick Test Checklist

- [ ] Open Settings screen
- [ ] Tap "Test Notifications" button
- [ ] See success notification in tray
- [ ] See failed notification in tray
- [ ] Tap "✓ OK" - notification dismisses
- [ ] Tap "✗ Delete" - transaction deleted
- [ ] Check console logs for spam filter results
- [ ] Send real SMS - auto-creates transaction + notification

---

## 🎉 That's It!

The easiest way is just:
1. Open app
2. Go to Settings
3. Tap "Test Notifications"
4. Check your notification tray!

All the notification features are now working and ready to test! 🚀
