import {
  getTransactionAmountPrefix,
  getTransactionColor,
  getTransactionIcon,
  getTransactionTypeLabel,
} from './transactionHelpers';
import {
  getCategoryIcon,
  getTransactionSourceLabel,
  inferTransactionCategory,
} from './transactionPresentation';

describe('refund transaction presentation', () => {
  it('uses a distinct refund icon, color, label, and positive offset prefix', () => {
    expect(getTransactionIcon('refund')).toBe('cash-refund');
    expect(getTransactionColor('refund')).toBe('#14b8a6');
    expect(getTransactionAmountPrefix('refund')).toBe('+');
    expect(getTransactionTypeLabel('refund')).toBe('Refund');
  });

  it('keeps existing signs for income, expense, and transfer', () => {
    expect(getTransactionAmountPrefix('income')).toBe('+');
    expect(getTransactionAmountPrefix('expense')).toBe('-');
    expect(getTransactionAmountPrefix('transfer')).toBe('\u2194');
  });

  it('categorizes refund rows separately from income and expense', () => {
    expect(inferTransactionCategory({
      type: 'refund',
      note: 'Amazon refund',
      category: 'Refund',
    })).toBe('Refunds');
    expect(getCategoryIcon('Refunds')).toBe('cash-refund');
  });
});

describe('analytics source label privacy', () => {
  it('renders a masked UPI ID for Largest Entries labels', () => {
    const rawUpiId = 'customer.name@okhdfcbank';
    const label = getTransactionSourceLabel({
      upi_id: rawUpiId,
      sms_source: 'upi',
    });

    expect(label).toContain('cust***@okhdfcbank');
    expect(label).not.toContain(rawUpiId);
  });

  it('does not render a full phone-like UPI ID for Largest Entries labels', () => {
    const rawUpiId = '9876543210@ybl';
    const label = getTransactionSourceLabel({
      upi_id: rawUpiId,
      sms_sender: 'PhonePe',
    });

    expect(label).toContain('****@ybl');
    expect(label).not.toContain(rawUpiId);
  });
});
