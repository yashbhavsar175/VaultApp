import { parseNaturalLanguageTxn } from './nlpParser';

describe('parseNaturalLanguageTxn personal movement safety', () => {
  it.each([
    'brother gave me 11000',
    'sent 11000 to friend',
    'cash deposit 11000',
    'bank deposit 11000',
    'cash withdrawal 500',
    'self transfer 11000 own account',
    'reimbursement 11000 received',
    'loan repayment 11000',
  ])('keeps "%s" neutral instead of income or expense', input => {
    expect(parseNaturalLanguageTxn(input).type).toBe('transfer');
  });

  it('keeps borrowed and lent wording in their existing ledger types', () => {
    expect(parseNaturalLanguageTxn('borrowed 11000 from brother').type).toBe('borrowed');
    expect(parseNaturalLanguageTxn('lent 11000 to friend').type).toBe('lent');
  });

  it('keeps merchant expense and salary income behavior', () => {
    expect(parseNaturalLanguageTxn('500 grocery paid').type).toBe('expense');
    expect(parseNaturalLanguageTxn('salary 30000 received').type).toBe('income');
  });

  it('keeps refunds out of normal income totals', () => {
    expect(parseNaturalLanguageTxn('refund 500 received').type).toBe('refund');
  });
});
