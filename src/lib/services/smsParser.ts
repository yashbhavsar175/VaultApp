/**
 * Intelligent SMS Parser
 * 
 * Automatically detects:
 * - Bank names from sender IDs
 * - Transaction amounts
 * - Card/Account last 4 digits
 * - Transaction types (debit/credit/payment)
 * - Merchant names
 * 
 * Supports all major Indian banks with extensible pattern system
 */

// ═══════════════════════════════════════════════════════════════════════════════
// BANK SENDER ID PATTERNS
// ═══════════════════════════════════════════════════════════════════════════════

export interface BankPattern {
  name: string;
  senderIds: string[];
  keywords: string[];
  aliases: string[]; // Alternative names users might use
}

export const INDIAN_BANKS: BankPattern[] = [
  {
    name: 'State Bank of India',
    senderIds: ['SBIINB', 'SBIPSG', 'SBIUPI', 'SBICRD', 'ATMSBI'],
    keywords: ['SBI', 'State Bank'],
    aliases: ['SBI', 'State Bank', 'State Bank of India'],
  },
  {
    name: 'HDFC Bank',
    senderIds: ['HDFCBK', 'HDFC', 'HDFCBA', 'HDFCCC'],
    keywords: ['HDFC'],
    aliases: ['HDFC', 'HDFC Bank'],
  },
  {
    name: 'ICICI Bank',
    senderIds: ['ICICIB', 'ICICI', 'ICICIC'],
    keywords: ['ICICI'],
    aliases: ['ICICI', 'ICICI Bank'],
  },
  {
    name: 'Axis Bank',
    senderIds: ['AXISBK', 'AXIS', 'AXISBN'],
    keywords: ['AXIS'],
    aliases: ['Axis', 'Axis Bank'],
  },
  {
    name: 'Kotak Mahindra Bank',
    senderIds: ['KOTAKB', 'KOTAK', 'KMBL'],
    keywords: ['KOTAK', 'Kotak Mahindra'],
    aliases: ['Kotak', 'Kotak Bank', 'Kotak Mahindra'],
  },
  {
    name: 'Punjab National Bank',
    senderIds: ['PNBSMS', 'PNBALR', 'PNBBNK'],
    keywords: ['PNB', 'Punjab National'],
    aliases: ['PNB', 'Punjab National Bank'],
  },
  {
    name: 'Bank of Baroda',
    senderIds: ['BOBALR', 'BOBSMS', 'BOBBOB'],
    keywords: ['BOB', 'Bank of Baroda', 'Baroda'],
    aliases: ['BOB', 'Bank of Baroda', 'Baroda Bank'],
  },
  {
    name: 'Canara Bank',
    senderIds: ['CANBNK', 'CANARA', 'CANBKS'],
    keywords: ['CANARA', 'Canara Bank'],
    aliases: ['Canara', 'Canara Bank'],
  },
  {
    name: 'Union Bank of India',
    senderIds: ['UBISEC', 'UNIONB', 'UBIBNK'],
    keywords: ['UNION', 'Union Bank'],
    aliases: ['Union Bank', 'UBI'],
  },
  {
    name: 'IndusInd Bank',
    senderIds: ['INDBNK', 'INDUSB', 'INDIND'],
    keywords: ['INDUSIND', 'IndusInd'],
    aliases: ['IndusInd', 'IndusInd Bank'],
  },
  {
    name: 'Yes Bank',
    senderIds: ['YESBNK', 'YESBAN', 'YESYES'],
    keywords: ['YES BANK', 'YESBANK'],
    aliases: ['Yes Bank', 'YES'],
  },
  {
    name: 'IDFC First Bank',
    senderIds: ['IDFCFB', 'IDFCBN', 'IDFC'],
    keywords: ['IDFC', 'IDFC FIRST'],
    aliases: ['IDFC', 'IDFC First', 'IDFC Bank'],
  },
  {
    name: 'Federal Bank',
    senderIds: ['FEDBAK', 'FEDERA', 'FEDBNK'],
    keywords: ['FEDERAL', 'Federal Bank'],
    aliases: ['Federal', 'Federal Bank'],
  },
  {
    name: 'RBL Bank',
    senderIds: ['RBLBNK', 'RBLSMS', 'RBLRBL'],
    keywords: ['RBL', 'RBL Bank'],
    aliases: ['RBL', 'RBL Bank', 'Ratnakar Bank'],
  },
  {
    name: 'Standard Chartered',
    senderIds: ['SCBANK', 'STCBNK', 'SCBSMS'],
    keywords: ['STANDARD CHARTERED', 'SC BANK'],
    aliases: ['Standard Chartered', 'SC Bank', 'SCB'],
  },
  {
    name: 'HSBC',
    senderIds: ['HSBCIN', 'HSBC', 'HSBCSM'],
    keywords: ['HSBC'],
    aliases: ['HSBC', 'HSBC Bank'],
  },
  {
    name: 'Citibank',
    senderIds: ['CITIBK', 'CITIBN', 'CITI'],
    keywords: ['CITI', 'CITIBANK'],
    aliases: ['Citi', 'Citibank', 'Citi Bank'],
  },
  {
    name: 'American Express',
    senderIds: ['AMEXIN', 'AMEX', 'AMEXPR'],
    keywords: ['AMEX', 'AMERICAN EXPRESS'],
    aliases: ['Amex', 'American Express'],
  },
  {
    name: 'Paytm Payments Bank',
    senderIds: ['PAYTMB', 'PYTMPB', 'PAYTM'],
    keywords: ['PAYTM', 'Paytm Payments Bank'],
    aliases: ['Paytm', 'Paytm Bank'],
  },
  {
    name: 'Airtel Payments Bank',
    senderIds: ['AIRPAY', 'AIRTPB', 'AIRTEL'],
    keywords: ['AIRTEL', 'Airtel Payments'],
    aliases: ['Airtel Bank', 'Airtel Payments Bank'],
  },
];

