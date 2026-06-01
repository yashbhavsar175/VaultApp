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
});
