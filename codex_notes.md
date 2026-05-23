# Codex Notes

Use this file as the running task log for SpendSense/VaultApp. After each task, append:

- Summary
- Changed files
- Test results
- Remaining risks

## Task 8B - Real SMS Transaction Runtime Verification

### Summary

- Launched SpendSense on the connected Android device.
- Confirmed `SmsReceiver` is registered in the installed package.
- Confirmed `READ_SMS` and `RECEIVE_SMS` are granted for the active user.
- Checked logcat for `SmsReceiver`, `SMS Body`, `SmsProcessorTask`, `SMS Processor Started`, parser, duplicate, transaction success, ANR, JS crash, and native crash signals.
- No `SmsReceiver` or SMS Headless JS logs appeared in the available logcat buffer.
- Local `cache_transactions` count was `0`, so no SMS-created transaction landed in the cache during the observed run.
- Dashboard opened without crash, but there was no SMS transaction update to verify.

### Changed Files

- None.

### Test Results

- `npx tsc --noEmit`: passed.
- `npx eslint . --quiet`: passed.
- `npx jest --runInBand`: passed.

### Remaining Risks

- Real SMS delivery to the app is still unconfirmed because the manually received SMS did not appear in the observed `SmsReceiver` or JS Headless logs.
- Parser extraction, duplicate prevention, and Dashboard update for a real SMS could not be confirmed without a fresh SMS arriving while logcat is actively streaming.
- Next runtime check should receive a fresh real bank/UPI SMS while filtering logcat for `SmsReceiver|SMS Body|SMS Processor Started|Transaction processed successfully`.

## Task 8C - Emulator SMS Transaction Flow

### Summary

- Confirmed Android emulator `emulator-5554` was available.
- Installed the SpendSense debug APK on the emulator with `./gradlew.bat :app:installDebug --console=plain`.
- Granted `READ_SMS`, `RECEIVE_SMS`, and `POST_NOTIFICATIONS`.
- Injected the requested SMS with `adb emu sms send HDFCBK "...UPI Ref no 123456789012."`.
- Confirmed native `SmsReceiver` received the SMS and logged the body.
- Confirmed JS Headless `SmsProcessorTask` ran and logged `SMS Processor Started`.
- Confirmed parser extracted amount `50`, type `debit`, source `bank`, sender `HDFCBK`, and account hint `1234`.
- Found a real parser bug: `UPI Ref no 123456789012` was parsed as reference `no`.
- Confirmed transaction creation succeeded once with id `b0871bd0-1d55-457f-80fe-65c01be203ce`.
- Injected the same SMS again and confirmed `Duplicate transaction detected - skipping`.
- Confirmed local cache contained exactly one transaction after duplicate injection.
- Confirmed Dashboard showed May 2026 monthly balance `-₹50`, income `₹0`, and expense `₹50`.
- Fixed the parser reference extraction to capture long references after labels like `UPI Ref no`, `UTR`, `RRN`, `Ref`, `Transaction ID`, and `TXN ID`.

### Changed Files

- `src/lib/processors/TransactionProcessors.ts`
- `codex_notes.md`

### Test Results

- `npx tsc --noEmit`: passed before the parser fix.
- `npx tsc --noEmit`: passed after the parser fix.
- `npx eslint . --quiet`: passed.
- `npx jest --runInBand`: passed.
- Android emulator install: passed.
- Android emulator SMS injection: passed for the original requested SMS.
- Android duplicate injection: passed; second copy was skipped.

### Remaining Risks

- The first transaction was created before the parser fix, so its stored `reference_number` is `no`.
- A post-fix runtime SMS using a new reference was attempted, but the emulator repeatedly killed `com.spendsense` under low-memory pressure before JS processing completed. The patch is covered by TypeScript/lint/Jest, but the corrected reference extraction was not fully re-proven on-device after reinstall.
- The emulator has only about 2 GB RAM and logcat showed `lowmemorykiller` killing `com.spendsense`; use a higher-memory emulator or lower background load for the next post-fix runtime verification.

## Task 8D - Clean Post-Fix SMS Parser Verification

### Summary

- Confirmed emulator `emulator-5554` was available.
- Checked emulator memory before runtime testing; status was normal.
- Closed unnecessary emulator apps, reinstalled the current debug APK, granted SMS permissions, and launched SpendSense.
- Baseline local cache had `0` transactions with `reference_number` `123456789012`.
- Injected the requested SMS with `adb emu sms send HDFCBK "...UPI Ref no 123456789012."`.
- Confirmed native `SmsReceiver` received and logged the SMS body.
- Confirmed JS Headless SMS processor received the payload and logged `SMS Processor Started`.
- Confirmed parser extracted amount `50`, type `debit`, source `bank`, sender `HDFCBK`, account hint `1234`, and reference `123456789012`.
- Confirmed exactly one transaction was created for `reference_number` `123456789012`: `cedcdea5-0119-46a6-90dd-055444ea3892`.
- Injected the same SMS again and confirmed `Duplicate transaction detected - skipping`.
- Confirmed local cache still had exactly one transaction with `reference_number` `123456789012` after the duplicate injection.
- Opened Dashboard and confirmed May 2026 expense/monthly balance reflected cached expenses. The visible expense was `₹151`, matching the three cached emulator test expenses.
- Scanned logcat for ANR, fatal JS/native crash, permission denial, input dispatch timeout, and low-memory kill patterns; none were found during this clean run.

### Changed Files

- `codex_notes.md`

### Test Results

