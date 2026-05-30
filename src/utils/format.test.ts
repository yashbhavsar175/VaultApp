import { formatCurrencyDisplay } from './format';

describe('formatCurrencyDisplay', () => {
  it('keeps decimal balance amounts when paise are present', () => {
    expect(formatCurrencyDisplay(39933.08)).toBe('₹39,933.08');
  });

  it('keeps whole rupee balances compact', () => {
    expect(formatCurrencyDisplay(14808)).toBe('₹14,808');
  });

  it('formats negative amounts with the shared currency sign convention', () => {
    expect(formatCurrencyDisplay(-14808)).toBe('-₹14,808');
  });

  it('formats credit card amounts with the same rule', () => {
    expect(formatCurrencyDisplay(76234.5)).toBe('₹76,234.5');
  });
});
