# Horseness Authoritative Progress

This integrated summary is the authoritative scheduler ledger. Detailed execution evidence lives in `docs/progress/<ID>.md`; canonical claims live append-only at `docs/claims/<ID>/<generation>.json` and are authenticated by `docs/claims/index.jsonl`; immutable receipts live under `docs/checkpoints/<ID>/` and are authenticated by `docs/checkpoints/index.jsonl`.

## Global status

- **Planning state:** claim self-SHA blocker corrected; definitive blocker/high closure corrected; C00 contract frozen and eligible for W00/A00 on integration branch `main`
- **Active claims:** none
- **Next eligible:** C00 (`bootstrap-v1`); before W00 seal normalize/verify `main`; after signed indexed A00, K01 is exactly `docs/claims/C01/1.json`
- **Active blockers:** none
- **Last integrated receipt:** none
- **Release readiness:** not started
- **Base chunk count:** 26 (`C00`–`C25`)
- **Dynamic planning/remediation/revalidation count:** 0

## Atomic claim and attestation protocol

Valid base/remediation statuses are `not-started`, `claimed`, `in-progress`, `blocked`, `verification`, `complete`, and `stale`; planning-correction nodes additionally use those same statuses. Only `not-started`, or `stale` with remediation dependencies complete, is claimable. Every execution has a numbered claim-attempt generation; renewal, detector blocking, and post-remediation resume supersede the old generation and require a fresh integrated base and matching W/I candidate.

The non-self-referential graph in `docs/plan.md` is authoritative. C00 uses the root `bootstrap-v1` receipt at `docs/checkpoints/C00/bootstrap/0.json`; C01 uses the single tool-free claim exception at `docs/claims/C01/1.json` and begins the ordinary candidate graph. Thereafter every claim generation is an immutable JSON record under `docs/claims/<ID>/<generation>.json`, authenticated by the append-only claim index and referenced—not embedded—by its Markdown ledger. Each claim/index/ledger binds only the pre-claim parent; the verifier obtains the claim commit K/B1 from integrated HEAD and proves its tree, paths, parent, and ancestry. Claim commit integrates as worker base `B1`; worker candidate `W` integrates as `I`; acceptance runs against `I`; attestation `A` contains a receipt naming the attempt/base/W/I but never A.

Durable findings use one atomic emergency transaction for `FindingV1`, index append, detector ledger, and blocked summary status. A serialized `PNNN` using `P-acceptance-v1` must attest before any new R/V node becomes eligible. Status/count/dependency changes are atomic with that P receipt. During divergence, this integrated summary is authoritative.

## Base chunk index

| IDs | Purpose | Dependency | Status |
|---|---|---|---|
| C00 | Tool-free contract freeze | — | not-started |
| C01 | Bootstrap/CI | C00 | not-started |
| C02 | Domain and transition contracts | C01 | not-started |
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

Findings use immutable `FNNN` receipts in `docs/findings/`. A `PNNN` correction owns all five planning artifacts plus the exact finding-bound normative-document list defined in `docs/plan.md`, validates finding/index digests, freezes R commands/ownership, appends R/V nodes without renumbering history, increments counts, and marks affected evidence stale. R depends on the finding plus last-good source receipts, never the blocked detector. V depends on R and reruns the stale chunk's frozen acceptance contract version. Blocked and unremediated stale nodes are ineligible. Resume priority is exactly `P -> R -> V -> C`; a ready P preempts new lower-class claims and selection of a lower class is invalid.

Worked recovery: C21 detects a C07 defect and atomically emits F001 plus blocked status. P001 attests the correction, adds R001 depending on F001+C06, marks C07–C20 stale, and adds chained V001–V014. R001 becomes eligible only after P001. Final V closes the finding and changes C21 to `not-started`; C21 then claims a new attempt from the remediated head and reruns its complete acceptance. Publication findings also bind the release version to `partial`, `abandoned`, or `revoked`; promotion cannot proceed until exact reconciliation or a planned version rollover completes.

## Resume instructions

Read `AGENTS.md`, architecture, plan, compatibility, trust root, this summary, `docs/claims/index.jsonl`, checkpoint/finding/publication indexes, and active P/R/V/C ledgers. Verify canonical claim files, both claim/checkpoint index chains, signed receipt core/envelope digests, Ed25519 trust lookup/revocation/scope, dependency digests, expiry at candidate sealing and attestation, supersession chain, exact allowed/ADR/acceptance paths, candidate tree, and the complete side-effect head; never infer status from a worktree. Integration is exactly `main`. Before C01 edits, consume only `docs/claims/C01/1.json` with the frozen live checker and an explicit trusted `--now`; it obtains K01 from integrated `HEAD`, derives A00 as its sole parent, matches the claim/index/ledger pre-claim base to A00, and proves tree paths, dependency digest, and integrated ancestry. Fixture algorithms run only through the isolated bundle command. Select only the eligible unowned node under `P -> R -> V -> C` priority. Dependency completion means a valid indexed signed checkpoint receipt and, for acceptance-dependent task edges, the exact durable `DeltaAcceptedV1` completion predicate. C22–C25 resume lookup-first from integrated intents/results.

## Planning review status

The definitive correction resolves every blocker/high in `local://plan-definitive-findings.json`: authenticated live A00/K01 and index/Git ancestry, canonical trusted time and symlink rejection, production/fixture separation, corrected C01 provenance/chronology, non-cyclic signed receipt envelopes and vectors, acceptance-gated task completion across races/restarts/four hosts, native worker-return paths, exhaustive coordinator APIs/CLI, `main` branch normalization, and remaining adapter/security controls. C00 remains contract-frozen, unblocked, and eligible for its W00/A00 bootstrap transaction.
