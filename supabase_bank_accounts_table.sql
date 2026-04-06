-- Create bank_accounts table for tracking user's bank accounts and balances
-- Run this in Supabase SQL Editor

create table bank_accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  bank_name text not null,
  account_last4 text not null,
  starting_balance numeric not null default 0,
  upi_ids text[] default '{}',
  created_at timestamptz default now()
);

-- Enable RLS
alter table bank_accounts enable row level security;

-- Policy: Users can only manage their own bank accounts
create policy "Users manage own banks"
  on bank_accounts for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Create index for faster queries
create index bank_accounts_user_id_idx on bank_accounts(user_id);

-- Verify table creation
select * from bank_accounts limit 1;
