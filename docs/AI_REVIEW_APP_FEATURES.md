# SpendSense (VaultApp): Current Feature Map and AI Review Brief

## Purpose of this document

This document explains the current app behavior in enough detail for a code-review AI to understand the product before looking for bugs.

The repository name is `VaultApp`, while the user-facing app name is `SpendSense`.

This is a source-based description of the current checkout. It is not proof that every SQL script has been deployed to the live Supabase project. A reviewer must verify deployed SQL, RPC functions, RLS policies, and Android runtime behavior separately when reviewing those surfaces.

## 1. Product summary

SpendSense is a React Native personal-finance app designed primarily for Indian users and INR-based money tracking. It combines:

- Manual and automatically detected transactions.
- Bank account, credit card, debit card, and loan setup.
- SMS and Android notification parsing.
- A review queue for financial messages that should not be posted automatically.
- Balance snapshot history and manual balance corrections.
- Income review for ambiguous incoming money.
- Account reconciliation proposals based on sanitized evidence.
- A people ledger for money lent and borrowed.
- A client-side encrypted secure vault.
- Saved places and location utilities.
- Debt-repayment planning.
- Optional Android delivery-driver tools, including Porter distance diagnostics and accessibility-based overlays.

The app is safety-oriented. It should prefer a missing transaction that can be reviewed later over a fabricated or incorrectly classified financial record.

## 2. Main technology and architecture

### Client

- React Native CLI application.
- TypeScript.
- React Navigation with bottom tabs and nested stacks.
- Android-native modules and services for SMS, notifications, boot events, accessibility, overlay behavior, and background processing.
- AsyncStorage for cache-first loading, local preferences, and local review or retry queues.

### Backend

- Supabase authentication.
- Supabase Postgres database.
- Row Level Security (RLS) for per-user data ownership.
- Supabase Storage for saved-place photos.
- SQL functions, triggers, and RPCs for mutation safety and derived financial updates.

### Important architectural rule

Supabase is the durable data source. Local cache is a performance and offline layer. Screens often load cached data first and refresh from Supabase in the background.

Reviewers should not replace this with reload-heavy behavior unless there is a clear product reason. Cache updates, invalidation, and background refresh behavior are part of the correctness contract.

### Useful starting files

- `App.tsx`
- `src/navigation/BottomTabNavigator.tsx`
- `src/navigation/DashboardStackNavigator.tsx`
- `src/navigation/SettingsStackNavigator.tsx`
- `src/lib/services/cache.ts`
- `src/lib/services/dataEvents.ts`
- `src/lib/core.ts`
- `supabase-fresh-setup.sql`

## 3. App startup, authentication, and onboarding

### Startup flow

The root app performs:

- Intro animation display.
- Supabase session restoration.
- Cached profile lookup for a faster initial route decision.
- Live profile verification after the cached result.
- Startup timeout and repair handling if authentication or cache restoration stalls.
- Google Sign-In initialization.
- Offline queue synchronization when connectivity returns or the app becomes active.
- Background cache prefetch.
- Native notification and transaction processor initialization.
- Porter distance calculator registration.

The app should avoid leaving the user permanently stuck on startup if session restoration or profile loading fails.

### Authentication

Supported entry methods include:

- Email and password sign in.
- Email and password sign up.
- Terms and privacy acceptance during account creation.
- Google sign in and sign up.
- Biometric quick-login support for a returning user when the local session state allows it.

### Profile completion

After authentication, incomplete users are sent to profile completion. The profile stores:

- Full name.
- Optional phone number.

The profile cache is intentionally privacy-reduced. It should not preserve unnecessary identity fields locally.

### Startup repair

The startup repair surface allows the user to recover from local session or cache problems. A reviewer should check:

- Timeout behavior.
- Route loops.
- Cached-profile and live-profile disagreement.
- Sign-out cleanup.
- Whether local repair leaves stale queues or identity-bearing cache entries behind.

### Whole-account deletion

