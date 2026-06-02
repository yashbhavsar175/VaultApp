const fs = require('fs');
const path = require('path');

const read = relativePath => fs.readFileSync(path.join(__dirname, '..', '..', '..', relativePath), 'utf8');

describe('release-build lockdown', () => {
  it('keeps developer write and notification-test actions behind __DEV__', () => {
    const settings = read('src/screens/user/Settings.tsx');
    const developerSection = settings.slice(
      settings.indexOf('{/* Developer Section */}'),
      settings.indexOf('{/* Delivery Tools & Debug */}'),
    );

    expect(developerSection).toContain('{__DEV__ && (');
    expect(developerSection).toContain('Test Notifications');
    expect(developerSection).toContain('Seed 120 Dummy Entries');
    expect(developerSection).toContain('Seed Review Queue');
  });

  it('keeps Porter debug actions and Porter Test navigation behind __DEV__', () => {
    const settings = read('src/screens/user/Settings.tsx');
    const rootNavigator = read('src/navigation/RootNavigator.tsx');
    const settingsStack = read('src/navigation/SettingsStack.tsx');
    const porterTest = read('src/screens/porter/PorterTestScreen.tsx');

    expect(settings).toContain("{__DEV__ && renderDeliveryActionButton('Porter Test'");
    expect(settings).toMatch(/\{__DEV__ && \(\s*<>\s*\{renderDeliveryActionButton\('Start Debug Mode'/);
    expect(rootNavigator).toContain('const PorterTestScreen = __DEV__');
    expect(rootNavigator).toContain('{__DEV__ && PorterTestScreen ? <Stack.Screen name="PorterTest"');
    expect(settingsStack).toContain('const PorterTestScreen = __DEV__');
    expect(settingsStack).toContain('{__DEV__ && PorterTestScreen ? <Stack.Screen name="PorterTest"');
    expect(porterTest).toContain('if (!__DEV__) return null;');
  });

  it('keeps Porter diagnostic copy summary-only', () => {
    const porterTest = read('src/screens/porter/PorterTestScreen.tsx');

    expect(porterTest).toContain('safeTextSummary(event.textContent)');
    expect(porterTest).toContain('ACCESSIBILITY TEXT SUMMARY');
    expect(porterTest).not.toContain('Raw Text:');
    expect(porterTest).not.toContain('Full Text:');
    expect(porterTest).not.toContain('Raw Text (Full)');
    expect(porterTest).not.toContain('Location: ${event.location');
  });

  it('removes client AI provider keys and disables remote Quick Add warnings', () => {
    const config = read('src/config/index.ts');
    const cache = read('src/lib/services/cache.ts');
    const quickAdd = read('src/components/modals/QuickAddModal.tsx');
    const envExample = read('.env.example');
    const configTypes = read('src/types/react-native-config.d.ts');
    const gradle = read('android/app/build.gradle');

    expect(config).not.toContain('GEMINI_API_KEY');
    expect(config).not.toContain('OPENAI_API_KEY');
    expect(cache).not.toContain('GEMINI_API_KEY');
    expect(cache).not.toContain('OPENAI_API_KEY');
    expect(quickAdd).not.toContain('generativelanguage.googleapis.com');
    expect(quickAdd).not.toContain('tryGeminiUpgrade');
    expect(envExample).not.toContain('GEMINI_API_KEY');
    expect(envExample).not.toContain('OPENAI_API_KEY');
    expect(configTypes).not.toContain('GEMINI_API_KEY');
    expect(configTypes).not.toContain('OPENAI_API_KEY');
    expect(gradle).toContain('["GEMINI_API_KEY", "OPENAI_API_KEY"].each');
    expect(gradle).toContain('buildConfigFields.remove(key)');
    expect(gradle).toContain('resValue "string", key, ""');
  });
});
