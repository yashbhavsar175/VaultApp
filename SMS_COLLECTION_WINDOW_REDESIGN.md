# SMS Processing Redesign: 25-Second Collection Window

## Problem with Previous Approach
The pending buffer system with fraud alert matching was complex and unreliable:
- Required precise timing between SMS arrivals
- Separate handling for fraud alerts, credit SMS, and debit SMS
- Multiple AsyncStorage keys to manage
- Race conditions still possible
- Complex cleanup logic

## New Approach: Collection Window

Collect ALL SMS for 25 seconds, then analyze them together as a group.

## How It Works

### Step 1: Every SMS Goes to Collection Buffer
When any transaction SMS arrives:
1. Extract amount and UPI ref ID
2. Create `CollectedSms` object
3. Add to collection buffer grouped by UPI ref ID (or timestamp if no ref)
4. Start/reset 25-second timer for this group

### Step 2: After 25 Seconds, Analyze the Group
Timer expires → analyze ALL SMS in the group together:

1. **Extract data from ALL SMS:**
   - All account numbers mentioned (last 4 digits)
   - All UPI IDs mentioned
   - Total amount
   - Which SMS is credit (income)
   - Which SMS is debit (expense)

2. **Load user's bank accounts** from `bank_accounts` table

3. **Match accounts:** Find which accounts in SMS belong to user

4. **Decision logic:**
   - **2+ user accounts found** → SELF TRANSFER
     - Note: "Slice ••5235 → Kotak ••1447"
     - Type: transfer
   
   - **1 user account + debit SMS** → EXPENSE
     - Money went out from user's account
     - Type: expense
   
   - **1 user account + credit SMS** → INCOME
     - Money came into user's account
     - Type: income
   
   - **Unknown** → Save best guess
     - Use whichever SMS has more info

### Step 3: Grouping Logic
SMS are grouped by:
- **If UPI ref ID exists:** `sms_group_{refId}`
- **If no UPI ref ID:** `sms_group_{timestamp_rounded_to_10s}`

This ensures all SMS from the same transaction go in the same group.

## Benefits

1. **Order-independent:** Doesn't matter which SMS arrives first
2. **Simpler logic:** One analysis function instead of multiple handlers
3. **More reliable:** Waits for ALL SMS before deciding
4. **Handles edge cases:** Works even if fraud alert never arrives
5. **Clean code:** Removed 200+ lines of complex pending buffer logic

## Example Scenarios

### Scenario 1: Self-Transfer (Slice → Kotak)
```
T+0s: Slice debit SMS arrives → added to sms_group_608709747765
T+2s: Kotak credit SMS arrives → added to sms_group_608709747765
T+25s: Timer expires → analyze group
  - Found accounts: 5235 (Slice), 1447 (Kotak)
  - Both are user's accounts
  - Decision: SELF TRANSFER
  - Save: "Slice ••5235 → Kotak ••1447"
```

### Scenario 2: Kotak Fraud SMS with Transaction Data
```
T+0s: Kotak SMS arrives: "Rs. 1 debited from A/c XX1447. Not you? Visit kotak.com"
  - shouldSkipSMS() detects fraud format
  - But also finds amount (1) and account (1447)
  - Returns false → SMS is processed
  - Added to sms_group_608709747765
T+25s: Timer expires → analyze group
  - Found accounts: 1447 (Kotak)
  - Only 1 user account, debit SMS present
  - Decision: EXPENSE
  - Save: "Paid ₹1"
```

### Scenario 3: Regular Expense
```
T+0s: Debit SMS arrives → added to sms_group_608709747766
T+25s: Timer expires → analyze group
  - Found accounts: 1447 (Kotak)
  - Only 1 user account, debit SMS present
  - Decision: EXPENSE
  - Save: "Paid to Merchant"
```

### Scenario 4: Regular Income
```
T+0s: Credit SMS arrives → added to sms_group_608709747767
T+25s: Timer expires → analyze group
  - Found accounts: 5235 (Slice)
  - Only 1 user account, credit SMS present
  - Decision: INCOME
  - Save: "Received from John"
```

### Scenario 5: SBI Late Confirmation
```
T+0s: Transaction SMS arrives → added to sms_group_608709747768
T+22s: SBI confirmation SMS arrives → added to sms_group_608709747768
T+25s: Timer expires → analyze group with both SMS
  - More complete data for analysis
```

### Scenario 6: Single SMS Self-Transfer (No Confirmation)
```
T+0s: Kotak debit SMS arrives: "Rs. 100 sent to yashbhavsar@okaxis from AC X1447"
  - Added to sms_group_608709747769
T+25s: Timer expires (no second SMS arrived)
  - Found source account: 1447 (Kotak) - user's account
  - Extracted destination UPI: yashbhavsar@okaxis
  - Destination UPI also belongs to user (Slice account)
  - Decision: SELF TRANSFER (single SMS)
  - Save: "Kotak ••1447 → Slice ••5235"
```

### Scenario 7: SBI UPI Gateway SMS with Account Info
```
T+0s: Transaction SMS arrives → added to sms_group_608709747770
T+2s: SBI gateway SMS arrives from VK-SBIUPI: "UPI Ref 608709747770 transfer from X5191"
  - shouldSkipSMS() detects UPI gateway sender
  - But finds ref ID + account (5191)
  - Extracts and adds to sms_group_608709747770
  - Then skips the SMS
T+25s: Timer expires → analyze group
  - Now has account info from gateway SMS
  - More complete data for matching
```

