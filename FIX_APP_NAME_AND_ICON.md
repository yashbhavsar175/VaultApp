# Fix App Name and Icon - GUIDE 📱

## Summary
Guide to fix SpendSense app display name and generate custom app icon with purple background and white "S".

---

## Fix 1: App Display Name ✅

### Status: ALREADY FIXED ✅

The app name is already correctly set to "SpendSense" in the configuration files.

### Verification:

#### File 1: `android/app/src/main/res/values/strings.xml`
```xml
<resources>
    <string name="app_name">SpendSense</string>
</resources>
```
✅ Already set to "SpendSense"

#### File 2: `android/app/src/main/AndroidManifest.xml`
```xml
<application
  android:label="@string/app_name"
  ...>
  <activity
    android:label="@string/app_name"
    ...>
```
✅ Already using `@string/app_name` reference

### Result:
- App name displays as "SpendSense" on device
- No changes needed

---

## Fix 2: App Icon 🎨

### Current Status:
- Using default React Native icon
- Need custom SpendSense branded icon

### Icon Design Specifications:

#### Visual Design:
- **Background**: Purple (#7c3aed) - SpendSense brand color
- **Letter**: White "S" in center
- **Font**: Bold, clean, sans-serif
- **Style**: Modern, minimal, professional

#### Required Sizes:
| Density | Folder | Size | Usage |
|---------|--------|------|-------|
| MDPI | mipmap-mdpi | 48x48 | Low density screens |
| HDPI | mipmap-hdpi | 72x72 | Medium density screens |
| XHDPI | mipmap-xhdpi | 96x96 | High density screens |
| XXHDPI | mipmap-xxhdpi | 144x144 | Extra high density |
| XXXHDPI | mipmap-xxxhdpi | 192x192 | Extra extra high density |

#### Files to Generate:
For each density folder, create:
- `ic_launcher.png` - Regular icon
- `ic_launcher_round.png` - Round icon (for devices that support it)

Total: 10 files (5 densities × 2 variants)

---

## Icon Generation Methods

### Method 1: Python Script (Recommended) 🐍

#### Step 1: Install Pillow
```bash
pip install Pillow
```

#### Step 2: Run the Generator Script
```bash
python generate_app_icons.py
```

The script `generate_app_icons.py` is already created in your project root.

#### What the Script Does:
1. Creates purple background (124, 58, 237)
2. Draws white "S" in center (60% of icon size)
3. Generates all 10 required icon files
4. Saves to correct Android resource folders

#### Expected Output:
```
SpendSense Icon Generator
==================================================
Using font: C:/Windows/Fonts/arialbd.ttf
Generated: android/app/src/main/res/mipmap-mdpi/ic_launcher.png
Generated: android/app/src/main/res/mipmap-mdpi/ic_launcher_round.png
Generated: android/app/src/main/res/mipmap-hdpi/ic_launcher.png
Generated: android/app/src/main/res/mipmap-hdpi/ic_launcher_round.png
Generated: android/app/src/main/res/mipmap-xhdpi/ic_launcher.png
Generated: android/app/src/main/res/mipmap-xhdpi/ic_launcher_round.png
Generated: android/app/src/main/res/mipmap-xxhdpi/ic_launcher.png
Generated: android/app/src/main/res/mipmap-xxhdpi/ic_launcher_round.png
Generated: android/app/src/main/res/mipmap-xxxhdpi/ic_launcher.png
Generated: android/app/src/main/res/mipmap-xxxhdpi/ic_launcher_round.png
==================================================
✅ Successfully generated 10 icon files!
```

---

### Method 2: Online Icon Generator (Alternative) 🌐

If Python script doesn't work, use online tools:

#### Option A: Android Asset Studio
1. Go to: https://romannurik.github.io/AndroidAssetStudio/icons-launcher.html
2. Upload a 512x512 PNG with purple background and white "S"
3. Download generated icons
4. Extract to `android/app/src/main/res/`

#### Option B: App Icon Generator
1. Go to: https://appicon.co/
2. Upload 1024x1024 icon
3. Select Android
4. Download and extract

#### Option C: Icon Kitchen
1. Go to: https://icon.kitchen/
2. Create icon with purple background
3. Add white "S" text
4. Download Android icons

---

### Method 3: Manual Creation (Photoshop/Figma) 🎨

#### Design Specifications:
```
Canvas: 512x512 (master size)
Background: #7c3aed (RGB: 124, 58, 237)
Text: "S"
Font: Arial Bold or Helvetica Bold
Font Size: ~300px (60% of canvas)
Text Color: #FFFFFF (white)
Alignment: Center (both horizontal and vertical)
```

#### Export Sizes:
- 48x48 → mipmap-mdpi
- 72x72 → mipmap-hdpi
- 96x96 → mipmap-xhdpi
- 144x144 → mipmap-xxhdpi
- 192x192 → mipmap-xxxhdpi

---

## After Generating Icons

### Step 1: Verify Files Exist
Check that these folders contain the icons:
```
android/app/src/main/res/
├── mipmap-mdpi/
│   ├── ic_launcher.png (48x48)
│   └── ic_launcher_round.png (48x48)
├── mipmap-hdpi/
│   ├── ic_launcher.png (72x72)
│   └── ic_launcher_round.png (72x72)
├── mipmap-xhdpi/
│   ├── ic_launcher.png (96x96)
│   └── ic_launcher_round.png (96x96)
├── mipmap-xxhdpi/
│   ├── ic_launcher.png (144x144)
│   └── ic_launcher_round.png (144x144)
└── mipmap-xxxhdpi/
    ├── ic_launcher.png (192x192)
    └── ic_launcher_round.png (192x192)
```

### Step 2: Clean Build
```bash
cd android
./gradlew clean
```

### Step 3: Rebuild App

#### For Debug Build:
```bash
npx react-native run-android
```

#### For Release Build:
```bash
cd android
./gradlew assembleRelease
```

### Step 4: Install on Device
The APK will be at:
```
android/app/build/outputs/apk/release/app-release.apk
```

Install it:
```bash
adb install android/app/build/outputs/apk/release/app-release.apk
```

---

## Verification Checklist

### App Name:
- [ ] Open app drawer on device
- [ ] App shows as "SpendSense" (not "app-release")
- [ ] App title bar shows "SpendSense"

### App Icon:
- [ ] Icon has purple background (#7c3aed)
- [ ] White "S" is centered and visible
- [ ] Icon looks sharp on device (not blurry)
- [ ] Icon appears in app drawer
- [ ] Icon appears in recent apps
- [ ] Round icon works on supported devices

---

## Troubleshooting

### Issue 1: Icons Not Updating
**Solution:**
```bash
# Uninstall old app
adb uninstall com.yourpackagename

# Clean build
cd android
./gradlew clean

# Rebuild and install
npx react-native run-android
```

### Issue 2: Python Script Fails
**Error:** `ModuleNotFoundError: No module named 'PIL'`

**Solution:**
```bash
pip install Pillow
# or
pip3 install Pillow
```

### Issue 3: Font Not Found
**Solution:**
The script will fallback to default font. Icons will still generate but text might look different.

To use custom font:
1. Download a TTF font file
2. Place it in project root
3. Update script font path

### Issue 4: Icons Look Blurry
**Cause:** Wrong size or low quality source

**Solution:**
- Ensure each icon is exact size (48, 72, 96, 144, 192)
- Use PNG format with transparency
- Don't upscale smaller images

---

## Advanced: Adaptive Icons (Android 8.0+)

For modern Android devices, you can create adaptive icons:

### File Structure:
```
android/app/src/main/res/
├── mipmap-anydpi-v26/
│   ├── ic_launcher.xml
│   └── ic_launcher_round.xml
├── drawable/
│   ├── ic_launcher_background.xml
│   └── ic_launcher_foreground.xml
```

### Example `ic_launcher.xml`:
```xml
<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@drawable/ic_launcher_background"/>
    <foreground android:drawable="@drawable/ic_launcher_foreground"/>
</adaptive-icon>
```

### Example `ic_launcher_background.xml`:
```xml
<?xml version="1.0" encoding="utf-8"?>
<shape xmlns:android="http://schemas.android.com/apk/res/android">
    <solid android:color="#7c3aed"/>
</shape>
```

This creates a more modern, adaptive icon that works with different device themes.

---

## Quick Reference Commands

### Generate Icons:
```bash
python generate_app_icons.py
```

### Clean Build:
```bash
cd android && ./gradlew clean
```

### Build Release:
```bash
cd android && ./gradlew assembleRelease
```

### Run on Device:
```bash
npx react-native run-android
```

### Uninstall Old App:
```bash
adb uninstall com.yourpackagename
```

---

## Files Created/Modified

### Created:
- `generate_app_icons.py` - Icon generator script
- `android/app/src/main/res/mipmap-*/ic_launcher.png` (5 files)
- `android/app/src/main/res/mipmap-*/ic_launcher_round.png` (5 files)

### Already Correct (No Changes Needed):
- `android/app/src/main/res/values/strings.xml` ✅
- `android/app/src/main/AndroidManifest.xml` ✅

---

## Status

### App Name:
✅ COMPLETE - Already set to "SpendSense"

### App Icon:
⏳ PENDING - Run `python generate_app_icons.py` to generate icons

---

## Next Steps

1. **Generate Icons:**
   ```bash
   pip install Pillow
   python generate_app_icons.py
   ```

2. **Rebuild App:**
   ```bash
   cd android
   ./gradlew clean
   ./gradlew assembleRelease
   ```

3. **Test on Device:**
   - Install APK
   - Check app name shows "SpendSense"
   - Check icon shows purple with white "S"

4. **Done!** 🎉
