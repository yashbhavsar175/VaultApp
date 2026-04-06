# SpendSense App Logo Setup Guide

## Android App Icon Locations

Replace the default React Native icons with your SpendSense logo in these directories:

### Required Icon Files

You need to create your logo in multiple sizes and place them in these folders:

```
android/app/src/main/res/
├── mipmap-mdpi/
│   ├── ic_launcher.png          (48x48 px)
│   └── ic_launcher_round.png    (48x48 px)
├── mipmap-hdpi/
│   ├── ic_launcher.png          (72x72 px)
│   └── ic_launcher_round.png    (72x72 px)
├── mipmap-xhdpi/
│   ├── ic_launcher.png          (96x96 px)
│   └── ic_launcher_round.png    (96x96 px)
├── mipmap-xxhdpi/
│   ├── ic_launcher.png          (144x144 px)
│   └── ic_launcher_round.png    (144x144 px)
└── mipmap-xxxhdpi/
    ├── ic_launcher.png          (192x192 px)
    └── ic_launcher_round.png    (192x192 px)
```

## Icon Specifications

### ic_launcher.png (Square Icon)
- **Format**: PNG with transparency
- **Background**: Can be transparent or colored
- **Safe Area**: Keep important content within 80% of canvas
- **Sizes**:
  - mdpi: 48x48 px
  - hdpi: 72x72 px
  - xhdpi: 96x96 px
  - xxhdpi: 144x144 px
  - xxxhdpi: 192x192 px

### ic_launcher_round.png (Round Icon)
- **Format**: PNG with transparency
- **Shape**: Circular design (Android 7.1+)
- **Safe Area**: Keep content within circular bounds
- **Same sizes as square icon**

## Quick Setup Methods

### Method 1: Use Online Icon Generator (Recommended)
1. Go to: https://icon.kitchen/ or https://romannurik.github.io/AndroidAssetStudio/
2. Upload your logo (1024x1024 px recommended)
3. Customize padding, background color
4. Download the generated icon pack
5. Extract and copy all mipmap folders to `android/app/src/main/res/`

### Method 2: Manual Creation
1. Create your logo in 1024x1024 px
2. Use image editing software (Photoshop, GIMP, Figma)
3. Export in all required sizes
4. Place files in respective mipmap folders

### Method 3: Use React Native Asset Tool
```bash
npm install -g @bam.tech/react-native-make
npx react-native set-icon --path ./path-to-your-logo.png
```

## Design Tips for SpendSense Logo

Since SpendSense is a financial tracking app, consider:

- **Colors**: Purple (#7c6af7 - your brand color), Green (money), Blue (trust)
- **Symbols**: 
  - Wallet icon
  - Rupee/Dollar symbol
  - Chart/Graph
  - Piggy bank
  - Calculator
- **Style**: Modern, clean, minimalist
- **Text**: "SS" monogram or full "SpendSense" if readable

## Example Logo Concepts

### Concept 1: Wallet with Chart
```
┌─────────────┐
│   ┌─────┐   │
│   │ /\  │   │  <- Wallet with upward trend
│   │/  \ │   │
│   └─────┘   │
└─────────────┘
```

### Concept 2: Rupee Symbol with Circle
```
┌─────────────┐
│             │
│      ₹      │  <- Stylized rupee in circle
│   ○─────○   │
│             │
└─────────────┘
```

### Concept 3: SS Monogram
```
┌─────────────┐
│             │
│     SS      │  <- Modern SS letters
│   ╱  ╲     │
│             │
└─────────────┘
```

## After Adding Icons

1. **Clean and rebuild**:
   ```bash
   cd android
   ./gradlew clean
   cd ..
   npx react-native run-android
   ```

2. **Verify on device**:
   - Check home screen icon
   - Check app drawer icon
   - Check recent apps icon

## iOS Icons (For Future)

When you add iOS support, place icons in:
```
ios/SpendSense/Images.xcassets/AppIcon.appiconset/
```

Required sizes for iOS:
- 20x20, 29x29, 40x40, 58x58, 60x60, 76x76, 80x80, 87x87, 
  120x120, 152x152, 167x167, 180x180, 1024x1024

## Adaptive Icons (Android 8.0+)

For modern Android, you can also create adaptive icons:

```
android/app/src/main/res/
├── mipmap-anydpi-v26/
│   └── ic_launcher.xml
├── drawable/
│   ├── ic_launcher_background.xml
│   └── ic_launcher_foreground.xml
```

This allows the system to mask your icon into different shapes (circle, square, squircle).

## Current Status

✅ App name changed to "SpendSense"
✅ Package name: com.spendsense
⏳ App icons: Still using default React Native icons

**Next Step**: Replace the default icons in all mipmap folders with your SpendSense logo!

## Recommended Tools

- **Icon Generator**: https://icon.kitchen/
- **Design**: Figma, Canva, Adobe Illustrator
- **Image Editing**: GIMP (free), Photoshop
- **Testing**: Install on real device to see how it looks

## Notes

- Always use PNG format with transparency
- Keep file names exactly as shown (ic_launcher.png, ic_launcher_round.png)
- Test on different Android versions
- Consider both light and dark launcher backgrounds
- Make sure logo is recognizable at small sizes (48x48)
