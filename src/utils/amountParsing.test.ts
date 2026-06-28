import {
  parseTransactionAmount,
  stripBalanceAndLimitSpans,
  hasParsableAmount,
  APPROX_INR_RATES,
} from './amountParsing';

describe('parseTransactionAmount', () => {
  it('never treats an available-credit-limit figure as the spend amount', () => {
    // Real SuperCard SMS that previously stored the credit limit (4,514.76) as the spend.
    const result = parseTransactionAmount(
      'USD 23.60 was spent on your SuperCard at ANTHROPIC* CLAUDE SUB. Available credit limit: INR 4,514.76'
    );
    expect(result).not.toBeNull();
    expect(result?.amountInr).not.toBeCloseTo(4514.76);
    expect(result?.currency).toBe('USD');
    expect(result?.isForeign).toBe(true);
    expect(result?.originalAmount).toBe(23.6);
    expect(result?.amountInr).toBeCloseTo(23.6 * APPROX_INR_RATES.USD);
  });

  it('handles the $1.00 verification charge the same way', () => {
    const result = parseTransactionAmount(
      'USD 1.00 was spent on your SuperCard at ANTHROPIC. Available credit limit: INR 6,742.60'
    );
    expect(result?.isForeign).toBe(true);
    expect(result?.originalAmount).toBe(1);
    expect(result?.amountInr).toBeCloseTo(APPROX_INR_RATES.USD);
  });

  it('reads a normal INR spend and ignores the trailing available balance', () => {
    const result = parseTransactionAmount(
      'Rs.450.00 debited from A/C XX0719. Avl Bal: INR 12,300.55'
    );
    expect(result).toEqual({
      amountInr: 450,
      currency: 'INR',
      isForeign: false,
      originalAmount: 450,
    });
  });

  it('does not pick a credit-limit number when no real amount is present', () => {
    // Balance/limit-only alert — there is no transaction amount to extract.
    expect(parseTransactionAmount('Available credit limit: INR 6,742.60')).toBeNull();
    expect(parseTransactionAmount('Your avl bal is Rs 5,000.00')).toBeNull();
  });

  it('supports $, € and £ symbols', () => {
    expect(parseTransactionAmount('Spent $19.99 at STORE')?.currency).toBe('USD');
    expect(parseTransactionAmount('Spent €19.99 at STORE')?.currency).toBe('EUR');
    expect(parseTransactionAmount('Spent £19.99 at STORE')?.currency).toBe('GBP');
  });

  it('keeps an INR amount that appears before a limit phrase', () => {
    const result = parseTransactionAmount('Spent Rs 500 of your credit limit Rs 10000');
    expect(result?.amountInr).toBe(500);
    expect(result?.isForeign).toBe(false);
  });
});

describe('stripBalanceAndLimitSpans', () => {
  it('removes limit/balance spans but keeps the spend clause', () => {
    const stripped = stripBalanceAndLimitSpans(
      'USD 23.60 was spent at ANTHROPIC. Available credit limit: INR 4,514.76'
    );
    expect(stripped).toContain('USD 23.60 was spent');
    expect(stripped).not.toContain('4,514.76');
  });
});

describe('hasParsableAmount', () => {
  it('recognises foreign-currency spends as having an amount', () => {
    expect(hasParsableAmount('USD 23.60 was spent at ANTHROPIC')).toBe(true);
  });

  it('returns false for a balance-only alert', () => {
    expect(hasParsableAmount('Available credit limit: INR 4,514.76')).toBe(false);
  });
});
