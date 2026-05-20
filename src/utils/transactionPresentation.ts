import { Transaction } from '../types';
import { extractUpiIdFromText, getUpiProviderName } from './upi';

type TransactionLike = {
  type?: Transaction['type'] | string | null;
  note?: string | null;
  category?: string | null;
  upi_id?: string | null;
  raw_sms?: string | null;
  sms_source?: string | null;
  sms_sender?: string | null;
  merchant?: string | null;
  rawSender?: string | null;
  source?: string | null;
};

const GENERIC_VALUES = new Set([
  '',
  'general',
  'uncategorized',
  'transaction',
  'payment',
  'upi payment',
  'bank transaction',
  'unknown',
  'others',
  'other',
]);

const CATEGORY_RULES = [
  {
    name: 'Credit Card Bills',
    icon: 'credit-card-clock-outline',
    keywords: ['cred', 'credit card', 'card bill', 'cc payment', 'card payment'],
  },
  {
    name: 'Subscriptions',
    icon: 'play-circle-outline',
    keywords: ['playstore', 'play store', 'google play', 'netflix', 'spotify', 'prime', 'hotstar', 'youtube premium', 'icloud', 'apple.com'],
  },
  {
    name: 'Groceries',
    icon: 'basket-outline',
    keywords: ['bigbasket', 'blinkit', 'zepto', 'grofers', 'grocery', 'groceries', 'dmart', 'd mart', 'jiomart', 'jio mart', 'supermarket'],
  },
  {
    name: 'Food & Dining',
    icon: 'silverware-fork-knife',
    keywords: ['zomato', 'swiggy', 'restaurant', 'cafe', 'coffee', 'hotel', 'kitchen', 'food', 'dining', 'ambika', 'tea'],
  },
  {
    name: 'Shopping',
    icon: 'shopping-outline',
    keywords: ['amazon', 'flipkart', 'myntra', 'meesho', 'ajio', 'dmart', 'mart', 'store'],
  },
  {
    name: 'Bills & Utilities',
    icon: 'file-document-outline',
    keywords: ['electricity', 'bill', 'recharge', 'broadband', 'wifi', 'jio', 'airtel', 'vi ', 'gas', 'water'],
  },
  {
    name: 'Rent & Housing',
    icon: 'home-city-outline',
    keywords: ['rent', 'maintenance', 'society', 'flat', 'apartment', 'housing', 'house'],
  },
  {
    name: 'Travel',
    icon: 'car-outline',
    keywords: ['uber', 'ola', 'rapido', 'porter', 'metro', 'irctc', 'railway', 'flight', 'bus'],
  },
  {
    name: 'Fuel',
    icon: 'gas-station-outline',
    keywords: ['petrol', 'diesel', 'fuel', 'hpcl', 'bpcl', 'iocl'],
  },
  {
    name: 'Healthcare',
    icon: 'medical-bag',
    keywords: ['pharmacy', 'medical', 'hospital', 'doctor', 'clinic', 'apollo'],
  },
  {
    name: 'Cash & ATM',
    icon: 'cash-fast',
    keywords: ['atm', 'cash withdrawal', 'withdrawn'],
  },
  {
    name: 'Fees & Charges',
    icon: 'bank-alert',
    keywords: ['charge', 'charges', 'fee', 'fees', 'penalty', 'interest', 'gst'],
  },
  {
    name: 'Education',
    icon: 'school-outline',
    keywords: ['school', 'college', 'course', 'tuition', 'udemy', 'coursera', 'exam'],
  },
  {
    name: 'Entertainment',
    icon: 'movie-open-outline',
    keywords: ['movie', 'cinema', 'pvr', 'inox', 'bookmyshow', 'game', 'gaming'],
  },
];

