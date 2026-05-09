# Persistent Permission Prompts Implementation

## Overview
Implemented Zomato/Swiggy-style persistent permission prompts that appear every time the app opens until ALL permissions are granted.

## Features

### 3-Step Permission Flow
1. **SMS Permission** - For bank SMS transaction tracking
2. **Notification Listener Permission** - For UPI app notifications (GPay, PhonePe, etc.)
3. **Push Notification Permission** - For app's own notifications (reminders, alerts)

### Key Behaviors
- ✅ Shows on every app open if any permission is missing
- ✅ Checks actual permissions, ignores skip button
- ✅ Progress dots show which permissions are granted (green) vs pending (gray)
- ✅ Step-by-step flow - completes one permission before moving to next
- ✅ Re-checks when app comes to foreground (AppState listener)
- ✅ Only marks complete when ALL THREE permissions granted
- ✅ Skip button just closes modal, doesn't mark as complete

### UI/UX
- Beautiful modal with icons and descriptions
- Feature lists for each permission type
- Progress indicator with 3 dots (green = granted, gray = pending)
- Accent color theming
- Non-dismissible until all granted (no back button close)

## Implementation Details

### Files Modified
1. **src/components/PermissionPrompt.tsx** (NEW)
   - Main component with 3-step permission flow
   - Uses Notifee for push notifications
   - Checks permissions on mount and when visible changes

2. **App.tsx**
   - Integrated PermissionPrompt component
   - AppState listener toggles `showPermissionPrompt` state to force re-check
   - Uses `key` prop to force component re-mount and re-check permissions

3. **src/components/index.ts**
   - Exported PermissionPrompt component

### Permission Checks
```typescript
// SMS Permission
const sms = await checkSmsPermissions();

// Notification Listener Permission
const notification = await checkNotificationPermission();

// Push Notification Permission (Notifee)
const pushSettings = await notifee.getNotificationSettings();
const push = pushSettings.authorizationStatus === 1; // 1 = AUTHORIZED
```

### Flow Logic
```
App Opens
  ↓
Check All 3 Permissions
  ↓
All Granted? → Hide prompt, mark complete
  ↓
Missing SMS? → Show SMS step
  ↓
SMS Granted? → Move to Notification step
  ↓
Notification Granted? → Move to Push step
  ↓
Push Granted? → Hide prompt, mark complete
  ↓
User Skips? → Close modal (will reappear on next app open)
```

### AppState Integration
```typescript
AppState.addEventListener('change', (nextAppState) => {
  if (nextAppState === 'active') {
    // Toggle state to force PermissionPrompt re-check
    setShowPermissionPrompt(prev => !prev);
  }
});
```

## Testing Checklist
- [ ] Install fresh app → Should show SMS permission first
- [ ] Grant SMS → Should move to Notification permission
- [ ] Grant Notification → Should move to Push permission
- [ ] Grant Push → Should hide and not show again
- [ ] Skip at any step → Should close but reappear on next app open
- [ ] Go to settings and revoke permission → Should reappear on next app open
- [ ] Progress dots should show 3 dots (SMS, Notification, Push)
- [ ] Granted permissions should show green dots
- [ ] Pending permissions should show gray dots

## User Experience
This implementation ensures users never forget to enable critical permissions. Unlike one-time prompts that can be dismissed and forgotten, this persistent approach guarantees users will eventually grant permissions or consciously choose to skip them every time they open the app.

Similar to how Zomato and Swiggy handle location permissions, this creates a gentle but persistent nudge that improves feature adoption without being overly aggressive.
