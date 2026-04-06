# Login Crash Fix

## Problem
App crash ho jati thi jab user login karta tha.

## Root Cause
Dashboard screen login ke baad load hoti hai aur wo immediately 3 database tables se data fetch karti hai:
1. `transactions` table
2. `people_ledger` table  
3. `bank_accounts` table

Agar ye tables exist nahi karti ya user ke paas proper RLS (Row Level Security) policies nahi hai, to database queries fail ho jati thi aur app crash kar jati thi.

## Solution Applied
Dashboard.tsx me `loadData()` function ko update kiya:
- Har database call ko individual try-catch block me wrap kiya
- Agar koi table load nahi hota, to empty array set karte hain instead of crashing
- User ko Toast message dikhate hain agar transactions load nahi hote

## Next Steps - Database Setup Required

Aapko Supabase me ye tables create karne honge. Run these SQL scripts:

### 1. Transactions Table
```sql
-- Already exists from supabase-setup.sql
-- Make sure RLS is enabled and policies are set
```

### 2. People Ledger Table
```sql
-- Run supabase-people-ledger.sql file
```

### 3. Bank Accounts Table
```sql
-- Create bank_accounts table
CREATE TABLE bank_accounts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  bank_name TEXT NOT NULL,
  account_last4 TEXT NOT NULL,
  account_type TEXT NOT NULL CHECK (account_type IN ('savings', 'current', 'credit_card', 'loan')),
  starting_balance NUMERIC DEFAULT 0,
  credit_limit NUMERIC DEFAULT 0,
  loan_total NUMERIC DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE bank_accounts ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Users can view own bank accounts"
  ON bank_accounts FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own bank accounts"
  ON bank_accounts FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own bank accounts"
  ON bank_accounts FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own bank accounts"
  ON bank_accounts FOR DELETE
  USING (auth.uid() = user_id);
```

### 4. Profiles Table
```sql
-- Create profiles table if not exists
CREATE TABLE IF NOT EXISTS profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Users can view own profile"
  ON profiles FOR SELECT
  USING (auth.uid() = id);

CREATE POLICY "Users can update own profile"
  ON profiles FOR UPDATE
  USING (auth.uid() = id);
```

## Testing
1. Login karo app me
2. Dashboard load honi chahiye without crash
3. Agar tables nahi hai, to error toast dikhega but app crash nahi hogi
4. Tables create karne ke baad, data properly load hoga

## Bottom Tab Navigation Fix
Also fixed the Add tab button styling:
- Purple circle background (52x52)
- White plus icon (size 28)
- Elevated with shadow
- No label under Add tab
- Always shows purple (not affected by focused state)
- Other tabs use accent color when focused, grey (#888) when not focused
