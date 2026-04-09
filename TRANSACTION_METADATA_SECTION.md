# Transaction Details Metadata Section

## Overview
Added a read-only "Transaction Info" section to the Edit Transaction Modal that displays the origin and metadata of each transaction.

## Changes Made

### 1. Added Time Formatting Helper
```typescript
const formatDateTime = (dateString?: string) => {
  if (!dateString) return 'Unknown time';
  const date = new Date(dateString);
  return date.toLocaleString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
};
```

This formats dates like: "9 Apr, 2026, 02:30 PM"

### 2. Added Metadata UI Section
Located after the Category field, the section displays:

#### Bank Account
- Icon: `bank-outline`
- Format: "Account ••1234"
- Shows last 4 digits of account or "Unknown"

#### Source
- Icon: `cellphone-message` (for SMS) or `bell-outline` (for notifications)
- Format: "SMS via HDFC-BANK" or "NOTIFICATION via GPay"
- Shows source type and sender name
- Defaults to "MANUAL via App" for manually entered transactions

#### Time
- Icon: `clock-outline`
- Format: "9 Apr, 2026, 02:30 PM"
- Shows when the transaction was created

### 3. Styling
- Background: `colors.card` with border
- Border radius: `borderRadius.md`
- Padding: 16px
- Margin top: 24px (clear separation from editable fields)
- Text: `typography.caption` with `fontSize: 12`
- Color: `colors.subtext` (clearly read-only)
- Section heading: Uppercase, small font (11px), letter-spacing

### 4. Layout
```
┌─────────────────────────────────────┐
│ TRANSACTION INFO                    │
│                                     │
│ 🏦  Account ••1234                  │
│ 📱  SMS via HDFC-BANK               │
│ 🕐  9 Apr, 2026, 02:30 PM          │
└─────────────────────────────────────┘
```

## User Experience

When user double-taps a transaction to edit:
1. Modal opens with editable fields (Amount, Note, Type, Category)
2. Below Category, they see the "Transaction Info" section
3. This section is clearly styled as read-only metadata
4. User can see exactly where the transaction came from
5. Helps verify transaction authenticity and origin

## Benefits

1. **Transparency** - User knows exactly where each transaction came from
2. **Trust** - Can verify SMS/notification source
3. **Debugging** - Easy to identify manual vs automatic entries
4. **Audit Trail** - Complete timestamp and source information
5. **Account Tracking** - See which bank account the transaction belongs to

## Technical Details

### File Modified
- `src/components/ui/EditTransactionModal.tsx`

### New Styles Added
```typescript
metadataSection: {
  borderWidth: 1,
  padding: 16,
},
metadataRow: {
  flexDirection: 'row',
  alignItems: 'center',
  marginBottom: 10,
},
```

### Transaction Fields Used
- `transaction.account_last4` - Last 4 digits of account
- `transaction.sms_source` - Source type ('sms', 'notification', or null)
- `transaction.sms_sender` - Sender name (bank name, app name)
- `transaction.created_at` - Timestamp

## Example Display

### SMS Transaction
```
TRANSACTION INFO
🏦  Account ••5678
📱  SMS via HDFC-BANK
🕐  9 Apr, 2026, 02:30 PM
```

### Notification Transaction
```
TRANSACTION INFO
🏦  Account ••1234
🔔  NOTIFICATION via GPay
🕐  8 Apr, 2026, 11:45 AM
```

### Manual Transaction
```
TRANSACTION INFO
🏦  Account ••Unknown
🔔  MANUAL via App
🕐  7 Apr, 2026, 09:15 AM
```

## Testing
1. Double-tap any transaction to open edit modal
2. Scroll down below the Category field
3. Verify "Transaction Info" section appears
4. Check that all three rows display correctly
5. Verify icons match the source type
6. Confirm text is styled as read-only (smaller, subdued color)
