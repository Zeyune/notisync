# Changelog

## 2026-08-10

### Export a standalone decision record outside the repository
**Type:** Added
**Files:** `../notifsync-decisions-2026-08-10.md`
**Related:** §12 Q1, Q3, Q7, Q8, Q9, FR-23, LICENSE

Wrote a digest of everything decided on 2026-08-10 to `C:\Users\Effie\Documents\Codes\notifsync-decisions-2026-08-10.md` — outside the repository, at Effie's request. Covers Q1, Q7, Q3, Q8, the Q9 candidate and the licence, each with the decision, its reasoning, what was rejected, and what stayed unverified, plus the M0-onward sequence.

**Why:** the reasoning for the day's decisions is spread across the PRD's §9.1, §9.3, §10, §12 and its revision history, which makes it hard to review as a whole or share without handing over the entire 30 KB document. The digest is readable standalone.

**Note:** the file sits outside the project directory and is therefore not covered by this repository's git history or licence. The PRD and this changelog remain authoritative; the digest will go stale if decisions change and is not maintained as a living document.

## 2026-08-10

### Answer Q8 as specialUse; make the foreground service conditional
**Type:** Changed
**Files:** `notification-sync-prd.md`
**Related:** §10 M5, §12 Q8, FR-23, FR-24, FR-26

Answered Q8: declare `specialUse` if a foreground service ships, never `dataSync`. Rewrote FR-23 — the foreground service is OEM hardening, not what keeps the listener alive — and made it conditional on gaps measured at M5 rather than assumed at M0. Reordered M5 so the 72-hour soak test runs before the service is built. PRD at v0.5.

**Why:** `dataSync` is the type every tutorial recommends for keeping a notification listener alive, and on Android 15+ it is capped at six hours per 24 hours and barred from starting on `BOOT_COMPLETED`. Building on it would have produced a relay that dies silently mid-day — the exact symptom FR-24 identifies as the number one cause of abandonment in this category, engineered in on purpose. `remoteMessaging` avoids the timeout but is documented for text-message continuity between devices, which is not what this app does; `specialUse` is the honest fit and its review cost is a justification string plus the demo video.

**Decided — soak test before foreground service, not after:** FR-23's premise that the service keeps the listener alive was false, so the service may be unnecessary. FR-26's sequence numbers already make dropped notifications visible, meaning M5 can measure whether gaps occur before deciding to build. Rejected keeping the service as an M0 given: it would have baked in a persistent notification, a Play review dependency and a demo video before knowing any were needed, and would have destroyed the measurement by removing the failure it was meant to detect.

**Not verified:** `remoteMessaging` was ruled out by reading its documented scope, not on a known rejection — if review rejects the `specialUse` justification it remains the fallback. Google describes the six-hour cap as "currently" limited to `dataSync` and `mediaProcessing`; that set grew once already, so it needs re-checking at every target-API bump. Nothing has been tested on an OEM device and no submission has been made.

## 2026-08-10

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

## 2026-08-10

### Answer Q7 as Apache-2.0 and free; clear the M-1 gate
**Type:** Decided
**Files:** `notification-sync-prd.md`
**Related:** §9.3, §10 M-1, §12 Q3, Q7, FR-9, FR-16, FR-17, FR-32

NotifSync ships under **Apache-2.0**, free on both stores, with a free hosted relay under a published fair-use quota and no paid tier at launch. Self-hosting stays free and feature-identical, which answers Q3 as a consequence. Rewrote §9.3 and updated M-1 — **no open question now blocks M0.** PRD at v0.4.

**Why:** §9.3 had framed hosted-relay cost as an unfunded risk requiring a business model, but the architecture already made it near-free per user — FR-32 deletes ciphertext on acknowledgement, FR-16 delivers over FCM/APNs at no cost, FR-17 keeps small payloads out of storage, FR-9 caps volume. The real exposure is abuse and spikes, which a quota controls and a price does not. With no cost problem to fund, there was no reason to charge, and charging would have forfeited §1's positioning against Join.

**Decided — Apache-2.0 over GPL-3.0, on a hard constraint rather than preference:** GPLv3 is incompatible with App Store distribution in practice, so copyleft would have cost the iOS receiver — the device this product exists to reach. MPL-2.0 was the runner-up and remains available for new files if a closed fork ever becomes a concern. Keeping it closed was rejected as forfeiting §1's argument.

**Decided — no paid tier now, but the door is not closed:** recorded in §12 Q7 that Play Billing and StoreKit hold payment identity, so a future store-managed tier would not breach §2's accountless rule. Billing self-hosters or taking payment outside the stores would, and counts as a change to §2.

**Not verified:** the GPLv3/App Store incompatibility rests on consistent project experience rather than a citable Apple clause — Apple publishes no licence-specific rule. No legal advice was taken. **No `LICENSE` file has been added to the repository**; the decision is recorded but not yet enacted on disk.

## 2026-08-10

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

## 2026-08-10

### Add CLAUDE.md with PRD-derived working constraints
**Type:** Added
**Files:** `CLAUDE.md`, `CHANGELOG.md`
**Related:** FR-10, FR-27, FR-30, FR-35, §11 Q1/Q2/Q7/Q8, M-1

Created `CLAUDE.md` covering the constraints a future session cannot infer from the repo, since the repo holds no code: the M-1 compliance gate blocking implementation, the permanent-FR-numbering rule, the Android-sender/iOS-receiver platform limit, the server-cannot-decrypt boundary, the no-analytics rule, the Notification Service Extension requirement, and the Expo-prebuild stack decision. Also created this changelog.

**Why:** The only artifact here is the PRD, so a session that starts without reading all 25 KB of it would plausibly begin scaffolding code — which M-1 forbids until the Play policy question (Q1) is answered — or propose an iOS sender, server-side filtering, or key recovery, each of which the architecture rules out by construction rather than by preference.

**Decided:** `CLAUDE.md` documents no build, lint, test, or run commands. The PRD's §8 names an intended stack (Expo prebuild, Kotlin native module, Notifee, Supabase), but none of it exists on disk and none of its commands have been run. Writing them down would present unverified guesses as established fact to future sessions. Rejected the alternative of listing them marked as "planned". They get added when a scaffold makes them real.

**Not verified:** Nothing in `CLAUDE.md` was checked against a running project — there isn't one. Every statement is sourced from `notification-sync-prd.md` v0.2 or from Effie's device-wide standing rules, not from executed commands.
