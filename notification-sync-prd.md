# NotifSync — Product Requirements Document

**Status:** Draft v0.5
**Date:** 2026-08-10
**Owner:** Effie
**Stack decision:** React Native (Expo, prebuild + local config plugin), single app, dual role: sender + receiver
**Scope decision:** Public product from day one — not a personal tool that might ship later. See §9.

> **FR numbering is permanent.** New requirements take the next free number regardless of where
> they sit in the document. FR-1…FR-25 keep the meaning they had in v0.1. Never renumber.

---

## 1. Problem

I run two phones. Phone 1 holds my social media and is the phone I actually look at. Phone 2 is my gaming phone and mostly sits face-down on the desk. Every notification phone 2 produces — stamina recharged, raid starting, event ending, daily reset — is invisible to me unless I physically pick it up.

Existing options each fail in a specific way:

| Option | Why it doesn't work |
|---|---|
| Pushbullet | Mirroring is Android→Android/desktop only. Its iOS app receives pushes but cannot display mirrored notifications properly. No end-to-end encryption. |
| Join | Works, but paid, closed source, and the notification payload passes through a third party in the clear. |
| KDE Connect | LAN-only. Useless the moment the two phones are on different networks. |
| MacroDroid/Tasker + ntfy | Works, but it's a pile of glue. No per-app UI, no pairing model, no history, breaks whenever an OEM kills the automation app. |

**The gap:** a purpose-built, cross-platform, end-to-end encrypted notification relay between *my own* devices, with real per-app filtering and a receiver that works on iOS.

### 1.1 The primary use case is financial notifications, not game notifications

*Added 2026-09-12, and it changes requirements rather than just colour.* The driving need is **not** stamina timers. It is **money movement** — a payment arriving in GCash, GoTyme, Maya or SeaBank — on a phone the user does not carry. Game notifications remain a real secondary case and the section above is kept as written, but where the two conflict the financial case wins.

Three consequences, each carried into the requirement it affects:

- **Missing one is expensive, so reliability is the product.** A missed raid costs nothing and a missed payment defeats the purpose. This promotes §10 M5's 72-hour soak test from hardening to the measurement that decides whether the product is usable at all.
- **Late delivery is still valuable**, which inverts Q6's proposed default — see §12 Q6.
- **The metadata exposure is more sensitive than §7 originally described**, because forwarding timing now correlates with income events rather than with gaming activity — see §7.

This also makes FR-10's deny-by-default and the end-to-end encryption **load-bearing rather than principled**. Transaction amounts crossing a relay in readable form would be a materially different product with a materially different risk profile, which is the strongest argument yet for the architecture §7 already specifies.

## 2. Users

- **Primary:** dual-phone users where one device is the "attention" device and the other is a background device generating time-sensitive alerts. Gaming phone + daily phone; work phone + personal phone; phone + tablet.
- **The owner is user zero, not the only user.** Every requirement below must hold for someone who has never seen the codebase and will not read documentation.

Not building for teams, families, or shared devices. One human, multiple devices they own.

**Accountless by design.** There is no sign-up, no email, no password. Identity is the device keypair; pairing is device-to-device. This is a deliberate differentiator against Pushbullet and Join, and it is also the reason §6.1's no-recovery rule (FR-27) is acceptable rather than negligent.

## 3. The hard platform constraint (read this before anything else)

This is the single fact the whole product is shaped around:

- **Android can send.** `NotificationListenerService` lets an app read every notification posted on the device. This is the mechanism the entire product depends on.
- **iOS cannot send.** iOS gives third-party apps no API to read other apps' notifications. Full stop. There is no entitlement, no workaround, no jailbreak-free path.
- **Both can receive.** Displaying an incoming push is normal, supported behaviour on both platforms.

**Therefore:** the sender role is Android-only and always will be. The iOS build ships as receiver-only, and the UI must say so plainly rather than hiding a greyed-out toggle. Since phone 2 (gaming) is the sender in my own case, this is fine — but it must be stated in the App Store listing's first paragraph, not the fine print, so iOS users don't install it expecting mirroring *from* their iPhone. Expect one-star reviews on this exact misunderstanding regardless; the listing copy is damage control, not prevention.

## 4. Goals

- Forward selected notifications from an Android device to one or more paired devices, within ~5 seconds, whether or not both devices are on the same network.
- Work when the receiving app is closed or the phone is locked — i.e. real OS-level push, not an in-app feed.
- Never let notification content be readable by the relay server or by me-as-operator. End-to-end encrypted payloads.
- Per-app filtering that takes under a minute to configure, because a gaming phone forwarding *everything* is unusable within a day.
- Survive Android's battery optimizer for weeks without silently dying.
- Be diagnosable by a non-technical user without contacting support.

### Non-goals (v1)

- iOS as a sender. Impossible; see §3.
- SMS/call mirroring, file transfer, clipboard sync, remote screen. That's AirDroid's job.
- Acting on a notification remotely (reply, dismiss-on-both). Deferred to v2 — see §12.
- Multi-user accounts, sharing notifications with another person, web dashboard.
- Desktop clients.
- Localization beyond English.

## 5. Success criteria

- p95 delivery latency, sender-post to receiver-display: **under 5 seconds**.
- **Zero unreported gaps** across a 72-hour soak test on a battery-optimized Android device with the screen off. "Unreported" is the operative word: FR-26's sequence numbers mean a dropped notification is *detected*. A gap that the receiver flags is a bug to fix; a gap nobody noticed is a failure of the measurement itself.
- Filter setup for a new game app: **under 30 seconds** from notification arriving to rule created.
- Server can be fully compromised without any notification **text** being exposed. Metadata is a stated exception — see §7.
- **A new user completes pairing and receives their first forwarded notification without external help**, measured on at least five people who did not build this.

## 6. Functional requirements

### 6.1 Pairing

