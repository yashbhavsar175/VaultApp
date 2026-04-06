# Navigation Restructure - Setup Guide

## Changes Made

### 1. Bottom Navigation (5 tabs instead of 6)

**Before:**
```
Dashboard | Transactions | Banks | People | Add | Settings
```

**After:**
```
Dashboard | History | Add | People | Settings
```

### 2. Tab Changes

| Old | New | Icon | Notes |
|-----|-----|------|-------|
| Dashboard | Dashboard | view-dashboard | Same |
| Transactions | History | history | Renamed |
| Banks | (removed) | - | Accessible from Dashboard |
| People | People | account-group | Same |
| Add | Add | plus-circle | Larger, always purple |
| Settings | Settings | cog | Same |

### 3. Add Tab Styling

- Icon size: 32 (larger than others at 24)
- Color: Always accent purple (even when not selected)
- Center position in tab bar
- More prominent appearance

### 4. Banks Screen Access

- Removed from bottom navigation
- Now accessible from Dashboard
- "My Banks" section added to Dashboard
- Shows max 3 banks in horizontal scroll
- "View All" button navigates to BanksScreen
- "Add Bank" button (when no banks) navigates to BanksScreen

---

## Installation Required

### Install Stack Navigator

```bash
npm install @react-navigation/stack
```

Or with yarn:

```bash
yarn add @react-navigation/stack
```

### Install Gesture Handler (if not already installed)

```bash
npm install react-native-gesture-handler
```

Then rebuild the app:

```bash
# Android
npm run android

# iOS
cd ios && pod install && cd ..
npm run ios
```

---

## Files Created/Modified

### New Files

1. **src/navigation/DashboardStack.tsx**
   - Stack navigator for Dashboard and Banks
   - Allows navigation from Dashboard to BanksScreen

### Modified Files

1. **src/navigation/BottomTabNavigator.tsx**
   - Removed Banks and Transactions tabs
   - Added History tab (renamed Transactions)
   - Updated Add tab styling (larger, always purple)
   - Changed tab order: Dashboard → History → Add → People → Settings
   - Uses DashboardStack instead of Dashboard directly

2. **src/screens/Transactions.tsx**
   - Changed AppHeader title from "Transactions" to "History"

3. **src/screens/Dashboard.tsx**
   - Added imports: BankAccount, getBankAccounts, getBankColor, ScrollView
   - Added banks state
   - Added calculateBankBalance function
   - Added getBankInitial function
   - Added "My Banks" section with horizontal scroll
   - Shows max 3 banks with colored initials
   - Shows total balance below banks
   - "Add Bank" button when no banks exist
   - "View All" navigates to BanksScreen

---

## Dashboard Structure Now

```
┌─────────────────────────────┐
│ Good morning, User          │
│ Friday, 3 April 2026        │
├─────────────────────────────┤
│ Net Balance                 │
│ ₹25,000                     │
├─────────────────────────────┤
│ [Income]    [Expense]       │
│ [Invested]  [EMI]           │
├─────────────────────────────┤
│ My Banks        [View All]  │
│ ┌────┐ ┌────┐ ┌────┐       │
│ │ H  │ │ I  │ │ K  │       │ ← Horizontal scroll
│ │HDFC│ │ICIC│ │Kota│       │
│ │₹5K │ │₹10K│ │₹2K │       │
│ └────┘ └────┘ └────┘       │
│ Total Balance: ₹17,000      │
├─────────────────────────────┤
│ People          [View All]  │
│ [You Lent]  [You Owe]       │
├─────────────────────────────┤
│ Recent Transactions         │
└─────────────────────────────┘
```

---

## Bank Card Design

Each mini bank card shows:

```
┌─────────────────┐
│ ⭕ HDFC Bank    │ ← Colored circle with initial
│    ••1234       │ ← Last 4 digits
│                 │
│ ₹5,000          │ ← Current balance (green/red)
└─────────────────┘
```

- Width: 160px
- Horizontal scroll
- Max 3 banks shown
- Tap to navigate to BanksScreen

---

## Navigation Flow

### Dashboard → Banks

1. User taps "View All" in My Banks section
2. Navigates to BanksScreen
3. Can navigate back to Dashboard

### Dashboard → Add Bank (No Banks)

1. User sees "Add Bank →" button
2. Taps button
3. Navigates to BanksScreen
4. Can add new bank

### Bottom Tab → History

1. User taps "History" tab
2. Shows Transactions screen
3. Header shows "History" instead of "Transactions"

---

## Add Tab Prominence

The Add tab is now more prominent:

```
┌─────┬─────┬─────┬─────┬─────┐
│ 🏠  │ 📜  │  ➕ │ 👥  │ ⚙️  │
│Dash │Hist │ Add │Peop │Sett │
└─────┴─────┴─────┴─────┴─────┘
              ↑
         Larger icon
         Always purple
         Center position
```

---

## Testing Checklist

### Navigation
- [ ] Bottom navigation shows 5 tabs
- [ ] Tab order: Dashboard, History, Add, People, Settings
- [ ] Add tab icon is larger (32px)
- [ ] Add tab icon is always purple
- [ ] History tab shows Transactions screen
- [ ] History screen header shows "History"

### Dashboard
- [ ] My Banks section appears (if banks exist)
- [ ] Shows max 3 banks in horizontal scroll
- [ ] Each bank shows colored initial
- [ ] Each bank shows current balance
- [ ] Total balance shown below banks
- [ ] "View All" navigates to BanksScreen
- [ ] "Add Bank" button appears (if no banks)
- [ ] "Add Bank" navigates to BanksScreen

### Banks Screen
- [ ] Accessible from Dashboard "View All"
- [ ] Accessible from Dashboard "Add Bank"
- [ ] Can navigate back to Dashboard
- [ ] Not in bottom navigation
- [ ] All bank features work normally

### Theme
- [ ] Light mode works
- [ ] Dark mode works
- [ ] Bank initial circles have proper colors
- [ ] Balance colors (green/red) work correctly

---

## Migration Notes

### For Existing Users

- Banks tab removed from bottom navigation
- Banks screen still accessible from Dashboard
- No data loss
- No breaking changes
- Smooth transition

### For New Users

- Cleaner 5-tab navigation
- Banks accessible from Dashboard
- More intuitive flow
- Prominent Add button

---

## Troubleshooting

### "Cannot find module '@react-navigation/stack'"

**Solution:**
```bash
npm install @react-navigation/stack
npm run android  # or npm run ios
```

### Banks section not showing

**Check:**
1. Banks data loaded? (check console logs)
2. getBankAccounts function working?
3. Banks array has data?

### Navigation not working

**Check:**
1. DashboardStack properly imported?
2. Stack navigator installed?
3. Navigation prop available?

### Add tab not prominent

**Check:**
1. Icon size is 32?
2. Color is colors.accent?
3. Tab bar styling correct?

---

## Summary

**Changes:**
- ✅ 5 tabs instead of 6
- ✅ Transactions renamed to History
- ✅ Banks removed from bottom nav
- ✅ Banks accessible from Dashboard
- ✅ Add tab more prominent
- ✅ My Banks section on Dashboard
- ✅ Horizontal scroll for banks
- ✅ Clean navigation structure

**Benefits:**
- Cleaner bottom navigation
- More prominent Add button
- Banks integrated into Dashboard
- Better user experience
- Less cluttered interface

---

**Status: READY FOR TESTING** 🎉

After installing @react-navigation/stack, rebuild the app and test!
