# UPI Account Management Consolidation

## Problem
Duplicate UPI account data stored in two places:
1. `profiles.upi_accounts` (JSONB column)
2. `bank_accounts.upi_ids` (text array)

This caused data sync issues and confusion about which data source to use.

## Solution: Single Source of Truth

Made `bank_accounts` table the single source of truth for all UPI account management.

## Changes Made

### 1. SmsProcessorTask.ts
Updated `loadUserUpiAccounts()` to fetch from `bank_accounts` table instead of cached profile data:

```typescript
async function loadUserUpiAccounts(): Promise<UpiAccount[]> {
  // Try cache first (5-minute TTL)
  const cached = await AsyncStorage.getItem(USER_UPI_ACCOUNTS_KEY);
  if (cached) return JSON.parse(cached);
  
  // Fetch from bank_accounts table
  const { data } = await supabase
    .from('bank_accounts')
    .select('bank_name, upi_ids, account_last4');
  
  // Flatten: each UPI ID becomes one UpiAccount entry
  const accounts: UpiAccount[] = [];
  data.forEach(bank => {
    (bank.upi_ids || []).forEach((upiId: string) => {
      accounts.push({
        bankName: bank.bank_name,
        upiId: upiId,
        accountLast4: bank.account_last4,
      });
    });
  });
  
  // Cache for 5 minutes
  await AsyncStorage.setItem(USER_UPI_ACCOUNTS_KEY, JSON.stringify(accounts));
  setTimeout(() => AsyncStorage.removeItem(USER_UPI_ACCOUNTS_KEY), 5 * 60 * 1000);
  
  return accounts;
}
```

### 2. BanksScreen.tsx
Added cache invalidation when banks are saved/edited:

```typescript
// After successful save
await AsyncStorage.removeItem('user_upi_accounts');
```

This ensures SMS processor reloads fresh data from `bank_accounts` table.

### 3. ProfileScreen.tsx
Removed entire UPI Accounts section. Now only contains:
- Full Name (required)
- Phone Number
- Monthly Income Budget
- Currency selection

### 4. Settings.tsx
Removed "UPI Accounts & Banks" row that opened ProfileScreen modal for UPI management.

### 5. LoginScreen.tsx
Removed UPI accounts caching logic on login. No longer fetches `profiles.upi_accounts`.

## Data Flow

### Before (Duplicate Data)
```
User adds UPI account in ProfileScreen
  ↓
Saves to profiles.upi_accounts
  ↓
Caches in AsyncStorage
  ↓
SMS processor reads from cache
  ↓
Banks screen has separate UPI IDs
  ↓
Data out of sync!
```

### After (Single Source)
```
User adds bank + UPI IDs in BanksScreen
  ↓
Saves to bank_accounts.upi_ids
  ↓
Invalidates cache
  ↓
SMS processor fetches from bank_accounts
  ↓
Caches for 5 minutes
  ↓
All data in sync!
```

## Benefits

1. **No duplicate data** - One place to manage banks and UPI IDs
2. **Automatic sync** - SMS processor always reads from bank_accounts
3. **Better UX** - Banks screen shows balance + UPI IDs together
4. **Simpler code** - No need to sync between two tables
5. **Cache invalidation** - Ensures fresh data after edits

## User Experience

### Where to manage UPI accounts now?
**Banks screen only** - Navigate to Banks tab, add/edit banks with their UPI IDs

### What about existing data in profiles.upi_accounts?
- Column still exists in database (not dropped)
- No longer used by the app
- Users need to re-add their banks in Banks screen
- Optional: Can run SQL cleanup to clear old data

### Cache behavior
- First load: Fetches from bank_accounts table
- Cached for 5 minutes
- Invalidated on bank save/edit
- Automatically reloads on next SMS

## Migration Notes

Users upgrading from previous version:
1. Open Banks screen
2. Add their banks with account last 4 digits
3. Add UPI IDs for each bank
4. Self-transfer detection will work immediately

No data migration script needed - users simply re-enter in Banks screen.

## Database Schema

### bank_accounts table (single source of truth)
```sql
- id: uuid
- user_id: uuid
- bank_name: text
- account_last4: text
- starting_balance: numeric
- upi_ids: text[]  ← Used for SMS matching
- created_at: timestamptz
```

### profiles table (no longer uses upi_accounts)
```sql
- id: uuid
- full_name: text
- phone: text
- monthly_budget: numeric
- currency: text
- upi_accounts: jsonb  ← Deprecated, not used
- created_at: timestamptz
```

## Testing Checklist

- [x] SMS processor loads UPI accounts from bank_accounts
- [x] Cache invalidation works on bank save
- [x] Self-transfer detection works with new data source
- [x] ProfileScreen no longer shows UPI section
- [x] Settings screen no longer has UPI management link
- [x] LoginScreen doesn't cache profiles.upi_accounts
- [x] Banks screen shows UPI IDs correctly
- [x] Balance calculation uses UPI IDs for matching
