# Notification Permission Loop Fix

## Problem
The app was stuck in an infinite loop where the Android Notification Access settings screen would automatically open every time the app came to the foreground, even after the user pressed back or closed the app.

## Root Causes Identified

### 1. Toggle State Change Triggering Handler
When the permission check succeeded and called `setNotificationTrackingEnabled(true)`, the Switch component's `onValueChange` handler was triggered, which called `handleToggleNotificationTracking(true)` again. This caused `requestNotificationPermission()` to open the settings screen repeatedly.

### 2. Complex AppState Logic
The `handleAppStateChange` function had complex time-based logic that was trying to determine if the user just came back from settings, but this logic was unreliable and could still trigger automatic settings opening.

## Solution Implemented

### 1. Added `isUpdatingFromPermissionCheck` Flag
- New ref flag that prevents the toggle handler from running when we're updating the toggle state programmatically
- Set to `true` before calling `setNotificationTrackingEnabled()`
- Cleared after 500ms to allow normal toggle behavior
- Prevents circular loop: permission check → set toggle → handler ignores → no settings open

### 2. Simplified AppState Listener
The `handleAppStateChange` function now:
- **ONLY** checks permission status when app comes to foreground
- **ONLY** updates the UI toggle to reflect actual permission state
- **NEVER** opens settings automatically
- Shows success toast only if user just came back from settings (`wentToSettings` flag is true)
- Clears all flags when app goes to background

### 3. Simplified Toggle Handler
The `handleToggleNotificationTracking` function now:
- Checks `isUpdatingFromPermissionCheck` flag and returns early if set
- Opens settings ONLY when user explicitly taps the toggle
- Removed complex "already opening settings" check
- Removed time-based logic

## Key Principle
**`requestNotificationPermission()` is ONLY called inside the toggle handler (user action), NEVER in lifecycle hooks or AppState listeners.**

## Files Modified
- `src/screens/Settings.tsx`

## Testing Instructions
1. Toggle notification tracking ON
2. Settings screen opens
3. Press back button
4. App should return to Settings screen WITHOUT automatically opening notification settings again
5. Close app completely
6. Reopen app
7. App should NOT automatically open notification settings

## Code Changes Summary

### Added Flag
```typescript
const isUpdatingFromPermissionCheck = useRef(false);
```

### AppState Listener - Before
- Complex time-based logic
- Could open settings automatically
- Multiple conditions and checks

### AppState Listener - After
```typescript
// ONLY check permission and update UI - NEVER open settings automatically
const hasPermission = await checkNotificationPermission();
isUpdatingFromPermissionCheck.current = true;
setNotificationTrackingEnabled(hasPermission);
saveNotificationStatus(hasPermission);
setTimeout(() => {
  isUpdatingFromPermissionCheck.current = false;
}, 500);
```

### Toggle Handler - Before
- Could be triggered by state changes
- Had "already opening settings" check
- Complex error handling

### Toggle Handler - After
```typescript
// If we're updating from permission check, ignore this toggle event
if (isUpdatingFromPermissionCheck.current) {
  return;
}
// Only open settings when user explicitly toggles
requestNotificationPermission();
```

## Result
The infinite loop is fixed. Settings screen only opens when user explicitly taps the toggle, and the app correctly updates the toggle state based on actual permission status without triggering the loop.
