# M3 — Relay + FCM: implementation plan

**Status:** approved 2026-09-13. Companion to [notification-sync-prd.md](notification-sync-prd.md), which remains the source of truth for every FR and open question. Where this document and the PRD disagree, the PRD wins unless this document says explicitly that it supersedes it.

## Context

**The problem:** everything built so far requires both phones on the same network. Capture, pairing, encryption and delivery all work — verified on real hardware — but only over LAN. PRD §1 lists this exact limitation as the reason KDE Connect fails: *"LAN-only. Useless the moment the two phones are on different networks."*

M3 replaces the local network with a relay plus platform push, so a notification reaches phone 2 **from anywhere, with the receiving app killed**. PRD §10 always intended M1's LAN loop to be thrown away here.

**Decisions made 2026-09-13:**

| Decision | Choice |
|---|---|
| Relay host | **Cloudflare Workers + D1** — 100k requests/day, 100k D1 row-writes/day, never sleeps |
| Scope | **Android → Android only.** iOS receiver (FR-35) deferred: needs a Mac and a $99/yr Apple membership |
| Push transport | **Direct FCM** from our own relay. No Expo Push Service — it would put a third party in the path of a product whose pitch is that there isn't one (FR-30) |

*Why not Supabase, which §8 names as the obvious candidate:* its free tier **pauses a project after 7 days of inactivity**. For a relay used daily that would rarely trigger, but the failure is silent — notifications simply stop arriving and nothing says why. FR-25's heartbeat and FR-33's diagnostics exist because silent cessation is this product's worst outcome, so an infrastructure component that fails that way by design works against the requirement. Cloudflare's allowance is also roughly 6× larger: 100k requests *per day* against Supabase's 500k Edge Function invocations *per month*.

*Why D1 and not Workers KV:* KV's free tier permits **1,000 writes per day**, and the relay writes one row per notification. D1 allows 100,000 row-writes per day against the same Workers plan.

**Explicitly out of scope:** iOS, QR pairing (M2's remainder — manual entry works), filtering (M4), foreground service (M5 decides by measurement, per FR-23).

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

### M3.3 — Real delivery
- Sender: new `app/relayClient.ts` replaces the LAN POST in `app/lanForwarding.ts`
- Receiver: background data-message handler → decrypt with `receiveKey` → post a local notification (FR-19, showing source app and originating device)
- FR-31: request `POST_NOTIFICATIONS` during onboarding — without it the receiver pairs successfully and displays nothing, which is a silent failure
- Retire `tools/m1-receiver.mjs`
- **Verify:** Samsung → Xiaomi, both on Wi-Fi, receiver app **killed**.

### M3.4 — Off-network proof
The test that justifies the milestone: **Samsung on mobile data, Xiaomi on Wi-Fi, receiver app force-stopped.** Different networks, no LAN, nothing plugged in.
- Confirm FR-26 sequence continuity across the relay
- Confirm FR-32: the blob is deleted after acknowledgement
- Measure delivery latency, and whether FCM deprioritises under a burst

---

## Files

**New:** `relay/wrangler.toml`, `relay/src/index.ts`, `relay/schema.sql`, `app/relayClient.ts`, `app/push.ts`

**Modified:** `app/lanForwarding.ts` (send via relay), `app/pairingState.ts` (store `deviceSecret` and relay URL), `app/App.tsx` (receiver UI, push-permission state), `app/app.json` (FCM config), `.gitignore` (`google-services.json`, service-account JSON)

**Retired:** `tools/m1-receiver.mjs`, `tools/peer-session.json`, and the **public development key** in `app/crypto.ts` — once every device pairs for real, the unpaired fallback is deleted rather than kept for convenience.

**Reuse, do not rewrite:** `deriveSessionKeys` (`app/pairingKeys.ts`), `seal` and `Envelope` (`app/crypto.ts`), `toForwarded` and the `ForwardedNotification` shape (`app/lanForwarding.ts`) — §7's field list was validated against real traffic at M1 and needs no change. The receiver's decrypt is the mirror of `open()` in `tools/m1-receiver.mjs`.

---

## Recorded deviation from §8

§8 names **`@react-native-firebase/messaging` plus Notifee**. This plan uses **`expo-notifications`** instead, for the token, the background handler and the display.

**Why:** one native dependency rather than two, first-party to Expo, and every first-party module used so far (`expo-crypto`, `expo-secure-store`) integrated cleanly on the first build — each native dependency costs a full rebuild on both phones. `getDevicePushTokenAsync()` returns the **raw FCM token**, so this does not route through Expo's push service and the direct-FCM decision stands.

**Risk:** RNFirebase's `setBackgroundMessageHandler` is more battle-tested for waking a killed app than `expo-notifications`' background task. If M3.3 shows unreliable delivery to a killed app, the fallback is to switch to RNFirebase — a contained change affecting `app/push.ts` only. This deviation is reversible; record the outcome either way.

---

## What the human has to provide

1. **A Firebase project**, with `com.zeyune.notifsync` registered as an Android app. It is a web console and cannot be automated from here.
2. **A Cloudflare account** for `wrangler deploy` (free tier).
3. Both phones, and a way to put one on **mobile data** for M3.4.

---

## Verification

Each slice carries its own check. The milestone is complete when:

- A real notification captured on the Samsung **on mobile data** appears on the Xiaomi **on Wi-Fi**, with the Xiaomi's app force-stopped beforehand
- The relay's stored blob is gone after acknowledgement (FR-32)
- Sequence numbers arrive contiguous across the relay (FR-26)
- The relay holds only ciphertext, a target key and a size, exactly as §7 states — verified by inspecting D1 directly, not by assuming
