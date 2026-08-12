# Horseness Authoritative Progress

This integrated summary is the authoritative scheduler ledger. Detailed execution evidence lives in `docs/progress/<ID>.md`. C00/C01 historical claims and receipts remain immutable under `docs/claims/` and `docs/checkpoints/`; C02 onward uses conventional tracker commits and exact acceptance evidence without per-chunk cryptographic graphs.

## Global status

- **Planning state:** C00, C01, C02, C03, C04, C05, C06, and C07 are complete; C08 is in progress; F001/F002 are closed; R001/R002 are complete
- **Active claims:** C08 from integrated base `935c02e`; tracker claim transaction pending integration before source edits
- **Next eligible:** none while C08 is active; C09 remains dependency-ineligible
- **Active blockers:** none
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
| C05 | SQLite 0001/artifacts | C04 | complete; claim `6259949`; implementation `13e765e`; review fixes `0adcd98`, `f7acb74`, `ef4a921`, `6f587c8`; relevant tracker commit `bd44a2b`; final candidate `6f587c8`; Node 22 gates green: typecheck exit 0, migration 9/9, crash matrix 43/43; two definitive reviews clean |
| C06 | Recovery/import/retention | C05 | complete; claim `f469bd7`; implementation `c85f741`; review fixes `0f95464`, `0814993`, `4ee725f`, `bbec9e8`, `c022c4c`, `6d898b5`; final candidate `6d898b5`; Node 22 gates green: typecheck exit 0, full test 58/58, recovery 30/30, import-retention 10/10; final in-scope blocker/high review clean |
| C07 | Admission service | C06 | complete; claim `eefbd9e`; implementation `6999bea`; review fixes `a247df9`, `9ad86da`, `bd4a105`, `da49adc`, `b3fd849`; ownership correction integrated at `9ad86da`; final candidate `b3fd849`; completion `935c02e`; Node 22 gates green: orchestrator typecheck exit 0, admission 19/19; supplemental domain typecheck exit 0 and tests 41/41; clean final review |
| C08 | Task/fork projections | C07 | in-progress; claimed from integrated base `935c02e`; tracker claim transaction must precede source edits; three ordered gates frozen in `docs/progress/C08.md` |
| C09 | Context reconstruction | C08 | not-started; dependency-ineligible while C08 is in progress |
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

C05 is complete. Tracker claim commit `6259949` preceded source edits; implementation commit `13e765e`, review-fix commits `0adcd98`, `f7acb74`, `ef4a921`, and `6f587c8`, and relevant tracker commit `bd44a2b` are integrated, with final candidate `6f587c8`. All three literal C05 gates ran in order under Node 22 with exact environment `CI=1 TZ=UTC LANG=C NODE_OPTIONS=--unhandled-rejections=strict`: typecheck exit 0; migration 9/9; crash matrix 43/43. Two independent definitive reviews were clean, all C05 checklist items are checked, and C06 is the sole next eligible chunk.

C06 is complete. Tracker claim commit `f469bd7` preceded source edits; implementation commit `c85f741` and review-fix commits `0f95464`, `0814993`, `4ee725f`, `bbec9e8`, `c022c4c`, and `6d898b5` are integrated, with final candidate `6d898b5` and completion commit `fcc0b0a`. All four literal C06 gates ran in order under Node 22 with exact environment `CI=1 TZ=UTC LANG=C NODE_OPTIONS=--unhandled-rejections=strict`: typecheck exit 0; full test 58/58; recovery 30/30; import-retention 10/10. The recovery count includes the final retained-backup race tests. The final review was clean for every in-scope blocker/high issue. The final same-user post-reservation namespace race was explicitly rejected as outside the frozen v1 boundary—not fixed—under `docs/security/threat-model.md` and the same-user exclusions in `docs/architecture.md` and `AGENTS.md`. All C06 checklist items are checked.

C07 is complete. Tracker claim commit `eefbd9e` preceded source edits; implementation commit `6999bea` and review-fix commits `a247df9`, `9ad86da`, `bd4a105`, `da49adc`, and `b3fd849` are integrated, with final candidate `b3fd849` and completion commit `935c02e`. Commit `9ad86da` recorded the reviewed narrow ownership correction for additive domain event, receipt, reducer, and focused test coverage after review discovered the need; the retained-history exception did not broaden ownership beyond the recorded paths. Both literal C07 gates ran in order under Node 22 with exact environment `CI=1 TZ=UTC LANG=C NODE_OPTIONS=--unhandled-rejections=strict`: orchestrator typecheck exit 0 and `test:admission` 19/19. Supplemental domain verification reported typecheck exit 0 and 41/41 tests. The final blocker/high review was clean, and all C07 checklist items are checked.

C08 is claimed from integrated base `935c02e`. This tracker transaction must be committed before any C08 source edit. Exact ownership is limited to orchestrator task, fork, receipt, and projection source/tests; the orchestrator public index and package manifest; the lockfile; `.changeset/C08-orchestrator-projections.md`; and the two C08 tracker files, as enumerated in `docs/progress/C08.md`. Its three literal gates are orchestrator typecheck, `test:tasks-forks-receipts`, and `test:model`, in that order under the frozen Node 22 environment. C09 remains ineligible until C08 completes.

## Planning review status

The bootstrap workflow blocker remains closed. C02, C03, C04, C05, C06, and C07 are complete with all accepted in-scope review findings resolved and exact acceptance evidence recorded. C07 completed at final candidate `b3fd849` after claim `eefbd9e`, implementation `6999bea`, review fixes `a247df9`, `9ad86da`, `bd4a105`, `da49adc`, and `b3fd849`, and completion commit `935c02e`; ownership correction commit `9ad86da` records the reviewed narrow additive domain extension and retained-history context. Its exact Node 22 gates passed with orchestrator typecheck exit 0 and admission tests 19/19; supplemental domain typecheck exited 0 and domain tests passed 41/41. The final review was clean. C08 is now the sole active claimed chunk, C09 is dependency-ineligible, and no recursive development-attestation work is required.
