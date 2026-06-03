export type BalanceSignalSourceType = 'sms' | 'notification';
export type BalanceParseConfidence = 'exact' | 'estimated' | 'low';
export type AccountTypeHint = 'savings' | 'current' | 'credit_card' | 'loan';
export type InstrumentHint = 'bank_account' | 'debit_card' | 'credit_card' | 'loan';
export type ParsedBalanceKind =
  | 'available_balance'
  | 'current_balance'
  | 'outstanding'
  | 'available_limit'
  | 'credit_limit'
  | 'due_amount'
  | 'minimum_due'
  | 'loan_outstanding';

export interface BalanceParseInput {
  text: string;
  senderOrPackage?: string | null;
  sourceType: BalanceSignalSourceType;
  timestamp?: number;
}

export interface ParsedBalanceItem {
  balanceKind: ParsedBalanceKind;
  amount: number;
  currency: 'INR';
  confidence: BalanceParseConfidence;
}

export interface ParsedCreditCardStatement {
  totalDue?: number | null;
  minimumDue?: number | null;
  paymentDueDate?: string | null;
  statementDate?: string | null;
  statementBalance?: number | null;
  confidence: BalanceParseConfidence;
}

export interface BalanceParseResult {
  isBalanceSignal: boolean;
  sourceType: BalanceSignalSourceType;
  detectedBankName?: string | null;
  detectedBankCode?: string | null;
  accountLast4?: string | null;
  cardLast4?: string | null;
  debitCardLast4?: string | null;
  accountTypeHint?: AccountTypeHint | null;
  instrumentHint?: InstrumentHint | null;
  balances: ParsedBalanceItem[];
  statement?: ParsedCreditCardStatement | null;
  confidence: BalanceParseConfidence;
  reasons: string[];
  redactedSource: {
    len: number;
    hash: string;
    senderOrPackage?: string | null;
    sourceType: BalanceSignalSourceType;
  };
}

interface BankAlias {
  code: string;
  name: string;
  patterns: RegExp[];
}

const BANK_ALIASES: BankAlias[] = [
  { code: 'HDFC', name: 'HDFC Bank', patterns: [/\bhdfc(?:bk|bank)?\b/i] },
  { code: 'ICICI', name: 'ICICI Bank', patterns: [/\bicici(?:b|bank)?\b/i] },
  { code: 'SBI', name: 'State Bank of India', patterns: [/\bsbi\b/i, /\bsbin\b/i, /\bstate bank of india\b/i] },
  { code: 'KOTAK', name: 'Kotak Mahindra Bank', patterns: [/\bkotak\b/i] },
  { code: 'AXIS', name: 'Axis Bank', patterns: [/\baxis(?:bk|bank)?\b/i] },
  { code: 'BOB', name: 'Bank of Baroda', patterns: [/\bbob\b/i, /\bbank of baroda\b/i] },
  { code: 'IDFC', name: 'IDFC FIRST Bank', patterns: [/\bidfc\b/i] },
  { code: 'AUBANK', name: 'AU Bank', patterns: [/\bau\s*bank\b/i, /\baubank\b/i] },
  { code: 'FEDERAL', name: 'Federal Bank', patterns: [/\bfederal\b/i] },
  { code: 'INDUSIND', name: 'IndusInd Bank', patterns: [/\bindusind\b/i] },
  { code: 'YESBANK', name: 'Yes Bank', patterns: [/\byes\s*bank\b/i, /\byesbank\b/i] },
  { code: 'UTKARSH', name: 'Utkarsh Bank', patterns: [/\butkarsh\b/i, /\bsupercard\b/i] },
  { code: 'SLICE', name: 'slice', patterns: [/\bslice\b/i] },
  { code: 'SUPERMONEY', name: 'super.money', patterns: [/\bsuper\.?\s*money\b/i] },
];

const MONTHS: Record<string, number> = {
  jan: 1,
  january: 1,
  feb: 2,
  february: 2,
  mar: 3,
  march: 3,
  apr: 4,
  april: 4,
  may: 5,
  jun: 6,
  june: 6,
  jul: 7,
  july: 7,
  aug: 8,
  august: 8,
  sep: 9,
  sept: 9,
  september: 9,
  oct: 10,
  october: 10,
  nov: 11,
  november: 11,
  dec: 12,
  december: 12,
};

const MONEY_VALUE = '(?:rs\\.?|inr|₹)?\\s*([0-9]{1,3}(?:,[0-9]{2,3})+(?:\\.[0-9]{1,2})?|[0-9]+(?:\\.[0-9]{1,2})?)';