const CATEGORY_ICON_MAP: Record<string, string> = {
  'Credit Card Bills': 'credit-card-clock-outline',
  Subscriptions: 'play-circle-outline',
  Groceries: 'basket-outline',
  'Food & Dining': 'silverware-fork-knife',
  Shopping: 'shopping-outline',
  'Bills & Utilities': 'file-document-outline',
  'Rent & Housing': 'home-city-outline',
  Travel: 'car-outline',
  Fuel: 'gas-station-outline',
  Healthcare: 'medical-bag',
  'Cash & ATM': 'cash-fast',
  'Fees & Charges': 'bank-alert',
  Education: 'school-outline',
  Entertainment: 'movie-open-outline',
  'UPI Payments': 'qrcode-scan',
  Income: 'arrow-down-circle-outline',
  Investments: 'chart-line',
  EMI: 'credit-card-clock-outline',
  Lending: 'account-arrow-right-outline',
  Borrowing: 'account-arrow-left-outline',
  Transfers: 'swap-horizontal',
  Other: 'dots-horizontal-circle-outline',
};

const SOURCE_LABELS = [
  {
    label: 'Google Pay',
    needles: ['com.google.android.apps.nbu.paisa.user', 'gpay', 'gpayid', 'google pay'],
  },
  {
    label: 'PhonePe',
    needles: ['com.phonepe.app', 'phonepe', 'phone pe'],
  },
  {
    label: 'Paytm',
    needles: ['net.one97.paytm', 'paytm'],
  },
  {
    label: 'CRED',
    needles: ['com.dreamplug.androidapp', 'cred'],
  },
  {
    label: 'Amazon Pay',
    needles: ['amazonp', 'amazon pay', 'in.amazon.mshop.android.shopping'],
  },
  {
    label: 'WhatsApp',
    needles: ['com.whatsapp', 'whatsapp'],
  },
  {
    label: 'Super.money',
    needles: ['money.super.app', 'superm', 'super.money'],
  },
  {
    label: 'Slice',
    needles: ['slice', 'indwin.c3.shareapp', 'tech.ula'],
  },
];

function normalize(value?: string | null): string {
  return (value || '').trim();
}

function titleCase(value: string): string {
  return value
    .toLowerCase()
    .replace(/\b\w/g, char => char.toUpperCase())
    .replace(/\bUpi\b/g, 'UPI')
    .replace(/\bCred\b/g, 'CRED')
    .replace(/\bHdfc\b/g, 'HDFC')
    .replace(/\bIcici\b/g, 'ICICI')
    .replace(/\bSbi\b/g, 'SBI');
}

function isGeneric(value?: string | null): boolean {
  const normalizedValue = normalize(value).toLowerCase();
  return GENERIC_VALUES.has(normalizedValue);
}

function getBrandOverride(value: string): string | null {
  const normalizedValue = value.toLowerCase().replace(/\s+/g, ' ').trim();
  if (/^cred(?:\s+club)?$/.test(normalizedValue)) return 'CRED Club';
  if (/play\s*store|google\s*play|playstore/.test(normalizedValue)) return 'Play Store';
  if (/^swiggy/.test(normalizedValue)) return 'Swiggy';
  if (/^zomato/.test(normalizedValue)) return 'Zomato';
  if (/^paytm/.test(normalizedValue)) return 'Paytm';
  if (/^phonepe|phone\s*pe/.test(normalizedValue)) return 'PhonePe';
  if (/^gpay|google\s*pay/.test(normalizedValue)) return 'Google Pay';
  if (/^amazon/.test(normalizedValue)) return 'Amazon';
  return null;
}

function getDetectedPaymentApp(transaction: TransactionLike): string | null {
  const sourceText = [
    transaction.sms_sender,
    transaction.sms_source,
    transaction.rawSender,
    transaction.source,
    transaction.raw_sms,
  ]
    .map(value => normalize(value).toLowerCase())
    .filter(Boolean)
    .join(' ');

  if (!sourceText) return null;

  return SOURCE_LABELS.find(source =>
    source.needles.some(needle => sourceText.includes(needle))
  )?.label || null;
}

export function isUpiIdentifier(value?: string | null): boolean {
  return /^[a-zA-Z0-9._-]+@[a-zA-Z0-9._-]+$/.test(normalize(value));
}