- **FR-1** — A device generates a pairing QR code containing: device ID, public key, and a short-lived pairing token.
- **FR-2** — The other device scans it, and the two complete a key exchange so both hold a shared symmetric key. Manual code entry is available as a fallback when the camera is unusable.
- **FR-3** — The shared key is stored in Android Keystore / iOS Keychain. It never touches the server.
- **FR-4** — A device list screen shows paired devices, their role (sender/receiver/both), last-seen time, and an unpair action. Unpairing revokes the key on both sides.
- **FR-27** — **There is no key recovery.** Reinstalling the app, factory-resetting, or losing a device destroys that device's keys permanently; the remaining device must re-pair. The unpair screen and the onboarding flow both state this in plain language. A server-side device record with no live pairing is deleted after 30 days.
  *Rationale: key escrow would give the server the ability to decrypt, which contradicts §4. Re-pairing takes 20 seconds. This is a non-feature, stated so it doesn't arrive later as a bug report.*

### 6.2 Capture (Android sender)

- **FR-5** — On first run, the app explains why it needs notification access, then deep-links to the system *Notification access* screen. This permission cannot be granted from a normal runtime dialog — it is a special-access grant, and the app must handle the user backing out without granting it.
- **FR-6** — The listener captures package name, app label, title, body, timestamp, app icon, and whether the notification is ongoing/silent.
  *Verified 2026-08-12 that `EXTRA_TITLE` and `EXTRA_TEXT` are sufficient for real `MessagingStyle` traffic: nine WhatsApp per-chat notifications each populated both, with `bigText` null and `textLines` empty. The suspected gap — that a `MessagingStyle` app writes only `EXTRA_MESSAGES` and an `EXTRA_TEXT`-only reader captures blanks — **does not exist for WhatsApp**, so no `MessagingStyle` fallback path is needed. This had been the open risk carried into M1; it is closed. `EXTRA_MESSAGES` is still populated alongside (see FR-8) and remains the place to look if a per-message rather than per-notification granularity is ever wanted.*
- **FR-7** — Ongoing notifications (media players, "app is running", foreground service notices) are excluded by default. They update constantly and would flood the relay.
  *Measured 2026-08-12 over a 29-minute window: SystemUI's `charging_state` re-posts every **20 seconds** (the modal interval, 64 of ~104 gaps), not "roughly once a minute" as recorded on 2026-08-11. That is 3/minute — **30% of FR-9's entire default per-app budget**, consumed indefinitely by one notification carrying nothing a user wants forwarded, for as long as the phone is on a charger. It supersedes the 08-11 estimate.*
- **FR-8** — Duplicate suppression: identical `(package, title, body)` within a configurable window (default 60s) forwards once. Games that re-post the same "stamina full" notice on every tick must not spam.
  *Measured 2026-08-12 against real WhatsApp traffic: one chat's notification is re-posted under a single unchanging key while its `EXTRA_MESSAGES` array accumulates (2→3→4→5→6→7), then re-posted three further times with the array still at 7, the last of those eleven seconds after. Whether those tail re-posts carried new text or none cannot be read from a presence-only log, so it is **unknown** whether FR-8's `(package, title, body)` key collapses them. Settle it at M4 with a receiver in place, where duplicate deliveries are visible without logging content.*
- **FR-9** — A rate limit per source app (default 10/minute) with a visible "N notifications suppressed" summary rather than silent dropping.
  *Measured 2026-08-11 and the default looks wrong: Gmail posted 8 notifications in 130 ms while re-posting its set on sync, and 17 inside a ten-minute window. An ordinary mail sync would trip this limit and report legitimate mail as suppressed. One device over ten minutes is not enough to choose a replacement number, and the right answer may be to run FR-8's dedupe before the limiter rather than to raise the budget. Revisit with real data at M4.*
- **FR-36** — **Group summary notifications are dropped at capture.** A notification carrying `FLAG_GROUP_SUMMARY` has no text of its own — title, text, bigText, textLines and messages are all empty — so forwarding one delivers a blank notification to the receiver.
  *Rationale, and why this is not FR-7: ongoing notifications are real notifications with real content that some user might legitimately want forwarded, which makes excluding them a filtering preference belonging to M4. A group summary is structurally empty under every configuration, so emitting one is a capture defect rather than a policy choice. Measured on 2026-08-11: WhatsApp posts a summary alongside every per-chat message, so without this every message forwards twice — once with content, once blank — doubling relay traffic and FR-9's rate-limit consumption for no benefit.*
  ***Verified on real traffic 2026-08-12.** Nine WhatsApp messages produced nine per-chat notifications and nine summaries; every summary was skipped and every per-chat notification captured. WhatsApp's summary does carry `FLAG_GROUP_SUMMARY`, so the implementation targets the right flag — the earlier worry that the observed empty row was a system `ranker_group` artifact instead was unfounded, and no `ranker_group` appeared in the window. The summary is identifiable by a null tag under the same id as the per-chat notification, but a null tag alone does not imply a summary: a second WhatsApp notification (id 11, null tag, no style) populated both text fields and was correctly captured.*
  ***Confirmed on a second app, and the flag is the only safe discriminator.** Gmail also posts a summary alongside every message — four messages, four summaries, all four skipped, exactly 1:1 — so this is not WhatsApp-specific behaviour. Critically, the two apps mark their summaries differently: WhatsApp's carries the **same id with a null tag**, Gmail's carries **id 0 with the same tag** as the message it summarises. Any heuristic based on a null tag, or on a matching id, would therefore have failed on one of the two apps. Only `FLAG_GROUP_SUMMARY` identifies both, which is what FR-36 tests.*

### 6.3 Filtering

- **FR-10** — Per-app allowlist, defaulting to **deny**. Nothing forwards until an app is opted in. This is the opposite of Pushbullet's default and is deliberate.
- **FR-11** — A "recent notifications" screen listing apps that have posted recently, each with a one-tap *Forward this app* toggle. This is how FR-10's setup stays under 30 seconds.
- **FR-12** — Optional keyword rules per app: forward only if title/body matches (or does not match) given text. For a game that posts both "stamina full" and "shop refreshed" when only the first matters.
- **FR-13** — Quiet hours: a time window during which notifications are queued and delivered as a single digest at the end, or dropped entirely (configurable per app).
- **FR-14** — Rules are stored locally on the sender. Not synced, not on the server.

