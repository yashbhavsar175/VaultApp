# SpendSense / VaultApp Deep Project Introduction

Last updated: 2026-06-17

Use this document as the first file to give any AI assistant before asking it to
debug, review, or modify this project. It is written as an AI handoff: it explains
what the app is, how the code is shaped, what must never be broken, which files
matter for each feature, and how to verify changes safely.

The repository name is `VaultApp`. The user-facing product name is `SpendSense`.

## Quick Prompt For Another AI

Paste this before sharing a bug, file, stack trace, or feature request:

```text
You are working on SpendSense, a React Native CLI + TypeScript personal finance
app for Indian users. The repo is named VaultApp. Read
docs/PROJECT_DEEP_INTRODUCTION.md and docs/codex_context.md first, then inspect
the relevant source files before making assumptions.

Important rules:
- Preserve cache-first loading.
- Preserve Supabase RLS and user ownership checks.
- Never invent fake financial records.
- Do not convert balance-only, statement, reminder, or ambiguous messages into
  income or expense transactions.
- Keep Vault secrets encrypted client-side.
- Do not expose raw SMS, notification text, OTPs, phone numbers, addresses,
  full account/card numbers, full emails, raw profile objects, or Vault secrets
  in UI, logs, cache, tests, or diagnostics.
- User-facing app copy must be English-only.
- Do not define React components inline inside other components.
- Prefer the smallest safe fix, add focused tests when behavior changes, and run
  the right verification commands.

When I give you one file, understand how it connects to navigation, data
services, cache, Supabase tables/RPCs, Android native modules, and tests before
debugging it.
```

## One-Paragraph Product Summary

SpendSense is a mobile personal-finance app that tracks transactions, bank
accounts, credit cards, loans, people-ledger money, saved places, reminders, and
secure personal vault records. It is more than a manual expense tracker: it also
processes Android SMS and notification signals, records privacy-safe transaction
evidence, detects account and balance signals, supports offline transaction
queues, and includes optional delivery-driver diagnostics such as Porter distance
tools. Because the app handles real financial and personal data, correctness,
privacy, ownership, duplicate safety, and cache consistency are product-critical.

## Tech Stack

- React Native CLI, not Expo.
- TypeScript.
- React 19 and React Native 0.84.
- React Navigation with bottom tabs and nested stack navigators.
- Supabase Auth, Postgres, Storage, RLS, Edge Functions, SQL triggers, and RPCs.
- AsyncStorage for cache, route hints, local settings, and offline queues.
- EncryptedStorage for Supabase auth session storage.
- React Native Biometrics and AES crypto for Vault unlock/encryption flows.
- Notifee and Android notification-listener support.
- Android Kotlin/Java native modules for SMS, notifications, geofencing, boot
  handling, accessibility, overlay behavior, and secure-window behavior.
- Jest, TypeScript, ESLint, Android Gradle/Kotlin compile for verification.

## Source Of Truth Rules

- `docs/codex_context.md` is the compact current project contract. Read it first.
- Current source code beats old README/docs when they disagree.
- Local SQL files do not prove live Supabase is updated. SQL/RLS/RPC changes need
  live Supabase verification when the task depends on deployed behavior.
- Cache can make stale behavior look correct. Always trace both cache reads and
  Supabase writes for data bugs.
- Android runtime behavior can differ from TypeScript tests. Native, permission,
  startup, SMS, notification, geofence, accessibility, and overlay changes need
  Android compile or runtime QA as appropriate.

## App Startup And Routing

`App.tsx` is the real app root. It coordinates:

- Google Sign-In setup.
- Supabase session restoration through EncryptedStorage.
- Profile route hints from cache.
- Live profile lookup and startup retry/repair screens.
- Offline transaction sync on foreground and network reconnect.
- Foreground notification listener initialization.
- Porter distance calculator initialization.
- Place-reminder location monitoring after login.
- Background prefetch of core app data.
- Theme provider, navigation container, toast UI, permission prompt, and error
  boundary.

Startup flow:

1. Show intro flow while auth/profile startup prepares.
2. If logged out, show login or signup.
3. If logged in but profile is incomplete, show profile setup.
4. If profile is complete, show the main app.
5. If startup stalls or cannot confirm state, show retry/repair UI instead of a
   blank app.

Current main tabs in `src/navigation/BottomTabNavigator.tsx`:

- `Dashboard`
- `Add`
- `People`
- `Vault`
- `Settings`

Current root stack in `src/navigation/RootNavigator.tsx`:

