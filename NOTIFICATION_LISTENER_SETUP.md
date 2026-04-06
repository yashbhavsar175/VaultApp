# Notification Listener Setup Guide

This guide explains how to set up the Notification Listener service to automatically track transactions from UPI/Bank app notifications (GPay, PhonePe, Slice, CRED, etc.).

## Overview

The Notification Listener service reads push notifications from financial apps and processes them using the same transaction logic as SMS processing. This provides a backup method for transaction tracking when SMS permissions are restricted or unavailable.

## Architecture

```
UPI/Bank App Notification
    ↓
NotificationListener.kt (filters allowed apps)
    ↓
NotificationProcessorService.kt (headless service)
    ↓
NotificationProcessorTask.ts (JavaScript processing)
    ↓
Existing parseSms() logic
    ↓
Supabase Database
```

## Files Created/Modified

### 1. New Files

- **src/lib/NotificationProcessorTask.ts** - Main notification processing logic
- **android/app/src/main/java/com/spendsense/NotificationListener.kt** - Native notification listener
- **android/app/src/main/java/com/spendsense/NotificationProcessorService.kt** - Headless JS service bridge

### 2. Modified Files

- **android/app/src/main/AndroidManifest.xml** - Added notification listener permissions and service declarations
- **index.js** - Registered the NotificationProcessor headless task

## Supported Apps

The following app packages are whitelisted for notification processing:

| App Name | Package Name |
|----------|-------------|
| Google Pay | `com.google.android.apps.nbu.paisa.user` |
| PhonePe | `com.phonepe.app` |
| Slice | `tech.ula` |
| CRED | `com.dreamplug.androidapp` |
| Amazon Pay | `in.amazon.mShop.android.shopping` |
| Paytm | `net.one97.paytm` |
| WhatsApp (UPI) | `com.whatsapp` |

## Setup Instructions

### Step 1: Build the App

After the code changes, rebuild your Android app:

```bash
cd android
./gradlew clean
cd ..
npx react-native run-android
```

### Step 2: Enable Notification Access

The app needs special permission to read notifications:

1. Open your Android device **Settings**
2. Navigate to **Apps & notifications** → **Special app access** → **Notification access**
3. Find your app (SpendSense) in the list
4. Toggle the switch to **ON**
5. Confirm the permission dialog

**Alternative path (varies by device):**
- Settings → Security & privacy → Notification access
- Settings → Apps → Special access → Notification access

### Step 3: Verify Setup

To verify the notification listener is working:

1. Open the app and ensure you're logged in
2. Make a test UPI transaction using GPay, PhonePe, or any supported app
3. Check if the transaction appears in your SpendSense dashboard
4. Check Android logs for confirmation:

```bash
adb logcat | grep NotificationListener
```

You should see logs like:
```
NotificationListener: Notification from com.phonepe.app: Payment Successful - Rs 100 paid to...
```

## How It Works

### 1. Notification Filtering

When any notification arrives, `NotificationListener.kt` checks if it's from an allowed package:

```kotlin
private val ALLOWED_PACKAGES = setOf(
    "com.google.android.apps.nbu.paisa.user",
    "com.phonepe.app",
    // ... other apps
)
```

### 2. Data Extraction

The listener extracts:
- Package name (identifies the app)
- Title (notification title)
- Text (notification body)
- Timestamp (when notification was posted)

### 3. Processing

The data is passed to `NotificationProcessorTask.ts` which:

1. Combines title + text into a single string
2. Maps package name to a sender ID (e.g., `com.phonepe.app` → `PHONEPE`)
3. Passes the combined text through the existing `parseSms()` function
4. Extracts transaction details (amount, type, merchant, reference, etc.)
5. Checks for duplicates and self-transfers
6. Inserts the transaction into Supabase

### 4. Self-Transfer Detection

The notification processor includes the same self-transfer detection logic as SMS:

- **UTR Matching**: Matches transactions by UPI reference number
- **Time Window**: Looks for opposite transactions within 3 minutes
- **Retry Logic**: Waits 2 seconds and retries if no match found (handles simultaneous notifications)

## Duplicate Prevention

The system prevents duplicate transactions from multiple sources:

1. **SMS + Notification**: If both arrive, only one transaction is created
2. **Multiple Notifications**: Duplicate check within 5-minute window
3. **Source Priority**: Bank SMS takes priority over UPI notifications

## Troubleshooting

### Notifications Not Being Processed

1. **Check Permission**: Ensure notification access is enabled in Settings
2. **Check Logs**: Run `adb logcat | grep NotificationListener` to see if notifications are being received
3. **Verify Package Name**: Some apps may have different package names on different devices

### Transactions Not Appearing

1. **Check User Session**: Ensure you're logged in (check AsyncStorage for `app_user_id`)
2. **Check Parsing**: The notification text must match the regex patterns in `parseNotification()`
3. **Check Database**: Verify the transaction was inserted in Supabase

### Permission Keeps Getting Disabled

Some Android devices (especially Xiaomi, Oppo) aggressively disable notification access:

1. Add the app to battery optimization whitelist
2. Enable "Autostart" permission
3. Disable battery saver for the app

## Testing

### Manual Testing

1. Send yourself money via UPI
2. Check if notification appears
3. Verify transaction in SpendSense dashboard

### Debug Logs

Enable detailed logging by checking Android Logcat:

```bash
# Filter for notification processing
adb logcat | grep -E "NotificationListener|NotificationProcessor"

# Filter for transaction insertion
adb logcat | grep "Transaction inserted"
```

## Security & Privacy

- **Local Processing**: All notification data is processed locally on the device
- **Filtered Apps**: Only financial app notifications are read
- **No Storage**: Notification content is not stored, only parsed transaction data
- **User Control**: Users can revoke notification access anytime from Settings

## Limitations

1. **Android Only**: iOS does not allow apps to read other apps' notifications
2. **Permission Required**: Users must manually enable notification access
3. **Format Dependent**: Only works if notification text matches expected patterns
4. **Device Specific**: Some manufacturers restrict notification access

## Future Enhancements

Possible improvements:

1. Add more UPI apps (Bhim, Freecharge, etc.)
2. Support bank app notifications (HDFC, ICICI, etc.)
3. Add ML-based parsing for non-standard notification formats
4. Implement notification action buttons (categorize, edit, delete)

## Related Files

- **SMS Processing**: `src/lib/SmsProcessorTask.ts`
- **Transaction Logic**: Shared between SMS and notification processing
- **Database Schema**: `supabase-sms-tracking.sql`

## Support

If you encounter issues:

1. Check the logs using `adb logcat`
2. Verify notification access permission
3. Test with a known working app (GPay or PhonePe)
4. Check if SMS processing works (to isolate the issue)

---

**Note**: This feature complements SMS-based tracking and provides redundancy. Both systems can work simultaneously without creating duplicate transactions.
