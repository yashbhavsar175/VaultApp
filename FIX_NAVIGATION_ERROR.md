# Fix Navigation Error

## Error Message

```
Error: Unable to resolve module @react-navigation/native from Dashboard.tsx
```

## Root Cause

The error occurs because:
1. We added `@react-navigation/stack` to the project
2. The Metro bundler cache needs to be cleared
3. The app needs to be rebuilt

## Solution

### Step 1: Install Dependencies

Make sure all navigation dependencies are installed:

```bash
npm install @react-navigation/stack
```

Or with yarn:

```bash
yarn add @react-navigation/stack
```

### Step 2: Clear Metro Cache

```bash
# Stop the Metro bundler (Ctrl+C)

# Clear Metro cache
npx react-native start --reset-cache
```

### Step 3: Clean and Rebuild

**For Android:**

```bash
# Clean
cd android
./gradlew clean
cd ..

# Rebuild
npm run android
```

**For iOS:**

```bash
# Clean
cd ios
rm -rf Pods
pod install
cd ..

# Rebuild
npm run ios
```

### Step 4: Alternative - Full Clean

If the above doesn't work, do a full clean:

```bash
# Stop Metro bundler

# Remove node_modules and reinstall
rm -rf node_modules
npm install

# Clear watchman (if on Mac/Linux)
watchman watch-del-all

# Clear Metro cache
rm -rf $TMPDIR/metro-*
rm -rf $TMPDIR/haste-*

# Android clean
cd android
./gradlew clean
cd ..

# Rebuild
npm run android
```

## Quick Fix (Try This First)

```bash
# 1. Stop Metro bundler (Ctrl+C)

# 2. Clear cache and restart
npx react-native start --reset-cache

# 3. In a new terminal, rebuild
npm run android
```

## Verification

After rebuilding, verify:

1. App launches without errors
2. Bottom navigation shows 4 tabs
3. Dashboard header shows history icon
4. Tapping history icon opens Transactions screen
5. Back button works in Transactions screen
6. Banks screen accessible from Dashboard

## If Still Not Working

### Check package.json

Ensure these dependencies are present:

```json
{
  "dependencies": {
    "@react-navigation/bottom-tabs": "^7.15.5",
    "@react-navigation/native": "^7.1.33",
    "@react-navigation/stack": "^6.x.x"
  }
}
```

### Install Missing Dependencies

```bash
npm install @react-navigation/stack react-native-gesture-handler
```

### Rebuild Native Code

```bash
# Android
cd android && ./gradlew clean && cd ..
npm run android

# iOS
cd ios && pod install && cd ..
npm run ios
```

## Common Issues

### Issue 1: Module not found

**Solution:** Clear cache and reinstall

```bash
rm -rf node_modules
npm install
npx react-native start --reset-cache
```

### Issue 2: Native module error

**Solution:** Rebuild native code

```bash
# Android
cd android && ./gradlew clean && cd ..
npm run android
```

### Issue 3: Metro bundler cache

**Solution:** Clear all caches

```bash
watchman watch-del-all
rm -rf $TMPDIR/metro-*
npx react-native start --reset-cache
```

## Expected Result

After fixing, you should see:

```
✅ App launches successfully
✅ 4 tabs in bottom navigation
✅ Dashboard shows "SpendSense" header
✅ History icon in Dashboard header
✅ Tapping history icon opens Transactions
✅ Back button works
✅ No navigation errors
```

## Summary

**Quick Fix:**
1. Stop Metro bundler
2. Run: `npx react-native start --reset-cache`
3. Rebuild: `npm run android`

**Full Fix:**
1. Install: `npm install @react-navigation/stack`
2. Clean: `cd android && ./gradlew clean && cd ..`
3. Cache: `npx react-native start --reset-cache`
4. Rebuild: `npm run android`

---

**The error is just a cache issue - rebuilding will fix it!** ✅
