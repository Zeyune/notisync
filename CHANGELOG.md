## 2026-09-13

### Deploy the relay; device registered over public HTTPS with its FCM token
**Type:** Added
**Time:** 01:04 +08:00
**Files:** `app/relayClient.ts`, `relay/wrangler.toml`
**Related:** §7, §8, §10 M3, FR-16, FR-32, §12 Q3

The relay is live at `https://notifsync-relay.johnkenneth-tan-dev.workers.dev`, with D1 bound and the hourly FR-32 sweep registered as a cron trigger. The Samsung registered against it over public HTTPS and its FCM token is stored.

**Verified against production, not inferred from local behaviour:** all 19 smoke-test checks pass against the deployed Worker backed by real D1, and the device row was read back directly — `public_key F2UCRJq0…`, a 142-character FCM token, served from Cloudflare's **SIN** colo in the APAC region. The UI claiming "registered" was not taken as evidence; the database was queried.

**This removes the LAN dependency for the sender→relay hop.** The phone reaches the relay from the internet rather than from the local network, which also disposed of two problems rather than working around them: Windows Firewall silently dropping inbound connections to `wrangler dev` on 8788, and a LAN address that moves with DHCP. **No firewall rule was needed in the end** — the earlier instruction to add one is superseded.

**Two stumbles worth recording because they cost time and will recur.**

*Wrangler's own onboarding link 404s.* It points at `/workers/onboarding`, a path the 2026 dashboard no longer serves. The `workers.dev` subdomain already existed and was visible under **Compute → Workers & Pages → Account details**; there is no `wrangler subdomain` command in v4, so the dashboard is the only route.

*The first deploy's TLS handshake failed from both curl and Node* (`ERR_SSL_SSL/TLS_ALERT_HANDSHAKE_FAILURE`, curl exit 35). Nothing was wrong — a newly created `workers.dev` subdomain takes about a minute to provision its certificate. It resolved on its own. Recorded so the next occurrence is not debugged as a code fault.

**`DEFAULT_RELAY_URL` now points at the deployed Worker** and remains overridable per device from the Relay card, which is the mechanism a self-hosted relay (§12 Q3, answered as "both") will use without needing a rebuild.

**Not verified — the relay still sends no pushes.** `FCM_SERVICE_ACCOUNT` is not set, so the Worker has never called FCM and `/send` only stores a blob. No notification has been delivered through the relay. Only the Samsung is registered; the Xiaomi is unplugged and does not have this build. The hourly cron has not been observed firing, so the FR-32 sweep remains unexercised in production. The `/send`, `/blob` and `/ack` paths are exercised only by the smoke test using fake device keys, never by the app.


### M3.2 — FCM token acquisition working on device; relay deployment blocked on a subdomain
**Type:** Added
**Time:** 00:58 +08:00
**Files:** `app/app.json`, `app/package.json`, `app/push.ts`, `app/relayClient.ts`, `app/pairingState.ts`, `app/App.tsx`, `relay/wrangler.toml`
**Related:** FR-3, FR-16, FR-17, FR-30, FR-31, FR-32, §10 M3

Installed `expo-notifications`, pointed `app.json` at `google-services.json`, and added `app/relayClient.ts` (register/send/fetch/ack) and `app/push.ts` (permission, token, registration). Cloudflare D1 database `notifsync-relay` created in **APAC**, schema applied remotely.

**The device now holds a real FCM registration token** — `eAi7VIzCRDCndh-7D_csD7:APA91bG…` — obtained via `getDevicePushTokenAsync()`, which is the **raw FCM token, not an Expo push token**. That distinction was the point of choosing direct FCM: an Expo token would route every delivery through Expo's servers, adding a third party to a product whose pitch is that there is not one (FR-30).

**FR-31 behaved exactly as specified.** The `POST_NOTIFICATIONS` dialog appeared during setup rather than being discovered missing later, and the card now reads `notifications allowed`. The PRD calls an unrequested permission here "a silent failure mode that must be caught at setup, not discovered at 2am".

**Expo's prebuild did what the Firebase console asks you to do by hand**, and the manual instructions were deliberately *not* followed: `android/` is generated and is wiped by every `expo prebuild`, so edits to `build.gradle` would not survive. Prebuild added `com.google.gms:google-services:4.4.4` to the project Gradle file, applied the plugin in the app module, and copied `google-services.json` into `android/app/`. **The console's snippet also includes `firebase-analytics`, which was excluded** — FR-30 forbids analytics SDKs outright, and the generated build was checked to confirm neither analytics nor Crashlytics was pulled in.

**Two defects found by using it, both in code written tonight.**

*The UI hung on "registering…" indefinitely.* `getDevicePushTokenAsync()` does not reject when Google Play services cannot complete FCM registration — it retries on its own backoff (observed at 26s, 38s, 64s) and the promise never settles. A timeout now bounds it, because a hung promise and a slow one are indistinguishable to the caller and only one is worth waiting for.

*That timeout was then set too aggressively.* It was 20s, but this device's **first** registration genuinely took over a minute while every later call returned instantly from cache. A 20s bound would fail the one case that is slow for a legitimate reason — a fresh install — and report it as an error. Raised to 60s, with the measurement recorded in the comment so it is not "tidied" back down.

**Relay registration fails, and the cause is understood:** `relay timed out after 10s`. Windows Firewall does not admit inbound connections on 8788. Port 8787 worked earlier only because `node.exe` already had an allow rule; wrangler runs `workerd.exe`, a different binary on a different port, so it is dropped silently. **This will be fixed by deploying rather than by a firewall rule** — a deployed Worker is publicly reachable over HTTPS, which is the product's actual shape and also what M3.4's off-network test requires.

**Blocked on a human step:** `wrangler deploy` refuses because the account has no `workers.dev` subdomain registered, and the name it auto-tried was taken. Effie must pick one in the Cloudflare dashboard.

**Also observed, contradicting an earlier note:** the identity and pairing **survived this reinstall** — same public key `F2UCRJq0…` and the same fingerprint `send 443e247e · recv ee1f3d84` after `adb install -r`. An earlier reinstall tonight did regenerate them. Both observations are real, so reinstall behaviour is inconsistent and must not be relied on either way.

**Not verified:** **no push has been sent or received** — the relay has never called FCM, and `FCM_SERVICE_ACCOUNT` is not set. The Worker has never run outside local miniflare. No app code calls `/send`, `/blob` or `/ack` yet; `relayClient.ts` compiles and its register path is the only one exercised, and that only to a timeout. The Xiaomi is unplugged and has none of this build. The raised 60s timeout has not been re-tested against a fresh install.


### M3.1 — relay skeleton on Cloudflare Workers + D1, with a 19-check smoke test
**Type:** Added
**Time:** 00:33 +08:00
**Files:** `relay/wrangler.toml`, `relay/schema.sql`, `relay/src/index.ts`, `relay/smoke-test.mjs`, `.gitignore`
**Related:** §7, §8, §9.3, §10 M3, FR-17, FR-32

First slice of M3. A Cloudflare Worker backed by D1 with `POST /register`, `POST /send`, `GET /blob/:id`, `POST /ack`, `GET /health`, and an hourly scheduled sweep. Runs locally under `wrangler dev`; no Cloudflare account is needed yet.

**Verified, not assumed:** all 19 smoke-test checks pass against the running Worker, including every authorisation refusal. `relay/smoke-test.mjs` is committed rather than thrown away, because the interesting failures here are authorisation ones and they are silent unless something asserts on them — a blob readable by the wrong device would look exactly like a working relay.

**A departure from the approved plan, made deliberately and before writing it.** The plan's schema listed `seq` as a column on `blobs`. That is wrong: at M2 the sequence number was deliberately moved *inside* the ciphertext so the relay could not keep an ordered per-device count of a user's notifications, which under §1.1's financial use case would be a count of money events. The column is not there, and `schema.sql` says why so it is not added later for delivery bookkeeping.

**Design decisions worth recording:**

- **Devices are addressed by their X25519 public key.** No second identifier exists, and pairing already distributes the address — so a paired sender inherently knows where to send, with no extra field in the pairing payload. The key is public by definition and gives the relay no ability to decrypt.
- **Unauthenticated outcomes are indistinguishable.** "No such device" and "wrong secret" both return a bare 401, and a blob addressed elsewhere returns 404 rather than 403 — otherwise the relay becomes an oracle for which public keys are registered and which blob ids exist.
- **Secret comparison is constant-time.** A plain `===` on a bearer token exits at the first differing byte, leaking the token prefix by prefix across many attempts.
- **Acknowledgement is idempotent.** A receiver retrying an ack after a dropped response must not see an error.
- **Payloads above 64 KB are refused.** Measured notifications were 232–476 bytes; the cap leaves room for FR-17 while making the relay useless as free general-purpose storage, which §9.3 names as the real cost risk.
- **The sweep logs a count only** — never ids or targets. §7's stated exposure does not include an operator-readable record of who was sent what, and logs are part of that.

**`.gitignore` extended** to cover `relay/.wrangler/` (local miniflare state, which holds real device secrets and ciphertext from testing), `relay/node_modules/`, and — before either exists — `google-services.json` and `service-account*.json`. This repository is public, and the FCM service-account key is the one credential in M3 that grants real authority: it can push to every device the app has ever registered.