Settings contains an account deletion flow that removes user-owned app data and place photos before sign-out. A reviewer must confirm that every newer table is included and that the user-facing wording accurately describes what is deleted.

Also verify whether Supabase Auth account deletion is truly completed or whether support action is still required.

## 4. Navigation map

### Main bottom tabs

The app has five primary tabs:

1. Dashboard
2. Add
3. People
4. Vault
5. Settings

### Dashboard stack

The Dashboard stack exposes:

- Dashboard home.
- Banks overview.
- Bank and card configuration.
- Detected accounts review.
- Legacy bank auto-detection.
- SMS parser testing.
- Transactions list.
- Analytics.
- Transaction detail.

### Settings stack

The Settings stack exposes:

- Settings home.
- Banks overview.
- Bank and card configuration.
- Detected accounts review.
- SMS parser testing.
- Reconciliation proposals.
- Debt Freedom Coach.
- Income Review.
- Places.
- Porter test tools.

### Root-level screens

The root navigator also includes:

- Main tabs.
- Porter test screen.
- Places.
- Review Queue.

## 5. Dashboard

The Dashboard is the primary financial overview.

### Dashboard behavior

- Loads data using cache-first behavior.
- Supports month selection.
- Shows financial summary cards.
- Shows income, expenses, investments, and EMI information.
- Shows a people-ledger summary for active money lent.
- Links to transactions and analytics.
- Includes a Quick Add entry point.
- Shows review banners when incoming financial movements need user decisions.
- Hides sensitive financial content when the app is backgrounded.

### Monthly calculation intent

The summary distinguishes:

- Reviewed income.
- Gross expenses.
- Refund adjustments.
- Net expenses.
- Investments.
- EMI payments.
- Monthly balance.

Refunds should reduce spending rather than appear as ordinary income.

Self-transfers should not inflate income or expense totals.

Unreviewed ambiguous credits should not appear as earned income.

### Review-banner intent

Dashboard can direct the user to:

- Income Review for unclear credits.
- Review Queue for transaction classifications that need an explicit user choice.

## 6. Manual Add and Quick Add

### Manual Add screen

The Add tab supports creating transactions manually.

Common behavior includes:

- Amount entry.
- Transaction type selection.
- Category selection.
- Notes.
- Account selection or Cash.
- Date selection.
- Save to Supabase when online.
- Local offline queueing when needed.
- Cache update after creation.
- Bank balance adjustment where applicable.

The visible manual type chooser currently focuses on:

- Income.
- Expense.
- Investment.
- EMI.
- Lent.

The broader transaction model also understands classes such as transfer, refund, and borrowed money. A reviewer should check that the UI, parser, types, backend constraints, and analytics all agree on which types are supported in each workflow.

### Quick Add

Dashboard Quick Add provides a faster natural-language flow.

It supports:

- Typed input.
- Voice input.
- Local NLP parsing.
- Parsed amount, type, category, and note preview.
- Save and cache refresh.
- User-facing warnings when input is malformed or ambiguous.

Some warning enhancement behavior can use a configured Gemini API key. A reviewer should inspect:

- Whether secrets are bundled into the client.
- Exactly which user-entered text can leave the device.
- Whether the app clearly communicates that behavior.
- Whether sensitive financial text is minimized before any outbound request.

The standard parser remains local-first. A function name containing `AI` does not necessarily mean a remote model is used.

## 7. Transactions list and detail

### Transactions list

The Transactions screen supports:

- Cache-first list loading.
- Filtering by financial type.
- Opening transaction details.
- Editing transactions.
- Long-press selection.
- Bulk deletion.
- Refresh after mutations.

Relevant filters include:

- All.
- Income.
- Expense.
- Refund.
- Investment.
- EMI.
- Transfer.

### Transaction detail

Transaction detail can show:

- Core transaction fields.
- Source trace.
- Evidence metadata.
- Account match.
- Direction.
- Source app or package.
- Sender information.
- Masked UPI identifiers.
- Reference identifiers.
- Balance-after evidence.
- Whether the transaction is counted in Dashboard totals.

