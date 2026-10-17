# Repository instructions

Read [CLAUDE.md](CLAUDE.md) for repository constraints and documentation conventions.

## Dynamic project status

This procedure is mandatory whenever the owner asks about status, progress, remaining tasks, next steps, where work stopped or continuing previous work. **[PROJECT_STATUS.md](PROJECT_STATUS.md) is only the last documented checkpoint. It is never automatically authoritative or permanently current.** This also applies to status summaries in other guidance files.

1. Read the previous checkpoint, including its date, evidence, recorded next task and owner prerequisites.
2. Inspect the **current repository state**: branch/HEAD, recent Git history and relevant commit diffs, staged and unstaged changes, and relevant untracked project files. Include uncommitted work; a missing commit or formal handoff does not mean no progress occurred. Do not expose secret or credential files.
3. Review recent [changelog entries](CHANGELOG.md), [QA records](notification-sync-m3-qa.md), [implementation plans](notification-sync-m3-plan.md), relevant source, tests and recorded test results, and PRD decisions. Identify implementations, fixes, test executions and decisions after the checkpoint. Use evidence dates and revisions where available; commit timestamps alone do not establish when a test ran.
4. Reconcile the old checkpoint against that evidence. Track **implementation and verification separately**: code or a test file existing, a commit title, an approval, or a proposed procedure does not prove completion or a passing run. State the scope, environment and revision of available verification; an automated result does not establish real-device success, and later changes may invalidate earlier results.
5. Clearly distinguish **completed, verified, unfinished, blocked and unknown** work. Cite the evidence for status changes and flag conflicts. If later progress cannot be verified, report the uncertainty and what evidence is missing instead of assuming the old checkpoint is current. Absence of a newer handoff is not proof that its next task is still undone.
6. Determine the **actual next task from the most recent verifiable progress**, with any owner approval or physical involvement needed. Never repeat a completed task merely because an old checkpoint lists it. If completion is uncertain, identify the smallest evidence check needed before recommending a rerun. A status inquiry alone does not authorize device tests or production access.
7. When newer evidence establishes a more recent state, update `PROJECT_STATUS.md` in the same session: add a dated checkpoint above the previous one and refresh the latest-checkpoint pointer. Record the evidence, implementation/verification distinctions, remaining work, uncertainty, actual next task and owner prerequisites. **Preserve previous dated checkpoints and all test evidence**; record corrections as dated superseding notes, without erasing or rewriting history.

Maintain the checkpoint after **major milestone changes, QA results, implementation work and important decisions**, even when no formal handoff is requested. Record implementation that still needs verification as such. Keep detailed test evidence in QA and log each logical change in `CHANGELOG.md`; use concise checkpoint summaries and links rather than duplicate reports or additional tracking files. When evidence is insufficient, add a dated uncertainty note without presenting it as verified progress or silently refreshing the old checkpoint's date.

Git commits and pushes are exclusively performed by the project owner. Do not stage unless the owner explicitly requests it. Observe the current session's scope and restrictions before running tests, operating devices or accessing production.
