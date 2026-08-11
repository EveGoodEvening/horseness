# Horseness Authoritative Progress

This integrated summary is the authoritative scheduler ledger. Detailed execution evidence lives in `docs/progress/<ID>.md`; canonical claims live append-only at `docs/claims/<ID>/<generation>.json` and are authenticated by `docs/claims/index.jsonl`; immutable receipts live under `docs/checkpoints/<ID>/` and are authenticated by `docs/checkpoints/index.jsonl`.

## Global status

- **Planning state:** C01 is blocked post-attestation by finding `F002`; `R001` remains complete and formal remediation `R002` generation 1 is active
- **Active claims:** R002 generation 1, `in-progress`; claim `docs/claims/R002/1.json`, digest `559ad9eb3fa5cddf37368f679e0b78f827cfac413b37083c7ab5c36146868966`, expires `2026-08-12T01:28:36Z`
- **Next eligible:** none; C02 remains ineligible until the exact live receipt and historical A01 resume checks both pass
- **Active blockers:** F002 (`acceptance contract mismatch` in the integrated verifier)
- **Last integrated receipt:** immutable C01 `docs/checkpoints/C01/final/1.json`, envelope digest `17ddd75b49e35d3bf6f432c8c6acca30b4a66512229453aca4fc63e7f427ea7d`, indexed at A01 commit `223023330cb000b759d8a8b2419514638c1aa179`; receipt/index bytes must not be overwritten
- **Release readiness:** not started
- **Base chunk count:** 26 (`C00`–`C25`)
- **Dynamic planning/remediation/revalidation count:** 4 (`F001` resolved; `R001` complete; `F002` recorded; `R002` in progress)

## Atomic claim and attestation protocol

Valid base/remediation statuses are `not-started`, `claimed`, `in-progress`, `blocked`, `verification`, `complete`, and `stale`; planning-correction nodes additionally use those same statuses. Only `not-started`, or `stale` with remediation dependencies complete, is claimable. Every execution has a numbered claim-attempt generation; renewal, detector blocking, and post-remediation resume supersede the old generation and require a fresh integrated base and matching W/I candidate.

The non-self-referential graph in `docs/plan.md` is authoritative. C00 uses the root `bootstrap-v1` receipt at `docs/checkpoints/C00/bootstrap/0.json`; C01 uses the single tool-free claim exception at `docs/claims/C01/1.json` and begins the ordinary candidate graph. Each claim/index/ledger binds only the pre-claim parent. When invoked at candidate or attestation `HEAD`, the live verifier derives the unique K/B1 ancestor from immutable Git claim/index/ledger blobs, proves its sole parent and ancestry, and never assumes current `HEAD` is K/B1. Claim commit integrates as worker base B1; worker candidate W integrates as I; acceptance runs against I; attestation A follows I.

Durable findings use one atomic emergency transaction for `FindingV1`, index append, detector ledger, and blocked summary status. A serialized `PNNN` using `P-acceptance-v1` must attest before any new R/V node becomes eligible. Status/count/dependency changes are atomic with that P receipt. During divergence, this integrated summary is authoritative.

## Base chunk index

| IDs | Purpose | Dependency | Status |
|---|---|---|---|
| C00 | Tool-free contract freeze | — | complete |
| C01 | Bootstrap/CI | C00 | blocked by F002; immutable A01 evidence retained |
| R001 | Correct C01 planning digests and implementation under a distinct remediation claim | F001 + last-good C00 receipt | complete |
| R002 | Correct exact remediation-contract binding and historical A01 resume verification | F002 + immutable C01 receipt | in-progress; active priority node |
| C02 | Domain and transition contracts | C01 | not-started; ineligible until R002 closure |
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

## Planning correction, remediation, and revalidation accounting

Finding `F001` remains resolved and remediation `R001` remains complete. Finding `F002` records that the integrated verifier hard-codes `v4:C01` while the valid immutable receipt and frozen twelve-command manifest use `v4:C01-remediation`. R002 generation 1 owns only `docs/plan.md` and `scripts/progress-cas.mjs`; it must preserve signature, digest, index-chain, ancestry, exact-path, and command-result checks. C02 remains ineligible until focused live receipt and historical A01 resume verification both pass and F002 closes atomically.

## Resume instructions

Integrate the atomic F002/R002 claim transaction with commit message `fix(progress): claim R002 receipt verifier remediation`. From that integrated base, correct only the two R002-owned paths so `verifyFrozenSubject` binds `C01_ACCEPTANCE_VERSION` and resume derives and authenticates the unique historical A01 transaction rather than treating a later verifier-fix HEAD as A01. Seal that candidate with commit message `fix(progress): authenticate remediated C01 receipt`. Run only the exact focused live receipt and resume commands; do not make C02 eligible until both pass.

## Planning review status

The definitive review remains closed except for blocker F002. C01 is blocked, R002 is the active priority node, and C02 is ineligible.