Raw SMS or notification content should not be displayed or logged. Evidence must remain sanitized.

## 8. Automatic SMS and notification transaction tracking

This is one of the highest-risk areas of the app.

### Native Android entry points

The Android app includes background and native components for:

- SMS receive and read permissions.
- SMS receiver.
- Headless JavaScript processing.
- Notification listener service.
- Boot receiver.
- Background processing service.
- User-facing transaction notifications.

### Detection policy

The app should automatically post only sufficiently clear events, such as:

- Clearly earned credits.
- Recognized merchant expenses.

Potentially ambiguous events should enter Review Queue instead of being posted as normal transactions.

### Important classification families

The transaction intelligence layer can distinguish:

- Bank debit.
- Bank credit.
- Credit card spend.
- Credit card bill payment.
- Loan EMI payment.
- Loan disbursal.
- UPI payment.
- UPI received.
- Refund.
- Cashback or reward.
- Cash deposit.
- Cash withdrawal.
- Personal transfer.
- Reimbursement.
- Borrowed money.
- Debt repayment.
- Wallet load.
- Self-transfer.
- Non-transaction.
- Unknown financial message.

### Do not invent transactions

These signals must not create ordinary financial transactions automatically:

- Balance-only SMS.
- Statement summaries.
- Payment reminders.
- Unclear incoming credits.
- Self-transfers.
- Refunds without the required linking decision.
- Card bill payments.
- EMI events that need loan context.
- Messages without enough confidence.

### Evidence and privacy

Runtime evidence should be sanitized before storage. Reviewers should look for:

- Redacted previews.
- Stable fingerprints for replay protection.
- Masked account or card identifiers.
- Hashed or reduced identifiers where appropriate.
- No raw SMS body.
- No raw notification text.

### Key source areas

- `src/lib/processors/TransactionProcessors.ts`
- `src/lib/services/notifications.ts`
- `src/lib/services/automaticTransactionPolicy.ts`
- `src/lib/services/transactionIntelligence.ts`
- `src/lib/services/autoTransactionReviewQueue.ts`
- `src/lib/services/transactionEvidence.ts`
- Android native receiver and listener files under `android/`

## 9. Review Queue

Review Queue exists so that ambiguous financial events are not silently misclassified.

### Common actions

The user can:

- Review a redacted event.
- Choose a supported posting route.
- Ignore the event.
- Leave unsupported items unposted.

### Ordinary supported routes

Depending on classification, an eligible reviewed event may become an ordinary:

- Expense.
- Income.

Examples include merchant debit, UPI payment, credit card spend, bank credit, UPI received, and cashback or reward.

### Specialized routes

Some classes must not become ordinary income or expense transactions.

#### Credit card bill payment

- Must post into the credit-card payment flow.
- Must use a configured credit card.
- Must not become ordinary expense or income.

#### EMI payment

- Must post into the loan EMI flow.
- Must be associated with a configured loan.
- Must preserve principal and interest behavior.
- Must not become a generic transaction if the loan context is missing.

#### Self-transfer

- Must create a neutral transfer.
- Requires two distinct eligible savings or current accounts.
- Must not increase income or expense.
- Must remain duplicate-safe.

#### Refund

- Must link to an eligible original expense.
- Must not exceed the refundable amount.
- Must not become ordinary income.
- Must remain duplicate-safe.

### Duplicate safety

Reviewers should test:

- Reopening the same item.
- Retrying after a slow network response.
- App restarts during submission.
- Offline-to-online replay.
- Native message replay.
- Duplicate evidence fingerprints.

## 10. Accounts, cards, loans, and balances

### Cards and Accounts

The finance setup area manages:

- Bank accounts.
- Credit cards.
- Debit cards.
- Loans.
- UPI identifiers.

### Bank accounts

Common bank-account fields include:

- Bank name.
- Account type.
- Last four digits.
- Starting or current balance.
- Display state.

