## 2026-08-11

### Capture real-app notification volumes; first evidence against FR-9's rate limit
**Type:** Added
**Time:** 22:05 +08:00
**Files:** — (runtime observation only)
**Related:** FR-7, FR-8, FR-9, FR-20, §12 Q6

Ran the M0 spike against real traffic on the Samsung for ~10 minutes. Captured: Gmail 17, WhatsApp 13, SystemUI 9, Google app 2, Messenger 1.

**FR-9's default rate limit looks wrong.** It specifies 10 per minute per source app. Gmail posted **8 notifications in 130 milliseconds** (22:02:31, identical tag `gig:…^sq_ig_i_personal`, differing IDs) as it re-posted its notification set on sync, and 17 within the observation window. An ordinary mail sync would therefore trip the limit and report legitimate mail as "suppressed". The 10/min figure was a guess in the spec; this is the first measurement against it. **Not changed in the PRD** — one device over ten minutes is not enough to pick a replacement number, and the right fix may be dedupe (FR-8) before rate limiting rather than a larger budget.

**Messaging apps do not share a notification shape.** WhatsApp posts **two** notifications per message — one per-chat (tagged), one group summary (`null` tag) — 38 ms apart. Messenger posts **one**, tagged `ADVANCED_CRYPTO_ONE_TO_ONE:<threadId>`. FR-8's `(package, title, body)` dedupe key would not collapse WhatsApp's pair, since the summary carries different text. Dedupe has to handle both shapes.

**FR-7 confirmed necessary.** SystemUI's `charging_state` re-posts roughly once per minute while charging — a continuous drip consuming ~10% of FR-9's per-app budget indefinitely, carrying no information a user wants forwarded.

**Useful for FR-20:** Messenger's tag embeds a stable conversation ID, which is a grouping key available without reading any notification content.

**Not verified — the important one.** Whether `title` and `body` are populated for `MessagingStyle` notifications is **still unknown**. Content is deliberately not logged, so this cannot be read from logcat, and it was not confirmed on screen. If `EXTRA_TEXT` is empty for WhatsApp or Messenger, the relay would forward blank notifications and the capture code needs a `MessagingStyle` path. **This is the first thing to check before M1.**

## 2026-08-11

### Validate capture on a second device with a real system notification
**Type:** Added
**Time:** 21:56 +08:00
**Files:** — (runtime verification only)
**Related:** §10 M0, FR-7, FR-24

Installed the existing APK on a Samsung Galaxy A52 5G (`SM_A526B`, Android 14 / API 34), reversed port 8081 for Metro over USB, granted notification access via `adb shell cmd notification allow_listener`, and confirmed the full chain in logcat. The first capture was a **real** notification — `com.android.systemui` `charging_state` — rather than one posted by the test harness.

**Why this mattered:** M0 had only ever been exercised with `adb shell cmd notification post`, which posts from `com.android.shell` through a synthetic channel. Real notifications differ in ways the product depends on — custom channels, group summaries, ongoing flags, and apps that populate `EXTRA_TITLE`/`EXTRA_TEXT` unconventionally. The rig now covers two of the five OEMs FR-24 names (Xiaomi/HyperOS and Samsung/Android 14).

**First live FR-7 case:** the captured `charging_state` notification is an ongoing one — precisely the constantly-updating class FR-7 excludes by default to avoid flooding the relay. Nothing filters it yet; filtering is M4.

**Noted:** the grant check immediately after `allow_listener` reported not granted, then read correctly moments later — the settings write had not propagated. The grant itself worked; the check was too eager.

**Not verified:** no third-party app notification has been captured yet — only a system one. Game notifications, the actual target workload, remain untested. Nothing has been observed with the app backgrounded or killed, where the M0 design deliberately drops captures because the JS emitter is detached.

### Add listener instrumentation, requestRebind recovery, and safe-area context
**Type:** Added
**Time:** 21:48 +08:00
**Files:** `app/modules/notification-listener/android/src/main/java/expo/modules/notificationlistener/NotifSyncListenerService.kt`, `.../NotificationListenerModule.kt`, `app/modules/notification-listener/index.ts`, `app/App.tsx`, `app/package.json`
**Related:** §10 M0, FR-5, FR-24, FR-25, FR-33

Three changes. Added logging across the capture path: `captured <pkg> key=<key>` on delivery, `dropped <pkg> — no JS listener attached` when nothing is observing, and `JS attached/detached` around the emitter. Added a `requestRebind()` function exposed to JS and called on every foreground when access is granted. Replaced React Native's deprecated `SafeAreaView` with `react-native-safe-area-context` (~5.7.0), wrapping the tree in `SafeAreaProvider`.