- Android debug reinstall: passed.
- SMS permission grant/check: passed.
- Emulator SMS injection: passed.
- Native `SmsReceiver` delivery: passed.
- JS Headless SMS processor delivery: passed.
- Parser reference extraction: passed; `UPI Ref no 123456789012` produced `123456789012`.
- Transaction creation: passed; exactly one corrected-reference row was created.
- Duplicate prevention: passed; second identical SMS was skipped.
- Dashboard/cache update: passed; Dashboard matched cached May expense total.
- Static TypeScript/lint/Jest were not rerun in Task 8D because no app source code was changed in this task. They passed after the Task 8C parser fix.

### Remaining Risks

- The emulator still contains old test rows, including the pre-fix bad reference row with `reference_number` `no`; this affects aggregate Dashboard totals but not the corrected-reference verification.
- Merchant extraction for this sample still reads `your HDFC Bank account XX1234`, which may be acceptable for now but is less clean than extracting `UPI-GOOGLEPAY`.

## Task 9 - App-Wide Realtime Finance UI Refresh

### Summary

- Added a tiny typed in-memory finance data event service.
- Emit `finance:dataChanged` style events after successful transaction/cache updates from manual add, SMS parser, notification parser, core transaction add/update/delete, offline transaction sync, offline delete sync, and notification delete action.
- Dashboard subscribes while focused and debounces refresh through its existing silent cache-first loader.
- Transactions screen subscribes while focused and debounces `getTransactions()` reload.
- Bank/account screens and analytics subscribe while focused for account/transaction-affecting updates.
- People screen subscribes to ledger-scoped events for future ledger emitters without refreshing on unrelated transaction events.
- Cache writes remain passive; `setCache` and `updateCache` do not emit, preventing refresh loops.
- Android emulator SMS test: Dashboard was open at May expense `₹151`; injected `₹53` SMS with reference `333456789012`; Dashboard updated in place to `₹204`.
- Duplicate SMS test: same SMS was injected again; log showed `Duplicate transaction detected - skipping`; Dashboard stayed at `₹204`; cache had exactly one row for `333456789012`.
- Transactions screen showed the new `-₹53` SMS transaction.
- Manual Add test: added a `₹7` expense from the Add tab; Dashboard updated to `₹211`; Transactions screen showed the new `-₹7` row.

### Changed Files

- `src/lib/services/dataEvents.ts`
- `src/lib/core.ts`
- `src/lib/processors/TransactionProcessors.ts`
- `src/lib/services/notifications.ts`
- `src/screens/Dashboard.tsx`
- `src/screens/transactions/Add.tsx`
- `src/screens/transactions/Transactions.tsx`
- `src/screens/financial/FinancialScreens.tsx`
- `src/screens/financial/BankConfigScreen.tsx`
- `src/screens/people/PeopleScreen.tsx`
- `codex_notes.md`

### Test Results

- `npx tsc --noEmit`: passed before changes.
- `npx tsc --noEmit`: passed after changes.
- `npx eslint . --quiet`: passed.
- `npx jest --runInBand`: passed.
- Android debug reinstall: passed.
- Android emulator launch: passed.
- Emulator SMS injection: passed.
- Dashboard live update from SMS without navigation: passed.
- Duplicate SMS prevention and UI stability: passed.
- Transactions screen visibility for new SMS transaction: passed.
- Manual Add transaction Dashboard/Transactions update: passed.
- Logcat crash scan: no ANR, JS crash, native crash, low-memory kill, or refresh-loop errors found.

### Remaining Risks

- The event bus is in-memory only, so it updates screens while the JS runtime is alive. Cold-start catch-up still relies on the existing cache-first load and Supabase refresh.
- Credit card and loan summary screens listen only where they share the existing financial/account screens; deeper card/loan-specific transaction screens may still need targeted listeners if they are added or found stale later.
- Existing emulator cache contains old test rows, so aggregate Dashboard totals include previous Task 8 test data.

## Task 9 Review - Finance Event Refresh Safety Check

### Summary

- Reviewed only Task 9 related files.
- Confirmed `dataEvents.ts` is small, typed, in-memory only, and does not store vault or secret data.
- Confirmed cache helpers do not emit events, so cache writes cannot create refresh loops.
- Confirmed duplicate SMS/notification paths return before any finance event is emitted.
- Confirmed transaction add/update/delete, SMS/notification transaction creation, offline transaction sync, and offline delete sync emit only after successful write/cache update branches.
- Confirmed screens subscribe inside `useFocusEffect`, so listeners are removed on blur/unmount.
- Confirmed Dashboard still uses the existing debounced silent refresh and in-flight guard.
- Confirmed People screen listens only for `ledger` events, so transaction events do not cause aggressive People reloads.
- Confirmed financial account screens listen only for account-relevant events; analytics listens for transaction/account events.
- Android runtime review: Dashboard updated in place from `₹211` to `₹270` after a `₹59` emulator SMS with reference `444456789012`.
- Duplicate SMS was skipped and Dashboard stayed at `₹270`; cache had exactly one row for `444456789012`.
- Transactions screen showed the new `-₹59` SMS transaction.
- Manual add of `₹8` with note `Review9Manual` updated Dashboard to `₹278` and appeared in Transactions.
- Navigated across Dashboard, Transactions, People, and Settings; app stayed alive.
- Logcat scan found no ANR, JS crash, native crash, low-memory kill, maximum update depth, too-many-renders, or `FinanceDataEvents` listener failure.

### Changed Files

- `codex_notes.md`

### Test Results

- `npx tsc --noEmit`: passed.
- `npx eslint . --quiet`: passed.
- `npx jest --runInBand`: passed.
- Android debug reinstall: passed.
- Android emulator SMS live Dashboard update: passed.
- Duplicate SMS prevention: passed.
- Transactions screen update: passed.
- Manual Add transaction update: passed.
- Repeated navigation/logcat smoke: passed.

