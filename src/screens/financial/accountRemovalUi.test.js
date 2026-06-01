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

  it('awaits one fresh Cards & Accounts reload after owner mutations', () => {
    const source = read('src/screens/financial/FinancialScreens.tsx');
    const reloadDeclaration = source.indexOf('const reloadCardsAndAccounts = useCallback(() => {');
    const cacheWrite = source.indexOf('await setCache(CACHE_KEYS.BANK_ACCOUNTS, banksData);');
    const removeCall = source.indexOf('const result = await removeOrArchiveOwner(target.ownerType, target.ownerId);');
    const removeReload = source.indexOf('await reloadCardsAndAccounts();', removeCall);
    const removeToast = source.indexOf('Toast.show({', removeCall);
    const restoreCall = source.indexOf('await restoreArchivedOwner(target.ownerType, target.ownerId);');
    const restoreReload = source.indexOf('await reloadCardsAndAccounts();', restoreCall);
    const restoreToast = source.indexOf('Toast.show({', restoreCall);

    expect(reloadDeclaration).toBeGreaterThan(-1);
    expect(cacheWrite).toBeGreaterThan(-1);
    expect(source).toContain('() => loadData(true)');
    expect(removeCall).toBeGreaterThan(-1);
    expect(removeReload).toBeGreaterThan(removeCall);
    expect(removeToast).toBeGreaterThan(removeReload);
    expect(restoreCall).toBeGreaterThan(-1);
    expect(restoreReload).toBeGreaterThan(restoreCall);
    expect(restoreToast).toBeGreaterThan(restoreReload);
  });

  it('refreshes safely after remove and restore failures without optimistic filtering', () => {
    const source = read('src/screens/financial/FinancialScreens.tsx');
    const removeFailure = source.slice(
      source.indexOf("text1: 'Remove failed'") - 120,
      source.indexOf("text1: 'Remove failed'") + 180
    );
    const restoreFailure = source.slice(
      source.indexOf("text1: 'Restore failed'") - 120,
      source.indexOf("text1: 'Restore failed'") + 180
    );

    expect(removeFailure).toContain('await reloadCardsAndAccounts();');
    expect(restoreFailure).toContain('await reloadCardsAndAccounts();');
    expect(source).not.toMatch(/setCreditCardViews\([^)]*filter/);
    expect(source).not.toMatch(/setBanks\([^)]*filter/);
  });

  it('ignores older overlapping refresh responses', () => {
    const source = read('src/screens/financial/FinancialScreens.tsx');

    expect(source).toContain('const bankDataRequestRef = useRef(0);');
    expect(source).toContain('const balanceViewsRequestRef = useRef(0);');
    expect(source).toContain('const archivedOwnersRequestRef = useRef(0);');
    expect(source).toContain('const cardsAndAccountsReloadQueueRef = useRef<Promise<void>>(Promise.resolve());');
    expect(source).toContain('if (requestId !== bankDataRequestRef.current) return;');
    expect(source).toContain('if (requestId !== balanceViewsRequestRef.current) return;');
    expect(source).toContain('if (requestId !== archivedOwnersRequestRef.current) return;');
    expect(source).toContain('cardsAndAccountsReloadQueueRef.current = reload.catch(() => undefined);');
  });
});