**Why the logging:** when the first capture test showed `Captured (0)`, "never fired", "fired with no emitter", and "screenshot raced the post" were indistinguishable. The four log lines now separate them at a glance, and the same ambiguity would be far more expensive at M1 with a network in the path.

**No notification content is logged — deliberately.** Only package name and `StatusBarNotification.key`. Logcat is readable over adb, and a product whose premise is that the operator cannot read notification text must not write it to a debug log.

**Why requestRebind:** after reinstalling the app, `enabled_notification_listeners` still named the service and the UI still read "granted", but no notification was delivered and `listener connected` never logged. `onListenerDisconnected` cannot recover this, because the service is never constructed in the new process for the callback to run. `NotificationListenerService.requestRebind()` is static and works without a live instance. **This will occur on every app update in production**, presenting as "access is on but nothing forwards" — the silent-failure mode FR-25's heartbeat and FR-33's diagnostics exist to surface.

**Not verified — requestRebind is not proven to be the fix.** On the verifying run, `listener connected` logged *before* `requesting rebind`, so the service bound unaided and the call was a no-op. The earlier failure may simply have needed longer than the nine seconds allowed. The call is correct per documentation and harmless when already connected, but it is defensive rather than a confirmed remedy, and the reinstall-breaks-binding behaviour has been observed once, not characterised.

**Verified:** `npx tsc --noEmit` clean; `app:assembleDebug` BUILD SUCCESSFUL; reinstalled on device; logcat shows the full chain `listener connected` → `requesting rebind` → `JS attached — emitter installed` → `captured com.android.shell key=...`.

**Process note:** a verification screenshot captured the phone mid-use and contained personal account details rather than the app. All screenshots taken this session were deleted from the scratchpad. No further screenshots of the device without asking first.

### Ignore Gradle output inside local Expo modules
**Type:** Fixed
**Time:** 21:37 +08:00
**Files:** `app/.gitignore`, `.gitignore`
**Related:** §10 M0, §8

`git add -A` failed with "Filename too long" on a generated `.dex` path under `app/modules/notification-listener/android/build/`. Added `modules/*/android/{build,.cxx,.gradle}/` to `app/.gitignore` and created a root `.gitignore` for `.idea/`, `.vscode/` and OS cruft.

**Why:** `app/.gitignore` already ignored `/android`, but a leading slash anchors the pattern to that file's own directory, so it never matched `modules/*/android/`. Gradle's output for the local module was therefore tracked. The Windows path-length error was the symptom that surfaced first; committing build artifacts would have been the actual defect, and it would have gone unnoticed on a machine with long paths enabled.

**Verified:** `git check-ignore` confirms the rule matches; `git add -A --dry-run` yields 26 files with no `build/`, `.cxx/` or `.gradle/` paths, longest path 119 characters. Nothing had been staged — the failed `add` was atomic, so no history was affected.

**Noted, not changed:** `create-expo-app` generated `app/AGENTS.md` and an `app/CLAUDE.md` containing only `@AGENTS.md`, pointing at the versioned Expo SDK 57 docs. Left in place — it is useful guidance and does not conflict with the root `CLAUDE.md`, though it does mean the repository now has two files by that name. Git also warns that LF will become CRLF for text files; no `.gitattributes` was added, so line endings remain at Git's default handling.

### M0 complete — notification capture proven end to end on device
**Type:** Added
**Time:** 21:34 +08:00
**Files:** — (runtime verification only)
**Related:** §10 M0, FR-5, FR-6; completes the milestone

The M0 spike works on real hardware. Installed on a Xiaomi Redmi Note 12 Pro+ (`22101316UG`, HyperOS), granted notification access, posted two test notifications via `adb shell cmd notification post`, and all three resulting notifications (two posts plus a group summary) appeared in the app's list within seconds.

**Verified on device:** `NotifSyncListener: listener connected` in logcat; the system lists `com.zeyune.notifsync/expo.modules.notificationlistener.NotifSyncListenerService` in `enabled_notification_listeners`; the app reports "Notification access: granted"; captured entries render package name, resolved app label, title, body, post time, and newest-first ordering. **This closes the one risk M0 existed to retire — that the whole product depends on an Android app being able to read other apps' notifications and hand them to JS.**

**Not a defect, recorded so it is not re-investigated:** the captured entries show title `Stamina` and body `NotifSyncTest` rather than the strings intended. `adb shell` re-parses quotes, so `-t 'Stamina full'` split into title `Stamina` with `full` becoming the tag argument, shifting the tag into the text slot. The field mapping in `NotifSyncListenerService.onNotificationPosted` is correct; the test command was wrong.