- `MainTabs`
- `Places`
- `PorterTest` in development builds only

Important nested stacks:

- `src/navigation/DashboardStack.tsx`
- `src/navigation/SettingsStack.tsx`
- `src/navigation/RouteRedirects.tsx`

## Major Feature Areas

### Authentication

Primary files:

- `src/screens/auth/AuthScreens.tsx`
- `src/lib/core.ts`
- `App.tsx`
- `src/config/index.ts`

Auth supports email/password, Google Sign-In, persisted Supabase sessions,
profile completion routing, biometric quick login against an existing valid
session, startup timeouts, and local repair behavior.

Debugging tips:

- Login success may rely on `supabase.auth.onAuthStateChange`, not only direct UI
  callbacks.
- `LoginScreen` can call `onAuthenticated` for retry/startup recovery.
- Supabase auth session storage uses EncryptedStorage in `src/lib/core.ts`.
- Profile completion is decided from `profiles.full_name`.
- Do not log full email, tokens, sessions, or raw profile objects.

### Dashboard

Primary files:

- `src/screens/Dashboard.tsx`
- `src/lib/services/financeSummary.ts`
- `src/lib/services/cache.ts`
- `src/lib/services/dataEvents.ts`
- `src/lib/core.ts`

Dashboard is cache-first. It summarizes income, expenses, investments, EMI,
monthly balance, people-ledger exposure, and account context.

Financial invariants:

- Refunds reduce spending; they are not normal income.
- Transfers are neutral.
- Ambiguous credits should not become income unless reviewed/confirmed.
- Balance-only messages must not create transactions.
- Deleting or editing transactions must refresh dependent summaries.

### Add Transaction And Transactions

Primary files:

- `src/screens/transactions/Add.tsx`
- `src/screens/transactions/Transactions.tsx`
- `src/screens/transactions/TransactionDetail.tsx`
- `src/lib/core.ts`
- `src/types/index.ts`

Transaction types currently include:

- `income`
- `expense`
- `investment`
- `emi`
- `transfer`
- `lent`
- `borrowed`
- `refund`

Core mutation functions in `src/lib/core.ts` include transaction add, update,
delete, bulk delete, transfer creation, refund creation, parser helpers, and
offline sync.

Debugging tips:

- Check both UI transaction types and `TransactionType`.
- Check cache update/invalidation after every write.
- Check `emitFinanceDataChanged` after financial mutations.
- Check user ownership in Supabase queries.
- Offline queues are user-scoped and should not replay another user's data.

### Accounts, Cards, Loans, Balances

Primary files:

- `src/screens/financial/FinancialScreens.tsx`
- `src/screens/financial/BankConfigScreen.tsx`
- `src/screens/financial/DetectedAccountsScreen.tsx`
- `src/lib/database/financial.ts`
- `src/lib/services/balanceViewModel.ts`
- `src/lib/services/balanceSignalRecorder.ts`
- `src/lib/services/detectedAccounts.ts`
- `src/lib/services/detectedAccountReview.ts`
- `src/lib/services/accountRemoval.ts`
- `src/types/index.ts`

The app handles:

- Bank accounts: `savings`, `current`, `credit_card`, `loan`.
- Separate credit cards and credit-card transactions.
- Separate loans and EMI payments.
- Debit cards and linked bank accounts.
- Balance snapshots from SMS, notifications, manual corrections, calculated
  values, review, and import sources.
- Detected account/card/loan candidates.

Critical rule: account and balance evidence is not automatically a financial
transaction. A balance message can update balance evidence, but must not invent
income or expense.

### SMS, Notifications, Evidence, And Automation

Primary files:

- `src/lib/processors/TransactionProcessors.ts`
- `src/lib/processors/TransactionQueue.ts`
- `src/lib/services/smsParser.ts`
- `src/lib/services/balanceParser.ts`
- `src/lib/services/automaticTransactionPolicy.ts`
- `src/lib/services/transactionIntelligence.ts`
- `src/lib/services/transactionEvidence.ts`
- `src/lib/services/runtimeTransactionEvidence.ts`
- `src/lib/services/balanceSignalRecorder.ts`
- Android files under `android/app/src/main/java/com/spendsense`

This pipeline processes SMS and notification signals, classifies financial
events, records sanitized evidence, detects duplicate/replayed events, matches
accounts/cards, records balance snapshots, and creates transactions only when
policy allows.

High-risk cases:

