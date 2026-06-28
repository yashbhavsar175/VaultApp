import {
  getExpenseReviewAction,
  getIncomeReviewAction,
  getCountedTransactionBadgeColor,
  getTransactionAmountPrefix,
  getTransactionColor,
  getTransactionDisplayAmountPrefix,
  getTransactionDisplayColor,
  getTransactionDisplayIcon,
  getTransactionDisplayTypeLabel,
  getTransactionSyncStatusLabel,
  getTransactionIcon,
  getTransactionTypeLabel,
  isTransactionPendingSync,
  shouldShowNeutralReviewAction,
  shouldShowReviewDecisionForTransaction,
} from './transactionHelpers';
import {
  getCategoryIcon,
  getTransactionDisplayName,
  getTransactionSourceLabel,
  inferTransactionCategory,
} from './transactionPresentation';

describe('refund transaction presentation', () => {
  it('uses a distinct refund icon, color, label, and positive offset prefix', () => {
    expect(getTransactionIcon('refund')).toBe('cash-refund');
    expect(getTransactionColor('refund')).toBe('#14b8a6');
    expect(getTransactionAmountPrefix('refund')).toBe('+');
    expect(getTransactionTypeLabel('refund')).toBe('Refund');
  });

  it('keeps existing signs for income, expense, and transfer', () => {
    expect(getTransactionAmountPrefix('income')).toBe('+');
    expect(getTransactionAmountPrefix('expense')).toBe('-');
    expect(getTransactionAmountPrefix('transfer')).toBe('\u2194');
  });

  it('shows self transfers as bank route instead of a person name', () => {
    expect(getTransactionDisplayName({
      type: 'transfer',
      merchant: 'Yashbhavsar',
      note: 'Bank of Baroda to Kotak',
      category: 'Transfers',
      raw_sms: 'Received Rs.1.00 from yashbhavsar175@oksbi',
    })).toBe('Bank of Baroda to Kotak');

    expect(getTransactionDisplayName({
      type: 'transfer',
      merchant: 'Yashbhavsar',
      note: 'Yashbhavsar',
      category: 'Yashbhavsar',
      raw_sms: 'Received Rs.1.00 from yashbhavsar175@oksbi',
    })).toBe('Bank to Bank');
  });

  it('categorizes refund rows separately from income and expense', () => {
    expect(inferTransactionCategory({
      type: 'refund',
      note: 'Amazon refund',
      category: 'Refund',
    })).toBe('Refunds');
    expect(getCategoryIcon('Refunds')).toBe('cash-refund');
  });
});

