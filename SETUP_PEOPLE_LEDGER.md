# Quick Setup Guide - People Ledger Feature

## Step 1: Run Database Migration

### Option A: Supabase Dashboard (Recommended)
1. Go to your Supabase project dashboard
2. Navigate to **SQL Editor** (left sidebar)
3. Click **New Query**
4. Copy the entire content of `supabase-people-ledger.sql`
5. Paste into the SQL editor
6. Click **Run** (or press Ctrl+Enter)
7. Verify success message appears

### Option B: Supabase CLI (If configured)
```bash
# If you have Supabase CLI set up locally
supabase db push
```

## Step 2: Verify Database Setup

Run this query in SQL Editor to verify tables were created:
```sql
SELECT table_name 
FROM information_schema.tables 
WHERE table_schema = 'public' 
AND table_name IN ('people_ledger', 'people_ledger_payments');
```

You should see both tables listed.

## Step 3: Test the Feature

1. **Rebuild the app** (if needed):
   ```bash
   npm run android
   # or
   npm run ios
   ```

2. **Navigate to People tab** in the bottom navigation

3. **Add a test entry**:
   - Tap the "+" button
   - Enter person name: "Test Person"
   - Select type: "Lent"
   - Enter amount: 1000
   - Select "One Time" repayment
   - Set due date: tomorrow's date (YYYY-MM-DD format)
   - Tap "Add Entry"

4. **Verify Dashboard**:
   - Go back to Dashboard
   - Scroll down to see "People" section
   - Should show your test entry

5. **Test Payment**:
   - Go to People tab
   - Tap "Add Payment" on your test entry
   - Enter amount: 500
   - Tap "Add Payment"
   - Verify remaining amount updates to 500

6. **Test Notifications**:
   - Grant notification permissions when prompted
   - Check device notification settings
   - Should see scheduled notification for tomorrow

## Step 4: Clean Up Test Data (Optional)

After testing, you can delete test entries:
- Tap the delete icon (trash) on any entry
- Or mark as "Settled" to archive

## Troubleshooting

### "Table already exists" error
If you see this error, the tables are already created. You can skip the migration or drop existing tables first:
```sql
DROP TABLE IF EXISTS people_ledger_payments CASCADE;
DROP TABLE IF EXISTS people_ledger CASCADE;
```
Then run the migration again.

### RLS Policy errors
If you get permission errors, verify you're logged in:
```sql
SELECT auth.uid(); -- Should return your user ID
```

### Notification permissions
- Android: Settings → Apps → SpendSense → Notifications → Enable
- iOS: Settings → SpendSense → Notifications → Allow Notifications

## Features to Test

- ✅ Add lent entry
- ✅ Add borrowed entry
- ✅ One-time repayment
- ✅ Installment repayment
- ✅ Add payment
- ✅ Mark as settled
- ✅ Delete entry
- ✅ Filter tabs (All/Lent/Borrowed/Settled)
- ✅ Dashboard integration
- ✅ Notifications
- ✅ Dark mode
- ✅ Light mode

## Need Help?

Check `PEOPLE_LEDGER_IMPLEMENTATION.md` for detailed documentation.
