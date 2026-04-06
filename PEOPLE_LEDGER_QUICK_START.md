# People Ledger - Quick Start 🚀

## 1️⃣ Run Database Migration (REQUIRED)

Copy and paste this entire SQL into **Supabase SQL Editor**:

```sql
-- File: supabase-people-ledger.sql
-- Copy the entire content of this file and run it in Supabase Dashboard → SQL Editor
```

Or open `supabase-people-ledger.sql` and copy all content to Supabase SQL Editor, then click Run.

## 2️⃣ Rebuild App

```bash
npm run android
# or
npm run ios
```

## 3️⃣ Test the Feature

1. Open app → Navigate to **People** tab (bottom navigation)
2. Tap **+** button to add entry
3. Fill in details and save
4. Check **Dashboard** to see People section
5. Grant notification permissions when prompted

## 🎯 What You Get

### Dashboard
- Summary cards showing total lent/owed
- Top 3 pending entries
- Overdue/Due today badges
- Toast notifications

### People Screen
- Full list of all entries
- Filter by: All | Lent | Borrowed | Settled
- Add/Edit/Delete entries
- Record payments
- Mark as settled
- Progress tracking

### Notifications
- Daily reminders at 9:00 AM
- One-time due date alerts
- Installment reminders
- Overdue notifications

## 📋 Entry Types

### Lent (You gave money)
- Track who owes you
- Set due dates
- Record payments received

### Borrowed (You received money)
- Track who you owe
- Set repayment schedule
- Record payments made

### Repayment Types

**One Time**
- Single due date
- Full amount expected by date
- Reminder 1 day before

**Installment**
- Daily payments
- Custom days (Mon-Sat by default)
- Excludes Sundays
- Tracks expected vs actual

## 🎨 UI Features

- ✅ Light/Dark mode support
- ✅ Color-coded avatars
- ✅ Progress bars
- ✅ Status badges
- ✅ Smooth animations
- ✅ Empty states

## 📱 Navigation

```
Bottom Tab Bar:
Dashboard → Transactions → Banks → People → Add → Settings
                                      ↑
                                   NEW TAB
```

## 🔔 Notification Types

1. **Due Today**: "⚠️ Vikas needs to return ₹500 today!"
2. **Installment**: "💰 Rahul's daily ₹200 — ₹1400 remaining"
3. **Overdue**: "🔴 Vikas payment overdue by 3 days!"
4. **In-App Toast**: Shows on Dashboard when app opens

## 🐛 Common Issues

**Notifications not showing?**
- Check app notification permissions
- Verify battery optimization is off
- Ensure background execution allowed

**Data not loading?**
- Verify SQL migration ran successfully
- Check Supabase connection
- Ensure user is logged in

**UI looks broken?**
- Clear app cache
- Rebuild app
- Check theme is properly initialized

## 📚 Documentation

- **Full Details**: `PEOPLE_LEDGER_IMPLEMENTATION.md`
- **Setup Guide**: `SETUP_PEOPLE_LEDGER.md`
- **SQL Schema**: `supabase-people-ledger.sql`

## ✅ Checklist

- [ ] SQL migration executed
- [ ] App rebuilt
- [ ] People tab visible
- [ ] Can add entry
- [ ] Can add payment
- [ ] Dashboard shows People section
- [ ] Notifications working
- [ ] Dark mode tested
- [ ] Light mode tested

---

**Ready to use!** 🎉

For detailed documentation, see `PEOPLE_LEDGER_IMPLEMENTATION.md`