### 6.4 Delivery

- **FR-15** — Payload is encrypted on the sender before it leaves the device. The relay sees ciphertext, a target device token, and a size — nothing else.
- **FR-16** — Delivery is via platform push (FCM for Android, APNs for iOS) so the receiver is woken even when the app is killed.
- **FR-17** — If the payload exceeds the push size limit (~4 KB on both FCM and APNs), the push carries only a fetch handle; the receiver pulls the ciphertext over HTTPS and decrypts locally. On iOS this fetch happens inside the Notification Service Extension (FR-35), *not* via background fetch.
- **FR-18** — On send failure, retry with exponential backoff. Undelivered notifications older than 24 hours are dropped, and the sender shows a "delivery is failing" banner rather than failing silently.
- **FR-26** — Every forwarded notification carries a **monotonic sequence number per (sender, receiver) pair**. The receiver tracks the highest sequence seen and detects gaps. A gap older than the retry window surfaces as a visible "3 notifications did not arrive" entry in history, and increments a counter on the diagnostics screen (FR-33).
  *Rationale: without this, success criterion 2 is unmeasurable — a dropped notification leaves no trace by definition, so a soak test could only ever conclude "seems fine".*
- **FR-32** — **Data retention at the relay:** ciphertext is deleted on delivery acknowledgement, or after 24 hours, whichever comes first. Operational logs record no payload metadata beyond device ID and timestamp, and are deleted after 7 days. Both figures are stated in the privacy policy and must match the Play Data Safety declaration.

### 6.5 Receiver

- **FR-19** — Incoming notifications display as native OS notifications, showing the source app name and the originating device ("Phone 2 · Honkai").
- **FR-20** — Grouping by source device so the shade doesn't interleave two phones' worth of alerts.
- **FR-21** — An in-app history list of received notifications, stored locally, with a retention setting (default 7 days) and a clear-all.
- **FR-22** — Per-device mute from the receiver side, so the gaming phone can be silenced without touching it.
- **FR-31** — On Android 13+ (API 33), the receiving device requests the `POST_NOTIFICATIONS` runtime permission during onboarding. Without it the receiver installs and pairs successfully but displays nothing — a silent failure mode that must be caught at setup, not discovered at 2am.
- **FR-35** — **iOS decryption happens in a Notification Service Extension**, triggered by `mutable-content: 1`. The extension decrypts the payload (fetching first if FR-17 applies) and rewrites the notification body before display. The shared key lives in a Keychain **access group** shared between the app and the extension.
  *Rationale — this is architectural, not an implementation detail: iOS aggressively throttles `content-available` background pushes to roughly a handful per hour, which would make a naive "silent push wakes the app to decrypt" design fail exactly when a gaming phone is chatty. A Service Extension on a user-visible alert push is not subject to that throttle. Getting this wrong is discovered at M3 and costs a redesign.*

### 6.6 Reliability

- **FR-23** — The sender **may** run a foreground service with a persistent (minimal-priority) notification, as hardening against OEM process-killers (FR-24). **Whether it ships is decided at M5 by measurement, not assumed.**
  *Corrected premise (v0.5): the earlier wording said the foreground service "is what keeps the listener alive". It does not. `NotificationListenerService` is bound and restarted by the system, survives reboot on its own, and exposes `requestRebind()` from `onListenerDisconnected()` as the documented recovery path. The foreground service resists OEM battery managers; it is not life support. This matters beyond pedantry — it is also the justification that would be offered to Play review, and "it keeps my listener alive" is a claim a reviewer can check and find false.*
  **If it ships, the declared `foregroundServiceType` is `specialUse`** (see §12 Q8), never `dataSync`. Implement `requestRebind()` on disconnect regardless of whether the foreground service ships — that path is the listener's actual resilience mechanism.
- **FR-24** — Onboarding includes a battery-optimization exemption request and, on known-aggressive OEMs (Xiaomi, Oppo, Vivo, Samsung, Huawei), a deep link to that vendor's autostart/protected-apps screen with instructions. **This is the number one cause of "it worked for a week then stopped" in every competing app and deserves real design effort, not a footnote.** As a public product it is also the number one predicted support-ticket driver.
- **FR-25** — A heartbeat from sender to receiver. If the receiver hasn't heard from a paired sender in N hours, it raises a "phone 2 may have stopped forwarding" alert. Silent failure is the worst outcome for this product — a false alarm beats a missed raid.
- **FR-33** — A **diagnostics screen** answering "why isn't it working?" without a support ticket: notification access granted (y/n), battery exemption granted (y/n), OEM autostart step completed (y/n/unknown), push token registered (y/n), last successful delivery, last heartbeat, gap count from FR-26, and a copy-to-clipboard summary containing **no notification content**. Reachable from the main screen in one tap, not buried in settings.

### 6.7 Privacy & telemetry

- **FR-29** — A privacy policy is linked from onboarding, from settings, and from both store listings. It states plainly: notification content is end-to-end encrypted and unreadable by the operator; metadata is not.
- **FR-30** — **No third-party analytics or crash-reporting SDKs.** Shipping Firebase Analytics or Sentry inside a product whose entire pitch is "we cannot read your notifications" is self-defeating, and every such SDK is a Data Safety disclosure. Crash diagnostics are local and exported only when the user explicitly taps share in FR-33.
  *This forecloses knowing the real-world crash rate. Accepted, and the reason FR-33 must be good.*
- **FR-28** — **Prominent in-app disclosure** shown *before* the notification-access grant, in the app's own UI, stating what data is accessed, why, and where it goes. This is a Play policy requirement for sensitive permissions and a review-rejection risk if handled casually — it cannot be the same screen as FR-5's explainer if that screen doubles as marketing copy.

## 7. Data model (sketch)

