export type RawTransactionSignal = {
  rawText: string;
  senderOrPackage: string;
  sourceType: 'sms' | 'notification';
  timestamp: number;
};

export type AutoTransactionClass =
  | 'bank_debit'
  | 'bank_credit'
  | 'credit_card_spend'
  | 'credit_card_bill_payment'
  | 'loan_emi_payment'
  | 'loan_disbursal'
  | 'upi_payment'
  | 'upi_received'
  | 'refund'
  | 'cashback_reward'
  | 'cash_deposit'
  | 'cash_withdrawal'
  | 'personal_transfer'
  | 'reimbursement'
  | 'borrowed_money'
  | 'debt_repayment'
  | 'wallet_load'
  | 'self_transfer'
  | 'non_transaction'
  | 'unknown_financial';

export type Direction = 'debit' | 'credit' | 'neutral' | 'unknown';
export type ConfidenceLevel = 'high' | 'medium' | 'low';
export type Decision = 'auto_add_candidate' | 'review_required' | 'ignore';

export type DuplicateFingerprint = {
  strategy: 'reference' | 'minute_bucket' | 'hash';
  value: string;
};

export type RedactedPreview = {
  amount?: number;
  detectedSource: string;
  autoClass: AutoTransactionClass;
  maskedLast4?: string;
  hashSummary: string;
};

export type SmartCandidate = {
  signalId: string;
  sourceType?: RawTransactionSignal['sourceType'];
  evidenceId?: string | null;
  evidenceSignalId?: string | null;
  evidenceSignalIds?: string[];
  paymentAppAccountMatch?: {
    sourcePackage: string;
    sourceLabel: string;
    bankHint: string;
    bankHintLabel: string;
    mappingStatus: 'needs_review' | 'system_matched' | 'user_confirmed';
    mappedBankAccountId?: string;
    mappedBankAccountLast4?: string;
    mappedBankName?: string;
  } | null;
  autoClass: AutoTransactionClass;
  direction: Direction;
  amount: number | null;
  merchantOrPerson: string | null;
  last4: string | null;
  accountLast4?: string | null;
  cardLast4?: string | null;
  reference: string | null;
  instrumentHint: 'credit_card' | 'bank_account' | 'loan_account' | 'wallet' | 'unknown';
  confidenceScore: number;
  confidenceLevel: ConfidenceLevel;
  decision: Decision;
  duplicateFingerprints: DuplicateFingerprint[];
  redactedPreview: RedactedPreview;
};

const TRUSTED_SOURCES = [
  'UTKSPR', 'UTKSFB', 'UTKARSH', 'SFBL', 'SuperCard',
  'super.money', 'money.super.payments', 'slice bank', 'slice',
  'HDFC', 'SBI', 'ICICI', 'Axis', 'Kotak',
  'GPay', 'Google Pay', 'com.google.android.apps.nbu.paisa.user',
  'PhonePe', 'com.phonepe.app',
  'Paytm', 'net.one97.paytm',
  'CRED', 'com.dreamplug.androidapp',
  'OneCard'
];

function hashString(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return Math.abs(hash).toString(16);
}

function isTrustedSource(senderOrPackage: string): boolean {
  const lowerSrc = senderOrPackage.toLowerCase();
  return TRUSTED_SOURCES.some(ts => lowerSrc.includes(ts.toLowerCase()));
}

function extractAmount(text: string): number | null {
  const patterns = [
    /(?:inr|rs\.?|₹)\s*([0-9,]+(?:\.[0-9]{1,2})?)/i,
    /(?:amount|amt)[\s:]*(?:inr|rs\.?|₹)?\s*([0-9,]+(?:\.[0-9]{1,2})?)/i,
    /(?:debited|credited|paid|received)[\s:]*(?:inr|rs\.?|₹)?\s*([0-9,]+(?:\.[0-9]{1,2})?)/i,
  ];
  for (const p of patterns) {
    const m = text.match(p);
    if (m && m[1]) {
      return parseFloat(m[1].replace(/,/g, ''));
    }
  }
  return null;
}

function normalizeLast4(value?: string | null): string | null {
  const digits = value?.replace(/\D/g, '') || '';
  return digits.length >= 4 ? digits.slice(-4) : null;
}

function extractLast4WithPatterns(text: string, patterns: RegExp[]): string | null {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    const last4 = normalizeLast4(match?.[1]);
    if (last4) return last4;
  }
  return null;
}

function extractAccountLast4(text: string): string | null {
  return extractLast4WithPatterns(text, [
    /\ba\/?c(?:count)?(?:\s*(?:no\.?|number))?\s*(?:ending\s*(?:with\s*)?)?[-:xX* ]*(\d{4,5})\b/i,
    /\baccount\s+(?:ending|ended|no\.?|number|xx|x{2,})\s*(?:with\s*)?[-:xX* ]*(\d{4,5})\b/i,
  ]);
}