### Remaining Risks

- The event bus is intentionally in-memory; updates while the JS runtime is stopped still rely on existing cache-first startup refresh.
- Pending debounced refresh timers are cleared on unmount; if a screen blurs but remains mounted, a previously scheduled refresh may still complete once. In runtime testing this did not produce warnings, loops, or crashes.
- The Notifee delete action still relies on Supabase/RLS for ownership and was not refactored in this review.

## Task 10 - Premium Intro Planning

### Summary

- Read `codex_context.md` and inspected `App.tsx`, `RootNavigator.tsx`, theme loading, package dependencies, and Android resources.
- Found the current app already has a lightweight JS splash/loading screen in `App.tsx`.
- Found no dedicated native Android splash assets beyond launcher resources.
- Recommended inserting the intro at the root `App.tsx` startup gate, before the current Login/Profile/Main routing decision, so Supabase auth/profile initialization can continue behind the intro.
- Recommended a smallest-safe first implementation using built-in React Native `Animated` plus existing `react-native-svg` and `react-native-linear-gradient`, with a static/reduce-motion fallback. Among new package options, Reanimated is the safest future upgrade; Lottie/Rive are asset-driven; Skia is highest risk for startup complexity.

### Changed Files

- `codex_notes.md`

### Test Results

- `npx tsc --noEmit`: passed.

### Remaining Risks

- Current `App.tsx` calls `checkProfile(initialSession.user.id)` without awaiting it before clearing `loading`, so a future intro implementation should make auth/profile route readiness explicit before hiding the intro.
- Adding Rive, Lottie, Reanimated, or Skia would require native Android rebuild/testing and could introduce startup risk.
- A fully native splash would require Android theme/resource work; the planned intro is an in-app intro after RN starts.

## Task 11 - Premium Lightweight Animated Intro

### Summary

- Added a self-contained `AppIntroScreen` using React Native `Animated`, existing `react-native-linear-gradient`, and existing `react-native-svg`.
- Replaced the inline `App.tsx` splash with an `authReady` + `introDone` startup gate.
- Auth/profile work starts in parallel with the intro animation.
- Fixed the startup profile race by awaiting profile status before marking auth routing ready.
- Prevented the intro from fading to a blank screen while auth/profile readiness is still pending.
- Added reduced-motion handling through `AccessibilityInfo`.
- Added a Jest-only static intro path so tests do not leave animation timers running after teardown.
- Added bounded startup fallback behavior: session load has a wider timeout, profile lookup falls back conservatively to profile setup when uncertain.
- Android emulator smoke: intro appeared, did not hang, and routed to Login on the logged-out emulator. Cold launch was tested twice.

### Changed Files

- `App.tsx`
- `src/screens/intro/AppIntroScreen.tsx`
- `codex_notes.md`

### Test Results

- Before changes: `npx tsc --noEmit` passed.
- After changes: `npx tsc --noEmit` passed.
- `npx eslint . --quiet` passed.
- `npx jest --runInBand` passed.
- Android `:app:installDebug` passed.
- Android cold launch smoke passed on `emulator-5554`.
- Android route result: logged-out emulator reached Login after intro.
- Android logcat: no ANR, fatal JS crash, or native crash found.

### Remaining Risks

- The emulator did not have an active Supabase session, so the logged-in Dashboard route was preserved in code but not live-verified in this run.
- Development logcat still shows existing/new-architecture warnings, including `react-native-svg` codegen warnings and native event emitter warnings. They did not crash the app, but they can trigger the dev warning toast.
- On a very slow or broken Supabase session load, startup falls back to logged-out after the bounded timeout instead of staying on the intro forever.

## Task 11A - Emergency Login Regression Fix

### Summary

- Read `codex_context.md` and inspected the Task 11 startup/auth changes, intro screen, auth screens, Supabase client setup, Google Sign-In flow, and profile setup flow.
- Found the Task 11 routing risk: auth-state changes waited on an unbounded profile lookup before setting the authenticated route, so a successful login could remain visually stuck on the auth screen if the profile query was slow or hung.
- Found a second startup risk during Android testing: `supabase.auth.getSession()` can be slow on the emulator, and the intro could remain visible unless the app has its own fallback.
- Added bounded startup/session fallback behavior that shows the logged-out route after a short session-load timeout but still recovers a late persisted Supabase session into the authenticated route.
- Added bounded profile checks that fail closed to Profile Setup instead of leaving login or startup stuck.
- Added email/password and Google auth button timeout/finally guards so Login/Signup loading spinners clear on failures or timeouts.
- Replaced the SVG-heavy cartoon vault intro with a simpler premium dark gradient/card placeholder using React Native Animated and LinearGradient only; no packages were added.
- Added an App-level intro exit fallback so a missed animation callback cannot trap the app on the intro.

### Changed Files

- `App.tsx`
- `src/screens/auth/AuthScreens.tsx`
- `src/screens/intro/AppIntroScreen.tsx`
- `codex_notes.md`

### Test Results

- Before changes: `npx tsc --noEmit` passed.
- After changes: `npx tsc --noEmit` passed.
- `npx eslint . --quiet` passed.
- `npx jest --runInBand` passed.
- Android `:app:installDebug` passed.
- Android cold launch with existing emulator session: intro exited and routed to Profile Setup; no ANR, fatal JS crash, or native crash.
- Android cold launch after clearing emulator app data: intro exited and routed to Login.
- Android invalid email/password login attempt: Login button returned from loading and displayed `Invalid login credentials`; spinner did not remain stuck.

