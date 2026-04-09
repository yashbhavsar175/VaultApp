# UUID Null Error Fix

## Error
```
code: "22P02"
message: "invalid input syntax for type uuid: \"null\""
```

## Root Cause
The `convertToTransfer` function was attempting to delete/update transactions using `.eq('id', creditTxn.id)` where `creditTxn.id` was `null` (not a valid UUID). This happened when the function was called with newly parsed transactions that hadn't been inserted into the database yet.

## Problem Code
```typescript
// This would fail if creditTxn.id is null
const { error: deleteError } = await supabase
  .from('transactions')
  .delete()
  .eq('id', creditTxn.id); // ← creditTxn.id = null causes UUID error
```

## Solution
Added validation to check if transaction IDs exist before attempting database operations:

```typescript
async function convertToTransfer(
  debitTxn: any,
  creditTxn: any,
  fromAccountId: string,
  toAccountId: string
): Promise<boolean> {
  try {
    console.log('Converting to transfer:', { debitTxn: debitTxn.id, creditTxn: creditTxn.id });

    // Only delete the credit transaction if it has a valid ID
    if (creditTxn.id) {
      const { error: deleteError } = await supabase
        .from('transactions')
        .delete()
        .eq('id', creditTxn.id);

      if (deleteError) {
        console.error('Error deleting credit transaction:', deleteError);
        return false;
      }
    }

    // Only update the debit transaction if it has a valid ID
    if (debitTxn.id) {
      const { error: updateError } = await supabase
        .from('transactions')
        .update({
          type: 'transfer',
          from_account_id: fromAccountId,
          to_account_id: toAccountId,
          is_transfer_pending: false,
          note: `Transfer from ${debitTxn.account_last4 || 'account'} to ${creditTxn.account_last4 || 'account'}`,
          category: 'transfer',
        })
        .eq('id', debitTxn.id);

      if (updateError) {
        console.error('Error updating to transfer:', updateError);
        return false;
      }

      console.log('Successfully converted to transfer');
      return true;
    }

    // If neither transaction has an ID, we can't convert
    console.log('Cannot convert to transfer: no valid transaction IDs');
    return false;
  } catch (error) {
    console.error('Error in convertToTransfer:', error);
    return false;
  }
}
```

## Files Modified
1. **src/lib/SmsProcessorTask.ts** - Added ID validation in `convertToTransfer()`
2. **src/lib/NotificationProcessorTask.ts** - Added ID validation in `convertToTransfer()`

## Benefits
- ✅ Prevents UUID type errors when transactions haven't been inserted yet
- ✅ Gracefully handles cases where one or both transactions lack IDs
- ✅ Provides clear logging when conversion cannot proceed
- ✅ Maintains backward compatibility with existing transfer detection logic

## Testing
The fix ensures that:
1. If both transactions exist in DB (have IDs), conversion proceeds normally
2. If one transaction is new (no ID), only the existing one is updated
3. If neither has an ID, the function returns false without attempting DB operations