**Not verified:** nothing has been deployed — `database_id` in `wrangler.toml` is still a placeholder, no Cloudflare account is connected, and the Worker has only ever run under local miniflare, so real D1 behaviour, cron triggering and production limits are all untested. **No push is sent**: `/send` stores a blob and returns an id, and a receiver would currently have to be told that id out of band, which is M3.2's job. The scheduled sweep has never fired — the hourly cron was not waited for and the TTL path is unexercised. No app code calls any of this yet.

### Approve and record the M3 implementation plan
**Type:** Decided
**Time:** 00:06 +08:00
**Files:** `notification-sync-m3-plan.md`
**Related:** §8, §9.3, §10 M3, §12 Q3, §12 Q4, FR-16, FR-17, FR-30, FR-32, FR-35

Planned M3 before writing any of it, at Effie's request — *"i want to plan the shit and have a blueprint before starting so we would agree to everything instead of you doing shit that i never agree upon."* Three decisions were taken and the whole plan written to `notification-sync-m3-plan.md`, committed to the repository rather than left in a session-local scratch file.

**Relay host: Cloudflare Workers + D1.** This **supersedes §8's** naming of Supabase as "the obvious candidate". Supabase's free tier **pauses a project after 7 days of inactivity**; for a relay used daily that would rarely trigger, but the failure is silent — notifications stop and nothing says why. FR-25's heartbeat and FR-33's diagnostics exist precisely because silent cessation is this product's worst outcome, so an infrastructure component that fails that way by design works against the requirement. Cloudflare's allowance is also ~6× larger: 100k requests **per day** against 500k Edge Function invocations **per month**.

**A correction made during planning, before it could become a mistake:** Workers KV was recommended first, on the strength of its TTL implementing FR-32's expiry for free. Checking the actual limits showed KV's free tier permits **1,000 writes per day** — and the relay writes one row per notification. D1 allows **100,000 row-writes per day** on the same plan. The recommendation was wrong and was corrected before any code existed. Effie's question — whether Supabase had a comparable cap — is what prompted the check.

**Scope: Android → Android only.** The iOS receiver and FR-35's Notification Service Extension are deferred to a later milestone rather than blocking M3, because they need a Mac to build and a $99/yr Apple Developer membership, neither of which exists. §10 M3 as written includes iOS; this narrows it deliberately.

**Push transport: direct FCM** from our own relay, as §8 specifies. Expo's Push Service was rejected despite being far less setup: every push would route through Expo's servers, putting a third party in the path of a product whose pitch is that there is not one (FR-30). Payloads would stay ciphertext, so the exposure is metadata only — but §7 already concedes enough metadata without adding a party to see it.

**One deviation from §8 recorded as reversible:** `expo-notifications` replaces `@react-native-firebase/messaging` + Notifee — one first-party native dependency instead of two, and `getDevicePushTokenAsync()` returns the raw FCM token so the direct-FCM decision is unaffected. The risk is that RNFirebase's `setBackgroundMessageHandler` is better proven for waking a killed app; if M3.3 shows unreliable delivery, the fallback is contained to `app/push.ts`. The outcome is to be recorded either way.

**Two design choices worth their own note.** The relay will address devices by their **X25519 public key**, so no new identifier is introduced and pairing already transfers the address — removing the question of how a sender learns the receiver's relay id. And pushes will be **data-only at high priority**, because a notification-type message would display before decryption and show the user ciphertext.

**Why the plan lives in the repository:** Effie asked for it explicitly — *"save that plan here in the workplace so that we can go back to it if shits happen."* The planning tool's copy is session-local and is not a record; this file is version-controlled, survives a lost session, and is reviewable on GitHub.

**Not verified — none of this has been built.** No relay exists, no Firebase project has been created, no Cloudflare account is configured, and `expo-notifications` is not installed. Free-tier limits for both Cloudflare and Supabase were read from vendor documentation and secondary sources on 2026-09-13, not tested against a running account. The claim that FCM deprioritises heavy high-priority data senders is carried from general documentation and is listed in the plan as something M3.4 must measure, not as established fact for this app.

## 2026-09-12

### Forward real Gmail and Messenger notifications over Wi-Fi; FR-36 and FR-26 hold in the live pipeline
**Type:** Added
**Time:** 23:47 +08:00
**Files:** — (runtime verification only)
**Related:** §1.1, §7, §10 M1, FR-7, FR-8, FR-26, FR-36

Ten payloads crossed Wi-Fi encrypted under the persisted derived key and decrypted correctly, including a Gmail message (`256B`) and a Messenger message (`256B`), both carrying sender and content intact. Latencies ranged `+247ms` to `+380ms`.

**Messenger is the structurally important one.** It uses `MessagingStyle`, the same notification shape WhatsApp and the wallet apps use, so it stands in for a GoTyme notification far better than SystemUI does. A real financial notification could not be produced — the counterparty was unavailable — so §1.1's use case remains untested end to end, but the notification *shape* it will arrive in has now been through the full encrypted path.

**FR-36 fired in the live pipeline, not in a lab.** Gmail posted its group summary 7ms before the real message, at `id=0` with a matching tag — precisely the pattern measured on 2026-08-12 and distinct from WhatsApp's same-id/null-tag form. The summary was skipped and the message captured. Without it the receiver would have shown a blank notification beside every real one, doubling both traffic and FR-9's rate-limit consumption.

**FR-26 is clean over the radio.** Sequence numbers 1–10 arrived contiguous, with no gaps and no reordering. That is a meaningful contrast: the out-of-order races that motivated rewriting the gap detector earlier tonight happened over the USB tunnel, so reordering is not an artifact of the transport being slow.

**FR-7's cost is now measurable in payloads rather than captures: seven of the ten deliveries were SystemUI charging notices — 70% of encrypted traffic was noise**, re-posting every 1–2 minutes while the phone charged. Each one costs a full AES-GCM seal, a network round trip and a sequence number. This supersedes nothing, but it is the first measurement of FR-7's waste *after* encryption rather than at capture.

*Notification contents are deliberately not reproduced here — this file is committed to a public remote, and the payloads carried a correspondent's name and personal message text.*

**Not verified:** no financial notification has crossed the path, so §1.1 remains unproven end to end. Ten payloads over a few minutes says nothing about sustained behaviour, and all of it ran with the phone plugged in, screen on, app foregrounded — none of the conditions M5's soak test exists to measure. The Xiaomi is still uninvolved and unpaired; no traffic has passed between the two phones.

### Complete M1: forward a notification over Wi-Fi under a persisted derived key
**Type:** Added
**Time:** 23:38 +08:00
**Files:** — (runtime verification only)
**Related:** §10 M1, §10 M2, FR-2, FR-3, FR-4, FR-26

**M1 is complete.** A notification captured on the Samsung was sealed, sent over the local network, and decrypted on the laptop:

```
[1] seq=1 SM-A526B · 232B · +349ms
```

**The USB tunnel was removed before the test, deliberately.** `adb reverse --remove tcp:8787` left only Metro's `tcp:8081`, so `127.0.0.1:8787` leads nowhere on that phone and the sole possible route was `192.168.1.10 → 192.168.1.11` across the radio. Without removing it, a payload arriving over the cable would be indistinguishable from one arriving over Wi-Fi, and the test would have proved nothing. This closes the item outstanding since 21:35, when the receiver address was defaulted to the tunnel precisely so the shape could be validated before the transport.

**Three previously unverified things are settled by that one line.** The device label reads `SM-A526B`, read from `Platform.constants.Model` — the hardcoded "Samsung A52" fix, recorded as unverified at 23:18, now confirmed, which matters because FR-26 tracks sequence numbers per label. The payload was sealed with a **persisted** derived key, one that survived the force-stop tested minutes earlier, so FR-3 storage feeds the live encryption path rather than merely surviving in isolation. And the full chain — capture, derive, seal, transmit, decrypt — ran end to end with no cable and no development key anywhere in it.

**FR-4's unpair was exercised as part of the setup** and behaved correctly: the pairing cleared, the key indicator reverted to `PUBLIC development key — not secret`, and the device kept its own identity (`F2UCRJq0…` unchanged), which is what the narrower unpair semantics recorded at 23:36 intended. Re-pairing to the Node peer then produced `send 443e247e · recv ee1f3d84`, matching the laptop's advance prediction for the third time.

**Not verified:** the notification was synthetic, posted via `cmd notification post` from the shell — **no financial notification has crossed Wi-Fi**, which is §1.1's actual use case. Only one payload was sent, so nothing is known about sustained Wi-Fi behaviour, loss, or reordering over the radio as opposed to the cable; the `+349ms` figure is a single sample and still carries the clock skew recorded against Q6. The Xiaomi was not involved: it remains unpaired after reinstall, and **no traffic has ever passed between the two phones**, which still requires a receiver mode the app does not have. The truncated title and body (`Over` / `air`) are `adb shell` mangling the test command's quoting, not a capture defect.

### Implement FR-3: persist identity and pairing to Keystore/Keychain
**Type:** Added
**Time:** 23:36 +08:00
**Files:** `app/pairingState.ts`, `app/App.tsx`, `app/app.json`, `app/package.json`
**Related:** FR-3, FR-4, FR-27, FR-35, §10 M2

