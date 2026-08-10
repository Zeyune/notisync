# Changelog

## 2026-08-10

### Add CLAUDE.md with PRD-derived working constraints
**Type:** Added
**Files:** `CLAUDE.md`, `CHANGELOG.md`
**Related:** FR-10, FR-27, FR-30, FR-35, §11 Q1/Q2/Q7/Q8, M-1

Created `CLAUDE.md` covering the constraints a future session cannot infer from the repo, since the repo holds no code: the M-1 compliance gate blocking implementation, the permanent-FR-numbering rule, the Android-sender/iOS-receiver platform limit, the server-cannot-decrypt boundary, the no-analytics rule, the Notification Service Extension requirement, and the Expo-prebuild stack decision. Also created this changelog.

**Why:** The only artifact here is the PRD, so a session that starts without reading all 25 KB of it would plausibly begin scaffolding code — which M-1 forbids until the Play policy question (Q1) is answered — or propose an iOS sender, server-side filtering, or key recovery, each of which the architecture rules out by construction rather than by preference.

**Decided:** `CLAUDE.md` documents no build, lint, test, or run commands. The PRD's §8 names an intended stack (Expo prebuild, Kotlin native module, Notifee, Supabase), but none of it exists on disk and none of its commands have been run. Writing them down would present unverified guesses as established fact to future sessions. Rejected the alternative of listing them marked as "planned". They get added when a scaffold makes them real.

**Not verified:** Nothing in `CLAUDE.md` was checked against a running project — there isn't one. Every statement is sourced from `notification-sync-prd.md` v0.2 or from Effie's device-wide standing rules, not from executed commands.
