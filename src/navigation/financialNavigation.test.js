const fs = require('fs');
const path = require('path');

const read = relativePath => fs.readFileSync(path.join(__dirname, '..', '..', relativePath), 'utf8');

describe('financial account navigation reachability', () => {
  it('exposes the cards and accounts screen from Settings', () => {
    const settingsStack = read('src/navigation/SettingsStack.tsx');
    const bottomTabs = read('src/navigation/BottomTabNavigator.tsx');
    const settingsScreen = read('src/screens/user/Settings.tsx');

    expect(settingsStack).toContain("import { BanksScreen");
    expect(settingsStack).toContain('Banks: undefined');
    expect(settingsStack).toContain('<Stack.Screen name="Banks" component={BanksScreen} />');

    expect(bottomTabs).toContain("'Banks'");
    expect(settingsScreen).toContain('Cards & Accounts');
    expect(settingsScreen).toContain("navigate('Banks')");
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

  it('exposes Income Review from Settings', () => {
    const settingsStack = read('src/navigation/SettingsStack.tsx');
    const bottomTabs = read('src/navigation/BottomTabNavigator.tsx');
    const settingsScreen = read('src/screens/user/Settings.tsx');

    expect(settingsStack).toContain('IncomeReview: undefined');
    expect(settingsStack).toContain('<Stack.Screen name="IncomeReview" component={IncomeReviewScreen} />');

    expect(bottomTabs).toContain("'IncomeReview'");
    expect(settingsScreen).toContain('Income Review');
    expect(settingsScreen).toContain("navigate('IncomeReview')");
  });

  it('opens Settings root after Income Review was active', () => {
    const bottomTabs = read('src/navigation/BottomTabNavigator.tsx');

    expect(bottomTabs).toContain("import { CommonActions, getFocusedRouteNameFromRoute }");
    expect(bottomTabs).toContain("const SETTINGS_TAB_ROUTE = 'Settings'");
    expect(bottomTabs).toContain("const SETTINGS_ROOT_ROUTE = 'SettingsHome'");
    expect(bottomTabs).toContain('tabPress: event =>');
    expect(bottomTabs).toContain('event.preventDefault()');
    expect(bottomTabs).toContain('resetSettingsTabToRoot(navigation, route as SettingsTabRoute)');
    expect(bottomTabs).toContain('const settingsStackKey = route.state?.key');
    expect(bottomTabs).toContain('CommonActions.reset({');
    expect(bottomTabs).toContain('routes: [{ name: SETTINGS_ROOT_ROUTE }]');
    expect(bottomTabs).toContain('target: settingsStackKey');
    expect(bottomTabs).toContain('navigation.dispatch(CommonActions.navigate({ name: SETTINGS_TAB_ROUTE }))');
    expect(bottomTabs).toContain("'IncomeReview'");
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
    expect(bottomTabs).toContain('return;');
  });

  it('keeps the Dashboard review CTA targeting Income Review directly', () => {
    const dashboard = read('src/screens/Dashboard.tsx');

    expect(dashboard).toContain("navigate('Settings', { screen: 'IncomeReview' })");
  });
});