function extractCardLast4(text: string): string | null {
  return extractLast4WithPatterns(text, [
    /\b(?:credit\s*)?card\b[^.]{0,48}?\b(?:ending|ended)\s*(?:with\s*)?[-:xX* ]*(\d{4})\b/i,
    /\b(?:credit\s*)?card\s*(?:no\.?|number)?\s*(?:xx|x{2,}|[*]+)\s*(\d{4})\b/i,
    /\bcc\b[^.]{0,24}?\b(?:ending|ended|xx|x{2,}|[*]+)\s*(?:with\s*)?[-:xX* ]*(\d{4})\b/i,
  ]);
}

function extractLast4(text: string): string | null {
  const match = text.match(/(?:card|a\/c|account|ac|xx|xxxx|ending)\s*(?:with|no\.?|number)?\s*[-:xX*]*\s*(\d{3,5})\b/i) || 
                text.match(/[xX*]{4,}(\d{4})\b/);
  if (match && match[1]) return match[1];
  return null;
}

function extractReference(text: string): string | null {
  const match = text.match(/(?:UPI[\s-]*(?:Ref(?:erence)?|ID)|UTR|RRN|Ref(?:erence)?(?:\s*(?:no\.?|id))?|TXN ID|transaction\s+reference\s+no\.?)\s*[-:]?\s*([A-Za-z0-9]{8,20})\b/i) ||
    text.match(/\bUPI\s*[-:]\s*([0-9]{8,20})\b/i);
  if (match && match[1]) {
    const val = match[1];
    if (/^1800\d{6,8}$/.test(val) || /^\d{10,11}$/.test(val)) {
      return null;
    }
    return val;
  }
  return null;
}

function sanitizeMerchantOrPerson(value: string | null): string | null {
  if (!value) return null;
  if (/[A-Za-z0-9._-]+@[A-Za-z0-9.-]+/.test(value)) return null;
  if (/\b(?:otp|one\s*time\s*password|verification\s*code|security\s*code)\b/i.test(value)) return null;
  return value;
}

function extractMerchantOrPerson(text: string): string | null {
  const patterns = [
    /(?:received from|from)\s+([A-Za-z\s]+?)(?:\.|\s+deposited|\s+on|\s+in)/i,
    /(?:paid to|sent to)\s+([A-Za-z0-9\s&]+?)(?:\s+on|\s+via|\s+to|\.|$)/i,
    /(?:at|for)\s+([A-Za-z0-9\s&]+?)(?:\s+on|\s+using|\.|$)/i,
    /([A-Za-z0-9\s&]+?)\s+paid\s+(?:to\s+)?you/i
  ];
  for (const p of patterns) {
    const m = text.match(p);
    if (m && m[1]) {
      const res = m[1].trim();
      if (!/^upi$/i.test(res) && !/^your\s/i.test(res)) return res;
    }
  }
  return null;
}

function hasCreditCardBillPaymentProof(text: string): boolean {
  return /\bpayment\b.*\b(?:received|made|done|successful|completed)\b.*\b(?:credit\s*card|creditcard|card\s*bill)\b/i.test(text) ||
    /\b(?:credit\s*card|creditcard|card\s*bill|cc)\b.*\b(?:bill\s*)?payment\b/i.test(text) ||
    /\b(?:gpay|googlepay|paytm|phonepe|cred)?[-_.]?(?:creditcard|cardbill|cc)[-_.]?[A-Za-z0-9._-]*@[A-Za-z0-9.-]+/i.test(text);
}

function detectInstrument(text: string): SmartCandidate['instrumentHint'] {
  const lower = text.toLowerCase();
  if (/credit card|creditcard|supercard|sbi card|cardbill|gpay-creditcard/i.test(lower)) return 'credit_card';
  if (/loan/i.test(lower)) return 'loan_account';
  if (/wallet|amazon pay balance/i.test(lower)) return 'wallet';
  if (/a\/c|account|bank/i.test(lower)) return 'bank_account';
  return 'unknown';
}

