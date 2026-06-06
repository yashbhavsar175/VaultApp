## AUDIT SUMMARY
- Total Issues Found: 32
- Critical: 1 | High: 11 | Medium: 14 | Low: 4 | Info: 2
- Coverage: audited the full `src/` inventory (`160` files: `158` code/test files and `2` assets), Android config, root SQL, env/gitignore/docs, and project hygiene. Repeated issues are consolidated instead of duplicated for every occurrence.
- Baseline verification: `npx tsc --noEmit` passed, `npx eslint . --quiet` passed, `npm audit --omit=dev --json` and `npm audit --json` both reported 0 vulnerabilities.
- Limit: deployed Supabase RLS/table state was not live-verified because no callable Supabase schema tool was exposed in this session; SQL findings are from local migration/setup files.

## CRITICAL ISSUES (Fix immediately)
1. File: `android/gradle.properties:53-56`
   Category: Security / Project Hygiene
   Severity: Critical
   Description: Release signing keystore metadata and passwords are in a tracked file (`git ls-files` includes `android/gradle.properties`). Attack vector: anyone with repository access can sign a malicious APK/update if the corresponding keystore is also obtained, and the password itself is already compromised if this file was ever pushed or shared.
   Fix: rotate the Android upload key/password in Play Console if this repository has left your machine, remove the secret lines from tracked `android/gradle.properties`, load signing values from an untracked `local.properties` or environment variables, and stop tracking the secret-bearing file (`git rm --cached android/gradle.properties` after moving non-secret settings elsewhere). Do not print or reuse the current password.

## HIGH SEVERITY ISSUES
1. File: `src/lib/core.ts:38-42`
   Category: Security
   Severity: High
   Description: Supabase auth sessions are persisted directly through `AsyncStorage`. On Android this is not secure storage; a rooted/compromised device, debug backup path, or malicious local access can recover refresh tokens and keep a finance session alive.
   Fix: provide a Supabase storage adapter backed by `react-native-encrypted-storage` or `react-native-keychain`; migrate existing `supabase.auth.token` values; clear both secure and legacy AsyncStorage keys on logout.

2. File: `src/utils/encryption.ts:26,57-60,80-83`; `src/lib/database/vaultDb.ts:89-100,120-125`
   Category: Security
   Severity: High
   Description: Vault encryption derives the key from the user id with a static salt and only 5000 PBKDF2 iterations, then uses AES-256-CBC without authentication. Attack vector: if Supabase rows are leaked, the user id is not a secret, so vault entries can be brute-forced or tampered with without AEAD/MAC protection.
   Fix: use a random per-user vault key stored in Android Keystore/EncryptedStorage after biometric/PIN unlock, migrate rows to AES-GCM or ChaCha20-Poly1305, add versioned ciphertext headers, and reject unauthenticated legacy ciphertext unless explicitly migrating.

3. File: `src/lib/services/cache.ts:104-139,305-355`; `src/screens/auth/AuthScreens.tsx:141-142,185-186,395-396,445-446`
   Category: Security / Privacy
   Severity: High
   Description: Financial cache data, profile hints, login flags, and background user ids are stored in AsyncStorage. Attack vector: local storage extraction exposes transaction history, bank account metadata, people ledger data, places, and account identifiers even when the app is logged out.
   Fix: use encrypted storage for sensitive cache keys, shorten TTLs, keep only non-sensitive summaries in plaintext, and clear per-user financial caches during logout/account deletion.

4. File: `src/lib/services/notifications.ts:444,457,543-565`; `src/lib/privacy/rawText.ts:48-60,84-105`
   Category: Security / Privacy
   Severity: High
   Description: failed-SMS notifications redact body text but still put raw `sender` in visible notification body/data and bug-report storage. Attack vector: a phone number, sender id, app package, or other identifying sender leaks through notification shade, Notifee payloads, and debug reports.
   Fix: add and reuse a public `sanitizeSenderForDisplay` helper; store only sender kind/suffix/hash in notification body/data and `debug_bug_reports`; add regression tests where sender is a phone number and package name.

5. File: `App.tsx:141-152`
   Category: Bug / Data Integrity
   Severity: High
   Description: app startup runs a "one-time cleanup" that mutates every logged-in user's transaction notes containing words like deposited/credited/received. This is not gated by a migration marker and updates by id only. A legitimate note can be silently corrupted every time the app starts.
   Fix: remove this runtime mutation. If cleanup is still needed, make it an explicit SQL migration/RPC with `user_id` ownership, idempotent audit logging, and a rollback path.