**Diagnostic gap found:** `onNotificationPosted` logs nothing, so when the first screenshot showed `Captured (0)` there was no way to distinguish "never fired", "fired but emitter was null", and "screenshot raced the post". It was the third. A log line there would have answered it immediately and should be added before M1.

**Known minor issue:** the app shows "Open debugger to view warnings" from `SafeAreaView` being deprecated in React Native; `react-native-safe-area-context` is the replacement. Harmless at M0, worth fixing when the throwaway UI is replaced.

**Not verified:** behaviour over time. The listener has run for minutes, not days — nothing about OEM battery-killer survival (FR-24), rebind after app update, or reboot persistence has been tested, and those are M5 concerns measured via FR-26.

### Build the M0 spike successfully; correct the JDK 25 diagnosis
**Type:** Fixed
**Time:** 21:18 +08:00
**Files:** — (build verification only)
**Related:** §10 M0, §8; corrects "Replace JDK 25 with Temurin 17 to unblock the Gradle build" below

`app:assembleDebug` now succeeds. `:notification-listener:compileDebugKotlin` compiles, the merged manifest contains `NotifSyncListenerService` with `BIND_NOTIFICATION_LISTENER_SERVICE` and its intent-filter, and `app-debug.apk` is produced.

**Correction — JDK 25 was not the cause.** The build failed identically on Temurin 17 with Gradle confirmed running on `17.0.20`. The entry below attributed `:expo-modules-core:configureCMakeDebug` failing to JDK 25's restriction on `System.load`; that was wrong. Running the same task in isolation afterwards succeeded with no change to the JDK, which means the first two runs failed because they were installing the NDK, SDK Platform 36 and CMake 3.22.1 *during* the build that needed them. Once those were on disk the task passed. `[CXX5304]` (SDK XML version 4) is a warning and not fatal; "A restricted method in `java.lang.System` has been called" was a generic wrapper message that obscured the real state rather than describing it.

**The Temurin 17 switch is kept**, since React Native and Expo document JDK 17 and it is now the proven-working configuration — but it did not fix this, and the entry below overstates its effect.

**Why this matters beyond the fix:** the failure was diagnosed twice from an error message rather than from evidence, and the message named the wrong subsystem both times. The cheap check — re-running the failing task alone — resolved it in six seconds and should have come first.

**Verified:** `gradlew -version` reports Launcher and Daemon JVM `17.0.20 (Eclipse Adoptium)`; `app:assembleDebug` BUILD SUCCESSFUL in 2m 31s; service present in `app/build/intermediates/merged_manifest/debug/.../AndroidManifest.xml`; APK at `app/build/outputs/apk/debug/app-debug.apk`.

**Still not verified:** the APK has not been installed or run. Whether the listener binds, whether notification access can be granted through the FR-5 deep link, and whether captured notifications reach JS are all unproven. **M0 is not complete until a notification appears in the app's list.**

### Replace JDK 25 with Temurin 17 to unblock the Gradle build
**Type:** Fixed
**Time:** 21:08 +08:00
**Files:** — (Windows User-scope environment variables, outside the repository)
**Related:** §10 M0; supersedes the JAVA_HOME value set in "Set JAVA_HOME, ANDROID_HOME and PATH for the Android toolchain" below

The first real Gradle build failed at `:expo-modules-core:configureCMakeDebug[arm64-v8a]` with "A restricted method in `java.lang.System` has been called". Cause is JDK 25: Gradle's native library loader calls `System.load` from an unnamed module, which JDK 24+ restricts. Installed Eclipse Temurin 17.0.20 via winget, repointed `JAVA_HOME` at it, swapped Android Studio's `jbr\bin` out of `PATH` for the Temurin `bin`, and stopped the running Gradle daemon so a fresh one starts on 17.

**Why:** the risk was flagged when `JAVA_HOME` was first set to Android Studio's bundled JBR 25 and is now confirmed. React Native and Expo document and test against JDK 17; 25 is ahead of what this toolchain supports.

**Decided — fix via `JAVA_HOME`, not `org.gradle.java.home` in `android/gradle.properties`.** That file is the standard advice online and is wrong here: `android/` is generated and gitignored in this prebuild project, so the next `npx expo prebuild` would silently discard the setting and the build would break again with no visible cause. Rejected `--ignore-security-hash` for the earlier Microsoft OpenJDK install, whose winget hash did not match the served MSI — that flag disables the only integrity check on a downloaded installer. Temurin was installed instead and its hash verified.