function normalizeForHash(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function hashText(text: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }

  return (hash >>> 0).toString(16).padStart(8, '0');
}

function normalizeText(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function sanitizeSenderOrPackage(value?: string | null): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  if (/\b(?:\+?91[-\s]?)?[6-9]\d{9}\b/.test(trimmed) || /\d{7,}/.test(trimmed)) return null;
  if (/\b(?:address|flat|tower|road|street|society|sector|near|landmark|pincode|pin code)\b/i.test(trimmed)) {
    return null;
  }

  return trimmed
    .replace(/[^A-Za-z0-9._-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 96) || null;
}

function parseAmountValue(value?: string | null): number | null {
  if (!value) return null;
  const normalized = value.replace(/,/g, '');
  if (!/^\d+(?:\.\d{1,2})?$/.test(normalized)) return null;
  const amount = Number(normalized);
  if (!Number.isFinite(amount) || amount < 0) return null;
  return amount;
}

function addReason(reasons: string[], reason: string): void {
  if (!reasons.includes(reason)) reasons.push(reason);
}

function addBalance(
  balances: ParsedBalanceItem[],
  reasons: string[],
  balanceKind: ParsedBalanceKind,
  amount: number | null,
  confidence: BalanceParseConfidence,
  reason: string
): void {
  if (amount === null) return;
  const existing = balances.find(item => item.balanceKind === balanceKind && item.amount === amount);
  if (!existing) {
    balances.push({ balanceKind, amount, currency: 'INR', confidence });
  }
  addReason(reasons, reason);
}

function firstContextAmount(text: string, patterns: RegExp[]): number | null {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    const amount = parseAmountValue(match?.[1]);
    if (amount !== null) return amount;
  }
  return null;
}

function detectBank(text: string, senderOrPackage?: string | null): Pick<BalanceParseResult, 'detectedBankCode' | 'detectedBankName'> {
  const source = `${senderOrPackage || ''} ${text}`;
  const match = BANK_ALIASES.find(bank => bank.patterns.some(pattern => pattern.test(source)));
  return {
    detectedBankCode: match?.code || null,
    detectedBankName: match?.name || null,
  };
}

function extractLast4WithPatterns(text: string, patterns: RegExp[]): string | null {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    const digits = match?.[1]?.replace(/\D/g, '');
    if (digits && digits.length >= 4) return digits.slice(-4);
  }
  return null;
}

function extractAccountLast4(text: string): string | null {
  return extractLast4WithPatterns(text, [
    /\ba\/?c(?:count)?(?:\s*(?:no\.?|number))?\s*(?:x{1,}|[*]+)?\s*(\d{4})\b/i,
    /\baccount\s+(?:ending|ended|no\.?|number|xx|x{2,})\s*(?:with\s*)?(?:x{1,}|[*]+)?\s*(\d{4})\b/i,
    /\ba\/?c\s*(?:no\.?\s*)?[*xX]+(\d{4})\b/i,
  ]);
}

function extractCardLast4(text: string): string | null {
  return extractLast4WithPatterns(text, [
    /\b(?:credit\s*)?card\b[^.]{0,48}?\b(?:ending|ended)\s*(?:with\s*)?(?:x{1,}|[*]+)?\s*(\d{4})\b/i,
    /\b(?:credit\s*)?card(?:\s*(?:no\.?|number))?\s*(?:xx|x{2,}|[*]+)\s*(\d{4})\b/i,
    /\b(?:credit\s*)?card\s+(\d{4})\b/i,
    /\bcc\b[^.]{0,32}?\b(?:ending|ended|xx|x{2,}|[*]+)\s*(?:with\s*)?(?:x{1,}|[*]+)?\s*(\d{4})\b/i,
  ]);
}

function extractDebitCardLast4(text: string): string | null {
  return extractLast4WithPatterns(text, [
    /\bdebit\s+card(?:\s*(?:no\.?|number))?\s*(?:ending|ended|xx|x{2,}|[*]+)?\s*(\d{4})\b/i,
    /\b(?:pos|atm|ecom|e-commerce|purchase).*?\bcard\s*(?:ending|xx|x{2,}|[*]+)?\s*(\d{4})\b/i,
    /\bcard\s*(?:ending|xx|x{2,}|[*]+)?\s*(\d{4})\b.*?\b(?:pos|atm|ecom|e-commerce|purchase)\b/i,
  ]);
}

