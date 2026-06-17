# SpendSense / VaultApp Deep Project Introduction

## Source Note

This document describes the current checkout of the repository named `VaultApp`.
The user-facing product name in the app is `SpendSense`.

The description is source-based. It reflects the files currently present in this
workspace, especially `docs/codex_context.md`, `App.tsx`, the navigation files,
the TypeScript services, and the Supabase SQL setup. It is not proof that every
local SQL script has already been deployed to the live Supabase project.

## Executive Summary

SpendSense is a React Native CLI personal-finance app for Indian users. It is
built around INR money tracking, bank accounts, credit cards, loans,
transactions, people-ledger tracking, saved places, reminders, and a client-side
encrypted secure vault.

The app is not just a manual expense tracker. It also has Android-specific
automation for SMS and app-notification processing, balance signal detection,
bank account detection, transaction evidence capture, geofencing, notification
reminders, and Porter-style delivery-driver diagnostics. Because it handles
real financial and personal data, its most important design values are:

- Do not invent financial records.
- Preserve privacy by redacting raw sensitive input.
- Keep Supabase RLS as the durable cloud security boundary.
- Keep the UI cache-first without treating local cache as the source of truth.
- Keep Vault secrets encrypted on the client before they reach Supabase.
- Keep financial mutations user-owned, duplicate-safe, and reversible where the
  product requires review.

## Product Identity

The repo name, package name, and some internal references use `VaultApp`. The
product experience is branded as `SpendSense`. The app combines ordinary
personal finance workflows with safety-focused automation.

Primary user jobs include:

- Track monthly income, spending, investment, EMI, and balance.
- Add transactions manually or by natural-language parsing.
- Capture bank, UPI, and payment-app events from Android SMS and notifications.
- Maintain bank accounts, credit cards, debit cards, and loans.
- Track balances and balance history without converting balance-only messages
  into fake income or expense.
- Track money lent to or borrowed from people.
- Store sensitive personal records in a biometric-protected Vault.
- Save places and location-based reminders.
- Plan debt payoff with Debt Freedom Coach.
- Use optional Android delivery-driver tools for Porter distance diagnostics and
  overlays.

## Technology Stack

### Client

- React Native CLI, not Expo.
- TypeScript.
- React 19 and React Native 0.84.
- React Navigation with bottom tabs and nested stacks.
- MaterialCommunityIcons through `react-native-vector-icons`.
- AsyncStorage for normal cache, route hints, local preferences, and offline
  queues.
- EncryptedStorage for Supabase auth session storage.
- React Native Biometrics and AES crypto for the secure vault flow.
- Notifee and Android notification-listener support.
- Android native Kotlin/Java modules for SMS, notification processing,
  geofencing, boot handling, accessibility, overlays, and secure-window control.

### Backend

- Supabase Auth.
- Supabase Postgres.
- Supabase Row Level Security policies for user-owned data.
- Supabase Storage for place photos.
- Supabase Edge Function `parse-transaction` for remote AI parsing when used by
  the core parser path.
- SQL triggers, RPC functions, and policies in `supabase-fresh-setup.sql` and
  modular SQL files.

## Application Bootstrap

`App.tsx` is the real root of the app. It coordinates:

- Google Sign-In setup.
- Supabase session restoration.
- Cached profile route hints.
- Live profile checks.
- Startup timeouts and a startup repair path.
- Offline transaction sync on app foreground and network reconnect.
- Foreground notification listener initialization.
- Porter distance calculator initialization.
- Place-reminder location monitoring after login.
- Background prefetch of core app data.
- Theme provider, navigation container, toast UI, and error boundary.

The startup route is:

1. Show intro flow.
2. Restore or detect auth session.
3. If logged out, show login or signup.
4. If logged in but profile is incomplete, show profile setup.
5. If profile is complete, show the main app navigator.
6. If startup state becomes inconsistent or stalls, expose repair behavior
   instead of leaving the user stuck.

## Current Navigation Shape

The main bottom tabs are:

- Dashboard
- Add
- People
- Vault
- Settings

The root navigator currently contains:

- `MainTabs`
- `Places`
- `PorterTest` in development builds only

The Dashboard stack currently exposes:

- Dashboard home
- Banks
- Bank and card configuration redirect
- Detected accounts
- Legacy bank auto-detection
- SMS test screen
- Transactions
- Analytics
- Transaction detail

The Settings stack currently exposes:

- Settings home
- Banks
- Bank and card configuration redirect
- Detected accounts
- SMS test screen
- Debt Freedom Coach
- Places
- Place reminders
- Edit place reminder
- Place reminder map picker
- Porter Test in development builds only

