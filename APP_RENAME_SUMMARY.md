# App Rename: VaultApp → SpendSense

## Changes Completed

### 1. App Name
✅ `android/app/src/main/res/values/strings.xml` - Changed app_name to "SpendSense"
✅ `app.json` - Changed name and displayName to "SpendSense"

### 2. Package/Application ID
✅ `android/app/build.gradle` - Changed:
  - namespace: `com.vaultapp` → `com.spendsense`
  - applicationId: `com.vaultapp` → `com.spendsense`

### 3. Java/Kotlin Package Structure
✅ Moved directory: `android/app/src/main/java/com/vaultapp/` → `android/app/src/main/java/com/spendsense/`

✅ Updated package declarations in:
  - `MainActivity.kt` - package com.spendsense
  - `MainApplication.kt` - package com.spendsense
  - `SmsProcessorService.java` - package com.spendsense
  - `SmsReceiver.java` - package com.spendsense

### 4. React Native Component Name
✅ `MainActivity.kt` - Changed getMainComponentName() return value from "VaultApp" to "SpendSense"

## Next Steps

1. **Clean the project**:
   ```bash
   cd android
   .\gradlew clean
   cd ..
   ```

2. **Uninstall old app from device/emulator**:
   ```bash
   adb uninstall com.vaultapp
   ```

3. **Rebuild and run**:
   ```bash
   npx react-native run-android
   ```

## Important Notes

- The old app (com.vaultapp) and new app (com.spendsense) are treated as different apps
- You'll need to login again after installing the new app
- All data from the old app will remain in Supabase (it's user-based, not app-based)
- SMS permissions will need to be granted again for the new app

## Google Sign-In Update Required

If using Google Sign-In, you'll need to:
1. Go to Google Cloud Console
2. Add the new package name `com.spendsense` to your OAuth client
3. Get the new SHA-1 certificate fingerprint:
   ```bash
   cd android
   .\gradlew signingReport
   ```
4. Add the new SHA-1 to Google Console