function classify(text: string, amount: number | null, instrumentHint: SmartCandidate['instrumentHint']): { autoClass: AutoTransactionClass, direction: Direction } {
  const lower = text.toLowerCase();

  const isPromo = /offer|cashback up to|win up to|claim now|discount|save upto/i.test(lower);
  const isOTP = /\botp\b|verification code|security code/i.test(lower);
  
  if (/(?:up\s*to|upto)\s*(?:inr|rs\.?|₹)\s*[0-9,]+/i.test(lower)) return { autoClass: 'non_transaction', direction: 'unknown' };
  
  if (isOTP || isPromo || (/is due|due on|statement/i.test(lower) && !/paid|debited|received/i.test(lower))) {
    return { autoClass: 'non_transaction', direction: 'unknown' };
  }
  
  if (!amount) {
      return { autoClass: 'non_transaction', direction: 'unknown' };
  }

  if (/transferred.*from.*account.*to.*account/i.test(lower)) {
      return { autoClass: 'self_transfer', direction: 'neutral' };
  }

  if (/\b(?:cash|atm|bank)\s+deposit(?:ed)?\b|\bdeposit(?:ed)?\s+(?:cash|into (?:my|your) (?:bank )?account)\b/i.test(lower)) {
      return { autoClass: 'cash_deposit', direction: 'credit' };
  }

  if (/\bwithdraw(?:al|n)?\b|\bwithdrawn\b/i.test(lower)) {
      return { autoClass: 'cash_withdrawal', direction: 'debit' };
  }

  if (/\breimburse(?:ment|d)?\b/i.test(lower)) {
      return { autoClass: 'reimbursement', direction: /debited|paid|sent/i.test(lower) ? 'debit' : 'credit' };
  }

  if (/\b(?:borrowed|loan from (?:family|friend|brother|sister|person))\b/i.test(lower)) {
      return { autoClass: 'borrowed_money', direction: 'credit' };
  }

  if (/\b(?:loan|debt|borrowed money)\s+repay(?:ment|aid)?\b|\brepay(?:ment|aid)?\b.*\b(?:loan|debt|borrowed)\b/i.test(lower)) {
      return { autoClass: 'debt_repayment', direction: 'debit' };
  }

  if (/\b(?:family|friend|brother|sister|mom|mother|dad|father|papa|mummy|bhai|dost|yaar|personal)\b/i.test(lower)) {
      return { autoClass: 'personal_transfer', direction: /debited|paid|sent/i.test(lower) ? 'debit' : 'credit' };
  }

  if (hasCreditCardBillPaymentProof(text)) {
      return { autoClass: 'credit_card_bill_payment', direction: 'neutral' };
  }

  if (/emi.*debited|debited.*emi/i.test(lower)) {
      return { autoClass: 'loan_emi_payment', direction: 'debit' };
  }

  if (/loan.*credited|disbursed/i.test(lower)) {
      return { autoClass: 'loan_disbursal', direction: 'credit' };
  }

  if (/refund.*credited/i.test(lower)) {
      return { autoClass: 'refund', direction: 'credit' };
  }
  
  if (/cashback.*credited|received.*cashback/i.test(lower) && !isPromo) {
      return { autoClass: 'cashback_reward', direction: 'credit' };
  }

  if (instrumentHint === 'credit_card' && /debited|spent|paid/i.test(lower)) {
      return { autoClass: 'credit_card_spend', direction: 'debit' };
  }

  if (/upi/i.test(lower)) {
      if (/\bpaid\s+(?:to\s+)?you\b|you'?ve\s+got|received\s+from/i.test(lower)) {
          return { autoClass: 'upi_received', direction: 'credit' };
      }
      if (/received|credited/i.test(lower)) {
          return { autoClass: 'upi_received', direction: 'credit' };
      }
      if (/debited|spent|paid/i.test(lower)) {
          return { autoClass: 'upi_payment', direction: 'debit' };
      }
  }

  if (/credited|received|deposited|added/i.test(lower)) {
      return { autoClass: 'bank_credit', direction: 'credit' };
  }
  if (/debited|deducted|spent|withdrawn|paid/i.test(lower)) {
      return { autoClass: 'bank_debit', direction: 'debit' };
  }

  return { autoClass: 'unknown_financial', direction: 'unknown' };
}

function buildFingerprints(
  signal: RawTransactionSignal,
  amount: number | null,
  merchantOrPerson: string | null,
  reference: string | null
): DuplicateFingerprint[] {
  const prints: DuplicateFingerprint[] = [];
  
  if (reference) {
    prints.push({ strategy: 'reference', value: reference });
  }

  const date = new Date(signal.timestamp);
  const minuteBucket = `${date.getUTCFullYear()}-${date.getUTCMonth()}-${date.getUTCDate()}-${date.getUTCHours()}-${date.getUTCMinutes()}`;
  if (amount !== null) {
    const src = signal.senderOrPackage.substring(0, 10);
    const merch = (merchantOrPerson || 'unknown').substring(0, 10);
    prints.push({ strategy: 'minute_bucket', value: `${src}|${amount}|${merch}|${minuteBucket}`.toLowerCase() });
  }

  const stableText = signal.rawText.toLowerCase()
    .replace(/[0-9]{2}:[0-9]{2}/g, '<time>')
    .replace(/\s+/g, ' ')
    .trim();
  prints.push({ strategy: 'hash', value: hashString(stableText) });

  return prints;
}