Some older or reviewer-oriented documents mention additional screens such as
Review Queue, Income Review, and Reconciliation Proposals. In the current source
snapshot, income-review and evidence services still exist, but those extra
screens are not all visible in the current navigation files. Treat historical
docs as context and verify current wiring from source before assuming a screen
is active.

## Major User-Facing Feature Areas

### Dashboard

Dashboard is the main financial overview. It loads cached data first and then
refreshes from Supabase. It summarizes:

- Monthly income.
- Expenses.
- Investments.
- EMI.
- Monthly balance.
- People-ledger summary.
- Bank and account context.
- Links to analytics, transactions, and finance setup.

Important dashboard invariants:

- Refunds should reduce spending rather than become ordinary income.
- Transfers should stay neutral.
- Ambiguous credits should not be treated as earned income unless reviewed.
- Deleted or edited transactions should refresh summaries and dependent views.

### Add Transaction

The Add tab supports manual transaction creation and parsed transaction entry.
It can:

- Accept amount, type, category, note, account, and date.
- Use cash or a selected bank account.
- Parse natural-language input through local and remote parser paths.
- Queue transactions offline when needed.
- Update caches after successful writes.
- Adjust selected bank account balances where the workflow requires it.

Core transaction types include:

- `income`
- `expense`
- `investment`
- `emi`
- `transfer`
- `lent`
- `borrowed`
- `refund`

The UI does not necessarily expose every backend transaction type in every
workflow. When changing transaction behavior, compare UI options, TypeScript
types, parser behavior, SQL constraints, dashboard math, and analytics.

### Transactions

The Transactions screen is a cache-first list with filtering, pagination,
detail navigation, editing, selection, and bulk deletion. Transaction detail can
show financial metadata, source traces, account matching, masked identifiers,
and evidence-derived context.

Raw SMS and raw notification text should never be exposed here. Transaction
records should use redacted or sanitized evidence fields.

### Accounts, Cards, Loans, and Balances

Finance setup centers on `bank_accounts`, separate `credit_cards`, `loans`,
`emi_payments`, `cc_transactions`, `debit_cards`, `balance_snapshots`, and
detected account candidates.

The app supports:

- Savings and current bank accounts.
- Legacy credit-card and loan account shapes inside `bank_accounts`.
- Separate credit-card records and credit-card transactions.
- Loan records with EMI payment history.
- Debit-card detection and linking.
- Balance snapshots from SMS, notification, calculated, manual, review, and
  import sources.
- Balance history views and manual balance corrections.

Balance data is evidence. A balance-only message should update balance evidence
or a balance snapshot, not create fake income or expense.

### Detected Accounts

Detected account support helps the app identify accounts, cards, and loans from
financial signals. Candidates can be confirmed, linked, merged, or ignored where
the current source and SQL support that behavior.

This surface is high-risk because it connects evidence, ownership, balances,
and account records. Live Supabase RPC behavior must be verified separately from
local SQL files.

### People Ledger

The People tab tracks money lent and borrowed. It supports:

- Active and settled ledger entries.
- One-time and installment repayment plans.
- Payment recording.
- Payment history.
- Settlement.
- Deletion.
- Overdue and due-today calculations.
- WhatsApp reminder shortcuts.
- Local scheduled reminders.

The Dashboard usually cares about active financial exposure, while the People
screen can include settled history.

### Secure Vault

The Vault stores sensitive records such as bank PINs, UPI PINs, card details,
netbanking details, app passwords, and custom secrets.

Security behavior:

- Biometric unlock is required where available.
- Secret fields and notes are encrypted client-side before Supabase writes.
- Vault cache is purged during prefetch rather than kept as normal app cache.
- The screen locks when the user leaves or backgrounds the app.
- Android secure-window support can be toggled through a native module while
  Vault content is visible.

Vault correctness is both a product feature and a security boundary. Avoid
putting decrypted content into AsyncStorage, logs, screenshots, bug reports, or
analytics.

### Places and Reminders

Places allow users to store useful locations with category, note, coordinates,
address, and optional photo. Place photos use Supabase Storage through the
`place-photos` bucket.

Place reminders add geofencing and local notification behavior. Android native
geofence receivers and processor services support this flow.

Privacy considerations include location permission handling, photo cleanup,
storage path ownership, and exposure of exact coordinates to external map or
reverse-geocoding services.

### Debt Freedom Coach

Debt Freedom Coach is a planning tool. It reads loans, credit-card balances,
income signals, income-review decisions, and user settings to produce payoff
guidance.