function hasCreditCardContext(text: string): boolean {
  return /\b(?:credit\s*card|cc|outstanding|available\s+limit|credit\s+limit|minimum\s+(?:amount\s+)?due|min\s+due|statement)\b/i.test(text) ||
    /\bcard\s*(?:ending|xx|x{2,}|[*]+)?\s*\d{4}\b.*?\b(?:payment\s+received|refund|reversal)\b/i.test(text) ||
    /\b(?:payment\s+received|refund|reversal)\b.*?\bcard\s*(?:ending|xx|x{2,}|[*]+)?\s*\d{4}\b/i.test(text);
}

function hasLoanContext(text: string): boolean {
  return /\b(?:loan|emi)\b/i.test(text);
}

function inferAccountTypeHint(text: string, instrumentHint: InstrumentHint | null): AccountTypeHint | null {
  if (instrumentHint === 'credit_card') return 'credit_card';
  if (instrumentHint === 'loan') return 'loan';
  if (/\bcurrent\s+(?:a\/?c|account|balance)\b/i.test(text)) return 'current';
  if (/\bsavings?\s+(?:a\/?c|account)\b/i.test(text)) return 'savings';
  return null;
}

function parseBankBalances(text: string, balances: ParsedBalanceItem[], reasons: string[]): void {
  const availablePatterns = [
    new RegExp(`\\b(?:avl|avail(?:able)?)\\.?\\s*bal(?:ance)?\\s*(?:is|:|-)?\\s*${MONEY_VALUE}`, 'i'),
    new RegExp(`\\bavailable\\s+balance\\s*(?:is|:|-)?\\s*${MONEY_VALUE}`, 'i'),
    new RegExp(`\\b${MONEY_VALUE}\\s*(?:is\\s*)?(?:available|avl)\\s*bal(?:ance)?\\b`, 'i'),
    new RegExp(`\\bbal\\s*(?:is|:|-)?\\s*${MONEY_VALUE}`, 'i'),
  ];
  const currentPatterns = [
    new RegExp(`\\bcurrent\\s+bal(?:ance)?\\s*(?:is|:|-)?\\s*${MONEY_VALUE}`, 'i'),
    new RegExp(`\\bbalance\\s+in\\s+your\\s+(?:a\\/c|account)\\s*(?:is|:|-)?\\s*${MONEY_VALUE}`, 'i'),
  ];

  addBalance(balances, reasons, 'available_balance', firstContextAmount(text, availablePatterns), 'exact', 'available_balance_found');
  addBalance(balances, reasons, 'current_balance', firstContextAmount(text, currentPatterns), 'exact', 'current_balance_found');
}

function parseLoanBalances(text: string, balances: ParsedBalanceItem[], reasons: string[]): void {
  const loanOutstanding = firstContextAmount(text, [
    new RegExp(`\\boutstanding\\s+loan\\s+(?:amount\\s*)?(?:is|:|-)?\\s*${MONEY_VALUE}`, 'i'),
    new RegExp(`\\bloan\\s+(?:outstanding|balance)\\s*(?:amount\\s*)?(?:is|:|-)?\\s*${MONEY_VALUE}`, 'i'),
  ]);
  const emiDue = firstContextAmount(text, [
    new RegExp(`\\bemi\\s+due\\s*(?:amount\\s*)?(?:is|:|-)?\\s*${MONEY_VALUE}`, 'i'),
    new RegExp(`\\bdue\\s+emi\\s*(?:amount\\s*)?(?:is|:|-)?\\s*${MONEY_VALUE}`, 'i'),
  ]);

  addBalance(balances, reasons, 'loan_outstanding', loanOutstanding, 'exact', 'loan_outstanding_found');
  addBalance(balances, reasons, 'due_amount', emiDue, 'estimated', 'emi_due_found');
}

function emptyStatement(): ParsedCreditCardStatement {
  return {
    totalDue: null,
    minimumDue: null,
    paymentDueDate: null,
    statementDate: null,
    statementBalance: null,
    confidence: 'low',
  };
}

