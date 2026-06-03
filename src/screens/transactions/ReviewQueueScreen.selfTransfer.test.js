/* eslint-env jest, node */

const fs = require('fs');
const path = require('path');

describe('ReviewQueueScreen self-transfer routing gate', () => {
  it('uses confirmation wording for generic credits and debits', () => {
    const source = fs.readFileSync(path.join(__dirname, 'ReviewQueueScreen.tsx'), 'utf8');

    expect(source).toContain('Count as income');
    expect(source).toContain('Count as expense');
    expect(source).not.toContain('Create Income');
    expect(source).not.toContain('Create Expense');
    expect(source).toContain('isReviewedDebitCandidate(item)');
    expect(source).toContain('recordReviewQueueExpense(item, selectedBank)');
  });

  it('exposes self-transfer posting UI without income or expense wording', () => {
    const source = fs.readFileSync(path.join(__dirname, 'ReviewQueueScreen.tsx'), 'utf8');

    expect(source).toContain("case 'self_transfer': return 'Self Transfer'");
    expect(source).toContain('Create Transfer');
    expect(source).toContain('handleCreateTransfer');
    expect(source).toContain('recordReviewQueueTransfer');
    expect(source).toContain('getEligibleTransferAccounts');
    expect(source).toContain('eligibleTransferAccounts.map');
    expect(source).toContain('eligibleTransferAccounts.length < 2');
    expect(source).toContain('From');
    expect(source).toContain('To');
    expect(source).toContain('Choose accounts');
    expect(source).toContain('Needs at least two bank accounts');
    expect(source).toContain('Moves money between your accounts');
    expect(source).not.toContain("handleCreateTransfer(item, 'income')");
    expect(source).not.toContain("handleCreateTransfer(item, 'expense')");
  });

  it('exposes guarded refund linking without income or expense posting', () => {
    const source = fs.readFileSync(path.join(__dirname, 'ReviewQueueScreen.tsx'), 'utf8');
    const refundService = fs.readFileSync(
      path.join(__dirname, '..', '..', 'lib', 'services', 'reviewQueueRefunds.ts'),
      'utf8'
    );
    const supportedClasses = source.match(/const supportedClasses = \[([\s\S]*?)\];/);
    const refundActionBranch = source.match(/\) : isRefund \? \(([\s\S]*?)\) : isSupported && !destinationNeedsConfirmation \? \(/);

    expect(source).toContain("case 'refund': return 'Refund'");
    expect(source).toContain('Link Refund');
    expect(source).toContain('Choose Original Expense');
    expect(source).toContain('Refunds reduce spending; they are not normal income');
    expect(source).toContain('handleLinkRefund');
    expect(source).toContain('recordReviewQueueRefund');
    expect(source).toContain('getRefundExpenseMatches');
    expect(source).toContain('findLocalDuplicateLinkedRefund');
    expect(supportedClasses && supportedClasses[1]).not.toContain("'refund'");
    expect(refundActionBranch && refundActionBranch[1]).not.toContain('Create Income');
    expect(refundActionBranch && refundActionBranch[1]).not.toContain('Create Expense');
    expect(refundService).toContain('createLinkedRefundTransaction');
    expect(refundService).toContain('refundOfTransactionId: originalExpense.id');
  });

  it('requires destination account confirmation before payment-app credit income review', () => {
    const source = fs.readFileSync(path.join(__dirname, 'ReviewQueueScreen.tsx'), 'utf8');

    expect(source).toContain('Destination account needs confirmation');
    expect(source).toContain('Source app:');
    expect(source).toContain('Bank hint:');
    expect(source).toContain('Link destination account:');
    expect(source).toContain('Link to account');
    expect(source).toContain('Not my account / Keep reviewing');
    expect(source).toContain('Link account before income review');
    expect(source).toContain('confirmPaymentAppBankAccountMapping');
    expect(source).toContain('updateReviewCandidatePaymentAppMatch');
    expect(source).not.toContain('raw notification');
  });

  it('shows credit-card bill payment as a neutral specialized review action', () => {
    const source = fs.readFileSync(path.join(__dirname, 'ReviewQueueScreen.tsx'), 'utf8');

    expect(source).toContain("case 'credit_card_bill_payment': return 'Credit card bill payment'");
    expect(source).toContain('This is not counted as an expense');
    expect(source).toContain('Confirm to save it as a card payment');
    expect(source).toContain('Balance updated from bank evidence. Payment still needs review.');
    expect(source).toContain('Bank account');
    expect(source).toContain('Credit card');
    expect(source).toContain('Confirm card payment');
    expect(source).toContain('Not a card payment');
    expect(source).toContain('Link existing card setup');
    expect(source).toContain('Confirm current outstanding before using this card in debt calculations.');
    expect(source).toContain('Needs credit card setup');
    expect(source).not.toContain('Record Card Payment');
    expect(source).not.toContain('Unsupported until card selected');
  });
});
