React Native personal finance app called VaultApp. In the UI, the product is presented as SpendSense. It is a mobile app for Indian users to track money, bank accounts, credit cards, loans, transactions, people ledger, places, and secure personal vault data.

Tech stack:
- React Native CLI with TypeScript
- Supabase for Auth, Postgres database, RLS, and Storage
- React Navigation with bottom tabs and nested stacks
- AsyncStorage for app cache/session/offline queue
- React Native native Android modules for SMS, notifications, accessibility/Porter tracking
- Notifee and notification listener support
- Google Sign-In plus Supabase email/password auth
- Biometric authentication and AES encryption for the Secure Vault

High-level app flow:
- `App.tsx` is the root. It initializes Supabase auth, Google Sign-In, notification/background listeners, Porter distance calculator, offline sync, cache prefetching, theme provider, and toast UI.
- If user is not logged in, app shows Login/Signup screens.
- If logged in but profile is incomplete, app shows profile setup.
- After profile completion, app opens the main tab navigator.

Main tabs:
1. Dashboard
   - Shows monthly finance overview.
   - Calculates income, expense, investment, EMI, and monthly balance.
   - Shows people ledger summary for lent/borrowed money.
   - Uses cache-first loading and background refresh.
   - Includes privacy mode when app goes to background.

2. Add Transaction
   - Supports manual transaction entry and AI-style natural language parsing.
   - Transaction types include income, expense, investment, EMI, lent, borrowed, and transfer.
   - User can select Cash or a configured bank account.
   - If offline, transaction is queued in AsyncStorage and synced later.
   - Updates bank balances and cache after writes.

3. People
   - Tracks money lent to others and borrowed from others.
   - Supports one-time and installment repayment tracking.
   - Supports payments, settlement, delete, payment history, overdue/due calculations, and WhatsApp reminders.
   - Important distinction: People screen can work with all ledger rows including settled rows, while Dashboard summary usually focuses on active/unsettled entries.

4. Vault
   - Secure Vault for sensitive user records like cards, accounts, IDs, passwords, and notes.
   - Unlocks with biometrics.
   - Secret fields are encrypted client-side before saving to Supabase.
   - Vault locks again when user leaves/backgrounds the screen.

5. Settings
   - Profile editing, password changes, logout, account deletion/data reset flows.
   - Links to bank/card setup, SMS testing, Places, and Porter test tools.
   - Has permission/service toggles for native background functionality.

Important feature areas:
- Transactions: stored in Supabase `transactions`.
- Bank accounts: stored in `bank_accounts`, with account types `savings`, `current`, `credit_card`, `loan`.
- Credit cards: `credit_cards` and `cc_transactions`, with outstanding balance triggers.
- Loans: `loans` and `emi_payments`, with outstanding balance and EMI component logic.
- People ledger: `people_ledger` and `people_ledger_payments`.
- Places: `places` table plus `place-photos` Supabase Storage bucket.
- Vault: `vault_items`, with encrypted secret fields.
- Profiles: `profiles`.

Key code locations:
- Root app/bootstrap: `App.tsx`
- Navigation: `src/navigation/RootNavigator.tsx`, `BottomTabNavigator.tsx`, `DashboardStack.tsx`, `SettingsStack.tsx`
- Shared types: `src/types/index.ts`
- Supabase/auth/core transaction functions: `src/lib/core.ts`
- Bank/credit-card/loan DB functions: `src/lib/database/financial.ts`
- People/places DB functions: `src/lib/database/userdata.ts`
- Vault DB and encryption flow: `src/lib/database/vaultDb.ts`
- Cache and prefetch: `src/lib/services/cache.ts`
- SMS/notification parsing: `src/lib/processors/TransactionProcessors.ts`, `src/lib/services/smsParser.ts`
- Main screens: `src/screens/Dashboard.tsx`, `src/screens/transactions/Add.tsx`, `src/screens/transactions/Transactions.tsx`, `src/screens/people/PeopleScreen.tsx`, `src/screens/financial/FinancialScreens.tsx`, `src/screens/financial/BankConfigScreen.tsx`, `src/screens/vault/SecureVaultScreen.tsx`, `src/screens/user/Settings.tsx`

Important architecture behavior:
- The app prefers cache-first UI loading: show cached data instantly, then refresh from Supabase in background.
- Cache keys live in `CACHE_KEYS` inside `src/lib/services/cache.ts`.
- Supabase RLS is the main cloud data security boundary.
- Local cache is mostly a performance layer, except vault secret values are encrypted before cloud storage.
- Offline transaction creation uses an `offline_tx_queue` in AsyncStorage and syncs on app foreground/network reconnect.
- Bank account model expects `current`, not `checking`.
- Bank account schema should include `credit_limit`, `loan_total`, and `upi_ids`.

When working on this app:
- First run TypeScript checks: `npx tsc --noEmit`.
- For final verification, also run `npx eslint . --quiet` and `npm test -- --runInBand`.
- Be careful with cache consistency after add/update/delete operations.
- Do not assume README is fully current; current source code has more features than the README.
- Any schema change must be checked against both SQL files and TypeScript/database functions.
- UI quality rule: App-facing UI copy must be English-only. Do not use Hinglish/Hindi in React Native screens, modals, buttons, labels, empty states, toasts, or tests that represent user-facing copy. Visible fallback icons such as '?' indicate an invalid/missing icon and must be treated as UI bugs. Every new UI card/action should use a verified icon name or a safe wrapper with fallback tests.
