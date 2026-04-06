# Fix Android CMake Build Error

## Problem
CMake can't find codegen directories for native modules. This happens when:
- Spaces in path ("A:/Financial app/VaultApp")
- Missing codegen directories
- Stale build cache

## Quick Fix

### Option 1: Delete .cxx folder (Recommended)
```powershell
# Delete CMake cache
Remove-Item -Recurse -Force android/app/.cxx

# Clean build
cd android
./gradlew clean

# Run app
npx react-native run-android
```

### Option 2: Full Clean
```powershell
# Delete all build artifacts
Remove-Item -Recurse -Force android/app/build
Remove-Item -Recurse -Force android/app/.cxx
Remove-Item -Recurse -Force android/build

# Clean
cd android
./gradlew clean

# Run
npx react-native run-android
```

### Option 3: Nuclear Option (if above don't work)
```powershell
# Delete node_modules and reinstall
Remove-Item -Recurse -Force node_modules
npm install

# Delete all Android build files
Remove-Item -Recurse -Force android/app/build
Remove-Item -Recurse -Force android/app/.cxx
Remove-Item -Recurse -Force android/build

# Clean and rebuild
cd android
./gradlew clean
cd ..
npx react-native run-android
```

## For Icon Testing Only

Since you just want to see the new icon, you can:

### Use Existing APK
If you have a working APK already installed:
1. Icons are already generated ✅
2. Just rebuild when you have time
3. Or use Metro bundler with existing app

### Quick Test Command
```powershell
# Just run without clean (might work)
npx react-native run-android
```

The app might build successfully without clean, and you'll see the new icon!

## Root Cause

The error is because CMake expects codegen directories that don't exist yet. These are generated during the first build. The "Financial app" folder name with space might also cause issues.

## Prevention

For future projects, avoid spaces in folder paths:
- ❌ "A:/Financial app/VaultApp"
- ✅ "A:/FinancialApp/VaultApp"
- ✅ "A:/Projects/VaultApp"
