# Horseness Authoritative Progress

This integrated summary is the authoritative scheduler ledger. Detailed execution evidence lives in `docs/progress/<ID>.md`; canonical claims live append-only at `docs/claims/<ID>/<generation>.json` and are authenticated by `docs/claims/index.jsonl`; immutable receipts live under `docs/checkpoints/<ID>/` and are authenticated by `docs/checkpoints/index.jsonl`.

## Global status

- **Planning state:** C01 and formal remediation `R001` are complete; finding `F001` is resolved by the signed A01 receipt transaction
- **Active claims:** none
- **Next eligible:** C02
- **Active blockers:** none
- **Last integrated receipt:** C01 `docs/checkpoints/C01/final/1.json`, envelope digest `17ddd75b49e35d3bf6f432c8c6acca30b4a66512229453aca4fc63e7f427ea7d`, pending integration as direct child of candidate `7e9d9b3ccfb90ecd908e6913acc9fe632fd12abc`
- **Release readiness:** not started
- **Base chunk count:** 26 (`C00`–`C25`)
- **Dynamic planning/remediation/revalidation count:** 2 (`F001` resolved; `R001` complete)

## Atomic claim and attestation protocol

Valid base/remediation statuses are `not-started`, `claimed`, `in-progress`, `blocked`, `verification`, `complete`, and `stale`; planning-correction nodes additionally use those same statuses. Only `not-started`, or `stale` with remediation dependencies complete, is claimable. Every execution has a numbered claim-attempt generation; renewal, detector blocking, and post-remediation resume supersede the old generation and require a fresh integrated base and matching W/I candidate.

The non-self-referential graph in `docs/plan.md` is authoritative. C00 uses the root `bootstrap-v1` receipt at `docs/checkpoints/C00/bootstrap/0.json`; C01 uses the single tool-free claim exception at `docs/claims/C01/1.json` and begins the ordinary candidate graph. Each claim/index/ledger binds only the pre-claim parent. When invoked at candidate or attestation `HEAD`, the live verifier derives the unique K/B1 ancestor from immutable Git claim/index/ledger blobs, proves its sole parent and ancestry, and never assumes current `HEAD` is K/B1. Claim commit integrates as worker base B1; worker candidate W integrates as I; acceptance runs against I; attestation A follows I.

Durable findings use one atomic emergency transaction for `FindingV1`, index append, detector ledger, and blocked summary status. A serialized `PNNN` using `P-acceptance-v1` must attest before any new R/V node becomes eligible. Status/count/dependency changes are atomic with that P receipt. During divergence, this integrated summary is authoritative.

## Base chunk index

| IDs | Purpose | Dependency | Status |
|---|---|---|---|
| C00 | Tool-free contract freeze | — | complete |
| C01 | Bootstrap/CI | C00 | complete |
| R001 | Correct C01 planning digests and implementation under a distinct remediation claim | F001 + last-good C00 receipt | complete |
| C02 | Domain and transition contracts | C01 | not-started; next eligible |
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

Finding `F001` is resolved. Remediation `R001` generation 1 produced candidate integration `7e9d9b3ccfb90ecd908e6913acc9fe632fd12abc`, all twelve ordered `v4:C01-remediation` commands succeeded under Node 22, and signed C01 receipt `docs/checkpoints/C01/final/1.json` has envelope digest `17ddd75b49e35d3bf6f432c8c6acca30b4a66512229453aca4fc63e7f427ea7d`. C01 and R001 are complete once this A01 transaction integrates; C02 is the next eligible node and remains unclaimed.

## Resume instructions

After integrating A01 as the direct child of `7e9d9b3ccfb90ecd908e6913acc9fe632fd12abc`, run the exact live receipt and resume commands recorded in the C01 handoff. Then claim C02 through the normal atomic claim CAS; do not begin C02 source work before that claim integrates.

## Planning review status

The definitive review is closed for C01. C00 and C01 are complete under signed receipts, R001 is complete, F001 is resolved, and C02 is the next eligible unclaimed chunk.