**Not verified:** no build has been run on JDK 17. The original failure is understood but not yet proven fixed, and any further errors past the CMake step remain unknown. Android Studio continues to use its own JBR 25 internally; only command-line Gradle builds were changed.

### Flag an unresolved clock discrepancy affecting this file's timestamps
**Type:** Fixed
**Time:** 21:08 +08:00
**Files:** `CHANGELOG.md`
**Related:** changelog rules 4, 7 and 8; affects every dated heading and `**Time:**` recorded earlier in this session

Measured now as **2026-08-11 21:08 PHT** (UTC 13:08). Earlier in the same session the clock returned 23:41 and 23:51, recorded on entries below under `## 2026-08-10` headings. The two readings cannot both be right without a ~21-hour gap across a day boundary. This entry and subsequent ones use `## 2026-08-11`.

**Why:** the entire value of a `**Time:**` field is that it can be trusted afterwards, so a discrepancy of this size has to be visible rather than smoothed over. `w32time` is **Stopped** on this machine, meaning Windows is not synchronising the clock and unbounded drift is possible — which makes every measured timestamp in this file only as good as an unsynchronised clock.

**Not corrected retroactively.** Rule 8 forbids backfilling and rule 4 forbids editing past entries; the earlier headings and times stand as recorded, with this entry superseding them as the account of what the clock actually says. Which reading was wrong is **not determined** — either real time passed while Android Studio installed, or the clock moved. Nothing available now distinguishes the two, and picking one would be a guess presented as a finding.

**Suggested:** start the Windows Time service (`w32tm /resync` after enabling it) before relying on any further timestamps here.

## 2026-08-10

### Set JAVA_HOME, ANDROID_HOME and PATH for the Android toolchain
**Type:** Changed
**Time:** 23:51 +08:00
**Files:** — (Windows User-scope environment variables, outside the repository)
**Related:** §10 M0, CLAUDE.md build-toolchain section

Android Studio installed the SDK (platform-tools with `adb` 37.0.1, platform `android-37.0`, build-tools `36.0.0`) and a bundled JDK 25.0.2, but set no environment variables — `JAVA_HOME`, `ANDROID_HOME` and `ANDROID_SDK_ROOT` were empty at both User and Machine scope, and neither `java` nor `adb` was on `PATH`. Set `JAVA_HOME` to Android Studio's `jbr`, `ANDROID_HOME` to the SDK, and appended `platform-tools` and `jbr\bin` to the User `PATH`.

**Why:** `npx expo run:android` found the SDK by falling back to its default path, which masked the gap — it failed on "no connected device" before reaching the point where a missing JDK would surface. Gradle would then have failed on the next run with an unrelated-looking error, after the device problem was solved and appeared to have been the only one.

**Note:** existing shells do not inherit these; a new session is required. `ANDROID_SDK_ROOT` was deliberately left unset, being deprecated in favour of `ANDROID_HOME`.

**Not verified:** no Gradle build has run, so the JDK 25 / Gradle 9.3.1 pairing this project resolves to is untested — that is the next thing to suspect if the build fails for reasons unrelated to the device. The `emulator` package was installed by Android Studio despite the decision below to skip it; left in place as harmless rather than removed.

### Pin changelog times to Philippine time; merge the duplicate date headings
**Type:** Changed
**Time:** 23:49 +08:00
**Files:** `~/.claude/CLAUDE.md`, `CHANGELOG.md`
**Related:** device-wide changelog rules 3 and 7; supersedes the timezone note and the "Also unaddressed" note in "Record a measured time on every changelog entry" below

Two changes, both at Effie's instruction. Rule 7 now specifies **Philippine time (PHT, UTC+08:00)** rather than whatever the machine's local zone reports, and derives it from UTC — `[DateTime]::UtcNow.AddHours(8).ToString("HH:mm")` — instead of `Get-Date`. Date headings follow PHT too. Separately, the seven `## 2026-08-10` headings in this file were merged into one, as rule 3 requires.

**Why — the timezone:** this machine's zone is set to `China Standard Time`. That shares +08:00 with Manila by coincidence of geography, not by anything guaranteeing it: change the Windows zone, or open the repo on another machine, and `Get-Date` silently starts stamping a different offset into a record whose value is being reliable afterwards. Deriving from UTC makes the stamp independent of machine configuration. The Philippines has observed no DST since 1978, so the fixed +8 is exact rather than seasonal.

**Why — the merge:** rule 3 allows one heading per date, and seven identical `## 2026-08-10` headings broke the file's one reliable structural promise, that a heading introduces everything under it until the next date. It also made the newest-first ordering ambiguous across heading boundaries.

