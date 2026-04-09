# First-Time Notification Permission Implementation

## Root Cause of Infinite Loop

The issue was in `src/lib/BackgroundEventHandler.ts`:
```typescript
// WRONG - This was opening settings automatically!
if (hasPermission === 'authorized') {
  await RNAndroidNotificationListener.requestPermission(); // ❌ Opens settings screen!
}
```

The `initializeBackgroundListeners()` function was being called:
1. On app start (App.tsx useEffect)
2. When app comes to foreground (App.tsx AppState listener)

Every time it ran, it called `requestPermission()` which opens the Android notification settings screen, even when permission was already granted!

## Fix Applied

Changed `BackgroundEventHandler.ts` to ONLY check permission status, NOT request it:
```typescript
// CORRECT - Only check, don't request
if (hasPermission === 'authorized') {
  console.log('✅ [Background] Notification listener permission granted');
  console.log('✅ [Background] Listener service is already active');
  // DO NOT call requestPermission() - service is automatically active!
}
```

## Changes Made

### 1. Removed Notification Toggle from Settings
- Removed notification tracking toggle switch from Settings screen
- Removed all AppState listeners and complex permission checking logic
- Removed test notification button
- Kept only SMS tracking toggle in Settings

### 2. Added First-Time Permission Dialog in App.tsx
When user opens the app for the first time (after login and profile setup):
- Checks if notification permission has been asked before using AsyncStorage key `notification_permission_asked`
- If not asked before and permission not granted, shows Android Alert dialog
- Dialog explains the feature and asks user if they want to enable it
- If user clicks "Enable", opens Android notification settings
- If user clicks "Not Now", marks as asked and doesn't show again
- Shows helpful toast message when opening settings

### 3. Fixed BackgroundEventHandler.ts
- Removed automatic call to `requestPermission()` when permission is already granted
- Now only checks permission status
- Service is automatically active when permission is granted - no need to call requestPermission()

## Implementation Details

### BackgroundEventHandler.ts Fix
```typescript
export async function initializeBackgroundListeners() {
  try {
    const hasPermission = await RNAndroidNotificationListener.getPermissionStatus();
    
    if (hasPermission === 'authorized') {
      // Just log - service is already active
      console.log('✅ [Background] Notification listener permission granted');
      // DO NOT call requestPermission() here!
    } else {
      console.log('⚠️ [Background] Notification listener permission not granted');
    }
  } catch (error) {
    console.error('❌ [Background] Error initializing listeners:', error);
  }
}
```

### App.tsx Changes
```typescript
// Added imports
import { checkNotificationPermission, requestNotificationPermission } from './src/utils/notificationPermissions';

// Added useEffect after handleProfileComplete
useEffect(() => {
  const checkFirstTimeNotificationPermission = async () => {
    // Only check if user is logged in and profile is complete
    if (!session || needsProfile) return;

    // Check if we've already asked
    const hasAskedBefore = await AsyncStorage.getItem('notification_permission_asked');
    if (hasAskedBefore === 'true') return;

    // Check if permission already granted
    const hasPermission = await checkNotificationPermission();
    if (hasPermission) {
      await AsyncStorage.setItem('notification_permission_asked', 'true');
      return;
    }

    // Show dialog
    Alert.alert(
      'Enable Transaction Tracking',
      'SpendSense can automatically track your transactions from notifications...',
      [
        {
          text: 'Not Now',
          onPress: async () => {
            await AsyncStorage.setItem('notification_permission_asked', 'true');
          },
        },
        {
          text: 'Enable',
          onPress: async () => {
            await AsyncStorage.setItem('notification_permission_asked', 'true');
            requestNotificationPermission();
            Toast.show({
              type: 'info',
              text1: 'Enable Notification Access',
              text2: 'Find "SpendSense" and toggle it ON',
            });
          },
        },
      ]
    );
  };

  // Small delay to ensure UI is ready
  const timer = setTimeout(() => {
    checkFirstTimeNotificationPermission();
  }, 1000);

  return () => clearTimeout(timer);
}, [session, needsProfile]);
```

### Settings.tsx Changes
- Removed all notification-related imports
- Removed notification tracking state variables
- Removed AppState listener
- Removed notification toggle handler
- Removed test notification function
- Removed notification UI elements
- Kept only SMS tracking functionality

## User Flow

1. User logs in for the first time
2. User completes profile setup
3. App loads main screen
4. After 1 second delay, dialog appears asking about notification tracking
5. User can choose:
   - "Enable" → Opens Android notification settings
   - "Not Now" → Dialog won't show again
6. If user enables in settings and returns to app, transactions will be tracked automatically
7. User can't disable from app - must go to Android settings manually

## Benefits

1. **No infinite loop** - Permission only requested once on first launch via dialog
2. **No automatic settings opening** - BackgroundEventHandler doesn't call requestPermission()
3. **Clear user intent** - User explicitly chooses to enable or skip
4. **Simple UX** - No toggle to manage, no complex state
5. **One-time setup** - Dialog shows only once, never again
6. **Automatic tracking** - Once enabled, works in background without user intervention

## Files Modified
1. `App.tsx` - Added first-time permission dialog
2. `src/screens/Settings.tsx` - Removed notification toggle
3. `src/lib/BackgroundEventHandler.ts` - Removed automatic requestPermission() call

## Testing Instructions

1. Fresh install or clear app data
2. Login and complete profile
3. Wait 1 second on main screen
4. Dialog should appear asking about notification tracking
5. Click "Enable" → Android settings should open
6. Enable notification access for SpendSense
7. Return to app → Settings screen should NOT open automatically
8. Close and reopen app → Settings screen should NOT open automatically
9. Dialog should NOT appear again

## AsyncStorage Keys Used
- `notification_permission_asked` - Boolean string ('true'/'false') to track if we've asked user before