6. File: `src/lib/core.ts:77-84`; `src/screens/transactions/Add.tsx:284-287,407-413`; `supabase-fresh-setup.sql:1891-1903`
   Category: Bug / UX
   Severity: High
   Description: the manual parser can classify entries as `transfer`, but the Add screen does not expose transfer endpoints and calls `addTransaction` with no `from_account_id`/`to_account_id`. The DB transfer trigger requires both endpoints, so a parsed transfer can fail with a generic save error.
   Fix: prevent `parseTransactionWithAI`/manual Add from setting `transfer`, or route transfer results into a dedicated transfer form that collects source and destination accounts before insert.

7. File: `src/components/modals/EditTransactionModal.tsx:30-34,136-144`; `src/lib/core.ts:689-701`
   Category: Bug / Security
   Severity: High
   Description: EditTransactionModal allows changing a transaction to `transfer` but does not collect transfer endpoints. `updateTransaction` also accepts arbitrary partial updates without validating positive amounts, note/type/category, or transfer/refund invariants. This can produce DB-trigger failures or invalid non-transfer amounts.
   Fix: remove `transfer` from the edit type picker unless source/destination fields are present, and add service-level validation in `updateTransaction` for amount > 0, allowed type transitions, note/category, and transfer/refund-specific fields.

8. File: `src/screens/transactions/Add.tsx:407-452`; `src/lib/core.ts:398-477`
   Category: Bug / Architecture
   Severity: High
   Description: manual transaction insert and account balance update are two separate client writes using a stale `selectedBank.balance`. If either write races or the second write fails, transactions and account balances diverge.
   Fix: move account-linked transaction creation into a Supabase RPC/SQL transaction or a trigger that updates balances atomically, and make the client refresh from server state after success.

9. File: `src/lib/database/userdata.ts:84-113`; `src/screens/people/PeopleScreen.tsx:863-870`; `supabase-fresh-setup.sql:1811-1832`
   Category: Bug / Data Integrity
   Severity: High
   Description: People Ledger overpayment protection is only client-side. Concurrent payments or direct service calls can insert payments that exceed `remaining_amount`; the trigger only recomputes paid amount and does not enforce `paid_amount <= total_amount`.
   Fix: replace `addPayment` with an RPC that locks the ledger row (`FOR UPDATE`), validates remaining amount, inserts the payment, and returns the updated ledger/payment in one transaction; or add a BEFORE trigger that rejects overpayment.

10. File: `android/app/build.gradle:61,128-137`
   Category: Security / Android
   Severity: High
   Description: release builds are configured with debug signing and R8/ProGuard disabled (`minifyEnabled false`, `shrinkResources false`). Attack vector: release APKs are easier to reverse engineer and may be accidentally shipped under debug signing assumptions.
   Fix: use `signingConfigs.release` fed by secure env/local values, set `enableProguardInReleaseBuilds = true`, enable resource shrinking after R8, and keep required rules only.

11. File: `android/app/src/main/AndroidManifest.xml:11-29,64-75,99-117`
   Category: Security / Android
   Severity: High
   Description: the manifest requests many high-risk permissions (SMS, background location, notification listener, overlay, record audio, camera, full-screen intent) and has exported receivers/services including SMS, boot, geofence, and accessibility surfaces. Attack vector: over-broad permissions increase Play review risk and exported components increase the amount of external input the app must defend.
   Fix: remove unused permissions, gate each sensitive feature with explicit runtime consent, set geofence/boot receivers exported=false unless externally required, protect exported components with platform/custom permissions, and add Android instrumentation tests for rejected external intents.

## MEDIUM SEVERITY ISSUES
1. File: `supabase_credit_cards_tables.sql:55-78`; `supabase_loans_tables.sql:85-108`; `supabase_user_accounts_table.sql:28-30`; `supabase_user_identifiers_table.sql:30-32`; `supabase_migration_identifiers.sql:41-43`; `supabase-people-ledger.sql:54-96`
   Category: Security / Architecture
   Severity: Medium
   Description: older standalone SQL files define UPDATE policies without `WITH CHECK`, while `supabase-fresh-setup.sql` has stronger canonical policies. If an older script is applied independently, ownership enforcement can drift.
   Fix: consolidate to one canonical migration path, add `WITH CHECK` to every UPDATE policy, archive obsolete SQL into `/docs/sql-archive` or remove it, and add SQL tests/advisor checks for every table.

