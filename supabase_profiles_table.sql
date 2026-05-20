-- Create profiles table
create table profiles (
  id uuid references auth.users(id) primary key,
  full_name text,
  phone text,
  monthly_budget numeric,
  currency text default 'INR',
  updated_at timestamptz default now()
);

-- Enable Row Level Security
alter table profiles enable row level security;

-- Create policy for users to manage their own profile
drop policy if exists "Users can manage own profile" on profiles;
create policy "Users can manage own profile"
  on profiles for all
  using (auth.uid() = id)
  with check (auth.uid() = id);

-- Create policy for users to view their own profile
drop policy if exists "Users can view own profile" on profiles;
create policy "Users can view own profile"
  on profiles for select
  using (auth.uid() = id);
