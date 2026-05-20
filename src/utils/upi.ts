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

  return UPI_PROVIDER_BY_HANDLE[handle] || null;
}
