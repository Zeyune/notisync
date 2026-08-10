# Changelog

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
