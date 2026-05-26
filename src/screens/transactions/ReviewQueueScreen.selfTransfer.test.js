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

  it('keeps refund posting unsupported for Task 20E1 foundation work', () => {
    const source = fs.readFileSync(path.join(__dirname, 'ReviewQueueScreen.tsx'), 'utf8');
    const supportedClasses = source.match(/const supportedClasses = \[([\s\S]*?)\];/);

    expect(source).toContain("case 'refund': return 'Refund'");
    expect(source).toContain('Unsupported in this version');
    expect(supportedClasses && supportedClasses[1]).not.toContain("'refund'");
    expect(source).not.toContain('handleCreateRefund');
    expect(source).not.toContain('createLinkedRefundTransaction(');
  });
});
