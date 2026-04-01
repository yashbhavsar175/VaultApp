# Account Types Implementation Summary

## Changes Made

### 1. Database Schema (supabase_add_account_types.sql)
Added three new columns to `bank_accounts` table:
- `account_type` (text): 'savings', 'current', 'credit_card', or 'loan' (default: 'savings')
- `credit_limit` (numeric): Credit limit for credit cards (default: 0)
- `loan_total` (numeric): Total loan amount for loans (default: 0)

### 2. TypeScript Types (src/types/index.ts)
Updated `BankAccount` interface to include:
- `account_type: 'savings' | 'current' | 'credit_card' | 'loan'`
- `credit_limit: number`
- `loan_total: number`

### 3. Database Functions (src/lib/bankDb.ts)
Updated `addBankAccount` to include new fields when inserting records.

### 4. BanksScreen UI (src/screens/BanksScreen.tsx)

#### Form State
Added new state variables:
- `accountType`: Tracks selected account type
- `creditLimit`: Credit card limit input
- `loanTotal`: Loan amount input

#### Account Type Selector
Added 4-button selector in Add/Edit modal:
- Savings/Current (default)
- Credit Card
- Loan/EMI

#### Conditional Fields
- Savings/Current: Shows "Starting Balance" field
- Credit Card: Shows "Credit Limit" field
- Loan: Shows "Total Loan Amount" field

#### Balance Calculation
Updated `calculateCurrentBalance()` to handle each type:
- **Savings/Current**: starting_balance + received - spent
- **Credit Card**: credit_limit - (spent - received) = available credit
- **Loan**: loan_total - EMI_paid = remaining loan

Added helper functions:
- `getOutstandingAmount()`: For credit cards (spent - received)
- `getEMIPaid()`: For loans (sum of EMI transactions)

#### Bank Card Display
Different UI per account type:

**Savings/Current:**
- Icon: 'bank' (purple)
- Shows: Starting Balance, Current Balance (green if positive)

**Credit Card:**
- Icon: 'credit-card' (purple)
- Shows: Credit Limit, Available Credit (green), Outstanding (red)

**Loan:**
- Icon: 'cash-minus' (red)
- Shows: Total Loan, Remaining Loan (red), EMI Paid (green)

### 5. Validation
Added validation in `handleSave()`:
- Credit Card: Requires valid credit_limit > 0
- Loan: Requires valid loan_total > 0

## Usage

### Run SQL Migration
Execute `supabase_add_account_types.sql` in your Supabase SQL editor.

### Add Credit Card
1. Tap "+" button
2. Select "Credit Card" type
3. Enter bank name, last 4 digits, credit limit
4. Optionally add UPI IDs
5. Save

### Add Loan
1. Tap "+" button
2. Select "Loan/EMI" type
3. Enter bank name, last 4 digits, total loan amount
4. Save

### Transaction Tracking
- Credit Card: Expenses reduce available credit, payments increase it
- Loan: EMI transactions reduce remaining loan amount
- Savings/Current: Works as before

## Notes
- Existing bank accounts will default to 'savings' type
- SMS processor unchanged - only uses bank_name, upi_ids, account_last4
- Total Balance card includes all account types
- Cache invalidation works for all account types