**Verified:** computed PHT and the local clock returned `23:48 +08:00` identically, so the two timestamps already recorded below (`23:37`, `23:41`) are correct Philippine time and were left untouched — no value was rewritten. The merge removed only heading lines and one adjacent blank each: 182 lines to 170, all 13 `###` entry headings byte-identical before and after, verified by diff, with no double blank lines introduced.

**On rule 4:** merging headings edits existing structure, which rule 4 otherwise forbids. Done because Effie asked for it explicitly, and limited strictly to removing redundant heading lines — no entry text, ordering, or content was altered. A backup of the pre-merge file was written to the session scratchpad, which is temporary and not a durable record; `git diff` is the reliable check.

### Install Android Studio without the emulator component
**Type:** Decided
**Time:** 23:41 +08:00
**Files:** —
**Related:** §10 M0, FR-24, build-path decision earlier today

Android Studio's download page reported this machine as below requirements. It is not: MSI GP63 Leopard 8RE, i7-8750H (6c/12t), 15.9 GB RAM, 84 GB free on C:, Windows 10 64-bit. The two failing checks are the **Android Emulator's** — 16 GB RAM, which 15.9 GB fails as a rounding artifact of reserved hardware memory, and hardware virtualization, which is disabled in firmware. Decided to install Android Studio with the AVD/emulator component deselected, and to develop against physical phones over USB.

**Why:** the emulator is unusable for this product regardless of hardware. M0 captures notifications posted by real apps, and the OEM battery-manager behaviour FR-24 exists to survive does not exist on an emulator — the test rig has to be real phones, which the owner already has two of. Installing the emulator would have consumed 16 GB of disk to provide nothing, while its requirements were the only ones this machine failed.

**Decided against enabling VT-x in BIOS.** It would satisfy the virtualization check, but the check only gates a component being deliberately skipped. Rejected as a firmware change with no benefit to this project.

**Not verified:** the requirement figures come from Google's published emulator requirements, not from the download page's actual check — the specific reason that page rejected this machine was inferred from the two specs that fall short, not read from its output. The Kotlin still has not been compiled; nothing about M0's build is proven until it runs on a device.

### Record a measured time on every changelog entry
**Type:** Changed
**Time:** 23:37 +08:00
**Files:** `~/.claude/CLAUDE.md`, `CHANGELOG.md`
**Related:** device-wide changelog rule, new rules 7 and 8

Added rules 7 and 8 to the device-wide changelog instructions and a `**Time:**` line to the entry template. Date headings stay `## YYYY-MM-DD`; the time rides on the entry as 24-hour local time with UTC offset, read from the system clock with `Get-Date -Format "HH:mm K"` at the moment of writing. This entry is the first to carry one.

**Why:** entries under a single date heading were ordered by position alone, which is a convention rather than recorded data — and this file already leans on it, since "Verify LICENSE against the canonical Apache-2.0 text" refers to another entry as "below". On a day with seven headings and more entries again, that ordering is the only evidence of sequence, and it breaks silently the moment anything is inserted out of order. Rule 7 requires the time be measured because I am handed today's date in context but never the clock: any timestamp I did not read off the system is invented, and an invented timestamp in a record kept for after-the-fact trust is worse than an absent one.

**Not applied retroactively — every entry below this one carries no time and will not be given one.** Rule 8 forbids backfilling and rule 4 forbids editing past entries. Commit dates in `git log` and file mtimes would yield plausible-looking numbers, but they record when a commit or a save happened, not when the entry was written, and several entries below predate their commits by an unknown margin. A guess formatted like a measurement is precisely what rule 7 exists to prevent.

**Also unaddressed:** this file now has seven separate `## 2026-08-10` headings, where rule 3 allows one heading per date. Consolidating them would edit existing structure, so it is left alone and flagged here rather than fixed silently.

**Not verified:** the system timezone reports as `China Standard Time`; the offset `+08:00` is what the clock returned and is what the entry records. Whether that zone label is the intended one for this machine has not been checked, and the offset is only correct while the label is.

### Scaffold the M0 capture spike
**Type:** Added
**Files:** `app/**`, `CLAUDE.md`
**Related:** §10 M0, §8, FR-5, FR-6, FR-7, FR-23, §12 Q5, Q8, Q9

Created the Expo app in `app/` (Expo SDK 57, React Native 0.86.2, TypeScript) with a local Expo module `notification-listener` containing the Kotlin `NotifSyncListenerService`, its JS bridge, and the `<service>` manifest declaration. `App.tsx` shows notification-access state, deep-links to the system grant screen (FR-5), and lists captured notifications. Replaced CLAUDE.md's "no code" section with real commands and layout.

