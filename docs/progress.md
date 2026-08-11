# Horseness Authoritative Progress

This integrated summary is the authoritative scheduler ledger. Detailed execution evidence lives in `docs/progress/<ID>.md`. C00/C01 historical claims and receipts remain immutable under `docs/claims/` and `docs/checkpoints/`; C02 onward uses conventional tracker commits and exact acceptance evidence without per-chunk cryptographic graphs.

## Global status

- **Planning state:** C00, C01, C02, C03, and C04 are complete; F001/F002 are closed; R001/R002 are complete; C05 is in progress
- **Active claims:** C05 from integrated base `4513730`; tracker claim commit `6259949` was integrated before source edits
- **Next eligible:** none while C05 is active and its full-chunk review remains pending
- **Active blockers:** none; the two prior C05 blockers were resolved by `f7acb74` and independently reviewed clean
- **Last integrated receipt:** immutable C01 `docs/checkpoints/C01/final/1.json`, envelope digest `17ddd75b49e35d3bf6f432c8c6acca30b4a66512229453aca4fc63e7f427ea7d`, indexed at A01 commit `223023330cb000b759d8a8b2419514638c1aa179`; receipt/index bytes must not be overwritten
- **Release readiness:** not started
- **Base chunk count:** 26 (`C00`–`C25`)
- **Historical remediation count:** 2 (`R001`, `R002`, both complete)

## Post-C01 chunk workflow

For C02 onward: commit the two tracker files to claim a dependency-ready chunk; implement within exact owned paths; run the plan's exact gates; commit review fixes and rerun affected gates; then commit the two tracker files to record completion and select the next chunk. No post-C01 development claim JSON, signed checkpoint receipt, index append, or P/R/V closure graph is required. Product runtime evidence, authenticated worker receipts, install trust, and release/external-effect evidence remain mandatory delivery requirements.

## Base chunk index

| IDs | Purpose | Dependency | Status |
|---|---|---|---|
| C00 | Tool-free contract freeze | — | complete |
| C01 | Bootstrap/CI | C00 | complete; immutable A01 evidence retained |
| R001 | Historical C01 planning/implementation remediation | F001 + C00 | complete; F001 closed |
| R002 | Historical C01 verifier remediation | F002 + immutable C01 receipt | complete; F002 closed |
| C02 | Domain and transition contracts | C01 | complete; final candidate `fd100bf`; 40 tests and 61 vectors green |
| C03 | Protocol | C02 | complete; final candidate `2998e4f`; 23 package tests and 1,377 conformance checks green |
| C04 | Policy/admission evaluator | C03 | complete; claim `a5ad6fa`; implementation `385449c`; review fixes/final candidate `44f99b9`, `489345b`; typecheck and 10 tests green; clean final review |
| C05 | SQLite 0001/artifacts | C04 | in-progress; claim `6259949` integrated before source edits; blocker fixes `f7acb74`; Node 22 gates green: typecheck exit 0, migration 7/7, crash matrix 38/38; focused blocker re-review clean; full-chunk review pending |
| C06 | Recovery/import/retention | C05 | ineligible; blocked on C05 completion and clean full-chunk review |
| C07 | Admission service | C06 | not-started |
| C08 | Task/fork projections | C07 | not-started |
| C09 | Context reconstruction | C08 | not-started |
| C10 | Scheduler/dispatch | C09 | not-started |
| C11 | Four-host feasibility | C10 | not-started |
| C12 | SDK/adapter kit | C11 | not-started |
| C13 | Daemon/bootstrap auth | C12 | not-started |
| C14 | CLI/credentials | C13 | not-started |
| C15 | Pi native bundle | C14 | not-started |
| C16 | OMP native bundle | C15 | not-started |
| C17 | Claude native bundle | C16 | not-started |
| C18 | Codex native bundle | C17 | not-started |
| C19 | Installer journal/trust | C18 | not-started |
| C20 | Installer/bootstrap/doctor | C19 | not-started |
| C21 | Security/system validation | C20 | not-started |
| C22 | Release trust ceremony, versioning, and candidate | C21; offline ceremony is first pre-signing phase | not-started |
| C23 | Authorized publication | C22 | not-started |
| C24 | Published-artifact verification | C23 | not-started |
| C25 | Authorized promotion and announcement | C24 | not-started |

## Historical correction accounting

F001/R001 established the accepted `v4:C01-remediation` candidate and immutable signed A01 receipt. F002/R002 corrected the verifier to bind that version and authenticate the unique historical A01 transaction from any descendant `HEAD`. Focused live receipt and resume verification pass without requiring a recursive R002 candidate receipt. The finding index records both lifecycles closed. These records are historical and are not templates for later chunks.

## Resume instructions

C04 is complete. Its tracker-only claim began at base `33550d0` with claim commit `a5ad6fa`; implementation commit `385449c` and review-fix commits `44f99b9` and `489345b` are integrated, with final candidate `489345b`. Both literal C04 gates ran in order under Node 22 with exact environment `CI=1 TZ=UTC LANG=C NODE_OPTIONS=--unhandled-rejections=strict`: typecheck exit 0; 10 package tests exit 0. The final blocker-only review was clean and all C04 checklist items are checked.

C05 is claimed and remains in progress. Tracker claim commit `6259949` was integrated before source edits. Commit `f7acb74` resolved the two current blockers—non-genesis append-slice validation and workspace-scoped authenticated artifact-reference binding—and an independent focused review found both fixes clean. All three exact gates ran under Node 22 with `CI=1 TZ=UTC LANG=C NODE_OPTIONS=--unhandled-rejections=strict`: typecheck exit 0; migration 7/7; crash matrix 38/38. A clean full-chunk review is still pending, so C06 and every later chunk remain ineligible.

## Planning review status

The bootstrap workflow blocker remains closed. C02, C03, and C04 are complete with all review findings resolved and exact acceptance evidence recorded. C05 is the sole active conventional tracker claim: claim commit `6259949` preceded source edits, its two current blockers were resolved by `f7acb74` and independently reviewed clean, and its exact Node 22 gates passed (typecheck exit 0, migration 7/7, crash matrix 38/38). C05 remains in progress pending a clean full-chunk review; C06 and all later chunks remain ineligible, and no recursive development-attestation work is required.
