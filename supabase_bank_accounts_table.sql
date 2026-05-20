-- Create bank_accounts table for tracking user's bank accounts and balances
-- Run this in Supabase SQL Editor

create table if not exists bank_accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  bank_name text not null,
  account_last4 text not null,
  starting_balance numeric not null default 0,
  balance numeric not null default 0,
  upi_ids text[] default '{}',
  created_at timestamptz default now()
);

alter table bank_accounts
add column if not exists user_id uuid references auth.users(id) on delete cascade,
add column if not exists bank_name text,
add column if not exists account_last4 text,
add column if not exists starting_balance numeric not null default 0,
add column if not exists balance numeric not null default 0;

alter table bank_accounts
alter column starting_balance set default 0,
alter column balance set default 0,
alter column upi_ids set default '{}';

-- Enable RLS
alter table bank_accounts enable row level security;

-- Policy: Users can only manage their own bank accounts
drop policy if exists "Users manage own banks" on bank_accounts;
create policy "Users manage own banks"
  on bank_accounts for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Create index for faster queries
create index if not exists bank_accounts_user_id_idx on bank_accounts(user_id);
create index if not exists bank_accounts_last4_idx on bank_accounts(account_last4);

-- Verify table creation
select * from bank_accounts limit 1;