## Code Structure

### Interfaces
```typescript
interface CollectedSms {
  body: string;
  sender: string;
  timestamp: number;
  refId: string | null;
  amount: number | null;
}
```

### Key Functions
- `addToCollectionBuffer()` - Adds SMS to group
- `analyzeAndSave()` - Analyzes group and saves transaction
- `loadUserUpiAccounts()` - Fetches from bank_accounts table

### Storage Keys
- `sms_group_{refId}` - Collection buffer for SMS group
- `timer_set_{groupKey}` - Tracks if timer is running

## Removed Components

1. ❌ `pendingTransactionBuffer.ts` dependency
2. ❌ `fraud_skip_ref_*` system
3. ❌ `pending_credit_*` system
4. ❌ 3-second delays
5. ❌ `handleFraudAlertSMS()` function
6. ❌ `handlePendingCreditSMS()` function
7. ❌ `detectSelfTransferWithAccounts()` function
8. ❌ `checkDuplicateUpiRef()` function
9. ❌ `cleanupOldPendingCredits()` function

## Configuration

```typescript
const COLLECTION_TIMEOUT_MS = 25000; // 25 seconds
```

Why 25 seconds?
- SBI confirmation SMS can arrive 20+ seconds after the transaction
- Kotak sends debit info + fraud alert in the same SMS (no delay needed)
- Slice sends fraud alert separately (usually within 2-3 seconds)
- 25 seconds ensures we capture all related SMS

## Special Cases Handled

### Kotak Fraud SMS
Kotak sends transaction data AND fraud warning in the SAME SMS:
```
"Rs. 1 debited from AC X1447 on 27-03-26. Not you? Visit kotak.com/fraud"
```

The `shouldSkipSMS()` function now:
1. Detects fraud-style SMS (contains "not you")
2. Checks for transaction keywords (sent/received/debited/credited with Rs. amount)
3. If found → processes it normally (doesn't skip)
4. Otherwise checks if it has amount + account data
5. If yes → processes it normally
6. If no → skips it

### Account Number Extraction
Enhanced `extractAccountLast4()` to handle multiple formats:
- `A/c XX1234` or `A/c X1447` (standard format)
- `AC X1447` (Kotak format)
- `Account ending 1234`
- `a/c x1447` (lowercase)
- `X1447` (standalone)

### SBI UPI Gateway SMS
SBI sends confirmation SMS from `VK-SBIUPI` sender that contains account info:
```
"UPI Ref 123456789 transfer from X5191 to yashbhavsar@okaxis"
```

The `shouldSkipSMS()` function now:
1. Detects UPI gateway senders (sbiupi, upiref, npci)
2. Checks if SMS has UPI ref ID + account number
3. If yes → extracts and adds to collection buffer, then skips
4. If no → skips immediately

This ensures account info from gateway SMS is captured even though the SMS itself is skipped.

### Single SMS Self-Transfer
When only 1 SMS arrives after 25 seconds (e.g., SBI confirmation never comes):
1. Check if source account belongs to user (matched in SMS)
2. Extract destination UPI ID from SMS
3. Check if destination UPI ID also belongs to user
4. If both match → mark as self-transfer
5. Note: "Kotak ••1447 → Slice ••5235"

This handles cases where the second bank doesn't send a confirmation SMS.

### UPI ID Matching
Strict matching logic in `analyzeAndSave()`:
1. **First priority:** Match by account last 4 digits
2. **Second priority:** Match by FULL UPI ID in SMS body (exact match)
3. **Removed:** Username-only matching (too unreliable)

Why removed username matching?
- Multiple accounts can have same username: `yashbhavsar175@oksbi`, `yashbhavsar175@okaxis`
- Username-only matching would incorrectly match both accounts
- Full UPI ID matching is more accurate

## Testing

Test cases to verify:
1. Self-transfer with both SMS arriving within 25s
2. Self-transfer with SMS arriving in reverse order
3. Kotak fraud SMS with transaction data (format: "AC X1447")
4. Kotak fraud SMS with transaction keyword (sent/received/debited/credited)
5. Slice fraud SMS without transaction data (should be skipped)
6. Regular expense (only debit SMS)
7. Regular income (only credit SMS)
8. Multiple transactions with same amount (different ref IDs)
9. SMS without UPI ref ID (grouped by timestamp)
10. SBI late confirmation SMS (arrives 20+ seconds later)
11. Full UPI ID matching (exact match only, no username substring)
12. Single SMS self-transfer (destination UPI belongs to user)
13. Account extraction from various formats (A/c XX1234, AC X1447, X1447)
14. SBI UPI gateway SMS with account info (should extract then skip)
15. Multiple accounts with same username prefix (should NOT match by username alone)

## Migration Notes

No data migration needed. Old pending buffer keys will expire naturally.

Users will notice:
- Transactions appear within 25 seconds instead of instantly
- More accurate self-transfer detection
- No more missed self-transfers due to timing issues
- Kotak fraud SMS now properly captured as transactions
- Better handling of late-arriving confirmation SMS