- Duplicate SMS/notification pairs.
- Boot or foreground-service replay.
- Ambiguous credits.
- Credit-card bill payments.
- Refunds/reversals.
- Balance-only messages.
- Statement summaries.
- Payment reminders.
- Loan disbursal or EMI messages.

When in doubt, prefer review/safe evidence over automatic posting.

### People Ledger

Primary files:

- `src/screens/people/PeopleScreen.tsx`
- `src/lib/database/userdata.ts`
- `src/lib/services/scheduledNotifications.ts`

People Ledger tracks money lent and borrowed, active/settled entries, repayment
plans, payment history, settlement, deletion, due/overdue state, WhatsApp
reminders, and local reminders.

Dashboard usually cares about active exposure. People screen can include settled
history.

### Secure Vault

Primary files:

- `src/screens/vault/SecureVaultScreen.tsx`
- `src/lib/database/vaultDb.ts`
- `src/utils/encryption.ts`
- `src/lib/services/vaultSecurity.ts`
- `android/app/src/main/java/com/spendsense/VaultSecurityModule.kt`

The Vault stores sensitive records such as PINs, card/account details, IDs,
passwords, and notes.

Vault security contract:

- Unlock with biometrics where available.
- Encrypt secret fields client-side before Supabase writes.
- Do not keep decrypted secrets in AsyncStorage.
- Purge Vault cache during prefetch instead of caching secrets.
- Lock on screen leave/background.
- Avoid decrypted content in logs, screenshots, crash reports, tests, or
  analytics.

### Places And Reminders

Primary files:

- `src/screens/places/PlacesScreen.tsx`
- `src/screens/reminders/PlaceRemindersScreen.tsx`
- `src/screens/reminders/EditPlaceReminderScreen.tsx`
- `src/screens/reminders/PlaceReminderMapPickerScreen.tsx`
- `src/lib/database/userdata.ts`
- `src/lib/services/placeReminders.ts`
- `src/lib/services/geofenceProcessor.ts`
- Native geofence files under `android/app/src/main/java/com/spendsense`

Places use Supabase Storage bucket `place-photos`. Reminders use location and
geofence behavior. Treat exact location, photos, and notification content as
privacy-sensitive.

### Debt Freedom Coach

Primary files:

- `src/screens/financial/DebtFreedomScreen.tsx`
- `src/lib/services/debtFreedom.ts`
- `src/lib/services/debtFreedomViewModel.ts`
- `src/lib/services/debtFreedomSettings.ts`

Debt Freedom Coach models payoff guidance from loans, credit cards, balances,
income signals, review decisions, and user settings.

Important rule: the pure engine should not mutate real data, import Supabase,
import React Native UI, or fabricate transactions. It should calculate guidance
from supplied inputs.

### Porter And Delivery Diagnostics

Primary files:

- `src/screens/porter/PorterTestScreen.tsx`
- `src/lib/services/porter.ts`
- `src/lib/services/deliveryDebugBlackBox.ts`
- `android/app/src/main/java/com/spendsense/PorterAccessibilityService.kt`
- `android/app/src/main/java/com/spendsense/PorterModule.kt`

These tools support delivery-driver distance/overlay diagnostics. This is very
privacy-sensitive because accessibility or screen data can include customer
names, phone numbers, addresses, OTPs, order details, and raw screen text.

Diagnostic rule: store/export compact redacted diagnostics only.

## Data Model Overview

Important TypeScript types live in `src/types/index.ts`:

- `Transaction`
- `TransactionType`
- `BankAccount`
- `BalanceSnapshot`
- `DetectedAccount`
- `DebitCard`
- `TransactionEvidence`
- `AccountAppMapping`
- `CreditCardStatement`
- `PeopleLedger`
- `Place`

Important financial service types also live in `src/lib/database/financial.ts`:

- `CreditCard`
- `Loan`
- EMI/payment helper types

Important Supabase tables in `supabase-fresh-setup.sql` and modular SQL files:

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

Storage:

- `place-photos`

## Cache And Refresh Contract

Primary files:

- `src/lib/services/cache.ts`
- `src/lib/services/dataEvents.ts`
- `src/lib/services/userScopedQueues.ts`
- `src/lib/core.ts`

Screens commonly follow stale-while-revalidate behavior:

1. Read AsyncStorage cache.
2. Render quickly if cache exists.
3. Refresh from Supabase in background.
4. Write through cache after mutation.
5. Emit finance data-change events.

Important cache keys live in `CACHE_KEYS`:

- `cache_transactions`
- `cache_people_ledger`
- `cache_places`
- `cache_vault_items`
- `cache_bank_accounts`
- `cache_unique_categories`
- `cache_user_profile`
- `cache_ledger_payments`
- `cache_dashboard_summary`
- `cache_balance_views`
- `cache_income_review_decisions`

Cache rules:

- Cache is best-effort and not the durable truth.
- Transaction cache sanitizes raw SMS fields.
- Profile cache removes identity fields.
- Vault cache is purged, not prefetched.
- Offline transaction/delete queues are user-scoped.
- Sign-out and account deletion should clear/quarantine local financial queues.

## Non-Negotiable Financial Rules

Do not break these:

- Do not create fake financial records.
- Balance-only messages must not create transactions.
- Statement summaries must not create transactions.
- Payment reminders must not create transactions.
- Ambiguous credits must not count as earned income until reviewed.
- Refunds reduce expense and must not become normal income.
- Self-transfers are neutral.
- Credit-card bill payments must not become generic expense/income.
- Loan EMI behavior must preserve loan/account semantics.
- Duplicate SMS, notifications, retries, boot events, and offline replay must not
  create duplicate records.
- Account/card removal must not silently destroy financial history.
- Manual balance corrections must not invent income or expense.

## Non-Negotiable Privacy And Security Rules

Do not expose or store raw:

- SMS bodies.
- Notification bodies.
- OTPs.
- Phone numbers.
- Customer names.
- Addresses.
- Full account numbers.
- Full card numbers.
- Full emails.
- Raw profile objects.
- Vault secrets.
- Raw accessibility screen text.
- Auth tokens or session payloads.

Use masked, redacted, hashed, summarized, or structural metadata instead.

Security expectations:

- Supabase RLS isolates user-owned rows.
- Client queries still include explicit `user_id`/ownership filters.
- RPC functions validate ownership internally.
- Storage paths isolate user-owned files.
- Vault secrets are encrypted before remote storage.
- Diagnostic exports are privacy-reduced.

## UI And React Rules

- App-facing UI copy must be English-only.
- Do not add Hindi/Hinglish to screens, modals, buttons, toasts, empty states, or
  tests that assert visible app copy.
- Avoid visible fallback icons such as `?`; use verified MaterialCommunityIcons
  names or a safe icon wrapper.
- Do not define React components inside another component's render/function body.
  Inline components can remount on every render and cause bugs like keyboard
  closing after one typed character.
- Preserve the existing design system and theme context unless the task is
  explicitly a redesign.

## How An AI Should Debug A File In This Project

When given a single file, do not debug it in isolation. Follow this order:

1. Read `docs/codex_context.md` and this document.
2. Identify the feature area: auth, dashboard, transaction, account/card/loan,
   parser, cache, native Android, Vault, People, Places, Debt Freedom, or Porter.
3. Find inbound callers: navigation route, screen parent, service callers,
   native bridge, tests, or background processor.
4. Find outbound effects: Supabase table/RPC, AsyncStorage cache key, event bus,
   Android native module, notification, permission, or storage bucket.
5. Check whether it touches high-risk areas: money movement, SQL/RLS/RPC,
   auth/session/cache, financial mutations, native dependencies, privacy logs,
   parser/transaction automation, or Vault encryption.
6. Inspect tests near the feature before editing.
7. Make the smallest safe change.
8. Add or update focused tests for changed behavior.
9. Run focused verification first, then broader verification if the surface
   warrants it.
10. For SQL/RPC/native/runtime flows, verify beyond local TypeScript/Jest.

## Verification Commands

Common local checks:

```powershell
npx tsc --noEmit
npx eslint . --quiet
npx jest --runInBand
```

Run focused Jest tests first when practical:

```powershell
npx jest path\to\test --runInBand
```

Android native compile:

```powershell
cd android
.\gradlew.bat :app:compileDebugKotlin --console=plain
```

For SQL/RLS/RPC changes:

- Check local SQL and TypeScript call sites.
- Apply/verify the deployed Supabase SQL body or policy.
- Confirm behavior with a real authenticated user/session or controlled test
  data.
- Do not claim live success from local tests alone.

For seeded runtime QA:

- Tag temporary records clearly.
- Avoid touching real user data.
- Verify Supabase cleanup.
- Clear local AsyncStorage/RKStorage artifacts when relevant.
- Confirm temporary record count returns to zero.

## File Map For Fast Orientation

App/root:

- `App.tsx`
- `index.js`
- `src/config/index.ts`

