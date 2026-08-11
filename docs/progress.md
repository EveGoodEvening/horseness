# Horseness Authoritative Progress

This integrated summary is the authoritative scheduler ledger. Detailed execution evidence lives in `docs/progress/<ID>.md`; canonical claims live append-only at `docs/claims/<ID>/<generation>.json` and are authenticated by `docs/claims/index.jsonl`; immutable receipts live under `docs/checkpoints/<ID>/` and are authenticated by `docs/checkpoints/index.jsonl`.

## Global status

- **Planning state:** formal C01 remediation `R001` for finding `F001` is active from pre-claim base `d416ddfeee62c31f09f702b24393a1774ef687e1`; C01 remains in progress and has no valid integrated A01
- **Active claims:** C01 generation 1 (historical K01 source claim) and R001 generation 1 (current remediation claim)
- **Next eligible:** none; R001 is the active priority node and C02 remains ineligible until R001 integrates, corrected C01 evidence succeeds, and A01 integrates
- **Active blockers:** F001 records that the three required planning-correction paths were outside K01 candidate ownership; R001 must correct them without weakening verification or merging K01/A01 write scopes
- **Last integrated receipt:** C00 `docs/checkpoints/C00/bootstrap/0.json`, envelope digest `ef53151d3b520d1175a8ca0a1a3fece3526de18e9c3cd9cf30299bb6b3b28c87`
- **Release readiness:** not started
- **Base chunk count:** 26 (`C00`–`C25`)
- **Dynamic planning/remediation/revalidation count:** 2 (`F001` finding and active `R001` remediation); no remediation or revalidation node completed

## Atomic claim and attestation protocol

Valid base/remediation statuses are `not-started`, `claimed`, `in-progress`, `blocked`, `verification`, `complete`, and `stale`; planning-correction nodes additionally use those same statuses. Only `not-started`, or `stale` with remediation dependencies complete, is claimable. Every execution has a numbered claim-attempt generation; renewal, detector blocking, and post-remediation resume supersede the old generation and require a fresh integrated base and matching W/I candidate.

The non-self-referential graph in `docs/plan.md` is authoritative. C00 uses the root `bootstrap-v1` receipt at `docs/checkpoints/C00/bootstrap/0.json`; C01 uses the single tool-free claim exception at `docs/claims/C01/1.json` and begins the ordinary candidate graph. Each claim/index/ledger binds only the pre-claim parent. When invoked at candidate or attestation `HEAD`, the live verifier derives the unique K/B1 ancestor from immutable Git claim/index/ledger blobs, proves its sole parent and ancestry, and never assumes current `HEAD` is K/B1. Claim commit integrates as worker base B1; worker candidate W integrates as I; acceptance runs against I; attestation A follows I.

Durable findings use one atomic emergency transaction for `FindingV1`, index append, detector ledger, and blocked summary status. A serialized `PNNN` using `P-acceptance-v1` must attest before any new R/V node becomes eligible. Status/count/dependency changes are atomic with that P receipt. During divergence, this integrated summary is authoritative.

## Base chunk index

| IDs | Purpose | Dependency | Status |
|---|---|---|---|
| C00 | Tool-free contract freeze | — | complete |
| C01 | Bootstrap/CI | C00 | in-progress |
| R001 | Correct C01 planning digests and implementation under a distinct remediation claim | F001 + last-good C00 receipt | in-progress; active priority node |
| C02 | Domain and transition contracts | C01 | not-started; ineligible |
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

Finding `F001` records the blocker at `d416ddfeee62c31f09f702b24393a1774ef687e1`: the required corrections to `docs/plan.md`, `docs/validation/c00-contract-gate.node-e.txt`, and `docs/checkpoints/fixtures/digests.json` were not sealed by K01. Remediation claim `R001` generation 1 is the active node. Its candidate owns exactly those three planning paths plus the C01 implementation source/config path set inherited from K01 after excluding all K01 claim-transaction and A01 attestation paths. K01 remains the immutable C01 generation-1 claim transaction; A01 remains a later receipt-only attestation transaction. C01 stays `in-progress`, no receipt is created, and C02 stays ineligible until R001 integrates, the strict `v4:C01` acceptance contract succeeds, and A01 integrates.

## Resume instructions

Read `AGENTS.md`, architecture, plan, compatibility, trust root, this summary, both claim/checkpoint indexes, `docs/findings/F001.json`, `docs/progress/R001.md`, and `docs/progress/C01.md`. Resume only R001 generation 1 from pre-claim base `d416ddfeee62c31f09f702b24393a1774ef687e1`; modify only its sealed candidate paths, preserve immutable K01 and separate A01 ownership, do not weaken any gate, and do not claim or start C02.

## Planning review status

The definitive review is reopened only for formal finding `F001` and active remediation `R001`. C00 remains historically complete under its signed bootstrap receipt. C01 remains `in-progress`; corrected evidence and A01 are pending. C02 remains `not-started` and ineligible.
