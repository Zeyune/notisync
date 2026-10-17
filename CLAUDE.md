# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Dynamic project status

For every status, progress, remaining-work, next-step or continuation request, follow [AGENTS.md's dynamic status procedure](AGENTS.md#dynamic-project-status), including its checkpoint-maintenance rules. Reconcile [the last documented checkpoint](PROJECT_STATUS.md) and the dated summaries below with current repository evidence before choosing work. Do not maintain a separate Claude status report.

## What this is

NotifSync is an end-to-end encrypted notification relay between a user's own devices: an Android phone forwards selected notifications to a paired phone over a relay that only ever sees ciphertext. [notification-sync-prd.md](notification-sync-prd.md) is the spec and the source of truth for every requirement (FR-*) and open question (Q*) referenced below.

**Milestone recorded at the 2026-10-17 checkpoint: M3.4 — reliability measurement. M3.3 is verified complete (2026-10-11).** Real Samsung capture displayed and acknowledged on Xiaomi with Samsung Wi-Fi / Xiaomi cellular, including background, locked and ordinary process termination. Force-stop reopen recovery and encrypted sender offline retry were observed separately. See [the M3 plan](notification-sync-m3-plan.md) and [QA checklist](notification-sync-m3-qa.md) for evidence and remaining checks. LAN remains selectable; native sender capture without JS is still unimplemented. Receiver force-stop requires reopening.

**M0 is complete** (2026-08-12). The Kotlin `NotificationListenerService` captures on a real Samsung A52 and hands notifications to JS, verified against live WhatsApp and Gmail traffic rather than synthetic ones.

## Commands

All commands run from [app/](app/).

```bash
npx tsc --noEmit                              # typecheck — fastest check; no device needed
npx expo prebuild --platform android          # regenerate android/ from app.json + modules
npx expo run:android                          # build and install on a connected device
npx expo start --dev-client                   # Metro, once a dev build is installed
npx expo-modules-autolinking resolve -p android   # verify the native module is linked
adb logcat -s NotifSyncListener               # native listener logs
```

`npm test` runs delivery tests; `npm run test:pairing` verifies key derivation; `npm run test:relay` exercises relay/FCM with synthetic credentials. `npm run typecheck` and `npm run typecheck:relay` check both targets. Node 24 is used for the SQLite-backed tests. Expo Go cannot load the custom native module.

**`android/` and `ios/` are generated and gitignored.** This is a prebuild (CNG) project: native directories are rebuilt from `app.json` and `modules/`, never hand-edited. An edit made directly in `android/` disappears at the next prebuild.

## Layout

```
app/
  App.tsx                              M0 throwaway UI — permission state + captured list
  modules/notification-listener/       local Expo module, autolinked from modules/
    index.ts                           TS API + CapturedNotification type
    expo-module.config.json            registers the Kotlin module class
    android/src/main/
      AndroidManifest.xml              the <service> declaration, merged at gradle build
      java/expo/modules/notificationlistener/
        NotifSyncListenerService.kt    the listener itself
        NotificationListenerModule.kt  JS bridge
```

The service is declared in the **module's own manifest**, not via a config plugin — the manifest merger handles it, which is more robust than a `dangerousMod` plugin editing generated XML. PRD §8 says "config plugin"; this is the same outcome by a better route, and a plugin is still the answer for anything the merger cannot express.

## Build toolchain

**The full toolchain is installed, and the Kotlin has been compiled and run on hardware.** Verified 2026-09-12: JDK 17.0.20 (Temurin), `adb` 1.0.41, `ANDROID_HOME` at `C:\Users\Effie\AppData\Local\Android\Sdk`, plus Node and npm. Every command above runs.

*This section previously said the JDK, SDK and `adb` were absent and that nothing Kotlin had ever been compiled. That stopped being true when M0 was built onto a device on 2026-08-11.*

## The compliance gate is cleared — build freely

**M-1 closed on 2026-08-10. Nothing blocks implementation.** This section used to read "no code until Q1 is answered"; that rule is retired, not merely satisfied. Q1's premise — that notification access sits behind a permitted-use-case whitelist NotifSync might be excluded from — was **wrong**. There is no such list. What remains of Q1 is per-submission reviewer risk, which cannot be resolved in advance and therefore cannot gate code. Q7 answered Apache-2.0, free, free hosted relay; Q3 followed from it; Q8 answered `specialUse`.

**Still open, and what each actually blocks:**

- **Q2 — crypto library is answered.** Android uses `expo-crypto` AES-GCM; X25519/HKDF pairing uses noble. Native CryptoKit interoperability remains untested while iOS is deferred. Paired directional keys are mandatory; no public development-key fallback remains.
- **Q9 — product name.** A Play listing called "Notify Sync: Secure E2E Mirror" already collides in store search. The GitHub repo was created as `Zeyune/notisync` on 2026-09-12 — *without the `f`* — which sits closer to that collision, not further from it. Candidate recorded in the PRD: `noti-noti`. Cheap to change now, expensive once anything links to it.
- Q4 (APNs under sustained load) is an M3 measurement; Q5 and Q6 are M4/M6 product calls. None gate current work.

Do **not** reinstate a gate here without a matching PRD change.

## Constraints that shape every decision

**iOS can never send.** iOS gives third-party apps no API to read other apps' notifications. The sender role is Android-only, permanently. The iOS build is receiver-only and must say so plainly in the UI and in the first paragraph of the store listing. Never design a feature that assumes an iOS sender, and never propose "a workaround" here — there isn't one.

**The server must stay unable to decrypt.** Payloads are encrypted on the sender; the relay sees ciphertext, a target token, and a size. This forecloses key escrow, key recovery (FR-27), server-side filtering, and server-side history. If a proposed feature would need the server to read notification text, it is out of scope by construction, not a trade-off to weigh.

**Metadata is not protected, and the docs must say so.** The relay can observe public device identities, push tokens, payload sizes, and timing/volume. Notification device labels travel inside ciphertext. Don't let any copy claim metadata confidentiality.

**No third-party analytics or crash-reporting SDKs** (FR-30). No Firebase Analytics, no Sentry. This is a product-defining rule, not a preference — and it is why the diagnostics screen (FR-33) has to be good. Note that `@react-native-firebase/messaging` for FCM/APNs tokens is a separate thing and is in scope.

**iOS decryption happens in a Notification Service Extension** (FR-35), not via a silent `content-available` push waking the app. iOS throttles background pushes to a handful per hour, which would fail exactly under the chatty-sender load this product exists for. The shared key lives in a Keychain access group shared between app and extension.

**Filtering defaults to deny** (FR-10). Nothing forwards until an app is opted in — deliberately the opposite of Pushbullet.

**Expo prebuild + a local config plugin**, not Expo Go (which cannot load the custom native module) and not bare RN. The plugin injects the Android manifest entries for `NotificationListenerService` and the foreground service type. Changing this later means rebuilding the scaffold.

## Working on the PRD

**FR numbers are permanent.** New requirements take the next free number regardless of where they sit in the document. FR-1…FR-25 keep their v0.1 meanings. Never renumber, never reuse a retired number.

The PRD carries its own revision history at the bottom. Add a new entry there for substantive edits — newest first, with a `**Why:**` and an explicit `**Not verified:**` list for anything asserted but unchecked. Existing entries are never edited.

Open questions live in §12 and are numbered permanently too. Mark one answered rather than deleting it.

## Changelog

Every change to this project is recorded in [CHANGELOG.md](CHANGELOG.md) in the same session it is made — one entry per logical change, newest first, with a required `**Why:**`. Decisions are logged even when no file changes (type `Decided`), including the alternatives rejected. Past entries are never edited or deleted; corrections are new entries that supersede old ones.

## Git

Do not run `git commit` or `git push` in this repository, including when asked directly. Write out the exact command in a copyable block and hand it to Effie to run. Read-only Git inspection is fine; stage only when the owner explicitly requests it.