Canonical bank account types include:

- Savings.
- Current.

Reviewers should treat `checking` as stale terminology if it appears.

### Credit cards

Credit card features include:

- Card setup.
- Masked card identity.
- Credit limit.
- Outstanding amount.
- Available credit.
- Utilization.
- Due-date and statement-related information.
- Card transactions.
- Card payment processing.

### Loans

Loan features include:

- Loan setup.
- Loan amount.
- Outstanding amount.
- EMI amount.
- EMI payment history.
- Principal and interest components.
- Outstanding-balance updates.

### Debit cards

Debit card records can be detected and linked to bank accounts. Reviewers should verify ownership and linking constraints.

### Balance snapshots

Balances are evidence separate from transactions.

Snapshot sources can include:

- SMS.
- Notification.
- Calculated value.
- Manual correction.
- Review.
- Import.

Snapshot kinds can include:

- Available balance.
- Current balance.
- Outstanding.
- Available limit.
- Credit limit.
- Due amount.
- Minimum due.
- Loan outstanding.

### Balance history and corrections

The balance-history UI shows a timeline with source, confidence, and freshness context.

A manual correction changes the displayed balance state. It must not create a fake income or expense transaction.

### Safe account removal

Per-account removal is separate from whole-app account deletion.

The app should:

- Inspect linked history before destructive removal.
- Hard-delete only when safe.
- Archive or hide records when the deployed schema supports it.
- Restore hidden records where supported.
- Avoid changing transaction history or balances merely to make removal easier.

Reviewers must check source SQL and deployed SQL together because archive columns and RPC support can drift.

## 11. Automatic balance detection and detected accounts

Balance-signal detection is separate from transaction creation.

### Automatic balance signals

SMS and notifications may contain:

- Account balance.
- Card balance.
- Credit limit.
- Due amount.
- Minimum due.
- Statement evidence.
- Account or card last four digits.
- Bank aliases.

The app can record a balance snapshot without inventing a transaction.

### Detected Accounts review

The app can hold pending detected candidates for:

- Bank accounts.
- Credit cards.
- Debit cards.
- Loans.

The user can review candidates and:

- Confirm a new supported account.
- Link or merge with an existing supported account.
- Ignore a candidate.

Confirming or merging should preserve owner checks and safely copy applicable snapshot history.

Loan confirmation is currently a review area: detection can exist even when full confirmation behavior is intentionally unsupported.

### Legacy SMS scan

The legacy bank auto-detection screen can scan message history, detect known banks and masked account identifiers, and prefill or create setup data.

Reviewers should compare legacy scanning behavior with newer pending-detection flows to find duplicate or inconsistent paths.

## 12. Analytics

Analytics provides financial summaries over selectable ranges such as:

- Week.
- Month.
- Three months.
- Year.

It can show:

- Income.
- Spending.
- Investments.
- EMI.
- Net savings or outflow.
- Account-balance context.
- Auto-tracked transaction count.
- Category summaries.
- Trends.
- Financial health score and metadata.
- Insights and actions.

Reviewers should verify that:

- Refunds reduce spending.
- Transfers remain neutral.
- Unreviewed credits remain excluded from earned income.
- Deleted or edited transactions refresh charts.
- Month boundaries and timezone conversions are correct.

## 13. People ledger

The People tab tracks interpersonal lending and borrowing.

### Supported behavior

- Money lent.
- Money borrowed.
- Active and settled records.
- One-time payments.
- Installment schedules.
- Due dates.
- Payment history.
- Record payment.
- Settle.
- Delete.
- Overdue and due-today calculations.
- WhatsApp reminder shortcut.
- Scheduled local notifications.

The Dashboard focuses primarily on active money lent.

Reviewers should test:

- Partial payments.
- Final-payment settlement.
- Installment date generation.
- Timezone boundaries.
- Notification cleanup after settlement or deletion.
- Cache and backend consistency.

## 14. Secure Vault

