// ═══════════════════════════════════════════════════════════════════════════════
// ALL SCREENS MODULE - ORGANIZED STRUCTURE
// All screens organized into logical folders for better maintainability
// ═══════════════════════════════════════════════════════════════════════════════

// Auth screens
export { LoginScreen, SignupScreen } from './auth/AuthScreens';

// Financial screens
export { BanksScreen, AddCreditCardScreen, AnalyticsScreen } from './financial/FinancialScreens';
export { default as BankConfigScreen } from './financial/BankConfigScreen';
export { default as DetectedAccountsScreen } from './financial/DetectedAccountsScreen';
export { default as SMSTestScreen } from './financial/SMSTestScreen';
export { default as BankAutoDetectScreen } from './financial/BankAutoDetectScreen';

// Transaction screens
export { Transactions, TransactionDetail, Add } from './transactions';

// User screens
export { Settings, ProfileScreen } from './user';

// People screens
export { PeopleScreen } from './people';

// Places screens
export { PlacesScreen } from './places';

// Vault screens
export { SecureVaultScreen } from './vault';

// Dashboard (main screen - kept in root)
export { default as Dashboard } from './Dashboard';
