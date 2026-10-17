# NotifSync — project status and AI session handoff

**Status policy established:** 2026-10-17 **01:55 +08:00**. This file contains the **last documented checkpoint**, not an automatically authoritative or permanently current project status. For status reconciliation and checkpoint maintenance, follow the single [dynamic status procedure in AGENTS.md](AGENTS.md#dynamic-project-status) before determining current status or the next task.

**Latest documented development checkpoint:** [2026-10-17](#checkpoint--2026-10-17), recorded at 01:46 +08:00. All development-status statements in that entry describe that checkpoint's evidence, not an assertion about the present. The policy update above records no new device test or implementation result.

## Checkpoint — 2026-10-17

**Milestone at this checkpoint:** M3.4 — Reliability Measurement. **Paused; M3.4 and FR-17 fetch-path verification remain open.**

**Development checkpoint:** 2026-10-17, approximately **01:34–01:41 Philippine time (PHT, UTC+08:00)**, supplied by the owner.
**Checkpoint documented:** 2026-10-17 **01:46 +08:00**, measured from UTC. This is the documentation time, not another test run.

The [PRD](notification-sync-prd.md) remains the requirements and product-question authority; the [M3 QA record](notification-sync-m3-qa.md) holds detailed test evidence. Approval, a proposed procedure and predicted results are not execution evidence. The dated results and stopping point below are retained for comparison with later progress.

### Completed work and last results

| Work | Recorded status and limits |
|---|---|
| M0 — Capture | Complete. Native Android capture verified on real devices and real app notifications. |
| M1 — LAN forwarding | Complete. Captured notifications forwarded and decrypted over Wi-Fi; LAN remains a selectable development transport. |
| M2 — Pairing and encryption | Working manual pairing, persisted identity/directional keys and authenticated encryption verified. This completion label covers the implemented pairing/crypto core; QR pairing remains deferred in the M3 plan. |
| M3.1–M3.3 — Relay and push delivery | Complete for the approved Android-to-Android scope; M3.3 verified 2026-10-11. Real Samsung capture reached Xiaomi on separate networks, including background, locked and ordinary-process-termination states. Force-stop/reopen recovery and sender offline retry passed separately. iOS remains deferred. |
| M3.4 burst execution and reporting | Complete as a measurement, with delivery checks passing and the original visibility criterion failing. M3.4 itself remains open. |
| First targeted FR-17 fetch-path attempt | Executed and reported at 01:05 +08:00 on 2026-10-17. Inline delivery passed; separate fetch was **NOT EXERCISED**. The QA procedure was revised afterward. |

**Burst result:** one preflight plus 20 burst notifications were delivered and posted by Android **21/21**, with zero duplicates, zero sequence gaps, zero pending acknowledgements, an empty sender outbox and relay pending count zero. Calibrated burst capture-to-Android-post latency was approximately **4.25 s median** (2.93–5.70 s, p90 5.03 s, uncertainty about ±0.15 s). HyperOS removed the nine oldest entries, leaving **12/21 visible**. The original requirement that all 20 burst notifications remain simultaneously visible **FAILED**, so the burst as a whole did not satisfy every acceptance criterion. The measured median does not establish the PRD's p95-under-5-seconds goal or sustained reliability. See [the full burst record](notification-sync-m3-qa.md#m34-burst-test--2026-10-17).

**FR-17 attempt:** Android truncated the synthetic **2,400-character body to 1,024 characters** before capture. Actual encrypted base64 length was **1,696**, below the **2,800-character inline limit**. The relay accepted the send, Xiaomi authenticated/decrypted and posted it once, acknowledgement succeeded and pending counts reached zero. **No `GET /blob` was observed.** Inline delivery passed; the fetch objective is inconclusive, not a demonstrated fetch failure or success. An earlier large-notification display on 2026-10-11 also lacked wire-size/fetch evidence. See [the targeted attempt](notification-sync-m3-qa.md#fr-17-fetch-path-attempt--2026-10-17).

### Exact stopping point

The owner reports sending Claude an explicit prompt titled:

> APPROVED — Proceed with FR-17 Revised Method A.

Claude reached its weekly usage limit immediately after that message was submitted. Development stopped **immediately before executing Revised Method A**, including its dry run.

- Method A **was not executed**.
- Its dry run **was not executed**.
- No new test results were produced and no Method A implementation changes were made.
- A temporary, read-only `wrangler tail` was approved for this revised test but **was never started**. The tail recorded for the earlier 01:05 attempt is a separate, completed monitoring session.
- FR-17's real-device fetch path was **unverified at this checkpoint**. The submitted approval is not proof of execution.

The approval wording, usage-limit interruption and approximate stopping time come from the owner's handoff in this session. The earlier Claude conversation was not independently inspected. The repository review for this checkpoint found no newer Method A execution result.

### Next task recorded at this checkpoint — FR-17 Revised Method A

**The next task recorded here was FR-17 Revised Method A on the real Android devices.** The [QA procedure](notification-sync-m3-qa.md#fr-17-revised-method-a) and prerequisites below preserve that historical plan. Determine the actual next task through the reconciliation procedure above before recommending or executing it.

#### Prerequisites and owner involvement

- Recheck both phones through ADB; historical authorization, pairing and network state are not a current readiness check. Reuse the existing QA build and pairing. Do not clear app data or unpair to troubleshoot.
- Samsung **SM-A526B**: validated Wi-Fi, NotifSync foregrounded, notification-listener access available, **Relay** selected and forwarding initially **off**. Samsung has no usable mobile data. Native sender capture without JS is unimplemented.
- Xiaomi **Redmi Note 12 Pro**: mobile data, Wi-Fi disabled, notifications and the Synced notifications channel allowed, forwarding off. The owner must manually handle Xiaomi interactions, put it in the required locked state for delivery and inspect its shade afterward; HyperOS has blocked ADB input injection.
- Verify both devices are still paired, registered and receiver-ready without recording pairing codes, raw tokens, secrets or encryption keys. Establish initial queue/ack/gap counts and relay pending count using only authorized, bounded diagnostics.
- **Before attaching to production, reconfirm the owner's authorization and monitoring scope.** This is explicitly required by the owner's handoff despite the earlier approval. Scope: temporary read-only tail for this one test, retaining only event time, HTTP method, masked path/opaque-ID length, status/outcome and request length. No headers, bodies, client data or credentials. Include any necessary read-only pending-count query in the agreed scope; do not deploy or modify the relay.

#### Execution and acceptance checklist for the resumed session

1. With forwarding **off**, run the dry notification using an ASCII title of exactly **1,024 characters** and an ASCII body of exactly **1,024 characters**. Use the QA procedure's synthetic text and a distinct dry-run tag.
2. Check the Samsung's redacted notification field lengths and listener capture: Android must actually retain both required lengths, and the dry capture must not forward. If the dry run fails, **STOP and report the blocker**. Do not open the live forwarding window.
3. If the dry run succeeds and monitoring scope is confirmed, start the scoped read-only tail. Keep Samsung foregrounded and Xiaomi locked on cellular. Forward **ONE controlled genuine notification capture**, enabling forwarding only briefly and switching it off immediately afterward. The QA mitigation is to start just after a periodic Samsung capture and keep the window at most 3 s; this reduces but does not eliminate unrelated captures.
4. Verify the **actual encrypted base64 payload exceeds 2,800 characters**, rather than accepting the prediction of 3,040–3,044 as a measurement. Record safe size evidence and relay **`POST /send` 202**. The current local relay code selects a handle-only push above 2,800; corroborate the route with the next step, without logging ciphertext or push credentials.
5. Genuinely observe an authenticated **`GET /blob/<masked id>` 200** for the controlled delivery. A send acceptance, inline display or `/pending` poll cannot substitute for this separate fetch. Cloudflare redacts the device header: explain attribution using the target-only relay authorization, controlled timing and matching receiver outcome, not a claim that the tail directly identifies Xiaomi.
6. Verify Xiaomi authenticates/decrypts and posts the notification **exactly once**, with matching `notification_enqueue` and `push displayed` evidence, then **`POST /ack` 200**. The receiver's joined title/body text is itself truncated at 1,024 characters; the expected visible text is the long title, not the complete body.
7. Verify **zero pending acknowledgements, sequence gaps, sender outbox items and relay pending messages**. Record calibrated latency, device/network state, safe diagnostics and any unexpected unrelated capture separately.
8. Stop the test's monitoring as soon as the acknowledgement appears, or on abort, and verify its tail/helper processes have ended. Leave forwarding off.
9. Obtain the owner's **visual confirmation on Xiaomi before finalizing the result**. Update QA, the plan as needed, the changelog and this checkpoint with actual results, remaining blockers and the newly justified next task.

**Stop rules:** do not claim success without the separate fetch request; do not automatically try Method B if Method A fails; do not substitute a test button, direct relay post, lowered inline threshold or implementation change for genuine capture. A missing criterion leaves FR-17 open. This checkpoint session does not execute any of these steps.

### Unresolved findings and remaining work

All eight [QA open findings](notification-sync-m3-qa.md#open-findings) remain unresolved:

| Finding | Evidence and outstanding question |
|---|---|
| HyperOS shade retention | Only 12 entries remained on this Xiaomi/build/channel. Broader applicability, package/channel/group scope, configurability and summary/coalescing behavior remain unmeasured. Q10 is open. |
| Sequential receiver processing | About 0.32 s between receiver posts versus 0.17 s between captures; burst latency increased. Serialization includes acknowledgement; the claim that cellular ack time dominates is an inference. |
| Stale catch-up diagnostic | Samsung retained `catch-up: relay connection failed` after successful activity. Local `recover()` records failure without clearing it on success. No fix has been made. |
| HyperOS `LockScreenClean` | Receiver killed while locked about six minutes after the burst. The stopped flag was not captured then; delivery after this particular kill and a cold-start burst remain unverified. The earlier ordinary-termination pass does not settle this case. |
| Android alert suppression | Logs recorded suppressed sound/vibration for 19/20 burst notifications; actual audible behavior was not checked by a person. |
| Android text-length limits | A 1,024-character body limit was observed at Samsung capture and Xiaomi joined-text display. Method A must still demonstrate preservation of both its title and body. No claim of a universal limit across devices is established by this evidence. |
| Accidental forwarding during tests | One unrelated notification was forwarded during the FR-17 attempt; the owner identified it as charging-related. Current forwarding lacks M4's per-app opt-in filtering. |
| Relay-log attribution | Tail redacts the device header; direct attribution of a request to Xiaomi is unavailable. Correlate safe evidence with target-only authentication rather than exposing credentials. |

**Remaining M3.4 verification:** real-device fetch-only delivery (recorded next task); cold-start delivery/burst after HyperOS cleanup; notification permission/channel recovery; acknowledgement failure under network interruption; natural FCM token rotation; longer soak and repeated/sustained-load FCM reliability; LAN regression with a matching development peer; production expiry-cron observation; and remaining latency/reliability acceptance evidence. The original burst visibility failure stays recorded. The QA's proposed test after Method A is a cold-start burst of at most 12 notifications against a receiver killed by HyperOS while locked; it has not run and is not an automatic continuation authorization.

**Deferred or unimplemented work:** native sender capture when JS is absent; autonomous token-upload/retry workers; receipt compaction; QR pairing; iOS receiver/Notification Service Extension and CryptoKit interoperability; M4 filtering; M5 OEM hardening, heartbeat, diagnostics and the 72-hour soak; M6 history/quiet hours/mute/settings; and M7 release readiness. The M5 foreground-service decision remains measurement-dependent. The existing plan also records 30 dependency vulnerabilities from a prior install; their current state was not reassessed here.

**Pending decisions:** [PRD §12 Q10](notification-sync-prd.md#12-open-questions) remains **OPEN**. Reliable in-app notification history is Effie's **preliminary preference**, not an approved implementation decision. Bringing FR-21 forward from M6, at-rest protection, retention, backup exclusion and privacy wording are unresolved. Q4 (iOS sustained push behavior), Q5 (icons), Q6 (TTL defaults/stale presentation), Q9 (product name), Q1's submission-review uncertainty and Q8's conditional foreground-service choice retain their recorded status. No product question is answered by this handoff.

**Known constraints on resumption:** Claude's usage limit caused the pause; its reset time is unknown and is not a technical test result. Phone availability/readiness and production-monitoring authorization must be rechecked. Android preserving the dry-run lengths and the actual sealed size remain unverified prerequisites. These are not evidence that Method A has failed.

### Repository evidence and discrepancies

- Reviewed working tree at **HEAD `6138c0f`**, `Complete M3.3: encrypted relay delivery to an Android receiver`. Its commit time is 2026-10-17; the documented M3.3 verification date remains 2026-10-11. Commit time does not redetermine test time.
- At session start, `CHANGELOG.md`, `notification-sync-m3-plan.md`, `notification-sync-m3-qa.md` and `notification-sync-prd.md` already had uncommitted updates, and `.claude/` was untracked. Those existing changes were preserved. The checkpoint is saved in the working tree; staging, commits and pushes remain the owner's responsibility.
- QA, the M3 plan and the earlier changelog still record Method A as awaiting approval. That is the earlier written state. The owner now reports approval followed immediately by the usage limit. New continuation notes supersede the approval status only; no historical evidence is rewritten and no execution is inferred. Monitoring authorization/scope must still be reconfirmed as requested above.
- The broad label “M2 complete” in the handoff does not close QR pairing: the M3 plan explicitly defers it. Likewise, M3.1–M3.3 completion is Android-only, not completion of the PRD's original iOS/APNs scope.
- The plan's older blanket statement that burst/latency measurement is outstanding is superseded for the completed 2026-10-17 burst by its dated result. Soak, broader latency acceptance and sustained reliability remain open.
- The PRD header still says “Draft v0.5” although its revision history reaches v0.9; the existing changelog already flags this. Q10's timing summary also says all nine removals occurred within about four seconds of arrival, while the detailed QA table records the preflight's retention as **73.1 s** and burst-1 through burst-8 as roughly **3.8–4.3 s**. Use the detailed QA timings; retain the historical wording and its discrepancy.

**Not independently verified in this checkpoint session:** live phones, current pairing/registration/network state, production relay/deployment state, original raw QA logs or the prior Claude conversation. Review was limited to local documents, Git state and relevant source inspection. No test, dry run, phone operation, production access, dependency installation, deployment, source-code change, staging, commit or push was performed.

Source documents: [PRD and open questions](notification-sync-prd.md), [M3 implementation plan](notification-sync-m3-plan.md), [M3 real-device QA](notification-sync-m3-qa.md), [changelog](CHANGELOG.md), [repository guidance](CLAUDE.md), [Codex entry instructions](AGENTS.md).
