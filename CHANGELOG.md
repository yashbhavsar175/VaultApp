# Changelog

All notable changes to VaultApp are documented here.

---

## [Unreleased]

### Fixed — Phase 1: Critical Bugs (continued)

- **CRITICAL** `encryption.ts` + `vaultDb.ts`: PBKDF2 migration now actually triggers.
  Added `VAULT_FIELD_CURRENT_PREFIX = 'vault:v2:'` — `encryptField` stamps this prefix on all
  new encryptions, making legacy `iv:ciphertext` values distinguishable without ambiguity.
  `decryptField` fast-paths `vault:v2:` values through the random key with no legacy fallback.
  `needsReEncryption()` exported for callers to detect legacy values.
  `vaultDb.ts getVaultItems` now fires `migrateVaultItemsToCurrentKey` in the background on every
  fetch — legacy fields are decrypted via the PBKDF2 path and re-persisted as `vault:v2:` format
  in Supabase; subsequent loads skip the legacy path entirely. Also narrowed `select('*')` on vault
  items to the 7 columns actually used.

### Fixed — Phase 1: Critical Bugs

- **CRITICAL** `TransactionProcessors.ts`: `JSON.parse(taskData.notification)` now wrapped in
  try/catch — malformed notification payloads (truncated system events, third-party bank apps) no
  longer crash the background processor and drop subsequent SMS events
- **CRITICAL** `notifications.ts ~787`: Transaction classification override now calls
  `supabase.auth.getUser()` and filters by `user_id` before updating — defense-in-depth
  ownership enforcement at the app layer in addition to RLS
- **CRITICAL** `encryption.ts`: Added `PBKDF2_ITERATIONS_LEGACY = 5_000` constant (frozen for
  backward compat); legacy key path now emits `console.warn` instead of `console.log` with a
  re-encryption hint; added `reEncryptFieldWithCurrentKey()` export for callers to migrate vault
  items from the legacy key to the current random per-user key
- **CRITICAL** `core.ts ~809`: `findDuplicateLinkedRefundTransaction` replaced full-table scan
  (`getTransactions()` → JS `.find()`) with a targeted Supabase query filtered by
  `user_id + type + refund_of_transaction_id + amount` — eliminates N+1 memory spike and fixes
  missed duplicates for users with > 1 000 transactions

### Fixed — Phase 2: High Severity Bugs

- **HIGH** `core.ts ~344`: `updateTransactionsCache` now serialises reads+writes through a
  promise-chain lock (`_transactionCacheWriteLock`) — prevents concurrent callers (addTransaction,
  syncOfflineTransactions, AppState, network reconnect) from interleaving and corrupting the cache
- **HIGH** `cache.ts`: Added `clearUserCache(userId)` that clears only the departing user's cache
  keys; `App.tsx markUnauthenticated()` now calls it instead of `clearCache()` — prevents stale
  financial data from a previous user briefly appearing to the next user on a shared device
- **HIGH** `userScopedQueues.ts`: `quarantineLegacyQueue` now purges old quarantine keys before
  writing a new one, capped at `MAX_QUARANTINE_KEYS = 3` — prevents unbounded AsyncStorage growth
  that could cause silent write failures after weeks of use
- **HIGH** `supabase/functions/parse-transaction`: `verifyAuthenticatedRequest` now returns
  `{ authorized, userId }` instead of a boolean; added `checkAndIncrementRateLimit` (50 calls /
  hour per user via `parse_transaction_rate_limits` table); returns HTTP 429 when limit exceeded
- **HIGH** `supabase/migrations/20260628_parse_transaction_rate_limits.sql`: New migration creates
  the rate-limit table with RLS restricted to the service role
- **HIGH** `ProfileScreen.tsx`: `select('*')` on `profiles` narrowed to the four columns the
  screen actually reads (`full_name, phone, monthly_budget, currency`)
- **HIGH** `core.ts`: Duplicate `import 'react-native-url-polyfill/auto'` removed (was imported
  twice — once in the header comment block, once below it)

### Fixed — Phase 3: Medium + Low Bugs

- **MEDIUM** `cache.ts ~239`: Error Toast removed from `prefetchBalanceViews` — new users with no
  accounts no longer see "Balance refresh failed" on first login before they've opened the balance
  screen; failure is now a silent `__DEV__` warning
- **MEDIUM** `cache.ts`: Removed unused `import Toast from 'react-native-toast-message'`
- **MEDIUM** `src/components/ScreenErrorBoundary.tsx`: New per-screen error boundary component
  using `useTheme()` — wrapping individual screens prevents a single-screen crash from locking the
  entire app; shows a localized "Try Again" card instead of a full-screen error
- **MEDIUM** `components/index.ts`: Exports `ScreenErrorBoundary`
- **MEDIUM** `App.tsx`: `toastConfig` moved from a static module-level object (hardcoded dark
  colors) to a `ThemedToast` component rendered inside `ThemeProvider` that calls `useTheme()` —
  toast colors now adapt to the user's light/dark preference
- **MEDIUM** `core.ts`: `console.log('[AIParser] Edge failed...')` wrapped in `__DEV__` guard
- **MEDIUM** `TransactionDetail.tsx ~1089, 1100`: Two `console.log` calls in the test alarm path
  wrapped in `__DEV__` guard; bare `console.log` in catch block converted to `console.warn`
- **MEDIUM** `core.ts ~998`: `OfflineQueueEntry` and `OfflineDeleteQueueEntry` replaced with
  properly typed `OfflineTransactionQueueEntry` and `OfflineDeleteQueueEntryObject` interfaces;
  `[key: string]: unknown` index signature preserves spread/destructure compatibility
- **LOW** `config/index.ts`: `requireEnv()` helper replaces `!` non-null assertions on all three
  environment variables — throws a clear, actionable error message if a key is missing in CI or
  a fresh dev setup
- **LOW** `config/index.ts`: Dead `FEATURES.SMS_AUTO_CAPTURE: false` flag removed — SMS capture
  is fully operational via background listeners and the flag was never read anywhere
- **LOW** `Settings.tsx`: `bugReports` state typed with `BugReportEntry` interface instead of
  `any[]` — prevents malformed AsyncStorage entries from crashing the bug report modal render
