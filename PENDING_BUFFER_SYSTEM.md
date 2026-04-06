# Pending Buffer System for Self-Transfer Detection

## Problem Solved
Race condition where Kotak credit SMS arrives before Slice fraud alert SMS, causing self-transfers to be incorrectly saved as normal income transactions.

## Solution: UPI Ref ID Based Pending Buffer

The new system uses a bidirectional pending buffer that works regardless of SMS arrival order.

## How It Works

### 1. When CREDIT SMS (income) arrives:
1. Extract UPI ref ID from SMS
2. Check AsyncStorage for `fraud_skip_ref_{refId}`
   - **If found** → Fraud alert already arrived
     - Find source account from fraud alert data
     - Find destination account from credit SMS
     - Save as self-transfer immediately: "Slice ••5235 → Kotak ••1447"
     - Cleanup both keys
   - **If NOT found** → Fraud alert hasn't arrived yet
     - Save to `pending_credit_{refId}` in AsyncStorage
     - Set 30-second timeout
     - If timeout expires and still pending → save as normal income

### 2. When FRAUD ALERT SMS arrives:
1. Extract UPI ref ID and account last 4 digits
2. Save to `fraud_skip_ref_{refId}` → account number
3. Check AsyncStorage for `pending_credit_{refId}`
   - **If found** → Credit SMS already arrived and is waiting
     - Find source account using fraud alert account number
     - Get destination account from pending data
     - Save as self-transfer: "Slice ••5235 → Kotak ••1447"
     - Cleanup both keys
   - **If NOT found** → Credit SMS hasn't arrived yet
     - Just save fraud ref and wait
     - Set 120-second cleanup timeout

### 3. Cleanup Strategy:
- **Immediate cleanup**: After saving self-transfer transaction, remove both `pending_credit_{refId}` and `fraud_skip_ref_{refId}`
- **Timeout cleanup**: 
  - Pending credits: 30 seconds → save as normal income
  - Fraud alerts: 120 seconds → remove from storage
- **App startup cleanup**: Check all pending credits older than 30 seconds and save as normal income

## Key Advantages

1. **Order-independent**: Works whether credit SMS or fraud alert arrives first
2. **No artificial delays**: No 3-second waits that can fail
3. **Automatic fallback**: If matching SMS never arrives, saves as normal transaction after timeout
4. **Clean storage**: Automatic cleanup prevents AsyncStorage buildup
5. **Reliable**: Uses UPI ref ID as unique identifier for matching

## Data Structures

```typescript
interface PendingCredit {
  upiRefId: string;
  amount: number;
  destAccount: UpiAccount;
  timestamp: number;
  body: string;
  note: string;
  category: string;
}
```

## Storage Keys

- `pending_credit_{upiRefId}` → PendingCredit JSON
- `fraud_skip_ref_{upiRefId}` → account last 4 digits (string)

## Timeouts

- Pending credit timeout: 30 seconds
- Fraud alert cleanup: 120 seconds
- App startup cleanup: Processes all pending credits older than 30 seconds

## Files Modified

1. `src/tasks/SmsProcessorTask.ts`
   - Added `PendingCredit` interface
   - Added `handlePendingCreditSMS()` function
   - Updated `handleFraudAlertSMS()` to check for pending credits
   - Added `cleanupOldPendingCredits()` export
   - Removed 3-second delay approach
   - Updated main processing logic

2. `App.tsx`
   - Import `cleanupOldPendingCredits`
   - Call cleanup on app startup in useEffect

## Testing Scenarios

### Scenario 1: Fraud alert arrives first
1. Slice fraud alert SMS → saves `fraud_skip_ref_608709747765` = "5235"
2. Kotak credit SMS → finds fraud ref → saves self-transfer → cleanup

### Scenario 2: Credit SMS arrives first
1. Kotak credit SMS → saves `pending_credit_608709747765` with dest account
2. Slice fraud alert SMS → finds pending credit → saves self-transfer → cleanup

### Scenario 3: Only credit SMS (no fraud alert)
1. Kotak credit SMS → saves to pending
2. 30 seconds pass → timeout triggers → saves as normal income

### Scenario 4: Only fraud alert (no credit SMS)
1. Slice fraud alert SMS → saves fraud ref
2. 120 seconds pass → cleanup removes fraud ref

### Scenario 5: App restart with pending credits
1. App starts → `cleanupOldPendingCredits()` runs
2. Finds pending credits older than 30 seconds
3. Saves them as normal income transactions
4. Removes from storage