It can model:

- Total debt.
- Debt-free date or duration.
- Daily and monthly target pace.
- Safe spend.
- Free cash flow after debt.
- Debt-to-income ratio.
- Debt priority.
- Warning states such as missing income, low buffer, stale balances, missing
  interest rates, or high debt load.

It must not fabricate transactions or mutate real financial balances merely to
make a plan look better.

### Android Transaction Automation

SpendSense has Android-specific automation for:

- SMS receive and read flows.
- Notification listener processing.
- Headless JS processing.
- Boot restart handling.
- Foreground transaction notifications.
- Queueing notification and SMS signals so related events can be paired.

The main JavaScript processing files are:

- `src/lib/processors/TransactionProcessors.ts`
- `src/lib/processors/TransactionQueue.ts`
- `src/lib/services/smsParser.ts`
- `src/lib/services/automaticTransactionPolicy.ts`
- `src/lib/services/transactionIntelligence.ts`
- `src/lib/services/runtimeTransactionEvidence.ts`
- `src/lib/services/transactionEvidence.ts`
- `src/lib/services/balanceSignalRecorder.ts`

The automation pipeline tries to classify financial signals, detect duplicate
events, attach account hints, record sanitized evidence, update balance signals,
and create transactions only when the policy allows it.

Important rule: clear financial automation is useful, but safety wins. A missed
transaction that can be reviewed later is safer than a fabricated or wrongly
classified transaction.

### Porter and Delivery Diagnostics

The app includes optional Android delivery-driver tools, mainly in
`src/lib/services/porter.ts` and native classes such as
`PorterAccessibilityService.kt` and `PorterModule.kt`.

These tools can:

- Check accessibility service state.
- Process delivery-app screen signals.
- Calculate route distance.
- Use overlay permissions.
- Show issue bubbles.
- Export or clear privacy-reduced debug logs.

This is one of the most privacy-sensitive parts of the app because
accessibility data can contain customer names, phones, addresses, OTPs, and raw
screen text. Diagnostic storage and exports must stay redacted.

## Data Architecture

### Supabase Tables and Storage

The main SQL setup references user-owned tables such as:

- `profiles`
- `debt_freedom_settings`
- `bank_accounts`
- `transactions`
- `transaction_evidence`
- `income_review_decisions`
- `user_accounts`
- `credit_cards`
- `cc_transactions`
- `loans`
- `emi_payments`
- `people_ledger`
- `people_ledger_payments`
- `places`
- `vault_items`
- `balance_snapshots`
- `debit_cards`
- `account_app_mappings`
- `detected_accounts`
- `credit_card_statements`

Storage includes:

- `place-photos`

### RLS and Ownership

Supabase Row Level Security is the main cloud data boundary. Most client calls
also include explicit `user_id` filters. RPC functions should validate
ownership internally as well, because client-side filters are not enough for
privileged mutation safety.

### Cache-First Contract

Cache-first behavior is intentional. Screens commonly:

1. Read cached data from AsyncStorage.
2. Render immediately if cache exists.
3. Refresh from Supabase in the background.
4. Write through cache after mutations.
5. Emit finance data-change events so other screens can refresh.

Cache keys live in `CACHE_KEYS` inside `src/lib/services/cache.ts`.

Important cache rules:

- Cache is a performance layer, not the durable truth.
- Transaction cache sanitizes raw SMS fields.
- Profile cache removes unnecessary identity fields.
- Vault cache is purged, not prefetched.
- User-scoped queues are cleared or quarantined on sign-out and user changes.

### Event-Driven Refresh

`src/lib/services/dataEvents.ts` exposes a small app-level event bus for finance
refresh events. Events can affect:

- `transactions`
- `accounts`
- `ledger`
- `balances`
- `review`

After financial mutations, emitters notify interested screens so cache-first UI
does not become stale.

### Offline Queues

Offline transaction creation and delete replay are handled through user-scoped
AsyncStorage queues. Sync runs when the app returns to foreground or network
connectivity returns.

Offline support is strongest for transactions. Other feature areas may still
depend on online Supabase calls and should be reviewed before claiming full
offline behavior.

## Financial Invariants

These rules are core acceptance criteria:

- Balance-only messages must not create transactions.
- Statement summaries must not create transactions.
- Payment reminders must not create transactions.
- Ambiguous credits must not count as earned income until reviewed.
- Refunds reduce spending and must not be treated as ordinary income.
- Self-transfers are neutral.
- Credit-card bill payments must not become generic expense or income.
- Loan EMI payments must preserve loan-specific accounting.
- Duplicate SMS, notification, retry, boot, and offline replay paths must not
  create duplicate records.
