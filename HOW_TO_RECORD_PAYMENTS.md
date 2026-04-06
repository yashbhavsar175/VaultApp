# How to Record Payments - People Ledger

## Understanding the Payment System

The People Ledger supports **partial payments**, meaning you can record multiple payments over time until the full amount is paid.

---

## Scenario: You Lent Money

### Example
You lent ₹500 to John. He pays you back in parts:
- Day 1: Returns ₹200
- Day 5: Returns ₹300

### How to Record

#### Step 1: Create the Entry
1. Go to **People** tab
2. Tap **+** button
3. Fill in:
   - Person Name: **John**
   - Type: **Lent** (you gave money)
   - Total Amount: **500**
   - Repayment Type: **One Time**
   - Due Date: (optional)
   - Notes: (optional)
4. Tap **Add Entry**

**Initial State:**
```
┌─────────────────────────────┐
│ 👤 John              [Lent] │
│                             │
│ Total: ₹500                 │
│ Paid: ₹0                    │
│ Remaining: ₹500             │
│ [░░░░░░░░░░] 0%            │
│                             │
│ [Add Payment] [Settle] 🗑️  │
└─────────────────────────────┘
```

#### Step 2: Record First Payment (₹200)
1. Find John's card in the list
2. Tap **"Add Payment"** button
3. Enter amount: **200**
4. Add note: "First payment" (optional)
5. Tap **Add Payment**

**After First Payment:**
```
┌─────────────────────────────┐
│ 👤 John              [Lent] │
│                             │
│ Total: ₹500                 │
│ Paid: ₹200                  │
│ Remaining: ₹300             │
│ [████░░░░░░] 40%           │
│                             │
│ 💰 ₹200 paid • View history│
│                             │
│ [Add Payment] [Settle] 🗑️  │
└─────────────────────────────┘
```

#### Step 3: Record Second Payment (₹300)
1. Tap **"Add Payment"** again
2. Enter amount: **300**
3. Add note: "Final payment" (optional)
4. Tap **Add Payment**

**After Second Payment:**
```
┌─────────────────────────────┐
│ 👤 John              [Lent] │
│                             │
│ Total: ₹500                 │
│ Paid: ₹500                  │
│ Remaining: ₹0               │
│ [██████████] 100%          │
│                             │
│ 💰 ₹500 paid • View history│
│                             │
│ [Add Payment] [Settle] 🗑️  │
└─────────────────────────────┘
```

#### Step 4: Mark as Settled
1. Tap **"Settle"** button
2. Confirm the action
3. Entry moves to **"Settled"** tab

---

## Scenario: You Borrowed Money

### Example
You borrowed ₹1000 from Sarah. You pay her back in parts:
- Week 1: Pay ₹400
- Week 2: Pay ₹600

### How to Record

#### Step 1: Create the Entry
1. Go to **People** tab
2. Tap **+** button
3. Fill in:
   - Person Name: **Sarah**
   - Type: **Borrowed** (you received money)
   - Total Amount: **1000**
   - Repayment Type: **One Time**
   - Due Date: (when you need to pay back)
4. Tap **Add Entry**

#### Step 2: Record Payments
Same process as above:
1. Tap **"Add Payment"**
2. Enter amount you paid
3. Tap **Add Payment**

The system tracks everything automatically!

---

## Installment Payments

### Example
You lent ₹3000 to Mike. He'll pay ₹100 per day, Monday to Saturday.

### Setup
1. Create entry with:
   - Type: **Lent**
   - Total: **3000**
   - Repayment Type: **Installment**
   - Installment Amount: **100**
   - Days: Mon-Sat (default)
   - Start Date: Today

### Recording Daily Payments
1. Each day Mike pays, tap **"Add Payment"**
2. Amount is pre-filled with **100**
3. Just tap **Add Payment**

The system shows:
- Expected amount by today
- How much has been paid
- How much is remaining

---

## Payment History

### View All Payments
1. Find the person's card
2. Look for: **"💰 ₹XXX paid • Tap to view history"**
3. Tap on it
4. See all payments with:
   - Amount
   - Date
   - Notes
   - Payment number

