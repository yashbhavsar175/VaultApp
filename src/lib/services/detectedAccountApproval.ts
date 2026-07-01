/**
 * Detected Account Approval
 * ────────────────────────────────────────────────────────────────────────────
 * Thin, popup-friendly layer over detectedAccountReview. The app-open approval
 * popup surfaces each pending auto-detected account/card and lets the user:
 *   - Approve  → create the real bank account / credit card / debit card
 *   - Decline  → ignore the detection (removed from pending)
 *
 * Approve uses the detection's own data with sensible defaults so it is a single
 * tap in the common case. When a detection is missing data we cannot safely
 * default (no bank name, no last4, a debit card with no obvious linked account,
 * or a loan), we return 'needs_manual' so the caller can route to the manage
 * screen where the user can fill in the details.
 */
import { BankAccount } from '../../types';
import {
  DetectedAccountReviewData,
  DetectedAccountReviewItem,
  confirmDetectedBankAccount,
  confirmDetectedCreditCard,
  confirmDetectedDebitCard,
  getDetectedAccountReviewData,
  ignoreDetectedAccount,
} from './detectedAccountReview';

export type ApprovalOutcome = 'approved' | 'needs_manual' | 'failed';

const UNKNOWN_BANK = 'Unknown bank';

function hasUsableBankName(name: string | null | undefined): boolean {
  return Boolean(name && name.trim() && name.trim() !== UNKNOWN_BANK);
}

function isValidLast4(value: string | null | undefined): value is string {
  return Boolean(value && /^[0-9]{4}$/.test(value));
}

function accountTypeFromHint(hint: string | null | undefined): 'savings' | 'current' {
  return hint?.toLowerCase().includes('current') ? 'current' : 'savings';
}

function bankStartingBalance(item: DetectedAccountReviewItem): number | null {
  if (item.balanceAmount === null) return null;
  return item.balanceKind === 'available_balance' || item.balanceKind === 'current_balance'
    ? item.balanceAmount
    : null;
}

function creditCardOutstanding(item: DetectedAccountReviewItem): number | null {
  if (item.balanceAmount === null) return null;
  return item.balanceKind === 'outstanding' || item.balanceKind === 'due_amount'
    ? item.balanceAmount
    : null;
}

function linkableBankAccounts(accounts: BankAccount[]): BankAccount[] {
  return accounts.filter(
    account => account.account_type !== 'credit_card' && account.account_type !== 'loan'
  );
}

/** Load the pending detections (and the existing owners used for de-duping). */
export async function getPendingDetectedAccountReview(): Promise<DetectedAccountReviewData> {
  return getDetectedAccountReviewData();
}

/**
 * Approve a detection with one tap when we have enough data; otherwise tell the
 * caller it needs manual review. Never throws — failures map to 'failed'.
 */
export async function approveDetectedAccountItem(
  item: DetectedAccountReviewItem,
  data: DetectedAccountReviewData
): Promise<ApprovalOutcome> {
  try {
    // An exact duplicate already exists — nothing to create. Treat as resolved
    // by ignoring the duplicate detection so it stops resurfacing.
    if (item.duplicateOwner) {
      await ignoreDetectedAccount(item.id);
      return 'approved';
    }

    if (item.detectionType === 'loan') return 'needs_manual';

    if (item.detectionType === 'bank_account') {
      if (!hasUsableBankName(item.bankName) || !isValidLast4(item.accountLast4)) {
        return 'needs_manual';
      }
      await confirmDetectedBankAccount({
        detectedAccountId: item.id,
        bankName: item.bankName,
        accountLast4: item.accountLast4,
        accountType: accountTypeFromHint(item.accountTypeHint),
        startingBalance: bankStartingBalance(item),
      });
      return 'approved';
    }

    if (item.detectionType === 'credit_card') {
      const cardLast4 = item.cardLast4 || item.accountLast4;
      if (!hasUsableBankName(item.bankName) || !isValidLast4(cardLast4)) {
        return 'needs_manual';
      }
      await confirmDetectedCreditCard({
        detectedAccountId: item.id,
        bankName: item.bankName,
        cardName: `${item.bankName} card ${cardLast4}`,
        cardLast4,
        creditLimit: null,
        currentOutstanding: creditCardOutstanding(item),
        dueDate: null,
        billingCycleDate: null,
      });
      return 'approved';
    }

    if (item.detectionType === 'debit_card') {
      const cardLast4 = item.cardLast4 || item.accountLast4;
      if (!isValidLast4(cardLast4)) return 'needs_manual';

      const linkable = linkableBankAccounts(data.accounts);
      // Prefer a same-bank account; only auto-link when the choice is unambiguous.
      const sameBank = linkable.filter(
        account => account.bank_name?.trim().toLowerCase() === item.bankName.trim().toLowerCase()
      );
      const target = sameBank.length === 1 ? sameBank[0] : linkable.length === 1 ? linkable[0] : null;
      if (!target) return 'needs_manual';

      await confirmDetectedDebitCard({
        detectedAccountId: item.id,
        bankAccountId: target.id,
        cardLast4,
        cardLabel: hasUsableBankName(item.bankName) ? `${item.bankName} debit ${cardLast4}` : `Debit card ${cardLast4}`,
      });
      return 'approved';
    }

    return 'needs_manual';
  } catch (error) {
    if (__DEV__) console.error('[detectedAccountApproval] approve failed', error);
    return 'failed';
  }
}

/** Decline a detection — removes it from pending review. */
export async function declineDetectedAccountItem(id: string): Promise<boolean> {
  try {
    await ignoreDetectedAccount(id);
    return true;
  } catch (error) {
    if (__DEV__) console.error('[detectedAccountApproval] decline failed', error);
    return false;
  }
}
