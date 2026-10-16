# M3 real-device QA

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

## Exact next manual test

1. Keep Samsung foregrounded in NotifSync on Wi-Fi; put Xiaomi on mobile data, return it to Home and lock it. Verify the actual network split and enabled receiver notification channel.
2. Enable Samsung forwarding in Relay mode. Run this from repository root to post 20 unique synthetic capture notifications, passing each Android command as one quoted argument:

   ```powershell
   1..20 | ForEach-Object {
       $qaIndex = $_
       $qaCommand = "cmd notification post -t 'M3 QA burst-$qaIndex' notifsync-qa-burst-$qaIndex 'Synthetic burst check $qaIndex'"
       & adb -s RZCR306W59F shell $qaCommand
   }
   ```

3. Disable Samsung forwarding after capture. Unlock Xiaomi and check its shade before opening NotifSync; expand the source group and confirm all 20 distinct numbered entries.
4. Record safe push outcome timestamps and any duplicates, then check queued 0, pending ack 0, gaps 0 and D1 pending 0. Use sender capture time versus receiver display time for latency measurement; document time synchronization/precision. This burst has **not** yet been run or counted as an M3.4 pass.

## Repeatable checks

From `app/`, run `npm.cmd run typecheck`, `npm.cmd run typecheck:relay`, `npm.cmd test`, `npm.cmd run test:pairing`, and `npm.cmd run test:relay`. All passed: 11 delivery tests, 7 pairing checks, 3 Worker/FCM tests and both typechecks. Node 24 runs the SQLite-backed tests; its experimental SQLite warning is expected. `node --check tools/m1-receiver.mjs`, Expo prebuild/autolinking and 19 production relay smoke checks also passed. The deployed Worker version is `491a39d0-cd81-43d5-8093-e1f10866be10`.

Build from `app/android/`:

```powershell
.\gradlew.bat :app:assembleRelease -PreactNativeArchitectures=arm64-v8a --console=plain
```

The release variant uses the project's development signing configuration for device QA; this is not store-release signing. Production-secret values were not changed. Native directories remain generated by Expo prebuild.