**Why:** M0 exists to prove the one thing the whole product depends on — that an Android app can read other apps' notifications and get them into JS. Everything downstream (crypto, relay, filtering) is conventional; this is not.

**Decided — the service is declared in the module's own `AndroidManifest.xml`, not by a config plugin.** PRD §8 specifies a config plugin injecting the manifest entries. The Expo manifest merger achieves the same result declaratively, whereas a plugin would rewrite generated XML through `dangerousMod` and break silently when the template changes. Rejected the plugin route for the service declaration; it remains the right tool for anything the merger cannot express. §8 has not been amended — flagging rather than editing the spec unasked.

**Decided — no `foregroundServiceType` and no foreground service in the manifest**, per FR-23 as corrected in v0.5. M0 relies on the system binding the listener, and `requestRebind()` is implemented in `onListenerDisconnected()` as the actual recovery path.

**Verified:** `npx tsc --noEmit` clean; `npx expo config` resolves; `npx expo prebuild --platform android` completes without warnings; `npx expo-modules-autolinking resolve -p android` finds the module and registers `expo.modules.notificationlistener.NotificationListenerModule`.

**NOT verified — no Kotlin has been compiled.** There is no JDK, no Android SDK and no `adb` on this machine, so the Kotlin, the Gradle config, the manifest merge, and the JS↔native bridge are all unexecuted. The service may not compile, bind, or emit. M0 is not proven until `npx expo run:android` succeeds on a real device and a notification appears in the list.

**Also:** removed `app/LICENSE`, the Expo template's MIT notice naming 650 Industries, which would have misstated the licence of code the repo covers under Apache-2.0. Installed `expo-system-ui` to satisfy `userInterfaceStyle`. `npm audit` reports 18 vulnerabilities (11 high), all tracing to one advisory in `image-size` reached through metro and the Expo CLI — build tooling, not shipped code; `audit fix --force` would downgrade SDK 57, so it is left alone.

**Package ID `com.zeyune.notifsync` is provisional.** It is permanent once published and Q9 may rename the product; settle Q9 before the first Play upload.

### Export a standalone decision record outside the repository
**Type:** Added
**Files:** `../notifsync-decisions-2026-08-10.md`
**Related:** §12 Q1, Q3, Q7, Q8, Q9, FR-23, LICENSE

Wrote a digest of everything decided on 2026-08-10 to `C:\Users\Effie\Documents\Codes\notifsync-decisions-2026-08-10.md` — outside the repository, at Effie's request. Covers Q1, Q7, Q3, Q8, the Q9 candidate and the licence, each with the decision, its reasoning, what was rejected, and what stayed unverified, plus the M0-onward sequence.

**Why:** the reasoning for the day's decisions is spread across the PRD's §9.1, §9.3, §10, §12 and its revision history, which makes it hard to review as a whole or share without handing over the entire 30 KB document. The digest is readable standalone.

**Note:** the file sits outside the project directory and is therefore not covered by this repository's git history or licence. The PRD and this changelog remain authoritative; the digest will go stale if decisions change and is not maintained as a living document.

### Answer Q8 as specialUse; make the foreground service conditional
**Type:** Changed
**Files:** `notification-sync-prd.md`
**Related:** §10 M5, §12 Q8, FR-23, FR-24, FR-26

Answered Q8: declare `specialUse` if a foreground service ships, never `dataSync`. Rewrote FR-23 — the foreground service is OEM hardening, not what keeps the listener alive — and made it conditional on gaps measured at M5 rather than assumed at M0. Reordered M5 so the 72-hour soak test runs before the service is built. PRD at v0.5.

**Why:** `dataSync` is the type every tutorial recommends for keeping a notification listener alive, and on Android 15+ it is capped at six hours per 24 hours and barred from starting on `BOOT_COMPLETED`. Building on it would have produced a relay that dies silently mid-day — the exact symptom FR-24 identifies as the number one cause of abandonment in this category, engineered in on purpose. `remoteMessaging` avoids the timeout but is documented for text-message continuity between devices, which is not what this app does; `specialUse` is the honest fit and its review cost is a justification string plus the demo video.

**Decided — soak test before foreground service, not after:** FR-23's premise that the service keeps the listener alive was false, so the service may be unnecessary. FR-26's sequence numbers already make dropped notifications visible, meaning M5 can measure whether gaps occur before deciding to build. Rejected keeping the service as an M0 given: it would have baked in a persistent notification, a Play review dependency and a demo video before knowing any were needed, and would have destroyed the measurement by removing the failure it was meant to detect.

