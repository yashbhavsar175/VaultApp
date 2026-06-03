const fs = require('fs');
const path = require('path');

const read = relativePath => fs.readFileSync(path.join(__dirname, '..', '..', relativePath), 'utf8');

describe('financial account navigation reachability', () => {
  const countOccurrences = (source, value) => (source.match(new RegExp(value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length;

  it('exposes one unified Accounts & Cards screen from Settings', () => {
    const settingsStack = read('src/navigation/SettingsStack.tsx');
    const bottomTabs = read('src/navigation/BottomTabNavigator.tsx');
    const settingsScreen = read('src/screens/user/Settings.tsx');

    expect(settingsStack).toContain("import { BanksScreen");
    expect(settingsStack).toContain('Banks: undefined');
    expect(settingsStack).toContain('<Stack.Screen name="Banks" component={BanksScreen} />');

    expect(bottomTabs).toContain("'Banks'");
    expect(countOccurrences(settingsScreen, 'Accounts & Cards')).toBe(1);
    expect(settingsScreen).toContain('Manage balances, cards, loans, and auto-detection');
    expect(settingsScreen).toContain("navigate('Banks')");
    expect(settingsScreen).not.toContain('Cards & Accounts');
    expect(settingsScreen).not.toContain('Bank & Card Setup');
    expect(settingsScreen).not.toContain('Manage your accounts for auto-detection');
  });

  it('exposes read-only reconciliation proposals from Settings', () => {
    const settingsStack = read('src/navigation/SettingsStack.tsx');
    const bottomTabs = read('src/navigation/BottomTabNavigator.tsx');
    const settingsScreen = read('src/screens/user/Settings.tsx');

    expect(settingsStack).toContain('ReconciliationProposals: undefined');
    expect(settingsStack).toContain('<Stack.Screen name="ReconciliationProposals" component={ReconciliationProposalsScreen} />');

    expect(bottomTabs).toContain("'ReconciliationProposals'");
    expect(settingsScreen).toContain('Reconciliation Proposals');
    expect(settingsScreen).toContain("navigate('ReconciliationProposals')");
  });

  it('exposes read-only Debt Freedom Coach from Settings', () => {
    const settingsStack = read('src/navigation/SettingsStack.tsx');
    const bottomTabs = read('src/navigation/BottomTabNavigator.tsx');
    const settingsScreen = read('src/screens/user/Settings.tsx');

    expect(settingsStack).toContain('DebtFreedomCoach: undefined');
    expect(settingsStack).toContain('<Stack.Screen name="DebtFreedomCoach" component={DebtFreedomScreen} />');

    expect(bottomTabs).toContain("'DebtFreedomCoach'");
    expect(settingsScreen).toContain('Debt Freedom Coach');
    expect(settingsScreen).toContain("navigate('DebtFreedomCoach')");
  });

  it('exposes one unified Money Movement Review from Settings', () => {
    const settingsStack = read('src/navigation/SettingsStack.tsx');
    const bottomTabs = read('src/navigation/BottomTabNavigator.tsx');
    const settingsScreen = read('src/screens/user/Settings.tsx');

    expect(settingsStack).toContain('MoneyMovementReview:');
    expect(settingsStack).toContain('<Stack.Screen name="MoneyMovementReview" component={MoneyMovementReviewScreen} />');
    expect(settingsStack).toContain('IncomeReview: undefined');
    expect(settingsStack).toContain('<Stack.Screen name="IncomeReview" component={IncomeReviewScreen} />');

    expect(bottomTabs).toContain("'MoneyMovementReview'");
    expect(bottomTabs).toContain("'IncomeReview'");
    expect(countOccurrences(settingsScreen, 'Money Movement Review')).toBe(1);
    expect(settingsScreen).toContain('Review credits, payments, and money movements');
    expect(settingsScreen).toContain("navigate('MoneyMovementReview')");
    expect(settingsScreen).not.toContain('Money Movement Review: Credits');
    expect(settingsScreen).not.toContain('Money Movement Review: Payments');
    expect(settingsScreen).not.toContain("navigate('IncomeReview')");
  });

  it('keeps old account setup route names as redirects to Accounts & Cards', () => {
    const settingsStack = read('src/navigation/SettingsStack.tsx');
    const dashboardStack = read('src/navigation/DashboardStack.tsx');
    const redirects = read('src/navigation/RouteRedirects.tsx');

    expect(settingsStack).toContain('BankConfigScreen: undefined');
    expect(settingsStack).toContain('<Stack.Screen name="BankConfigScreen" component={AccountsAndCardsRouteRedirect} />');
    expect(dashboardStack).toContain('<Stack.Screen name="BankConfigScreen" component={AccountsAndCardsRouteRedirect} />');
    expect(redirects).toContain("StackActions.replace('Banks')");
  });

  it('opens Settings root after Income Review was active without duplicating root presses', () => {
    const bottomTabs = read('src/navigation/BottomTabNavigator.tsx');

    expect(bottomTabs).toContain("import { CommonActions, getFocusedRouteNameFromRoute }");
    expect(bottomTabs).toContain("const SETTINGS_TAB_ROUTE = 'Settings'");
    expect(bottomTabs).toContain("const SETTINGS_ROOT_ROUTE = 'SettingsHome'");
    expect(bottomTabs).toContain('tabPress: event =>');
    expect(bottomTabs).toContain('const handled = resetSettingsTabToRoot(navigation, route as SettingsTabRoute)');
    expect(bottomTabs).toContain('if (handled) {');
    expect(bottomTabs).toContain('event.preventDefault();');
    expect(bottomTabs).toContain('if (isFocused && nestedRouteName === SETTINGS_ROOT_ROUTE)');
    expect(bottomTabs).toContain('return false;');
    expect(bottomTabs).toContain('resetSettingsTabToRoot(navigation, route as SettingsTabRoute)');
    expect(bottomTabs).toContain('const settingsStackKey = route.state?.key');
    expect(bottomTabs).toContain('CommonActions.reset({');
    expect(bottomTabs).toContain('routes: [{ name: SETTINGS_ROOT_ROUTE }]');
    expect(bottomTabs).toContain('target: settingsStackKey');
    expect(bottomTabs).toContain('navigation.dispatch(CommonActions.navigate({ name: SETTINGS_TAB_ROUTE }))');
    expect(bottomTabs).toContain("'IncomeReview'");
    expect(bottomTabs).toContain("'MoneyMovementReview'");
  });

  it('opens Settings root after Debt Freedom was active', () => {
    const bottomTabs = read('src/navigation/BottomTabNavigator.tsx');

    expect(bottomTabs).toContain('CommonActions.reset({');
    expect(bottomTabs).toContain('routes: [{ name: SETTINGS_ROOT_ROUTE }]');
    expect(bottomTabs).toContain('target: settingsStackKey');
    expect(bottomTabs).toContain("'DebtFreedomCoach'");
  });

  it('keeps hidden Settings routes hidden from the tab bar', () => {
    const bottomTabs = read('src/navigation/BottomTabNavigator.tsx');

    expect(bottomTabs).toContain('getFocusedRouteNameFromRoute(route) ?? SETTINGS_ROOT_ROUTE');
    expect(bottomTabs).toContain('HIDDEN_SETTINGS_TAB_SCREENS.includes(routeName)');
    expect(bottomTabs).toContain("{ display: 'none' as const }");

    [
      'IncomeReview',
      'MoneyMovementReview',
      'DebtFreedomCoach',
      'ReconciliationProposals',
      'BankConfigScreen',
      'Banks',
    ].forEach(routeName => {
      expect(bottomTabs).toContain(`'${routeName}'`);
    });
  });

  it('keeps Settings tab back navigation safe after resetting nested utility routes', () => {
    const bottomTabs = read('src/navigation/BottomTabNavigator.tsx');

    expect(bottomTabs).toContain('index: 0');
    expect(bottomTabs).toContain('routes: [{ name: SETTINGS_ROOT_ROUTE }]');
    expect(bottomTabs).toContain('target: settingsStackKey');
    expect(bottomTabs).toContain('return true;');
  });

  it('keeps the Dashboard review CTA targeting unified Money Movement Review', () => {
    const dashboard = read('src/screens/Dashboard.tsx');

    expect(dashboard).toContain("screen: 'MoneyMovementReview'");
    expect(dashboard).toContain("initialSection: 'credits'");
    expect(dashboard).toContain("initialSection: 'payments'");
    expect(dashboard).toContain("initialSection: 'all'");
  });
});