Installed `expo-secure-store` and rewrote `pairingState.ts` to persist the X25519 identity and the peer's public key. `initPairing()` loads or creates them at startup; `pairWith` and `unpair` became async and write through. This is FR-3 as specified — Keystore-backed encryption on Android, Keychain on iOS, which is also the mechanism FR-35's Notification Service Extension will use to read the key via a Keychain access group.

**Verified on device across a full process kill** (`am force-stop`, process confirmed gone, then relaunch):

| | before | after |
|---|---|---|
| pairing | `paired with manual` | `paired with manual` |
| fingerprint | `send b4ac50f7 · recv 96c716ab` | `send b4ac50f7 · recv 96c716ab` |
| own public key | `F2UCRJq0…` | `F2UCRJq0…` |

**The identity check is the one that matters, and it was chosen before running the test.** A half-implementation that persisted the peer key but regenerated the identity would still show "paired" with a *different* fingerprint — the pairing would look intact while deriving entirely different session keys, and the failure would only surface later as decryption errors at the far end. Checking the fingerprint alone would not have caught it; checking that the device's own public key is unchanged does.

**What is stored is the secret key and the peer's public key — not the derived session keys.** They are recomputed on load, so there is one source of truth and no way for a stored derivation to drift from the code that produced it. The public key is likewise derived from the secret rather than stored beside it, since keeping both invites them to disagree after a partial write. FR-27 is unaffected: nothing leaves the device and nothing can recover it.

**`unpair` deliberately keeps the identity** and deletes only the peer. Destroying the identity too is defensible, but it would silently invalidate any *other* pairing once §11's multi-device support exists, so the narrower action is the safer default.

**A confusing intermediate failure, worth recording because it will recur:** after installing `expo-secure-store`, the Samsung showed `Cannot find native module 'ExpoSecureStore'`, followed by `initPairing doesn't exist` and `undefined is not a function`. Nothing was broken — Metro had hot-reloaded JS importing a native module that the *installed APK* predated. Native modules cannot be hot-reloaded, only built in. The cascade of follow-on errors comes from Fast Refresh tripping over the half-loaded module, and they are noise pointing away from the real cause.

**Also:** `expo prebuild` regenerated `android/`, forcing a 5m48s from-scratch build. The APK was then installed to both phones with `adb install -r` rather than `expo run:android`, because Expo's `--device` matches on device *name* and rejects a serial, which is ambiguous with two phones attached. A stale Metro from 21:11 still held port 8081 and had to be stopped before a fresh one would start.

**Not verified:** iOS is entirely untested — `expo-secure-store`'s Keychain path, and the access-group sharing FR-35 depends on, have never run. Persistence was confirmed only on the Samsung; the Xiaomi was reinstalled but not put through the restart test. Only a force-stop was tested, not a device reboot, an app update, or a low-memory kill. **Nothing has been sent using a persisted key** — no encrypted payload has crossed since pairing was made durable. The dev-key fallback for unpaired devices is still present in `crypto.ts`.

### Verify FR-2 device-to-device between two phones, against a prediction made in advance
**Type:** Added
**Time:** 23:22 +08:00
**Files:** — (runtime verification only)
**Related:** FR-1, FR-2, FR-3, §8, §10 M2

**The Samsung A52 and the Redmi Note 12 Pro completed a real X25519 pairing.** Each generated its own identity on its own device; only public keys crossed between them, transcribed by hand; neither transmitted a secret and the laptop mediated nothing. Results:

```
Samsung   send 13d32d71 · recv 2a995358
Xiaomi    send 2a995358 · recv 13d32d71
```

Exact mirror image, which is §8's separate-key-per-direction rule working: each device's send key is the other's receive key.

**The mirror values were predicted before the second device paired, not observed and then explained.** The Samsung was paired first and its fingerprint recorded; the swapped pair was stated as the expected Xiaomi result; the Xiaomi then produced exactly that. This matters because a fingerprint comparison made *after* seeing both is nearly unfalsifiable — any pair of numbers can be narrated into agreement. Committing to the values first made the check capable of failing.

**This supersedes the previous entry's verification in an important way.** Earlier pairings were phone-against-Node: the same `@noble` source running in two runtimes, which proves cross-runtime determinism but shares an implementation. This run is two independent devices, two independently generated identities, and no laptop involvement in the exchange at all. FR-2 is now demonstrated as specified rather than simulated.

**Also established this session:** all three machines are on one subnet — laptop `192.168.1.11`, Samsung `192.168.1.10`, Xiaomi `192.168.1.9` — after the Samsung joined the router's **2.4 GHz SSID**, which is a different network name from the 5 GHz one the laptop and Xiaomi use. And **Windows Firewall does not block the receiver**: a POST from the Samsung to `192.168.1.11:8787` over Wi-Fi returned HTTP 400 (`bad envelope`, the body being `{}`) rather than timing out, so the packet arrived and was answered. The firewall rule recorded as a likely blocker on 2026-09-12 21:35 is **not** needed.

**Verified:** both fingerprints read off device screenshots; the Samsung's half was driven via `adb input` and the Xiaomi's entered by hand, since HyperOS still refuses input injection.

**Not verified:** nothing has yet been *sent* between the two phones. They hold matching keys and no traffic has crossed — the app has no receiver mode, so phone-to-phone delivery remains unimplemented, and the laptop receiver still holds the older Node-peer session key rather than either phone's. The Wi-Fi transport test was set up and **not run**: no notification has crossed the radio, so M1's outstanding item stands. FR-3 persistence is still absent, so both pairings are lost on app restart. Device labels were not re-checked after the `Platform.constants.Model` fix, so it remains unconfirmed that the two phones now report distinct labels.

### Close the M2 loop with derived keys; fix an unscrollable layout and a hardcoded device label
**Type:** Fixed
**Time:** 23:18 +08:00
**Files:** `app/App.tsx`, `app/pairingPeer.mts`, `tools/m1-receiver.mjs`, `.gitignore`
**Related:** FR-2, FR-3, FR-4, FR-26, §8, §10 M2

**FR-2 is verified on hardware, across two runtimes.** The Xiaomi paired against the Node peer and displayed `send a2e5ce15 · recv 237e3808`, matching the laptop's independently computed expectation exactly — then a second pairing reproduced it at `send 78b3f758 · recv 61256c34`. The phone derives with `@noble` under Hermes and the laptop with the same library under Node; identical output means the X25519 agreement, the HKDF derivation, and §8's crosswise direction mapping are correct on both sides. **Then the full path ran end to end:** payloads sealed on the phone with its *derived* send key were opened by the receiver with the matching derived half. The public development key is out of the path.

**Supporting change:** `pairingPeer.mts` now writes its derived receive key to `tools/peer-session.json` and the receiver prefers that file over the development key. Without it the peer's secret died with the Node process, so a phone that had just paired could encrypt nothing the laptop could read — pairing would lock the receiver out rather than connect it. The file is gitignored; it is a throwaway session key for a development peer.

**Two defects surfaced by using the thing, not by reading it.**

*The app could not be scrolled.* The header cards were siblings of the `FlatList`, so they occupied fixed height outside any scroll container; once the pairing card was added the content exceeded the screen and the lower half became unreachable. They are now the list's `ListHeaderComponent`, so the page scrolls as one while the list keeps its virtualisation. Reported by Effie — it is invisible in a screenshot, and `adb input` is blocked on this device, so it could not have been caught from here.

*Every payload claimed to come from "Samsung A52".* `DEVICE_LABEL` was hardcoded, and the Xiaomi dutifully reported itself as the Samsung. **This is not cosmetic:** FR-26 tracks sequence numbers *per device label*, so two senders sharing a label merge into one sequence stream and manufacture gaps from interleaving — corrupting precisely the measurement M5's soak test exists to produce. Now read from `Platform.constants.Model`. A user-chosen label belongs to pairing (FR-4 lists device labels) and is deliberately not done here.

**Noted, because it contradicts an earlier entry:** identity did **not** regenerate across Fast Refresh — module-level state survived, and the pairing held. The 23:12 entry recorded a regeneration after a reload; both observations are real, so reload behaviour is inconsistent and must not be relied on either way. FR-3 persistence is still absent and remains the actual fix.

**Verified:** `npx tsc --noEmit` clean; two independent pairings produced matching fingerprints on device; two encrypted test payloads decrypted with the derived key (`312B` each).

**Not verified:** the scroll fix has not been confirmed by a human touching the screen — `adb input` is refused by HyperOS, and a screenshot cannot show scrollability. No notification from a real app has yet been forwarded under a derived key; only the built-in test payload has. The device label change is untested on the Samsung, which remains unplugged, so `Platform.constants.Model` has been exercised on exactly one device. No two-phone test has been run.

### Install on the Xiaomi; add FR-2 manual pairing UI and wire derived keys into sealing
**Type:** Added
**Time:** 23:12 +08:00
**Files:** `app/pairingState.ts`, `app/pairingPeer.mts`, `app/App.tsx`, `app/crypto.ts`, `app/tsconfig.json`
**Related:** FR-1, FR-2, FR-3, FR-4, §8, §10 M1, §10 M2

