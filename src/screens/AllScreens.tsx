// ═══════════════════════════════════════════════════════════════════════════════
// ALL SCREENS MODULE - ORGANIZED STRUCTURE
// All screens organized into logical folders for better maintainability
// ═══════════════════════════════════════════════════════════════════════════════

// Auth screens
export { LoginScreen, SignupScreen } from './auth/AuthScreens';

// Financial screens
export { BanksScreen, AddCreditCardScreen, AnalyticsScreen } from './financial/FinancialScreens';

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

// Porter screens
export { PorterTestScreen } from './porter';

// Dashboard (main screen - kept in root)
export { default as Dashboard } from './Dashboard';