### Remaining Risks

- I did not have real test credentials, so a successful email/password login could not be completed end-to-end in this run.
- Google Sign-In was not exercised because it depends on an interactive account/device setup.
- On the emulator, session load sometimes exceeded the startup timeout; late-session recovery is in place, but users may briefly see Login before a slow persisted session recovers.
- Development logcat still shows existing React Native New Architecture and NativeEventEmitter warnings. The SVG codegen warning from the old intro path was removed by removing startup SVG usage.

## Task 11B - Stable Profile Routing After Intro/Auth Startup

### Summary

- Read `codex_context.md` and inspected the Task 11A auth/intro routing in `App.tsx`.
- Found the route bug: Task 11A treated profile check timeout/error as `needsProfile = true`, so a slow or uncertain Supabase profile query could incorrectly show Profile Setup.
- Replaced the boolean profile route flag with `profileStatus: unknown | checking | complete | incomplete | error`.
- Profile Setup is now shown only after a successful profile lookup confirms a missing/blank `full_name`.
- Slow or failed profile checks now use a same-user cached complete profile only as a safe route hint; otherwise they show a profile retry screen instead of Profile Setup.
- Added a retry path for profile status errors.
- Kept the intro fallback and auth startup timeout so the app does not stay on the intro forever.
- Excluded unrelated untracked `my-video` Remotion files from the app TypeScript project so VaultApp checks are not broken by files outside the React Native app.
- Android emulator cold launches with an existing session routed to Dashboard twice and did not show the wrong Profile Setup screen.

### Changed Files

- `App.tsx`
- `tsconfig.json`
- `codex_notes.md`

### Test Results

- Before Task 11B changes: `npx tsc --noEmit` failed because unrelated untracked `my-video` Remotion files were included by `tsconfig.json` and referenced packages not installed in VaultApp.
- After changes: `npx tsc --noEmit` passed.
- `npx eslint . --quiet` passed.
- `npx jest --runInBand` passed.
- Android debug build/install was already successful before this verification pass.
- Android emulator `emulator-5554` cold launch with existing session: intro exited and routed to Dashboard.
- Android relaunch verification: Dashboard appeared again; no `Complete Your Profile` screen was observed.
- Android logcat: no ANR, fatal JS crash, or native crash found.

### Remaining Risks

- Supabase `getSession()` and profile lookups still sometimes exceed the dev-emulator startup timeout; the app now avoids the wrong Profile Setup route, but a slow session can still briefly fall back before late-session recovery.
- I did not clear app data in this final pass because the existing authenticated session was needed to verify the completed-profile route.
- I did not test a truly incomplete-profile account because no separate test account was available.
- Existing React Native New Architecture and NativeEventEmitter warnings still appear in dev logcat; they are outside this auth/profile routing fix.

## Task 12 - Porter Accessibility Crash Hardening and Volume Guard Review

### Summary

- Read `codex_context.md` and inspected Android manifest, accessibility config, Porter native bridge, Porter accessibility service, Porter JS service, and Settings toggles.
- Confirmed the app has one SpendSense accessibility service: `com.spendsense/com.spendsense.PorterAccessibilityService`.
- Confirmed Porter is installed on the emulator as `com.theporter.android.driverapp`.
- Reproduced real Porter accessibility events after enabling the service with the fully qualified component name.
- Did not reproduce a fatal native crash during the observed Porter launch, but found the native service had no top-level safety boundary around `onAccessibilityEvent`.
- Hardened the service so unexpected Porter windows, stale/null accessibility nodes, OCR request errors, delayed volume clamps, and React dispatch failures are logged instead of crashing the service.
- Bounded accessibility tree traversal to avoid runaway recursion or huge Porter/Compose window trees.
- Removed aggressive audio route forcing (`isSpeakerphoneOn = false` and `setCommunicationDevice(...)`) from Delivery Volume Guard. That code could plausibly cause the observed few-second music dropouts when delivery apps emit frequent accessibility events.
- Kept Delivery Volume Guard as a volume cap only; it still never forces volume upward.
- Confirmed Swiggy/Zomato matching already exists in the native guard list through package-name substring matching.

### Changed Files

- `android/app/src/main/java/com/spendsense/PorterAccessibilityService.kt`
- `codex_notes.md`

### Test Results

- Before changes: `npx tsc --noEmit` passed.
- After changes: `npx tsc --noEmit` passed.
- `npx eslint . --quiet` passed.
- `npx jest --runInBand` passed.
- Android `:app:installDebug` passed after the native change.
- Android `:app:compileDebugKotlin` passed after the final cleanup.
- Android accessibility service enable check: `Enabled services` contained `com.spendsense/com.spendsense.PorterAccessibilityService`.
- Android Porter launch/runtime smoke: SpendSense process stayed alive, service stayed enabled/bound, and `Crashed services` stayed empty.
- Android logcat: no `FATAL EXCEPTION`, no `AndroidRuntime` crash for SpendSense, and no accessibility service crash in the observed run.

### Remaining Risks

- The exact user crash was not reproduced on the emulator session, so this is a defensive crash hardening fix based on the unsafe native event path.
- Real trip/map/order popup behavior still needs a physical-device test with the user's actual Porter flow.
- Android may reset accessibility permission after reinstall/force-stop or if restricted settings are not allowed; in the emulator, the fully qualified component name was required for adb enabling.
- Delivery Volume Guard can cap stream volume, but Android does not give a normal third-party app reliable control over all media output routing. Preventing sudden speaker output while earphones/Bluetooth are connected needs careful real-device testing and may be limited by Android audio routing policy.
- Swiggy/Zomato package matching exists, but their real delivery screens/audio behavior were not installed or tested on this emulator.