The second device is real: a **Redmi Note 12 Pro** (`rubypro`, Android 14, HyperOS 2.0) now runs the app, and it is already on Wi-Fi at `192.168.1.9` — the same `192.168.1.0/24` as the laptop. Added `pairingState.ts` (identity, pairing, session keys, unpair), a pairing card in `App.tsx`, and `pairingPeer.mts`, a Node stand-in for a second device. `crypto.ts` now seals with the derived send key when paired and falls back to the development key when not.

**Pairing is built as FR-2's manual-entry path first, not QR.** FR-2 lists manual entry as the fallback for an unusable camera, and it exercises the identical X25519 exchange while needing no `expo-camera`, no QR renderer, and no native rebuild — so the key agreement gets proven before any scanning UI exists, and the JS hot-reloads. A QR screen is presentation over this same code path.

**Confirmed on device rather than assumed:** the Xiaomi generated a real identity under Hermes and logged a 43-character base64url public key — exactly 32 bytes — which proves `expo-crypto`'s `getRandomBytes`, noble's `x25519.getPublicKey`, and the `btoa`-based base64url encoder all work in the React Native runtime. Those were three untested assumptions in the previous entry.

**The pairing field originally demanded JSON, which was wrong and the device made it obvious.** Nobody transcribing a code by hand types `{"v":1,…}`. It now accepts a bare base64url public key as well — the QR path can carry the full payload, but the human path has to accept the single field that matters.

**The UI states which key is protecting the payload**, showing `key: PUBLIC development key — not secret` when unpaired. An unpaired device still encrypts, with a key published on GitHub, and displaying only "encrypted" would be a misleading claim about a security property that does not exist yet.

**Blocked on device, and it needs a person:** HyperOS refuses `adb shell input` with `SecurityException: Injecting input events requires INJECT_EVENTS`. MIUI gates input injection behind a separate *USB debugging (Security settings)* toggle that requires a Mi account. Until it is enabled, the Xiaomi's UI cannot be driven from the laptop and every interaction on that phone is manual.

**Noted:** the Xiaomi already has notification access granted, so it can act as sender or receiver.

**Not verified — the on-device derivation has never run.** `deriveSessionKeys` is proven across ten random pairs under Node, but no pairing has been completed on hardware, so the cross-runtime agreement between Hermes and Node is still untested; that is exactly what `pairingPeer.mts` exists to check and it could not be driven. Nothing has been encrypted with a derived key. **FR-3 is absent** — keys live in a module-level variable and are lost on reload, and identities regenerate every launch, so a "pairing" does not survive the app restarting. The pairing token is generated and never validated or expired. FR-4's unpair clears memory only. The Samsung was disconnected to attach the Xiaomi, so no two-phone test of any kind has been attempted.

### Add FR-2 key derivation with a self-test; catch a noble v2 API break before it reached the device
**Type:** Added
**Time:** 23:06 +08:00
**Files:** `app/pairing.ts`, `app/pairingKeys.ts`, `app/pairingKeys.selftest.mts`, `app/tsconfig.json`, `app/package.json`
**Related:** §8, §12 Q2, FR-1, FR-2, FR-3

Installed `@noble/curves@2.4.0` and `@noble/hashes@2.4.0` per Q2. `pairingKeys.ts` derives both directional keys from an X25519 exchange; `pairing.ts` generates the device identity and builds FR-1's QR payload; `pairingKeys.selftest.mts` proves the derivation under Node.

**The self-test earned its keep immediately.** `@noble/hashes` v2 requires `info` and `salt` as `Uint8Array` and **throws on a string** rather than coercing. The first implementation passed a template string, which typechecked cleanly and would have failed at runtime on device, during pairing, with a `TypeError` from inside a KDF. Caught in seconds on the laptop instead.

**Why the derivation was split into its own file.** `pairingKeys.ts` imports nothing from Expo, so it runs under plain Node — which is the only reason both sides of a pairing could be tested without a second phone existing. `pairing.ts` keeps everything platform-bound: randomness and the QR payload.

**The failure this test exists to prevent is a quiet one.** If the two devices disagree about which direction is which, pairing succeeds, encryption succeeds, and every message fails at the far end with an AEAD authentication error that points at the cipher rather than at the derivation. The test checks that Alice's send key equals Bob's receive key and vice versa, that the two directions differ (§8), that a different peer yields different keys, and that derivation is deterministic — **across ten random pairs**, because which device sorts "first" depends on random key bytes and a single run exercises only one branch. A bug in the other branch would otherwise pass half the time.

**Design decisions worth recording:** both devices establish their role by **bytewise-sorting the two public keys**, which is deterministic and identical on both sides, so no negotiation channel is needed — each side holds only its own secret and the peer's public key. Both public keys are bound into the HKDF salt and info, so a derived key is valid only for the exact pair that produced it. The raw X25519 output is never used as a key; it is a curve point rather than uniform bytes, and HKDF's extract step is what fixes that.

**Randomness comes from `expo-crypto`, not from noble.** `x25519.utils.randomSecretKey()` reaches for `globalThis.crypto.getRandomValues`, which is not reliably present under Hermes without a polyfill. A silent fall back to weak randomness during key generation is the worst available failure, and an X25519 secret key is just 32 random bytes, so taking them from a platform CSPRNG removes the question at no cost.

**Also:** `app/tsconfig.json` now excludes `**/*.selftest.mts`, which is a Node script using `node:crypto` and explicit `.ts` import specifiers that the app's config rejects. It is checked by being run, which is stronger than typechecking it.

**Verified:** all seven self-test checks pass, including across both sort orders; `npx tsc --noEmit` clean.

**Not verified — none of this is wired into the app.** There is no QR rendering, no scanner, and no second device; `generateIdentity` and `buildPairingPayload` have never executed on hardware, so `expo-crypto`'s `getRandomBytes` and the `btoa`-based base64url encoder are both untested under Hermes. `crypto.ts` still seals with the hardcoded development key — the derived keys are not yet used by anything. **FR-3 is absent**: nothing writes to Android Keystore or the iOS Keychain, so derived keys would live only in memory. The pairing token is generated but never validated or expired, and FR-4's unpair path does not exist.

### Encrypt the forwarded payload; prove expo-crypto's AES-GCM format against a third implementation
**Type:** Added
**Time:** 23:02 +08:00
**Files:** `app/crypto.ts`, `app/lanForwarding.ts`, `app/App.tsx`, `app/package.json`, `tools/m1-receiver.mjs`
**Related:** §7, §8, §12 Q2, §10 M2, FR-1, FR-2, FR-3, FR-26, FR-27

First slice of M2. `expo-crypto@~57.0.3` installed; `app/crypto.ts` seals payloads with AES-256-GCM; `lanForwarding.ts` encrypts inside `sendToReceiver` so no transport path can send plaintext; the receiver opens envelopes with Node's `createDecipheriv`. Notifications now leave the phone as ciphertext.

**Q2's load-bearing assumption is no longer an assumption.** Q2 records that `expo-crypto`'s `combined()` matching CryptoKit's `AES.GCM.SealedBox` rested on both vendors' documentation agreeing, never on a round trip — and the real CryptoKit test needs a Mac this project will not have until M3. Node was used as the available third party: it implements standard AES-256-GCM with no knowledge of Expo or Apple. A notification sealed on the A52 opened correctly in Node (`[2] seq=1 Samsung A52 · 248B`), which establishes that `combined()` is genuinely `IV ‖ ciphertext ‖ tag` with a 12-byte IV and a 16-byte tag — the layout CryptoKit consumes. **This does not prove CryptoKit will open it**; it converts "two documents agree" into "an independent implementation agrees", which is where the risk actually sat.

**The receiver's decryption was self-tested before the phone was involved**, using a Node-sealed payload, so that a later failure from the device would be unambiguously a format difference rather than a bug in the test harness.

**The envelope carries `{v, payload}` and nothing else — `seq` moved inside the ciphertext.** Leaving it outside would have let the receiver detect FR-26 gaps without decrypting, which is convenient and wrong: it hands the relay an ordered per-device counter for free. §7 already concedes timing and volume; an explicit sequence number is a stronger signal, and under §1.1 that counter counts money events. The version field is checked and unknown versions are refused rather than guessed at.

**The development key is hardcoded in two files and committed to a public repository, deliberately and loudly.** `app/crypto.ts` and `tools/m1-receiver.mjs` both carry a warning that it is public, worthless, and must be **deleted** rather than rotated when FR-2's pairing lands. Stated plainly because a hardcoded key looks ordinary six months later: until pairing exists this is authenticated encryption under a key everyone has, which is a transport test and not a security property. Real keys are per-pairing, live in Keystore/Keychain (FR-3), and are unrecoverable by design (FR-27).

**Also fixed:** the app header still read "M1 LAN loop — plaintext, local network" after payloads became ciphertext, and the component doc still described M1's scope.

**Verified:** `npx tsc --noEmit` clean; `node --check` clean; the Android build completed (exit 0) and reinstalled; the notification-access grant survived the reinstall; `TextEncoder` is available under Hermes, which the code assumed and had not tested.