| Entity | Fields | Where it lives |
|---|---|---|
| `Device` | id, label, platform, role, pushToken, publicKey, lastSeenAt | Server (no notification content) |
| `Pairing` | deviceA, deviceB, createdAt | Server stores the link; the shared key is on-device only |
| `Rule` | packageName, enabled, keywordInclude, keywordExclude, quietHours | Sender device only |
| `ForwardedNotification` | id, seq, sourceApp, title, body, timestamp, deviceLabel | Receiver device only (decrypted); server holds ciphertext transiently per FR-32 |

The server's job is deliberately tiny: hold device tokens, relay opaque blobs, forget them once delivered.

**`StatusBarNotification.key` must never leave the device.** It is absent from `ForwardedNotification` above and that absence is load-bearing, not incidental. The key embeds the app's own tag, and apps put identifiers there: Google Play services was observed on 2026-08-12 posting `a:GMSCORE_SYNC_RENDERER:…:117863126120006353924`, where the trailing field is a **Google account ID**, and both WhatsApp and Messenger embed a stable per-conversation identifier. Forwarding the key would therefore hand the relay a persistent account identifier and a conversation graph in plaintext metadata — a materially stronger exposure than the one §7 declares below, and one that no amount of payload encryption offsets. The key is useful on-device (see FR-8 and FR-20) and must stay there. The same applies to any diagnostic that transmits it.

**Stated metadata exposure.** The relay cannot read notification text, but it *can* observe: device labels, push tokens, payload sizes, and the timing and volume of every forwarded notification. This is an accepted limit of the design, not an oversight, and §6.7's privacy policy must say so rather than claiming a stronger property than the architecture delivers.

*Amended 2026-09-12 — the original wording understated this and is superseded.* It read: "enough to infer when a user's gaming phone is active and roughly how busy it is." That was written when §1's gaming framing was the whole story. Under §1.1, a user forwarding wallet apps gives the relay timing and volume data that correlates with **when they receive money and how often** — an income pattern, inferable from identical metadata without decrypting anything. Payload size may narrow it further, since a bank's notification format is consistent enough that size bands carry signal. Two consequences: §6.7's privacy policy must describe *this* exposure rather than the gaming one, and any future traffic-shaping or padding work (not in v1) should be evaluated against this threat rather than the weaker one. The architecture is unchanged; only the honest description of it is.

## 8. Technical approach

- **App:** React Native via **Expo with prebuild and a local config plugin** — not Expo Go, which cannot load the custom native module. Expo is chosen for build tooling and OTA-free release management; the config plugin injects the Android manifest entries for `NotificationListenerService` and the foreground service type. *This decision blocks M0: choosing bare RN later means rebuilding the scaffold.*
- **Native module (Android, Kotlin):** wraps `NotificationListenerService` and bridges captured notifications into JS. This is the only substantial native code on Android.
- **Native extension (iOS, Swift):** Notification Service Extension per FR-35, sharing a Keychain access group with the main app. Small, but it is native code, and it means the iOS build is not pure JS either.
- **Display:** Notifee for rich local notification presentation on both platforms; `@react-native-firebase/messaging` for FCM/APNs token handling and receipt.
- **Relay:** a thin backend whose only endpoints are register-device, send-blob, fetch-blob, and ack. Supabase (Edge Functions + Postgres) is the obvious candidate given it's already on this machine, but any small service works — the design deliberately makes the backend replaceable, which is also what makes §12's self-host question (Q3) cheap to answer either way.
- **Crypto:** shared symmetric key established at pairing; **authenticated encryption (AEAD) with a per-message nonce, and a separate key per direction** so the two devices can never collide on a nonce. Library choice not yet made — see §12 Q2.

## 9. Distribution, compliance & operations

This section exists only because of the day-one-product scope decision. Under a personal-use scope, all of it is deleted and M0 starts immediately.

### 9.1 Android / Google Play

- **Notification access is not a *declared* restricted permission.** As of 2026-08-10, Play's *Permissions and APIs that Access Sensitive Information* policy enumerates SMS/Call Log, Location, Photo and Video, All Files Access, Package Visibility, Accessibility, Request Install Packages, Body Sensors, Health Connect, VPN Service, Exact Alarm, Full-Screen Intent, and Age Signals — **notification access is absent from that list**. There is no declaration form and no permitted-use-case whitelist of the kind SMS/Call Log apps must fit into. See §12 Q1.
- **What does apply** is the general rule: a sensitive permission must be necessary for core functionality *as promoted in the Play listing*, and limited to user-consented purposes. For NotifSync the listing must therefore describe notification forwarding as the headline feature, not a side capability — which it would anyway. Prominent in-app disclosure (FR-28) and a privacy policy (FR-29) remain required.
- **Residual risk is the Device and Network Abuse policy**, which prohibits "apps that circumvent Android sandbox protections in order to derive user activity or user identity from other apps". NotifSync circumvents nothing — `NotificationListenerService` is a supported API behind an explicit special-access grant — but this is the clause a reviewer reaches for if they decide against the category, and it has no notification-specific carve-out either way.
- A **Data Safety** declaration is required and must match FR-30 and FR-32 exactly. A mismatch is a takedown risk, not a warning.
- Android 14+ `foregroundServiceType` justification (FR-23) is reviewed, and the review requires a **demo video** showing the user-initiated, perceptible action the service supports — not just a manifest entry and a text justification. Budget for producing one at M7. See §12 Q8.
- **Target API level:** all apps must meet Play's latest target API requirement by **2026-08-31**. Any scaffold built now should target it from the start rather than migrating later.

### 9.2 iOS / App Store

- **The Apple Developer Program is a hard prerequisite: $99/year.** Push notifications are not available under free provisioning, and free-provisioned builds expire after 7 days. There is no way to test the iOS receiver — let alone ship it — without a paid account. This is a fixed cost before M3 can complete, and v0.1 did not list it.
- Review risk: an app whose iOS build cannot perform its headline function needs its receiver-only nature to be unmistakable in the listing (§3) and in the app itself, or it reads as misleading.

### 9.3 Running costs and support

