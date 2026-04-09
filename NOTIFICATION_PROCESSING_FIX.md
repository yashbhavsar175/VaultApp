# Notification Processing Fix Summary

## Issues Fixed

### Issue 1: Wrong Variable Name for Package
**Problem**: The code was using `taskData.packageName` but the library passes the app's package name as `notification.app`.

**Solution**: 
- Parse the incoming notification string: `const notif = JSON.parse(taskData.notification);`
- Use `notif.app` everywhere instead of `taskData.packageName`
- Updated all references throughout the function

### Issue 2: Extracting Text from Correct Fields
**Problem**: The notification object has `title` and `text` fields inside the parsed object, not directly on taskData.

**Solution**:
- Updated `combinedText` to: `const combinedText = \`${notif.title || ''} ${notif.text || ''}\`.trim();`
- Added null coalescing to handle missing fields gracefully

### Issue 3: Deduplication with Different Sources
**Problem**: Kotak SMS and Slice Notification for the same transaction were being marked as duplicates, preventing proper transfer detection.

**Solution**:
- Updated `checkForDuplicates()` function in both files to accept an optional `smsSource` parameter
- Added logic to check if two transactions have different `sms_source` values
- If sources are different (e.g., 'bank' vs 'upi'), they are NOT considered duplicates
- This allows both the SMS and Notification to be processed separately for transfer matching

## Files Modified

1. **src/lib/NotificationProcessorTask.ts**
   - Fixed JSON parsing to extract `notif.app`, `notif.title`, and `notif.text`
   - Updated all timestamp references to use `notif.time`
   - Added `smsSource` parameter to duplicate checking
   - Updated function signature to accept `any` type for flexible parsing

2. **src/lib/SmsProcessorTask.ts**
   - Enhanced `checkForDuplicates()` to accept `smsSource` parameter
   - Added source comparison logic to prevent false duplicate detection
   - Passes `parsed.source` when calling `checkForDuplicates()`

## How It Works Now

### Scenario: Kotak Bank Transfer via Slice Card

1. **Kotak SMS arrives** (₹2 Debit from A/C XX1447)
   - Parsed as: `{ amount: 2, type: 'debit', source: 'bank', accountLast4: '1447' }`
   - Inserted as a regular debit transaction

2. **Slice Notification arrives** (₹2 Debit from Slice)
   - Parsed as: `{ amount: 2, type: 'debit', source: 'upi', accountLast4: undefined }`
   - Duplicate check finds the Kotak SMS transaction
   - BUT: `sms_source` is different ('bank' vs 'upi')
   - Result: NOT marked as duplicate, inserted as separate transaction

3. **Transfer Detection**
   - Both transactions exist with same amount and type
   - Transfer detection logic can now match them properly
   - Converts to a single transfer transaction

## Benefits

- ✅ Proper notification parsing from the native bridge
- ✅ Handles missing fields gracefully
- ✅ Allows SMS + Notification for same transaction
- ✅ Enables accurate transfer detection
- ✅ Prevents false duplicate detection

## Testing Recommendations

1. Test with Slice notification for a Kotak transaction
2. Verify both SMS and notification are processed
3. Confirm transfer detection works correctly
4. Check that true duplicates (same source) are still caught
