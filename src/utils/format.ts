/**
 * Format Utilities — Consolidated
 * 
 * Common formatting functions used across multiple screens.
 */

/**
 * Format amount as Indian Rupee currency string
 * e.g. 85263.16 → "₹85,263"
 */
export function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(amount);
}

/**
 * Format amount with decimals
 * e.g. 85263.16 → "₹85,263.16"
 */
export function formatCurrencyDecimal(amount: number): string {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

/**
 * Format display amounts without dropping paise.
 * Whole rupee values stay compact, while decimal balances keep up to 2 digits.
 * e.g. 85263 → "₹85,263", 85263.16 → "₹85,263.16"
 */
export function formatCurrencyDisplay(amount: number): string {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(amount);
}
