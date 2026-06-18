const UPI_PROVIDER_BY_HANDLE: Record<string, string> = {
  // Payment apps
  ybl: 'PhonePe',
  ibl: 'PhonePe',
  axl: 'PhonePe',
  okaxis: 'Google Pay',
  okhdfcbank: 'Google Pay',
  okicici: 'Google Pay',
  oksbi: 'Google Pay',
  okbizaxis: 'Google Pay Business',
  paytm: 'Paytm',
  paytmqr: 'Paytm',
  pthdfc: 'Paytm',
  ptaxis: 'Paytm',
  ptsbi: 'Paytm',
  ptyes: 'Paytm',
  apl: 'Amazon Pay',
  amazonpay: 'Amazon Pay',
  waaxis: 'WhatsApp',
  wahdfcbank: 'WhatsApp',
  waicici: 'WhatsApp',
  wasbi: 'WhatsApp',
  cred: 'CRED',
  slice: 'Slice',
  supermoney: 'Super.money',
  freecharge: 'Freecharge',
  mobikwik: 'MobiKwik',
  payzapp: 'PayZapp',

  // Bank/native UPI handles
  hdfcbank: 'HDFC Bank',
  icici: 'ICICI Bank',
  axisbank: 'Axis Bank',
  sbi: 'State Bank of India',
  kotak: 'Kotak Bank',
  yesbank: 'YES Bank',
  pnb: 'Punjab National Bank',
  cnrb: 'Canara Bank',
  fbl: 'Federal Bank',
  barodampay: 'Bank of Baroda',
  indus: 'IndusInd Bank',
  idfcfirst: 'IDFC FIRST Bank',
  aubank: 'AU Bank',
  unionbank: 'Union Bank',
  upi: 'BHIM UPI',
};

export function extractUpiIdFromText(text?: string | null): string | null {
  if (!text) return null;

  const upiPatterns = [
    /(?:to|from|vpa|upi id|upi)\s*:?\s*([a-zA-Z0-9._-]+@[a-zA-Z0-9._-]+)/i,
    /\b([a-zA-Z0-9._-]+@[a-zA-Z0-9._-]+)\b/,
  ];

  for (const pattern of upiPatterns) {
    const match = text.match(pattern);
    const upiId = match?.[1]?.trim();

    if (upiId && upiId.length > 5 && upiId.length < 100 && upiId.includes('@')) {
      return upiId;
    }
  }

  return null;
}

export function getUpiHandle(upiId?: string | null): string | null {
  const handle = upiId?.split('@')[1]?.toLowerCase().trim();
  if (!handle) return null;

  return handle.replace(/[^a-z0-9]/g, '');
}

export function getUpiProviderName(upiId?: string | null): string | null {
  const handle = getUpiHandle(upiId);
  if (!handle) return null;

  // Check known providers first
  if (UPI_PROVIDER_BY_HANDLE[handle]) return UPI_PROVIDER_BY_HANDLE[handle];

  // Dynamic fallback: derive provider name from handle
  // Remove common suffixes like 'upi', 'pay', 'bank' and capitalize
  const cleaned = handle
    .replace(/upi$/i, '')
    .replace(/pay$/i, '')
    .replace(/bank$/i, ' Bank')
    .trim();

  if (!cleaned) return null;

  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
}

export function maskUpiId(upiId?: string | null): string | null {
  const value = upiId?.trim();
  if (!value || !value.includes('@')) return null;

  const [rawLocalPart, ...handleParts] = value.split('@');
  const localPart = rawLocalPart.trim();
  const handle = handleParts.join('@').trim().replace(/[^a-zA-Z0-9._-]/g, '');

  if (!localPart || !handle) return null;

  if (/^(?:\+?91)?\d{10}$/.test(localPart) || /^\d{6,}$/.test(localPart)) {
    return `****@${handle}`;
  }

  const visibleCount = localPart.length > 4 ? 4 : Math.max(1, localPart.length - 2);
  const visiblePrefix = localPart.slice(0, visibleCount);
  return `${visiblePrefix}***@${handle}`;
}

export function formatUpiIdsForDisplay(upiIds?: string[] | null): string | null {
  const validUpiIds = (upiIds || [])
    .map(id => id.trim())
    .filter(id => id.includes('@'));

  if (validUpiIds.length === 0) return null;
  if (validUpiIds.length > 1) return `${validUpiIds.length} UPI IDs`;

  return maskUpiId(validUpiIds[0]);
}