- Account removal must not silently destroy financial history.
- Manual balance corrections must not invent income or expense.

## Privacy and Security Invariants

Do not expose or store raw:

- SMS bodies.
- Notification bodies.
- OTPs.
- Phone numbers.
- Customer names.
- Addresses.
- Full account numbers.
- Full card numbers.
- Full email addresses.
- Full profile objects.
- Vault secrets.
- Raw accessibility screen text.

Use masked, redacted, hashed, or reduced forms when evidence is necessary.

Security-critical expectations:

- Supabase RLS isolates every user-owned table.
- RPCs validate ownership internally.
- Storage paths isolate user-owned photos.
- Session and cache cleanup works on sign-out and account deletion.
- Vault secrets are encrypted before remote storage.
- Android diagnostic exports do not leak sensitive raw data.

## Important Code Map

### App and Navigation

- `App.tsx`: bootstrap, auth, startup repair, sync triggers, prefetch, providers.
- `src/navigation/RootNavigator.tsx`: root stack.
- `src/navigation/BottomTabNavigator.tsx`: main tabs.
- `src/navigation/DashboardStack.tsx`: dashboard-related stack.
- `src/navigation/SettingsStack.tsx`: settings-related stack.
- `src/navigation/RouteRedirects.tsx`: route compatibility redirects.

### Core Data and Auth

- `src/lib/core.ts`: Supabase client, Google Sign-In, transaction CRUD, offline
  transaction sync.
- `src/config/index.ts`: config imports from environment.
- `src/types/index.ts`: shared domain types.

### Financial Data

- `src/lib/database/financial.ts`: bank accounts, credit cards, loans, EMI
  payments.
- `src/lib/services/balanceViewModel.ts`: balance display, balance history,
  snapshot ranking.
- `src/lib/services/balanceSignalRecorder.ts`: balance evidence capture.
- `src/lib/services/detectedAccounts.ts`: detected account candidate support.
- `src/lib/services/detectedAccountReview.ts`: detected-account confirmation,
  merge, and ignore RPC flow.
- `src/lib/services/accountRemoval.ts`: safe account/card removal.

### Transactions and Evidence

- `src/lib/processors/TransactionProcessors.ts`: SMS and notification parsing,
  duplicate detection, transaction creation, balance signals, evidence writes.
- `src/lib/processors/TransactionQueue.ts`: short-batch processing and final
  notification dispatch.
- `src/lib/services/automaticTransactionPolicy.ts`: auto-post/review policy.
- `src/lib/services/transactionIntelligence.ts`: financial signal
  classification helpers.
- `src/lib/services/transactionEvidence.ts`: durable privacy-safe evidence and
  app-account mappings.
- `src/lib/services/runtimeTransactionEvidence.ts`: runtime evidence recording
  from processors.

### Cache and Refresh

- `src/lib/services/cache.ts`: AsyncStorage cache, privacy reductions, prefetch.
- `src/lib/services/dataEvents.ts`: finance data-change event bus.
- `src/lib/services/userScopedQueues.ts`: user-owned offline queue storage and
  legacy queue quarantine.

### People and Places

- `src/lib/database/userdata.ts`: people ledger, ledger payments, places,
  place-photo upload.
- `src/lib/services/placeReminders.ts`: location reminder orchestration.
- `src/lib/services/geofenceProcessor.ts`: geofence notification processing.
- Native geofence files under `android/app/src/main/java/com/spendsense`.

### Vault

- `src/screens/vault/SecureVaultScreen.tsx`: Vault UI and lock behavior.
- `src/lib/database/vaultDb.ts`: encrypted Vault persistence.
- `src/utils/encryption.ts`: AES encryption helpers.
- `src/lib/services/vaultSecurity.ts`: Android secure-window bridge.
- `android/app/src/main/java/com/spendsense/VaultSecurityModule.kt`: native
  secure-window implementation.

### Planning and Diagnostics

- `src/lib/services/debtFreedom.ts`: pure debt planning engine.
- `src/lib/services/debtFreedomViewModel.ts`: data-to-view-model bridge.
- `src/lib/services/debtFreedomSettings.ts`: persisted coach settings.
- `src/lib/services/porter.ts`: Porter distance, overlay, and debug behavior.
- `src/lib/services/deliveryDebugBlackBox.ts`: privacy-reduced delivery
  diagnostic snapshot.

### Screens

