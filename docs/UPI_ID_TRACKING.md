# 💳 UPI ID Tracking Implementation

## ✅ Problem Solved!

Transaction detail me ab **UPI ID** bhi dikhega - konse UPI ID se transaction hua wo clear hoga.

---

## 🎯 Kya Kiya

### 1. **Transaction Type Me UPI ID Field Add Kiya**
```typescript
export interface Transaction {
  // ... existing fields
  upi_id?: string;  // UPI ID used for transaction (e.g., user@paytm)
}
```

### 2. **SMS Parser Me UPI ID Extraction Add Kiya**
```typescript
export function extractUpiId(text: string): string | null {
  // Patterns to match:
  // - to/from/vpa/upi id: user@paytm
  // - user@ybl, user@oksbi, user@okaxis, etc.
  // - Any valid UPI ID format
}
```

### 3. **ParsedTransaction Me UPI ID Field**
```typescript
export interface ParsedTransaction {
  // ... existing fields
  upiId: string | null;  // Extracted UPI ID
}
```

### 4. **Transaction Detail Screen Me Display**
```typescript
{transaction.upi_id && (
  <DetailRow
    icon="qrcode"
    label="UPI ID"
    value={transaction.upi_id}
  />
)}
```

### 5. **Database Migration**
```sql
ALTER TABLE transactions 
ADD COLUMN IF NOT EXISTS upi_id TEXT;

CREATE INDEX IF NOT EXISTS idx_transactions_upi_id 
ON transactions(upi_id);
```

---

## 📱 User Experience

### Before:
```
Transaction Detail:
├── Note: Transaction
├── Category: general
├── Date: Thursday, 14 May 2026
├── Time: 10:28 am
└── Tracked Via: Upi  ← Sirf "Upi" dikhta tha
```

### After:
```
Transaction Detail:
├── Note: Transaction
├── Category: general
├── Date: Thursday, 14 May 2026
├── Time: 10:28 am
├── Tracked Via: Upi
├── UPI ID: user@paytm  ← Ab UPI ID bhi dikhega!
└── Bank Account: HDFC Bank (1234)
```

---

## 🔍 UPI ID Detection Examples

### Example 1: PhonePe SMS
```
SMS: "Rs 500 sent to user@ybl via PhonePe"
Extracted: user@ybl
Display: 
  Tracked Via: Upi (PhonePe)
  UPI ID: user@ybl
```

### Example 2: Google Pay SMS
```
SMS: "You paid Rs 250 to merchant@paytm"
Extracted: merchant@paytm
Display:
  Tracked Via: Upi (Google Pay)
  UPI ID: merchant@paytm
```

### Example 3: Bank UPI SMS
```
SMS: "Rs 1000 debited from A/c XX1234 to john@oksbi"
Extracted: john@oksbi
Display:
  Tracked Via: Upi
  UPI ID: john@oksbi
  Bank Account: SBI (1234)
```

---

## 🎨 UI Display

### Transaction Detail Card:
```
┌─────────────────────────────────────────┐
│  ⏰ Time                                 │
│  10:28 am                                │
├─────────────────────────────────────────┤
│  📡 Tracked Via                          │
│  Upi (PhonePe)                           │
├─────────────────────────────────────────┤
│  📱 UPI ID                               │
│  user@paytm                              │
├─────────────────────────────────────────┤
│  🏦 Bank Account                         │
│  HDFC Bank (1234)                        │
└─────────────────────────────────────────┘
```

---

## 🔧 Technical Implementation

### SMS Parser - UPI ID Extraction:
```typescript
export function extractUpiId(text: string): string | null {
  const upiPatterns = [
    // Pattern 1: Explicit UPI ID mention
    /(?:to|from|vpa|upi id|upi)\s*:?\s*([a-zA-Z0-9._-]+@[a-zA-Z0-9]+)/i,
    
    // Pattern 2: Common UPI handles
    /([a-zA-Z0-9._-]+@(?:paytm|ybl|oksbi|okaxis|okicici|okhdfcbank|axl|ibl|ikwik|fbl|pnb|barodampay|cnrb|upi))/i,
    
    // Pattern 3: Generic UPI ID format
    /\b([a-zA-Z0-9._-]+@[a-zA-Z0-9]+)\b/,
  ];

  for (const pattern of upiPatterns) {
    const match = text.match(pattern);
    if (match && match[1]) {
      const upiId = match[1].trim();
      // Validate format
      if (upiId.includes('@') && upiId.length > 5 && upiId.length < 100) {
        return upiId;
      }
    }
  }
  
  return null;
}
```

### Confidence Score Update:
```typescript
function calculateConfidence(parsed: Partial<ParsedTransaction>): number {
  let score = 0;
  
  if (parsed.amount !== null) score += 30;
  if (parsed.last4Digits !== null) score += 25;
  if (parsed.bankName !== null) score += 20;
  if (parsed.transactionType !== 'unknown') score += 15;
  if (parsed.merchant !== null) score += 10;
  if (parsed.upiId !== null) score += 5;  // ← Bonus for UPI ID!
  
  return score;
}
```

