# M3 — Relay + FCM: implementation plan

**Status:** approved 2026-09-13. Companion to [notification-sync-prd.md](notification-sync-prd.md), which remains the source of truth for every FR and open question. Where this document and the PRD disagree, the PRD wins unless this document says explicitly that it supersedes it.

**Continuation checkpoint — 2026-10-17, approximately 01:34–01:41 +08:00 (owner-reported):** FR-17 Revised Method A was approved but never executed, including its dry run, because Claude reached its weekly usage limit. [PROJECT_STATUS.md](PROJECT_STATUS.md) records the exact stopping point, immediate next task and owner prerequisites. It supersedes the older pending-approval wording below; M3.4 and real-device fetch verification remain open. Reconfirm production-monitoring authorization and scope before attaching on resumption.

**Verified update — 2026-10-11:** **M3.3 is complete; M3.4 reliability measurement remains open.** Actual Samsung capture reached Xiaomi through the deployed relay on separate networks: Samsung validated Wi-Fi → Xiaomi validated cellular, as approved by the user because Samsung has no mobile data. The receiver passed background, locked and ordinary-process-termination cases with user-confirmed native notifications and relay deletion after ack. Force-stop recovery was tested separately. Both phones retain registered identities and paired directional keys. Samsung must remain foregrounded for current sender capture. See [the real-device QA record and checklist](notification-sync-m3-qa.md) and the latest changelog for evidence and remaining checks.

**Verified update — 2026-10-17:** **The M3.4 20-notification burst ran; M3.4 remains open.**

- Genuine Samsung capture reached the Xiaomi, locked on mobile data: 21 of 21 delivered and displayed (one preflight plus 20). There were no duplicates or sequence gaps, pending ack was 0, the sender outbox was empty and relay pending returned to 0.
- Capture to Android post took a median 4.25 s (2.93–5.70 s, ±0.15 s).
- The burst's visibility criterion **failed**: HyperOS's per-app notification-count limiter removed the nine oldest delivered notifications from the shade, leaving 12 of 21 visible.