function parseCreditCardBalances(
  text: string,
  timestamp: number | undefined,
  balances: ParsedBalanceItem[],
  reasons: string[]
): ParsedCreditCardStatement | null {
  const statement = emptyStatement();
  let hasStatement = false;

  const outstanding = firstContextAmount(text, [
    new RegExp(`\\b(?:total\\s+)?outstanding\\s*(?:amount\\s*)?(?:is|:|-)?\\s*${MONEY_VALUE}`, 'i'),
  ]);
  addBalance(balances, reasons, 'outstanding', outstanding, 'exact', 'card_outstanding_found');

  const availableLimit = firstContextAmount(text, [
    new RegExp(`\\bavailable\\s+limit\\s*(?:is|:|-)?\\s*${MONEY_VALUE}`, 'i'),
    new RegExp(`\\b${MONEY_VALUE}\\s+available\\s+limit\\b`, 'i'),
  ]);
  addBalance(balances, reasons, 'available_limit', availableLimit, 'exact', 'available_limit_found');

  const creditLimit = firstContextAmount(text, [
    new RegExp(`\\bcredit\\s+limit\\s*(?:is|:|-)?\\s*${MONEY_VALUE}`, 'i'),
  ]);
  addBalance(balances, reasons, 'credit_limit', creditLimit, 'exact', 'credit_limit_found');

  const totalDue = firstContextAmount(text, [
    new RegExp(`\\btotal\\s+(?:amount\\s+)?due\\s*(?:is|:|-)?\\s*${MONEY_VALUE}`, 'i'),
    new RegExp(`\\bamount\\s+due\\s*(?:is|:|-)?\\s*${MONEY_VALUE}`, 'i'),
  ]);
  if (totalDue !== null) {
    statement.totalDue = totalDue;
    statement.confidence = 'exact';
    hasStatement = true;
  }
  addBalance(balances, reasons, 'due_amount', totalDue, 'exact', 'card_due_amount_found');

  const minimumDue = firstContextAmount(text, [
    new RegExp(`\\bminimum\\s+(?:amount\\s+)?due\\s*(?:is|:|-)?\\s*${MONEY_VALUE}`, 'i'),
    new RegExp(`\\bmin\\.?\\s+due\\s*(?:is|:|-)?\\s*${MONEY_VALUE}`, 'i'),
  ]);
  if (minimumDue !== null) {
    statement.minimumDue = minimumDue;
    statement.confidence = 'exact';
    hasStatement = true;
  }
  addBalance(balances, reasons, 'minimum_due', minimumDue, 'exact', 'minimum_due_found');

  const statementBalance = firstContextAmount(text, [
    new RegExp(`\\bstatement\\s+(?:generated\\s+for|balance\\s*(?:is|:|-)?|amount\\s*(?:is|:|-)?)\\s*${MONEY_VALUE}`, 'i'),
  ]);
  if (statementBalance !== null) {
    statement.statementBalance = statementBalance;
    statement.confidence = 'exact';
    hasStatement = true;
    addBalance(balances, reasons, 'due_amount', statementBalance, 'exact', 'statement_balance_found');
  }

  const dueDate = extractDueDate(text, timestamp, reasons);
  if (dueDate) {
    statement.paymentDueDate = dueDate;
    statement.confidence = 'exact';
    hasStatement = true;
    addReason(reasons, 'payment_due_date_found');
  }

  const statementDate = extractStatementDate(text, timestamp, reasons);
  if (statementDate) {
    statement.statementDate = statementDate;
    hasStatement = true;
    addReason(reasons, 'statement_date_found');
  }

  if (/\b(?:payment(?:\s+of\s+(?:rs\.?|inr|₹)?\s*[0-9,.]+)?\s+received|refund|reversal)\b/i.test(text) && hasCreditCardContext(text)) {
    addReason(reasons, 'card_payment_or_refund_detected');
  }

  return hasStatement ? statement : null;
}

function toIsoDate(year: number, month: number, day: number): string | null {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    return null;
  }
  return `${year.toString().padStart(4, '0')}-${month.toString().padStart(2, '0')}-${day.toString().padStart(2, '0')}`;
}

function inferYear(day: number, month: number, timestamp?: number): number {
  const base = timestamp ? new Date(timestamp) : new Date();
  let year = base.getFullYear();
  const candidate = new Date(year, month - 1, day).getTime();
  const baseDay = new Date(base.getFullYear(), base.getMonth(), base.getDate()).getTime();
  const ninetyDaysAgo = baseDay - 90 * 24 * 60 * 60 * 1000;
  if (candidate < ninetyDaysAgo) year += 1;
  return year;
}

function extractDateFromPrefix(text: string, prefixes: RegExp[], timestamp: number | undefined, reasons: string[]): string | null {
  for (const prefix of prefixes) {
    const index = text.search(prefix);
    if (index < 0) continue;
    const windowText = text.slice(index, index + 80);

    const named = windowText.match(/\b(\d{1,2})[\s-]+(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t|tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)(?:[\s,-]+(\d{2,4}))?\b/i);
    if (named) {
      const day = Number(named[1]);
      const month = MONTHS[named[2].toLowerCase()];
      const year = named[3] ? normalizeYear(Number(named[3])) : inferYear(day, month, timestamp);
      return toIsoDate(year, month, day);
    }

    const numeric = windowText.match(/\b(\d{1,2})[-/](\d{1,2})(?:[-/](\d{2,4}))?\b/);
    if (numeric) {
      const first = Number(numeric[1]);
      const second = Number(numeric[2]);
      if (!numeric[3] && first <= 12 && second <= 12) {
        addReason(reasons, 'date_ambiguous');
        return null;
      }
      const day = first;
      const month = second;
      const year = numeric[3] ? normalizeYear(Number(numeric[3])) : inferYear(day, month, timestamp);
      return toIsoDate(year, month, day);
    }
  }

  return null;
}