**Not verified:** `remoteMessaging` was ruled out by reading its documented scope, not on a known rejection — if review rejects the `specialUse` justification it remains the fallback. Google describes the six-hour cap as "currently" limited to `dataSync` and `mediaProcessing`; that set grew once already, so it needs re-checking at every target-API bump. Nothing has been tested on an OEM device and no submission has been made.

### Verify LICENSE against the canonical Apache-2.0 text
**Type:** Fixed
**Files:** `LICENSE`
**Related:** §12 Q7, resolves the "Not verified" note on "Add Apache-2.0 LICENSE" below

Diffed `LICENSE` against <https://www.apache.org/licenses/LICENSE-2.0.txt>. The only substantive difference was a missing leading blank line, now added. The file is byte-for-byte identical to the canonical text apart from line 190, where the Appendix placeholder `Copyright [yyyy] [name of copyright owner]` is replaced with `Copyright 2026 Zeyune` — which is what the Appendix instructs.

**Why:** the text had been written from memory and never checked. A licence with altered wording is not the licence it claims to be, and the damage surfaces at the point someone relies on it. An exact match also lets automated licence detectors identify it with full confidence.

### Record `noti-noti` as a Q9 name candidate
**Type:** Changed
**Files:** `notification-sync-prd.md`
**Related:** §12 Q9

Added `noti-noti` under Q9 as a candidate product name, with the checks it still needs: trademark position, and availability of the matching Play package ID, domain, and store listing name.

**Why:** Q9 exists because "NotifSync" is close to a shipping app called "Notify Sync: Secure E2E Mirror". `noti-noti` resolves the store-search collision Q9 is actually about, so it belongs in the question rather than in conversation. The package-ID and trademark checks are noted because those collide more expensively than search results do.

### Correct the LICENSE copyright holder to Zeyune
**Type:** Fixed
**Files:** `LICENSE`
**Related:** §12 Q7, supersedes "Add Apache-2.0 LICENSE" below

Changed the copyright line from `noti-noti` to `Copyright 2026 Zeyune`. `noti-noti` was an app-name candidate, not the author's name, and was written into the licence on a misreading of the answer.

**Why:** the copyright holder must be the person who owns the copyright, not the product. The concern raised in the superseded entry — that a project name is not a legal holder — was correct in substance but I applied it as a caveat instead of a question, and wrote the file rather than confirming what the name referred to.

**Still open from the superseded entry:** the holder name must match the Play listing's displayed developer name and the privacy-policy holder (FR-29) by M7. `Zeyune` is a handle; pseudonymous authorship is workable, but the three surfaces need to agree.

### Add Apache-2.0 LICENSE
**Type:** Added
**Files:** `LICENSE`
**Related:** §12 Q7

Wrote the full Apache License 2.0 text with the copyright line `Copyright 2026 noti-noti`, enacting the licence decision recorded in Q7.

**Why:** Q7 recorded the decision but nothing on disk carried it, and a repository intended to go public needs the licence present from before the first public push — code pushed without one is not open source regardless of intent.

**Flagged, not resolved:** `noti-noti` was supplied as the copyright holder. Copyright vests in a person or legal entity, and a bare project name is neither; a pseudonym is workable, a project name is weaker to enforce. Raised at the time and the name was confirmed as given. This also needs to match the developer name shown on the Play listing and the privacy-policy holder (FR-29) by M7, or the three will disagree in public.

**Not verified:** the licence text was written from memory of the canonical Apache-2.0 document rather than copied from apache.org, and has not been diffed against the official text. Worth a byte-for-byte check against <https://www.apache.org/licenses/LICENSE-2.0.txt> before the repository goes public.

### Answer Q7 as Apache-2.0 and free; clear the M-1 gate
**Type:** Decided
**Files:** `notification-sync-prd.md`
**Related:** §9.3, §10 M-1, §12 Q3, Q7, FR-9, FR-16, FR-17, FR-32

NotifSync ships under **Apache-2.0**, free on both stores, with a free hosted relay under a published fair-use quota and no paid tier at launch. Self-hosting stays free and feature-identical, which answers Q3 as a consequence. Rewrote §9.3 and updated M-1 — **no open question now blocks M0.** PRD at v0.4.

**Why:** §9.3 had framed hosted-relay cost as an unfunded risk requiring a business model, but the architecture already made it near-free per user — FR-32 deletes ciphertext on acknowledgement, FR-16 delivers over FCM/APNs at no cost, FR-17 keeps small payloads out of storage, FR-9 caps volume. The real exposure is abuse and spikes, which a quota controls and a price does not. With no cost problem to fund, there was no reason to charge, and charging would have forfeited §1's positioning against Join.

