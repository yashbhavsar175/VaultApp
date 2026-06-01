import { getAutomaticTransactionPolicy } from './automaticTransactionPolicy';

describe('automatic transaction posting policy', () => {
  it.each([
    ['cash deposit credit', 'Rs.11000 cash deposited into your bank account', 'cash_deposit'],
    ['bank deposit credit', 'Rs.11000 bank deposit credited to your account', 'cash_deposit'],
    ['family credit', 'Rs.11000 received from brother via UPI', 'personal_transfer'],
    ['generic UPI credit', 'Rs.11000 credited via UPI', 'unverified_credit'],
    ['refund credit', 'Refund of Rs.11000 credited to your account', 'refund_or_reimbursement'],
    ['borrowed credit', 'Rs.11000 borrowed from friend credited to your account', 'personal_transfer'],
  ] as const)('routes %s to review instead of income', (_label, text, reasonCode) => {
    expect(getAutomaticTransactionPolicy('credit', text)).toEqual({
      action: 'review',
      reasonCode,
    });
  });

  it.each([
    ['family debit', 'Rs.11000 sent to brother via UPI', 'personal_transfer'],
    ['cash withdrawal', 'Rs.11000 withdrawn from ATM', 'cash_withdrawal'],
    ['self transfer', 'Rs.11000 transferred between your own accounts', 'self_transfer'],
    ['credit card bill', 'Rs.11000 credit card bill payment completed', 'credit_card_bill_payment'],
    ['loan repayment', 'Rs.11000 loan repayment debited', 'debt_repayment'],
    ['generic UPI debit', 'Rs.11000 debited via UPI to a person', 'unverified_debit'],
  ] as const)('routes %s to review instead of expense', (_label, text, reasonCode) => {
    expect(getAutomaticTransactionPolicy('debit', text)).toEqual({
      action: 'review',
      reasonCode,
    });
  });

  it('allows salary and gig payout credits with earned-income proof', () => {
    expect(getAutomaticTransactionPolicy('credit', 'Salary of Rs.30000 credited')).toEqual({
      action: 'post',
      type: 'income',
    });
    expect(getAutomaticTransactionPolicy('credit', 'Porter payout of Rs.8000 credited')).toEqual({
      action: 'post',
      type: 'income',
    });
  });

  it('allows merchant purchase debits with merchant proof', () => {
    expect(getAutomaticTransactionPolicy('debit', 'Rs.500 debited for a merchant purchase at grocery store')).toEqual({
      action: 'post',
      type: 'expense',
    });
  });
});