function normalizeYear(year: number): number {
  if (year < 100) return year >= 70 ? 1900 + year : 2000 + year;
  return year;
}

function extractDueDate(text: string, timestamp: number | undefined, reasons: string[]): string | null {
  return extractDateFromPrefix(text, [
    /\b(?:payment\s+)?due\s+(?:date|by|on)\b/i,
    /\bpay\s+by\b/i,
  ], timestamp, reasons);
}

function extractStatementDate(text: string, timestamp: number | undefined, reasons: string[]): string | null {
  return extractDateFromPrefix(text, [
    /\bstatement\s+(?:date|generated\s+on|dated)\b/i,
  ], timestamp, reasons);
}

function resultConfidence(
  balances: ParsedBalanceItem[],
  statement: ParsedCreditCardStatement | null,
  detectedBankCode: string | null | undefined,
  accountLast4: string | null,
  cardLast4: string | null,
  instrumentHint: InstrumentHint | null
): BalanceParseConfidence {
  if (balances.some(item => item.confidence === 'exact') || statement?.confidence === 'exact') {
    if (instrumentHint === 'credit_card' || detectedBankCode || accountLast4 || cardLast4) return 'exact';
    return 'estimated';
  }

  if (balances.length > 0 || statement) return 'low';
  return 'low';
}

export function parseBalanceSignal(input: BalanceParseInput): BalanceParseResult {
  const text = normalizeText(input.text || '');
  const bank = detectBank(text, input.senderOrPackage);
  const reasons: string[] = [];
  const balances: ParsedBalanceItem[] = [];
  const accountLast4 = extractAccountLast4(text);
  const debitCardLast4 = extractDebitCardLast4(text);
  const cardLast4 = hasCreditCardContext(text) ? extractCardLast4(text) : null;

  if (accountLast4) addReason(reasons, 'account_last4_found');
  if (debitCardLast4) addReason(reasons, 'debit_card_last4_found');
  if (cardLast4) addReason(reasons, 'card_last4_found');
  if (bank.detectedBankCode) addReason(reasons, 'bank_detected');

  parseBankBalances(text, balances, reasons);

  let instrumentHint: InstrumentHint | null = null;
  if (hasLoanContext(text)) {
    instrumentHint = 'loan';
  } else if (hasCreditCardContext(text)) {
    instrumentHint = 'credit_card';
  } else if (debitCardLast4) {
    instrumentHint = 'debit_card';
  } else if (balances.length > 0 || accountLast4 || bank.detectedBankCode) {
    instrumentHint = 'bank_account';
  }

  const statement = instrumentHint === 'credit_card'
    ? parseCreditCardBalances(text, input.timestamp, balances, reasons)
    : null;

  if (instrumentHint === 'loan') {
    parseLoanBalances(text, balances, reasons);
  }

  if (!instrumentHint && balances.length > 0) instrumentHint = 'bank_account';

  const accountTypeHint = inferAccountTypeHint(text, instrumentHint);
  const isBalanceSignal = balances.length > 0 || !!statement ||
    (instrumentHint === 'credit_card' && reasons.includes('card_payment_or_refund_detected'));
  const confidence = isBalanceSignal
    ? resultConfidence(balances, statement, bank.detectedBankCode, accountLast4, cardLast4, instrumentHint)
    : 'low';

  return {
    isBalanceSignal,
    sourceType: input.sourceType,
    detectedBankName: bank.detectedBankName,
    detectedBankCode: bank.detectedBankCode,
    accountLast4,
    cardLast4,
    debitCardLast4,
    accountTypeHint,
    instrumentHint,
    balances,
    statement,
    confidence,
    reasons: isBalanceSignal ? reasons : reasons.filter(reason => reason === 'bank_detected'),
    redactedSource: {
      len: input.text.length,
      hash: hashText(normalizeForHash(input.text || '')),
      senderOrPackage: sanitizeSenderOrPackage(input.senderOrPackage),
      sourceType: input.sourceType,
    },
  };
}
