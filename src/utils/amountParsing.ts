// ═══════════════════════════════════════════════════════════════════════════════
// TRANSACTION AMOUNT PARSING
// ═══════════════════════════════════════════════════════════════════════════════
//
// CRITICAL CORRECTNESS RULE:
// Bank / credit-card alerts almost always include a balance or available-credit-limit
// figure. On foreign-currency spends that limit/balance is frequently the ONLY INR
// number in the message — e.g.:
//
//   "USD 23.60 was spent on your SuperCard at ANTHROPIC.
//    Available credit limit: INR 4,514.76"
//
// A naive "first INR number wins" parser stores 4,514.76 (the remaining credit limit)
// as the spend amount. That is the bug this module exists to prevent.
//
// Strategy:
//   1. Strip every balance / limit span (and its number) from the text first, so a
//      limit/balance figure can NEVER be mistaken for the transaction amount.
//   2. Look for a real INR transaction amount in what remains.
//   3. If none, look for a foreign-currency amount and convert to an APPROXIMATE INR
//      value. Foreign spends are flagged so callers can route them to review and let
//      the user edit the exact INR amount later.
// ═══════════════════════════════════════════════════════════════════════════════

export interface ParsedAmount {
  /** Amount to store, in INR. For foreign spends this is an approximate conversion. */
  amountInr: number;
  /** Currency the spend was actually made in ('INR', 'USD', 'EUR', ...). */
  currency: string;
  /** True when the spend was in a non-INR currency, so amountInr is only an estimate. */
  isForeign: boolean;
  /** Original amount in the detected currency (e.g. 23.60 for "USD 23.60"). */
  originalAmount: number;
}

// Approximate INR conversion rates with a rough card forex markup (~3.5%) baked in.
// These are intentionally ESTIMATES — foreign transactions are flagged for review and
// the user can always edit the stored amount. Keep this table easy to update.
export const APPROX_INR_RATES: Record<string, number> = {
  USD: 88,
  EUR: 96,
  GBP: 112,
  AED: 24,
  SGD: 65,
  AUD: 58,
  CAD: 64,
  JPY: 0.6,
  CHF: 100,
};

// Spans whose number is a balance/limit, never a transaction amount. Matches things
// like: "Available credit limit: INR 6,742.60", "avl bal Rs 1,200",
// "credit limit 5000", "available balance is ₹2,000", "outstanding balance INR 900".
// The keyword (limit|balance|bal) must precede the number, so "Rs 500 spent" — where
// the amount comes before any limit/balance word — is left untouched.
const BALANCE_LIMIT_SPAN =
  /\b(?:avl|avbl|avlbl|available|current|closing|opening|ledger|effective|remaining|outstanding|unbilled|total|spend(?:ing)?)?\.?\s*(?:credit\s+)?(?:limit|bal(?:ance)?)\s*(?:is|of|now|:|=|-)?\s*(?:INR|Rs\.?:?|₹|USD|US\$|EUR|GBP|\$|€|£)?\s*-?[0-9,]+(?:\.[0-9]{1,2})?/gi;

// A genuine INR transaction amount, e.g. "INR 1,234.56", "Rs.500", "₹ 90".
const INR_AMOUNT = /(?:INR|Rs\.?:?|₹)\s*([0-9,]+(?:\.[0-9]{1,2})?)/i;

// INR amount tied to a transaction verb, e.g. "debited 500", "paid Rs 90".
const INR_AMOUNT_NEAR_KEYWORD =
  /(?:amount|amt|debited|credited|paid|received|deducted|spent|withdrawn|sent|transferred)\s*(?:of|:)?\s*(?:INR|Rs\.?:?|₹)?\s*([0-9,]+(?:\.[0-9]{1,2})?)/i;

// Foreign-currency amount, e.g. "USD 23.60", "US$ 1.00", "$23.60", "€ 19", "£10".
const FOREIGN_AMOUNT =
  /(?:\b(USD|EUR|GBP|AED|SGD|AUD|CAD|JPY|CHF)\b|US\$|(\$)|(€)|(£)|(¥))\s*([0-9,]+(?:\.[0-9]{1,2})?)/i;

function toNumber(raw: string): number {
  return parseFloat(raw.replace(/,/g, ''));
}

/** Remove balance / available-limit spans so their numbers can't be read as amounts. */
export function stripBalanceAndLimitSpans(text: string): string {
  return text.replace(BALANCE_LIMIT_SPAN, ' ');
}

/**
 * Extract the real transaction amount from an SMS / notification body.
 * Returns null when no transaction amount can be found.
 */
export function parseTransactionAmount(rawText: string): ParsedAmount | null {
  if (!rawText) return null;
  const text = stripBalanceAndLimitSpans(rawText);

  // 1) Prefer a genuine INR transaction amount.
  const inrMatch = text.match(INR_AMOUNT) || text.match(INR_AMOUNT_NEAR_KEYWORD);
  if (inrMatch && inrMatch[1]) {
    const value = toNumber(inrMatch[1]);
    if (Number.isFinite(value) && value > 0) {
      return { amountInr: value, currency: 'INR', isForeign: false, originalAmount: value };
    }
  }

  // 2) Foreign-currency spend with no INR transaction amount present.
  const fxMatch = text.match(FOREIGN_AMOUNT);
  if (fxMatch) {
    const code =
      fxMatch[1]?.toUpperCase() ||
      (fxMatch[2] ? 'USD' : fxMatch[3] ? 'EUR' : fxMatch[4] ? 'GBP' : fxMatch[5] ? 'JPY' : 'USD');
    const original = toNumber(fxMatch[6]);
    if (Number.isFinite(original) && original > 0) {
      const rate = APPROX_INR_RATES[code] ?? APPROX_INR_RATES.USD;
      const amountInr = Math.round(original * rate * 100) / 100;
      return { amountInr, currency: code, isForeign: true, originalAmount: original };
    }
  }

  return null;
}

/** True when a transaction amount (INR or foreign) can be extracted from the text. */
export function hasParsableAmount(rawText: string): boolean {
  return parseTransactionAmount(rawText) !== null;
}