2. File: `src/lib/services/notifications.ts:505-520`; `src/lib/core.ts:627-650`
   Category: Bug
   Severity: Medium
   Description: notification delete directly deletes a transaction and updates cache, while `deleteTransaction` also tombstones reviewed income sources via `markDeletedReviewSources`. Notification deletion can leave income-review state inconsistent.
   Fix: call `deleteTransaction(transactionId)` from the notification action path, or extract a shared deletion service used by both UI and notifications.

3. File: `src/lib/services/notifications.ts:691-853`; `src/lib/processors/TransactionProcessors.ts:759-922,1212-1428,1701-1915`
   Category: Bug
   Severity: Medium
   Description: legacy `processTransactionSMS` inserts directly and does not run the duplicate detection used by the main SMS/notification processors. Re-running the test/legacy path can create duplicates.
   Fix: route legacy/test SMS processing through the same duplicate-check and insert service as `TransactionProcessors`, or add a unique duplicate fingerprint enforced by the database.

4. File: `src/utils/financeSummary.ts:39-44`; `src/screens/Dashboard.tsx:89-124`
   Category: Bug
   Severity: Medium
   Description: month filtering uses device-local `Date` and `getMonth()`. Transactions near UTC/IST month boundaries can be counted in a different month depending on device timezone.
   Fix: centralize month math in a timezone-aware helper for the product timezone (for example Asia/Kolkata) or use explicit UTC month boundaries in Supabase queries.

5. File: `src/lib/database/userdata.ts:194-197,263-294`; `src/screens/people/PeopleScreen.tsx:632-634,795-811`
   Category: Bug / UX
   Severity: Medium
   Description: date-only strings are parsed with `new Date('YYYY-MM-DD')`, which JavaScript treats as UTC, then normalized with local `setHours`. Due dates can shift by timezone and user-entered date formats are not validated.
   Fix: store dates as date-only strings, parse with a dedicated `parseLocalDateOnly` helper, validate input format before save, and format consistently with `en-IN`/IST.

6. File: `src/lib/core.ts:582-593`; `src/screens/Dashboard.tsx:234`; `src/screens/transactions/Transactions.tsx:240`
   Category: Performance
   Severity: Medium
   Description: `getTransactions()` loads all transaction rows with `.select('*')` and no pagination. Dashboard and transaction list both depend on it, so startup and tab navigation will degrade as history grows.
   Fix: add paginated queries for list screens, server-side month queries for dashboard, explicit column lists, and indexes on `user_id`, `created_at`, `type`, and duplicate-fingerprint fields.

7. File: `src/lib/database/financial.ts:79,293,405,579`; `src/lib/processors/TransactionProcessors.ts:776-857`; `src/lib/database/userdata.ts:39,141,325`; `src/lib/database/vaultDb.ts:71`; `src/lib/services/balanceViewModel.ts:803-898`
   Category: Performance / Security
   Severity: Medium
   Description: many data services use `.select('*')`, fetching more data than each UI needs and increasing privacy blast radius if logs/cache/errors expose returned rows.
   Fix: define column constants per view model and select only the fields needed by that screen/service.

8. File: `App.tsx:156-199`; `src/lib/processors/TransactionProcessors.ts:960-965`; `src/lib/services/balanceSignalRecorder.ts:748-753`; `src/screens/user/Settings.tsx:410`; `src/lib/services/placeReminders.ts:51-353`; `src/lib/services/geofencingNative.ts:21-42`
   Category: Security / Code Quality
   Severity: Medium
   Description: production code has many `console.log/warn/error` calls. Some logs include bank/account labels, amounts, balances, ids, and debug state. Logs can leak through logcat, crash reports, and support screenshots.
   Fix: introduce a production-safe logger that is gated by `__DEV__` or log level, redacts ids/amounts/senders by default, and fails tests when raw sensitive patterns are logged.

