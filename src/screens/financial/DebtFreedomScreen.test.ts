import { DebtItem } from '../../lib/services/debtFreedom';
import { looksUnsafeLabel, safeDebtLabel } from './DebtFreedomScreen';

function debt(overrides: Partial<DebtItem>): DebtItem {
  return {
    id: 'debt_test',
    sourceType: 'credit_card',
    label: 'Credit Card',
    outstanding: 1000,
    confidence: 'exact',
    metadata: { last4: '1234' },
    ...overrides,
  };
}

describe('DebtFreedomScreen privacy helpers', () => {
  it('keeps decorative email wrappers from hiding otherwise safe names', () => {
    expect(looksUnsafeLabel('John Doe <john@bank.com>')).toBe(false);
    expect(safeDebtLabel(debt({ label: 'John Doe <john@bank.com>' }))).toBe('John Doe ending 1234');
  });

  it('redacts long card/account numbers and falls back to generic source labels', () => {
    expect(looksUnsafeLabel('Card 4111 1111 1111 1234')).toBe(true);
    expect(safeDebtLabel(debt({ label: 'Card 4111 1111 1111 1234' }))).toBe('Credit card ending 1234');
  });

  it('detects IFSC and masked account labels as unsafe', () => {
    expect(looksUnsafeLabel('Loan HDFC0001234')).toBe(true);
    expect(looksUnsafeLabel('Loan account XX1234')).toBe(true);
  });

  it('allowlists common bank/product names without digits', () => {
    expect(looksUnsafeLabel('HDFC Bank')).toBe(false);
    expect(safeDebtLabel(debt({ label: 'HDFC Bank' }))).toBe('HDFC Bank ending 1234');
  });
});