The Vault stores sensitive personal secrets.

### Vault categories

Examples include:

- Bank PIN.
- UPI PIN.
- Card details.
- Netbanking details.
- App password.
- Other custom secrets.

### Security behavior

- Requires biometric unlock when supported.
- Clears decrypted state when leaving the screen or backgrounding the app.
- Encrypts sensitive fields client-side before Supabase storage.
- Uses AES-256-CBC for stored fields.
- Avoids retaining decrypted Vault content in the normal app cache.

### High-priority security review points

Reviewers should inspect:

- Key derivation from Supabase user ID and the fixed salt.
- Whether a stronger user-controlled or device-bound master key is needed.
- Backward compatibility behavior for values that do not look encrypted.
- Direct access behavior on devices without biometric support.
- App switcher, screenshots, logs, clipboard, and error reporting.
- Whether IV handling and encryption failure behavior are safe.
- Whether any Vault secret enters AsyncStorage, analytics, or debug export.

## 15. Places

The Places feature stores useful locations.

### Supported categories

- Shop.
- EV charging.
- Cafe.
- ATM.
- Mechanic.
- Other.

### Supported behavior

- Add, edit, and delete a place.
- Get current GPS location.
- Drag a pin on a map.
- Reverse-geocode coordinates.
- Use satellite map mode.
- Capture or choose a photo.
- Upload photos to the `place-photos` storage bucket.
- Open a map.
- Open a Google Street View link.

Reviewers should inspect:

- Location permission handling.
- Camera permission handling.
- Storage RLS.
- Photo cleanup after place deletion and whole-account deletion.
- Precise coordinate exposure to external reverse-geocoding or map services.

## 16. Debt Freedom Coach

Debt Freedom Coach is a planning tool, not a credit-score product and not an automatic transaction mutator.

### Inputs and settings

The user can configure:

- Income mode.
- Confirmed or estimated income.
- Essential monthly expenses.
- Emergency monthly contribution.
- Target income.
- Planned monthly debt payment.
- Target debt-free month count.
- Strategy preference.

Strategies include:

- Balanced.
- Snowball.
- Avalanche.

### Outputs

The coach can calculate:

- Total debt.
- Estimated debt-free date or duration.
- Daily target.
- Monthly pace.
- Safe-spend guidance.
- Free cash flow after debt.
- Minimum debt payment.
- Debt-to-income ratio.
- Prioritized debt list.

### Warning conditions

The coach can warn about:

- Missing income.
- Estimated income.
- Small income sample.
- Low buffer.
- Missing interest rates.
- Possible duplicate debts.
- Stale or low-confidence balances.
- Hidden debts.
- High debt-to-income ratio.
- Unreachable target.

Changing coach targets may write coach settings. It must not fabricate transactions or alter actual balances.

## 17. Income Review

Income Review handles incoming money that should not automatically count as earned income.

### Why it exists

An incoming credit may be:

- Salary.
- Freelance income.
- Business income.
- Gig income.
- Refund.
- Borrowed money.
- Self-transfer.
- Cash deposit.
- Reimbursement.
- Something unclear.

The app should not assume that every credit is income.

### User decisions

The user can:

- Count the movement as income.
- Mark it as not income.
- Keep reviewing later.

For eligible evidence-only events, a reviewed income decision can create safe history without modifying account balances again.

Debt Freedom Coach can use these reviewed decisions when estimating income.

## 18. Reconciliation Proposals

Reconciliation tries to attach existing transaction evidence to the correct existing account. It must not create invented normal transactions.

### Evidence foundation

Relevant concepts include:

- Transaction evidence.
- Account-app mappings.
- Proposal generation.
- Confidence.
- Match reason.
- Bank-proof strength.

### Confirm Match

The proposals screen can offer an explicit Confirm Match action only when the proposal is eligible.

Confirmable proposals should require sufficiently strong evidence, such as exact and high-confidence bank proof.

### Critical rule

UPI-only or payment-app-only evidence is not bank proof.

