const fs = require('fs');
const path = require('path');

function read(relativePath) {
  return fs.readFileSync(path.join(__dirname, '..', '..', '..', relativePath), 'utf8');
}

describe('account removal UI copy', () => {
  it('renders hide-or-remove controls for cards and accounts', () => {
    const source = read('src/screens/financial/FinancialScreens.tsx');

    expect(source).toContain('accessibilityLabel="Hide or remove bank account"');
    expect(source).toContain('accessibilityLabel="Hide or remove credit card"');
    expect(source).toContain('Remove Account/Card');
    expect(source).toContain('Hide Account/Card');
  });

  it('uses safe remove/archive copy instead of promising transaction deletion', () => {
    const cardsSource = read('src/screens/financial/FinancialScreens.tsx');
    const setupSource = read('src/screens/financial/BankConfigScreen.tsx');
    const combined = `${cardsSource}\n${setupSource}`;

    expect(combined).toContain('impact.willArchive ? `Hide ${label} from active lists?` : `Remove ${label}?`');
    expect(combined).toContain('This hides the account/card from your active list. It does not delete transactions or change balances.');
    expect(combined).toContain('If this account/card has history, it will be hidden instead of permanently deleted.');
    expect(combined).toContain('This will not delete transactions.');
    expect(combined).toContain('This will not change your balances.');
    expect(combined).toContain("confirmText: canRemove ? (impact.willArchive ? 'Hide' : 'Remove') : 'OK'");
    expect(combined).toContain('Restore');
    expect(combined).not.toContain('All associated transactions will also be deleted.');
  });
});