### Payment History Modal Shows:
```
┌─────────────────────────────┐
│ Payment History        ✕    │
├─────────────────────────────┤
│ John                        │
│                             │
│ Total: ₹500                 │
│ Paid: ₹500                  │
│ Remaining: ₹0               │
├─────────────────────────────┤
│ ┌─────────────────────────┐ │
│ │ ₹300         Payment #2 │ │
│ │ 15 Jan 2025             │ │
│ │ Final payment           │ │
│ └─────────────────────────┘ │
│                             │
│ ┌─────────────────────────┐ │
│ │ ₹200         Payment #1 │ │
│ │ 10 Jan 2025             │ │
│ │ First payment           │ │
│ └─────────────────────────┘ │
└─────────────────────────────┘
```

---

## Key Features

### Automatic Calculations
✅ **Paid Amount** = Sum of all payments
✅ **Remaining Amount** = Total - Paid
✅ **Progress Bar** = (Paid / Total) × 100%

### Visual Indicators
- 🟢 **Green** = Paid amount
- 🔴 **Red** = Remaining amount
- 📊 **Progress Bar** = Visual payment progress
- 💰 **Payment Link** = Tap to view history

### Smart Tracking
- All payments are stored in database
- Can't lose payment history
- Can add notes to each payment
- Dates are automatically recorded

---

## Common Questions

### Q: Can I record multiple payments?
**A:** Yes! That's the whole point. Record as many payments as needed.

### Q: What if someone pays more than remaining?
**A:** The system will accept it, but you should only enter the actual remaining amount.

### Q: Can I edit a payment after adding?
**A:** Currently no, but you can add a new payment with a negative note explaining the correction.

### Q: Can I delete a payment?
**A:** Not directly from the UI yet, but you can delete the entire entry and recreate it.

### Q: What happens when fully paid?
**A:** 
1. Remaining shows ₹0
2. Progress bar shows 100%
3. Tap "Settle" to mark as complete
4. Entry moves to "Settled" tab

### Q: Can I see payment dates?
**A:** Yes! Tap on "💰 ₹XXX paid • View history" to see all payment dates and amounts.

---

## Tips

1. **Add Notes**: Use notes to remember context (e.g., "Cash payment", "Bank transfer", "Partial payment 1 of 3")

2. **Regular Updates**: Record payments immediately so you don't forget

3. **Check History**: Tap payment history to verify all payments

4. **Use Installments**: For regular payments, use installment type with daily amount

5. **Set Due Dates**: For one-time payments, set due dates to get reminders

6. **Don't Settle Early**: Only tap "Settle" when fully paid and you want to archive the entry

---

## Example Workflows

### Workflow 1: Lent ₹1000, Getting Back in 2 Parts
```
Day 1:  Create entry (₹1000 lent)
Day 5:  Add payment (₹600) → Remaining: ₹400
Day 10: Add payment (₹400) → Remaining: ₹0
Day 10: Tap "Settle" → Moved to Settled tab
```

### Workflow 2: Borrowed ₹5000, Paying Back Monthly
```
Jan 1:  Create entry (₹5000 borrowed, due Dec 31)
Feb 1:  Add payment (₹500) → Remaining: ₹4500
Mar 1:  Add payment (₹500) → Remaining: ₹4000
...continue monthly...
Dec 1:  Add payment (₹500) → Remaining: ₹0
Dec 1:  Tap "Settle" → Complete!
```

### Workflow 3: Daily Installments
```
Day 1:  Create entry (₹3000, ₹100/day, Mon-Sat)
Day 2:  Add payment (₹100) → 29 days remaining
Day 3:  Add payment (₹100) → 28 days remaining
...continue daily...
Day 30: Add payment (₹100) → Fully paid!
Day 30: Tap "Settle" → Complete!
```

---

## Summary

**Key Points:**
- ✅ Record partial payments anytime
- ✅ System tracks everything automatically
- ✅ View payment history anytime
- ✅ Progress bar shows visual progress
- ✅ Settle when fully paid

**Remember:**
- "Add Payment" = Record money received/paid
- "Settle" = Mark as complete (only when fully paid)
- "View history" = See all past payments

---

**You're all set!** 🎉

Start recording payments and let the app track everything for you!
