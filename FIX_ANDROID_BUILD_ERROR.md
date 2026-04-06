# Fix Android Build Error - CMake/Codegen Issue

## Error Summary

```
CMake Error: add_subdirectory given source which is not an existing directory
- react-native-async-storage
- react-native-google-signin
- react-native-vector-icons
```

## Root Cause

The Android build system is looking for codegen directories that haven't been generated yet. This happens after:
1. Installing new packages
2. Cleaning the build
3. Gradle cache issues

## Solution

### Quick Fix (Try This First)

```bash
# 1. Navigate to android folder
cd android

# 2. Clean everything
./gradlew clean

# 3. Go back to root
cd ..

# 4. Delete build folders
rm -rf android/app/build
rm -rf android/app/.cxx

# 5. Rebuild
npm run android
```

### Full Fix (If Quick Fix Doesn't Work)

```bash
# 1. Stop Metro bundler (Ctrl+C)

# 2. Clean everything
cd android
./gradlew clean
./gradlew cleanBuildCache
cd ..

# 3. Remove build artifacts
rm -rf android/app/build
rm -rf android/app/.cxx
rm -rf android/.gradle
rm -rf android/build

# 4. Remove node_modules and reinstall
rm -rf node_modules
npm install

# 5. Clear Metro cache
npx react-native start --reset-cache

# 6. In new terminal, rebuild
npm run android
```

## Windows-Specific Commands

If you're on Windows and `rm -rf` doesn't work:

```bash
# Use PowerShell or CMD

# Delete folders
rmdir /s /q android\app\build
rmdir /s /q android\app\.cxx
rmdir /s /q android\.gradle
rmdir /s /q android\build
rmdir /s /q node_modules

# Reinstall
npm install

# Rebuild
npm run android
```

## Alternative: Gradle Sync

Sometimes just syncing Gradle fixes it:

```bash
cd android
./gradlew --refresh-dependencies
cd ..
npm run android
```

## Step-by-Step Fix

### Step 1: Clean Build

```bash
cd android
./gradlew clean
cd ..
```

### Step 2: Delete Build Artifacts

```bash
# On Mac/Linux
rm -rf android/app/build
rm -rf android/app/.cxx

# On Windows (PowerShell)
Remove-Item -Recurse -Force android\app\build
Remove-Item -Recurse -Force android\app\.cxx
```

### Step 3: Reinstall Dependencies

```bash
rm -rf node_modules
npm install
```

### Step 4: Rebuild

```bash
npm run android
```

## If Still Failing

### Option 1: Invalidate Caches

```bash
# Delete all caches
rm -rf $TMPDIR/react-*
rm -rf $TMPDIR/metro-*
rm -rf $TMPDIR/haste-*

# On Windows
# Delete: C:\Users\YourName\AppData\Local\Temp\react-*
# Delete: C:\Users\YourName\AppData\Local\Temp\metro-*
```

### Option 2: Fresh Install

```bash
# 1. Delete everything
rm -rf node_modules
rm -rf android/app/build
rm -rf android/app/.cxx
rm -rf android/.gradle
rm -rf android/build

# 2. Reinstall
npm install

# 3. Clean
cd android
./gradlew clean
cd ..

# 4. Rebuild
npm run android
```

### Option 3: Check Package Versions

Make sure these packages are properly installed:

```bash
npm list @react-native-async-storage/async-storage
npm list @react-native-google-signin/google-signin
npm list react-native-vector-icons
```

If any are missing or have issues:

```bash
npm install @react-native-async-storage/async-storage
npm install @react-native-google-signin/google-signin
npm install react-native-vector-icons
```

## Gradle Commands Reference

```bash
cd android

# Clean build
./gradlew clean

# Clean build cache
./gradlew cleanBuildCache

# Refresh dependencies
./gradlew --refresh-dependencies

# Build debug
./gradlew assembleDebug

# Install debug
./gradlew installDebug

cd ..
```

## Common Causes

1. **Incomplete npm install** - Some packages didn't install properly
2. **Gradle cache corruption** - Old cached files causing issues
3. **Build artifacts** - Old build files interfering
4. **Path issues** - Spaces in path ("Financial app") can cause issues

## Path Issue Fix

Your project path has a space: `A:\Financial app\VaultApp`

This can cause CMake issues. Consider:

1. **Rename folder** (remove space):
   ```
   A:\Financial app\VaultApp → A:\FinancialApp\VaultApp
   ```

2. **Or use quotes in paths** (Gradle should handle this automatically)

## Recommended Solution

```bash
# Complete clean and rebuild

# 1. Stop Metro
# Press Ctrl+C

# 2. Clean Android
cd android
./gradlew clean
cd ..

# 3. Delete build folders
rmdir /s /q android\app\build
rmdir /s /q android\app\.cxx

# 4. Reinstall node_modules
rmdir /s /q node_modules
npm install

# 5. Start fresh
npm run android
```

## Verification

After fixing, you should see:

```
✅ BUILD SUCCESSFUL
✅ App installed on device
✅ Metro bundler running
✅ App launches without errors
```

## Prevention

To avoid this in the future:

1. Always run `./gradlew clean` before major changes
2. Clear build folders when switching branches
3. Keep dependencies up to date
4. Avoid spaces in project paths

## Summary

**Quick Fix:**
```bash
cd android && ./gradlew clean && cd ..
rm -rf android/app/build android/app/.cxx
npm run android
```

**Full Fix:**
```bash
rm -rf node_modules android/app/build android/app/.cxx
npm install
cd android && ./gradlew clean && cd ..
npm run android
```

---

**This is a build cache issue, not a code issue. A clean rebuild will fix it!** ✅
