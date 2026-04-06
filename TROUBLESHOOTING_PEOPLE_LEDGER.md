# Troubleshooting - People Ledger

## Issue: "No entries found" but data was just added

### Symptoms
- Summary cards show correct amounts (e.g., "₹500" and "1 people")
- But the list below shows "No entries found"
- The "Settled" tab is highlighted in purple

### Root Cause
You're viewing the **"Settled"** filter tab, but your newly added entry is **not settled** yet.

### Solution
**Tap on the "All" tab** (the first tab on the left) to see all your entries.

### Filter Tabs Explained

1. **All** - Shows all active (not settled) entries
2. **Lent** - Shows only money you lent to others (not settled)
3. **Borrowed** - Shows only money you borrowed (not settled)
4. **Settled** - Shows only completed/settled entries

### How to Test

1. Add a new entry (e.g., Lent ₹500 to "John")
2. Make sure you're on the **"All"** tab (first tab)
3. You should see your entry in the list
4. The entry will show:
   - Person's name with colored avatar
   - Total, Paid, and Remaining amounts
   - Progress bar
   - Action buttons

### Visual Indicators

**Active Tab:**
- Purple/Accent color background
- White text
- Bold font weight
- No border

**Inactive Tab:**
- Card/Background color
- Normal text color
- Normal font weight
- Border visible

### Common Scenarios

#### Scenario 1: Just added entry, can't see it
- **Check:** Are you on "All" or "Lent"/"Borrowed" tab?
- **Fix:** Switch to the correct tab

#### Scenario 2: Entry disappeared after marking as settled
- **Check:** Are you on "All" tab?
- **Fix:** Switch to "Settled" tab to see settled entries

#### Scenario 3: Summary shows data but list is empty
- **Check:** Which filter tab is active?
- **Fix:** Switch to "All" tab

### Improved Features (Latest Update)

✅ **Better Visual Feedback**
- Active tab has bold text
- Inactive tabs have border
- Console logs for debugging

✅ **Helpful Empty States**
- Different messages for each filter
- "View all entries" link when filtered
- Clear indication of which filter is active

✅ **Debug Console Logs**
- Filter changes are logged
- Entry counts are logged
- Check React Native debugger for details

### How to Check Console Logs

1. Open React Native debugger or Metro bundler
2. Look for logs like:
   ```
   Filter: all Total entries: 1 Filtered: 1
   Filter changed to: settled
   Filter: settled Total entries: 1 Filtered: 0
   ```

### Data Verification

To verify your data was saved:

1. **Check Summary Cards**
   - "You Lent" should show total lent amount
   - "You Owe" should show total borrowed amount
   - Count should show number of people

2. **Check Database (Supabase Dashboard)**
   - Go to Table Editor
   - Open `people_ledger` table
   - Verify your entry exists
   - Check `is_settled` column (should be `false`)

3. **Check Dashboard**
   - Go to Dashboard tab
   - Scroll to "People" section
   - Should show your entry there too

### Still Having Issues?

1. **Reload the screen**
   - Pull down to refresh (if implemented)
   - Or navigate away and back

2. **Check authentication**
   - Ensure you're logged in
   - Check if user_id matches in database

3. **Check RLS policies**
   - Run this in Supabase SQL Editor:
   ```sql
   SELECT * FROM people_ledger WHERE user_id = auth.uid();
   ```

4. **Check for errors**
   - Look at React Native console
   - Check for red error screens
   - Look for network errors

### Quick Test

Add this test entry:
- Person Name: "Test Person"
- Type: Lent
- Amount: 100
- Repayment: One Time
- Due Date: Tomorrow

Then:
1. Tap "All" tab → Should see entry
2. Tap "Lent" tab → Should see entry
3. Tap "Borrowed" tab → Should NOT see entry (correct!)
4. Tap "Settled" tab → Should NOT see entry (correct!)
5. Mark as settled → Now appears in "Settled" tab

---

## Summary

**Most Common Issue:** Wrong filter tab selected

**Quick Fix:** Tap the "All" tab (first tab)

**Remember:** 
- New entries are NOT settled by default
- They appear in "All", "Lent", or "Borrowed" tabs
- Only settled entries appear in "Settled" tab
