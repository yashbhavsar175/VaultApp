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