These cases should remain blocked or review-required:

- UPI handle only.
- Payment app only.
- Ambiguous account.
- Medium confidence without required proof.
- Low confidence.
- Missing owner-safe account relationship.

The confirm RPC should attach an existing transaction, account, and evidence relationship. It should not fabricate money movement.

## 19. Settings and diagnostics

### User settings

Settings includes:

- Profile display.
- Name editing.
- Theme selection: light, dark, or system.
- Password change.
- Sign out.
- Whole-account deletion.

### Finance and data links

Settings links to:

- Cards and Accounts.
- Bank setup.
- SMS parser test.
- Reconciliation Proposals.
- Debt Freedom Coach.
- Income Review.
- Review Queue.
- Places.

### Test and debug tools

The app includes development and diagnostic behavior such as:

- Test notifications.
- SMS parser samples.
- Custom SMS parser testing.
- Dummy transaction seeding.
- Review Queue seeding.
- Bug report view.
- Bug report export.
- Bug report clearing.
- Delivery debug controls.

A reviewer should check whether any debug or seed behavior needs stronger release gating.

## 20. Android permissions and background services

The Android app requests or uses permissions and services for:

- Internet.
- Wake lock.
- Vibration.
- Notifications.
- Audio.
- Bluetooth connection.
- Foreground services.
- SMS receive and read.
- Boot completion.
- Location.
- Audio recording.
- Camera.
- Biometrics.
- Overlay display.
- Accessibility service.

Permission prompts should be staged and explain why access is needed.

Reviewers should test:

- Denied permission behavior.
- Revoked permission behavior.
- Android version differences.
- Headless task replay.
- Background execution.
- Boot restart behavior.
- Notification channel behavior.
- Privacy-safe logging.

Most automatic SMS, notification, and delivery features are Android-specific even though the repository also contains iOS project files.

## 21. Porter and delivery-driver tools

The app contains optional Android-specific delivery tools, especially for Porter-style workflows.

### Accessibility-based screen reading

The native accessibility service can:

- Observe relevant screen events.
- Extract visible delivery text.
- Use OCR fallback where applicable.
- Buffer events if JavaScript is not active.
- Send events to JavaScript processing.

### Distance calculation

The JavaScript service can:

- Parse pickup and drop information.
- Check current-location freshness.
- Use address-string-first routing.
- Use Google Distance Matrix where configured.
- Apply geocoding and route fallbacks.
- Fall back to approximate distance when needed.
- Prevent stale calculation results from replacing newer results.

### Overlay behavior

The overlay must distinguish:

- Pending calculated distance.
- Normal calculated result.
- Approximate result.
- Unavailable result.

SpendSense-calculated distance should remain visibly separate from values shown by the delivery app itself.

### Delivery debug mode

Settings can expose:

- Accessibility status.
- Overlay permission status.
- Debug-mode start and end.
- Floating issue marker.
- Volume-button guard behavior.
- Pinned incident.
- Recent events.
- Distance summary.
- Last detected delivery app.
- Log export.
- Log clear.
- Porter test screen.

### Privacy boundary

Delivery diagnostics must not retain:

- Customer name.
- Phone number.
- Address.
- OTP.
- Raw accessibility screen text.

Reviewers should inspect every native and JavaScript logging path because accessibility data is highly sensitive.

## 22. Cache, offline behavior, and refresh events

### Cache-first behavior

The app uses AsyncStorage cache keys for common areas such as:

- Transactions.
- People ledger.
- Places.
- Bank accounts.
- Categories.
- Profile.
- Ledger payments.

### Privacy reductions

Cached data should be reduced where necessary:

- Raw SMS information should be redacted.
- Profile cache should avoid unnecessary phone, email, and full-profile payloads.
- Vault cache should be purged rather than prefetched.

### Offline and event-driven refresh

The app includes:

- Offline queue sync.
- Foreground sync.
- Network reconnect sync.
- Area-based refresh events.
- Cache write-through behavior after mutations.

