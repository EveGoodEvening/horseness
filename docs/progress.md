# Horseness Authoritative Progress

This integrated summary is the authoritative scheduler ledger. Detailed execution evidence lives in `docs/progress/<ID>.md`. C00/C01 historical claims and receipts remain immutable under `docs/claims/` and `docs/checkpoints/`; C02 onward uses conventional tracker commits and exact acceptance evidence without per-chunk cryptographic graphs.

## Global status

- **Planning state:** C00, C01, C02, C03, C04, C05, C06, C07, C08, C09, and C10 are complete; C11 is in progress; F001/F002 are closed; R001/R002 are complete
- **Active claims:** C11 (four-host feasibility and hermetic harness), solely claimed from integrated base `ec0c18e`
- **Next eligible:** none; C12 remains dependency-ineligible until C11 is complete, accepted, reviewed, and recorded
- **Active blockers:** C11 ordered boundary gate exposed a C01 checker defect; a reviewed narrow correction authorizes the boundary checker and one focused C11 harness test to distinguish package-internal imports from package escapes
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
| C08 | Task/fork projections | C07 | complete; claim `d6bfd42`; implementation `171b86d`; review fixes `f7721d5`, `241a977`, `219f740`, `3c87b2a`, `2a3c873`; final candidate `2a3c873`; Node 22 gates green: orchestrator typecheck exit 0, task/fork/receipt 16/16, model 6/6; supplemental store typecheck exit 0 and tests 61/61; clean final review |
| C09 | Context reconstruction | C08 | complete; claim `33f6529`; implementation `f350ba8`; review fixes `ff18b7e`, `023c948`, `0913eb0`; reviewed ownership correction recorded; final candidate `0913eb0`; Node 22 gates green: orchestrator typecheck exit 0, context golden 15/15, context-binding vectors 3/3; supplemental store typecheck exit 0 and full tests 74/74; clean final review |
| C10 | Scheduler/dispatch | C09 | complete; claim `441047c`; implementation `0c01a14`, `d071640`; review fixes `fdd58f5`, `ae5a25c`; final candidate `ae5a25c`; Node 22 gates green: orchestrator typecheck exit 0, dispatch-property 11/11, dispatch-restart-races 26/26; supplemental store typecheck exit 0, dispatch-authority 2/2, full store 76/76; clean final review |
| C11 | Four-host feasibility | C10 | in-progress; tracker-only claim from integrated base `ec0c18e`; C10 final candidate `ae5a25c` verified complete; reviewed narrow boundary-checker/test correction active |
| C12 | SDK/adapter kit | C11 | not-started; dependency-ineligible while C11 is active |
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

C08 is complete. Tracker claim commit `d6bfd42` preceded source edits; implementation commit `171b86d` and review-fix commits `f7721d5`, `241a977`, `219f740`, `3c87b2a`, and `2a3c873` are integrated, with final candidate `2a3c873`. All three literal C08 gates ran in order under Node 22 with exact environment `CI=1 TZ=UTC LANG=C NODE_OPTIONS=--unhandled-rejections=strict`: orchestrator typecheck exit 0, `test:tasks-forks-receipts` 16/16, and `test:model` 6/6. Supplemental trusted-authority verification reported store typecheck exit 0 and 61/61 store tests. The final blocker/high review was clean, all C08 checklist items are checked, no blockers remain, and C09 is the sole next dependency-ready chunk.

C09 is complete. Tracker claim commit `33f6529` preceded source edits; implementation commit `f350ba8` and review-fix commits `ff18b7e`, `023c948`, and `0913eb0` are integrated, with final candidate `0913eb0`. Review recorded the narrow ownership correction for additive orchestrator exports, trusted exact-cursor context materialization, and crash-safe authoritative context publication without broadening the authorized paths. All three literal C09 gates ran in order under Node 22 with exact environment `CI=1 TZ=UTC LANG=C NODE_OPTIONS=--unhandled-rejections=strict`: orchestrator typecheck exit 0, `test:context-golden` 15/15, and `context-binding` vectors 3/3. Supplemental store verification reported typecheck exit 0 and full tests 74/74. The final blocker/high review was clean, all C09 checklist items are checked, no blockers remain, and C10 is the sole next dependency-ready chunk.