- **The relay is cheap to run by construction, and that is not an accident.** FR-32 deletes ciphertext on acknowledgement, FR-16 delivers via FCM and APNs at no cost, FR-17 keeps sub-4 KB payloads out of storage altogether, and FR-9 caps per-app volume. Marginal cost per user is roughly one function invocation plus a transient row. Per Q7 the app and the hosted relay are both free; there is no paid tier at launch.
- **The cost risk is abuse, not adoption.** A published per-device fair-use quota is the control, and it must exist before launch — an unmetered open relay is the failure mode, not a large legitimate user base. Decide the quota number at M7 and state it wherever the hosted relay is described.
- **Do not model this as a business.** Q7 settled that revenue is not a goal. If hosted cost ever exceeds what is comfortable to absorb, the levers in order are: tighten the quota, then push heavy users to self-host (Q3, free and full-featured), then introduce a store-managed paid tier. Only the third needs new code, and §12 Q7 records why it does not breach §2's accountless rule.
- FR-24 (OEM battery killers) is the predicted support burden. FR-33 exists to absorb it. Budget for a public FAQ covering the top five OEMs at minimum.
- No analytics (FR-30) means user-reported problems are the only signal. Provide a support channel and read it.

## 10. Milestones

0. **M-1 — Compliance gate. Cleared 2026-08-10.** §12 Q1 (Play policy) is answered on the written-policy half; Q7 (licensing and pricing) is answered as Apache-2.0, free, free hosted relay; Q3 (self-host) is answered as a consequence. **Nothing now blocks M0.**
   Two items carry forward rather than gate: the **Apple Developer Program membership** ($99/year, §9.2) is required before M3 can complete, not before M0 can start; and **Q8** (`foregroundServiceType`) must be confirmed before M0 finishes, since it shapes the manifest the spike is built on.
   *The original "no code until Q1 is answered" rule was written when Q1 might have returned "this category is not permitted" — an answer that would have invalidated the distribution model rather than a feature. It cannot return that any more: there is no use-case whitelist to be excluded from, and comparable apps ship. What remains of Q1 is per-submission review risk, which is not resolvable in advance and therefore cannot gate code.*
1. **M0 — Spike.** Expo prebuild app + Kotlin notification listener printing captured notifications to a local list. No network. Proves the hard part works.
2. **M1 — LAN loop.** Two devices, direct connection over local network, notifications appear on device B. No encryption, no filtering. Proves the end-to-end shape. *Timebox this: it validates the data shape, then gets thrown away at M3.*
3. **M2 — Pairing + crypto.** QR pairing, key exchange, AEAD payloads, sequence numbers (FR-26).
4. **M3 — Relay.** Backend + FCM/APNs, so it works off-network and with the app killed. iOS receiver with Notification Service Extension (FR-35) working. **Validate APNs behaviour under sustained load here** — Q4 below.
5. **M4 — Filtering.** Allowlist, recent-apps screen, keyword rules, dedupe.
6. **M5 — Reliability hardening.** Battery exemption onboarding, OEM deep links, `requestRebind()` recovery, heartbeat, diagnostics screen (FR-33), 72-hour soak test measured via FR-26. **Run the soak test *before* building the foreground service, not after** — FR-23 now treats that service as a response to measured gaps rather than a given, and doing it in the other order destroys the measurement that decides whether it is needed at all.
7. **M6 — Polish.** History, quiet hours, per-device mute, settings.
8. **M7 — Release readiness.** Privacy policy, Data Safety declaration, prominent disclosure (FR-28), store listings, FAQ, support channel, external pairing test with five non-technical users (success criterion 5).

M0–M2 are the interesting technical risk. M5 is where the product lives or dies day to day. M-1 was written as the milestone the project lived or died at, and as the one most likely to get skipped because it contained no code; it was neither, in the end — it took a day, and the question it was built around turned out to rest on a false premise. **The remaining risk is now entirely technical and moves to M0.**

## 11. Deferred to v2

- **Remote dismiss/reply.** `NotificationListenerService` can cancel notifications and `RemoteInput` can send replies, so acting from phone 1 on a phone 2 notification is technically possible. Out of v1 because it doubles the security surface and needs a bidirectional channel.
- Desktop receiver (Electron or web push).
- More than two devices, with routing rules per pair.
- Notification action buttons forwarded and invocable remotely.
- Localization.

## 12. Open questions

1. **Play Store policy** — is this use case permitted for `NotificationListenerService`, and what does review require? See §9.1. **Answered on the written-policy half; the review-practice half stays open. Downgraded from blocking.**

   **Answered (2026-08-10, from current policy documentation):** there is no declaration form and no permitted-use-case whitelist for notification access — it is not among the restricted permissions Play enumerates. The app ships under the general "necessary for core functionality as promoted in your listing" rule, plus prominent disclosure (FR-28) and a privacy policy (FR-29). The original premise of this question — that NotifSync had to fit itself into an approved-use-case list, and might not — was **wrong**, and it was the basis for the sideload/F-Droid contingency. That contingency is no longer the expected outcome.

   **Precedent:** notification-mirroring apps are live on Play with 2026 updates, including at least one selling end-to-end encrypted mirroring in the same shape as this product. The category is not de facto banned.

   **Still open:** whether *this* submission clears *this* reviewer. Documentation states the rule; it cannot predict enforcement, and the Device and Network Abuse sandbox clause (§9.1) is available to a reviewer who decides against the category. Reduce that exposure at M7 by making forwarding the listing's first line, keeping FR-28's disclosure separate from marketing copy, and matching Data Safety to FR-30/FR-32 exactly.

   **Not verified:** the comparable listings were observed via search results, not confirmed first-party — Play listing pages do not render to automated fetching. A developer-community thread on this exact policy question could not be read. Neither changes the documentation finding, which came from Play's own policy pages.
