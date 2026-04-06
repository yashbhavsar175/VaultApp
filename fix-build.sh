#!/bin/bash

# Fix Android Build Script

echo "🔧 Fixing Android Build Issues..."
echo ""

# Step 1: Clean Android
echo "📦 Step 1: Cleaning Android build..."
cd android
./gradlew clean
cd ..
echo "✅ Android cleaned"
echo ""

# Step 2: Remove build artifacts
echo "🗑️  Step 2: Removing build artifacts..."
rm -rf android/app/build
rm -rf android/app/.cxx
echo "✅ Build artifacts removed"
echo ""

# Step 3: Reinstall node_modules
echo "📥 Step 3: Reinstalling dependencies..."
rm -rf node_modules
npm install
echo "✅ Dependencies reinstalled"
echo ""

# Step 4: Clear Metro cache
echo "🧹 Step 4: Clearing Metro cache..."
npx react-native start --reset-cache &
METRO_PID=$!
sleep 5
kill $METRO_PID
echo "✅ Metro cache cleared"
echo ""

# Step 5: Rebuild
echo "🔨 Step 5: Rebuilding app..."
echo "Run this command in a new terminal:"
echo "npm run android"
echo ""
echo "✅ Fix complete! Now run: npm run android"