## Task 12A - Porter Accessibility Crash Diagnosis Only

### Summary

- Read `codex_context.md` and kept the scope to diagnosis only.
- Inspected `AndroidManifest.xml`, `accessibility_service_config.xml`, `PorterAccessibilityService.kt`, `PorterModule.kt`, `PorterPackage.kt`, `src/lib/services/porter.ts`, `Settings.tsx`, and the App startup hook that initializes Porter events.
- Confirmed `com.spendsense/com.spendsense.PorterAccessibilityService` is registered, enabled, and bound on emulator `emulator-5554`.
- Launched SpendSense and Porter, dismissed Porter's rooted-device warning, and observed Porter home UI events reaching the SpendSense accessibility service.
- The observed Porter flow did not reproduce "SpendSense keeps stopping"; Android crash buffer was empty for SpendSense and `dumpsys accessibility` showed `Crashed services:{}`.
- Native Porter debug logs showed accessibility event extraction and dispatch to React Native, with no `event_error`, `extract_error`, `dispatch_failed`, or `volume_guard_error` during this run.
- A logcat `IllegalStateException` was present, but it belonged to Gmail sync process `com.google.android.gm`, not SpendSense or Porter.
- Active Porter order/trip popup behavior was not available in this emulator session, so the exact reported trip/map crash remains unproven.

### Changed Files

- `codex_notes.md`

### Test Results

- `npx tsc --noEmit` passed.
- Android emulator available: `emulator-5554`.
- Porter package available: `com.theporter.android.driverapp`.
- SpendSense launched and stayed alive.
- Porter launched and stayed alive.
- Accessibility service was enabled before test: `com.spendsense/com.spendsense.PorterAccessibilityService`.
- Android Accessibility `Crashed services` stayed empty after Porter launch/home navigation.
- Logcat crash buffer had no SpendSense fatal exception.

### Remaining Risks

- No active Porter order/trip screen was available, so the reported crash path may require a real order popup or physical device state.
- Current service listens to `TYPES_ALL_MASK` with interactive window retrieval, so Porter/Compose screens can generate many events; this remains the main static risk area.
- Delivery Volume Guard was enabled on the emulator, but no audio route behavior was tested in this diagnosis-only pass.
- Volume Guard appears separate from the observed crash diagnosis; no AudioManager crash or volume guard error appeared in this run.

## Task 12B - Porter AccessibilityService Crash Hardening

### Summary

- Read `codex_context.md` and kept scope limited to native AccessibilityService crash hardening.
- Hardened `PorterAccessibilityService` against null events, blank package/class names, unsafe event type conversion, missing roots/windows, stale/recycled nodes, OCR request failure, JS dispatch failure, and unexpected Porter/Compose accessibility trees.
- Narrowed heavy Porter processing in code to useful event types: window state changes, window content changes, and view text changes.
- Added a short event throttle for Porter processing and a separate throttle for volume clamp bursts so accessibility event storms do not schedule excessive native work.
- Kept Porter support and existing feature behavior; no Delivery Volume Guard redesign, Swiggy/Zomato work, SQL, Vault, auth, SMS/notification parser, or Dashboard event code was changed.
- Redacted native debug `sample` values to length/hash metadata and sanitized existing stored native debug logs so Porter screen text is not retained in the service debug cache.

### Changed Files

- `android/app/src/main/java/com/spendsense/PorterAccessibilityService.kt`
- `codex_notes.md`

### Test Results

- Before changes: `npx tsc --noEmit` passed.
- After changes: `npx tsc --noEmit` passed.
- `npx eslint . --quiet` passed.
- `npx jest --runInBand` passed.
- Android `:app:installDebug` passed after the native changes.
- Android emulator runtime: SpendSense launched on `emulator-5554`, accessibility service was enabled/bound, Porter launched, Porter home events were processed, and SpendSense stayed alive.
- Android Accessibility `Crashed services` stayed empty after Porter launch and navigation.
- Android crash buffer was empty for SpendSense; filtered logcat showed PorterAccessibility events without `FATAL EXCEPTION`, `AndroidRuntime`, `event_error`, `extract_error`, `dispatch_failed`, `volume_guard_error`, ANR, or native crash.
- Native Porter debug samples now show redacted `len/hash` values instead of raw Porter screen text.

### Remaining Risks

- Active Porter order/trip behavior remains unproven because no active order was available on the emulator.
- The manifest still declares broad accessibility event coverage, but the Kotlin service now ignores non-useful event types before heavy extraction.
- This task did not redesign Delivery Volume Guard, test real audio routing, or add Swiggy/Zomato delivery-app behavior.

## Task 12C - Observe-Only Porter Runtime Test After Accessibility Hardening

### Summary

- Read `codex_context.md` and kept the task observe-only.
- Used Android emulator QA with `emulator-5554`.
- Installed the current debug build and launched SpendSense successfully.
- Confirmed `com.spendsense/com.spendsense.PorterAccessibilityService` was enabled and bound before opening Porter.
- Opened Porter and passively observed the home/online area for roughly three and a half minutes.
- Did not tap Accept, Reject, Cancel, Go Offline, notification, profile, recharge, or any other Porter control.
- No order/offer popup appeared during this observation window.
- Porter accessibility events were processed and dispatched safely; duplicate screen text was suppressed in native logs.
- Android Accessibility Settings showed SpendSense under Downloaded apps with summary `On`, not `Not working`.
- Delivery Volume Guard was enabled and logged volume clamp bursts for Porter, but no volume guard error or crash occurred.

### Changed Files

- `codex_notes.md`

### Test Results

