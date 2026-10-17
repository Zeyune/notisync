# M3 real-device QA

**Status guidance:** Reconcile [the last documented checkpoint](PROJECT_STATUS.md) with current repository evidence using [AGENTS.md](AGENTS.md#dynamic-project-status) before choosing work. The [October 17 continuation note](#fr-17-revised-method-a) supersedes the earlier pending-approval wording below; historical test results are unchanged.

Status on 2026-10-17, later: **The FR-17 fetch-path attempt delivered its notification inline, so the fetch path was NOT EXERCISED.** Android truncated the synthetic body to 1,024 characters, which left the sealed payload (1,696 base64 characters) under the relay's 2,800-character inline limit. Inline delivery passed. The procedure that caused this is corrected below, and a revised method awaits approval. See [FR-17 fetch-path attempt — 2026-10-17](#fr-17-fetch-path-attempt--2026-10-17) and [Open findings](#open-findings).

Status on 2026-10-17: **M3.4 20-notification burst run; M3.4 remains open.** End-to-end delivery passed 21/21 (one preflight plus 20) to a locked Xiaomi on mobile data, with no duplicates, no sequence gaps, no pending acks and an empty relay. The burst's visibility criterion **failed**: HyperOS removed the nine oldest delivered notifications from the shade within seconds, leaving 12 of 21 visible. See [M3.4 burst test — 2026-10-17](#m34-burst-test--2026-10-17).

Status on 2026-10-11: **M3.3 verified complete; M3.4 reliability measurement remains open.** Actual Samsung capture/display/ack passed on Xiaomi on same Wi-Fi and separate networks, including background, locked and ordinary-termination receiver states. Force-stop/reopen recovery passed separately. Use synthetic content throughout. Never collect `dumpsys notification --noredact`, full logcat, SecureStore contents, registration secrets, Firebase credentials or raw FCM tokens.

## Setup

1. `adb devices -l` must list both devices as `device`: Samsung `RZCR306W59F`; Xiaomi `75697t8pobuslrpn`. Unlock Samsung and accept USB debugging. If no prompt appears, reconnect/toggle USB debugging; if needed, use Developer options → Revoke USB debugging authorizations and authorize this computer again. This revokes other computers too.
2. From repository root, install the same final release APK on both, preserving app data:

   ```powershell
   adb -s RZCR306W59F install -r app/android/app/build/outputs/apk/release/app-release.apk
   adb -s 75697t8pobuslrpn install -r app/android/app/build/outputs/apk/release/app-release.apk
   ```

   Do not uninstall or clear app data to resolve an install problem. A signing mismatch requires a deliberate migration decision because reinstalling destroys pairing.
3. Open both apps; allow notifications. Both must show **registered**, **FCM token acquired (hidden)** and **receiver ready**. Check Android's Synced notifications channel is enabled. UI registration is corroborated by D1 public-key prefix, token length and updated time; never select `secret` or full `fcm_token`.
4. Both phones are paired with verified crosswise directional fingerprints. Samsung `send` must equal Xiaomi `recv`, and vice versa. Compare public identities before/after reopening; exchange the on-screen codes only if pairing is absent or the peer identity changed. Do not unpair or export secret key values for QA. HyperOS currently blocks adb input injection, so Xiaomi taps/typing are manual.
5. Choose **Relay** on Samsung; leave Xiaomi forwarding off. Keep Samsung foregrounded for these tests: capture while sender JS is absent is unimplemented. Forwarding starts off on each launch. Turn it on only for the controlled capture run.
6. The release bundle is included in the APK. Metro and `adb reverse` are unnecessary. Remove any assumption that the laptop carries the payload.

## Test matrix

Record time (+08:00), device/network state, synthetic test ID, visible receiver result, receiver diagnostic (`push displayed` vs `catch-up displayed`), pending ack count and sequence gaps. FCM acceptance alone does not pass any delivery row.

| Case | Action | Passing observation |
|---|---|---|
| Same Wi-Fi, foreground | Both on Wi-Fi; tap Samsung Send test payload | Xiaomi shade shows the originating Samsung model and source app plus synthetic content; receiver receipt saved; pending ack reaches 0 |
| Capture path | Enable forwarding on Samsung; post one unique synthetic Android notification using the command below | Samsung captured row reports relay acceptance; that captured notification appears natively on Xiaomi, without an echo back |
| Separate networks | Put either phone on cellular and the other on Wi-Fi. Verified setup: Samsung Wi-Fi, Xiaomi mobile data. Repeat capture | Same native result; verify actual network state, not only UI toggles. Record USB as an observation cable if attached |
| Receiver backgrounded | Press Home on Xiaomi manually; send another unique capture | Notification appears before reopening; safe receiver diagnostic says `push displayed`; catch-up while foregrounded cannot pass this case |
| Receiver locked | Lock Xiaomi manually on cellular while Samsung remains foregrounded on Wi-Fi; send | Notification entry exists while locked (preview may be hidden by privacy settings); unlock and confirm synthetic content, receipt and ack |
| Ordinary termination | Swipe Xiaomi app away without Force stop, or background it then `am kill`; send | Observe headless `push displayed` and native notification. If HyperOS treats swipe-away as stop, record that OEM behavior and whether reopening recovers |
| Force-stop separately | `adb -s 75697t8pobuslrpn shell am force-stop com.zeyune.notifsync`; send; then manually reopen | No promise of delivery while stopped. After reopening, `/pending` catch-up authenticates, displays once and acks; identity/pairing persist |
| App/channel permission blocked | Disable Xiaomi app notification permission or its Synced notifications channel; send; restore it and reopen | No ack before a successful native post. UI/diagnostic indicates blocked; reopening recovers the retained ciphertext |
| Offline/retry | Briefly disconnect sender internet, post controlled capture, restore network | Encrypted outbox count increases and failure is visible; backoff retry resumes while JS is active, preserving sequence and payload ID |
| Duplicate/reordered push | Send a burst of unique synthetic payloads; optional controlled retry of the same encrypted envelope without reading keys | No duplicate shade entries for a delivery ID; gaps clear when late sequences arrive. Automated tests cover replay and tampering; do not infer a real burst pass from them |
| Large/fetch-only | Use a controlled synthetic body whose sealed base64 exceeds 2800 characters but is within 64 KiB | FCM carries a handle, authenticated `/blob/:id` returns ciphertext, and native display/ack succeed |
| Token lifecycle | Reopen/resume both apps; compare identity/fingerprints and registration time | Identity stays stable, native token is synced, no raw token logged. Natural token rotation remains untested unless actually observed; do not clear data to induce it |

From repository root, post only the synthetic test on the Samsung, replacing the suffix for each case:

```powershell
adb -s RZCR306W59F shell "cmd notification post -t 'M3 QA same-wifi-01' notifsync-qa-same-wifi-01 'Synthetic delivery check 01'"
```

Pass the Android command as one quoted argument to `adb shell`. PowerShell otherwise strips the separate argument quotes before adb joins them, shortening multiword QA text. For safe delivery diagnostics, restrict logcat to fixed receiver outcome messages:

```powershell
adb -s 75697t8pobuslrpn logcat -d -s ReactNativeJS:I | Select-String 'NotifSync receiver:'
```

Inspect D1 using an exact public target key, returning only counts and size/shape, never credentials or ciphertext contents:

```sql
SELECT COUNT(*) AS pending_count, MAX(length(ciphertext)) AS max_ciphertext_length
FROM blobs WHERE target = '<XIAOMI_PUBLIC_KEY>';
SELECT substr(public_key, 1, 8) AS device_key, length(fcm_token) AS token_length, updated_at
FROM devices WHERE public_key = '<XIAOMI_PUBLIC_KEY>';
```

For a controlled send, count changes before/after (production smoke tests may also create synthetic rows). Receipt/zero pending ack plus recipient observation must agree; a server-side FCM success flag alone is not evidence of receipt.

## Recorded device observations

Both phones accepted the final APK with `adb install -r`; the last native adapter build passed in 54s. Permission, channel, receiver setup and registration were confirmed. Public identities `F2UCRJq0…` / `Ilo0wa45…` and crosswise fingerprints persisted across updates, headless execution and reopening. D1 token lengths were 142 with refreshed registration times; values were not queried. Samsung's USB authorization was resolved with a fresh user-approved prompt. Xiaomi pairing and receiver-state interactions remained manual.

The first push at 17:19:37 reached the task but failed native decrypt. The installed Expo Crypto Android bridge requires Uint8Array rather than a base64 string for `fromCombined`; the adapter fix passed a regression check and real-device recovery at 17:23:28. All times below are 2026-10-11, +08:00. Each passing display was observed by the user in Xiaomi's shade and corroborated by fixed receiver diagnostics and D1 pending 0 after ack.

| Case | Recorded evidence | Result |
|---|---|---|
| Fresh synthetic test, same Wi-Fi | `push displayed` 17:24:27; native Test payload visible | Pass |
| Actual capture, same Wi-Fi | Captured at 17:25:39; `push displayed` 17:25:40 | Pass |
| Background, same Wi-Fi | Xiaomi outside foreground before/after send; `push displayed` 17:30:43; observed before reopening | Pass |
| Background, separate networks | Samsung validated Wi-Fi / Xiaomi validated cellular; `push displayed` 17:32:23; observed on mobile data | Pass |
| Locked, separate networks | Xiaomi Asleep before/after send; `push displayed` 17:34:01; notification confirmed after unlocking | Pass |
| Ordinary termination, separate networks | `am kill`: process absent, `stopped=false`; push started new PID 14073, remained backgrounded; displayed 17:35:56 without reopening | Pass |
| Force-stop and reopen, separately | `stopped=true`, no new receiver execution, one 332-character encrypted blob retained; reopen `catch-up displayed` 17:42:05 | Pass for recovery; delivery while stopped not expected |
| Large synthetic notification | Body prefix and long content observed; `push displayed` 17:37:25; ack | Display passes; wire size/fetch-only route unrecorded |
| Natural duplicate | `push duplicate` 17:45:57 after catch-up; receipt branch skipped another native display and retried ack | Observed |
| Sender offline/retry | Queued 1 during outage; network restoration + sender resume drained to 0; `push displayed` 17:53:02 | Pass; Xiaomi was foregrounded for final retry |

**Literal QA text correction:** earlier multi-argument PowerShell commands stripped Android shell quotes, producing actual titles `M3` and bodies such as `force-stop-01`. Those capture deliveries are confirmed, but their historical full-title/body claims are superseded. The correctly quoted final title **M3 QA final-locked-03** and body **Synthetic final locked retry check 03** were confirmed exactly. Its name is not evidence of a second locked-state result: Xiaomi was foregrounded for that retry.

Final user observation and Xiaomi UI agree: **queued 0 · pending ack 0 · sequence gaps 0**. D1 pending count is 0; the receiver diagnostic is `push displayed at 2026-10-11T09:53:02.021Z`. Forwarding was left off on both phones. A retained force-stop blob shape check returned base64-only content and zero controlled synthetic title/body matches, without printing ciphertext. No production secret was modified.

**Still pending:** burst/soak/calibrated latency, real-device fetch-only route, blocked app/channel permission recovery, natural token rotation, ack-network failure, matching-peer LAN regression and production cron observation. Sender capture without JS, native token-upload/retry workers and receipt compaction remain unimplemented. Automated failure-path checks do not establish these real-device results.

## M3.4 burst test — 2026-10-17

Run 2026-10-17, 00:37–00:49 +08:00. Automated over USB ADB from the laptop; the user did the physical setup and the final visual check. Synthetic content only. All times below are +08:00.

### Setup, verified over ADB before sending

| | Samsung (sender) | Xiaomi (receiver) |
|---|---|---|
| Device | SM-A526B, Android 14, One UI 6.1, build `A526BXXSCGYC1` | Redmi Note 12 Pro `22101316UG`, Android 14, HyperOS `OS2.0.16.0.UMOMIXM` |
| ADB | authorized | authorized |
| Network | validated Wi-Fi, the only network present | Wi-Fi off; validated cellular as default network |
| App state | NotifSync foregrounded, screen on, unlocked; listener access enabled; Relay transport; paired, fingerprints `send b4ac50f7 · recv 96c716ab` | screen asleep with keyguard showing before, during and after the burst; process not running, `stopped=false`; `POST_NOTIFICATIONS` granted; Synced notifications channel importance 4 |
| Baseline | Queued 0 · pending ack 0 · sequence gaps 0 | Queued 0 · pending ack 0 · sequence gaps 0 (read by the user); 0 NotifSync notifications in the shade |

Neither phone was tethering and no `adb reverse` was set; USB carried only ADB. Relay D1 held 0 blobs at 00:18:52. Clock offsets against the laptop, from the lowest round trip of 7 `date +%s%N` samples: Samsung −82 ms (±85), Xiaomi −208 ms (±65). Cross-device latencies below are corrected and carry roughly ±0.15 s.

### Method

**Genuine capture was tested.** Every notification was a real Android notification posted on the Samsung with `cmd notification post` and captured by `NotifSyncListenerService`. No test button, shortcut or bypass was used. Forwarding was switched on over ADB only for each run (`uiautomator` located the single Switch; each tap was confirmed by a fresh dump) and off again straight after: 00:37:51.4–00:38:18.2 for one preflight notification, and 00:39:01.9–00:39:12.2 for the burst. The burst posted back to back, each `adb shell` returning before the next, with the same Android command strings as the earlier checklist loop:

```bash
for i in $(seq 1 20); do
  adb -s RZCR306W59F shell "cmd notification post -t 'M3 QA burst-$i' notifsync-qa-burst-$i 'Synthetic burst check $i'"
done
```

Evidence sources, none of which collect notification content, tokens, secrets or keys:

- Samsung `logcat -v epoch -s NotifSyncListener` (capture events report field presence only; other apps' package names were masked) and a `uiautomator dump` filtered to QA rows, their status lines, the delivery summary, the Switch and pairing status.
- Xiaomi `logcat -v epoch -s ReactNativeJS:I ActivityManager:I`, filtered to `NotifSync receiver:` and NotifSync process lines.
- Xiaomi `logcat -b events`, filtered on the device to NotifSync's `notification_enqueue` and `notification_canceled`; main/system lines for NotifSync from `CountLimitCoordinator`, `NotificationService`, `NotificationManagerServiceImpl` and `AlertCoordinator`. Public keys inside notification tags were masked.
- Xiaomi `dumpsys notification` in its default redacted mode, never `--noredact`, filtered to NotifSync records; only sequence numbers were extracted.
- Relay D1 read-only counts with `wrangler d1 execute notifsync-relay --remote`, selecting no secret, token or ciphertext.
- The user's visual check of the Xiaomi shade before opening NotifSync, then the Xiaomi delivery summary.

The automation helpers lived in a session scratch folder and are not in the repository.

### Per-notification timings

*Posted* is when the laptop's `adb shell` returned; *captured* is the Samsung listener log; *Android post* is the Xiaomi `notification_enqueue` event; *JS logged* is `NotifSync receiver: push displayed`. Captures were matched to sequence numbers by order: posts were sequential, `forwardNotification` numbers captures serially, and 21 captures inside the forwarding windows produced 21 sequence numbers.

| Test ID | Seq | Posted | Captured | Android post | JS logged | Capture → Android post | Shade at end |
|---|---|---|---|---|---|---|---|
| burst-preflight | 22 | 00:37:55.380 | 00:37:55.538 | 00:37:59.236 | 00:37:59.863 | 3.70 s | removed 00:39:12.353, after 73.1 s |
| burst-1 | 23 | 00:39:05.897 | 00:39:06.034 | 00:39:08.962 | 00:39:09.494 | 2.93 s | removed 00:39:12.884, after 3.9 s |
| burst-2 | 24 | 00:39:06.125 | 00:39:06.261 | 00:39:09.514 | 00:39:09.801 | 3.25 s | removed 00:39:13.296, after 3.8 s |
| burst-3 | 25 | 00:39:06.327 | 00:39:06.487 | 00:39:09.833 | 00:39:10.079 | 3.35 s | removed 00:39:13.781, after 3.9 s |
| burst-4 | 26 | 00:39:06.492 | 00:39:06.631 | 00:39:10.103 | 00:39:10.356 | 3.47 s | removed 00:39:14.210, after 4.1 s |
| burst-5 | 27 | 00:39:06.692 | 00:39:06.833 | 00:39:10.385 | 00:39:10.619 | 3.55 s | removed 00:39:14.437, after 4.1 s |
| burst-6 | 28 | 00:39:06.874 | 00:39:07.012 | 00:39:10.639 | 00:39:10.888 | 3.63 s | removed 00:39:14.685, after 4.0 s |
| burst-7 | 29 | 00:39:07.029 | 00:39:07.168 | 00:39:10.929 | 00:39:11.172 | 3.76 s | removed 00:39:14.922, after 4.0 s |
| burst-8 | 30 | 00:39:07.187 | 00:39:07.334 | 00:39:11.194 | 00:39:11.457 | 3.86 s | removed 00:39:15.539, after 4.3 s |
| burst-9 | 31 | 00:39:07.351 | 00:39:07.492 | 00:39:11.491 | 00:39:11.790 | 4.00 s | visible |
| burst-10 | 32 | 00:39:07.514 | 00:39:07.661 | 00:39:11.807 | 00:39:12.039 | 4.15 s | visible |
| burst-11 | 33 | 00:39:07.674 | 00:39:07.824 | 00:39:12.073 | 00:39:12.300 | 4.25 s | visible |
| burst-12 | 34 | 00:39:07.835 | 00:39:07.984 | 00:39:12.338 | 00:39:12.590 | 4.35 s | visible |
| burst-13 | 35 | 00:39:08.002 | 00:39:08.151 | 00:39:12.616 | 00:39:12.884 | 4.46 s | visible |
| burst-14 | 36 | 00:39:08.170 | 00:39:08.322 | 00:39:12.912 | 00:39:13.146 | 4.59 s | visible |
| burst-15 | 37 | 00:39:08.337 | 00:39:08.480 | 00:39:13.166 | 00:39:13.409 | 4.69 s | visible |
| burst-16 | 38 | 00:39:08.492 | 00:39:08.646 | 00:39:13.439 | 00:39:13.712 | 4.79 s | visible |
| burst-17 | 39 | 00:39:08.652 | 00:39:08.793 | 00:39:13.743 | 00:39:13.978 | 4.95 s | visible |
| burst-18 | 40 | 00:39:08.823 | 00:39:08.978 | 00:39:14.007 | 00:39:14.271 | 5.03 s | visible |
| burst-19 | 41 | 00:39:08.982 | 00:39:09.136 | 00:39:14.347 | 00:39:14.707 | 5.21 s | visible |
| burst-20 | 42 | 00:39:09.146 | 00:39:09.292 | 00:39:14.988 | 00:39:15.238 | 5.70 s | visible |

### Results by criterion

| # | Criterion | Result | Evidence |
|---|---|---|---|
| 1 | 20 unique synthetic notifications genuinely captured and submitted | **PASS** | 20 captures inside the burst window plus 1 in the preflight window; all 21 Samsung rows read `relay accepted; check receiver for delivery`. Five other captures fell outside both windows and were not forwarded |
| 2 | End-to-end delivery: relay, FCM push, authenticated decrypt, Android post, receipt, ack, relay deletion | **PASS, 21/21** | 21 `push displayed` and no other receiver outcome; relay D1 0 blobs at 00:38:46 and 00:42:06; Xiaomi pending ack 0 |
| 3 | Android notification display on the locked receiver | **PASS, 21/21** | `notification_enqueue` exactly once for each of sequences 22–42, in order; SystemUI `AlertCoordinator: onViewBound` logged for all 21 |
| 4 | No duplicates | **PASS** | one enqueue per sequence; no `push duplicate`; the user saw each of burst-9 to burst-20 once |
| 5 | No missing deliveries; FR-26 sequence gaps 0 | **PASS** | sequences 22–42 contiguous; Xiaomi UI sequence gaps 0 |
| 6 | Pending acknowledgements 0 | **PASS** | Xiaomi UI pending ack 0, read by the user |
| 7 | Sender outbox empty | **PASS** | Samsung UI Queued 0 |
| 8 | Relay pending 0 (FR-32) | **PASS** | D1 0 blobs at 00:42:06 |
| 9 | No forwarding, encryption, decryption, FCM or ack errors | **PASS** | 0 `ReactNativeJS` warnings or errors on either phone since the run began; no rejected, failed or blocked outcome; no catch-up needed. The Samsung still shows a stale `catch-up: relay connection failed`; see the observations below |
| 10 | All 20 burst notifications simultaneously visible in the shade | **FAIL** | 12 of 21 remain (burst-9 to burst-20). HyperOS removed the preflight and burst-1 to burst-8 between 00:39:12.353 and 00:39:15.539. Confirmed by `dumpsys notification` and by the user |
| 11 | Delivery latency | **Measured** | Capture to Android post across the burst: min 2.93 s, median 4.25 s, p90 5.03 s, max 5.70 s (±0.15 s). The preflight took 3.70 s, including a cold receiver process start |
| 12 | FCM deprioritisation under a burst | **Not observed; sustained load INCONCLUSIVE** | all 21 arrived as pushes within 6 s of capture. One burst of 20 cannot show throttling under sustained load |

**Overall: the burst test as specified FAILED, on criterion 10 only.** Delivery reliability under the burst passed every check: NotifSync's pipeline delivered, displayed, recorded and acknowledged all 21 notifications. The nine missing from the shade were removed by the receiving phone's operating system after delivery, not lost in transit. The requirement to keep all 20 burst notifications visible at once was nonetheless not met on this device.

### HyperOS shade limit: verified versus inferred

**Verified from system logs:**

- HyperOS SystemUI's `CountLimitCoordinator` logged `miui remove` for exactly sequences 22–30.
- `system_server` logged `notification_canceled` for exactly those nine, each with reason 2 and exposure 0 ms, meaning no one ever saw them.
- Removal began when the 13th NotifSync notification arrived (sequence 34 posted at 00:39:12.338; sequence 22 removed at 00:39:12.353). Each later arrival removed the oldest remaining notification.
- 12 remained, matching the user's check.
- The Xiaomi was asleep and locked throughout, so no person dismissed anything.

**Inferred, not tested:**

- That the limit is a fixed 12 per app on this build.
- That it counts per package rather than per channel or group; all 21 shared one package, one channel and one group.
- That it applies to other HyperOS builds or devices.
- Whether any setting changes it.
- That HyperOS uses reason 2 with AOSP's meaning, `REASON_CANCEL`.

### Other observations

- **Alerts were rate-limited.** The system suppressed sound or vibration for 19 of the 20 burst notifications, all except burst-1: AOSP's `Muting recently noisy` for 14 and HyperOS's `Cancel the recent frequently vibration in 15s` for 5. This is expected platform rate limiting and was read from logs, not heard.
- **The receiver processes one notification at a time.** It posted the burst to Android over 6.03 s (00:39:08.962–00:39:14.988), about 0.32 s apart, while captures were about 0.17 s apart. Each later notification therefore waited about 0.15 s longer than the one before. `createReceiver` in `app/deliveryProtocol.ts` serializes the whole chain, including the acknowledgement request; that the cellular ack round trip dominates the 0.32 s is inferred, not measured.
- **The burst ran against a warm receiver process.** An FCM broadcast started the NotifSync process at 00:37:56.7 for the preflight, and that process handled the whole burst. The burst therefore exercised a warm background process on a locked phone, not a cold start.
- **HyperOS later killed the receiver.** At 00:45:08.8, about six minutes after the burst and still locked, HyperOS killed the process with reason `LockScreenClean`. The log line is `Killing`, not `Force stopping`, so it is presumed an ordinary kill; the stopped flag was not captured at that moment.
- **Opening the app recovered nothing.** When the user opened NotifSync at 00:48:36.7, no receiver outcome was logged: catch-up found nothing to fetch, consistent with relay pending 0.
- **The Samsung shows a stale catch-up error.** Its delivery summary still reads `catch-up: relay connection failed`, although the relay accepted all 21 sends during the run. `recover()` in `app/receiver.ts` writes the catch-up diagnostic only on failure and never clears it on success. The stale text misleads FR-33 diagnostics.

**Not verified in this run:** a cold-start burst; bursts larger than 20; repeated bursts to probe sustained FCM priority; the shade limit on any other device or build; the alerts as actually heard by a person.

**Still pending after this run:**

- Real-device fetch-only route.
- Cold-start burst.
- Blocked app/channel permission recovery.
- Natural token rotation.
- Ack-network failure.
- Matching-peer LAN regression.
- Production cron observation.
- Soak.
- A product decision on the HyperOS shade limit.
- The stale catch-up diagnostic.

Sender capture without JS, native token-upload/retry workers and receipt compaction remain unimplemented.

## FR-17 fetch-path attempt — 2026-10-17

Run 2026-10-17 at 01:05 +08:00, a single controlled test. The setup matched the burst and was re-verified over ADB just before sending:

- **Samsung:** awake and unlocked, NotifSync in the foreground, Wi-Fi only, Relay transport, forwarding off.
- **Xiaomi:** asleep and locked, cellular only, Wi-Fi off, NotifSync process running in the background (restarted when the user opened the app at 00:48).
- **Baseline:** relay D1 0 blobs (01:02:49).
- **Clock offsets against the laptop:** Samsung −65 ms (±85), Xiaomi −188 ms (±65).

**Relay monitoring, approved by the user for this test only.**

- **Command:** `wrangler tail notifsync-relay --format json`, read-only. It was piped through a local filter that kept only the event time, method, path (opaque ids replaced by their length), HTTP status, outcome and POST `content-length`.
- **What was never stored:** headers, bodies and client data. Cloudflare's tail itself redacted the `x-device-key` header, so the log cannot attribute a request to a device.
- **Duration:** monitoring started before forwarding was switched on (first event 01:05:30.266) and was stopped once the test acknowledgement appeared. Two `wrangler` processes survived the task stop; they were terminated, and none remained. The Worker, its data and its secrets were not touched.

**Method.** Forwarding was on from 01:05:47.9 to 01:05:55.4. The test posted one genuine Android notification on the Samsung with the procedure written earlier that day: title `M3 QA fetch-01`, body `'Synthetic fetch-only check 01 '` repeated 80 times, 2,400 characters.

**That procedure was wrong.** Android stores at most 1,024 characters per notification text field. The Samsung's redacted `dumpsys notification` shows `android.text=String [length=1024]` for this notification, so the listener captured 1,024 characters, not 2,400. The sealed payload was **1,696 base64 characters**: the relay request's `content-length` of 1,768, minus the 72 fixed characters of the `{"target":…,"ciphertext":…}` body. That is below the relay's 2,800-character inline limit (`relay/src/index.ts`), so the relay put the ciphertext inside the push. The relay log shows **no `GET /blob` request**. Per the user's instruction, the test was not repeated with a different payload.

**Timeline** (+08:00; phone times corrected to the laptop clock, relay times from Cloudflare's event timestamps):

| Time | Event |
|---|---|
| 01:05:47.907 | Samsung forwarding switched on |
| 01:05:48.971 | Samsung captured a **non-test** notification (charging-related, per the user's view of the Xiaomi) |
| 01:05:49.459 | Relay `POST /send` 202, content-length 524 (ciphertext 452), for that notification |
| 01:05:49.814 | Xiaomi Android posted sequence 43 |
| 01:05:50.387 | Relay `POST /ack` 200 |
| 01:05:52.174 | Laptop `adb shell` returned from posting `M3 QA fetch-01` |
| 01:05:52.338 | Samsung captured `M3 QA fetch-01` |
| 01:05:52.843 | Relay `POST /send` 202, content-length 1,768 (ciphertext 1,696, under the 2,800 limit, so inline) |
| 01:05:53.076 | Xiaomi Android posted sequence 44 (`notification_enqueue`, exactly once) |
| 01:05:53.357 | Xiaomi `NotifSync receiver: push displayed` (UI diagnostic: `push displayed at 2026-10-16T17:05:53.160Z`, Xiaomi clock) |
| 01:05:53.491 | Relay `POST /ack` 200 |
| 01:05:53.638 | HyperOS `CountLimitCoordinator` removed sequence 32, keeping 12 NotifSync notifications (sequence 31 had been removed at 01:05:50.423 when 43 arrived) |
| 01:05:55.388 | Samsung forwarding switched off |
| 01:07:24 | Relay D1: 0 blobs |

Also in the relay log: `GET /pending` 200 at 01:05:30.266 and 01:05:45.274. That is a successful catch-up poll on the 15-second foreground timer. It is attributed to the Samsung by inference: the Xiaomi was locked in the background, where that timer does not run.

**Results by criterion**

| # | Criterion | Result | Evidence |
|---|---|---|---|
| 1 | Genuine capture on the Samsung | **PASS** | listener capture at 01:05:52.338; Samsung row `M3 QA fetch-01 => relay accepted; check receiver for delivery` |
| 2 | Encryption and relay acceptance | **PASS** | `POST /send` 202; the relay accepted the base64 sealed payload; the receiver authenticated it (criterion 6) |
| 3 | Payload exceeds the 2,800-character inline limit | **FAIL** | 1,696 base64 characters. Root cause verified: Android truncated the 2,400-character body to 1,024 characters before capture |
| 4 | FCM push carries only the fetch reference | **NOT EXERCISED** | at ≤2,800 characters the relay puts the ciphertext inline (code); the push could not have been reference-only |
| 5 | Separate authenticated fetch by the Xiaomi | **NOT EXERCISED** | no `GET /blob` in the relay log |
| 6 | Payload authenticated and decrypted | **PASS (inline path)** | `push displayed` requires AES-GCM authentication and payload validation |
| 7 | Displayed by Android exactly once | **PASS** | one `notification_enqueue` for sequence 44; the user saw `M3 QA fetch-01` exactly once, with the repeated synthetic text |
| 8 | Acknowledgement succeeds | **PASS** | `POST /ack` 200 at 01:05:53.491 |
| 9 | No pending acks, sequence gaps or relay messages | **PASS** | Xiaomi UI: Queued 0 · pending ack 0 · sequence gaps 0 (read by the user); Samsung Queued 0; D1 0 blobs; sequences 43 and 44 follow 42 |
| 10 | Latency and errors recorded | **Recorded** | capture to Android post 0.74 s (±0.15 s); relay `/send` to `/ack` 0.65 s (Cloudflare clock); 0 `ReactNativeJS` warnings or errors on either phone; all relay responses 2xx |

**Overall: inline delivery PASS; FR-17's separate fetch path NOT EXERCISED.** The fetch objective is **INCONCLUSIVE**, not failed: nothing about the fetch path was observed either way.

**Incident.** One non-test notification, captured 1.1 s after forwarding was switched on, was forwarded and displayed as sequence 43. The tester did not read its content; the user identified it as charging-related. See open finding 7.

**Also verified on the receiver:** the Xiaomi's record for sequence 44 stores `android.text` and `android.bigText` at **1,024 characters**. The receiver joins title and body into one text field, so this display was cut from 1,039 characters. See open finding 6.

## Open findings

These findings are recorded for investigation. **None is resolved.** Each needs a decision, a fix or a measurement before it can be closed.

1. **HyperOS per-app shade limit.** On HyperOS OS2.0.16.0, the Xiaomi kept at most 12 NotifSync notifications in the shade. During the burst it removed nine delivered notifications within seconds, each with exposure 0 ms, and it removed two more during the FR-17 attempt. This is product question **§12 Q10** in the PRD. Evidence: the burst record above. Which parts are verified and which inferred is set out there.
2. **Sequential receiver processing.** The receiver posts one delivery at a time: about 0.32 s apart during the burst, against captures 0.17 s apart. Latency therefore grew by about 0.15 s per queued notification, from 2.93 s to 5.70 s across 20. `createReceiver` serializes the whole chain, including the acknowledgement request. That the cellular ack round trip dominates is **inferred, not measured**. At this rate, a burst of 100 would leave the last notification about 15 s behind.
3. **Stale catch-up diagnostic (FR-33).** `recover()` in `app/receiver.ts` writes the `catch-up:` diagnostic only on failure and never clears it on success. On 2026-10-17 the Samsung's screen read `catch-up: relay connection failed` while the relay log showed catch-up polls succeeding (200 at 01:05:30 and 01:05:45, attributed to the Samsung by inference). A stale error misleads the diagnostics screen.
4. **HyperOS `LockScreenClean` kills the background receiver.** About six minutes after the burst, with the phone still locked, HyperOS killed the receiver process (log line `Killing … LockScreenClean`, not `Force stopping`). Unverified: whether this ever amounts to a force-stop, which would block FCM wake-ups until the app is reopened. A burst against a cold, killed receiver is untested (FR-24).
5. **Alert suppression during bursts.** The OS suppressed sound or vibration for 19 of the 20 burst notifications: AOSP `Muting recently noisy` for 14, HyperOS `Cancel the recent frequently vibration in 15s` for 5. This is expected platform behaviour, read from logs and not heard. It bears on how bursts should alert, Q10's coalescing option included.
6. **Android caps notification text at 1,024 characters, at both ends.** Verified on the Samsung at capture (2,400 posted, 1,024 stored) and on the Xiaomi at display (title plus body 1,039, stored 1,024 in `text` and `bigText`). Consequences:
   - NotifSync can forward at most what the source notification holds: 1,024 characters per field.
   - The receiver's joined title-and-body display is cut beyond 1,024 characters, and the cut text is not viewable anywhere until history exists.
   - Payloads stay inline unless title plus body exceed roughly 1,866 UTF-8 bytes. That figure is computed from the measured 206-byte overhead and the 2,800-character limit.
7. **Test windows forward real notifications.** The current build forwards every capture while the forwarding switch is on; FR-10's per-app opt-in arrives with M4. While on USB, a Samsung notification (charging-related, per the user) is captured every 10–70 s. One was forwarded during the FR-17 attempt. Mitigation for tests, needing no change to code or settings: open the forwarding window immediately after one of these periodic captures and keep it to 3 s or less.
8. **Relay logs cannot attribute requests to a device.** Cloudflare's tail redacts `x-device-key`. That a `GET /blob` 200 came from the intended receiver must rest on the relay's code, which returns 200 only to the blob's target.

## FR-17 Revised Method A

**Historical proposal — 2026-10-17:** This revised FR-17 fetch-path method was initially pending approval. It replaces the procedure above, which used a 2,400-character body that Android truncated to 1,024. It records the plan at that checkpoint, not an automatically current next task.

**Continuation checkpoint — 2026-10-17, approximately 01:34–01:41 +08:00 (owner-reported):** Method A was approved, then Claude's weekly usage limit stopped the session before its dry run or test began. Neither ran; no Method A results or implementation changes followed. The revised test's approved read-only tail was never started. Before any future production attachment for this test, reconfirm monitoring authorization and scope as requested in the owner's handoff.

**How to exceed the inline limit through genuine capture.** The listener forwards the notification's title (`EXTRA_TITLE`) and main text (`EXTRA_TEXT`) only. Inbox lines, `MessagingStyle` messages and big text are logged as present but not forwarded. Android caps each field at 1,024 characters. The fixed overhead of a sealed payload from this pair of devices is 206 bytes, measured from the FR-17 attempt (1,696 base64 characters for a 1,038-character title plus body). That gives two ways over the 2,800-character limit:

- **Method A, recommended: ASCII title and body, each exactly 1,024 characters.** Plaintext 2,254 bytes, sealed 2,282 bytes, giving a **predicted 3,040–3,044 base64 characters** (relay `content-length` 3,112–3,116): 240–244 over the limit. This uses only the ASCII path already proven through PowerShell, `adb` and the Android shell.
- **Method B, alternative: a short title and 1,024 copies of a 3-byte character such as U+2713 (✓).** About 3,072 UTF-8 bytes, predicted ≈4,400 base64 characters. It gives a larger margin and also tests multi-byte text end to end. It adds an unverified step: whether non-ASCII text survives PowerShell, `adb.exe` and the Android shell intact.

**Rejected:**

- `cmd notification post -S inbox|messaging`: those lines are not forwarded.
- The app's Send test payload button: it skips capture.
- Posting directly to the relay: it skips the sender.
- Lowering the relay's inline limit: that needs a redeploy.

**Steps for Method A**

1. **Dry run, forwarding off.** Post `M3 QA fetch-02-dry` with the title and body below.
   - Confirm in the Samsung's redacted `dumpsys notification` that `android.title` and `android.text` are both length 1,024.
   - Confirm that the listener logged a capture and that the relay received no `/send`.
2. **Start relay monitoring** with the same filter, once the user approves.
3. **Open the forwarding window immediately after a periodic Samsung capture,** then post `M3 QA fetch-02` and switch forwarding off within 3 s.

   ```powershell
   $qaTitle = ('M3 QA fetch-02 title ' * 49).Substring(0, 1024)
   $qaBody = ('Synthetic fetch-only check 02 ' * 35).Substring(0, 1024)
   & adb -s RZCR306W59F shell "cmd notification post -t '$qaTitle' notifsync-qa-fetch-02 '$qaBody'"
   ```

4. **Pass requires all of the following:**
   - relay `POST /send` 202 with `content-length` of at least 2,873 (ciphertext over 2,800);
   - `GET /blob/<id len=22>` 200;
   - `POST /ack` 200;
   - exactly one `notification_enqueue` and one `push displayed` on the locked Xiaomi;
   - D1 0 blobs;
   - Xiaomi pending ack 0 and sequence gaps 0;
   - the user sees `M3 QA fetch-02` once.

   Because the receiver's display is cut at 1,024 characters (open finding 6), the visible text will be the title alone. The body is authenticated as part of the AES-GCM payload but not displayable.
5. **Stop relay monitoring** as soon as the ack appears, and confirm no `wrangler` process remains.

After that: a cold-start burst of at most 12 notifications, under the observed HyperOS limit, against a receiver that HyperOS has killed while locked.

## Repeatable checks

From `app/`, run `npm.cmd run typecheck`, `npm.cmd run typecheck:relay`, `npm.cmd test`, `npm.cmd run test:pairing`, and `npm.cmd run test:relay`. All passed: 11 delivery tests, 7 pairing checks, 3 Worker/FCM tests and both typechecks. Node 24 runs the SQLite-backed tests; its experimental SQLite warning is expected. `node --check tools/m1-receiver.mjs`, Expo prebuild/autolinking and 19 production relay smoke checks also passed. The deployed Worker version is `491a39d0-cd81-43d5-8093-e1f10866be10`.

Build from `app/android/`:

```powershell
.\gradlew.bat :app:assembleRelease -PreactNativeArchitectures=arm64-v8a --console=plain
```

The release variant uses the project's development signing configuration for device QA; this is not store-release signing. Production-secret values were not changed. Native directories remain generated by Expo prebuild.