See [the burst record](notification-sync-m3-qa.md#m34-burst-test--2026-10-17) for evidence, per-criterion results and what is verified versus inferred.

**Verified update — 2026-10-17, later:** the first FR-17 fetch-path attempt delivered inline, so **the fetch path was not exercised**.

- Android truncated the synthetic 2,400-character body to 1,024 characters before capture. The sealed payload was 1,696 base64 characters, under the relay's 2,800-character inline limit.
- Monitoring the relay showed no `GET /blob`.
- Inline delivery passed: captured, accepted (202), authenticated, displayed exactly once, acknowledged (200), relay 0, pending ack 0, sequence gaps 0.
- A revised method awaits approval: a 1,024-character ASCII title plus a 1,024-character body, predicted at 3,040–3,044 base64 characters.

See [the attempt record](notification-sync-m3-qa.md#fr-17-fetch-path-attempt--2026-10-17) and [the open findings](notification-sync-m3-qa.md#open-findings), none of which is resolved.

### Code audit and change plan (before implementation, 2026-10-11)

| Component | Verified starting state | Change |
|---|---|---|
| Capture and LAN | Native capture and paired LAN encryption existed; `App.tsx` called only `sendToReceiver` | Keep LAN explicitly selectable; default actual sends to relay |
| Identity and pairing | SecureStore persisted identity/peer; concurrent initialization could generate competing identities; unpaired encryption used a public development key | Single-flight initialization; require paired directional keys; keep existing identities |
| Relay client | Register/send/fetch/ack existed; UI registration was button-only; send discarded `pushed` state | Launch/resume and token-refresh registration; scoped registration secrets; separate acceptance from delivery |
| Receiver | No FCM task, decrypt, native display, receipts or acks wired into the app | Expo TaskManager imported from `index.ts`; AES-GCM receive-key decryption; native display then persisted receipt and ack |
| Reliability | Sequence reset at React mount; no retry or duplicate ledger | SQLite per-pair counters, encrypted outbox/backoff, duplicate receipts and pending acks |
| Relay/FCM | Deployed health check passed; errors could echo tokens; a malformed-message 400 could clear a working token; no catch-up endpoint | Redact errors; clear only explicit UNREGISTERED tokens with a token-match condition; authenticated bounded `/pending` |
| Privacy | Capture logs included Android notification keys; laptop receiver printed plaintext; Expo debug display logs include local content | Remove key/content logging and public-key fallback; extend existing native module for synchronous notification display |

### Implemented behavior and limits

- `forwarding.ts` encrypts before persisting/sending, queues transport failures with exponential backoff, expires local outgoing ciphertext after 24 hours, and reports a relay 202 as acceptance rather than observed delivery. Retry scheduling runs while sender JS is active and resumes on launch.
- `receiver.ts` accepts the installed SDK 57 native FCM data shape plus Expo JSON data, loads SecureStore pairing headlessly, authenticates AES-GCM before display, checks app permission and channel state, and serializes duplicate processing. Only the paired sender's key can authenticate inline payloads; fetched blobs also check sender identity.
- The existing Android module posts with a stable `(sender, notification ID)` tag, private lock-screen visibility and a source-device group. It skips its own notifications at capture to prevent forwarding loops. It returns only after Android `notify` succeeds. This is API acceptance, not proof that a user saw the shade; QA must observe it.
- Receipt persistence precedes acknowledgement. Ack failures are retained for retry on resume; duplicate messages retry acknowledgement without a second display. A crash between notify and receipt persistence can re-post the same native tag. Exactly-once audible alerts across a crash are not guaranteed.
- Catch-up retrieves at most 50 unexpired blobs per request and only for the authenticated recipient. It runs on resume and periodically while foregrounded; it does not substitute for testing FCM while backgrounded/locked. No database migration or production-secret change was needed.
- Relay secrets are scoped to relay origin + public identity; the previous default-relay secret is migrated locally for existing installations. A 401 is surfaced; the app does not rotate identity or overwrite production credentials to work around it.
- Token refresh is synced when JS is alive, and the current native token is re-read on each foreground launch/resume. Refresh while JS is absent is reconciled on next resume; a native token-upload worker remains unimplemented.
- **Sender capture while its JS runtime is absent still drops notifications.** The encrypted JS outbox cannot recover a capture that never reached JS. Keep Samsung foregrounded during M3 receiver tests. Native sender recovery, OEM hardening, soak/burst tests, filtering, QR scanning and iOS remain outstanding.
- Receipts contain delivery IDs, sequence numbers and times, without notification text. They currently persist until app data is cleared; bounded ledger compaction and long-term diagnostics/history are later work.

### Commands and observed results (2026-10-11)

From `app/`: `npm.cmd run typecheck`, `npm.cmd run typecheck:relay`, `npm.cmd test` (11 tests), `npm.cmd run test:pairing` (7 checks), and `npm.cmd run test:relay` (3 tests) passed. `expo prebuild --platform android --no-install` and `expo-modules-autolinking resolve -p android` succeeded. `node --check tools/m1-receiver.mjs` passed from repository root. Gradle `:app:assembleRelease --console=plain` succeeded in 9m17s, including the native receiver module. The diagnostic arm64 rebuild passed in 50s; the last code-changing build, including the native decrypt adapter fix, passed in 54s with `:app:assembleRelease -PreactNativeArchitectures=arm64-v8a --console=plain`. That APK is installed on both phones. PowerShell blocks `npm.ps1`; use `npm.cmd`. Dependency installation reported 30 vulnerabilities; no broad audit fix was attempted.

Wrangler deployment dry-run passed. The updated Worker was deployed as version `491a39d0-cd81-43d5-8093-e1f10866be10`; D1 and the hourly trigger were retained, and no Firebase secret was changed. All 19 existing smoke checks passed against production using synthetic device records and random ciphertext. The smoke test creates synthetic device rows; it does not read real registration secrets or tokens.

Both authorized phones accepted `adb install -r`, preserving data: Samsung `RZCR306W59F` (SM-A526B) and Xiaomi `75697t8pobuslrpn` (Redmi Note 12 Pro). Both show notifications allowed, receiver ready and registered with hidden native FCM tokens. D1 corroborated retained public-key prefixes `F2UCRJq0` / `Ilo0wa45`, token lengths 142 and fresh registration times without reading token values or secrets. Reciprocal pairing and directional fingerprints matched crosswise; identity/pairing survived APK updates, ordinary headless startup and force-stop/reopening. Xiaomi's HyperOS blocks adb input injection, so its pairing, Home, lock and shade checks were performed manually by the user.

**Device QA evidence, all +08:00:** the first FCM task rejected a payload at 17:19:37. Real-device investigation found the installed Expo Crypto Android `fromCombined` requires decoded bytes despite the string-capable TS signature. After the adapter fix and 54s build/install, catch-up displayed the retained payload at 17:23:28, and fresh push displayed at 17:24:27. Actual captured notifications then displayed at 17:25:40 (same Wi-Fi), 17:30:43 (background, same Wi-Fi), 17:32:23 (background, Wi-Fi → cellular), 17:34:01 (locked on cellular) and 17:35:56 (ordinary termination, new headless process). The user observed each receiving notification; D1 pending returned to 0 after acknowledgement. `am kill` was verified to leave `stopped=false`, distinct from force-stop.

During force-stop, the process was absent with `stopped=true`, no new receiver execution occurred, and one encrypted blob remained. Reopening produced `catch-up displayed` at 17:42:05 and a user-confirmed notification. A natural duplicate at 17:45:57 followed the receipt/ack branch without another native display call. A controlled sender outage queued encrypted data; Wi-Fi restoration and sender resume drained the queue and produced `push displayed` at 17:53:02. The user confirmed the exact final title `M3 QA final-locked-03` and body `Synthetic final locked retry check 03`. The receiver was foregrounded for this final retry; the test name is not evidence of another locked-state pass.

Earlier PowerShell capture commands shortened multiword titles to `M3` and bodies to case suffixes. Those captured notifications arrived, but historical claims of their full literal title/body are superseded by this correction. Repeatable QA now passes one quoted Android command to `adb shell`. A large synthetic notification was visible at 17:37:25, but its actual wire size and inline-versus-fetch route were not recorded: real-device fetch-only proof remains pending. The final user observation and Xiaomi UI agree on **queued 0, pending ack 0, sequence gaps 0**; D1 pending is 0. The implementation logs fixed outcomes, without notification plaintext, secret keys or sensitive tokens. Forwarding was left off on both phones.

**Remaining work (updated 2026-10-17):**

- Real-device fetch-only route: one attempt on 2026-10-17 ran inline; a revised method awaits approval.
- Cold-start burst.
- Soak, and sustained-load FCM priority.
- Blocked permission/channel recovery.
- Natural token rotation.
- Ack-network failure.
- LAN regression with a matching development peer.
- Production cron observation.
- A product decision on HyperOS's per-app shade limit (PRD §12 Q10).
- The catch-up diagnostic that is never cleared on success.

The 20-notification burst and calibrated burst latency are done. Native sender capture without JS, autonomous token-upload/retry workers and receipt compaction remain unimplemented.

**Exact next manual test (updated again 2026-10-17; pending approval):** FR-17's fetch-only route, revised Method A.

- Dry-run the notification with forwarding off, and confirm Android stores a 1,024-character title and a 1,024-character body.
- Then forward one genuine capture whose sealed payload is predicted at 3,040–3,044 base64 characters.
- Show `GET /blob` 200, a single display and `POST /ack` 200.

See [the revised steps](notification-sync-m3-qa.md#fr-17-revised-method-a). The earlier 2,400-character-body procedure is superseded: Android truncates notification text to 1,024 characters.

## Context

**The original problem:** M1/M2 delivery required both phones on the same network. Capture, pairing, encryption and delivery worked on real hardware over LAN. PRD §1 lists this limitation as the reason KDE Connect fails: *"LAN-only. Useless the moment the two phones are on different networks."* The verified update above records the current relay implementation and off-network result.

M3 replaces the local network with a relay plus platform push, so a notification reaches phone 2 **from anywhere, with the receiving app killed**. PRD §10 always intended M1's LAN loop to be thrown away here.

**Decisions made 2026-09-13:**

| Decision | Choice |
|---|---|
| Relay host | **Cloudflare Workers + D1** — 100k requests/day, 100k D1 row-writes/day, never sleeps |
| Scope | **Android → Android only.** iOS receiver (FR-35) deferred: needs a Mac and a $99/yr Apple membership |
| Push transport | **Direct FCM** from our own relay. No Expo Push Service — it would put a third party in the path of a product whose pitch is that there isn't one (FR-30) |

*Why not Supabase, which §8 names as the obvious candidate:* its free tier **pauses a project after 7 days of inactivity**. For a relay used daily that would rarely trigger, but the failure is silent — notifications simply stop arriving and nothing says why. FR-25's heartbeat and FR-33's diagnostics exist because silent cessation is this product's worst outcome, so an infrastructure component that fails that way by design works against the requirement. Cloudflare's allowance is also roughly 6× larger: 100k requests *per day* against Supabase's 500k Edge Function invocations *per month*.

*Why D1 and not Workers KV:* KV's free tier permits **1,000 writes per day**, and the relay writes one row per notification. D1 allows 100,000 row-writes per day against the same Workers plan.

**Explicitly out of scope:** iOS, QR pairing (M2's remainder — manual entry works), filtering (M4), foreground service (M5 decides by measurement, per FR-23). The 2026-10-11 request preserves LAN as an explicit development mode.

---

## Architecture

```
Samsung (sender)                  Cloudflare Worker + D1              Xiaomi (receiver)
  capture notification
  seal with sendKey  ──POST /send──▶  store blob, look up token
                                      call FCM HTTP v1  ──push──▶  background handler
                                                                    fetch blob if needed
                                                                    decrypt with receiveKey
                                                                    post local notification
                                    ◀──POST /ack────────────────────  delete blob (FR-32)
```

### The relay addresses devices by their X25519 public key

No new identifier is introduced. The pairing exchange **already** transfers the peer's public key, so after pairing each device already knows the other's relay address — there is no "how does the sender learn the receiver's relay id" problem to solve, and no extra field is needed in the pairing payload.

The relay learns a public key, which is public by definition. It still cannot decrypt: it holds no private key and no derived session key. This keeps §7's stated exposure unchanged.

### Device authentication

`POST /register` issues a random `deviceSecret`, stored in SecureStore beside the identity (FR-3). `/send` and `/ack` carry it as a bearer token. First-write-wins per public key.

**Known limitation, recorded rather than solved in M3:** someone who learned a public key before its device registered could squat the address. Public keys are unguessable 32-byte values shared only during pairing, so exposure is small — but it is written down here so it is not discovered later as a surprise.

### Push shape

**Data-only FCM message at high priority.** A notification-type message would display before we could decrypt it, showing ciphertext to the user. Data-only wakes the app's background handler, which decrypts and then posts a local notification — the Android analogue of what FR-35 specifies for iOS.

**Risk to measure, stated up front:** FCM can deprioritise apps that send high-priority data messages heavily. This is the Android twin of §12 Q4's APNs concern, which the PRD raises only for iOS. M3.4 measures it.

### Payload size (FR-17)

Payloads measured at M1 were 232–476 bytes, well inside FCM's ~4 KB limit. So: **inline ciphertext in the push when it fits, blob plus fetch handle when it does not.** The blob path is written in M3 but will rarely fire; it exists because FR-17 requires it, and because M4's filtering may admit larger notifications.

---

## Build order

Four slices, each independently verifiable.

### M3.1 — Relay skeleton
- `relay/` — `wrangler.toml`, `src/index.ts`, `schema.sql`
- D1 tables: `devices(public_key PK, secret, fcm_token, updated_at)`, `blobs(id PK, target, ciphertext, seq, created_at)`
- Endpoints: `POST /register`, `POST /send`, `GET /blob/:id`, `POST /ack`
- Scheduled worker deletes blobs older than 24 hours (FR-32)
- **Verify:** `wrangler dev` plus curl. Register a device, send a blob, fetch it, ack it, confirm the row is gone.

### M3.2 — FCM plumbing
- Firebase project; Android app registered as `com.zeyune.notifsync`; `google-services.json` into `app/`
- FCM service-account JSON stored as a **wrangler secret** — never committed, because this repository is public
- App obtains its **raw FCM token** and registers it with the relay
- **Verify:** the D1 row holds a real token; a push sent by hand from the relay arrives on the device.

### M3.3 — Real delivery (verified complete 2026-10-11)
- Sender: `app/forwarding.ts` routes actual capture through `app/relayClient.ts` by default; the paired LAN path remains explicitly selectable
- Receiver: background data-message handler → decrypt with `receiveKey` → post a local notification (FR-19, showing source app and originating device)
- FR-31: request `POST_NOTIFICATIONS` during onboarding — without it the receiver pairs successfully and displays nothing, which is a silent failure
- Keep `tools/m1-receiver.mjs` for the requested LAN regression path, requiring a paired development session and logging no notification text.
- **Verify:** Samsung → Xiaomi, both on Wi-Fi, then separate networks; receiver foregrounded, backgrounded and locked. Test ordinary process termination separately from force-stop.

### M3.4 — Off-network reliability measurement (open)
The baseline test is **Samsung and Xiaomi on independent internet connections, receiver backgrounded, locked or ordinarily terminated.** The user-approved Samsung Wi-Fi → Xiaomi cellular setup passed that baseline on 2026-10-11; Samsung has no mobile data. USB was used for observation, while the release bundle needed no Metro/USB transport. Latency calibration, burst and soak measurement remain outstanding. **Force-stop is excluded from this delivery expectation:** Android requires the app to be manually reopened; reopen/catch-up passed separately. This correction supersedes the original force-stop wording per the 2026-10-11 request and [Expo's platform guidance](https://docs.expo.dev/push-notifications/what-you-need-to-know/).
- Confirm FR-26 sequence continuity across the relay
- Confirm FR-32: the blob is deleted after acknowledgement
- Measure delivery latency, and whether FCM deprioritises under a burst
- **Burst result, 2026-10-17:**
  - FR-26 continuity held across sequences 22–42, and FR-32 deletion held.
  - Latency: median 4.25 s from capture to Android post, growing about 0.15 s per queued notification because the receiver handles one at a time.
  - No FCM deprioritisation was observed in one burst of 20; sustained load is untested.
  - HyperOS kept only the 12 newest NotifSync notifications in the shade, so "all 20 visible" failed.

---

## Files

**Added in this continuation:** `app/forwarding.ts`, `app/receiver.ts`, `app/deliveryProtocol.ts`, `app/deliverySql.ts`, `app/deliveryStore.ts`, `app/delivery.test.mts`, `relay/relay.test.mjs`, `relay/tsconfig.json`, `tools/verify-relay.mjs` and `notification-sync-m3-qa.md`.

**Existing files extended:** `app/relayClient.ts` (authenticated relay calls and scoped registration secrets), `app/push.ts` / `app/index.ts` (FCM lifecycle and headless task registration), `app/crypto.ts` (authenticated receive-key decrypt and native byte adapter), `app/pairingState.ts` (stable identity and paired keys), `app/App.tsx` (actual forwarding, status and transport selection), the existing notification-listener native module (private synchronous display and echo prevention), `app/lanForwarding.ts` / LAN tools (preserved paired transport), Expo configuration/dependencies and relay implementation. Existing D1 schema and production secrets were retained.

**Retired:** the public development-key fallback in app and laptop receiver. LAN tools remain available with a paired development session; `tools/peer-session.json` remains gitignored.

**Reuse, do not rewrite:** `deriveSessionKeys` (`app/pairingKeys.ts`), `seal` and `Envelope` (`app/crypto.ts`), `toForwarded` and the `ForwardedNotification` shape (`app/lanForwarding.ts`) — §7's field list was validated against real traffic at M1 and needs no change. The receiver's decrypt is the mirror of `open()` in `tools/m1-receiver.mjs`.

---

## Recorded deviation from §8

§8 names **`@react-native-firebase/messaging` plus Notifee**. The existing Expo implementation uses **`expo-notifications`** for the native token and background task, with the existing local notification-listener module extended for synchronous Android display. Native display avoids Expo debug logging of local notification content and checks permission/channel state before posting.

**Why:** one native dependency rather than two, first-party to Expo, and every first-party module used so far (`expo-crypto`, `expo-secure-store`) integrated cleanly on the first build — each native dependency costs a full rebuild on both phones. `getDevicePushTokenAsync()` returns the **raw FCM token**, so this does not route through Expo's push service and the direct-FCM decision stands.

**Observed outcome:** Expo headless delivery passed after ordinary process termination on Xiaomi, including native decrypt/display and ack. Force-stop required reopening, as expected. Broader OEM/Doze reliability remains to be measured. If those measurements justify switching to RNFirebase, audit push setup, receiver/task entry points and native configuration together; it would not be a change to `app/push.ts` alone.

---

## Setup requirements and current status

1. **A Firebase project**, with `com.zeyune.notifsync` registered as an Android app. It is a web console and cannot be automated from here.
2. **A Cloudflare account** for `wrangler deploy` (free tier).
3. Both phones, and independent internet connections for M3.4. These requirements are now met: Samsung Wi-Fi and Xiaomi mobile data. The locked 20-notification burst ran on 2026-10-17; the next human interaction is the fetch-only route test described above.

---

## Verification

Each slice carries its own check. The milestone is complete when:

- A real notification captured on Samsung appears on Xiaomi over independent networks, with Xiaomi backgrounded/locked or ordinarily terminated and without a force-stop flag. The approved Wi-Fi → cellular setup passed all three receiver states
- The relay's stored blob is gone after acknowledgement (FR-32)
- Sequence numbers arrive contiguous across the relay (FR-26)
- Notification content in relay blobs/FCM is ciphertext only, alongside public routing IDs, sequence/timing/size metadata or an opaque fetch handle. Registration additionally retains authentication secrets and FCM tokens; these are excluded from logs and QA queries. D1 size/shape checks on the retained force-stop blob found base64-only data and no controlled synthetic title/body; code inspection verified encryption before transport
- M3.4 burst/soak/latency checks must be recorded before declaring the entire M3 milestone complete; the baseline M3.3 pass does not complete them