Reviewers should test:

- Online success.
- Offline save.
- App restart while offline.
- Reconnect sync.
- Duplicate sync.
- Stale cache after mutation.
- Multiple screens observing the same data.
- User switch or sign-out cache cleanup.

## 23. Database surface

The SQL setup and modular SQL scripts define or reference tables such as:

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

Storage includes the `place-photos` bucket.

The SQL surface also includes triggers, policies, or RPC behavior for:

- Per-user ownership checks.
- Refund-link validation.
- Evidence timestamps and ownership.
- Income-review validation.
- Balance updates.
- Card outstanding updates.
- Loan outstanding updates.
- EMI calculations.
- Ledger paid-amount updates.
- Transfer balance updates.
- Safe account removal.
- Detected-account confirm, merge, and ignore.
- Transaction-account reconciliation.

Reviewers must compare:

- `supabase-fresh-setup.sql`
- Modular `supabase_*.sql` scripts
- Client calls
- Generated Supabase types
- The actually deployed Supabase project

A green local TypeScript or Jest run does not prove that deployed SQL functions work.

## 24. Financial and privacy invariants

Treat the following as acceptance criteria.

### Financial correctness

- A balance message must not invent a transaction.
- A manual balance correction must not invent a transaction.
- A statement summary must not invent a transaction.
- An ambiguous credit must not count as earned income until reviewed.
- A refund must reduce spending and must not become ordinary income.
- A self-transfer must remain neutral.
- A credit-card bill payment must not become ordinary expense or income.
- An EMI payment must preserve loan-specific behavior.
- Duplicate native events, retries, and queue replays must not create duplicate financial records.
- Account removal must not silently destroy financial history.

### Privacy

Do not expose or retain raw:

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

Use masked, redacted, hashed, or reduced forms where evidence is required.

### Security and ownership

- RLS should isolate every user-owned table.
- RPCs should validate ownership internally.
- Storage paths and policies should isolate user photos.
- Client cache must be cleared correctly on sign-out and user changes.
- Encrypted Vault values must remain encrypted before remote storage.

## 25. High-priority review hotspots

Ask the reviewer to inspect these areas carefully:

1. Compare parallel transaction-processing paths for behavior drift: SMS processor, notification processor, headless tasks, review queue, and legacy helpers.
2. Test replay and duplicate behavior after slow responses, offline sync, native retries, and app restarts.
3. Confirm that balance-only messages never create income or expense.
4. Verify refund, transfer, card-payment, and EMI calculations across Dashboard, Analytics, account balances, and deletion.
5. Check whether newer database tables are included in whole-account deletion.
6. Compare fresh-setup SQL, modular SQL migrations, client calls, generated types, and deployed Supabase functions.
7. Review the parallel account models: legacy account types in `bank_accounts` versus separate `credit_cards` and `loans` tables.
8. Review account archive and restore behavior when deployed schema support differs.
9. Audit Vault key derivation, biometric fallback, plaintext backward compatibility, and decrypted-state cleanup.
10. Search all UI, cache, debug, export, native logs, and error reports for sensitive data leaks.
11. Confirm that Gemini-assisted warning behavior does not leak financial text or bundle a secret unsafely.
12. Confirm that external map and reverse-geocoding requests minimize precise-location exposure.
13. Review Porter accessibility events, OCR output, overlays, incident capture, and export for privacy leaks and stale-result races.
14. Test route recovery during auth startup timeout, cached-profile disagreement, sign out, and account deletion.
15. Check that debug seeding and test tools cannot affect real user data accidentally in production.
16. Check date, month-boundary, and timezone handling in Dashboard, Analytics, people-ledger due dates, EMI, and balance history.
17. Confirm that read-only proposals remain read-only until a clearly eligible explicit confirmation.
18. Confirm that UPI-only evidence never becomes authoritative bank-account proof.

## 26. Recommended review workflow

### Phase 1: Static map

