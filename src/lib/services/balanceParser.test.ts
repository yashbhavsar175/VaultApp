import { parseBalanceSignal } from './balanceParser';

const JUNE_2026 = new Date('2026-06-01T10:00:00Z').getTime();

function parse(text: string, senderOrPackage = 'HDFCBK') {
  return parseBalanceSignal({
    text,
    senderOrPackage,
    sourceType: 'sms',
    timestamp: JUNE_2026,
  });
}

function amountFor(result: ReturnType<typeof parseBalanceSignal>, kind: string): number | undefined {
  return result.balances.find(item => item.balanceKind === kind)?.amount;
}

describe('balanceParser bank account balances', () => {
  it('parses HDFC debit messages with available balance and account last4', () => {
    const result = parse('HDFC Bank: Rs.100 debited from A/c XX1234. Avl Bal Rs.12,345.67. UPI Ref 313131313131', 'HDFCBK');

    expect(result.isBalanceSignal).toBe(true);
    expect(result.detectedBankCode).toBe('HDFC');
    expect(result.detectedBankName).toBe('HDFC Bank');
    expect(result.accountLast4).toBe('1234');
    expect(result.instrumentHint).toBe('bank_account');
    expect(amountFor(result, 'available_balance')).toBe(12345.67);
    expect(result.confidence).toBe('exact');
  });

  it('parses SBI credit messages with available balance', () => {
    const result = parse('SBI: INR 2,000 credited to account ending 9876. Available Balance INR 25,000.', 'SBIN');

    expect(result.detectedBankCode).toBe('SBI');
    expect(result.accountLast4).toBe('9876');
    expect(amountFor(result, 'available_balance')).toBe(25000);
  });

  it('parses ICICI account ending balance messages', () => {
    const result = parse('ICICI Bank account ending 4455 balance in your account is Rs.5000', 'ICICIB');

    expect(result.detectedBankCode).toBe('ICICI');
    expect(result.accountLast4).toBe('4455');
    expect(amountFor(result, 'current_balance')).toBe(5000);
  });

  it('parses Kotak current balance', () => {
    const result = parse('Kotak current account A/c no. *6677 Current Balance: Rs 1,234.00', 'KOTAK');

    expect(result.detectedBankCode).toBe('KOTAK');
    expect(result.accountTypeHint).toBe('current');
    expect(result.accountLast4).toBe('6677');
    expect(amountFor(result, 'current_balance')).toBe(1234);
  });

  it('parses Bank of Baroda available balance', () => {
    const result = parse('Bank of Baroda A/c XX9012 Avail Bal: Rs 1,234', 'BOB');

    expect(result.detectedBankCode).toBe('BOB');
    expect(result.accountLast4).toBe('9012');
    expect(amountFor(result, 'available_balance')).toBe(1234);
  });

  it('does not mark a plain debit transaction as a balance signal', () => {
    const result = parse('Paid Rs.100 to Swiggy from HDFC Bank UPI Ref 123456789012', 'HDFCBK');

    expect(result.isBalanceSignal).toBe(false);
    expect(result.balances).toEqual([]);
  });
});

describe('balanceParser debit card hints', () => {
  it('parses debit card ending last4 with available balance', () => {
    const result = parse('HDFC debit card ending 5678 used for POS Rs.600. A/c XX1234 Avl Bal Rs.9000', 'HDFCBK');

    expect(result.debitCardLast4).toBe('5678');
    expect(result.accountLast4).toBe('1234');
    expect(amountFor(result, 'available_balance')).toBe(9000);
  });

  it('parses debit card no ending last4', () => {
    const result = parse('Axis debit card no. ending 7788 used at ATM. Avl Bal INR 8000', 'AXISBK');

    expect(result.detectedBankCode).toBe('AXIS');
    expect(result.debitCardLast4).toBe('7788');
    expect(amountFor(result, 'available_balance')).toBe(8000);
  });

  it('parses POS card last4 without treating it as credit card', () => {
    const result = parse('ICICI POS spend of Rs.450 on card XX9900. Avl Bal Rs.15,000', 'ICICIB');

    expect(result.debitCardLast4).toBe('9900');
    expect(result.cardLast4).toBeNull();
    expect(result.instrumentHint).toBe('debit_card');
  });

  it('parses card XX5678 used at POS as debit-card context', () => {
    const result = parse('Federal Bank card XX5678 used at POS for Rs.700. Avl Bal Rs.4,500', 'FEDERAL');

    expect(result.detectedBankCode).toBe('FEDERAL');
    expect(result.debitCardLast4).toBe('5678');
    expect(result.cardLast4).toBeNull();
    expect(result.instrumentHint).toBe('debit_card');
    expect(amountFor(result, 'available_balance')).toBe(4500);
  });

  it('does not treat a debit card hint as a balance signal without balance data', () => {
    const result = parse('HDFC debit card ending 5678 used for POS Rs.600 at store', 'HDFCBK');

    expect(result.isBalanceSignal).toBe(false);
    expect(result.debitCardLast4).toBe('5678');
    expect(result.balances).toEqual([]);
  });
});