- `npx tsc --noEmit` passed before runtime testing.
- Android `:app:installDebug` passed.
- SpendSense process stayed alive.
- Porter process stayed alive.
- Android Accessibility `Enabled services` contained `com.spendsense/com.spendsense.PorterAccessibilityService`.
- Android Accessibility `Bound services` contained SpendSense.
- Android Accessibility `Crashed services` stayed empty.
- Android crash buffer was empty for SpendSense.
- Filtered logcat showed PorterAccessibility events without `FATAL EXCEPTION`, `AndroidRuntime` crash, `event_error`, `extract_error`, `dispatch_failed`, `volume_guard_error`, ANR, OOM, or low-memory kill.

### Remaining Risks

- No live Porter order/offer popup appeared, so real offer popup and active-trip behavior remain unproven.
- Delivery Volume Guard audio behavior was not audibly verified on this emulator; only native state/logs were checked.
- No app code was changed in this task, so eslint and Jest were not rerun.

## Task 12D - Observe Real Porter Order Event Without Touching Order Actions

### Summary

- Read `codex_context.md` and kept the task observe-only.
- Used Android emulator QA with `emulator-5554`.
- Reinstalled the debug build, launched SpendSense, and confirmed the app started without crashing.
- Confirmed Delivery Volume Guard was enabled, but did not redesign or change it.
- Confirmed `com.spendsense/com.spendsense.PorterAccessibilityService` was enabled and bound before observing Porter.
- Opened Porter and observed the home/order area without touching any live order actions.
- Did not tap Accept, Reject, Cancel, OK, Swipe to Accept, Go Offline, or any other Porter control.
- Porter received real new-order notification events during the observation window, and `PorterAccessibilityService` continued receiving Porter accessibility events.
- A persistent visible order popup was not captured in the sampled UI dumps, so the exact visible popup state remains unproven for this run.
- No `Porter order detected` or trip-distance JS log line was captured in this run.
- Native Porter logs showed OCR fallback failed safely because the service does not have screenshot capability; this did not crash or mark the service malfunctioning.
- Android Accessibility Settings showed SpendSense as `On`, not `Not working`.

### Changed Files

- `codex_notes.md`

### Test Results

- `npx tsc --noEmit` passed before runtime testing.
- Android `:app:installDebug` passed.
- SpendSense process stayed alive.
- Porter process stayed alive.
- Android Accessibility `Enabled services` contained `com.spendsense/com.spendsense.PorterAccessibilityService`.
- Android Accessibility `Bound services` contained SpendSense.
- Android Accessibility `Crashed services` stayed empty.
- Android Settings listed SpendSense Accessibility as `On`.
- Filtered logcat showed Porter accessibility events and real Porter new-order notification events without `FATAL EXCEPTION`, SpendSense `AndroidRuntime` crash, ANR, `event_error`, `extract_error`, `dispatch_failed`, or `volume_guard_error`.
- Native logs showed volume guard clamp activity for Porter without `volume_guard_error`.

### Remaining Risks

- This run observed real order-notification state but did not capture a persistent visible order popup in the sampled UI dump.
- Trip distance calculation start was not confirmed because no `Porter order detected` or calculation log appeared during this run.
- OCR fallback currently fails safely when screenshot capability is unavailable; if the feature depends on OCR for some Porter screens, that path still needs product-level handling.
- Delivery Volume Guard audio behavior was not audibly verified on the emulator.
- No app code was changed in this task, so eslint and Jest were not rerun.

## Task 13A - Delivery Volume Guard Diagnosis Only

### Summary

- Read `codex_context.md` and kept the task diagnosis-only.
- Used Android emulator QA with `emulator-5554`.
- Inspected the native Volume Guard implementation in `PorterAccessibilityService.kt`, the React Native bridge in `PorterModule.kt`, the JS wrapper in `src/lib/services/porter.ts`, Settings toggle UI in `src/screens/user/Settings.tsx`, `App.tsx`, and Android manifest permissions.
- Confirmed Delivery Volume Guard is implemented inside `PorterAccessibilityService`, not as a separate Android service.
- Confirmed Settings toggles the native guard through `PorterModule.setVolumeGuardEnabled(...)` and captures caps through `refreshVolumeGuardCaps(...)`.
- Confirmed Volume Guard uses Android `AudioManager` stream volume APIs only; current code does not pause media, request audio focus, abandon audio focus, force speakerphone, or call `setCommunicationDevice(...)`.
- Confirmed current guarded package matching already includes `porter`, `swiggy`, `zomato`, `blinkit`, `zepto`, `dunzo`, `rapido`, `shadowfax`, `uber`, and `ola` by package-name substring.
- Confirmed Porter is supported by package name for Volume Guard; Porter screen text is used separately for trip-distance extraction.
- Confirmed the guard stores caps for `STREAM_MUSIC`, `STREAM_ALARM`, `STREAM_RING`, and `STREAM_NOTIFICATION`.
- Confirmed current saved emulator caps were music `5`, alarm `7`, ring `5`, notification `5`, with guard enabled.
- Confirmed the guard schedules clamp bursts on guarded app accessibility events at `0ms`, `150ms`, `350ms`, `700ms`, `1200ms`, `2000ms`, and `3200ms`, throttled to one burst request every `900ms`.
- Runtime logs showed `volume_guard` entries for Porter package events and no `volume_guard_error`.
- Emulator media-volume command behavior was not reliable enough to prove a full audio playback scenario, but native logs confirmed clamp bursts are requested while Porter is active.

### Changed Files

- `codex_notes.md`

### Test Results

