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
    expect(source).toContain('Delete Account/Card');
    expect(source).toContain('Remove permanently');
    expect(source).toContain('Hide');
  });

  it('shows dependency-free permanent delete affordances in Bank & Card Setup', () => {
    const source = read('src/screens/financial/BankConfigScreen.tsx');

    expect(source).toContain('function removalActionForImpact');
    expect(source).toContain("label: 'Remove permanently'");
    expect(source).toContain("icon: 'delete-outline'");
    expect(source).toContain('accessibilityLabel: `Remove ${ownerLabel} permanently`');
    expect(source).toContain("title: 'Delete Account/Card'");
    expect(source).toContain("confirmText: 'Delete'");
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
    expect(combined).toContain("confirmText: 'Delete'");
    expect(combined).not.toContain('All associated transactions will also be deleted.');
  });

  it('awaits one fresh Cards & Accounts reload after owner mutations', () => {
    const source = read('src/screens/financial/FinancialScreens.tsx');
    const reloadDeclaration = source.indexOf('const reloadCardsAndAccounts = useCallback(() => {');
    const cacheWrite = source.indexOf('await setCache(CACHE_KEYS.BANK_ACCOUNTS, banksData);');
    const removeCall = source.indexOf('await removeOrArchiveOwner(target.ownerType, target.ownerId);');
    const removeReload = source.indexOf('reloadCardsAndAccounts();', removeCall);
    const removeToast = source.indexOf('Toast.show({', removeCall);

    expect(reloadDeclaration).toBeGreaterThan(-1);
    expect(cacheWrite).toBeGreaterThan(-1);
    expect(source).toContain('() => loadData(true)');
    expect(removeCall).toBeGreaterThan(-1);
    expect(removeReload).toBeGreaterThan(removeCall);
    expect(removeToast).toBeGreaterThan(removeReload);
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

  it('reloads Bank & Card Setup after successful owner mutations', () => {
    const source = read('src/screens/financial/BankConfigScreen.tsx');
    const removeCall = source.indexOf('await removeOrArchiveOwner(target.ownerType, target.ownerId);');
    const removeReload = source.indexOf('void reloadCardsAndAccounts();', removeCall);
    const removeToast = source.indexOf('Toast.show({', removeCall);

    expect(source).toContain('const reloadCardsAndAccounts = useCallback(() => {');
    expect(source).toContain('cardsAndAccountsReloadQueueRef.current = reload.catch(() => undefined);');
    expect(removeCall).toBeGreaterThan(-1);
    expect(removeReload).toBeGreaterThan(removeCall);
    expect(removeToast).toBeGreaterThan(removeReload);
    expect(source).not.toContain('applySuccessfulOwnerRemoval');
    expect(source).not.toMatch(/setCreditCardViews\(prev => prev\.filter/);
  });

  it('refreshes safely after remove failures without optimistic filtering', () => {
    const source = read('src/screens/financial/FinancialScreens.tsx');
    const removeFailure = source.slice(
      source.indexOf("text1: 'Remove failed'") - 120,
      source.indexOf("text1: 'Remove failed'") + 180
    );

    expect(removeFailure).toContain('reloadCardsAndAccounts();');
    expect(source).not.toMatch(/setCreditCardViews\([^)]*filter/);
    expect(source).not.toMatch(/setBanks\([^)]*filter/);
  });

  it('ignores older overlapping refresh responses', () => {
    const source = `${read('src/screens/financial/FinancialScreens.tsx')}\n${read('src/screens/financial/BankConfigScreen.tsx')}`;

    expect(source).toContain('const bankDataRequestRef = useRef(0);');
    expect(source).toContain('const balanceViewsRequestRef = useRef(0);');
    expect(source).toContain('const accountsRequestRef = useRef(0);');
    expect(source).toContain('const removalImpactsRequestRef = useRef(0);');
    expect(source).toContain('const cardsAndAccountsReloadQueueRef = useRef<Promise<void>>(Promise.resolve());');
    expect(source).toContain('if (requestId !== bankDataRequestRef.current) return;');
    expect(source).toContain('if (requestId !== balanceViewsRequestRef.current) return;');
    expect(source).toContain('if (requestId !== accountsRequestRef.current) return;');
    expect(source).toContain('if (requestId !== removalImpactsRequestRef.current) return;');
    expect(source).toContain('cardsAndAccountsReloadQueueRef.current = reload.catch(() => undefined);');
  });
});