**Not verified:** no Swift or CryptoKit code has been written or run, and none can be until a Mac is available — the iOS half of Q2's interop claim remains open. Encryption has only been exercised over the USB tunnel with synthetic shell notifications; no financial notification has been forwarded encrypted. §8's separate-key-per-direction rule is **not implemented** — both directions would currently share one key, which is exactly the nonce-collision risk §8 exists to prevent, and it cannot be fixed before pairing provides two keys. Key rotation, unpairing, and FR-3's Keystore/Keychain storage are all absent.

### Answer Q2: pick the crypto stack and unblock M2
**Type:** Decided
**Time:** 22:57 +08:00
**Files:** `notification-sync-prd.md`
**Related:** §12 Q2, §8, FR-1, FR-2, FR-35, §10 M2

Q2 is answered and M2 is unblocked. AEAD is AES-256-GCM via **`expo-crypto`** in JS and **CryptoKit** `AES.GCM` in the iOS Notification Service Extension; key agreement is X25519 via **`@noble/curves`** with HKDF from **`@noble/hashes`**, both at pairing only. Written into the PRD as Q2's answer with revision entry v0.8.

**Why the question turned out easier than it was written.** Q2 dates from v0.1 and was framed around a churning third-party RN crypto ecosystem. Two premises had since expired. Expo SDK 55 added `aesEncryptAsync`/`aesDecryptAsync` to `expo-crypto`, and this project is on SDK 57 — so the AEAD half is a first-party module already in the SDK, carrying none of the maintenance risk the question existed to avoid. And re-reading FR-35 showed **the extension only decrypts**: pairing runs in the main app, the extension reads the shared key from the Keychain access group, so it needs AEAD alone rather than every primitive. CryptoKit supplies that with zero dependencies, which matters under an NSE's hard memory cap. The assumption that the extension needed the full primitive set was what made Q2 look hard.

**The native/JS split is by call frequency, not preference.** AEAD runs per notification and is native on both platforms. X25519 and HKDF run twice in a pairing's lifetime, where pure JS costs nothing measurable and removes native-fork risk entirely. `@noble/*` is audited, pure TypeScript, with pinned and minimal dependencies; the `getRandomValues` polyfill it needs under React Native is already provided by `expo-crypto`.

**Rejected without deep comparison, and stated as such:** libsodium bindings, `react-native-quick-crypto`, and implementing AEAD natively in the existing Kotlin module were all viable and none were evaluated in depth. Effie chose to lock the stack in rather than widen the search, on the grounds that a first-party module plus an audited pure-JS library already satisfies every constraint Q2 names. Recorded so the alternatives are visible if the interop test below fails.

**The one load-bearing unknown is flagged in the PRD rather than smoothed over.** That `expo-crypto`'s `combined()` output opens directly as a CryptoKit `AES.GCM.SealedBox` rests on **both sides' documentation agreeing** about a 12-byte nonce, a 16-byte tag, and `IV ‖ ciphertext ‖ tag` ordering — not on a round trip anyone has run. Q2 now requires that interop test before any M2 work depends on the format, because a mismatch surfaces inside a Notification Service Extension, which is among the hardest components in the product to debug.

**Not verified:** no code has been written or run against any of the three libraries, and `expo-crypto`'s AES functions have not been exercised on device in this project. Library maintenance status and API shapes were read from vendor documentation and release notes rather than from source. §8's requirement of a separate key per direction is specified but its HKDF info-string scheme is undesigned.

### Verify the M1 failure path on device; record misleading transport errors for FR-33
**Type:** Added
**Time:** 22:40 +08:00
**Files:** — (runtime verification only)
**Related:** §10 M1, FR-26, FR-33, §10 M5

The receiver was stopped, notifications were posted, and the app's behaviour was read off a device screenshot rather than inferred. **The failure path works.** Failed rows render in red as `not forwarded — <error>`, capture continued unaffected, the UI did not hang, and forwarding recovered immediately when the receiver came back (`seq=73` arrived on the first post after restart).

**FR-26's semantics survive failure, which is the result that matters.** The sender consumed sequence numbers 66–72 on sends that failed. A continuously running receiver would therefore have seen `65 → 73` and reported seven lost — and seven notifications genuinely never arrived. Failed sends *should* count as gaps, and they do. That is the property M5's soak test depends on: the gap count measures delivery, not send attempts.

**The error text is misleading, and this is the finding worth keeping.** A dead receiver behind `adb reverse` reports `java.io.IOException: unexpected end of stream`, not `ECONNREFUSED` — because adb keeps its listener alive **on the phone**, so the TCP connection succeeds and then dies mid-stream when adb cannot reach the host process. The same condition over Wi-Fi would present as connection refused. One cause, two unrelated-looking messages, and the tunnel-specific one is the confusing one. **FR-33's diagnostics screen exists precisely to tell a user why delivery stopped**, so it must classify transport failures rather than surface the raw exception string, or it will report a dead receiver in language that describes neither the cause nor the fix.

**Also observed:** the test-payload status line still read `sent ✓` from an earlier success while every send beneath it was failing. Harmless at M1 and not fixed, but the same staleness in FR-33 would be actively misleading, since a diagnostics screen is read exactly when something is wrong.

**Not verified:** the notification-app path was exercised with `cmd notification post` from the shell, not with a financial notification, so failure behaviour under the §1.1 use case is inferred rather than observed. All of it ran over USB — the `ECONNREFUSED` claim for Wi-Fi is reasoning about how the transports differ, not a measurement, and no Wi-Fi failure has been produced. The rewritten gap detector still has not seen a real reordering event: the restarted receiver began with no history, so its first payload could not produce one.

### Forward a real financial notification; fix FR-26 gap detection to survive reordering
**Type:** Fixed
**Time:** 22:35 +08:00
**Files:** `tools/m1-receiver.mjs`
**Related:** §1.1, §7, §10 M1, §10 M5, FR-8, FR-26

**M1's question is answered.** A genuine GoTyme transfer notification was captured, forwarded and rendered on the receiver, and §7's field list proved **sufficient** for the §1.1 use case: `sourceApp` identified the bank, and `title` plus `body` carried the event, the sender, the amount and the resulting balance. Nothing further would be needed to act on it without picking up the phone. No field is missing, so M2 can encrypt this shape as specified.

*The notification's contents are deliberately not reproduced here. This file is committed to a public remote, and the body carried a counterparty's name and an account balance — the same reasoning that keeps the Wi-Fi credential out of it.*

**The run also exposed a real defect in the gap detector, which was the more valuable result.** Sequence 61 arrived *after* sequence 62, and the detector — which tracked only the highest sequence seen — reported two losses that had not occurred. Nothing was lost. The sender fires each POST without awaiting the previous one, deliberately, because awaiting would apply backpressure to capture itself; so two notifications captured milliseconds apart race and can complete out of order.

**Why this was worth stopping for rather than noting.** FR-26's gap count is the measurement §10 M5's 72-hour soak test rests on, and that measurement decides whether a foreground service ships at all. A detector that reports reordering as loss would have made a healthy soak run look broken and argued for a service, a persistent notification, a `specialUse` justification string and a demo video that the evidence never actually required. The failure mode is worse at M3, where FCM offers no ordering guarantee.

**The fix distinguishes outstanding from lost.** A skipped sequence number is now held as outstanding and reported as `↻ out of order … (not lost)` when it turns up. A `SIGINT` handler prints the session summary — received, reordered, and only then the sequence numbers that genuinely never arrived — because mid-run a missing number is indistinguishable from one still in flight, and that is the honest moment to call anything lost.

**Also observed in the same window:** Messenger posted the same `Jubel / Sent a message.` body three times within one second under three separate sequence numbers, which is FR-8 dedupe material — and notably its `(package, title, body)` key *would* collapse these, unlike the WhatsApp case recorded 2026-08-12. Messenger also posts a `Checking for new messages` notice repeatedly, and Gmail a contentless `Syncing new mail` with `(no body)` — both FR-7 candidates. SystemUI's `charging_state` dominated the entire capture window, re-posting roughly every 30–50 seconds for over an hour.

**Not verified:** `node --check` passes but the rewritten gap detector has not been exercised against a real reordering event — the run that motivated it is already over, and the fix is unproven against live traffic. The receiver process still running was started before this change. **GCash remains untested and may not be testable in this configuration:** it refuses to operate with Android Developer Options enabled, which USB debugging requires, so the entire adb-based development loop is mutually exclusive with it. GoTyme answered M1's question, so this was not pursued; it means any GCash-specific notification shape is unmeasured.

### Close the M1 loop on device; record clock skew as a constraint on Q6's TTL
**Type:** Added
**Time:** 21:39 +08:00
**Files:** `notification-sync-prd.md`, `tools/m1-receiver.mjs`
**Related:** §10 M1, §7, §12 Q6, FR-7, FR-26

**M1's core objective is met.** A real notification — SystemUI's charging notice — was captured by the Kotlin listener on the A52, forwarded over the USB reverse tunnel, and rendered on the receiver with `sourceApp`, `title`, `body` and `timestamp` all populated. Eight forwarded payloads arrived with **no sequence gaps** (FR-26) and **no §7 violations**: the receiver's `key` assertion never fired, so the structural exclusion in `toForwarded()` holds in practice and not just in review.