2. **Crypto library** — which RN crypto library is currently maintained, gives AEAD without a native fork, and can be called from a Swift Notification Service Extension as well as from JS? The extension requirement (FR-35) narrows the field and was not a constraint in v0.1. Needs research; the RN crypto ecosystem churns.
3. **Self-host or hosted relay?** **Answered 2026-08-10 as a consequence of Q7:** both. Hosted by default and free under a fair-use quota, with a self-host URL configurable in settings and no feature difference between them. Self-host-only was rejected because success criterion 5 requires a non-technical user to pair unaided, and that user cannot run a server. Cheap either way given §8's replaceable-backend design.
4. **iOS push reliability** — APNs deprioritizes high-volume pushes to a single device. FR-35 avoids the worst of it (background-fetch throttling) but does not make alert pushes unlimited. Needs a real-world sustained-load test at M3 before committing to the iOS receiver as a headline feature.
5. **Does the notification icon survive the trip?** Forwarding app icons means shipping image data through the relay, and pushes past the 4 KB limit into FR-17's fetch path far more often. Probably: app *name* only in v1, icon in v2.
6. **What happens when phone 2 is offline?** Queue on the sender and deliver late, or drop? Late "stamina full" is worse than no notification. Probably: per-app TTL, defaulting to 15 minutes for game notifications.

   **Amended 2026-09-12 — the mechanism survives, the default inverts.** The reasoning above generalised from game notifications, where staleness destroys value. Under §1.1 the primary case is financial, and a payment notification delivered an hour late is **still fully useful** — the money did arrive, and knowing is better than not knowing. A 15-minute default would silently discard exactly the notifications the product exists to deliver, and would do so in the failure mode that matters most: phone 2 offline for a stretch, which is precisely when the user is away from it.

   **Measured 2026-09-12, and it constrains the implementation: the two devices' clocks disagree.** The first M1 forwarding run showed the A52 running roughly 10–20 ms *ahead* of the receiving machine — arrival time minus `postTime` came out negative. The magnitude is irrelevant; the direction is the point. A TTL check is the receiver comparing the sender's `postTime` against its own clock, so it inherits whatever skew exists between them. At milliseconds this is noise. On a phone whose clock has drifted by minutes — no NTP on a restricted network, a manually set clock, a dead battery losing time — a 15-minute TTL would silently discard live notifications or present long-dead ones as current, and nothing in the output would indicate a clock was responsible. Whatever TTL ships must either compute elapsed time on the **sender** and forward a remaining-lifetime value rather than an absolute timestamp, or carry enough information for the receiver to detect skew and refuse to enforce TTL when it is large. Not decided here; recorded so the naive subtraction is not written by default.

   So: **per-app TTL is confirmed as the right mechanism, and a single global default is confirmed wrong.** Financial apps want a long or unbounded TTL; game notifications want a short one. Whether the shipped default is long-with-opt-out or short-with-opt-in is still open, and depends on FR-10's allowlist being the place the user already makes a per-app decision — if they are opting each app in by hand anyway, that is the natural place to set its TTL. Still unanswered: what the receiver shows for a notification delivered well after its `postTime`, since presenting a stale one as current is its own defect.
7. **Licensing and pricing.** **Answered 2026-08-10. No longer blocking.**

   **Licence: Apache-2.0.** Permissive, App Store compatible, and carries an explicit patent grant. **GPL-3.0 was rejected on a hard constraint, not a preference:** GPLv3 forbids downstream parties imposing further restrictions, Apple's App Store terms impose exactly those, and the two are treated as incompatible in practice. Choosing it would have cost the iOS receiver — which is phone 1, the device the user actually looks at — so copyleft would have traded away the product's whole point. MPL-2.0 was the runner-up if a closed fork ever becomes a real concern; it is App Store compatible and file-level copyleft, so switching later is possible for new files but not retroactive.

   **Pricing: free, both stores, with a free hosted relay under a published fair-use quota.** No paid tier at launch. Self-hosting stays available and free (Q3). Revisit only against real cost data.

   **Rationale — the funding problem was smaller than v0.2 assumed.** §9.3 treated hosted-relay cost as an open financial risk needing a business model. The architecture had already solved it: FR-32 deletes ciphertext on acknowledgement, FR-16 delivers over FCM and APNs which cost nothing, FR-17 keeps most payloads out of storage entirely, and FR-9 caps volume per app. Marginal cost per user is approximately one function invocation plus a row that deletes itself. The exposure is abuse and traffic spikes, not legitimate use — and a quota addresses that where a price does not.

   **Note for any future paid tier: §2's accountless rule survives it.** Play Billing and StoreKit hold the payment identity, so a store-managed purchase never requires NotifSync to know who anyone is. What that mechanism cannot do is bill self-hosters or accept payment outside the stores. Any revenue design that needs either of those collides with §2 and should be treated as a change to §2, not an addition to §9.3.
8. **Android 14+ `foregroundServiceType`** — **Answered 2026-08-10: `specialUse`, and only if a foreground service ships at all.**

   **`dataSync` is disqualified, and it is the trap.** It is what nearly every tutorial recommends for keeping a notification listener alive. On Android 15+ it is capped at **6 hours per 24-hour period** — the system calls `Service.onTimeout()` and the service has seconds to `stopSelf()` or the system throws — and it **cannot be started from a `BOOT_COMPLETED` receiver**. A 24/7 relay that must survive reboot fails both conditions, and fails *silently, six hours in*, which is indistinguishable from the OEM-killer symptom FR-24 exists to prevent.

   **`connectedDevice`** requires Bluetooth/NFC/USB/wifi-state prerequisites this app has no reason to hold, and the docs redirect remote-messaging operations away from it. **`systemExempted`** is restricted to device owners, device admins, VPN and emergency-role apps. **`remoteMessaging`** is the tempting near-fit — no timeout, no prerequisites, no justification string — but its stated scope is transferring *text messages* between devices for "continuity of a user's messaging tasks when they switch devices". NotifSync forwards game and app notifications to a device the user is deliberately not holding. That is not messaging continuity, and the gap is visible to any reviewer reading the type description alongside the store listing.

   **`specialUse`** covers "any valid foreground service use cases that aren't covered by the other foreground service types", carries no timeout, and survives boot. Its cost is a free-form `PROPERTY_SPECIAL_USE_FGS_SUBTYPE` manifest string reviewed in Play Console, plus the demo video (§9.1). **Write that string to pre-empt "why not `remoteMessaging`?"** — state that the payload is arbitrary app notifications rather than messages, and that delivery is continuous rather than tied to a user switching devices. That is the objection a reviewer will actually raise.

   **Still open, deliberately:** whether a foreground service ships at all. FR-23's rewrite makes this an M5 measurement rather than an M0 assumption. If the 72-hour soak test shows no gaps via FR-26 on real OEM hardware, the service, the persistent notification, the justification string and the demo video are all unnecessary.

   *Not verified: `remoteMessaging` was rejected on a reading of its documented scope, not on a known rejection. No submission has been attempted. Note also that Google's timeout documentation says the 6-hour restriction "currently" applies only to `dataSync` and `mediaProcessing` — that set has already grown once, when `mediaProcessing` was added in Android 15, so re-check it before each target-API bump.*