- `npx tsc --noEmit` passed before runtime diagnosis.
- Android `:app:installDebug` passed.
- SpendSense launched and stayed alive.
- Porter launched and stayed alive.
- Accessibility service remained enabled and bound.
- Android Accessibility `Crashed services` stayed empty.
- Filtered logcat showed Porter accessibility activity without SpendSense `FATAL EXCEPTION`, ANR, or `volume_guard_error`.
- Native logs showed `volume_guard` clamp-burst entries for `com.theporter.android.driverapp`.

### Diagnosis

- The current guard can explain temporary low/silent music if the saved `STREAM_MUSIC` cap is low or zero: any guarded app event can repeatedly clamp media volume back to that cap for roughly 3.2 seconds.
- Event storms can schedule repeated clamp bursts, so a user raising volume during Porter/Swiggy/Zomato usage may feel like the app is fighting the system.
- The guard does not directly mute or pause music; it lowers stream volumes only when current volume is above the saved cap.
- The guard does not check wired headset, Bluetooth A2DP/headset, or current output route before changing volume.
- The guard does not force speaker route in the current code, so it should be separate from speaker-route forcing. It also cannot reliably prevent a speaker blast caused by Android routing audio to speaker; it can only cap the stream volume globally.
- The Settings text/request for Bluetooth route permission appears ahead of the current implementation: the present native code has no Bluetooth route guard.
- Volume Guard appears separate from the Porter Accessibility crash/malfunction issue; no crash or service malfunction occurred in this diagnosis.

### Recommended Safe Design For Task 13B

- Move Volume Guard into a small dedicated native helper/class so accessibility extraction and audio policy are easier to reason about.
- Keep package-name matching for Porter, Swiggy, and Zomato, but make the supported package list explicit and documented.
- Clamp only `STREAM_MUSIC` by default; make alarm/ring/notification caps opt-in if needed.
- Add a safe minimum media cap floor unless the user explicitly chooses mute, so locking at `0` cannot silently kill music.
- Clamp only when a guarded app enters foreground or when a real guarded app window state/content event happens, with a longer debounce than the current 900ms burst loop.
- Record route state with safe non-PII diagnostics: active output type, Bluetooth/headset availability, current stream volume, saved cap, and whether a clamp happened.
- Do not force speaker, do not force max volume, and do not request audio focus.
- Make Settings copy match actual behavior: volume cap now; route/speaker protection only if implemented and tested on real devices.

### Remaining Risks

- Emulator testing cannot prove headphone, Bluetooth, real speaker blast, or real media playback behavior.
- Swiggy and Zomato were not installed/tested on this emulator; support is static package-name matching only.
- Real-device tests still need Porter/Swiggy/Zomato foreground use with media playing, wired headset connected, Bluetooth headset connected, and a forced route-switch scenario if reproducible.
- Android may restrict or vary volume/routing behavior by OEM, app target SDK, audio focus state, and connected audio device.
## Task 13B - Delivery Volume Guard Safety

### Summary
- Made Delivery Volume Guard less aggressive by limiting clamping to Android `STREAM_MUSIC` only.
- Added a safe music cap floor so a saved cap of `0` or a very low value cannot silence media during delivery app usage.
- Added compact audio route diagnostics for wired, Bluetooth, speaker, and output count without storing personal/order data.
- Reduced clamp burst behavior so accessibility event storms do not repeatedly fight media playback.
- Updated Settings copy to describe media-volume protection and route diagnostics more accurately.
- Did not touch Vault, SQL, auth/intro, SMS/notification parsing, Dashboard refresh, or Porter trip-distance behavior outside the volume guard call path.

### Changed Files
- `android/app/src/main/java/com/spendsense/PorterAccessibilityService.kt`
- `src/screens/user/Settings.tsx`
- `codex_notes.md`

### Test Results
- Before changes: `npx tsc --noEmit` passed.
- After changes: `npx tsc --noEmit` passed.
- Kotlin compile: `.\gradlew.bat :app:compileDebugKotlin --console=plain` passed.
- Lint: `npx eslint . --quiet` passed.
- Jest: `npx jest --runInBand` passed, 1 suite passed and 1 test passed.
- Android install/runtime: `.\gradlew.bat :app:installDebug --console=plain` passed on `emulator-5554`.
- Runtime guard test: with a forced saved music cap of `0`, opening Porter clamped media volume from `5` to safe cap `3` on a `0..15` stream, proving the minimum floor prevented silence.
- Runtime logs showed media-only clamping and route diagnostics; SpendSense stayed alive, Accessibility stayed enabled/bound, and `Crashed services` stayed empty.
- Restored the app's volume guard shared preference to `stream_3=5` and `enabled=true` after the low-cap test.

### Remaining Risks
- Emulator testing cannot audibly prove wired-headset or Bluetooth-route behavior; that still needs real-device testing.
- Volume Guard does not and should not force audio routing, so it can reduce loud media volume but cannot guarantee prevention of every Android speaker-route anomaly.
- Swiggy/Zomato support remains static-package based and was preserved, but those apps were not runtime-tested in this task.
- No persistent Delivery Black Box logs were added yet.

## Task 13B Review - Delivery Volume Guard Safety Verification

### Summary
- Reviewed only `PorterAccessibilityService.kt` and `Settings.tsx` for the Task 13B Volume Guard change.
- Confirmed the guard stores and clamps only `STREAM_MUSIC`; alarm, ring, and notification streams are no longer captured or clamped by the guard path.
- Confirmed the safe cap floor coerces the saved media cap into `[minFloor, maxVolume]`, where `minFloor` is at least 2 steps or about 20% of max media volume.
- Confirmed the guard does not force max volume, speaker route, communication device, or audio focus.
- Confirmed route diagnostics are compact booleans/counts only and do not log delivery/order/customer text.
- Confirmed Porter, Swiggy, Zomato, Blinkit, Zepto, Dunzo, Rapido, Shadowfax, Uber, and Ola package matching remains.
- No safety bug was found, so no Volume Guard code was changed during the review.

