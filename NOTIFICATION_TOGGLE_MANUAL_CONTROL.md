# Manual Notification Toggle Control

## Issue Fixed

The notification tracking toggle was not automatically detecting the permission state because we don't have a native module to check if notification access is enabled.

## Solution

The toggle now works **manually**. Here's how to use it:

### Steps to Enable Notification Tracking:

1. **In SpendSense app** → Go to Settings → Features section
2. **Tap the Notification Tracking toggle** (it will be OFF)
3. **Read the alert dialog** that appears
4. **Tap "Open Settings"**
5. **In Android Settings** → Find "SpendSense" → Toggle "Allow notification access" to ON
6. **Return to SpendSense app**
7. **Tap the Notification Tracking toggle again** to turn it ON
8. **Done!** The toggle will now show ON

### Important Notes:

- The toggle does NOT automatically detect the Android permission state
- You must **manually toggle it ON** after granting permission in Android Settings
- Once you toggle it ON in the app, it will stay ON (saved in app state)
- The notification listener will work as long as:
  - ✅ Android permission is granted (in Special Access)
  - ✅ Toggle is ON in SpendSense app

### How to Verify It's Working:

1. Make sure toggle is ON in SpendSense Settings
2. Make a test transaction with Slice or CRED
3. Check SpendSense dashboard - transaction should appear automatically
4. If it doesn't appear, check:
   - Android Settings → Special Access → Notification Access → SpendSense is ON
   - SpendSense Settings → Notification Tracking toggle is ON

### Debugging:

If transactions aren't being captured:

```bash
adb logcat | grep -E "NotificationListener|NotificationProcessor"
```

This will show if notifications are being received and processed.

## What Changed:

### Before:
- Toggle tried to auto-detect permission (didn't work)
- Toggle stayed OFF even after granting permission
- Confusing user experience

### After:
- Toggle is manual (user controls it)
- Clear instructions in alert dialog
- User toggles ON after granting permission
- Simple and straightforward

## Files Modified:

1. `src/utils/notificationPermissions.ts` - Removed native module check
2. `src/screens/Settings.tsx` - Made toggle manual, updated alert text

## Rebuild Required:

```bash
npm run android
```

After rebuilding:
1. Go to Settings in app
2. Toggle Notification Tracking (will show alert)
3. Grant permission in Android Settings
4. Return to app
5. Toggle ON manually
6. Test with a transaction!