// ═══════════════════════════════════════════════════════════════════════════════
// REGEX PATTERNS
// ═══════════════════════════════════════════════════════════════════════════════

// Amount patterns - handles INR, Rs, ₹, with/without decimals
const AMOUNT_PATTERNS = [
  /(?:INR|Rs\.?|₹)\s*([0-9,]+(?:\.[0-9]{1,2})?)/i,
  /(?:amount|amt|paid|debited|credited|received|sent|transferred)\s*(?:of|:)?\s*(?:INR|Rs\.?|₹)?\s*([0-9,]+(?:\.[0-9]{1,2})?)/i,
  /\b([0-9,]+\.[0-9]{2})\b/,  // Decimal amounts like 4925.68
];

// Card/Account last 4 digits patterns
const LAST4_PATTERNS = [
  /(?:card|a\/c|account|ac|xx|xxxx)\s*(?:ending|no\.?|number)?\s*(?:with)?\s*[xX*]{2,}([0-9]{4})/i,
  /(?:card|account)\s*[xX*]{8,}([0-9]{4})/i,
  /\b[xX*]{12}([0-9]{4})\b/,  // Standard card masking
  /ending\s*([0-9]{4})/i,
];

// Transaction type keywords
const DEBIT_KEYWORDS = ['debited', 'debit', 'spent', 'paid', 'payment', 'withdrawn', 'withdrawal', 'purchase', 'sent'];
const CREDIT_KEYWORDS = ['credited', 'credit', 'received', 'deposited', 'refund', 'cashback', 'reversal'];
const PAYMENT_KEYWORDS = ['bill payment', 'bill paid', 'payment received', 'payment of'];

