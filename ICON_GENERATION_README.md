# SpendSense Icon Generation - Quick Start 🚀

## TL;DR (Too Long; Didn't Read)

### App Name: ✅ Already Fixed
The app name is already set to "SpendSense" - no action needed!

### App Icon: ⏳ Generate Now

**3 Simple Steps:**

```bash
# Step 1: Install Pillow
pip install Pillow

# Step 2: Generate icons
python generate_app_icons.py

# Step 3: Rebuild app
cd android
./gradlew clean
npx react-native run-android
```

Done! Your app now has a purple icon with white "S" 🎨

---

## What You Get

### Before:
- App name: "app-release" ❌
- Icon: Default React Native logo ❌

### After:
- App name: "SpendSense" ✅
- Icon: Purple background (#7c3aed) with white "S" ✅

---

## Icon Preview

```
┌─────────────────┐
│                 │
│                 │
│       S         │  ← White "S"
│                 │
│                 │
└─────────────────┘
   Purple (#7c3aed)
```

---

## Files Generated

The script creates 10 icon files:

```
android/app/src/main/res/
├── mipmap-mdpi/ic_launcher.png (48x48)
├── mipmap-mdpi/ic_launcher_round.png
├── mipmap-hdpi/ic_launcher.png (72x72)
├── mipmap-hdpi/ic_launcher_round.png
├── mipmap-xhdpi/ic_launcher.png (96x96)
├── mipmap-xhdpi/ic_launcher_round.png
├── mipmap-xxhdpi/ic_launcher.png (144x144)
├── mipmap-xxhdpi/ic_launcher_round.png
├── mipmap-xxxhdpi/ic_launcher.png (192x192)
└── mipmap-xxxhdpi/ic_launcher_round.png
```

---

## Troubleshooting

### "ModuleNotFoundError: No module named 'PIL'"
```bash
pip install Pillow
# or
pip3 install Pillow
```

### Icons not updating on device?
```bash
# Uninstall old app first
adb uninstall com.yourpackagename

# Then rebuild
cd android
./gradlew clean
npx react-native run-android
```

### Script not found?
Make sure you're in the project root directory where `generate_app_icons.py` exists.

---

## Need More Details?

See `FIX_APP_NAME_AND_ICON.md` for:
- Complete documentation
- Alternative methods (online generators)
- Advanced adaptive icons
- Detailed troubleshooting

---

## Quick Check

After rebuilding, verify:
- [ ] App drawer shows "SpendSense" name
- [ ] Icon has purple background
- [ ] White "S" is visible and centered
- [ ] Icon looks sharp (not blurry)

---

**That's it!** Simple and fast. 🎉