9. File: `src/navigation/BottomTabNavigator.tsx:132`; `src/components/modals/QuickAddModal.tsx:295-436`; `src/components/modals/EditTransactionModal.tsx:30-34,252-575`; `src/screens/intro/AppIntroScreen.tsx:136-307`; `src/screens/vault/SecureVaultScreen.tsx:31-36,492-760`; `src/screens/financial/BankConfigScreen.tsx:107-1459`
   Category: UX / Code Quality
   Severity: Medium
   Description: many screens/components use hardcoded hex/rgba colors instead of the theme. Dark mode and contrast can drift, and future theme changes will miss these surfaces.
   Fix: move semantic colors into `ThemeContext`, replace literals with `colors.*`, and allow exceptions only for documented brand/status tokens.

10. File: `src/screens/Dashboard.tsx:516-725`; `src/screens/people/PeopleScreen.tsx:519-699,751-982`; `src/screens/places/PlacesScreen.tsx:302-518`; `src/components/modals/EditTransactionModal.tsx:170-500`; `src/components/modals/MapPickerModal.tsx:146-193`
    Category: UX / Accessibility
    Severity: Medium
    Description: many `TouchableOpacity` controls, especially icon-only buttons, lack `accessibilityLabel`/`accessibilityRole`. Screen-reader users cannot reliably identify actions like edit, delete, close, remind, or month navigation.
    Fix: require `accessibilityRole="button"` and descriptive labels for all touchables; add lint/test coverage for icon-only controls.

11. File: `App.tsx:569-585`; project-wide
    Category: Code Quality / Reliability
    Severity: Medium
    Description: there is no global React error boundary around navigation. Unexpected render errors can crash the app without a recovery UI or privacy-safe crash capture.
    Fix: wrap the authenticated/unauthenticated app tree in an ErrorBoundary with a safe retry screen, redact error metadata, and add Sentry/Crashlytics only after privacy rules are defined.

12. File: `App.tsx:95-113`; `src/navigation/BottomTabNavigator.tsx:36-76`; `src/navigation/SettingsStack.tsx:24`; `src/lib/processors/TransactionQueue.ts:7-59`; `src/lib/core.ts:749-915`; `src/lib/services/porter.ts:44-46,918-2261`
    Category: Code Quality
    Severity: Medium
    Description: `any` and `@ts-ignore` are used in app code, including navigation, queue processing, notification payloads, and large services. This hides malformed payloads and makes parser/notification regressions harder to catch.
    Fix: add typed navigation params, typed Notifee/native payload adapters, replace `Record<string, any>` with discriminated unions, and remove `@ts-ignore` by typing the target APIs.

13. File: `src/lib/services/porter.ts`; `src/screens/financial/FinancialScreens.tsx`; `src/lib/processors/TransactionProcessors.ts`; `src/screens/user/Settings.tsx`; `src/screens/financial/BankConfigScreen.tsx`; `src/screens/people/PeopleScreen.tsx`; `src/screens/transactions/Add.tsx`
    Category: Architecture
    Severity: Medium
    Description: multiple production files are far above 300 lines (`porter.ts` 2937, `FinancialScreens.tsx` 2580, `TransactionProcessors.ts` 1823, `Settings.tsx` 1629, `BankConfigScreen.tsx` 1398, etc.). Business logic, UI, native integration, and debug code are mixed together.
    Fix: split into hooks, view models, services, and focused components; keep screen files mostly layout/orchestration; move parser/accounting logic into tested pure modules.

14. File: `README.md:54`; root SQL/docs
    Category: Project Hygiene / Architecture
    Severity: Medium
    Description: README points developers to `src/lib/supabase.ts`, which does not exist, and the root contains 23 markdown files plus 40 root SQL files. This makes it easy to apply stale setup instructions or obsolete SQL.
    Fix: update README to current `src/config/index.ts`/`src/lib/core.ts`, create `/docs` and `/supabase/migrations` ownership rules, and archive/delete superseded root SQL.

## LOW / INFO
1. File: `.env`; `.gitignore:82-88`; `.env.example:2-8`; `src/config/index.ts:18-32`
   Category: Security
   Severity: Low
   Description: `.env` contains real project values but is ignored by `.gitignore`, while `.env.example` uses placeholders. This is acceptable locally, but any paste/share of `.env` would expose Supabase, Gemini, Google, and Maps credentials.
   Fix: keep `.env` untracked, never paste it into issues/docs, rotate any value that has been shared, and consider using per-environment secret injection for CI/release.

