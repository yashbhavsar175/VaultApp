# Changelog

## [Unreleased]

### Security
- Replaced AsyncStorage with EncryptedStorage for Supabase session
- Removed tracked keystore credentials from gradle.properties
- Gated all console.log behind __DEV__

### Bug Fixes
- Removed startup transaction note mutation (App.tsx)
- Fixed transfer type appearing in Add/Edit screens
- Fixed FlatList nested inside ScrollView (FinancialScreens)
- Fixed date timezone parsing for People Ledger due dates
- Fixed month filter IST/UTC mismatch
- Fixed notification delete bypassing shared deleteTransaction service

### Performance
- Added pagination to transactions query (30 per page)
- Replaced SELECT * with specific column lists

### Code Quality
- Added global ErrorBoundary
- Added accessibilityLabel to all icon-only buttons
- Added dateHelpers.ts utility module
