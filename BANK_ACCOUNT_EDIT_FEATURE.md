# Bank Account Edit Feature

## Overview
Added the ability to change the bank account associated with a transaction when editing it in the Edit Transaction Modal.

## Changes Made

### 1. Added Bank Account State
```typescript
const [bankAccounts, setBankAccounts] = useState<any[]>([]);
const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null);
```

### 2. Load Bank Accounts Function
```typescript
const loadBankAccounts = async () => {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      const { data, error } = await supabase
        .from('bank_accounts')
        .select('id, bank_name, account_last4')
        .eq('user_id', user.id)
        .order('bank_name', { ascending: true });
      
      if (!error) {
        setBankAccounts(data || []);
      }
    }
  } catch (error) {
    console.error('Error loading bank accounts:', error);
  }
};
```

### 3. Initialize Selected Account
When transaction loads, set the current account:
```typescript
setSelectedAccountId(transaction.account_id || null);
```

### 4. Save Account ID on Update
```typescript
const updates: Partial<Transaction> = {
  note: note.trim(),
  type,
  category: category.trim(),
  amount: parseFloat(amount) || transaction.amount,
  account_id: selectedAccountId || transaction.account_id, // ✅ Save selected account
};
```

### 5. Bank Account Selector UI
Added a horizontal scrollable selector between Category and Transaction Info sections:

```tsx
{/* Bank Account Selector */}
{bankAccounts.length > 0 && (
  <View style={{ marginBottom: 20 }}>
    <Text style={[typography.bodyBold, { color: colors.text, marginBottom: 8, fontSize: 14 }]}>
      Bank Account
    </Text>
    <ScrollView horizontal showsHorizontalScrollIndicator={false}>
      {bankAccounts.map((account) => (
        <TouchableOpacity
          key={account.id}
          style={[
            styles.bankButton,
            {
              backgroundColor: selectedAccountId === account.id ? colors.accent : colors.card,
              borderColor: selectedAccountId === account.id ? colors.accent : colors.border,
            },
          ]}
          onPress={() => setSelectedAccountId(account.id)}>
          <MaterialCommunityIcons name="bank" size={20} color={...} />
          <Text>{account.bank_name}</Text>
          <Text>••{account.account_last4}</Text>
        </TouchableOpacity>
      ))}
    </ScrollView>
  </View>
)}
```

## UI Design

### Bank Account Button
Each bank account is displayed as a card with:
- **Bank icon** (🏦)
- **Bank name** (e.g., "HDFC Bank")
- **Last 4 digits** (e.g., "••1234")

### Selected State
- **Background**: Accent color (purple)
- **Text**: White
- **Border**: Accent color

### Unselected State
- **Background**: Card color
- **Text**: Normal text color
- **Border**: Border color

### Layout
```
┌─────────────────────────────────────┐
│ Bank Account                        │
│                                     │
│ ┌──────┐  ┌──────┐  ┌──────┐      │
│ │  🏦  │  │  🏦  │  │  🏦  │      │
│ │ HDFC │  │ ICICI│  │  SBI │      │
│ │••1234│  │••5678│  │••9012│      │
│ └──────┘  └──────┘  └──────┘      │
│  Selected  Normal    Normal        │
└─────────────────────────────────────┘
```

## User Flow

1. User double-taps a transaction to edit
2. Modal opens with all transaction details
3. User scrolls to "Bank Account" section
4. User sees all their bank accounts in a horizontal scroll
5. Current account is highlighted (purple background)
6. User taps a different bank account
7. That account becomes selected (purple background)
8. User clicks "Save Changes"
9. Transaction is updated with new bank account

## Benefits

1. **Flexibility** - User can correct wrong bank account assignments
2. **Manual Entry** - Useful for manually entered transactions
3. **SMS Errors** - Fix transactions where SMS didn't have account info
4. **Account Migration** - Move transactions between accounts
5. **Visual Feedback** - Clear indication of selected account

## Edge Cases Handled

1. **No Bank Accounts** - Selector doesn't show if user has no accounts
2. **Single Account** - Still shows selector, allows confirmation
3. **No Account Selected** - Falls back to original account_id
4. **Account Deleted** - Transaction keeps old account_id reference

## Styling

### New Styles Added
```typescript
bankScrollContent: {
  paddingRight: 20,
},
bankButton: {
  minWidth: 110,
  paddingVertical: 12,
  paddingHorizontal: 14,
  borderWidth: 1,
  alignItems: 'center',
  justifyContent: 'center',
},
```

## Technical Details

### File Modified
- `src/components/ui/EditTransactionModal.tsx`

### Database Field Updated
- `transactions.account_id` - Updated when user saves changes

### Dependencies
- Uses existing `supabase` client
- Uses existing theme colors and typography
- Uses `MaterialCommunityIcons` for bank icon

## Testing

### Test Cases

1. **Edit Transaction with Account**
   - Open transaction with existing account
   - Verify current account is selected (purple)
   - Change to different account
   - Save and verify account_id updated

2. **Edit Transaction without Account**
   - Open manually entered transaction (no account)
   - Select a bank account
   - Save and verify account_id is set

3. **Multiple Accounts**
   - User with 3+ bank accounts
   - Verify horizontal scroll works
   - Verify all accounts are visible

4. **Single Account**
   - User with only 1 bank account
   - Verify selector still shows
   - Verify account is pre-selected

5. **No Accounts**
   - User with no bank accounts
   - Verify selector doesn't show
   - Verify modal still works

## Future Enhancements

1. **Account Balance Update** - Update balances when moving transactions
2. **Bulk Edit** - Change account for multiple transactions
3. **Smart Suggestions** - Suggest account based on merchant/amount
4. **Account Search** - Search/filter for users with many accounts
5. **Recent Accounts** - Show recently used accounts first

## Related Features
- Bank Account Management (Banks screen)
- Transaction Creation (Add Transaction)
- Transaction Filtering (by account)
- Balance Calculation (per account)