2. File: root workspace (`hs_err_pid*.log`, `replay_pid*.log`)
   Category: Project Hygiene
   Severity: Low
   Description: crash/replay logs are present in the repository root. Even if untracked, these files add noise and may contain paths, memory snippets, or runtime details.
   Fix: delete local crash/replay artifacts after triage and add explicit ignore rules for `hs_err_pid*.log` and `replay_pid*.log`.

3. File: `src/screens/people/PeopleScreen.tsx:110-113`; `src/screens/transactions/Add.tsx:462-468`; `src/screens/places/PlacesScreen.tsx:85-97`
   Category: UX
   Severity: Low
   Description: several error paths show generic alerts without retry context or cause-specific copy. Users cannot tell whether the issue is validation, network, auth, or server state.
   Fix: standardize error copy through a helper that maps auth/network/validation/server errors to user-safe text and exposes retry where useful.

4. File: `CHANGELOG.md`
   Category: Project Hygiene
   Severity: Low
   Description: no changelog file is present. With many SQL/app behavior changes, release-risk tracking is harder.
   Fix: add `CHANGELOG.md` or a release-notes doc with schema/app/runtime sections and link it from README.

5. File: `supabase-fresh-setup.sql:28-34,365-384,1079-1150,1195-1201,1513-1519`; local SQL functions from `supabase_detected_accounts_rpc.sql:21-22,276-277,518-519,750-751,895-896`
   Category: Security
   Severity: Info
   Description: the canonical fresh setup enables RLS on the core tables inspected and uses ownership checks. RPC/function scans show `SECURITY INVOKER` with `SET search_path = public, pg_temp` on the high-risk local RPCs.
   Fix: preserve this pattern and verify the deployed database with Supabase advisors or direct catalog queries before release.

6. File: project checks
   Category: Project Hygiene
   Severity: Info
   Description: TypeScript, ESLint quiet mode, and both prod/all dependency audits passed in this audit pass.
   Fix: keep these in the pre-release bundle; add focused tests for the high/medium findings above.

## MISSING FEATURES ASSESSMENT
- Offline support: partial. Transaction create/delete queues exist (`src/lib/core.ts:831-959`, `src/lib/services/userScopedQueues.ts`), but people, places, vault, account edits, and reconciliation flows do not have complete offline UX or conflict handling. Most impactful missing offline work is a unified offline banner plus per-feature retry queues.
- Data export: missing for ordinary finance data. Porter/debug export exists, but user transaction/ledger/account CSV/PDF export was not found. This is high user value for a personal finance app.
- Budget limits: not implemented as a first-class feature; only notification copy references budget alerts. Add monthly/category budgets with warning thresholds.
- Recurring transactions: not implemented for salary, rent, subscriptions, or EMIs as reusable rules. Add recurrence rules and a review-before-posting flow.
- Search: transaction display helpers support searchable text internally, but the transaction list does not expose debounced note/category/payee search. Add debounced search plus server-side filtering for large histories.
- Biometric lock: available for login hints and the vault, but not as an app-wide privacy lock. Add app-level biometric/PIN lock on resume.
- Currency formatting edge cases: INR formatting utilities exist, but several screens use fixed text sizes and inline INR strings; test crores/large balances on small devices.
- Deep linking: no `NavigationContainer` linking config is present in `App.tsx:569`. Notification actions are handled internally, but external links are not a structured route surface.
- App update prompt: no update-check/prompt mechanism was found.
- Crash reporting: no Sentry/Firebase Crashlytics/AppCenter dependency was found. Add only with privacy-safe scrubbing and user consent rules.

## TOP 5 PRIORITY FIXES
1. Rotate/remove tracked Android signing secrets and move all release signing config to secure local/env storage.
2. Replace Supabase session and sensitive cache persistence with encrypted storage; clear legacy AsyncStorage keys on logout/account deletion.
3. Rework vault encryption to use a real per-user/device secret and authenticated encryption.
4. Remove the startup transaction-note mutation and repair any affected rows through a deliberate, audited migration only if needed.
5. Make money-moving writes atomic: manual transactions plus bank balances, people ledger payments, transfer creation/editing, and notification deletes should go through shared validated services/RPCs.
