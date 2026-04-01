# SMS Processor Debug Implementation

## Changes Made

### 1. Added Detailed Logging in SmsProcessorTask.ts

Added step-by-step console logs at every stage:
- Step 1: Task received with full payload
- Step 2: Parsed SMS body and sender
- Step 3: Amount extraction result
- Step 4: Transaction type detection
- Step 4a-c: Note, category, and full parsed data
- Step 5-5b: Session restoration from AsyncStorage
- Step 6-7: Database save operation
- Step 8-9: Notification sending

All errors are now logged with detailed information including stack traces.

### 2. Fixed Auth Session Issue

**Problem**: Headless tasks run in a separate process without access to the main app's Supabase auth session.

**Solution**: 
- Save session to AsyncStorage on login (both email and Google)
- Restore session in SmsProcessorTask before calling addTransaction()

**Files Modified**:
- `src/tasks/SmsProcessorTask.ts` - Added AsyncStorage import and session restoration
- `src/screens/LoginScreen.tsx` - Save session after email login
- `src/lib/googleAuth.ts` - Save session after Google Sign-In

### 3. Improved Error Handling

- Wrapped addTransaction() in try/catch with detailed error logging
- Added error details JSON stringification
- Added stack trace logging for all errors

### 4. Regex Pattern Verification

The existing regex pattern `/₹\s*(\d+(?:\.\d+)?)/i` correctly matches:
- `₹1` ✓
- `₹1.00` ✓
- `Received ₹1 via UPI` ✓

## Testing Instructions

1. **Login first** to save session to AsyncStorage
2. Send a test SMS with format: `Received ₹1 via UPI`
3. Check Metro bundler console for logs in this order:

```
=== SMS PROCESSOR TASK STARTED ===
Step 1 - Task received: {...}
Step 2 - Parsed SMS body: Received ₹1 via UPI
Step 3 - Amount found: 1
Step 4 - Type detected: income
Step 4a - Note extracted: ...
Step 5 - Restoring Supabase session...
Step 5a - Session from storage: Found
Step 5b - Session restored successfully
Step 6 - Calling addTransaction...
Step 7 - Transaction saved successfully: {...}
Step 8 - Sending notification...
Step 9 - Notification sent successfully
=== SMS PROCESSOR TASK COMPLETED SUCCESSFULLY ===
```

## Expected Errors (if any)

If you see:
- `ERROR: No session found in AsyncStorage` → User needs to login first
- `ERROR: Failed to restore session` → Session format issue
- `ERROR: Failed to save transaction` → Database/RLS policy issue
- `WARNING: No amount found` → SMS format doesn't match regex

## Next Steps

1. Run the app and login
2. Send test SMS
3. Share the complete Metro console output
4. Check if transaction appears in Dashboard