function getSearchText(transaction: TransactionLike): string {
  return [
    transaction.merchant,
    transaction.note,
    transaction.category,
    transaction.upi_id,
    transaction.raw_sms,
    transaction.sms_sender,
    transaction.rawSender,
  ]
    .map(value => normalize(value).toLowerCase())
    .filter(Boolean)
    .join(' ');
}

export function cleanMerchantName(value?: string | null): string {
  const rawValue = normalize(value);
  if (!rawValue || isGeneric(rawValue)) return '';

  const directBrand = getBrandOverride(rawValue);
  if (directBrand) return directBrand;

  if (isUpiIdentifier(rawValue)) {
    const localPart = rawValue.split('@')[0]
      .replace(/[._-]+/g, ' ')
      .replace(/\d+/g, ' ')
      .replace(/\bbd\b/gi, ' ')
      .replace(/\bupi\b/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    const upiBrand = getBrandOverride(localPart);
    if (upiBrand) return upiBrand;

    return titleCase(localPart || 'UPI Payment');
  }

  const cleanedValue = rawValue
    .replace(/\s+/g, ' ')
    .replace(/\s+\b(?:da|pa|qr|upi)\b$/i, '')
    .trim();

  const cleanedBrand = getBrandOverride(cleanedValue);
  if (cleanedBrand) return cleanedBrand;

  return titleCase(cleanedValue);
}

export function inferTransactionCategory(transaction: TransactionLike): string {
  if (transaction.type === 'income') return 'Income';
  if (transaction.type === 'investment') return 'Investments';
  if (transaction.type === 'emi') return 'EMI';
  if (transaction.type === 'lent') return 'Lending';
  if (transaction.type === 'borrowed') return 'Borrowing';
  if (transaction.type === 'transfer') return 'Transfers';

  const searchText = getSearchText(transaction);
  const matchedRule = CATEGORY_RULES.find(rule =>
    rule.keywords.some(keyword => searchText.includes(keyword))
  );
  if (matchedRule) return matchedRule.name;

  const explicitCategory = normalize(transaction.category);
  const note = normalize(transaction.note);
  const isAutoDetected = !!transaction.sms_source && transaction.sms_source !== 'manual';

  if (
    explicitCategory &&
    !isGeneric(explicitCategory) &&
    !isUpiIdentifier(explicitCategory) &&
    (!isAutoDetected || explicitCategory.toLowerCase() !== note.toLowerCase())
  ) {
    return cleanMerchantName(explicitCategory);
  }

  const upiId = transaction.upi_id || extractUpiIdFromText(transaction.raw_sms);
  if (upiId || searchText.includes('upi')) return 'UPI Payments';

  return 'Other';
}

export function getCategoryIcon(category: string): string {
  return CATEGORY_ICON_MAP[category] || 'shape-outline';
}

export function getTransactionDisplayName(transaction: TransactionLike): string {
  const cleanedMerchant = cleanMerchantName(transaction.merchant);
  if (cleanedMerchant) return cleanedMerchant;

  const cleanedNote = cleanMerchantName(transaction.note);
  if (cleanedNote) return cleanedNote;

  const upiId = transaction.upi_id || extractUpiIdFromText(transaction.raw_sms);
  const cleanedUpi = cleanMerchantName(upiId);
  if (cleanedUpi) return cleanedUpi;

  const cleanedCategory = cleanMerchantName(transaction.category);
  if (cleanedCategory) return cleanedCategory;

  return inferTransactionCategory(transaction);
}

export function getTransactionSourceLabel(transaction: TransactionLike): string {
  const upiId = transaction.upi_id || extractUpiIdFromText(transaction.raw_sms);
  const detectedApp = getDetectedPaymentApp(transaction);

  if (upiId) {
    const provider = getUpiProviderName(upiId);
    if (detectedApp) return `${detectedApp} • ${upiId}`;
    return provider ? `${provider} UPI • ${upiId}` : `UPI • ${upiId}`;
  }

  if (detectedApp) return detectedApp;

  const source = normalize(transaction.sms_source).toLowerCase();
  if (source === 'sms' || source === 'bank') return 'Bank SMS';
  if (source === 'upi') return 'UPI alert';
  if (source === 'manual' || !source) return 'Manual entry';

  return titleCase(source);
}
