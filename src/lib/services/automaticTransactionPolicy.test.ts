import { getAutomaticTransactionPolicy } from './automaticTransactionPolicy';

describe('automatic transaction policy', () => {
  it('posts clear earned income credits', () => {
    expect(getAutomaticTransactionPolicy(
      'credit',
      'Salary credited Rs.50000 to your account'
    )).toEqual({ action: 'post', type: 'income' });
  });

  it('posts clear merchant debits as expenses', () => {
    expect(getAutomaticTransactionPolicy(
      'debit',
      'Rs.450 paid to Amazon for shopping via UPI'
    )).toEqual({ action: 'post', type: 'expense' });
  });

  it('auto-posts personal credits as income now', () => {
    expect(getAutomaticTransactionPolicy(
      'credit',
      'Rs.11000 received from brother via UPI'
    )).toEqual({ action: 'post', type: 'income' });
  });

  it('auto-posts self transfers as transfers now', () => {
    expect(getAutomaticTransactionPolicy(
      'debit',
      'Rs.5000 self transfer to own account'
    )).toEqual({ action: 'post', type: 'transfer' });
  });

  it('auto-posts unverified credits as income now', () => {
    expect(getAutomaticTransactionPolicy(
      'credit',
      'Rs.2500 credited to your account via UPI'
    )).toEqual({ action: 'post', type: 'income' });
  });
});