describe('review decision transaction presentation', () => {
  it('removes the counted badge without dimming ignored expense rows', () => {
    const transaction = {
      type: 'expense',
      account_match_status: 'ignored',
      account_match_reason: 'review_detail_not_expense',
    };

    expect(getTransactionDisplayIcon(transaction)).toBe('trending-down');
    expect(getTransactionDisplayColor(transaction)).toBe('#ef4444');
    expect(getTransactionDisplayAmountPrefix(transaction)).toBe('-');
    expect(getTransactionDisplayTypeLabel(transaction)).toBe('Not expense');
    expect(getCountedTransactionBadgeColor(transaction)).toBeNull();
  });

  it('does not show a verified expense badge until the expense is explicitly confirmed', () => {
    expect(getCountedTransactionBadgeColor({
      type: 'expense',
    })).toBeNull();
    expect(getCountedTransactionBadgeColor({
      type: 'expense',
      account_match_status: 'manual_confirmed',
      account_match_reason: 'auto_confirmed_expense',
    })).toBeNull();
    expect(getCountedTransactionBadgeColor({
      type: 'expense',
      account_match_status: 'manual_confirmed',
      account_match_reason: 'review_detail_expense_confirmed',
    })).toBe('#ef4444');
    expect(getCountedTransactionBadgeColor({
      type: 'expense',
      account_match_status: 'manual_confirmed',
      account_match_reason: 'review_queue_expense_confirmed',
    })).toBe('#ef4444');
  });

  it('keeps income and refunds checked by default unless review excluded them', () => {
    expect(getCountedTransactionBadgeColor({ type: 'income' })).toBe('#10b981');
    expect(getCountedTransactionBadgeColor({ type: 'refund' })).toBe('#10b981');
    expect(getCountedTransactionBadgeColor({
      type: 'income',
      account_match_status: 'review_required',
    })).toBeNull();
  });

  it('uses logical icons for neutral transfer and card-payment decisions', () => {
    expect(getTransactionDisplayIcon({
      type: 'expense',
      account_match_status: 'ignored',
      account_match_reason: 'review_detail_transfer_confirmed',
    })).toBe('swap-horizontal');
    expect(getTransactionDisplayAmountPrefix({
      type: 'expense',
      account_match_status: 'ignored',
      account_match_reason: 'review_detail_transfer_confirmed',
    })).toBe('\u2194');

    expect(getTransactionDisplayIcon({
      type: 'expense',
      account_match_status: 'ignored',
      account_match_reason: 'credit_card_bill_payment',
    })).toBe('credit-card-check-outline');
    expect(getTransactionDisplayColor({
      type: 'expense',
      account_match_status: 'ignored',
      account_match_reason: 'credit_card_bill_payment',
    })).toBe('#6366f1');
  });

  it('shows review decisions for manual, voice, and no-source transactions', () => {
    expect(shouldShowReviewDecisionForTransaction({ type: 'expense', sms_source: 'manual' }, false)).toBe(true);
    expect(shouldShowReviewDecisionForTransaction({ type: 'expense', sms_source: 'voice' }, false)).toBe(true);
    expect(shouldShowReviewDecisionForTransaction({ type: 'expense', sms_source: null }, false)).toBe(true);
  });

  it('shows the opposite action for already counted income and expense rows', () => {
    expect(getExpenseReviewAction({ type: 'expense', account_match_status: 'linked' })).toEqual({
      label: 'Mark not expense',
      icon: 'cash-remove',
      countAs: false,
    });
    expect(getIncomeReviewAction({ type: 'income', account_match_status: 'manual_confirmed' })).toEqual({
      label: 'Mark not income',
      icon: 'cash-remove',
      countAs: false,
    });
  });

  it('shows restore actions for ignored or review-required rows', () => {
    expect(getExpenseReviewAction({ type: 'expense', account_match_status: 'ignored' })).toEqual({
      label: 'Count as expense',
      icon: 'cash-check',
      countAs: true,
    });
    expect(getIncomeReviewAction({ type: 'income', account_match_status: 'review_required' })).toEqual({
      label: 'Count as income',
      icon: 'cash-check',
      countAs: true,
    });
  });

  it('hides the neutral decision that is already applied', () => {
    expect(shouldShowNeutralReviewAction({
      type: 'expense',
      account_match_status: 'ignored',
      account_match_reason: 'review_detail_not_counted',
    }, 'review_detail_not_counted')).toBe(false);
    expect(shouldShowNeutralReviewAction({
      type: 'expense',
      account_match_status: 'ignored',
      account_match_reason: 'review_detail_not_counted',
    }, 'review_detail_transfer_confirmed')).toBe(true);
  });
});

describe('analytics source label privacy', () => {
  it('renders a masked UPI ID for Largest Entries labels', () => {
    const rawUpiId = 'customer.name@okhdfcbank';
    const label = getTransactionSourceLabel({
      upi_id: rawUpiId,
      sms_source: 'upi',
    });

    expect(label).toContain('cust***@okhdfcbank');
    expect(label).not.toContain(rawUpiId);
  });

  it('does not render a full phone-like UPI ID for Largest Entries labels', () => {
    const rawUpiId = '9876543210@ybl';
    const label = getTransactionSourceLabel({
      upi_id: rawUpiId,
      sms_sender: 'PhonePe',
    });

    expect(label).toContain('****@ybl');
    expect(label).not.toContain(rawUpiId);
  });
});

describe('pending sync transaction presentation', () => {
  it('labels local idempotent rows as pending sync', () => {
    const transaction = {
      id: 'local_20260619_1',
      client_idempotency_key: 'local_20260619_1',
      type: 'expense',
    };

    expect(isTransactionPendingSync(transaction)).toBe(true);
    expect(getTransactionSyncStatusLabel(transaction)).toBe('Pending sync');
  });

  it('does not mark server UUID rows as pending sync', () => {
    const transaction = {
      id: '123e4567-e89b-12d3-a456-426614174000',
      client_idempotency_key: 'local_20260619_1',
      type: 'expense',
    };

    expect(isTransactionPendingSync(transaction)).toBe(false);
    expect(getTransactionSyncStatusLabel(transaction)).toBeNull();
  });
});
