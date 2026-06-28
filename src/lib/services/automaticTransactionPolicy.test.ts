import { getAutomaticTransactionPolicy } from './automaticTransactionPolicy';

describe('automatic transaction policy', () => {
  it('posts clear earned income credits', () => {
    expect(getAutomaticTransactionPolicy(
      'credit',
      'Salary credited Rs.50000 to your account'
    )).toEqual(expect.objectContaining({
      action: 'post',
      type: 'income',
      accountMatchStatus: 'manual_confirmed',
      accountMatchReason: 'auto_confirmed_income',
    }));
  });

  it('does not count merchant debits as expense until the user confirms', () => {
    // Expenses are held in review by default — most debits are not the user's own spend.
    expect(getAutomaticTransactionPolicy(
      'debit',
      'Rs.450 paid to Amazon for shopping via UPI'
    )).toEqual(expect.objectContaining({
      action: 'post',
      type: 'expense',
      accountMatchStatus: 'review_required',
      accountMatchReason: 'unverified_debit',
    }));
  });

  it('saves personal credits without counting them as income by default', () => {
    expect(getAutomaticTransactionPolicy(
      'credit',
      'Rs.11000 received from brother via UPI'
    )).toEqual(expect.objectContaining({
      action: 'post',
      type: 'income',
      accountMatchStatus: 'review_required',
      accountMatchReason: 'personal_transfer',
    }));
  });

  it('auto-posts self transfers as transfers now', () => {
    expect(getAutomaticTransactionPolicy(
      'debit',
      'Rs.5000 self transfer to own account'
    )).toEqual(expect.objectContaining({
      action: 'post',
      type: 'transfer',
      accountMatchStatus: 'ignored',
      accountMatchReason: 'self_transfer',
    }));
  });

  it('saves credit card bill payments as neutral card-payment movements', () => {
    expect(getAutomaticTransactionPolicy(
      'debit',
      'Rs.5000 credit card bill payment received for card ending 2246'
    )).toEqual(expect.objectContaining({
      action: 'post',
      type: 'transfer',
      accountMatchStatus: 'ignored',
      accountMatchReason: 'credit_card_bill_payment',
    }));
  });

  it('counts generic credits as income by default', () => {
    // Income is counted by default — most incoming money is the user's earning.
    expect(getAutomaticTransactionPolicy(
      'credit',
      'Rs.2500 credited to your account via UPI'
    )).toEqual(expect.objectContaining({
      action: 'post',
      type: 'income',
      accountMatchStatus: 'manual_confirmed',
      accountMatchReason: 'auto_confirmed_income',
    }));
  });

  it('saves generic debits without counting them as expense by default', () => {
    expect(getAutomaticTransactionPolicy(
      'debit',
      'Rs.20 debited from A/C XX0719 Ref 123456'
    )).toEqual(expect.objectContaining({
      action: 'post',
      type: 'expense',
      accountMatchStatus: 'review_required',
      accountMatchReason: 'unverified_debit',
    }));
  });
});