C10 is complete. Tracker claim commit `441047c` preceded source edits; implementation commits `0c01a14` (core scheduler/attempts/leases/context authenticity) and `d071640` (dispatch/recovery), and review-fix commits `fdd58f5` (review-fix integration) and `ae5a25c` (durable SQLite dispatch authority + atomic receipt adoption) are integrated, with final candidate `ae5a25c`. Three reviewed ownership corrections are recorded: C09 context authenticity assertion, task-projection runtime-authenticated capabilities, and durable SQLite dispatch authority. All three literal C10 gates ran in order under Node 22 with exact environment `CI=1 TZ=UTC LANG=C NODE_OPTIONS=--unhandled-rejections=strict`: orchestrator typecheck exit 0, `test:dispatch-property` 11/11, and `test:dispatch-restart-races` 26/26. Supplemental store verification reported typecheck exit 0, `dispatch-authority` 2/2, and full store tests 76/76. The final blocker/high review was clean, all C10 checklist items are checked, no blockers remain, and C11 is the sole next dependency-ready chunk.

C11 is the sole active claim from integrated base `ec0c18e`; no implementation or gate execution is part of this tracker transaction. Source ownership is exactly `tests/fixtures/hosts/**`, `tests/host-feasibility/**`, `scripts/host-feasibility/**`, `config/hosts/capability-matrix.v1.json`, `docs/compatibility.md`, `docs/integrations/feasibility.md`, `package.json`, `pnpm-lock.yaml`, and `.changeset/C11-host-feasibility.md`; the conventional tracker transaction separately owns only `docs/progress.md` and `docs/progress/C11.md`. Because C11 is package-changing, its expansion is limited to the root `package.json` scripts/devDependencies required by the harness and `pnpm-lock.yaml`, serialized by pnpm; it owns no workspace package source manifest. The feasibility matrix must pin each real Pi, OMP, Claude Code, and Codex native binary and its official validator by exact supported version and immutable distribution identity/digest, exercise native discovery/load/context injection/attempt/receipt/restart-or-declared-unsupported/uninstall minimums, and reject a missing binary, missing official validator, unsupported native minimum, managed blocking, or CLI-only fallback. Hermetic validation uses a local deterministic provider with fixed inputs, outputs, ordering, clocks, budgets, and network disabled. Credentialed-live checks are separate: local/development runs may skip only when the required opaque credential reference is absent and must emit an explicit machine-readable skip reason; configured credential references that are missing, invalid, redaction-unsafe, over budget, or fail the live path are failures; required publication evidence never skips and fails closed. C11's exact ordered Node 22 gates are root typecheck, boundaries, four host validators in Pi/OMP/Claude/Codex order, harness self-tests, and matrix verification, all under `CI=1 TZ=UTC LANG=C NODE_OPTIONS=--unhandled-rejections=strict`, with exit 0 and no omission, reordering, substitution, or hermetic-gate skip. C12 remains dependency-ineligible.

Boundary-gate correction: the ordered C11 gate exposed that the C01 checker rejected every relative import containing `..`, including legitimate sibling modules contained by the same package. C11 is narrowly authorized to edit `scripts/boundaries-check.mjs` and add `tests/host-feasibility/boundaries-check.test.mjs` solely for containment-based classification and focused proof that internal imports pass while cross-package deep/escaping imports still fail. File-specific allowlists and suppressed findings remain prohibited.

## Planning review status

The bootstrap workflow blocker remains closed. C02 through C10 are complete with all accepted in-scope review findings resolved and exact acceptance evidence recorded. C10 completed at final candidate `ae5a25c`; its exact ordered Node 22 gates and supplemental store verification passed, and the final reviews were clean. C11 is now the sole active tracker claim from integrated base `ec0c18e`; C12 remains dependency-ineligible. The active C11 boundary-checker correction is limited to the reviewed paths and invariant above.
