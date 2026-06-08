import { parseNaturalLanguageTxn } from './nlpParser';

describe('parseNaturalLanguageTxn personal movement safety', () => {
  it.each([
    'cash deposit 11000',
    'bank deposit 11000',
    'cash withdrawal 500',
    'self transfer 11000 own account',
    'reimbursement 11000 received',
    'loan repayment 11000',
  ])('keeps "%s" neutral instead of income or expense', input => {
    expect(parseNaturalLanguageTxn(input).type).toBe('transfer');
  });

  it('treats outgoing person payments as expenses with a useful category', () => {
    expect(parseNaturalLanguageTxn('I give 500 to my mom')).toMatchObject({
      amount: 500,
      type: 'expense',
      category: 'Family',
      note: 'I Give To My Mom',
    });
    expect(parseNaturalLanguageTxn('sent 11000 to friend')).toMatchObject({
      type: 'expense',
      category: 'Personal',
    });
  });

  it('treats incoming person payments as money coming in', () => {
    expect(parseNaturalLanguageTxn('brother gave me 11000')).toMatchObject({
      type: 'income',
      category: 'Family',
    });
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
