/* eslint-env jest, node */

const fs = require('fs');
const path = require('path');

describe('ReviewQueueScreen self-transfer routing gate', () => {
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
    const refundActionBranch = source.match(/\) : isRefund \? \(([\s\S]*?)\) : isSupported \? \(/);

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
});