**Decided — Apache-2.0 over GPL-3.0, on a hard constraint rather than preference:** GPLv3 is incompatible with App Store distribution in practice, so copyleft would have cost the iOS receiver — the device this product exists to reach. MPL-2.0 was the runner-up and remains available for new files if a closed fork ever becomes a concern. Keeping it closed was rejected as forfeiting §1's argument.

**Decided — no paid tier now, but the door is not closed:** recorded in §12 Q7 that Play Billing and StoreKit hold payment identity, so a future store-managed tier would not breach §2's accountless rule. Billing self-hosters or taking payment outside the stores would, and counts as a change to §2.

**Not verified:** the GPLv3/App Store incompatibility rests on consistent project experience rather than a citable Apple clause — Apple publishes no licence-specific rule. No legal advice was taken. **No `LICENSE` file has been added to the repository**; the decision is recorded but not yet enacted on disk.

### Answer Q1's written-policy half; unblock M-1's no-code rule
**Type:** Changed
**Files:** `notification-sync-prd.md`
**Related:** §9.1, §10 M-1, §12 Q1, Q8, Q9, FR-23

Researched Google Play's current policy position on `NotificationListenerService` and rewrote §9.1 against it. Notification access is not among Play's enumerated restricted permissions — no declaration form, no permitted-use-case whitelist — so §9.1's claim that "Play requires a declared, permitted use case" was wrong and is replaced with the general core-functionality rule plus the Device and Network Abuse sandbox clause as the named residual risk. Recorded the finding under Q1 with sources, downgraded Q1 from blocking, and rewrote M-1's "no code until Q1" rule. Added the Android 14+ foreground-service demo-video requirement and the 2026-08-31 target-API deadline. Added Q9. PRD bumped to v0.3.

**Why:** M-1 blocked all implementation on a question whose premise has dissolved — NotifSync was never at risk of failing to fit an approved-use-case list, because no such list governs this permission. The rule was guarding against an answer Q1 can no longer return, and left standing it would have stalled the project indefinitely on reviewer discretion that no pre-work resolves.

**Decided:** Q7 (licensing/pricing) keeps its blocking status on M-1 even though Q1 lost its own. Rejected downgrading both together: Q7 is not a research question and determines whether §9.3's running-cost model has an answer at all, which the hosted-relay design depends on.

**Not verified:** Comparable Play listings — including the "Notify Sync: Secure E2E Mirror" name collision behind Q9 — were seen in search results only; Play listing pages do not render to automated fetching and AppBrain returned 403. A Play developer-community thread on this exact question could not be read. The policy findings came from Play Console Help pages read directly. Nothing was confirmed with Google and no submission has been attempted.

### Fix four cross-references pointing at the wrong section
**Type:** Fixed
**Files:** `notification-sync-prd.md`
**Related:** §6.6 FR-23, §8, §10 M-1

Four references to open questions cited §11, which is "Deferred to v2"; open questions are §12. Corrected all four and made each name the specific question (Q8, Q3, Q2, Q1) rather than the section alone.

**Why:** M-1's own gating sentence was one of them, so the milestone that blocks the project pointed a reader at the v2 deferral list instead of the question it depends on.

### Add CLAUDE.md with PRD-derived working constraints
**Type:** Added
**Files:** `CLAUDE.md`, `CHANGELOG.md`
**Related:** FR-10, FR-27, FR-30, FR-35, §11 Q1/Q2/Q7/Q8, M-1

Created `CLAUDE.md` covering the constraints a future session cannot infer from the repo, since the repo holds no code: the M-1 compliance gate blocking implementation, the permanent-FR-numbering rule, the Android-sender/iOS-receiver platform limit, the server-cannot-decrypt boundary, the no-analytics rule, the Notification Service Extension requirement, and the Expo-prebuild stack decision. Also created this changelog.

**Why:** The only artifact here is the PRD, so a session that starts without reading all 25 KB of it would plausibly begin scaffolding code — which M-1 forbids until the Play policy question (Q1) is answered — or propose an iOS sender, server-side filtering, or key recovery, each of which the architecture rules out by construction rather than by preference.

**Decided:** `CLAUDE.md` documents no build, lint, test, or run commands. The PRD's §8 names an intended stack (Expo prebuild, Kotlin native module, Notifee, Supabase), but none of it exists on disk and none of its commands have been run. Writing them down would present unverified guesses as established fact to future sessions. Rejected the alternative of listing them marked as "planned". They get added when a scaffold makes them real.

**Not verified:** Nothing in `CLAUDE.md` was checked against a running project — there isn't one. Every statement is sourced from `notification-sync-prd.md` v0.2 or from Effie's device-wide standing rules, not from executed commands.