**The most useful result was a defect in the measurement, not a success.** Arrival time minus `postTime` came out **negative** — rendered absurdly as `+-17ms` — because the phone's clock runs roughly 10–20 ms ahead of the laptop's. The formatting was fixed, but the underlying finding is recorded against **Q6** because it constrains the implementation rather than merely annotating it: a per-app TTL is the receiver comparing the sender's timestamp to its own clock, which inherits the skew between two devices that were never synchronised. At milliseconds this is invisible. On a phone whose clock has drifted minutes — no NTP, a manually set clock, a flat battery — a 15-minute TTL would discard live notifications or present dead ones as current, with nothing in the output pointing at a clock. Q6 now says the TTL must either be computed sender-side and forwarded as remaining lifetime, or carry enough information for the receiver to detect skew and decline to enforce. Left undecided deliberately; recorded so the naive subtraction is not written by default.

**FR-7 demonstrated itself without being asked to.** The only genuine notification to arrive during the run was SystemUI's `charging_state`, re-posting 51 seconds later as the next sequence number — the exact traffic FR-7 exists to exclude, forwarded at full cost because M1 has no filtering by design. Note the 51-second interval sits well outside the 20-second modal interval measured on 2026-08-12; that figure stands, but the spread is wider than one number suggests.

**Also observed, for whoever builds the receiver UI:** SystemUI's `body` contains a literal newline (`75% (22 m until full)\nCharging will stop at 80%…`). A receiver that assumes a single-line body will render it wrong. This is the second embedded-newline surprise in this project, after WhatsApp's notification key on 2026-08-12.

**Not verified:** everything crossed a USB cable, not a radio. No notification has yet traversed Wi-Fi, so nothing here measures real network latency, packet loss, or behaviour when the receiver is unreachable — and the negative-lag figure means even the measured timings carry an unquantified clock offset. Only SystemUI and synthetic test payloads were forwarded; no financial notification, the actual use case per §1.1, has been through the path. The sender's timeout, per-row failure rendering, and the `failed` state remain unexercised because nothing has failed yet.

### Default the M1 receiver address to the USB reverse tunnel
**Type:** Changed
**Time:** 21:35 +08:00
**Files:** `app/App.tsx`
**Related:** §10 M1

The receiver address now defaults to `127.0.0.1:8787` rather than the laptop's LAN address. `adb reverse tcp:8787 tcp:8787` maps the laptop's receiver port onto the phone's own loopback, so the loop closes over the development cable already attached.

**Why:** the first over-the-air attempt was blocked by the network, not by the code. `dumpsys wifi` showed the A52 with Wi-Fi enabled but `Supplicant state: DISCONNECTED, IP: null` — it was on mobile data, with no route to the laptop at all. Two further failure modes sat behind that one and fail silently: the host IP moves with DHCP, and Windows Firewall drops inbound connections on 8787 without a rule. None of the three teach anything about the payload shape that M1 exists to test, so spending the first run on them is spending it on the wrong problem.

**Verified end to end over the cable**, not assumed: a payload POSTed from `adb shell` on the phone reached the laptop receiver and printed correctly (`[4] seq=10 … USB tunnel test`). `npx tsc --noEmit` clean.

**The LAN run is deferred, not cancelled**, and the code comment says so. M1 is not finished until a notification crosses the phone's radio rather than a USB cable, because the radio is what M3 will actually depend on — a tunnel that works proves the data shape, not the transport.

**Deliberately not recorded here: the Wi-Fi credential.** It was retrieved from the laptop's saved profiles at Effie's request and handed over in conversation only. This file is committed to a GitHub remote as of today, so writing a password into it would publish it — the same reasoning that keeps `GITHUB-ACCOUNTS.md` out of every repository.

### Build the M1 LAN forwarding path: sender, wire format, and a laptop receiver
**Type:** Added
**Time:** 21:30 +08:00
**Files:** `tools/m1-receiver.mjs`, `app/lanForwarding.ts`, `app/App.tsx`
**Related:** §7, §10 M1, FR-26, FR-10, §12 Q6

First code of M1. `app/lanForwarding.ts` defines the wire type and the send call; `app/App.tsx` gains a receiver-address field, a forwarding switch, a test-payload button and a per-row delivery state; `tools/m1-receiver.mjs` is a zero-dependency Node HTTP server standing in for the receiving phone.

**The wire format is §7's `ForwardedNotification` verbatim** — `id, seq, sourceApp, title, body, timestamp, deviceLabel` — rather than a shape invented for convenience. M1 exists to test that list against real traffic before M2 wraps it in AEAD, so matching it exactly is the experiment. `packageName` is deliberately absent: FR-10's filtering runs on the sender, so the receiver has no use for it, and finding out whether that is wrong is part of the milestone.

**`key` is excluded structurally, not by discipline.** `toForwarded()` names every field explicitly instead of spreading the captured object or using `Omit<…, "key">`. With a spread, any field added to `CapturedNotification` later would reach the wire silently; explicit construction forces a human decision. This is the §7 constraint recorded on 2026-08-12, and the receiver independently asserts on it — a payload containing `key` prints a violation rather than being quietly accepted, so the guard holds even if the sender is rewritten.

**Sequence numbers are taken only by notifications actually sent**, and synchronously before the `await`, so a gap at the receiver means a lost delivery (FR-26) rather than a notification the user chose not to forward or two captures interleaving. The receiver tracks the highest seq per device label and prints a gap warning. That is FR-26's measurement working on day one of M1 rather than being retrofitted at M5, where it decides whether a foreground service is needed at all.

**Sends are not awaited inside the native listener callback**, which would apply backpressure to capture itself, and failures drop rather than queue. Queue and retry are M3; adding them here would conceal exactly the losses M1 should be surfacing.

**Verified:** `npx tsc --noEmit` clean. The receiver was exercised locally over loopback with three payloads — a normal delivery printed correctly, a deliberately skipped sequence number produced `⚠ GAP: 1 notification(s) lost`, and a payload carrying `key` produced the §7 violation line. Cleartext HTTP was confirmed permitted rather than assumed: React Native's generated `android/app/src/debug/AndroidManifest.xml` sets `android:usesCleartextTraffic="true"`, so no `expo-build-properties` change or rebuild is required for a dev build.

**Not verified — nothing has been sent from the phone.** The sender code has never run: no notification has been forwarded from the A52, the address field's default (`192.168.1.11:8787`, the laptop's Wi-Fi address) has not been reached from the device, and Windows Firewall has not been configured to admit inbound connections on 8787, which is the most likely first failure. The per-row delivery states, the test-payload button and the abort-based timeout are all unexercised on device. `DEVICE_LABEL` is hardcoded to "Samsung A52" pending the M2 pairing flow.

### Write the financial-use-case amendment into the PRD as v0.7
**Type:** Changed
**Time:** 21:26 +08:00
**Files:** `notification-sync-prd.md`
**Related:** §1.1, §7, §12 Q6, §10 M5, FR-10

Added §1.1 recording that the primary use case is financial notifications; amended §7's stated metadata exposure; amended Q6's proposed TTL default; added revision-history entry v0.7. **Supersedes the "not verified — none of the above has been written into the PRD" note in the 21:23 entry below**, which was accurate when written and is now stale. Effie approved the amendment.

**Why:** the consequences had been reasoned out and logged but existed only in the changelog, where a future session planning M4 or M7 would not encounter them. The PRD is the stated source of truth for FRs and open questions, so a requirement-affecting finding that lives outside it is a finding that gets re-derived or, more likely, missed — Q6's 15-minute TTL in particular reads as settled unless the amendment sits next to it.

**Amendments append and mark what they supersede rather than replacing text.** §7's original gaming-activity wording is quoted inside the amendment that corrects it, and Q6's original reasoning is left intact above its inversion. §1's gaming narrative is kept and §1.1 added beneath it. This follows the PRD's own never-rewrite-history rule and keeps the reasoning legible to someone who wants to know why the default changed.

**No FR was added, renumbered, or changed in meaning**, and Q6 is amended rather than marked answered — the mechanism (per-app TTL) is now confirmed but the shipped default is still open.

**Not verified:** the use case remains a stated goal rather than observed behaviour — no financial notification has been captured or forwarded by this project. The claim in §7 that payload size may carry signal for a bank's consistent notification format is explicitly flagged in the PRD as reasoning rather than measurement; no size distribution has been collected for any app.

### Record the money-notification use case; enable notification permission for four wallet apps
**Type:** Decided
**Time:** 21:23 +08:00
**Files:** — (device configuration and a stated product goal; no project file changed yet)
**Related:** §1, §7, FR-10, §12 Q6, §10 M5

Effie stated that a primary goal is forwarding **financial notifications** — GCash, GoTyme and similar — to a second phone, and asked for the device's notification permissions to be turned on because they were known to be off. Five relevant packages were found on the A52: `com.globe.gcash.android` (already `allow`), plus `ph.com.gotyme`, `com.paymaya`, `ph.seabank.seabank` and `com.shopee.ph`, all four explicitly blocked. All four were granted.