describe('balanceParser credit card balances and statements', () => {
  it('parses outstanding and available limit', () => {
    const result = parse('HDFC Credit Card XX4321 total outstanding Rs.12,000. Available limit Rs.88,000', 'HDFCBK');

    expect(result.instrumentHint).toBe('credit_card');
    expect(result.accountTypeHint).toBe('credit_card');
    expect(result.cardLast4).toBe('4321');
    expect(amountFor(result, 'outstanding')).toBe(12000);
    expect(amountFor(result, 'available_limit')).toBe(88000);
  });

  it('parses credit limit and available limit', () => {
    const result = parse('ICICI CC ending 1234 credit limit Rs.100000 available limit Rs.76543', 'ICICIB');

    expect(result.cardLast4).toBe('1234');
    expect(amountFor(result, 'credit_limit')).toBe(100000);
    expect(amountFor(result, 'available_limit')).toBe(76543);
  });

  it('parses total due, minimum due, and due date', () => {
    const result = parse('Axis credit card XX9876 total amount due Rs.12,345 minimum amount due Rs.600 payment due date 05 Jun 2026', 'AXISBK');

    expect(amountFor(result, 'due_amount')).toBe(12345);
    expect(amountFor(result, 'minimum_due')).toBe(600);
    expect(result.statement?.totalDue).toBe(12345);
    expect(result.statement?.minimumDue).toBe(600);
    expect(result.statement?.paymentDueDate).toBe('2026-06-05');
  });

  it('parses numeric due dates when year is present', () => {
    const result = parse('SBI Credit Card total amount due Rs.5000 min due Rs.500 due by 05-06-2026', 'SBICARD');

    expect(result.statement?.paymentDueDate).toBe('2026-06-05');
  });

  it('parses slash due dates with two-digit year', () => {
    const result = parse('Yes Bank credit card XX3344 total amount due Rs.5000 min due Rs.500 due by 05/06/26', 'YESBANK');

    expect(result.detectedBankCode).toBe('YESBANK');
    expect(result.statement?.paymentDueDate).toBe('2026-06-05');
  });

  it('parses statement generated amount', () => {
    const result = parse('Kotak credit card statement generated for Rs.7,777. Payment due date 5 June', 'KOTAK');

    expect(amountFor(result, 'due_amount')).toBe(7777);
    expect(result.statement?.statementBalance).toBe(7777);
    expect(result.statement?.paymentDueDate).toBe('2026-06-05');
  });

  it('recognizes card payment received without making bank income', () => {
    const result = parse('HDFC Credit Card XX1111 payment received Rs.5,000. Thank you.', 'HDFCBK');

    expect(result.isBalanceSignal).toBe(true);
    expect(result.instrumentHint).toBe('credit_card');
    expect(result.balances).toEqual([]);
    expect(result.reasons).toContain('card_payment_or_refund_detected');
  });

  it('parses HDFC card-payment wording with account last4, card last4, and available limit', () => {
    const text = 'Sent Rs.589.00 from HDFC Bank A/C *0719 to Google India Digital Serv Ref 124115794477. PAYMENT OF Rs.589.00 RECEIVED TOWARDS YOUR CREDIT CARD ENDING WITH 2246. Available limit is Rs.82999.86';
    const result = parse(text, 'AD-HDFCBK-S');

    expect(result.isBalanceSignal).toBe(true);
    expect(result.instrumentHint).toBe('credit_card');
    expect(result.accountLast4).toBe('0719');
    expect(result.cardLast4).toBe('2246');
    expect(amountFor(result, 'available_limit')).toBe(82999.86);
    expect(result.reasons).toContain('card_payment_or_refund_detected');
    expect(JSON.stringify(result)).not.toContain(text);
  });

  it('recognizes card refund/reversal without making bank income', () => {
    const result = parse('ICICI credit card 2222 refund reversal Rs.999 processed.', 'ICICIB');

    expect(result.isBalanceSignal).toBe(true);
    expect(result.instrumentHint).toBe('credit_card');
    expect(result.cardLast4).toBe('2222');
    expect(result.balances).toEqual([]);
  });
});

