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
});