9. **Product name.** Q1's precedent search surfaced a Play listing called **"Notify Sync: Secure E2E Mirror"** — same category, same end-to-end-encryption pitch, and close enough to "NotifSync" to be confused with it in store search. §1's competitor table predates this and lists only Pushbullet, Join, KDE Connect, and Tasker glue. Decide whether to rename, and refresh §1 against what is actually shipping now rather than against the options considered at v0.1. *Not verified: the listing was seen via search results, not confirmed first-party.*

   **Candidate: `noti-noti`.** Distinctive enough to avoid the store-search collision that motivates this question, which is the main thing being solved for. Before committing, check it against the trademark position and the availability of the matching Play package ID, domain, and store listing name — a name that collides at the package-ID or trademark level is a costlier mistake than one that collides in search results.

---

## Revision history

### v0.7 — 2026-09-12
**Type:** Changed

Recorded that the product's primary use case is **financial notifications**, not game notifications, and carried that through the three places it changes a requirement. Added **§1.1** stating the case and its consequences; amended **§7**'s stated metadata exposure, which understated what the relay can infer; amended **§12 Q6**, whose proposed default TTL inverts under the new primary case. No FR changed meaning and no FR was added or renumbered.

**Why:** §1 was written around a gaming phone, and every downstream judgement inherited that framing. Three had drifted from the actual need. Q6's 15-minute default would discard payment notifications in exactly the situation the product exists for — phone 2 offline while the user is away from it — because the reasoning behind that number ("late stamina full is worse than nothing") does not transfer to money, where late is still useful. §7 told users the relay could infer gaming activity when in practice it can infer an income pattern from the same timing and volume data, which is a privacy claim that would have been wrong in the store listing and the privacy policy. And M5's soak test was scoped as hardening when it is the measurement deciding whether the product works: a dropped game notification costs nothing, a dropped payment notification is the whole failure.

The architecture needed no change, which is the useful finding. FR-10's deny-by-default and the end-to-end design were already right; they are now load-bearing rather than principled.

**Not verified:** the use case is a stated goal, not observed behaviour — no financial notification has been captured, forwarded, or seen by this project, and the four wallet apps had their OS-level notification permission granted on 2026-09-12 without any transaction being observed since. The claim that payload size carries signal for a bank's notification format is **reasoning, not measurement**; no size distribution has been collected for any app. Whether a stale notification should be presented differently on the receiver is raised in Q6 and left unanswered rather than decided here.

### v0.6 — 2026-08-12
**Type:** Changed

Recorded three measurements taken against real WhatsApp traffic on the Samsung A52 (Android 14): a verification note on **FR-6** closing the `MessagingStyle` capture risk, a verification note on **FR-36** confirming the group-summary skip fires on the flag it targets, and a measurement note on **FR-8** describing WhatsApp's re-post behaviour. No requirement's meaning changed.

**Why:** two items were carried into M1 as unproven, and both were cheap to settle but expensive to be wrong about. FR-36 had been written, shipped and never observed to fire, and the empty row that motivated it was a system `ranker_group` while the code targets `FLAG_GROUP_SUMMARY` — if those were different things, the fix addressed a case that never occurs and the real one still forwards blanks. They are not different: WhatsApp's own summary carries the flag, and it is skipped. Separately, FR-6 rested on the assumption that `EXTRA_TEXT` holds the body for every app; had `MessagingStyle` written only to `EXTRA_MESSAGES`, the relay would have forwarded empty notifications for exactly the messaging apps this product exists to mirror, and the defect would not have surfaced until a receiver existed at M1 to display the blanks.

*Note: FR-36's introduction on 2026-08-11 was logged in `CHANGELOG.md` but never given a revision entry here. This entry does not stand in for that one — per the never-rewrite-history rule it is recorded as an omission rather than backfilled.*

**Not verified:** WhatsApp is one app on one device. The `MessagingStyle` finding is not evidence about Telegram, Signal, Discord or Messenger, each of which may populate fields differently — Messenger in particular was seen on 2026-08-11 to post one notification per message where WhatsApp posts two, so its shape already differs. Whether the tail re-posts described under FR-8 carried new text is unknown and unknowable from a presence-only log. No group-summary behaviour has been observed on any OEM other than Samsung.

### v0.5 — 2026-08-10
**Type:** Changed

Answered Q8: **`specialUse`**, and only if a foreground service ships at all. Rewrote FR-23, which asserted that the foreground service "is what keeps the listener alive" — it does not; `NotificationListenerService` is bound and restarted by the system and exposes `requestRebind()` as its recovery path. FR-23 now makes the foreground service conditional on gaps actually measured at M5, and M5 is reordered so the soak test runs before the service is built.

**Why:** two things were wrong and one was dangerous. The dangerous one is `dataSync` — the type every tutorial recommends for this exact job, and the one Q8 would most likely have landed on without checking. On Android 15+ it is capped at six hours per 24 hours and cannot start from `BOOT_COMPLETED`, so a continuous relay dies mid-day with no error the user can see. That is precisely the failure mode FR-24 calls the number one killer of apps in this category, and it would have been built in deliberately.