---

## 📊 Supported UPI Handles

### Common UPI Providers:
- **@paytm** - Paytm
- **@ybl** - PhonePe (Yes Bank)
- **@oksbi** - SBI
- **@okaxis** - Axis Bank
- **@okicici** - ICICI Bank
- **@okhdfcbank** - HDFC Bank
- **@axl** - Axis Bank
- **@ibl** - IDBI Bank
- **@ikwik** - IDFC Bank
- **@fbl** - Federal Bank
- **@pnb** - Punjab National Bank
- **@barodampay** - Bank of Baroda
- **@cnrb** - Canara Bank
- **@upi** - Generic UPI

And many more! Parser automatically detects any valid UPI ID format.

---

## 🧪 Testing

### Test Case 1: PhonePe Transaction
```
Input SMS: "Rs 500 sent to merchant@ybl via PhonePe"
Expected:
  - amount: 500
  - upiId: "merchant@ybl"
  - transactionType: "debit"
  - confidence: 75+
```

### Test Case 2: Google Pay Transaction
```
Input SMS: "You paid Rs 250 to shop@paytm using Google Pay"
Expected:
  - amount: 250
  - upiId: "shop@paytm"
  - transactionType: "debit"
  - confidence: 75+
```

### Test Case 3: Bank UPI Transaction
```
Input SMS: "Rs 1000 debited from A/c XX1234 to john@oksbi"
Expected:
  - amount: 1000
  - upiId: "john@oksbi"
  - last4Digits: "1234"
  - transactionType: "debit"
  - confidence: 85+
```

### Test Case 4: No UPI ID
```
Input SMS: "Rs 500 debited from A/c XX1234 at ATM"
Expected:
  - amount: 500
  - upiId: null
  - last4Digits: "1234"
  - transactionType: "debit"
  - confidence: 70+
```

---

## 🎯 Benefits

### 1. **Better Transaction Tracking**
- Ab pata chalega konse UPI ID se payment hua
- Multiple UPI IDs use karte ho to easily identify kar sakte ho

### 2. **Improved Confidence Score**
- UPI ID detect hone se confidence +5% badh jata hai
- Better accuracy in transaction detection

### 3. **Complete Information**
- Tracked Via: Kaunsa app/method
- UPI ID: Konsa UPI ID
- Bank Account: Konsa bank account

### 4. **Future Features**
- UPI ID wise spending analysis
- Favorite UPI IDs tracking
- UPI ID based filtering

---

## 📝 Files Modified

1. ✅ `src/types/index.ts` - Added `upi_id` field to Transaction interface
2. ✅ `src/lib/services/smsParser.ts` - Added UPI ID extraction
3. ✅ `src/screens/transactions/TransactionDetail.tsx` - Display UPI ID
4. ✅ `supabase/migrations/add_upi_id_to_transactions.sql` - Database migration

---

## 🚀 Next Steps

### To Apply Migration:
```bash
# Run migration on Supabase
supabase db push

# Or manually run the SQL in Supabase dashboard
```

### To Test:
1. Send a test UPI SMS
2. Check if transaction is created
3. Open transaction detail
4. Verify UPI ID is displayed

---

## 💡 Example Scenarios

### Scenario 1: PhonePe Payment
```
User: Pays ₹500 via PhonePe to merchant@ybl
SMS:  "Rs 500 sent to merchant@ybl via PhonePe"
App:  Creates transaction with:
      - Amount: ₹500
      - Tracked Via: Upi (PhonePe)
      - UPI ID: merchant@ybl
```

### Scenario 2: Google Pay Payment
```
User: Pays ₹250 via Google Pay to shop@paytm
SMS:  "You paid Rs 250 to shop@paytm"
App:  Creates transaction with:
      - Amount: ₹250
      - Tracked Via: Upi (Google Pay)
      - UPI ID: shop@paytm
```

### Scenario 3: Bank UPI Transfer
```
User: Transfers ₹1000 via SBI UPI to john@oksbi
SMS:  "Rs 1000 debited from A/c XX1234 to john@oksbi"
App:  Creates transaction with:
      - Amount: ₹1000
      - Tracked Via: Upi
      - UPI ID: john@oksbi
      - Bank Account: SBI (1234)
```

---

## ✅ Summary

✅ UPI ID field added to Transaction type
✅ UPI ID extraction implemented in SMS parser
✅ UPI ID displayed in transaction detail
✅ Database migration created
✅ Confidence score updated
✅ Supports all major UPI handles
✅ Validates UPI ID format
✅ Bonus confidence points for UPI ID

**Status**: Ready for testing! 🚀

**Migration Required**: Yes - Run `add_upi_id_to_transactions.sql`