**`cmd appops set` was insufficient and would have looked like it worked.** Setting the package-level mode left `Uid mode: POST_NOTIFICATION: ignore` in place alongside a package-level `allow`, and the UID mode takes precedence — the apps would have stayed silent while the tooling reported success. `pm grant android.permission.POST_NOTIFICATIONS` was the route that took, and it collapsed the conflicting modes to a single clean `allow`. Recorded because the misleading intermediate state is easy to accept as done.

**Maya and SeaBank carried `USER_FIXED`**, meaning Effie had explicitly denied them rather than never having been asked. That deliberate choice was overridden on request; the revoke commands were handed back.

**Why this matters beyond the device — the PRD is written around the wrong use case.** §1 frames the product around a gaming phone, and three requirements inherit that framing:

- **Q6's tentative answer inverts.** It reasons that a late "stamina full" is worse than no notification and proposes a 15-minute default TTL. A late "you received ₱5,000" is still fully useful, so financial apps want a long or unbounded TTL. The per-app TTL mechanism survives; the default does not.
- **§7 understates the metadata exposure.** It says the relay can infer "when a user's gaming phone is active and roughly how busy it is". With wallet apps forwarded, the same timing and volume data reveals **when the user receives money and how often** — a materially more sensitive inference from identical metadata, and §6.7's privacy policy must not describe the weaker version.
- **M5 changes category.** A dropped game notification costs nothing; a dropped payment notification defeats the stated purpose. The 72-hour soak test moves from hardening to the measurement that decides whether the product is usable.

FR-10's deny-by-default and the end-to-end encryption were already correct for this and are now load-bearing rather than principled — transaction amounts crossing a relay in plaintext would be a different product.

**Not verified, and deliberately not acted on:** none of the above has been written into the PRD. It is recorded here first because amending §1, §7 and Q6 is a substantive spec change that was offered and not yet approved. Also unverified: whether the four apps actually deliver notifications now — the OS-level permission was granted and confirmed, but each app's own in-app notification settings and Android's per-channel blocks sit underneath it and were not inspected. No real transaction was observed.

### Re-verify the M0 build and capture path after a month idle
**Type:** Added
**Time:** 21:23 +08:00
**Files:** — (runtime verification only)
**Related:** §10 M0, §10 M1, FR-5

`npx expo run:android` succeeded on the Samsung A52 after a month with no build, and capture was confirmed live rather than assumed. A synthetic notification posted via `cmd notification post` produced `captured com.android.shell … style=BigTextStyle title=present text=present`.

**Why that one log line settles it:** the service logs `dropped — no JS listener attached` when the emitter is null and only reaches the field-presence log after that check passes. A `captured` line therefore proves the native listener is bound *and* the JS bridge is attached — the two halves M0 exists to demonstrate — rather than proving only that the APK compiles.

**The notification-access grant survived reinstall.** `enabled_notification_listeners` still contains `com.zeyune.notifsync/expo.modules.notificationlistener.NotifSyncListenerService`. This was worth checking rather than assuming: a reinstall can leave the grant visible while the binding is broken, which is the failure `requestRebind()` exists for.

**Also noted:** the first `expo run:android` failed with `No Android connected device found` — the phone was not plugged in, not a toolchain fault. And `npm audit` reports 17 vulnerabilities (10 moderate, 7 high); `npm audit fix --force` was **rejected, not deferred**, because it would bump packages past the `expo@~57.0.11` pin that the prebuild and native module are aligned to, and the resulting breakage presents as a native build error rather than a dependency one. `npx expo-doctor` is the right tool for version health here.

**Not verified:** no row was observed in the app's own UI on screen — the conclusion that the JS listener received the notification is inferred from the service's logging order, not from looking at the device. `bigText=null` despite posting with `-S bigtext`, which is a quirk of the shell posting tool and was not investigated.

### Correct three false statements in `CLAUDE.md`
**Type:** Fixed
**Time:** 21:09 +08:00
**Files:** `CLAUDE.md`
**Related:** §10 M0, §10 M1, §12 Q1, §12 Q2, §12 Q9

The repository's orienting file still described the state of the project as of 2026-08-10 and was wrong in three ways, each of which would misdirect a session that trusted it. Milestone set to M1 with M0 recorded complete; the build-toolchain section replaced with a verified inventory; the "no code until Q1 is answered" gate replaced with a statement that the gate is cleared, plus what Q2 and Q9 actually block.

**Why:** this is the file read first in every session, and all three errors pointed the same way — toward not building. It claimed M0 was the current milestone a month after M0 finished, claimed no JDK, SDK or `adb` were installed and that "nothing Kotlin has ever been compiled" when the listener had been running on a Samsung A52 since 2026-08-11, and carried a hard gate whose own premise the PRD had already recorded as false. A session opening this file would have concluded that implementation was blocked and that it could not build, which is the opposite of the true position.

**Verified before writing, not assumed:** `java -version` returns OpenJDK 17.0.20 (Temurin), `adb version` returns 1.0.41, and `ANDROID_HOME` resolves to `C:\Users\Effie\AppData\Local\Android\Sdk`. The previous text was contradicted by the changelog's own history, but the replacement claim was checked against the machine rather than inferred from it.

**Each correction says what it supersedes rather than silently replacing it**, so the file does not read as though it were always right. The retired gate in particular is marked retired rather than satisfied, with an instruction not to reinstate it without a matching PRD change — it was written when Q1 could still have returned "this category is not permitted", and it cannot return that any more.

**Not verified:** the build toolchain was confirmed present, not confirmed working — no build was run this session, so it is unproven that `npx expo run:android` still succeeds after a month. Q9's collision claim is carried over from the PRD and still rests on search results rather than a first-party Play listing.

### Publish the repository to GitHub as `Zeyune/notisync`
**Type:** Decided
**Time:** 21:06 +08:00
**Files:** — (no file changed; remote and commit commands handed over for Effie to run)
**Related:** §12 Q9

The project had existed for a month as a local-only git repo with no remote — confirmed by `git remote -v` and corroborated by `~/.claude/GITHUB-ACCOUNTS.md`, which listed `notifsync` under "repos with no remote yet" as of 2026-08-23. Effie created `https://github.com/Zeyune/notisync.git` and asked for the push commands. Handed over: stage, verify with `git status`, commit the pending 2026-08-12 work, `git branch -M main`, add origin, push with upstream.

**Why:** ten commits and a month of findings sat on one disk with no second copy. The uncommitted 2026-08-12 work was the sharper exposure — the `StatusBarNotification.key` constraint now in §7 is the most consequential thing the project has learned, and it existed only as an unsaved working-tree edit.

**GitHub's own setup snippet was rejected rather than run.** It assumes an empty directory: `git init` over an existing ten-commit repo, and `git add README.md` + `git commit -m "first commit"` would have stacked a placeholder README on top of real history and mislabelled it as the first commit. The handed-over block drops both and commits the actual pending work instead.

**Flagged, not resolved — the repo name is `notisync`, without the `f`.** The local folder and the product name throughout the PRD are *NotifSync*. Q9 is open because a Play listing named "Notify Sync: Secure E2E Mirror" already collides in store search, and `notisync` sits closer to that collision than `notifsync` does; the candidate recorded under Q9 was `noti-noti`. Renaming is cheap before anything links to the repo. Q9 remains unanswered and this entry does not answer it.

**Not verified:** the commands were handed over, not run — per the standing rule this session does not commit or push — so it is unconfirmed that the push succeeded or that the remote now holds anything. Whether the repository was created public or private was not stated; if public, §9.1's Play-policy reasoning and the `specialUse` justification strategy in Q8 are now readable by anyone, which is consistent with the Apache-2.0 decision but was not an explicit choice. `~/.claude/GITHUB-ACCOUNTS.md` still records this repo as having no remote and needs updating once the push is confirmed.

## 2026-08-12

### Confirm FR-36 on a second app; rule that notification keys must not reach the relay
**Type:** Added
**Time:** 21:57 +08:00
**Files:** `notification-sync-prd.md`
**Related:** FR-6, FR-7, FR-8, FR-9, FR-20, FR-36, §7, §10 M1

A 29-minute capture window intended for a messaging-app sweep instead caught Gmail and Google Play services. Three findings, all recorded in the PRD.

**FR-36 generalises, and the flag is the only safe test.** Gmail posts a group summary alongside every message — four messages, four summaries, all skipped, exactly 1:1 — so summary-pairing is not WhatsApp-specific. **The two apps mark summaries incompatibly:** WhatsApp's summary carries the *same id with a null tag*; Gmail's carries *id 0 with the same tag* as the message. A null-tag heuristic would have failed on Gmail and a matching-id heuristic would have failed on WhatsApp. `FLAG_GROUP_SUMMARY` catches both, which is what FR-36 already tests — the implementation choice was right for a reason that was not visible when it was made.

**New constraint in §7: `StatusBarNotification.key` must never leave the device.** Play services was observed posting `a:GMSCORE_SYNC_RENDERER:…:117863126120006353924` — the trailing field is a **Google account ID**. WhatsApp and Messenger embed stable per-conversation identifiers in the same position. Forwarding keys would hand the relay a persistent account identifier and a conversation graph as plaintext metadata, materially exceeding the exposure §7 declares and defeating the point of encrypting payloads. The key was already absent from `ForwardedNotification`; §7 now says *why*, so it does not get added back for a plausible-sounding reason like idempotency or diagnostics. **This is the most consequential finding of the session** and it came from an app nobody set out to test.

