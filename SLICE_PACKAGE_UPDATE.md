# Slice Package Name Update

## Issue
The Slice app was dispatching notifications under the package name `indwin.c3.shareapp` instead of `tech.ula`, causing notifications to be ignored by the whitelist.

## Changes Made

### 1. Updated ALLOWED_PACKAGES Array
Added `indwin.c3.shareapp` to the whitelist while keeping `tech.ula` for backward compatibility:

```typescript
const ALLOWED_PACKAGES = [
  'com.google.android.apps.nbu.paisa.user', // Google Pay
  'com.phonepe.app', // PhonePe
  'tech.ula', // Slice (legacy)
  'indwin.c3.shareapp', // Slice (actual package name)
  'com.dreamplug.androidapp', // CRED
  'in.amazon.mShop.android.shopping', // Amazon Pay
  'net.one97.paytm', // Paytm
  'com.whatsapp', // WhatsApp (for UPI)
  'money.super.app', // Super.money
];
```

### 2. Updated PACKAGE_TO_SENDER Mapping
Added mapping for the new package name to identify it as SLICE:

```typescript
const PACKAGE_TO_SENDER: { [key: string]: string } = {
  'com.google.android.apps.nbu.paisa.user': 'GPAYID',
  'com.phonepe.app': 'PHONEPE',
  'tech.ula': 'SLICE',
  'indwin.c3.shareapp': 'SLICE', // ← New mapping
  'com.dreamplug.androidapp': 'CRED',
  'in.amazon.mShop.android.shopping': 'AMAZONP',
  'net.one97.paytm': 'PAYTMB',
  'com.whatsapp': 'WHATSAP',
  'money.super.app': 'SUPERM',
};
```

## Result
- ✅ Slice notifications from `indwin.c3.shareapp` will now be processed
- ✅ Legacy `tech.ula` package still supported (if used)
- ✅ Both packages map to the same 'SLICE' sender ID
- ✅ Enables proper Kotak SMS + Slice Notification transfer detection

## Testing
Test by making a transaction with Slice card and verify:
1. Notification is captured and logged
2. Transaction is parsed correctly
3. Transfer detection works with matching Kotak SMS
