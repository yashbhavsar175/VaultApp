@echo off
REM Fix Android Build Script for Windows

echo 🔧 Fixing Android Build Issues...
echo.

REM Step 1: Clean Android
echo 📦 Step 1: Cleaning Android build...
cd android
call gradlew clean
cd ..
echo ✅ Android cleaned
echo.

REM Step 2: Remove build artifacts
echo 🗑️  Step 2: Removing build artifacts...
if exist android\app\build rmdir /s /q android\app\build
if exist android\app\.cxx rmdir /s /q android\app\.cxx
echo ✅ Build artifacts removed
echo.

REM Step 3: Reinstall node_modules
echo 📥 Step 3: Reinstalling dependencies...
if exist node_modules rmdir /s /q node_modules
call npm install
echo ✅ Dependencies reinstalled
echo.

REM Step 4: Done
echo ✅ Fix complete!
echo.
echo Now run: npm run android
echo.
pause