**FR-7's cost was understated.** SystemUI's `charging_state` re-posts every **20 seconds** — modal interval across ~104 gaps — not "roughly once per minute" as recorded on 2026-08-11. That is 3/minute, or **30% of FR-9's whole default per-app budget**, burned indefinitely while charging. Supersedes the 08-11 figure.

**Also noted, unrecorded in the PRD:** Gmail's per-message id changes on every notification (`1069429549`, `607464166`, `-811771358`) while its tag repeats per thread — the inverse of WhatsApp, whose full key was stable across nine messages. So `key` is a conversation identifier for one app and a per-message identifier for the other, and **no dedupe or grouping rule may assume either**. Left out of FR-8 pending more apps.

**Not verified — the sweep did not happen.** The phone disconnected from USB at 21:56 and killed the capture. Telegram, Messenger, Viber, Instagram and Teams remain untested. **Discord is recorded as untested by decision**, not oversight: OS-side it was fully permitted to notify (POST_NOTIFICATIONS granted, `importance=DEFAULT`, DND off, standby bucket 10/ACTIVE, not in foreground), so the block was inside Discord — most likely its Push Notification Inactive Timeout routing the mention to an active desktop client. Effie chose to move on rather than sink time into it. Gmail's `BigTextStyle` is not a substitute for the untested `MessagingStyle` apps.

### Key capture rows on a per-delivery id instead of the notification key
**Type:** Fixed
**Time:** 21:30 +08:00
**Files:** `app/App.tsx`
**Related:** FR-8, FR-20, §10 M0, §10 M1

The M0 list used `StatusBarNotification.key` as its React key, which React reported as `Encountered two children with the same key` for both WhatsApp and SystemUI. Added a `CaptureRow` type carrying a `captureId` assigned per delivery from a `useRef` counter, and keyed the `FlatList` on that.

**Why the old key was wrong, not merely unlucky:** `key` identifies the *notification*, and Android holds it stable while an app updates that notification in place — which is exactly the behaviour recorded under FR-8 an hour earlier. A list that appends every delivery therefore collides by construction, and any app that updates a notification triggers it. SystemUI's `charging_state` did so once a minute.

**Deliberately not deduplicated.** Collapsing re-posts in the UI would have silenced the warning too, and it was the wrong fix: the spike exists to measure capture volume, and duplicate rows are the raw evidence feeding FR-8's dedupe design and FR-9's rate limit. Suppression belongs at M4, downstream of a measurement that must stay visible until then.

**The counter is incremented in the event handler, not the state updater** — React may invoke an updater more than once for a delivery, which would burn ids and, under a future concurrent render, could hand two rows the same one.

**Separate finding, from the same error text: WhatsApp's notification key contains a literal newline**, between the tag and the uid. Confirmed at byte level in the capture log — it is why logcat split every WhatsApp line in two and re-stamped the continuation with a fresh timestamp, an artifact previously misread as ordinary wrapping. Harmless inside JSON, which escapes it, but any line-delimited framing or naive log parsing at M1 will mangle it and present as a delivery fault.

**Also: WhatsApp's tag is a conversation identifier, not a message one.** All nine per-chat notifications in the window shared one tag and all nine summaries shared a null tag. Same shape as the Messenger thread ID noted 2026-08-11, and a grouping key for FR-20 available without reading content.

**Unexplained, recorded rather than smoothed over:** the React error renders the tag as ending `c4=0` before the newline where logcat renders it ending `c4=`. A one-character difference between two renderings of the same key. It does not affect the fix and was not chased further.

**Verified:** `npx tsc --noEmit` clean. **Not verified:** the warning was not observed to stop on device — the fix relies on Metro hot-reloading and the app was mid-capture-sweep, so no fresh duplicate-key error has been confirmed absent.

### Verify FR-36 and the MessagingStyle capture path against real WhatsApp traffic
**Type:** Added
**Time:** 21:24 +08:00
**Files:** `notification-sync-prd.md`
**Related:** FR-6, FR-8, FR-9, FR-36, §10 M0, §10 M1

Ran the M0 spike on the Samsung A52 against real incoming WhatsApp messages and read the field-presence diagnostics. Both items M0 was carrying as unproven are now settled, and both PRD requirements carry the measurement.

**FR-36 fires, on the flag it targets.** Nine messages produced nine per-chat notifications and nine group summaries; all nine summaries were skipped, all nine per-chat notifications captured, one summary per message. **The `ranker_group` worry was unfounded** — WhatsApp's own summary carries `FLAG_GROUP_SUMMARY`, and no `ranker_group` appeared in the window at all. This was the open question that mattered most: FR-36 had been shipped without its code path ever executing.

**`EXTRA_TITLE` + `EXTRA_TEXT` is sufficient for real `MessagingStyle`.** Every WhatsApp per-chat notification populated both, with `bigText` null and `textLines` empty. No `MessagingStyle` fallback is needed, which was the previous session's "first thing to check before M1". Synthetic notifications had suggested this; real ones confirm it.

**A null tag does not imply a summary.** WhatsApp posts a second notification (id 11, null tag, no style template) that populates both text fields and is correctly captured. Any future summary detection must use the flag, not the tag.

**New, for FR-8:** one chat's notification is re-posted under a single unchanging key while `EXTRA_MESSAGES` accumulates 2→3→4→5→6→7, then three further re-posts with the array still at 7, the last eleven seconds after. Whether those tail re-posts carry new text is **not knowable from a presence-only log**, so whether FR-8's `(package, title, body)` key collapses them is unresolved — deliberately left to M4 rather than guessed at now.

**More FR-9 evidence:** eight per-chat captures inside 5.6 seconds, well past the 10/minute default, consistent with 2026-08-11's Gmail finding. Still not changing the number — see FR-9's note.

**Why record all of this rather than just fixing code:** none of it required a code change, and that is the point. The value was in converting two assumptions into measurements before M1 puts a network between capture and display, where a blank-body bug would present as a delivery fault rather than a capture one.

**Not verified:** WhatsApp only, Samsung only. Telegram, Signal, Discord and Messenger are untested and are not covered by the `MessagingStyle` finding. No screenshot of the device was taken and no notification content was logged or read, so all conclusions rest on field presence and structural counts.

### Correct the run directory for `expo run:android`
**Type:** Fixed
**Time:** 21:24 +08:00
**Files:** — (no file changed; operational note)
**Related:** —

`npx expo run:android` was run from the repository root, where there is no `package.json`, producing `ConfigError` and prompting npm to fetch a throwaway `expo@57.0.12`. All Expo commands run from `app/`, which pins `expo@~57.0.11`. Recorded because the same mistake is likely to recur and the error message names a missing root `package.json` rather than the wrong working directory.

**Also noted:** the device runs a Secure Folder profile as user 150, so a bare `adb shell pm list packages` fails with a `SecurityException` rather than listing anything. Use `--user 0`.

## 2026-08-11

### Add FR-36 (drop group summaries) and field-presence diagnostics
**Type:** Added
**Time:** 22:22 +08:00
**Files:** `notification-sync-prd.md`, `app/modules/notification-listener/android/src/main/java/expo/modules/notificationlistener/NotifSyncListenerService.kt`
**Related:** FR-6, FR-7, FR-8, FR-9, FR-36

Added a diagnostic that logs *which* notification text fields are populated — never their content — plus the style template. Used it to settle whether `EXTRA_TEXT` is sufficient. Added **FR-36** to the PRD and implemented it: notifications carrying `FLAG_GROUP_SUMMARY` are dropped at capture. Also recorded the FR-9 measurement under FR-9 itself.

**Measured across styles:** `MessagingStyle`, `InboxStyle`, `BigTextStyle` and `MediaStyle` all populate `EXTRA_TITLE` and `EXTRA_TEXT`. **The suspected `MessagingStyle` capture bug does not exist** — reading those two fields is sufficient, and no `EXTRA_MESSAGES`/`EXTRA_BIG_TEXT` fallback is needed. Group summaries, by contrast, have every text field null.

**Why FR-36 is capture and not FR-7 filtering:** ongoing notifications carry real content some user might want forwarded, making their exclusion a preference that belongs to M4. A group summary is structurally empty under every configuration, so emitting one is a defect. WhatsApp posts a summary alongside every per-chat message, so without this each message forwards twice — once with content, once blank.

**Diagnostics log presence only.** Field names and structural counts, never values, for the same reason content is absent from the capture log: logcat is readable over adb.

**NOT VERIFIED — FR-36's implementation has never been observed to fire.** Ten synthetic notifications across five styles produced no group summary at all, so the code path is untested. Worse, the empty row that motivated this was a `ranker_group` — a system *ranker* artifact — while the implementation targets `FLAG_GROUP_SUMMARY`, the flag apps set themselves. **These may not be the same thing**, and if `ranker_group` does not carry that flag, this fix does not address the case actually observed. Confirming needs a real WhatsApp message and one log line; until then FR-36 is written and shipped but unproven.

**Also not verified:** real `MessagingStyle` from WhatsApp. The style findings come from `cmd notification post`, which constructs notifications simply; a real app may populate fields differently.

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
