const fs = require('fs');
const path = require('path');

function read(relativePath) {
  return fs.readFileSync(path.join(__dirname, '..', '..', '..', relativePath), 'utf8');
}

describe('account removal UI copy', () => {
  it('renders archive-style hide-or-remove controls for cards and accounts', () => {
    const source = `${read('src/screens/financial/FinancialScreens.tsx')}\n${read('src/screens/financial/BankConfigScreen.tsx')}`;

    expect(source).toContain('accessibilityLabel="Hide or remove bank account"');
    expect(source).toContain('accessibilityLabel="Hide or remove credit card"');
    expect(source).toContain('Remove Account/Card');
    expect(source).toContain('Hide Account/Card');
  });

  it('shows dependency-free permanent delete affordances in Bank & Card Setup', () => {
    const source = read('src/screens/financial/BankConfigScreen.tsx');

    expect(source).toContain('function removalActionForImpact');
    expect(source).toContain("label: 'Remove permanently'");
    expect(source).toContain("icon: 'delete-outline'");
    expect(source).toContain('accessibilityLabel: `Remove ${ownerLabel} permanently`');
    expect(source).toContain("title: canRemove ? (impact.willArchive ? 'Hide Account/Card' : 'Remove Permanently') : 'Cannot Remove Yet'");
    expect(source).toContain("confirmText: canRemove ? (impact.willArchive ? 'Hide' : 'Remove permanently') : 'OK'");
  });

  it('uses safe remove/archive copy instead of promising transaction deletion', () => {
    const cardsSource = read('src/screens/financial/FinancialScreens.tsx');
    const setupSource = read('src/screens/financial/BankConfigScreen.tsx');
    const combined = `${cardsSource}\n${setupSource}`;

    expect(combined).toContain('impact.willArchive ? `Hide ${label} from active lists?` : `Remove ${label}?`');
    expect(combined).toContain('This hides it from active lists. It does not delete transactions or change balances.');
    expect(setupSource).toContain('Permanent delete is unavailable because this item has history or nonzero balance.');
    expect(setupSource).toContain('This permanently removes only this empty account/card row.');
    expect(setupSource).toContain('No transactions, snapshots, statements, mappings, or history rows will be deleted.');
    expect(combined).toContain('If this account/card has history, it will be hidden instead of permanently deleted.');
    expect(combined).toContain('This will not delete transactions.');
    expect(combined).toContain('This will not change your balances.');
    expect(combined).toContain("confirmText: canRemove ? (impact.willArchive ? 'Hide' : 'Remove permanently') : 'OK'");
    expect(combined).toContain('Restore');
    expect(combined).not.toContain('All associated transactions will also be deleted.');
  });

  it('awaits one fresh Cards & Accounts reload after owner mutations', () => {
    const source = read('src/screens/financial/FinancialScreens.tsx');
    const reloadDeclaration = source.indexOf('const reloadCardsAndAccounts = useCallback(() => {');
    const cacheWrite = source.indexOf('await setCache(CACHE_KEYS.BANK_ACCOUNTS, banksData);');
    const removeCall = source.indexOf('const result = await removeOrArchiveOwner(target.ownerType, target.ownerId);');
    const removeReload = source.indexOf('reloadCardsAndAccounts();', removeCall);
    const removeToast = source.indexOf('Toast.show({', removeCall);
    const restoreCall = source.indexOf('await restoreArchivedOwner(target.ownerType, target.ownerId);');
    const restoreReload = source.indexOf('reloadCardsAndAccounts();', restoreCall);
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

  it('renders restored standalone credit cards in Bank & Card Setup active lists', () => {
    const source = read('src/screens/financial/BankConfigScreen.tsx');

    expect(source).toContain('getCreditCardBalanceViewModels');
    expect(source).toContain('const [creditCardViews, setCreditCardViews] = useState<CreditCardBalanceView[]>([]);');
    expect(source).toContain('setCreditCardViews(cardViews);');
    expect(source).toContain('creditCardViews.length === 0');
    expect(source).toContain('Credit Cards ({creditCardViews.length})');
    expect(source).toContain('creditCardViews.map((card) =>');
    expect(source).toContain("ownerType: 'credit_card'");
    expect(source).toContain('ownerId: card.creditCardId');
    expect(source).toContain('accessibilityLabel={removalAction.accessibilityLabel}');
    expect(source).toContain('name={removalAction.icon}');
    expect(source).toContain('Hide');
  });

  it('updates Bank & Card Setup local state immediately after successful mutations', () => {
    const source = read('src/screens/financial/BankConfigScreen.tsx');
    const removeCall = source.indexOf('const result = await removeOrArchiveOwner(target.ownerType, target.ownerId);');
    const removeLocalUpdate = source.indexOf('applySuccessfulOwnerRemoval(target, result.action);', removeCall);
    const removeReload = source.indexOf('void reloadCardsAndAccounts();', removeCall);
    const removeToast = source.indexOf('Toast.show({', removeCall);
    const restoreCall = source.indexOf('await restoreArchivedOwner(target.ownerType, target.ownerId);');
    const restoreLocalUpdate = source.indexOf('applySuccessfulOwnerRestore(target);', restoreCall);
    const restoreReload = source.indexOf('void reloadCardsAndAccounts();', restoreCall);
    const restoreToast = source.indexOf('Toast.show({', restoreCall);
    const restoreFailure = source.slice(
      source.indexOf("text1: 'Restore failed'") - 120,
      source.indexOf("text1: 'Restore failed'") + 180
    );

    expect(source).toContain('const reloadCardsAndAccounts = useCallback(() => {');
    expect(source).toContain('cardsAndAccountsReloadQueueRef.current = reload.catch(() => undefined);');
    expect(removeCall).toBeGreaterThan(-1);
    expect(removeLocalUpdate).toBeGreaterThan(removeCall);
    expect(removeReload).toBeGreaterThan(removeLocalUpdate);
    expect(removeToast).toBeGreaterThan(removeLocalUpdate);
    expect(restoreCall).toBeGreaterThan(-1);
    expect(restoreLocalUpdate).toBeGreaterThan(restoreCall);
    expect(restoreReload).toBeGreaterThan(restoreLocalUpdate);
    expect(restoreToast).toBeGreaterThan(restoreLocalUpdate);
    expect(restoreFailure).toContain('await reloadCardsAndAccounts();');
    expect(source).toContain('setCreditCardViews(prev => prev.filter(card => card.creditCardId !== target.ownerId));');
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

    expect(removeFailure).toContain('reloadCardsAndAccounts();');
    expect(restoreFailure).toContain('reloadCardsAndAccounts();');
    expect(source).not.toMatch(/setCreditCardViews\([^)]*filter/);
    expect(source).not.toMatch(/setBanks\([^)]*filter/);
  });

  it('ignores older overlapping refresh responses', () => {
    const source = `${read('src/screens/financial/FinancialScreens.tsx')}\n${read('src/screens/financial/BankConfigScreen.tsx')}`;

    expect(source).toContain('const bankDataRequestRef = useRef(0);');
    expect(source).toContain('const balanceViewsRequestRef = useRef(0);');
    expect(source).toContain('const archivedOwnersRequestRef = useRef(0);');
    expect(source).toContain('const accountsRequestRef = useRef(0);');
    expect(source).toContain('const removalImpactsRequestRef = useRef(0);');
    expect(source).toContain('const cardsAndAccountsReloadQueueRef = useRef<Promise<void>>(Promise.resolve());');
    expect(source).toContain('if (requestId !== bankDataRequestRef.current) return;');
    expect(source).toContain('if (requestId !== balanceViewsRequestRef.current) return;');
    expect(source).toContain('if (requestId !== archivedOwnersRequestRef.current) return;');
    expect(source).toContain('if (requestId !== accountsRequestRef.current) return;');
    expect(source).toContain('if (requestId !== removalImpactsRequestRef.current) return;');
    expect(source).toContain('cardsAndAccountsReloadQueueRef.current = reload.catch(() => undefined);');
  });
});
