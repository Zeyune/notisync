# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Current state

There is no code in this repository. It contains one document — [notification-sync-prd.md](notification-sync-prd.md) — and an empty git history (branch `master`, zero commits). There are no build, lint, test, or run commands yet; this section gets replaced the moment a scaffold exists.

NotifSync is a planned end-to-end encrypted notification relay between a user's own devices: an Android phone forwards selected notifications to a paired phone over a relay that only ever sees ciphertext.

## The gate: no code until Q1 is answered

The PRD's milestone **M-1** is a compliance gate, and it blocks all implementation work. Two questions must be resolved first:

- **Q1** — Does Google Play permit this use case for `NotificationListenerService`, and what does review require? Unresolved. A rejection found later invalidates the distribution model, not just a feature.
- **Q7** — Licensing and pricing. Determines whether §9.3's running-cost model has an answer at all.

If asked to start building, say the gate is open and check whether it has been resolved outside the repo before writing code. Q8 (Android 14+ `foregroundServiceType`) and Q2 (crypto library) must be settled before M0 and M2 respectively — both affect the scaffold, not just later features.

## Constraints that shape every decision

**iOS can never send.** iOS gives third-party apps no API to read other apps' notifications. The sender role is Android-only, permanently. The iOS build is receiver-only and must say so plainly in the UI and in the first paragraph of the store listing. Never design a feature that assumes an iOS sender, and never propose "a workaround" here — there isn't one.

**The server must stay unable to decrypt.** Payloads are encrypted on the sender; the relay sees ciphertext, a target token, and a size. This forecloses key escrow, key recovery (FR-27), server-side filtering, and server-side history. If a proposed feature would need the server to read notification text, it is out of scope by construction, not a trade-off to weigh.

**Metadata is not protected, and the docs must say so.** The relay can observe device labels, push tokens, payload sizes, and timing/volume. §7 states this deliberately; don't let any copy claim a stronger property.

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

Do not run `git commit` or `git push` in this repository, including when asked directly. Write out the exact command in a copyable block and hand it to Effie to run. Reading and staging (`add`, `status`, `diff`, `log`, `show`, `branch`) are fine.
