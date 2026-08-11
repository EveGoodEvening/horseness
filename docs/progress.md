# Horseness Authoritative Progress

This integrated summary is the authoritative scheduler ledger. Detailed execution evidence lives in `docs/progress/<ID>.md`. C00/C01 historical claims and receipts remain immutable under `docs/claims/` and `docs/checkpoints/`; C02 onward uses conventional tracker commits and exact acceptance evidence without per-chunk cryptographic graphs.

## Global status

- **Planning state:** C00, C01, and C02 are complete; F001/F002 are closed; R001/R002 are complete; C03 is claimed and in progress
- **Active claims:** C03 from base `bca4c85`
- **Next eligible:** none while C03 is active
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
| C03 | Protocol | C02 | claimed; in-progress from base `bca4c85` |
| C04 | Policy/admission evaluator | C03 | not-started |
| C05 | SQLite 0001/artifacts | C04 | not-started |
| C06 | Recovery/import/retention | C05 | not-started |
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

C02 completed from tracker-only claim base `ba7ee37` at final candidate `fd100bff3b7e577acf0838050fc8b89f7d1e870d`. The implementation commit `8034706` and review-fix commits `7c377f7`, `12d592a`, and `fd100bf` are integrated. The serialized `8034706` planning correction adding narrowly scoped root `package.json` and `docs/plan.md` ownership was reviewed before acceptance; no conflicting parallel work existed, and history was not rewritten. All three literal C02 gates ran under Node 22 with `CI=1 TZ=UTC LANG=C NODE_OPTIONS=--unhandled-rejections=strict`: typecheck exit 0, 40 tests exit 0, and 61 vectors across all eleven families exit 0. Blocker-only code and accounting re-reviews were clean. C03 is now claimed from integrated base `bca4c85` through this serialized `chore(progress): claim C03` tracker transaction. Before implementation, the same transaction records the necessary correction in `docs/plan.md`: C03 owns root `package.json` only for the frozen `protocol:conformance` and `generated:check` forwarding scripts; no other root-manifest change is authorized.

## Planning review status

The bootstrap workflow blocker remains closed. C02 is complete with all review findings resolved and exact acceptance evidence recorded. C03 is the sole active chunk under the simplified post-C01 tracker workflow; C04 remains ineligible until C03 completes, and no recursive development-attestation work is required.
