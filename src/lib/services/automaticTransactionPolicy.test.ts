import { getAutomaticTransactionPolicy } from './automaticTransactionPolicy';

describe('automatic transaction posting policy', () => {
  it.each([
    ['cash deposit credit', 'Rs.11000 cash deposited into your bank account', 'cash_deposit'],
    ['bank deposit credit', 'Rs.11000 bank deposit credited to your account', 'cash_deposit'],
    ['family credit', 'Rs.11000 received from brother via UPI', 'personal_transfer'],
    ['generic UPI credit', 'Rs.11000 credited via UPI', 'unverified_credit'],
    ['refund credit', 'Refund of Rs.11000 credited to your account', 'refund_or_reimbursement'],
    ['borrowed credit', 'Rs.11000 borrowed from friend credited to your account', 'personal_transfer'],
    ['credit card payment received', 'Payment of Rs.589 received towards your credit card ending with 2246', 'credit_card_bill_payment'],
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
    ['credit-card VPA', 'Rs.589 debited from account ending 0719 towards VPA gpay-creditcard@okpayaxis. UPI transaction reference no. 124115794477', 'credit_card_bill_payment'],
    ['loan repayment', 'Rs.11000 loan repayment debited', 'debt_repayment'],
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

  it('routes person-like debits to review while preserving generic debit fallback', () => {
    expect(getAutomaticTransactionPolicy('debit', 'Sent Rs.20 from HDFC Bank A/C **0719 to BHAVSAR YASH Ref 615411041468')).toEqual({
      action: 'review',
      reasonCode: 'personal_transfer',
    });
    expect(getAutomaticTransactionPolicy('debit', 'Rs.11000 debited via UPI to a person')).toEqual({
      action: 'post',
      type: 'expense',
    });
  });

  it('still allows clear merchant debits to auto-post as expenses', () => {
    expect(getAutomaticTransactionPolicy('debit', 'Rs.20 debited from HDFC Bank A/C **0719 at grocery store Ref 615411041468')).toEqual({
      action: 'post',
      type: 'expense',
    });
  });
});
