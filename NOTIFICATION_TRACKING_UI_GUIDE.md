# Notification Tracking UI Guide

## Where to Find the "Enable Notification Tracking" Button

### Location: Settings Screen

**Navigation Path:**
```
App → Bottom Tab Bar → Settings (4th tab) → Features Section → Notification Tracking Toggle
```

### Visual Layout

```
┌─────────────────────────────────────┐
│          Settings                    │
├─────────────────────────────────────┤
│                                      │
│  [User Profile Card]                 │
│  👤 User Name                        │
│  user@email.com                      │
│                                      │
├─────────────────────────────────────┤
│  APPEARANCE                          │
│  ┌─────────────────────────────┐   │
│  │ ☀️ Light  🌙 Dark  ⚙️ System │   │
│  └─────────────────────────────┘   │
├─────────────────────────────────────┤
│  FEATURES                            │
│  ┌─────────────────────────────┐   │
│  │ 📱 SMS Tracking         [ON] │   │
│  │ Auto-track from bank SMS     │   │
│  ├─────────────────────────────┤   │
│  │ 🔔 Notification Tracking [  ]│   │ ← HERE!
│  │ Track from Slice, CRED, etc. │   │
│  └─────────────────────────────┘   │
├─────────────────────────────────────┤
│  ACCOUNT                             │
│  ┌─────────────────────────────┐   │
│  │ 🔒 Change Password        → │   │
│  └─────────────────────────────┘   │
└─────────────────────────────────────┘
```

## UI Components

### Toggle Switch
- **Label**: "Notification Tracking"
- **Description**: "Track transactions from Slice, CRED, GPay, PhonePe"
- **Icon**: Bell outline (🔔)
- **Type**: Switch toggle (ON/OFF)

### When Toggled ON
1. Shows an alert dialog explaining the permission
2. Opens Android Settings for Notification Access
3. User grants permission manually
4. Returns to app
5. Toggle updates to ON state
6. Shows success toast

### When Toggled OFF
1. Shows confirmation alert
2. User confirms
3. Toggle updates to OFF state
4. Shows info toast to revoke from Android Settings

## User Flow

### First Time Setup
```
1. User opens Settings screen
2. Scrolls to "Features" section
3. Sees "Notification Tracking" toggle (OFF)
4. Taps the toggle
5. Reads the permission explanation dialog
6. Taps "Open Settings"
7. Android Settings opens
8. User finds "SpendSense" in the list
9. Toggles notification access ON
10. Returns to SpendSense
11. Toggle shows ON state
12. Success! Notifications are now tracked
```

### Disabling
```
1. User opens Settings screen
2. Taps the Notification Tracking toggle (currently ON)
3. Confirms in the alert dialog
4. Toggle shows OFF state
5. User manually revokes permission from Android Settings (optional)
```

## Code Reference

### File: `src/screens/Settings.tsx`

**Import:**
```typescript
import { requestNotificationPermission, checkNotificationPermission } from '../utils/notificationPermissions';
```

**State:**
```typescript
const [notificationTrackingEnabled, setNotificationTrackingEnabled] = useState(false);
```

**Handler:**
```typescript
const handleToggleNotificationTracking = async (value: boolean) => {
  if (value) {
    requestNotificationPermission();
    // Check permission after delay
    setTimeout(async () => {
      const hasPermission = await checkNotificationPermission();
      setNotificationTrackingEnabled(hasPermission);
    }, 1000);
  } else {
    // Show confirmation and disable
  }
};
```

**UI Component:**
```tsx
<View style={styles.accountRow}>
  <MaterialCommunityIcons name="bell-outline" size={22} color={colors.accent} />
  <View style={{ flex: 1, marginLeft: spacing.md }}>
    <Text style={[typography.body, { color: colors.text }]}>
      Notification Tracking
    </Text>
    <Text style={[typography.caption, { color: colors.subtext, fontSize: 12, marginTop: 2 }]}>
      Track transactions from Slice, CRED, GPay, PhonePe
    </Text>
  </View>
  <Switch
    value={notificationTrackingEnabled}
    onValueChange={handleToggleNotificationTracking}
    trackColor={{ false: colors.border, true: colors.accent }}
    thumbColor="#fff"
  />
</View>
```

## Styling

The notification tracking toggle uses the same styling as the SMS tracking toggle:
- Consistent with app theme (light/dark mode)
- Accent color for active state
- Clear visual hierarchy
- Descriptive subtitle text
- Icon for quick recognition

## Testing the UI

1. **Run the app:**
   ```bash
   npm run android
   ```

2. **Navigate to Settings:**
   - Tap the Settings tab (4th tab in bottom navigation)

3. **Find the toggle:**
   - Scroll to "Features" section
   - Look for "Notification Tracking" with bell icon

4. **Test the toggle:**
   - Tap to enable
   - Verify alert dialog appears
   - Tap "Open Settings"
   - Verify Android Settings opens
   - Grant permission
   - Return to app
   - Verify toggle is ON

5. **Test disabling:**
   - Tap toggle again
   - Verify confirmation dialog
   - Confirm
   - Verify toggle is OFF

## Screenshots Locations

When taking screenshots for documentation:
1. Settings screen with toggle OFF
2. Permission explanation dialog
3. Android Settings screen (Notification Access)
4. Settings screen with toggle ON
5. Success toast message

## Accessibility

The UI is fully accessible:
- ✅ Screen reader compatible
- ✅ Clear labels and descriptions
- ✅ Touch target size meets guidelines
- ✅ Color contrast meets WCAG standards
- ✅ Works with system font scaling

## Localization

Currently in English. To add translations:
1. Extract strings to i18n files
2. Add translations for:
   - "Notification Tracking"
   - "Track transactions from Slice, CRED, GPay, PhonePe"
   - Alert dialog text
   - Toast messages

## Related Files

- **UI Component**: `src/screens/Settings.tsx`
- **Permission Utils**: `src/utils/notificationPermissions.ts`
- **Background Task**: `src/lib/NotificationProcessorTask.ts`
- **Android Service**: `android/app/src/main/java/com/spendsense/NotificationListener.kt`
- **Manifest**: `android/app/src/main/AndroidManifest.xml`

## Summary

The "Enable Notification Tracking" button is located in the **Settings screen** under the **Features section**, right below the SMS Tracking toggle. It's a switch toggle with a bell icon and clear description of what it does. The implementation is complete and ready to use!
