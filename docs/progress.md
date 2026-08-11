# Horseness Authoritative Progress

This integrated summary is the authoritative scheduler ledger. Detailed execution evidence lives in `docs/progress/<ID>.md`; canonical claims live append-only at `docs/claims/<ID>/<generation>.json` and are authenticated by `docs/claims/index.jsonl`; immutable receipts live under `docs/checkpoints/<ID>/` and are authenticated by `docs/checkpoints/index.jsonl`.

## Global status

- **Planning state:** C01 live-graph correction v4 is active; candidate `2d4e4f62fb779c988bc7a774cd402ae47736b105` has no valid integrated A01
- **Active claims:** C01 generation 1 only
- **Next eligible:** none; C02 remains ineligible until corrected C01 evidence and A01 integrate
- **Active blockers:** candidate path cleanup, K01-from-graph verifier correction, universal gate evidence, and integrated re-attestation
- **Last integrated receipt:** C00 `docs/checkpoints/C00/bootstrap/0.json`, envelope digest `ef53151d3b520d1175a8ca0a1a3fece3526de18e9c3cd9cf30299bb6b3b28c87`
- **Release readiness:** not started
- **Base chunk count:** 26 (`C00`–`C25`)
- **Dynamic planning/remediation/revalidation count:** 1 versioned C01 contract correction; no P/R/V node completed

## Atomic claim and attestation protocol

Valid base/remediation statuses are `not-started`, `claimed`, `in-progress`, `blocked`, `verification`, `complete`, and `stale`; planning-correction nodes additionally use those same statuses. Only `not-started`, or `stale` with remediation dependencies complete, is claimable. Every execution has a numbered claim-attempt generation; renewal, detector blocking, and post-remediation resume supersede the old generation and require a fresh integrated base and matching W/I candidate.

The non-self-referential graph in `docs/plan.md` is authoritative. C00 uses the root `bootstrap-v1` receipt at `docs/checkpoints/C00/bootstrap/0.json`; C01 uses the single tool-free claim exception at `docs/claims/C01/1.json` and begins the ordinary candidate graph. Each claim/index/ledger binds only the pre-claim parent. When invoked at candidate or attestation `HEAD`, the live verifier derives the unique K/B1 ancestor from immutable Git claim/index/ledger blobs, proves its sole parent and ancestry, and never assumes current `HEAD` is K/B1. Claim commit integrates as worker base B1; worker candidate W integrates as I; acceptance runs against I; attestation A follows I.

Durable findings use one atomic emergency transaction for `FindingV1`, index append, detector ledger, and blocked summary status. A serialized `PNNN` using `P-acceptance-v1` must attest before any new R/V node becomes eligible. Status/count/dependency changes are atomic with that P receipt. During divergence, this integrated summary is authoritative.

## Base chunk index

| IDs | Purpose | Dependency | Status |
|---|---|---|---|
| C00 | Tool-free contract freeze | — | complete |
| C01 | Bootstrap/CI | C00 | in-progress |
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

The C01 v4 correction is a narrowly authorized bootstrap-contract remediation, not a retroactive expansion of candidate ownership and not a completed P/R/V checkpoint. It changes only the impossible live K01 selection rule, permits the named `.mjs` gate to be a versioned universal executable rather than a byte-identical copy, and makes prior C01 acceptance/receipt evidence stale. K01 claim writes, W01/I01 source writes, and A01 attestation writes are accounted separately. Install outputs such as `node_modules/**` remain unauthorized and must be removed rather than added to the claim. C02 remains ineligible until corrected evidence and a new signed A01 integrate.

## Resume instructions

Read `AGENTS.md`, architecture, plan, compatibility, trust root, this summary, the claim/checkpoint indexes, and `docs/progress/C01.md`. Resume C01 generation 1 from candidate `2d4e4f62fb779c988bc7a774cd402ae47736b105`: remove paths outside the sealed C01 source/config set, make live verification derive K01 `2e6b9e40a2cdacf4ebff154cbd2a6edc163fe1f1` from immutable Git blobs while invoked at candidate/attestation HEAD, regenerate corrected gate/acceptance evidence, and integrate a new signed A01. Do not claim or start C02.

## Planning review status

The definitive review is reopened only for C01 live-graph correction v4. C00 remains historically complete under its signed bootstrap receipt. C01 is `in-progress`; its prior receipt/evidence is stale because live verification equated current HEAD with K01 and the byte-equality gate is superseded. C02 remains `not-started` and ineligible.