// Merchant/Description extraction
const MERCHANT_PATTERNS = [
  /(?:at|to|from)\s+([A-Z][A-Za-z0-9\s&'-]{2,30}?)(?:\s+on|\s+via|\s+through|\.|$)/i,
  /(?:merchant|vendor|payee):\s*([A-Za-z0-9\s&'-]{2,30})/i,
];

// ═══════════════════════════════════════════════════════════════════════════════
// PARSER FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════════

export interface ParsedTransaction {
  amount: number | null;
  last4Digits: string | null;
  bankName: string | null;
  transactionType: 'debit' | 'credit' | 'payment' | 'unknown';
  merchant: string | null;
  upiId: string | null;  // UPI ID (e.g., user@paytm, user@ybl)
  confidence: number; // 0-100
  rawText: string;
}

/**
 * Detect bank from sender ID
 */
export function detectBankFromSender(senderId: string): string | null {
  const upperSender = senderId.toUpperCase();
  
  for (const bank of INDIAN_BANKS) {
    if (bank.senderIds.some(id => upperSender.includes(id))) {
      return bank.name;
    }
  }
  
  return null;
}

/**
 * Detect bank from SMS content
 */
export function detectBankFromContent(text: string): string | null {
  const upperText = text.toUpperCase();
  
  for (const bank of INDIAN_BANKS) {
    if (bank.keywords.some(keyword => upperText.includes(keyword.toUpperCase()))) {
      return bank.name;
    }
  }
  
  return null;
}

/**
 * Extract amount from SMS
 */
export function extractAmount(text: string): number | null {
  for (const pattern of AMOUNT_PATTERNS) {
    const match = text.match(pattern);
    if (match && match[1]) {
      const amountStr = match[1].replace(/,/g, '');
      const amount = parseFloat(amountStr);
      if (!isNaN(amount) && amount > 0) {
        return amount;
      }
    }
  }
  return null;
}

/**
 * Extract last 4 digits of card/account
 */
export function extractLast4Digits(text: string): string | null {
  for (const pattern of LAST4_PATTERNS) {
    const match = text.match(pattern);
    if (match && match[1]) {
      return match[1];
    }
  }
  return null;
}

/**
 * Detect transaction type
 */
export function detectTransactionType(text: string): 'debit' | 'credit' | 'payment' | 'unknown' {
  const lowerText = text.toLowerCase();
  
  // Check payment first (more specific)
  if (PAYMENT_KEYWORDS.some(keyword => lowerText.includes(keyword))) {
    return 'payment';
  }
  
  // Check debit
  if (DEBIT_KEYWORDS.some(keyword => lowerText.includes(keyword))) {
    return 'debit';
  }
  
  // Check credit
  if (CREDIT_KEYWORDS.some(keyword => lowerText.includes(keyword))) {
    return 'credit';
  }
  
  return 'unknown';
}

/**
 * Extract merchant/description
 */
export function extractMerchant(text: string): string | null {
  for (const pattern of MERCHANT_PATTERNS) {
    const match = text.match(pattern);
    if (match && match[1]) {
      return match[1].trim();
    }
  }
  return null;
}

/**
 * Extract UPI ID from SMS
 * Matches patterns like: user@paytm, user@ybl, user@oksbi, etc.
 */
export function extractUpiId(text: string): string | null {
  // Common UPI ID patterns
  const upiPatterns = [
    /(?:to|from|vpa|upi id|upi)\s*:?\s*([a-zA-Z0-9._-]+@[a-zA-Z0-9]+)/i,
    /([a-zA-Z0-9._-]+@(?:paytm|ybl|oksbi|okaxis|okicici|okhdfcbank|axl|ibl|ikwik|fbl|pnb|barodampay|cnrb|upi))/i,
    /\b([a-zA-Z0-9._-]+@[a-zA-Z0-9]+)\b/,
  ];

  for (const pattern of upiPatterns) {
    const match = text.match(pattern);
    if (match && match[1]) {
      const upiId = match[1].trim();
      // Validate UPI ID format (must have @ and valid characters)
      if (upiId.includes('@') && upiId.length > 5 && upiId.length < 100) {
        return upiId;
      }
    }
  }
  
  return null;
}

/**
 * Calculate confidence score based on extracted data
 */
function calculateConfidence(parsed: Partial<ParsedTransaction>): number {
  let score = 0;
  
  if (parsed.amount !== null) score += 30;
  if (parsed.last4Digits !== null) score += 25;
  if (parsed.bankName !== null) score += 20;
  if (parsed.transactionType !== 'unknown') score += 15;
  if (parsed.merchant !== null) score += 10;
  if (parsed.upiId !== null) score += 5;  // Bonus for UPI ID
  
  return score;
}

/**
 * Main parser function - extracts all transaction details from SMS
 */
export function parseSMS(smsText: string, senderId: string): ParsedTransaction {
  const amount = extractAmount(smsText);
  const last4Digits = extractLast4Digits(smsText);
  const bankFromSender = detectBankFromSender(senderId);
  const bankFromContent = detectBankFromContent(smsText);
  const bankName = bankFromSender || bankFromContent;
  const transactionType = detectTransactionType(smsText);
  const merchant = extractMerchant(smsText);
  const upiId = extractUpiId(smsText);
  
  const parsed: ParsedTransaction = {
    amount,
    last4Digits,
    bankName,
    transactionType,
    merchant,
    upiId,
    confidence: 0,
    rawText: smsText,
  };
  
  parsed.confidence = calculateConfidence(parsed);
  
  return parsed;
}

/**
 * Check if SMS is a transaction SMS (vs promotional/OTP)
 */
export function isTransactionSMS(text: string): boolean {
  const lowerText = text.toLowerCase();
  
  // Must have amount
  const hasAmount = extractAmount(text) !== null;
  if (!hasAmount) return false;
  
  // Must have transaction keywords
  const hasTransactionKeyword = 
    DEBIT_KEYWORDS.some(k => lowerText.includes(k)) ||
    CREDIT_KEYWORDS.some(k => lowerText.includes(k)) ||
    PAYMENT_KEYWORDS.some(k => lowerText.includes(k));
  
  return hasTransactionKeyword;
}

// ═══════════════════════════════════════════════════════════════════════════════
// BANK MATCHING HELPERS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Find bank by name (fuzzy matching)
 */
export function findBankByName(searchName: string): BankPattern | null {
  const search = searchName.toLowerCase().trim();
  
  for (const bank of INDIAN_BANKS) {
    // Exact match
    if (bank.name.toLowerCase() === search) {
      return bank;
    }
    
    // Alias match
    if (bank.aliases.some(alias => alias.toLowerCase() === search)) {
      return bank;
    }
    
    // Partial match
    if (bank.name.toLowerCase().includes(search) || 
        bank.aliases.some(alias => alias.toLowerCase().includes(search))) {
      return bank;
    }
  }
  
  return null;
}

/**
 * Get all bank names for dropdown/autocomplete
 */
export function getAllBankNames(): string[] {
  return INDIAN_BANKS.map(bank => bank.name).sort();
}

/**
 * Get bank aliases for search
 */
export function getBankAliases(bankName: string): string[] {
  const bank = INDIAN_BANKS.find(b => b.name === bankName);
  return bank ? bank.aliases : [];
}