Navigation:

- `src/navigation/RootNavigator.tsx`
- `src/navigation/BottomTabNavigator.tsx`
- `src/navigation/DashboardStack.tsx`
- `src/navigation/SettingsStack.tsx`
- `src/navigation/RouteRedirects.tsx`

Shared UI/theme:

- `src/components`
- `src/context/ThemeContext.tsx`
- `src/theme`

Types:

- `src/types/index.ts`

Auth/core:

- `src/screens/auth/AuthScreens.tsx`
- `src/screens/user/ProfileScreen.tsx`
- `src/lib/core.ts`

Transactions:

- `src/screens/transactions/Add.tsx`
- `src/screens/transactions/Transactions.tsx`
- `src/screens/transactions/TransactionDetail.tsx`
- `src/lib/core.ts`

Finance/accounts:

- `src/screens/financial/FinancialScreens.tsx`
- `src/screens/financial/BankConfigScreen.tsx`
- `src/screens/financial/DetectedAccountsScreen.tsx`
- `src/screens/financial/BankAutoDetectScreen.tsx`
- `src/lib/database/financial.ts`
- `src/lib/services/balanceViewModel.ts`
- `src/lib/services/accountRemoval.ts`

Automation/parsing/evidence:

- `src/screens/financial/SMSTestScreen.tsx`
- `src/lib/processors/TransactionProcessors.ts`
- `src/lib/processors/TransactionQueue.ts`
- `src/lib/services/smsParser.ts`
- `src/lib/services/balanceParser.ts`
- `src/lib/services/automaticTransactionPolicy.ts`
- `src/lib/services/transactionIntelligence.ts`
- `src/lib/services/transactionEvidence.ts`
- `src/lib/services/runtimeTransactionEvidence.ts`
- `src/lib/services/balanceSignalRecorder.ts`

Cache/events/offline:

- `src/lib/services/cache.ts`
- `src/lib/services/dataEvents.ts`
- `src/lib/services/userScopedQueues.ts`

People/places:

- `src/screens/people/PeopleScreen.tsx`
- `src/screens/places/PlacesScreen.tsx`
- `src/screens/reminders`
- `src/lib/database/userdata.ts`
- `src/lib/services/placeReminders.ts`
- `src/lib/services/geofenceProcessor.ts`

Vault:

- `src/screens/vault/SecureVaultScreen.tsx`
- `src/lib/database/vaultDb.ts`
- `src/utils/encryption.ts`
- `src/lib/services/vaultSecurity.ts`

Debt Freedom:

- `src/screens/financial/DebtFreedomScreen.tsx`
- `src/lib/services/debtFreedom.ts`
- `src/lib/services/debtFreedomViewModel.ts`
- `src/lib/services/debtFreedomSettings.ts`

Porter/delivery diagnostics:

- `src/screens/porter/PorterTestScreen.tsx`
- `src/lib/services/porter.ts`
- `src/lib/services/deliveryDebugBlackBox.ts`
- `android/app/src/main/java/com/spendsense/PorterAccessibilityService.kt`
- `android/app/src/main/java/com/spendsense/PorterModule.kt`

Backend/schema:

- `supabase-fresh-setup.sql`
- `supabase`

Tests:

- `__tests__`
- `*.test.ts`
- `*.test.tsx`
- `*.test.js`
- `jest.setup.js`
- `jest.config.js`

## Mental Model

Think of SpendSense as four connected layers:

1. Product screens: Dashboard, Add, Transactions, People, Vault, Settings,
   finance setup, places, reminders, Debt Freedom, and Porter tools.
2. Local runtime: cache, offline queues, event bus, route hints, startup repair,
   permissions, and background prefetch.
3. Financial intelligence: parsers, transaction policy, balance detection,
   evidence capture, account matching, income review, debt planning, and
   duplicate safety.
4. Durable backend/native layer: Supabase Auth/Postgres/RLS/Storage/RPCs plus
   Android receivers, services, permissions, accessibility, overlays, and
   secure-window behavior.

Most difficult bugs happen at layer boundaries: stale cache after a write, live
SQL drifting from local SQL, parser evidence becoming a fake transaction, raw
diagnostic data leaking, native replay duplicating financial records, or UI
claiming success before a durable mutation actually happened.

The safest debugging posture is:

```text
Understand the data boundary.
Preserve privacy.
Verify ownership.
Keep cache and source of truth aligned.
Avoid invented financial side effects.
Prove risky behavior with focused tests or runtime checks.
```