1. Read `codex_context.md`.
2. Read `App.tsx` and navigation files.
3. Map each user-visible screen to its services and SQL calls.
4. Map every write operation, local queue, cache update, and event emission.
5. List security boundaries and financial invariants before editing code.

### Phase 2: Focused audits

1. Audit authentication, cache cleanup, and user switching.
2. Audit transaction ingestion and duplicate safety.
3. Audit review-only versus mutation flows.
4. Audit calculations and balance updates.
5. Audit RLS, RPC ownership checks, and storage policies.
6. Audit privacy across logs, UI, cache, exports, and native services.
7. Audit Vault cryptography.
8. Audit Android lifecycle, permissions, and native background behavior.

### Phase 3: Verification

Run:

```powershell
npx tsc --noEmit
npx eslint . --quiet
npx jest --runInBand
```

For Android-native changes, also compile and perform emulator or physical-device smoke testing.

For SQL, RLS, or RPC work, verify the live Supabase state directly. Do not trust repository SQL alone.

For runtime QA that uses seeded data:

- Tag temporary records.
- Avoid real user data.
- Verify backend cleanup.
- Clear relevant local AsyncStorage or `RKStorage` artifacts.
- Confirm final temporary-record count is zero.

## 27. Copy-paste prompt for an AI code reviewer

Use the prompt below with this document and the repository:

```text
You are reviewing SpendSense (repository name: VaultApp), a React Native CLI + Supabase personal-finance app for Indian users.

Read AI_REVIEW_APP_FEATURES.md first. Then inspect the actual source. Do not assume README files or SQL setup files are fully current. Treat the source, deployed Supabase state, and Android runtime behavior as separate things that may drift.

Your task is review-only first. Do not modify code until I approve a fix plan.

Prioritize:
1. Financial correctness bugs.
2. Privacy leaks.
3. Security and RLS ownership mistakes.
4. Duplicate or replay bugs.
5. Cache-first and offline-sync inconsistencies.
6. Android native lifecycle and permission problems.
7. SQL, RPC, generated-type, and client-contract drift.
8. Date, timezone, and month-boundary bugs.
9. UI states that mislead the user about what was actually saved.
10. Missing tests around high-risk paths.

Important invariants:
- Never invent transactions from balance-only messages, statements, reminders, or unclear signals.
- Do not count unclear incoming credits as earned income until reviewed.
- Refunds reduce spending and are not ordinary income.
- Self-transfers are neutral.
- Credit-card bill payments and loan EMIs use their specialized routes.
- UPI-only or payment-app-only evidence is not bank proof for reconciliation.
- Confirm Match may attach an existing eligible transaction to an existing eligible account; it must not fabricate money movement.
- No raw SMS, notification text, OTP, phone number, address, full account/card number, full email, raw profile payload, Vault secret, or raw accessibility screen text should leak into UI, logs, cache, exports, or bug reports.
- Preserve cache-first behavior and verify cache invalidation after mutations.

Inspect at minimum:
- App.tsx and navigation.
- src/lib/services/cache.ts and src/lib/services/dataEvents.ts.
- SMS, notification, transaction intelligence, automatic policy, evidence, and Review Queue services.
- Dashboard, Add, Quick Add, Transactions, Analytics, account setup, detected accounts, balance history, Review Queue, Income Review, Reconciliation Proposals, Debt Freedom Coach, People ledger, Vault, Places, and Settings screens.
- AndroidManifest.xml and native Android receivers, listeners, accessibility services, overlays, and headless tasks.
- supabase-fresh-setup.sql, modular supabase_*.sql files, generated types, RLS policies, triggers, and RPC calls.

For every finding, report:
- Severity: Critical, High, Medium, or Low.
- User impact.
- Exact file and line number.
- Why the current behavior is wrong.
- A small reproducible scenario.
- The smallest safe fix.
- Tests or runtime checks required.

Separate confirmed bugs from open questions. List the highest-risk findings first. Mention areas you could not verify live.
```

