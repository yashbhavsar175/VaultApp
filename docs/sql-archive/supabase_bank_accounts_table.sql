-- Create bank_accounts table for tracking user's bank accounts and balances
-- Run this in Supabase SQL Editor

create table if not exists bank_accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  bank_name text not null,
  account_last4 text not null,
  account_type text not null default 'savings',
  starting_balance numeric not null default 0,
  balance numeric not null default 0,
  credit_limit numeric not null default 0,
  loan_total numeric not null default 0,
  monthly_emi_amount numeric check (monthly_emi_amount is null or monthly_emi_amount >= 0),
  upi_ids text[] default '{}',
  is_archived boolean not null default false,
  archived_at timestamptz,
  created_at timestamptz default now()
);

alter table bank_accounts
add column if not exists user_id uuid references auth.users(id) on delete cascade,
add column if not exists bank_name text,
add column if not exists account_last4 text,
add column if not exists account_type text not null default 'savings',
add column if not exists starting_balance numeric not null default 0,
add column if not exists balance numeric not null default 0,
add column if not exists credit_limit numeric not null default 0,
add column if not exists loan_total numeric not null default 0,
add column if not exists monthly_emi_amount numeric,
add column if not exists upi_ids text[] default '{}',
add column if not exists is_archived boolean not null default false,
add column if not exists archived_at timestamptz;

alter table bank_accounts
alter column account_type set default 'savings',
alter column starting_balance set default 0,
alter column balance set default 0,
alter column credit_limit set default 0,
alter column loan_total set default 0,
alter column upi_ids set default '{}',
alter column is_archived set default false;

update bank_accounts
set account_type = 'current'
where account_type = 'checking';

alter table bank_accounts drop constraint if exists bank_accounts_account_type_check;
alter table bank_accounts
add constraint bank_accounts_account_type_check
check (account_type in ('savings', 'current', 'credit_card', 'loan'));

alter table bank_accounts drop constraint if exists bank_accounts_monthly_emi_amount_nonnegative;
alter table bank_accounts
add constraint bank_accounts_monthly_emi_amount_nonnegative
check (monthly_emi_amount is null or monthly_emi_amount >= 0);

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
create index if not exists idx_bank_accounts_user_archived on bank_accounts(user_id, is_archived);
create index if not exists idx_bank_accounts_user_archived_created on bank_accounts(user_id, is_archived, created_at desc);

-- Verify table creation
select * from bank_accounts limit 1;