The second is FR-23's premise. Because the system already keeps the listener bound, the foreground service is OEM hardening rather than life support — which means it may not be needed at all, and the project already owns the instrument to find out: FR-26's sequence numbers make gaps visible, so M5's soak test can answer empirically what v0.2 assumed. It also means the justification submitted to Play review cannot be "this keeps my listener alive", since a reviewer can check that and find it false.

**Not verified:** `remoteMessaging` was rejected by reading its documented scope against this product, not on any known rejection — it carries no timeout and would be cheaper if accepted, so the choice trades a possible review argument for certainty. Google's timeout documentation says the six-hour restriction "currently" covers only `dataSync` and `mediaProcessing`; that set already grew once, so it needs re-checking at every target-API bump. No submission has been attempted and no OEM device has been tested.

### v0.4 — 2026-08-10
**Type:** Decided

Answered Q7: **Apache-2.0, free on both stores, free hosted relay under a published fair-use quota, no paid tier at launch.** Q3 follows from it — hosted by default and self-host both supported, free, feature-identical. Rewrote §9.3, which had framed running cost as an unfunded risk needing a business model. **M-1 is cleared; nothing blocks M0.**

**Why:** two premises in v0.2 were wrong. First, §9.3 assumed hosted-relay cost was a live financial risk, but FR-32 (delete on ack), FR-16 (FCM/APNs are free), FR-17 (small payloads skip storage) and FR-9 (volume cap) had already reduced marginal cost to about one function invocation per notification. The exposure is abuse, not adoption, and a quota answers that where a price does not. Second, Q7 presented licence and price as one coupled decision with "open source + optional paid relay" as the obvious shape; the licence half was in fact constrained to near-determinacy by something Q7 never mentioned — GPLv3 is incompatible with App Store distribution in practice, so any copyleft choice would have cost the iOS receiver, which is the device this product exists to reach.

Recorded one constraint for the future: §2's accountless rule does **not** forbid a later paid tier, because Play Billing and StoreKit hold the payment identity instead of NotifSync. It does forbid billing self-hosters or taking payment outside the stores. Any revenue design needing those is a change to §2, not an addition to §9.3.

**Not verified:** the GPLv3/App Store incompatibility is long-established practice and Apple has never published a licence-specific rule, so it rests on the consistent experience of projects that hit it rather than on a citable clause. Apache-2.0 avoids the question entirely. No legal advice was taken, and no `LICENSE` file has been added to the repository yet.

### v0.3 — 2026-08-10
**Type:** Changed

Answered the written-policy half of Q1 and rewrote §9.1 on the strength of it. Notification access is **not** among the restricted permissions Play enumerates: there is no declaration form and no permitted-use-case whitelist. §9.1's opening claim — "Play requires a declared, permitted use case" — was wrong and is replaced. The residual policy exposure is named instead: the Device and Network Abuse clause on circumventing sandbox protections to derive user activity from other apps. Added the Android 14+ FGS **demo video** requirement and the 2026-08-31 target-API deadline to §9.1. Downgraded Q1 from blocking and rewrote M-1's no-code rule accordingly; **Q7 still gates M-1**. Added Q9 (product name — a same-category "Notify Sync: Secure E2E Mirror" is on Play). Fixed four cross-references that pointed at §11 ("Deferred to v2") when they meant §12 ("Open questions"), including M-1's own.

**Why:** Q1 was the one question that could have invalidated the distribution model, and its blocking status was justified by a premise that turns out not to hold — the app was never at risk of failing to fit an approved-use-case list, because no such list governs notification access. Leaving M-1's "no code" rule standing on a dissolved premise would have stalled the project on a question that can no longer return the answer it was guarding against. What is left of Q1 is per-submission reviewer discretion, which no amount of pre-work resolves, so it cannot sensibly gate a spike.

**Not verified:** the comparable Play listings, including the Q9 name collision, were observed via search results only — Play listing pages do not render to automated fetching and AppBrain refused the request. A Play developer-community thread on this exact policy question could not be read. The policy findings themselves come from Play Console Help pages read directly. Nothing here was confirmed with Google, and no submission has been attempted.

### v0.2 — 2026-08-10
**Type:** Changed

Scope decided as public product from day one (§9 added in consequence). Five gaps from review closed: iOS receiver's Apple Developer Program prerequisite (§9.2); unmeasurable soak-test criterion fixed via sequence numbers (FR-26); metadata-exposure claim in §5 reconciled with §7's data model; Expo-vs-bare-RN decided as Expo prebuild + config plugin (§8, blocking M0); key recovery stated as an explicit non-feature (FR-27). Added FR-28–FR-35 covering prominent disclosure, privacy policy, no-analytics, data retention, Android 13 `POST_NOTIFICATIONS`, and diagnostics. Added M-1 compliance gate and M7 release readiness. Added Q7 (licensing/pricing) and Q8 (`foregroundServiceType`).

**Why:** v0.1 was written as a personal tool and reviewed as one. As a shipped product, three of its assumptions were load-bearing and wrong — that the iOS receiver needed only code, that "zero missed notifications" could be observed, and that the runtime stack was an implementation detail rather than an M0 prerequisite. The largest single change is FR-35: iOS throttles `content-available` background pushes to a few per hour, so the implied "silent push wakes the app to decrypt" design would have failed under exactly the chatty-gaming-phone load this product exists for. A Notification Service Extension is the supported path, and discovering that at M3 instead of now would have cost a redesign of the delivery layer.

**Not verified:** Google Play's current policy position on `NotificationListenerService` (Q1), the correct Android 14+ `foregroundServiceType` (Q8), and the present state of the RN crypto ecosystem (Q2). All three are marked open rather than answered.

### v0.1 — 2026-08-10
**Type:** Added

Initial draft. Problem, users, platform constraint, goals, success criteria, FR-1–FR-25, data model, technical approach, milestones M0–M6, deferred items, open questions 1–6.