describe('balanceParser loan balances', () => {
  it('parses loan outstanding amount', () => {
    const result = parse('IDFC loan outstanding loan amount Rs.2,50,000 for loan account 4455', 'IDFC');

    expect(result.instrumentHint).toBe('loan');
    expect(result.accountTypeHint).toBe('loan');
    expect(amountFor(result, 'loan_outstanding')).toBe(250000);
  });

  it('parses EMI due amount with estimated confidence', () => {
    const result = parse('HDFC loan EMI due Rs.12,500 by 05 Jun 2026', 'HDFCBK');

    expect(result.instrumentHint).toBe('loan');
    expect(amountFor(result, 'due_amount')).toBe(12500);
    expect(result.balances.find(item => item.balanceKind === 'due_amount')?.confidence).toBe('estimated');
  });
});

describe('balanceParser privacy and ambiguity', () => {
  it('ignores OTP, phone, full account number, references, and raw text', () => {
    const text = 'HDFC A/c 123456789012 Avl Bal Rs.900 OTP 123456 Call 18002664332 UPI Ref 999988887777';
    const result = parse(text, 'HDFCBK');
    const serialized = JSON.stringify(result);

    expect(result.accountLast4).toBeNull();
    expect(result.redactedSource.len).toBe(text.length);
    expect(result.redactedSource.hash).toMatch(/^[a-f0-9]{8}$/);
    expect(serialized).not.toContain(text);
    expect(serialized).not.toContain('123456789012');
    expect(serialized).not.toContain('123456');
    expect(serialized).not.toContain('18002664332');
    expect(serialized).not.toContain('999988887777');
    expect(amountFor(result, 'available_balance')).toBe(900);
  });

  it('does not parse UPI references or dispute phones as balances', () => {
    const result = parse('UPI Ref 313131313131. For dispute call 18001234567. Paid Rs.100 to merchant.', 'GPAY');

    expect(result.isBalanceSignal).toBe(false);
    expect(result.balances).toEqual([]);
  });

  it('leaves ambiguous due dates null', () => {
    const result = parse('HDFC credit card XX1234 total amount due Rs.1000 due by 05/06', 'HDFCBK');

    expect(result.isBalanceSignal).toBe(true);
    expect(result.statement?.paymentDueDate).toBeNull();
    expect(result.reasons).toContain('date_ambiguous');
  });

  it('does not expose raw notification body in notification parse results', () => {
    const text = 'super.money card XX4444 outstanding Rs.321 available limit Rs.9999';
    const result = parseBalanceSignal({
      text,
      senderOrPackage: 'money.super.app',
      sourceType: 'notification',
      timestamp: JUNE_2026,
    });

    expect(result.sourceType).toBe('notification');
    expect(result.detectedBankCode).toBe('SUPERMONEY');
    expect(JSON.stringify(result)).not.toContain(text);
    expect(result.redactedSource).toEqual({
      len: text.length,
      hash: expect.stringMatching(/^[a-f0-9]{8}$/),
      senderOrPackage: 'money.super.app',
      sourceType: 'notification',
    });
  });

  it('sanitizes phone-like sender values from redacted source metadata', () => {
    const result = parseBalanceSignal({
      text: 'HDFC A/c XX1234 Avl Bal Rs.900',
      senderOrPackage: '+919876543210',
      sourceType: 'sms',
      timestamp: JUNE_2026,
    });

    expect(result.isBalanceSignal).toBe(true);
    expect(result.redactedSource.senderOrPackage).toBeNull();
    expect(JSON.stringify(result)).not.toContain('9876543210');
  });
});

describe('balanceParser bank aliases', () => {
  it.each([
    ['AU Bank A/c XX1111 Avl Bal Rs.100', 'AUBANK', 'AUBANK'],
    ['IndusInd account ending 2222 Available Balance INR 200', 'INDUSIND', 'INDUSIND'],
    ['Utkarsh SuperCard credit card XX3333 outstanding Rs.300', 'SUPERCRD', 'UTKARSH'],
    ['slice card XX4444 outstanding Rs.400', 'slice', 'SLICE'],
  ])('detects %s', (text, sender, expectedCode) => {
    const result = parse(text, sender);

    expect(result.detectedBankCode).toBe(expectedCode);
    expect(result.isBalanceSignal).toBe(true);
  });
});
