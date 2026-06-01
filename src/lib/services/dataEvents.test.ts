import {
  emitFinanceDataChanged,
  financeDataChangedAffects,
  subscribeFinanceDataChanged,
} from './dataEvents';

describe('finance data events', () => {
  it('emits only structural privacy-safe fields and supports unsubscribe', () => {
    const listener = jest.fn();
    const unsubscribe = subscribeFinanceDataChanged(listener);

    emitFinanceDataChanged({
      areas: ['balances', 'review'],
      source: 'sms:balance_signal',
      transactionId: 'tx_1',
      rawSms: 'OTP 123456 from private@upi',
      profile: { phone: '9876543210' },
    } as any);

    expect(listener).toHaveBeenCalledWith({
      areas: ['balances', 'review'],
      source: 'sms:balance_signal',
      transactionId: 'tx_1',
      at: expect.any(Number),
    });
    expect(JSON.stringify(listener.mock.calls)).not.toContain('123456');
    expect(JSON.stringify(listener.mock.calls)).not.toContain('private@upi');
    expect(JSON.stringify(listener.mock.calls)).not.toContain('9876543210');

    unsubscribe();
    emitFinanceDataChanged({ areas: ['balances'], source: 'sms:balance_signal' });
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('drops unknown areas and non-structural source labels', () => {
    const listener = jest.fn();
    const unsubscribe = subscribeFinanceDataChanged(listener);

    emitFinanceDataChanged({
      areas: ['balances', 'private_payload'],
      source: 'raw private text',
      transactionId: 'OTP 123456 private payload',
    } as any);

    expect(listener).toHaveBeenCalledWith({
      areas: ['balances'],
      at: expect.any(Number),
    });
    expect(financeDataChangedAffects(listener.mock.calls[0][0], ['balances'])).toBe(true);
    unsubscribe();
  });
});