- `src/screens/Dashboard.tsx`
- `src/screens/transactions/Add.tsx`
- `src/screens/transactions/Transactions.tsx`
- `src/screens/transactions/TransactionDetail.tsx`
- `src/screens/people/PeopleScreen.tsx`
- `src/screens/financial/FinancialScreens.tsx`
- `src/screens/financial/BankConfigScreen.tsx`
- `src/screens/financial/DetectedAccountsScreen.tsx`
- `src/screens/financial/BankAutoDetectScreen.tsx`
- `src/screens/financial/SMSTestScreen.tsx`
- `src/screens/financial/DebtFreedomScreen.tsx`
- `src/screens/vault/SecureVaultScreen.tsx`
- `src/screens/places/PlacesScreen.tsx`
- `src/screens/reminders/PlaceRemindersScreen.tsx`
- `src/screens/user/Settings.tsx`
- `src/screens/porter/PorterTestScreen.tsx`

## Android Native Surface

Important Android files include:

- `AndroidManifest.xml`
- `SmsReceiver.kt`
- `SmsProcessorService.kt`
- `NotificationListener.kt`
- `NotificationProcessorService.kt`
- `BootReceiver.kt`
- `BootProcessorService.kt`
- `GeofenceBroadcastReceiver.kt`
- `GeofenceProcessorService.kt`
- `GeofenceModule.kt`
- `PorterAccessibilityService.kt`
- `PorterModule.kt`
- `VaultSecurityModule.kt`

The manifest requests or uses permissions for internet, notifications, SMS,
boot, foreground service, location, audio recording, camera, biometrics,
overlay display, and accessibility service behavior. These permissions should
be treated as product-sensitive and privacy-sensitive.

## Development and Verification

Common commands:

```powershell
npx tsc --noEmit
npx eslint . --quiet
npx jest --runInBand
npm run android
npm run start
```

For Android native changes, also compile from the Android project:

```powershell
cd android
.\gradlew.bat :app:compileDebugKotlin --console=plain
```

For SQL, RLS, or RPC changes, local tests are not enough. Verify the deployed
Supabase function, policy, or table behavior directly.

For runtime QA with seeded data:

- Tag temporary records.
- Avoid touching real user data.
- Verify Supabase cleanup.
- Clear local AsyncStorage or RKStorage artifacts when relevant.
- Confirm temporary record count returns to zero.

## How to Safely Work in This Codebase

Before changing behavior:

1. Identify whether the request touches money movement, account ownership,
   auth/session/cache, SQL/RLS/RPC, native Android behavior, privacy logging, or
   parser behavior.
2. If yes, inspect source and tests before editing.
3. Preserve cache-first loading unless the user explicitly asks to change it.
4. Preserve RLS and explicit user ownership filters.
5. Avoid broad refactors around financial flows.
6. Prefer the smallest safe fix and focused tests first.
7. Run the broad test suite after code changes that affect shared behavior.
8. Use Android runtime verification when native, startup, permission, or
   background processing behavior changes.

## Current Architectural Cautions

- Do not assume `README.md` or older docs are fully current.
- Compare current navigation files before assuming a screen is active.
- SQL files, generated TypeScript types, service calls, and deployed Supabase
  can drift.
- Local cache can hide live-data bugs if mutation events or invalidation are
  incomplete.
- Background SMS and notification processing can replay events, so duplicate
  safety is essential.
- Android logs and diagnostic exports must be treated as sensitive.
- Vault code is security-critical even when UI changes look simple.
- Account removal, detected account confirmation, and reconciliation-like
  evidence flows must protect financial history and ownership.

## Mental Model

Think of SpendSense as four layers working together:

1. Product screens: Dashboard, Add, People, Vault, Settings, finance setup,
   places, reminders, transactions, analytics, and Debt Freedom Coach.
2. Local runtime layer: cache, offline queues, event bus, route hints, and
   background prefetch.
3. Financial intelligence layer: SMS/notification parsing, transaction policy,
   balance detection, evidence capture, account matching, income review, and
   debt planning.
4. Durable backend layer: Supabase Auth, Postgres, RLS, Storage, triggers, and
   RPCs.

Most bugs in this app come from boundaries between those layers: stale cache
after a write, local SQL differing from live SQL, a parser treating evidence as
a transaction, a debug log leaking raw data, a native replay creating duplicate
records, or a UI claiming that something was saved before the durable mutation
is actually complete.

The safest engineering posture is therefore: understand the data boundary,
preserve privacy, verify ownership, keep cache and source of truth aligned, and
prove financial side effects with focused tests or live runtime checks when the
surface requires it.