### Changed Files
- `codex_notes.md`

### Test Results
- `npx tsc --noEmit` passed.
- `.\gradlew.bat :app:compileDebugKotlin --console=plain` passed.
- `npx eslint . --quiet` passed.
- `npx jest --runInBand` passed, 1 suite passed and 1 test passed.
- Android install: `.\gradlew.bat :app:installDebug --console=plain` passed on `emulator-5554`.
- Android runtime: SpendSense and Porter launched, Accessibility service stayed enabled and bound, `Crashed services` stayed empty, and no SpendSense crash/ANR was found.
- Runtime logs showed media-only behavior: `Volume guard skipped music current=3 cap=5 route=...`.
- No `volume_guard_error` logs were found.

### Remaining Risks
- Emulator could not audibly verify wired headset or Bluetooth route behavior.
- The log line currently prints `route=route=...`; this is cosmetic and privacy-safe, not a safety regression.
- Volume Guard still cannot control Android audio routing anomalies; it only caps media volume without forcing routes.

## Task 14 - Delivery Debug Black Box

### Summary
- Added a local-only Delivery Debug Black Box for delivery/accessibility/volume diagnostics without relying on adb/logcat.
- Native Porter accessibility code now stores compact redacted events, recent context, and incident-pinned sessions.
- JS now keeps bounded rolling events, normal session summaries, and manually pinned incident context.
- Settings now exposes `Mark Delivery Issue`, `Export Logs`, and `Clear Logs` under the Delivery Debug Black Box area.
- Existing Porter debug storage was migrated away from raw screen/order text by storing only redacted summaries and by purging legacy raw debug keys.
- Did not touch Vault, SQL, auth/intro, SMS/notification transaction parsing, Dashboard refresh, or Volume Guard behavior.

### Changed Files
- `android/app/src/main/java/com/spendsense/PorterAccessibilityService.kt`
- `android/app/src/main/java/com/spendsense/PorterModule.kt`
- `src/lib/services/deliveryDebugBlackBox.ts`
- `src/lib/services/porter.ts`
- `src/screens/user/Settings.tsx`
- `codex_notes.md`

### Storage Model And Limits
- JS store key: `debug_delivery_black_box_v1`.
- JS rolling event buffer: last 10 minutes, capped at 500 events.
- JS normal session summaries: capped at 50 sessions, cleaned after 7 days unless pinned.
- JS pinned incidents: capped at 10 incidents.
- JS incident context: captures recent context and continues capturing for 2 minutes after `Mark Delivery Issue`.
- Native normal event buffer: capped at 400 events.
- Native pinned incidents: capped at 10 incidents, with up to 80 recent compact events per incident.

### Events Logged
- Categories include accessibility, porter_distance, volume_guard, audio_route, delivery_app, service_health, incident, and error.
- Native events record timestamp, feature/stage, package/category, event type, text length, redacted/hash sample, service state, volume guard state, and compact route/volume diagnostics.
- JS events record sanitized delivery app detection, Porter distance parse success/failure, duplicate/skip conditions, JS/native export metadata, and manual incident markers.

### Privacy
- Logs intentionally do not store customer names, phone numbers, addresses, OTPs, full Porter/Swiggy/Zomato screen text, full Accessibility node text, full notification body, or SMS body.
- Text-like values are stored as `redacted len=<n> hash=<hash>` summaries.
- Legacy raw Porter debug keys are purged during Porter initialization and before mark/export.

### Android Runtime Result
- Emulator `emulator-5554` was available and SpendSense installed/launched successfully.
- Settings showed the new Delivery Debug Black Box controls.
- Delivery Volume Guard and Accessibility service were enabled; opening Porter generated safe accessibility/volume events.
- `Mark Delivery Issue` created pinned native and JS incident context.
- `Export Logs` launched the Android chooser path.
- `Clear Logs` confirmation cleared JS debug keys and native pinned incidents; native service then recreated only fresh lifecycle breadcrumbs.
- Accessibility stayed enabled and bound: `com.spendsense/com.spendsense.PorterAccessibilityService`.
- Android Accessibility `Crashed services` remained empty.
- No SpendSense crash, ANR, `volume_guard_error`, `event_error`, `extract_error`, or `dispatch_failed` was found.

### Test Results
- Before changes: `npx tsc --noEmit` passed.
- After changes: `npx tsc --noEmit` passed.
- Kotlin compile: `.\gradlew.bat :app:compileDebugKotlin --console=plain` passed.
- Lint: `npx eslint . --quiet` passed.
- Jest: `npx jest --runInBand` passed, 1 suite passed and 1 test passed.
- Android install/runtime: `.\gradlew.bat :app:installDebug --console=plain` passed on `emulator-5554`.
- SQLite/native store inspection confirmed debug keys did not retain known old raw Porter/order/address strings after the privacy purge.

### Remaining Risks
- Real-device Porter/Swiggy/Zomato delivery behavior still needs testing without adb, using the new Mark Delivery Issue and Export Logs flow after live orders.
- Android share-sheet export was verified to launch, but the exported file/content was not opened through a target app on the emulator.
- Native service lifecycle events can appear immediately after clearing logs because the Accessibility service may reconnect; this is expected and privacy-safe.
- The Black Box is diagnostic only; it does not change delivery app behavior or fix audio-route anomalies by itself.
