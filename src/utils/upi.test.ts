import { formatUpiIdsForDisplay, maskUpiId } from './upi';

describe('UPI display masking', () => {
  it('masks UPI IDs without exposing the full local part', () => {
    expect(maskUpiId('yashpatel@oksbi')).toBe('yash***@oksbi');
  });

  it('does not fully display phone-like UPI local parts', () => {
    expect(maskUpiId('9876543210@ybl')).toBe('****@ybl');
  });

  it('summarizes multiple UPI IDs safely', () => {
    expect(formatUpiIdsForDisplay(['yashpatel@oksbi', 'home@paytm'])).toBe('2 UPI IDs');
  });

  it('does not include the full UPI ID in rendered display text', () => {
    const rawUpiId = 'customer.name@okhdfcbank';
    const displayText = formatUpiIdsForDisplay([rawUpiId]);

    expect(displayText).toBe('cust***@okhdfcbank');
    expect(displayText).not.toContain(rawUpiId);
  });
});
