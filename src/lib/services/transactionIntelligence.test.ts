import { processSignal, RawTransactionSignal } from './transactionIntelligence';

describe('Transaction Intelligence Core', () => {
  it('classifies SuperCard spend correctly', () => {
    const signal: RawTransactionSignal = {
      rawText: "Dear Bhavsar, your SuperCard 6055 debited for INR 650.18 on 25 May 10:48 AM for UPI - 614584904031. To dispute call 18003097986 - Utkarsh SFBL",
      senderOrPackage: "UTKSPR",
      sourceType: "sms",
      timestamp: Date.now()
    };
    
    const result = processSignal(signal);
    expect(result.autoClass).toBe('credit_card_spend');
    expect(result.direction).toBe('debit');
    expect(result.amount).toBe(650.18);
    expect(result.last4).toBe('6055');
    expect(result.reference).toBe('614584904031');
    expect(result.confidenceLevel).toBe('high');
    expect(result.decision).toBe('auto_add_candidate');
  });

  it('classifies super.money received correctly', () => {
    const signal: RawTransactionSignal = {
      rawText: "₹40.00 received from SANDHU AMRITPAL. Deposited into your slice bank on 23 May at 03:03 PM. Tap to view details",
      senderOrPackage: "money.super.payments",
      sourceType: "notification",
      timestamp: Date.now()
    };
    
    const result = processSignal(signal);
    expect(['upi_received', 'bank_credit']).toContain(result.autoClass);
    expect(result.direction).toBe('credit');
    expect(result.amount).toBe(40);
    expect(result.merchantOrPerson).toBe('SANDHU AMRITPAL');
    expect(result.confidenceLevel).toBe('high');
    expect(result.decision).toBe('review_required');
  });

  it('classifies credit card bill payment correctly', () => {
    const signal: RawTransactionSignal = {
      rawText: "Payment of Rs.5000 received towards your HDFC Credit Card ending 1234",
      senderOrPackage: "HDFCBK",
      sourceType: "sms",
      timestamp: Date.now()
    };
    
    const result = processSignal(signal);
    expect(result.autoClass).toBe('credit_card_bill_payment');
    expect(result.direction).toBe('neutral');
    expect(result.amount).toBe(5000);
    expect(result.last4).toBe('1234');
    expect(result.decision).toBe('review_required');
  });

  it('classifies loan EMI correctly', () => {
    const signal: RawTransactionSignal = {
      rawText: "EMI of Rs.2500 debited for your loan account XX9999",
      senderOrPackage: "HDFCBK",
      sourceType: "sms",
      timestamp: Date.now()
    };
    
    const result = processSignal(signal);
    expect(result.autoClass).toBe('loan_emi_payment');
    expect(result.direction).toBe('debit');
    expect(result.amount).toBe(2500);
    expect(result.last4).toBe('9999');
    expect(result.decision).toBe('review_required');
  });

  it('classifies loan disbursal correctly', () => {
    const signal: RawTransactionSignal = {
      rawText: "Loan amount Rs.50000 credited to your account",
      senderOrPackage: "SBIINB",
      sourceType: "sms",
      timestamp: Date.now()
    };
    
    const result = processSignal(signal);
    expect(result.autoClass).toBe('loan_disbursal');
    expect(result.direction).toBe('credit');
    expect(result.amount).toBe(50000);
    expect(result.decision).toBe('review_required');
  });

  it('classifies refund correctly', () => {
    const signal: RawTransactionSignal = {
      rawText: "Refund of Rs.299 credited to your account",
      senderOrPackage: "AMAZONP",
      sourceType: "notification",
      timestamp: Date.now()
    };
    
    const result = processSignal(signal);
    expect(result.autoClass).toBe('refund');
    expect(result.direction).toBe('credit');
    expect(result.amount).toBe(299);
    expect(result.decision).toBe('review_required');
  });

  it('classifies self transfer correctly', () => {
    const signal: RawTransactionSignal = {
      rawText: "Rs.1000 transferred from your HDFC account to your SBI account",
      senderOrPackage: "HDFCBK",
      sourceType: "sms",
      timestamp: Date.now()
    };
    
    const result = processSignal(signal);
    expect(result.autoClass).toBe('self_transfer');
    expect(result.direction).toBe('neutral');
    expect(result.amount).toBe(1000);
    expect(result.confidenceLevel).toBe('medium');
    expect(result.decision).toBe('review_required');
  });

  it.each([
    ['Rs.11000 cash deposited into your bank account', 'cash_deposit', 'credit'],
    ['Rs.11000 withdrawn from ATM', 'cash_withdrawal', 'debit'],
    ['Rs.11000 received from brother via UPI', 'personal_transfer', 'credit'],
    ['Rs.11000 loan repayment debited', 'debt_repayment', 'debit'],
    ['Rs.11000 reimbursement credited', 'reimbursement', 'credit'],
  ] as const)('keeps personal movement candidate "%s" in review', (rawText, autoClass, direction) => {
    const result = processSignal({
      rawText,
      senderOrPackage: 'HDFCBK',
      sourceType: 'sms',
      timestamp: Date.now(),
    });

    expect(result.autoClass).toBe(autoClass);
    expect(result.direction).toBe(direction);
    expect(result.decision).toBe('review_required');
  });

  it('ignores OTPs and non-transactions', () => {
    const signals: RawTransactionSignal[] = [
      { rawText: "OTP is 123456", senderOrPackage: "HDFCBK", sourceType: "sms", timestamp: Date.now() },
      { rawText: "Get cashback offer up to Rs.500", senderOrPackage: "PAYTMB", sourceType: "sms", timestamp: Date.now() }
    ];

    signals.forEach(signal => {
      const result = processSignal(signal);
      expect(result.autoClass).toBe('non_transaction');
      expect(result.decision).toBe('ignore');
      expect(result.confidenceLevel).toBe('low');
    });
  });

  it('redacts sensitive information in preview', () => {
    const signal: RawTransactionSignal = {
      rawText: "Dear user, Rs.100 debited from A/C 9999. Do not share OTP 123456.",
      senderOrPackage: "HDFCBK",
      sourceType: "sms",
      timestamp: Date.now()
    };
    const result = processSignal(signal);
    expect(result.redactedPreview.amount).toBe(100);
    expect(result.redactedPreview.maskedLast4).toBe('XX9999');
    expect(result.redactedPreview.hashSummary).toContain('len=');
  });

  it('creates duplicate fingerprints without raw text', () => {
    const signal: RawTransactionSignal = {
      rawText: "Rs 500 debited. Ref: 123456789012",
      senderOrPackage: "HDFCBK",
      sourceType: "sms",
      timestamp: Date.now()
    };
    const result = processSignal(signal);
    const refFingerprint = result.duplicateFingerprints.find(f => f.strategy === 'reference');
    expect(refFingerprint?.value).toBe('123456789012');
  });

  it('dispute phone number is not extracted as reference', () => {
    const signal: RawTransactionSignal = {
      rawText: "Rs.50 debited. Ref 18003097986",
      senderOrPackage: "HDFCBK",
      sourceType: "sms",
      timestamp: Date.now()
    };
    const result = processSignal(signal);
    expect(result.reference).toBeNull();
  });

  it('identifies SuperCard from body even if sender is unknown', () => {
    const signal: RawTransactionSignal = {
      rawText: "Your SuperCard 1234 debited for INR 500 on 25 May. Ref 987654321012",
      senderOrPackage: "VM-INFO",
      sourceType: "sms",
      timestamp: Date.now()
    };
    const result = processSignal(signal);
    expect(result.confidenceLevel).toBe('high');
    expect(result.autoClass).toBe('credit_card_spend');
    expect(result.decision).toBe('auto_add_candidate');
  });
});
