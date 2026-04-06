# Notification Listener - Quick Start

## What Was Implemented

A notification listener service that reads push notifications from UPI/Bank apps and automatically tracks transactions.

## Quick Setup (3 Steps)

### 1. Rebuild the App
```bash
cd android && ./gradlew clean && cd ..
npx react-native run-android
```

### 2. Enable Notification Access
- Open Android **Settings**
- Go to **Apps** → **Special access** → **Notification access**
- Enable for **SpendSense**

### 3. Test It
- Make a UPI payment using GPay/PhonePe
- Check if transaction appears in the app

## Supported Apps

✅ Google Pay  
✅ PhonePe  
✅ Slice  
✅ CRED  
✅ Amazon Pay  
✅ Paytm  
✅ WhatsApp (UPI)

## Key Features

- **Automatic Processing**: Notifications are processed in the background
- **Duplicate Prevention**: Won't create duplicates if SMS also arrives
- **Self-Transfer Detection**: Automatically detects transfers between your accounts
- **Same Logic as SMS**: Uses the existing `parseSms()` function

## Files Modified

```
✓ src/lib/NotificationProcessorTask.ts (NEW)
✓ android/.../NotificationListener.kt (NEW)
✓ android/.../NotificationProcessorService.kt (NEW)
✓ android/app/src/main/AndroidManifest.xml (UPDATED)
✓ index.js (UPDATED)
```

## How to Add More Apps

Edit `NotificationProcessorTask.ts`:

```typescript
const ALLOWED_PACKAGES = [
  'com.google.android.apps.nbu.paisa.user', // Google Pay
  'com.phonepe.app', // PhonePe
  'your.new.app.package', // Add here
];

const PACKAGE_TO_SENDER: { [key: string]: string } = {
  'com.google.android.apps.nbu.paisa.user': 'GPAYID',
  'com.phonepe.app': 'PHONEPE',
  'your.new.app.package': 'YOURAPP', // Add here
};
```

Also update `NotificationListener.kt` with the same package name.

## Debugging

Check if notifications are being received:
```bash
adb logcat | grep NotificationListener
```

Check if transactions are being processed:
```bash
adb logcat | grep "Transaction inserted"
```

## Common Issues

**Permission keeps getting disabled?**
- Add app to battery optimization whitelist
- Enable "Autostart" permission (Xiaomi/Oppo devices)

**Transactions not appearing?**
- Check if you're logged in
- Verify notification text matches expected format
- Check Supabase for errors

**Duplicates being created?**
- This shouldn't happen - the system has duplicate prevention
- Check logs to see if both SMS and notification are being processed

## Architecture

```
Notification → NotificationListener.kt → NotificationProcessorService.kt 
→ NotificationProcessorTask.ts → parseSms() → Supabase
```

## Next Steps

1. Test with different UPI apps
2. Monitor logs for any parsing failures
3. Add more apps if needed
4. Consider adding bank app notifications

---

For detailed documentation, see `NOTIFICATION_LISTENER_SETUP.md`
