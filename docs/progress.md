# Horseness Authoritative Progress

This integrated summary is the authoritative scheduler ledger. Detailed execution evidence lives in `docs/progress/<ID>.md`. C00/C01 historical claims and receipts remain immutable under `docs/claims/` and `docs/checkpoints/`; C02 onward uses conventional tracker commits and exact acceptance evidence without per-chunk cryptographic graphs.

## Global status

- **Planning state:** C00 and C01 are complete; F001/F002 are closed; R001/R002 are complete
- **Active claims:** none
- **Next eligible:** C02
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
| C02 | Domain and transition contracts | C01 | not-started; eligible |
| C03 | Protocol | C02 | not-started |
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

Claim C02 with commit message `chore(progress): claim C02`, changing only `docs/progress.md` and a new `docs/progress/C02.md`. Record the current integrated base, C01 completion, C02 exact owned paths, and the three literal C02 acceptance commands. Do not implement C02 in the claim commit. After implementation, gates, and review fixes are green, finish with `chore(progress): complete C02`.

## Planning review status

The bootstrap workflow blocker is closed. C02 is dependency-ready and no recursive development-attestation work remains.