function buildRedactedPreview(
  signal: RawTransactionSignal,
  amount: number | null,
  autoClass: AutoTransactionClass,
  last4: string | null
): RedactedPreview {
  return {
    amount: amount || undefined,
    detectedSource: signal.senderOrPackage,
    autoClass,
    maskedLast4: last4 ? `XX${last4}` : undefined,
    hashSummary: `len=${signal.rawText.length} hash=${hashString(signal.rawText)}`
  };
}

function scoreConfidence(
  autoClass: AutoTransactionClass,
  amount: number | null,
  reference: string | null,
  merchantOrPerson: string | null,
  trustedSource: boolean,
  hasAction: boolean
): { score: number, level: ConfidenceLevel } {
  let score = 0;

  if (autoClass === 'non_transaction') {
    return { score: 10, level: 'low' };
  }

  if (amount) score += 40;
  if (trustedSource) score += 20;
  if (hasAction) score += 20;
  if (reference) score += 10;
  if (merchantOrPerson) score += 10;

  let level: ConfidenceLevel = 'low';
  if (score >= 85) level = 'high';
  else if (score >= 60) level = 'medium';

  if (!amount || !hasAction) {
      level = 'low';
      score = Math.min(score, 59);
  }

  if (autoClass === 'unknown_financial' || autoClass === 'self_transfer') {
      if (level === 'high') {
          level = 'medium';
          score = Math.min(score, 84);
      }
  }

  return { score, level };
}

function decide(autoClass: AutoTransactionClass, level: ConfidenceLevel, trustedSource: boolean): Decision {
  if (autoClass === 'non_transaction') return 'ignore';
  if (autoClass === 'unknown_financial') {
    return level === 'low' ? 'ignore' : 'review_required';
  }

  if ([
    'bank_credit',
    'bank_debit',
    'borrowed_money',
    'cash_deposit',
    'cash_withdrawal',
    'credit_card_bill_payment',
    'debt_repayment',
    'loan_disbursal',
    'loan_emi_payment',
    'personal_transfer',
    'refund',
    'reimbursement',
    'self_transfer',
    'upi_payment',
    'upi_received',
    'wallet_load',
  ].includes(autoClass)) {
    return 'review_required';
  }
  
  if (level === 'high' && trustedSource) {
    return 'auto_add_candidate';
  } else if (level === 'medium' || (level === 'high' && !trustedSource)) {
    return 'review_required';
  }
  
  return 'ignore';
}

export function processSignal(signal: RawTransactionSignal): SmartCandidate {
  const trustedSource = isTrustedSource(signal.senderOrPackage) || 
                        /\b(supercard|super\.money)\b/i.test(signal.rawText);
  
  const amount = extractAmount(signal.rawText);
  const accountLast4 = extractAccountLast4(signal.rawText);
  const cardLast4 = extractCardLast4(signal.rawText);
  const fallbackLast4 = normalizeLast4(extractLast4(signal.rawText));
  const reference = extractReference(signal.rawText);
  const merchantOrPerson = sanitizeMerchantOrPerson(extractMerchantOrPerson(signal.rawText));
  const instrumentHint = detectInstrument(signal.rawText);

  const { autoClass, direction } = classify(signal.rawText, amount, instrumentHint);
  const last4 = (autoClass === 'credit_card_bill_payment' || instrumentHint === 'credit_card')
    ? cardLast4 || fallbackLast4
    : accountLast4 || cardLast4 || fallbackLast4;

  const hasAction = /debited|credited|paid|received|spent|deducted|withdrawn|transferred|deposited/i.test(signal.rawText);
  
  const { score, level } = scoreConfidence(autoClass, amount, reference, merchantOrPerson, trustedSource, hasAction);

  const decision = decide(autoClass, level, trustedSource);

  const duplicateFingerprints = buildFingerprints(signal, amount, merchantOrPerson, reference);

  const redactedPreview = buildRedactedPreview(signal, amount, autoClass, last4);

  return {
    signalId: `sig_${signal.timestamp}_${hashString(signal.rawText)}`,
    sourceType: signal.sourceType,
    autoClass,
    direction,
    amount,
    merchantOrPerson,
    last4,
    accountLast4,
    cardLast4,
    reference,
    instrumentHint,
    confidenceScore: score,
    confidenceLevel: level,
    decision,
    duplicateFingerprints,
    redactedPreview
  };
}
