# Background Processing Setup

## Overview
App ab background mein bhi SMS aur notifications ko process kar sakta hai, chahe app band ho ya device restart ho.

## Features

### 1. SMS Processing (Background)
- **Headless JS Task**: SMS receive hone par automatically background mein process hota hai
- **SmsReceiver**: Android broadcast receiver jo SMS ko intercept karta hai
- **Works when**: App closed, app in background, screen off

### 2. Notification Processing (Background)
- **NotificationListenerService**: System-level service jo notifications ko monitor karta hai
- **Supported Apps**: Google Pay, PhonePe, Slice, CRED, Amazon Pay, Paytm, WhatsApp
- **Works when**: App closed, app in background, screen off

### 3. Boot Receiver
- **Auto-restart**: Device reboot ke baad automatically services restart ho jati hain
- **BootReceiver**: Android broadcast receiver jo boot complete event ko handle karta hai

## Technical Implementation

### Components

1. **BackgroundEventHandler.ts**
   - Notifee background events ko handle karta hai
   - Background listeners ko initialize karta hai

2. **BootReceiver.kt**
   - Device boot complete event ko listen karta hai
   - Services ko restart karta hai

3. **AndroidManifest.xml**
   - Required permissions:
     - `RECEIVE_BOOT_COMPLETED`: Boot events ke liye
     - `FOREGROUND_SERVICE_DATA_SYNC`: Background data sync ke liye
     - `BIND_NOTIFICATION_LISTENER_SERVICE`: Notification access ke liye
   - Receivers registered:
     - SmsReceiver (SMS processing)
     - BootReceiver (Auto-restart after boot)

4. **index.js**
   - Headless tasks register karta hai
   - Notifee background event handler register karta hai

5. **App.tsx**
   - App start par background listeners initialize karta hai
   - App foreground mein aane par listeners ko re-initialize karta hai

## How It Works

### SMS Flow (Background)
```
SMS Received → SmsReceiver → SmsProcessorService → SmsProcessorTask (Headless JS)
                                                   ↓
                                            Parse & Save to DB
```

### Notification Flow (Background)
```
Notification Posted → NotificationListener → NotificationProcessorService → NotificationProcessorTask (Headless JS)
                                                                            ↓
                                                                     Parse & Save to DB
```

### Boot Flow
```
Device Boot → BootReceiver → Services Auto-restart → Ready to process SMS/Notifications
```

## Testing

### Test Background SMS Processing
1. App ko completely close karo (swipe away from recent apps)
2. Kisi bank se transaction karo
3. SMS aayega aur automatically process hoga
4. App kholo aur transaction list check karo

### Test Background Notification Processing
1. App ko completely close karo
2. Google Pay/PhonePe se payment karo
3. Notification aayega aur automatically process hoga
4. App kholo aur transaction list check karo

### Test Boot Receiver
1. Device ko restart karo
2. Restart ke baad transaction karo
3. SMS/Notification automatically process hona chahiye

## Permissions Required

User ko ye permissions grant karni hongi:
1. **SMS Permission**: Settings → Apps → VaultApp → Permissions → SMS → Allow
2. **Notification Access**: Settings → Apps → Special app access → Notification access → VaultApp → Allow

## Battery Optimization

Android battery optimization se services band ho sakti hain. User ko battery optimization disable karna hoga:
1. Settings → Apps → VaultApp → Battery → Unrestricted

## Limitations

1. **Android 12+**: Background service restrictions zyada strict hain
2. **OEM Restrictions**: Kuch manufacturers (Xiaomi, Oppo, Vivo) aggressive battery optimization use karte hain
3. **Doze Mode**: Deep sleep mein services temporarily pause ho sakti hain

## Troubleshooting

### Services not working in background?
1. Check permissions (SMS + Notification Access)
2. Disable battery optimization
3. Check if app is in "Auto-start" list (Xiaomi/Oppo/Vivo)
4. Restart device

### Transactions not appearing?
1. Open app once to sync
2. Check internet connection
3. Check Supabase auth token in AsyncStorage

## Future Improvements

1. **Foreground Service**: Critical transactions ke liye persistent notification
2. **WorkManager**: Scheduled background sync
3. **Firebase Cloud Messaging**: Server-triggered sync
