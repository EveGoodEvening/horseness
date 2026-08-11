# Horseness Delivery Plan

This plan is serial and dependency-ordered. Base chunks are immutable IDs `C00`–`C25`; no implementation chunks overlap. Contracts are frozen before consumers, and every chunk is independently reviewable and committable.

## Execution, ownership, and evidence protocol

1. Only the named fully qualified paths are owned. `/**` includes source, tests, fixtures, barrels, and generated files. Package-changing chunks own the affected manifest and `pnpm-lock.yaml`; canonicalize manifest JSON, run one `corepack pnpm install --lockfile-only`, and never hand-edit the lockfile.
2. Public/persisted/capability/install-format changes also own their fixtures, `docs/compatibility.md`, `docs/migrations.md` where applicable, and one new `.changeset/*.md`. Architectural changes require a reviewed planning correction before implementation resumes.
3. C00/C01 claims, signed receipts, indexes, and remediation records are immutable historical bootstrap evidence. They remain authenticated by the focused C01 verification commands and MUST NOT be rewritten.
4. From C02 onward, development uses a conventional four-stage workflow: (a) a serialized `chore(progress): claim <ID>` commit changes only `docs/progress.md` and `docs/progress/<ID>.md`, records the dependency-ready base commit, exact owned paths, and exact ordered gates; (b) one or more implementation commits change only those owned paths; (c) the exact gates run at the candidate commit and review fixes are committed and rerun until green; (d) a serialized `chore(progress): complete <ID>` commit records the candidate commit, review disposition, and observed gate evidence and makes the next dependency-ready chunk eligible.
5. Post-C01 claim and completion commits are ordinary Git/tracker records. They MUST NOT create per-chunk claim JSON, signed checkpoint envelopes, checkpoint-index rows, self-hashes, candidate/integration SHA cycles, or P/R/V receipt graphs. Git history, exact gate output, CI, review findings, and the final tracker commit are the repository-development evidence. This simplification does not change product runtime evidence-gated admission, canonical event/delta authority, authenticated worker receipts, immutable fork/context bindings, installer trust, or signed release/external-effect requirements delivered by later chunks.
6. Commands introduced by a chunk run only after it creates them. Every changed TypeScript package is explicitly typechecked. Adapter/executable-edge chunks run `boundaries:check`. A failed gate or review keeps the chunk `in-progress`; fixes stay within owned paths, are committed, and rerun before completion.

In every chunk entry, “manifest/lock/changeset/ledger/integration” expands exactly to the affected package's listed `package.json`, repository `pnpm-lock.yaml`, the named `.changeset/<ID>-*.md`, `docs/progress/<ID>.md`, and `docs/progress.md`. “Ledger/integration artifacts” expands to the last two paths only. “Compatibility/feasibility docs” means `docs/compatibility.md` and `docs/integrations/feasibility.md`. No shorthand grants ownership outside these expansions.

## Review-fix protocol

Durable product defects found during a chunk are recorded in that chunk ledger with reproduction, affected paths, reviewer disposition, and fix commit. The active chunk remains `in-progress`; no recursive P/R/V node or cryptographic remediation graph is created. If the fix is outside the active chunk's ownership or changes architecture, first land a conventional planning-correction commit that updates the plan and tracker, then resume the same chunk. Earlier completed chunks are marked stale only when their observable contract is invalidated, and are revalidated with their original exact gates before the detecting chunk completes.

## Base chunks

### C00 — Tool-free architecture freeze
**Depends:** none. **Owns:** `AGENTS.md`, `README.md`, `docs/architecture.md`, `docs/plan.md`, `docs/security/threat-model.md`, `docs/compatibility.md`, `docs/trust-root.md`, `docs/adr/0001-provider-neutral-core.md`, `docs/adr/0002-append-only-sqlite.md`, `docs/adr/0003-evidence-gated-admission.md`, `docs/adr/0004-local-daemon-authorization.md`, `docs/adr/0005-install-ownership.md`, `docs/progress/template.md`, `docs/progress/C00.md`, `docs/checkpoints/schema.json`, `docs/checkpoints/index.jsonl`, `docs/claims/index.jsonl`, `docs/checkpoints/fixtures/{bootstrap-v1,c01-claim-v1,c01-claim-underscoped-negative-v1,c01-claim-expired-negative-v1,c01-ordinary-v1,digests}.json`, `docs/validation/{c00-contract-gate,c01-claim-check}.node-e.txt`, `docs/findings/schema.json`, `docs/findings/index.jsonl`, `docs/progress.md`.
**Deliver:** freeze glossary, streams/cursors, genesis, proposal/delta/digest semantics, task/join, ForkPin/binding, policy/admission/dispatch transitions, artifact publication, credentials, bootstrap/install/release trust, compatibility and non-goals.
**Accept:** Node-only script enumerates every owned path as nonempty, validates internal links and required headings/identifiers; C00 ledger checklist explicitly records glossary, all transition tables, digest preimage/vectors, trust boundaries, ownership, compatibility, ADR decisions, and review.
**Checkpoint:** `docs(architecture): freeze product and trust contracts`.

### C01 — Reproducible bootstrap and CI skeleton
**Depends:** C00. **Owns:** root manifests/configs, `.github/workflows/ci.yml`, `.changeset/config.json`, `packages/*/package.json`, `apps/*/package.json`, `adapters/*/package.json`, their `src/index.ts`, `scripts/{c00-contract-gate,progress-cas}.mjs`, `README.md`, `pnpm-lock.yaml`, `docs/progress/C01.md`, progress/checkpoint integration artifacts.
**Accept:** frozen install; docs lint; typecheck; lint; test; boundary check. **Checkpoint:** `chore(repo): bootstrap reproducible workspace`.

### C02 — Canonical domain and transition contracts
**Depends:** C01. **Owns:** `packages/domain/**`, root `package.json` `vectors:verify` forwarding integration, manifest/lock, `.changeset/C02-domain.md`, `docs/compatibility.md`, ledger/integration artifacts.
**Deliver:** workspace/run streams, composite cursor and atomic command types; RunCreated genesis; sealed ProposalEnvelopeV1, digest vectors and delta operations; all reducers/state machines; immutable ForkPin/AttemptContextBinding; evaluation clock boundaries.
**Accept:** domain typecheck/tests plus golden vectors for digest/canonical operations, genesis, stream atomicity, cycles/joins/readiness, policy precedence, approval expiry/replacement, dispatch transitions, retry/refresh/adoption, and replay. **Checkpoint:** `feat(domain): freeze canonical orchestration contracts`.

### C03 — Protocol mappings and conformance
**Depends:** C02. **Owns:** `packages/protocol/**`, `docs/protocol.md`, compatibility, manifest/lock/changeset/ledger/integration.
**Accept:** protocol typecheck/tests/conformance/generated check; vectors prove sealed envelopes, composite pagination/subscriptions, stable auth/errors. **Checkpoint:** `feat(protocol): map versioned authorized RPC contracts`.

### C04 — Policy lifecycle and pure admission evaluator
**Depends:** C03. **Owns:** `packages/policy/**`, `docs/policy.md`, compatibility, manifest/lock/changeset/ledger/integration.
**Accept:** typecheck/tests including full pinned×current cross-product, incomparable rules, loosening/tightening, stable explanation order, time boundaries, evidence/path/version substitution, stale cursor and quota/grant snapshots. **Checkpoint:** `feat(policy): implement conjunctive evidence admission`.

### C05 — SQLite authority, migration 0001, and artifact publication
**Depends:** C04. **Owns:** `packages/store-sqlite/**`, `docs/migrations.md`, manifest/lock/changeset/ledger/integration.
**Accept:** typecheck/tests, migration-0001, multi-stream atomicity/dedup, raw-chain replay/genesis, artifact publish crash injection at every file/fsync/rename/transaction boundary, missing/corrupt reference fail-closed. **Checkpoint:** `feat(store): add atomic SQLite and artifact authority`.

### C06 — Upgrade, backup, restore, import, recovery, retention
**Depends:** C05. **Owns:** store package, `tests/fixtures/databases/**`, `tests/fixtures/imports/**`, `docs/migrations.md`, `docs/operations/storage.md`, manifest/lock/changeset/ledger/integration.
**Accept:** store typecheck/full tests plus migrations/recovery/import/retention; raw-before-upcast, dangling-reference rejection, isolated import, reversible/major-gated downgrade. **Checkpoint:** `feat(store): add verified recovery import and retention`.

### C07 — Canonical admission application service
**Depends:** C06. **Owns:** orchestrator admission/policy/authorization/revisions source and tests, manifest/lock/changeset/ledger/integration.
**Accept:** orchestrator typecheck/full tests; atomic workspace+run evaluation/accept; concurrent CAS; evidence substitution/path escape/stale base/version mismatch; approval clock/revocation; genesis-before-first-accept; artifact reference crash windows. **Checkpoint:** `feat(orchestrator): apply sealed evidence admission`.

### C08 — Task, dependency, fork, receipt projections
**Depends:** C07. **Owns:** orchestrator tasks/forks/receipts/projections source/tests, manifest/lock/changeset/ledger/integration.
**Accept:** typecheck/full/model tests for cycles, late edge mutation, mixed outcomes, joins, retries, deterministic ready replay, immutable pins, refresh lineage, retry-after-receipt, composite-cursor multi-run revocation/policy/quota. **Checkpoint:** `feat(orchestrator): project authoritative task and fork state`.

### C09 — Deterministic context reconstruction
**Depends:** C08. **Owns:** orchestrator context source/tests, `docs/context.md`, manifest/lock/changeset/ledger/integration.
**Accept:** typecheck/full/context-golden; activation/replacement/deactivation epoch invalidation; artifact crash boundaries; byte determinism; ForkPin visibility and manifest/binding digest equivalence. **Checkpoint:** `feat(orchestrator): reconstruct pinned context manifests`.

### C10 — Scheduler, attempts, leases, dispatch and recovery
**Depends:** C09. **Owns:** orchestrator scheduler/attempts/leases/dispatch and tests, manifest/lock/changeset/ledger/integration.
**Accept:** typecheck/full/property/restart tests covering every transition/crash window, lookup found/not-found/unsupported, late handle, cancel races, duplicate authorization, receipt mismatch, retry refresh, adoption/reattach retaining binding, deterministic ready set. **Checkpoint:** `feat(orchestrator): schedule replay-safe bound attempts`.

### C11 — Four-host feasibility and hermetic harness
**Depends:** C10. **Owns:** `tests/fixtures/hosts/**`, `tests/host-feasibility/**`, `scripts/host-feasibility/**`, root manifest/lock, compatibility/feasibility docs, changeset/ledger/integration.
**Deliver:** pin real binaries/official validators; create stable `host:validate:*` and `host:smoke:*` commands; freeze required native artifact/capabilities, resume matrix, local deterministic provider, credentialed-live policy, skip/fail rules. Missing native minimum blocks for scope decision; CLI fallback cannot pass.
**Accept:** root typecheck/boundaries and four validate commands plus harness self-tests. **Checkpoint:** `test(hosts): prove required native feasibility`.

### C12 — SDK and secure adapter/install SPI
**Depends:** C11. **Owns:** `packages/sdk/**`, `packages/adapter-kit/**`, manifests/lock, compatibility, changeset/ledger/integration.
**Accept:** both package typechecks/tests; security tests; boundary check; launch/cancel/reconcile/reattach/resume, immutable binding, credential-reference, doctor schema, and declarative install conformance. **Checkpoint:** `feat(sdk): add secure host integration contracts`.

### C13 — Daemon, transports, and first-authority ceremony
**Depends:** C12. **Owns:** `apps/daemon/**`, protocol transports/tests, affected manifests/lock, CI, changeset/ledger/integration.
**Accept:** daemon and protocol typecheck/full tests, smoke/multiprocess; concurrent/unauthorized bootstrap, OS permission/DACL, revoked/stale tokens, restored workspace rebinding, multi-user isolation, endpoint discovery; candidate-SHA Linux/macOS/Windows CI receipt. **Checkpoint:** `feat(daemon): serve bootstrapped local authority`.

### C14 — Core CLI and credential lifecycle
**Depends:** C13. **Owns:** `apps/cli/**`, `docs/cli.md`, manifest/lock/changeset/ledger/integration.
**Accept:** CLI typecheck/tests/smoke/JSON contract/boundaries; start/stop, bootstrap, rotate/revoke/recover, restore rebind, secret-redaction workflows. **Checkpoint:** `feat(cli): add authorized orchestration workflows`.

### C15 — Pi native bundle
**Depends:** C14. **Owns:** `adapters/pi/**`, `adapters/pi/package.json`, `tests/fixtures/hosts/pi/**`, `pnpm-lock.yaml`, `docs/integrations/pi.md`, `docs/compatibility.md`, `.changeset/C15-pi.md`, ledger/integration artifacts. **Accept:** adapter typecheck/test/conformance/pack; root boundary check; `host:smoke:pi` covering native load, deterministic-provider attempt, bound receipt, restart/reconcile/resume matrix, fork switch, and uninstall contribution. **Checkpoint:** `feat(pi): ship validated native Horseness bundle`.

### C16 — OMP native bundle
**Depends:** C15. **Owns:** `adapters/omp/**`, `adapters/omp/package.json`, `tests/fixtures/hosts/omp/**`, `pnpm-lock.yaml`, `docs/integrations/omp.md`, `docs/compatibility.md`, `.changeset/C16-omp.md`, ledger/integration artifacts. **Accept:** the equivalent adapter typecheck/test/conformance/pack/boundary and `host:smoke:omp` matrix. **Checkpoint:** `feat(omp): ship validated native Horseness bundle`.

### C17 — Claude Code native bundle
**Depends:** C16. **Owns:** `adapters/claude/**`, `adapters/claude/package.json`, `tests/fixtures/hosts/claude/**`, `pnpm-lock.yaml`, `docs/integrations/claude.md`, `docs/compatibility.md`, `.changeset/C17-claude.md`, ledger/integration artifacts. **Accept:** the equivalent adapter typecheck/test/conformance/pack/boundary and `host:smoke:claude` matrix. **Checkpoint:** `feat(claude): ship validated native Horseness bundle`.

### C18 — Codex native bundle
**Depends:** C17. **Owns:** `adapters/codex/**`, `adapters/codex/package.json`, `tests/fixtures/hosts/codex/**`, `pnpm-lock.yaml`, `docs/integrations/codex.md`, `docs/compatibility.md`, `.changeset/C18-codex.md`, ledger/integration artifacts. **Accept:** the equivalent adapter typecheck/test/conformance/pack/boundary and `host:smoke:codex` matrix; plugin/skill/MCP contribution is mandatory and CLI-only is additional. **Checkpoint:** `feat(codex): ship validated native Horseness bundle`.

### C19 — Installer journal, trust, and migration engine
**Depends:** C18. **Owns:** `packages/installer/**`, prior-journal/install-home fixtures, `docs/install.md`, `docs/migrations.md`, compatibility, manifest/lock/changeset/ledger/integration.
**Accept:** installer typecheck/full/journal/crash/trust tests; N-1/N readers, unknown-newer refusal, atomic migration crash points, failed upgrade rollback, N downgrade/gate, repair/uninstall after upgrade; tampered tarball/dependency, wrong issuer/repository, revoked key, replayed release. **Checkpoint:** `feat(installer): add migrated trusted journal engine`.

### C20 — Installer operations, bootstrap, all-host semantics, doctor
**Depends:** C19. **Owns:** installer operations, CLI install commands/tests, self-contained bootstrap source/build scripts, root/affected manifests/lock/CI, README/install/migrations docs, changeset/ledger/integration.
**Accept:** affected typechecks/full tests/boundaries; install matrix and crash smoke; four-host mixed presence/unsupported/managed/partial/atomic modes with exact contributions and exits; tampered uninstall quarantine; read-only doctor clean/drift/corrupt/revoked/partial; bootstrap tamper/provenance/lifecycle-script negatives; candidate-SHA OS CI receipt. **Checkpoint:** `feat(installer): integrate verified lifecycle`.

### C21 — Security, resilience, and closed-loop validation
**Depends:** C20. **Owns:** `tests/security/**`, `tests/system/**`, `SECURITY.md`, root manifest/lock, ledger/integration.
**Accept:** security/system/recovery/hosts suites covering hostile inputs, multi-run revocation/policy/quota, all artifact crash windows, credential exclusion, install recovery, all four complete loops. Defects use R/V protocol. **Checkpoint:** `test(system): verify security recovery and closed loops`.

### C22 — Release versioning, offline trust ceremony, and reproducible candidate
**Depends:** C21. **Owns:** all publishable `packages/*/package.json`, `apps/*/package.json`, `adapters/*/package.json`, native version manifests, package changelogs, `.changeset/**`, `CHANGELOG.md`, `LICENSE`, root manifest/lock, `scripts/release/**`, workflows, docs, `docs/trust/root-ceremony-v1.json`, `docs/trust/root-ceremony-v1.schema.json`, `docs/trust/evidence/**`, ledger/integration.
**Accept:** first complete the pre-signing offline root ceremony and integrate its reviewed record/evidence; validate threshold, distinct root/recovery keys, fingerprints, witnesses, custody and destruction evidence, then publish and validate the version/range-bounded release-key delegation. Only afterward may frozen install/verify, version-coherence, exact internal pins/bundling, packed dependency graph, two-build reproducibility, SBOM/provenance, KMS signature, offline archive, dry-run, or immutable upload run. **Checkpoint:** `chore(release): establish trust and version reproducible candidate`.

### C23 — Authorized publication and receipts
**Depends:** C22. **Owns:** `.github/workflows/release.yml`, `docs/releases/**`, `docs/progress/C23.md`, checkpoint integration artifacts only; published registry/tag/offline-release state is recorded by signed external receipt.
**Accept:** stage complete immutable package set; verify before moving tags; publish npm/native/offline artifacts; record signed tag, registry integrity/provenance, release-key/revocation and artifact digest receipts. **Checkpoint:** `chore(release): publish signed Horseness train`.

### C24 — Post-publication exact-artifact verification
**Depends:** C23. **Owns:** `tests/release/**`, release verification scripts/workflows, release docs, root manifest/lock if scripts change, ledger/integration.
**Accept:** exact public version/bootstrap online and signed offline install; doctor; all native bundles load and attempt; mixed-host behavior; safe/tampered uninstall; N-1→N database+journal upgrade from packed artifacts; injected rollback/backup restore before/after migration/config boundaries; post-rollback replay/doctor/load/uninstall on Linux/macOS/Windows; provenance/checksum/revocation negatives. **Checkpoint:** `test(release): verify published lifecycle`.

## Dependency summary and planning review log

Base delivery is `C00 -> ... -> C25`; P/R/V nodes are explicit scheduling exceptions with dependency ordering, never parallel overlap. Chunk count is 26.

Round-one findings remain resolved. Every blocker/high/medium item in `local://plan-review-findings-round2.json` is resolved by the contracts and ownership above: sealed proposal/delta digest semantics; workspace/run streams and atomic composite cursors; logged genesis; task/join state machine; immutable pins/bindings; crash-safe artifacts; conjunctive policy precedence and deterministic time; complete dispatch/recovery; claim/evidence/remediation accounting; journal migration; pre-execution bootstrap trust; first authority/credential lifecycle; required four-host bundles and controlled live evidence; all-host/uninstall/doctor semantics; explicit typechecks/harness ownership; versioning, authorized publication, and post-publication black-box rollback. Duplicate findings were merged; none at blocker/high/medium severity was discarded.


## Round-three normative execution addendum

This addendum supersedes every earlier semantic ownership shorthand, prose-only acceptance clause, claim/attestation ambiguity, and C23/C24 promotion implication.

### Non-self-referential commit graph

All CAS operations use `node scripts/progress-cas.mjs ...`; the script exits `0` only when expected integrated parent, statuses, receipt digests, and tree match, otherwise `3` without mutation.

1. **Claim:** integrator starts at `B0`, writes the ledger/status, and commits `K = chore(progress): claim <ID>`. `K` contains `claimId = sha256("horseness.claim.v1\0" || ID || B0 || dependencyReceiptDigests || expiry)` but never its own SHA. Integrate `K` as commit `B1`; its integrated tree is the only worker base. No separate claim index record exists. Work may begin only after `node scripts/progress-cas.mjs verify-claim --id <ID> --base <B1>` succeeds.
2. **Candidate:** worker branches exactly from `B1`, commits candidate `W`, and supplies `W` and its tree. Integrator verifies ancestry/tree and integrates it as `I` (fast-forward or deterministic cherry-pick). `I` is `candidateIntegrationSha`; `W` is `workerCandidateSha`; their trees must match.
3. **Attestation:** after all frozen commands run against `I`, integrator writes checkpoint receipt fields `{claimId, claimIntegrationSha:B1, workerBaseSha:B1, workerCandidateSha:W, candidateIntegrationSha:I, candidateTree, acceptanceContractVersion, commandResults}` and appends its digest to the index, then commits `A = chore(progress): attest <ID>`. The receipt never contains `A`; the index line names the receipt digest and `candidateIntegrationSha`. Integration of `A` atomically changes status to `complete`.
4. **Resume validation:** `node scripts/progress-cas.mjs verify-resume --id <ID> --integrated-head <HEAD>` verifies `K/B1/W/I/A` ancestry, receipt/index digest, candidate tree, dependency receipts, and claim expiry.

C00 bootstrap exception is concrete: from the initial planning tree `B0`, the authorized integrator creates all C00-owned files, including the initial ledger/schema/index, in one candidate `W`; no pre-existing claim file is required. It runs the C00 command below, integrates as `I`, then creates the ordinary attestation `A`. C01 creates `scripts/progress-cas.mjs`; later claims use the normal sequence.

### Finding and planning-correction transaction

Any detecting chunk may create exactly `docs/findings/FNNN.json` and append `docs/findings/index.jsonl` under an emergency detector write grant. `FindingV1` contains ID, detector chunk/candidate SHA, affected paths/contracts, severity, reproduction command/result digest, expected/observed, discoveredAt, and `findingDigest = sha256("horseness.finding.v1\0" || canonicalJson(fieldsExceptDigest))`. It commits `fix(progress): record FNNN`, leaves the detector `blocked`, and stops source edits.

The serialized integrator then creates `PNNN`, whose exact ownership is `docs/architecture.md`, `docs/plan.md`, `docs/progress.md`, `AGENTS.md`, affected `docs/adr/*.md`, `docs/findings/schema.json`, `docs/findings/index.jsonl`, `docs/progress/PNNN.md`, new `docs/progress/RNNN.md`, new `docs/progress/VNNN.md`, and their checkpoint/index records. PNNN follows the normal claim/candidate/integration/attestation graph, validates finding/schema/index digests, sets finding `planned`, appends R/V nodes and dependencies, increments counts, and marks affected completed descendants `stale`; only after PNNN attests may the first R become `not-started` and eligible. R attestation sets finding `remediated`; final V attestation sets it `closed` and unblocks the detector.

### Exact ownership map

Only these bounded path sets replace all earlier shorthand:

| Chunk | Exact additional owned paths (plus its explicitly named ledger/checkpoint/changeset files) |
|---|---|
| C01 | `package.json`, `pnpm-workspace.yaml`, `pnpm-lock.yaml`, `tsconfig.base.json`, `eslint.config.js`, `.npmrc`, `.node-version`, `.github/workflows/ci.yml`, `.changeset/config.json`, `scripts/{acceptance,c00-contract-gate,progress-cas,boundaries-check}.mjs`, `config/acceptance/*.json`, `packages/{domain,protocol,policy,store-sqlite,orchestrator,sdk,adapter-kit,installer}/package.json`, `apps/{daemon,cli}/package.json`, `adapters/{pi,omp,claude,codex}/package.json`, and each corresponding `src/index.ts` |
| C02 | `packages/domain/**`, root `package.json` (only the `vectors:verify` forwarding script), `pnpm-lock.yaml` only if manifest serialization requires it, `docs/vectors/{events,proposal,delta,context-binding,receipt,task-dispatch}/**`, `docs/compatibility.md` |
| C03 | `packages/protocol/**`, root `package.json` (only the `protocol:conformance` and `generated:check` forwarding scripts), `pnpm-lock.yaml` only if manifest serialization requires it, `docs/protocol.md`, `docs/vectors/protocol/**`, `docs/compatibility.md`, `docs/plan.md` (only this serialized C03 forwarding-script ownership correction) |
| C04 | `packages/policy/**`, `docs/policy.md`, `docs/compatibility.md` |
| C05 | `packages/store-sqlite/**`, `docs/migrations.md` |
| C06 | `packages/store-sqlite/src/{migrations,recovery,backup,restore,import,retention}/**`, `packages/store-sqlite/test/{migrations,recovery,backup,restore,import,retention}/**`, `tests/fixtures/{databases,imports}/**`, `docs/{migrations.md,operations/storage.md}` |
| C07 | `packages/orchestrator/src/{admission,authorization,revisions}/**`, `packages/orchestrator/test/{admission,authorization,revisions}/**` |
| C08 | `packages/orchestrator/src/{tasks,forks,receipts,projections}/**`, `packages/orchestrator/test/{tasks,forks,receipts,projections}/**` |
| C09 | `packages/orchestrator/src/context/**`, `packages/orchestrator/test/context/**`, `docs/context.md` |
| C10 | `packages/orchestrator/src/{scheduler,attempts,leases,dispatch,recovery}/**`, `packages/orchestrator/test/{scheduler,attempts,leases,dispatch,recovery}/**` |
| C11 | `tests/fixtures/hosts/**`, `tests/host-feasibility/**`, `scripts/host-feasibility/**`, `config/hosts/capability-matrix.v1.json`, `docs/{compatibility.md,integrations/feasibility.md}`, `package.json`, `pnpm-lock.yaml` |
| C12 | `packages/{sdk,adapter-kit}/**`, `docs/compatibility.md` |
| C13 | `apps/daemon/**`, `packages/protocol/src/transports/**`, `packages/protocol/test/transports/**`, `.github/workflows/ci.yml` |
| C14 | `apps/cli/**`, `docs/cli.md` |
| C15 | `adapters/pi/**`, `tests/fixtures/hosts/pi/**`, `docs/integrations/pi.md`, `docs/compatibility.md` |
| C16 | `adapters/omp/**`, `tests/fixtures/hosts/omp/**`, `docs/integrations/omp.md`, `docs/compatibility.md` |
| C17 | `adapters/claude/**`, `tests/fixtures/hosts/claude/**`, `docs/integrations/claude.md`, `docs/compatibility.md` |
| C18 | `adapters/codex/**`, `tests/fixtures/hosts/codex/**`, `docs/integrations/codex.md`, `docs/compatibility.md` |
| C19 | `packages/installer/src/{journal,trust,migrations,consent}/**`, `packages/installer/test/{journal,trust,migrations,consent}/**`, `tests/fixtures/{install-homes,journals,compat-train}/**`, `scripts/compat-train/**`, `docs/{install.md,migrations.md,compatibility.md}` |
| C20 | `packages/installer/src/{operations,doctor,uninstall,repair}/**`, `packages/installer/test/{operations,doctor,uninstall,repair}/**`, `apps/cli/src/commands/{install,uninstall,doctor,repair,smoke}.ts`, `apps/cli/test/commands/{install,uninstall,doctor,repair,smoke}.test.ts`, `apps/bootstrap/**`, `scripts/bootstrap/**`, `.github/workflows/install-smoke.yml`, `README.md`, `docs/{install.md,migrations.md}` |
| C21 | `tests/{security,system}/**`, `SECURITY.md`, `package.json`, `pnpm-lock.yaml` |
| C22 | `packages/*/package.json`, `apps/*/package.json`, `adapters/*/package.json`, `adapters/*/native-manifest.json`, `.changeset/**`, `CHANGELOG.md`, `LICENSE`, `package.json`, `pnpm-lock.yaml`, `scripts/release/**`, `.github/workflows/{ci,release-stage,live-gates}.yml`, `docs/{compatibility.md,migrations.md,release-process.md,trust-root.md}`, `docs/trust/root-ceremony-v1.json`, `docs/trust/root-ceremony-v1.schema.json`, `docs/trust/evidence/**` |
| C23 | `.github/workflows/release-stage.yml`, `scripts/release/{stage,reconcile,journal}.mjs`, `docs/releases/**`, `docs/publication-journal/**` |
| C24 | `tests/release/**`, `scripts/release/{fetch-staging,verify-public,install-exact-public,doctor-exact-public,lifecycle-exact-public,closed-loop-pi,closed-loop-omp,closed-loop-claude,closed-loop-codex,negative-gates,rollback-public,record-verification}.mjs`, `.github/workflows/release-verify.yml`, `docs/releases/**`, `docs/publication-journal/**` |
| C25 | `scripts/release/{promote,announce,revoke}.mjs`, `.github/workflows/release-promote.yml`, `docs/releases/**`, `docs/publication-journal/**` |

Every package-changing row also owns only that row's package manifests plus `pnpm-lock.yaml`. Shared files are serialized by the integrator; no conditional `if changed` ownership exists.

### Frozen acceptance command contract v3

All commands run from repository root with `CI=1 TZ=UTC LANG=C NODE_OPTIONS=--unhandled-rejections=strict`; expected exit is `0` unless stated. No skip is allowed. Linux commands run locally and in CI; rows marked OS run as required Linux, macOS, and Windows jobs. Receipts must contain the exact command string, environment digest, candidate integration SHA/tree, exit, stdout/stderr digests, and named artifacts. `scripts/acceptance.mjs` rejects substitution or omission. V nodes rerun the stale chunk's complete `v3` ordered list.

| Chunk | Ordered literal commands |
|---|---|
| C00 | `node -e "const fs=require('fs');for(const p of ['AGENTS.md','README.md','docs/architecture.md','docs/plan.md','docs/progress.md']){if(!fs.statSync(p).size)process.exit(1)};for(const s of ['ContextManifestCoreV1','AttemptReceiptEnvelopeV1','PROPOSAL_ID_MISMATCH','WorkspaceCreated','publication']){if(!fs.readFileSync('docs/architecture.md','utf8').includes(s))process.exit(1)}"` |
| C01 | `corepack pnpm install --frozen-lockfile`; `corepack pnpm run docs:lint`; `corepack pnpm run typecheck`; `corepack pnpm run lint`; `corepack pnpm run test`; `corepack pnpm run boundaries:check` |
| C02 | `corepack pnpm --filter @horseness/domain run typecheck`; `corepack pnpm --filter @horseness/domain run test -- --runInBand`; `corepack pnpm run vectors:verify -- events proposal delta context-binding receipt task-dispatch` |
| C03 | `corepack pnpm --filter @horseness/protocol run typecheck`; `corepack pnpm --filter @horseness/protocol run test -- --runInBand`; `corepack pnpm run protocol:conformance`; `corepack pnpm run generated:check` |
| C04 | `corepack pnpm --filter @horseness/policy run typecheck`; `corepack pnpm --filter @horseness/policy run test -- --runInBand` |
| C05 | `corepack pnpm --filter @horseness/store-sqlite run typecheck`; `corepack pnpm --filter @horseness/store-sqlite run test:migration-0001`; `corepack pnpm --filter @horseness/store-sqlite run test:crash-matrix` |
| C06 | `corepack pnpm --filter @horseness/store-sqlite run test`; `corepack pnpm --filter @horseness/store-sqlite run test:recovery`; `corepack pnpm --filter @horseness/store-sqlite run test:import-retention` |
| C07 | `corepack pnpm --filter @horseness/orchestrator run typecheck`; `corepack pnpm --filter @horseness/orchestrator run test:admission` |
| C08 | `corepack pnpm --filter @horseness/orchestrator run test:tasks-forks-receipts`; `corepack pnpm --filter @horseness/orchestrator run test:model` |
| C09 | `corepack pnpm --filter @horseness/orchestrator run test:context-golden`; `corepack pnpm run vectors:verify -- context-binding` |
| C10 | `corepack pnpm --filter @horseness/orchestrator run test:dispatch-property`; `corepack pnpm --filter @horseness/orchestrator run test:dispatch-restart-races` |
| C11 | `corepack pnpm run host:validate:pi`; `corepack pnpm run host:validate:omp`; `corepack pnpm run host:validate:claude`; `corepack pnpm run host:validate:codex`; `corepack pnpm run host:harness:test`; `corepack pnpm run hosts:matrix:verify` |
| C12 | `corepack pnpm --filter @horseness/sdk --filter @horseness/adapter-kit run typecheck`; `corepack pnpm --filter @horseness/sdk --filter @horseness/adapter-kit run test`; `corepack pnpm run adapter:conformance`; `corepack pnpm run boundaries:check` |
| C13 | `corepack pnpm --filter @horseness/daemon --filter @horseness/protocol run typecheck`; `corepack pnpm --filter @horseness/daemon run test:multiprocess`; `corepack pnpm run ci:require-os-receipts -- C13 linux macos windows` (OS) |
| C14 | `corepack pnpm --filter @horseness/cli run typecheck`; `corepack pnpm --filter @horseness/cli run test`; `corepack pnpm --filter @horseness/cli run smoke`; `corepack pnpm run boundaries:check` |
| C15 | `corepack pnpm --filter @horseness/adapter-pi run typecheck`; `corepack pnpm --filter @horseness/adapter-pi run test`; `corepack pnpm --filter @horseness/adapter-pi pack`; `corepack pnpm run host:smoke:pi`; `corepack pnpm run boundaries:check` |
| C16 | `corepack pnpm --filter @horseness/adapter-omp run typecheck`; `corepack pnpm --filter @horseness/adapter-omp run test`; `corepack pnpm --filter @horseness/adapter-omp pack`; `corepack pnpm run host:smoke:omp`; `corepack pnpm run boundaries:check` |
| C17 | `corepack pnpm --filter @horseness/adapter-claude run typecheck`; `corepack pnpm --filter @horseness/adapter-claude run test`; `corepack pnpm --filter @horseness/adapter-claude pack`; `corepack pnpm run host:smoke:claude`; `corepack pnpm run boundaries:check` |
| C18 | `corepack pnpm --filter @horseness/adapter-codex run typecheck`; `corepack pnpm --filter @horseness/adapter-codex run test`; `corepack pnpm --filter @horseness/adapter-codex pack`; `corepack pnpm run host:smoke:codex`; `corepack pnpm run boundaries:check` |
| C19 | `corepack pnpm --filter @horseness/installer run typecheck`; `corepack pnpm --filter @horseness/installer run test:journal-crash`; `corepack pnpm --filter @horseness/installer run test:trust-consent`; `corepack pnpm run compat-train:build -- --version 0.0.0-compat.1`; `corepack pnpm run compat-train:verify -- --version 0.0.0-compat.1` |
| C20 | `corepack pnpm --filter @horseness/installer --filter @horseness/cli run test`; `corepack pnpm run bootstrap:build`; `corepack pnpm run install:blackbox -- --clean-home --host all --accept-executable-risk fixture-release-digest`; `corepack pnpm run install:blackbox:offline -- --clean-home --host all --accept-executable-risk fixture-release-digest`; `corepack pnpm run doctor:hostile-no-side-effects`; `corepack pnpm run uninstall:failure-matrix`; `corepack pnpm run ci:require-os-receipts -- C20 linux macos windows` (OS) |
| C21 | `corepack pnpm run test:security`; `corepack pnpm run test:system`; `corepack pnpm run test:closed-loop -- --hosts pi,omp,claude,codex` |
| C22 | `corepack pnpm run release:verify-root-ceremony -- --schema docs/trust/root-ceremony-v1.schema.json --record docs/trust/root-ceremony-v1.json --evidence docs/trust/evidence --offline --threshold 2-of-2`; `corepack pnpm run release:verify-delegation -- --root-record docs/trust/root-ceremony-v1.json --require-version-range --require-kms-policy --require-two-approvals`; `corepack pnpm install --frozen-lockfile`; `corepack pnpm run release:coherence`; `corepack pnpm run release:build-twice`; `corepack pnpm run release:verify-sbom-provenance-signatures`; `corepack pnpm run live-gates:required -- --matrix config/hosts/capability-matrix.v1.json`; `corepack pnpm run release:dry-run`; `corepack pnpm run release:verify-no-static-secrets`. The first two commands are an explicit integrated dependency of every later C22 command; no KMS signing or immutable upload intent may be recorded until both succeed. |
| C23 | `corepack pnpm run release:stage -- --manifest dist/release-manifest.json`; `corepack pnpm run release:reconcile -- --require-all --journal docs/publication-journal/current.jsonl`; `corepack pnpm run release:verify-partial-receipts`; expected state `reconciled`, never default-tagged |
| C24 | Sole acceptance contract: the complete ordered literal `v3:C24` list under **C24 complete ordered v3 acceptance list**; no command is duplicated here |
| C25 | `corepack pnpm run release:promote -- --journal docs/publication-journal/current.jsonl`; `corepack pnpm run release:announce`; `corepack pnpm run release:verify-default-channels`; expected state `announced` |

The compatibility train `0.0.0-compat.1` is a reproducible, non-public, signed fixture built from `tests/fixtures/compat-train/**`; it includes packed database/journal/daemon/CLI/installer behavior sufficient to initiate migration. Its source digest, artifact digest, version, and fixture signing provenance are frozen in C19. Later public releases replace it with actual public N-1.

### One-command installation contract

After the platform-native detached verification step, the sole Horseness setup invocation is:

- POSIX online: `./horseness-bootstrap install --manifest https://releases.horseness.dev/fixture/manifest.json --scope user --workspace /tmp/horseness-fixture-workspace --create-workspace --host all --accept-executable-risk fixture-release-digest`
- POSIX offline: `./horseness-bootstrap install --manifest /tmp/horseness-offline/manifest.json --scope user --workspace /tmp/horseness-fixture-workspace --create-workspace --host all --accept-executable-risk fixture-release-digest`
- Windows: `.\\horseness-bootstrap.exe install --manifest C:\\horseness-offline\\manifest.json --scope user --workspace C:\\horseness-fixture-workspace --create-workspace --host all --accept-executable-risk fixture-release-digest`

That one invocation installs/starts the daemon, creates or connects the workspace, consumes first-authority bootstrap when needed, provisions opaque adapter credential references, installs selected native contributions, records consent, and runs static doctor. No later Horseness command or manual config edit is permitted. Exit `0` means all requested present hosts installed, `1` operational failure, `2` invocation failure, `3` partial per-host failure, `4` consent/trust refusal. Offline uses the same command with a local manifest. C20 clean-home tests and C24 exact-public tests enforce this contract.

### Release chunk correction

C23 stages and reconciles immutable public bytes only. C24 verifies those exact bytes before any default channel moves. New **C25 — Authorized promotion and announcement** depends on C24 and owns the exact paths above; its acceptance is the C25 command row. On partial publish, C23 remains `blocked` or `in-progress` with append-only receipts; exact matches resume, mismatches transition the version to `abandoned`/`revoked` and require P/R/V planning plus a new version. C24 findings prohibit promotion and use the same rollover rule.

### Round-three review log

Resolved every blocker/high/medium item in `local://plan-review-findings-round3.json`: acyclic core/binding hashes; workspace/run epochs; derived schedulability; all post-handoff receipt races; canonical proposal IDs; exact delta preconditions/reason outcomes; versioned authenticated receipt submission; workspace genesis; exact ownership and command matrices; constructible claim/attestation and C00 bootstrap; executable P/F/R/V flow; one-command install; packed first-release compatibility train; consent; mandatory pre-publication live gates; dual-root/OIDC trust; non-executing doctor; fail-safe uninstall; and stage→verify→promote recovery. Base delivery is now `C00 -> ... -> C24 -> C25`, 26 chunks.

## Round-four normative execution addendum

This addendum resolves `local://plan-review-findings-round4.json` and supersedes conflicting scheduling, ownership, bootstrap, acceptance, retry, publication, and promotion text above.

### Bootstrap receipt variants and start of the ordinary graph

The repository may have no parent commit. C00 therefore uses `CheckpointReceiptV1/receiptVariant=bootstrap-v1` from `docs/checkpoints/schema.json`. Its root candidate `W00` is the repository root commit, with `rootParent:null`, `workerBaseSha:null`, `workerCandidateSha:W00`, `candidateIntegrationSha:W00`, its tree, command results, and `bootstrapClaimId = sha256("horseness.bootstrap-claim.v1\0" || "C00" || candidateTree || acceptanceContractVersion)`. C00 has no `K`, `B1`, or claim expiry. Its attestation `A00` is the next commit and appends the bootstrap receipt/index digest; resume validates root ancestry `W00 -> A00`, tree equality, schema, command order, and receipt/index hashes.

C01 is the only tool-free claim exception. From `A00`, the integrator computes `claimId = sha256("horseness.c01-claim.v1\0" || "C01" || A00 || C00ReceiptDigest || expiry)`, writes/commits `K01`, and validates its fields with a frozen Node inline check before edits. `K01` integrates as `B1`; C01 creates `scripts/progress-cas.mjs`, and its acceptance proves the script validates both bootstrap-v1 and C01 ordinary-v1 fixtures. The ordinary `K/B1/W/I/A` graph begins with C01 candidate production after `B1`; C02 and later use the script for every operation.

Completed receipts validate that the claim was unexpired at candidate sealing and attestation. Later wall-clock expiry never invalidates a completed receipt. Resume rejects an uncompleted expired attempt.

### Versioned claim-attempt generations, renewal, blocking, and resume

Every node execution is a numbered `ClaimAttemptV1`. Attempt 1 establishes `B1`. Renewal never mutates that base in place: before expiry, the integrator commits a renewal record, supersedes the old attempt without attesting it, establishes a new integrated base from current HEAD, increments `attemptGeneration`, and issues a new domain-separated claim ID/expiry. The worker must rebase/reseal and produce a new `W/I` pair whose full tree matches that latest base plus candidate changes. Receipts name the generation and its entire prior-attempt/supersession chain. Only the latest unsuperseded generation can attest.

The detector emergency transaction is one authorized CAS commit owning `docs/findings/FNNN.json`, one append to `docs/findings/index.jsonl`, `docs/progress.md`, and the detector ledger. It atomically records `FindingV1`, changes the detector attempt to `blocked`, preserves its candidate as `superseded-by-finding`, and integrates against the exact current head; partial application is invalid. It does not edit source.

After P/R/V closure, the final V transaction changes the detector node from `blocked` to `not-started`, records the closed finding and remediated head, and requires a fresh claim attempt from that head. The prior detector candidate can never be attested. The resumed detector produces a new matching W/I tree and reruns its complete frozen acceptance contract. The same generation rules apply to post-remediation resume, expiry renewal, and abandoned candidates.

### Frozen generic P/R/V acceptance and unified priority

Scheduling priority is exactly `P -> R -> V -> C`. The lowest numeric dependency-ready node in the first nonempty class is the only selectable node. A ready P preempts new R/V/C claims; already running work stops at the next safe boundary and cannot attest until the P disposition says its evidence remains current. `progress-cas verify-resume` rejects any selected R/V/C while an eligible P exists.

`P-acceptance-v1` is the pre-frozen structural validator defined in the final-review addendum. Its only parameters are IDs and exact path arrays already sealed in `ClaimAttemptV1`; it never consumes semantic ownership shorthand, comma-delimited `AFFECTED_DOC_PATHS`, or candidate-defined proof rules. P freezes each R node's exact source/test/doc ownership and literal ordered commands in immutable `config/acceptance/RNNN.json`; each V analogously freezes the inherited stale contract. Attestation recomputes every finding, index, claim, acceptance-record, checkpoint, stale-descendant, status, count, dependency, and subject invariant.

### C00 complete contract gate

C00 additionally owns the canonical checkpoint fixtures and the two literal Node program-text files named in its exact ownership row. These are planning-owned validation contracts, not implementation scripts or manifests. The sole C00 acceptance command is `node -e "$(cat docs/validation/c00-contract-gate.node-e.txt)"`. It runs from the W00 planning tree with Node 22 and no package install. The program bytes in `docs/validation/c00-contract-gate.node-e.txt`, the three RFC 8785 canonical fixture byte strings, and `docs/checkpoints/fixtures/digests.json` are immutable inputs to `v3:C00`.

Before any C01 edit, the integrator creates K01 and runs exactly `node -e "$(cat docs/validation/c01-claim-check.node-e.txt)" -- --claim <K01-claim-path> --a00 <A00-SHA> --c00-receipt <C00-receipt-digest>`. C01 then creates `scripts/c00-contract-gate.mjs` as a byte-for-byte copy of the C00 program text and `scripts/progress-cas.mjs`; its ordered acceptance begins with `node -e "const fs=require('fs'),crypto=require('crypto');const a=fs.readFileSync('docs/validation/c00-contract-gate.node-e.txt'),b=fs.readFileSync('scripts/c00-contract-gate.mjs');if(!a.equals(b))process.exit(1);console.log(crypto.createHash('sha256').update(a).digest('hex'))"` and then runs the named gate against the canonical fixtures. No C01 output is needed to attest C00 or authorize the C01 claim.

The C00 ledger checks every promised transition table, digest preimage/vector representation, trust boundary, ownership rule, compatibility axis, ADR, schema/index invariant, canonical fixture digest, and review item. The real offline root ceremony is intentionally absent from C00 and cannot block implementation.

### Required compile, boundary, and CLI reachability gates

The v3 rows are amended literally: C06 adds store `typecheck`; C08, C09, and C10 each add orchestrator `typecheck`; C13 adds `boundaries:check`; C20 adds installer, CLI, and bootstrap `typecheck` plus `boundaries:check`. `scripts/acceptance.mjs` structurally rejects a TypeScript-owning row without every affected package typecheck and rejects adapter/executable-edge rows without `boundaries:check`.

C14 must freeze a typed command registry whose public registration interface is extensible without editing its router. C20 additionally owns `apps/cli/src/{entry,router,registry,help,completion}/**` and corresponding tests, plus command modules/tests for `install`, `upgrade`, `downgrade`, `rollback`, `retry-install`, `uninstall`, `doctor`, `repair`, `rebind-workspace`, and `smoke`. C20 acceptance invokes each through the packed real CLI entry point and freezes exits: `0` success, `1` operational failure, `2` usage/workspace mismatch, `3` partial or revocation-pending, `4` consent/trust refusal. Upgrade/rollback retain the journaled workspace binding; rebind is explicit.

The amended ordered rows are exact replacements, not prose additions:

- C06: `corepack pnpm --filter @horseness/store-sqlite run typecheck`; then its existing three v3 test commands.
- C08: `corepack pnpm --filter @horseness/orchestrator run typecheck`; then its existing two v3 commands.
- C09: `corepack pnpm --filter @horseness/orchestrator run typecheck`; then its existing two v3 commands.
- C10: `corepack pnpm --filter @horseness/orchestrator run typecheck`; then its existing two v3 commands.
- C13: its existing three commands; then `corepack pnpm run boundaries:check`.
- C20: `corepack pnpm --filter @horseness/installer --filter @horseness/cli --filter @horseness/bootstrap run typecheck`; its existing seven commands; `corepack pnpm run cli:lifecycle:blackbox -- install upgrade downgrade rollback retry-install uninstall doctor repair rebind-workspace smoke`; then `corepack pnpm run boundaries:check`.

The one-command install literals in this plan are amended to require `--workspace <absolute-path-or-workspace-id>` and optional explicit `--create-workspace`; omission or ambiguity exits `2` without mutation.

### C22 immutable artifact handoff

C22 uploads exactly one of the two byte-identical builds to immutable, retention-locked artifact storage. Its checkpoint binds storage URI, retention deadline, release-manifest digest, every artifact digest/size/media type, SBOM, provenance, both signatures, delegated-key audit receipt, and upload receipt. Ambient `dist/**` is never a dependency.


The C22 row appends, after successful build/signature gates: `corepack pnpm run release:upload-immutable -- --select-build build-1 --receipt-out .acceptance/C22-artifact-receipt.json`; `corepack pnpm run release:verify-artifact-receipt -- --checkpoint-subject C22`. C22 cannot attest without the retention-locked URI and complete digest inventory.

The C23 row begins: `corepack pnpm run release:fetch-candidate -- --from-checkpoint C22 --verify-all`; then `corepack pnpm run release:stage -- --manifest-from-receipt C22`; `corepack pnpm run release:reconcile -- --require-all --journal docs/publication-journal/current.jsonl`; `corepack pnpm run release:verify-partial-receipts`. Expected state is `reconciled`, never default-tagged.

C24 uses only the complete ordered `v3:C24` command list in the readiness-correction addendum below. Every earlier C24 command row, prefix, suffix, amendment, and relative-order statement is void.
C23 begins with `release:fetch-candidate --from-checkpoint C22 --verify-all`, publishes only fetched verified bytes, and records their content-addressed local cache digest. C24 fetches the signed manifest and artifacts from immutable staging by the C23 journal/receipt and cross-checks every digest against C22. Fresh claims and crash resumes hydrate only from these receipts.

### Durable external-effect checkpoints

C22, C23, C24, and C25 may integrate signed append-only `side-effect-v1` receipt commits while status remains `in-progress` or `blocked`, under the single final-review external-effect protocol. Every request has an integrated intent and lookup-first observed result; the final ordinary receipt binds the complete side-effect head.

### C24 verification ownership

C24 exact ownership includes `docs/publication-journal/**`. Its acceptance must append and integrate each exact-public verification receipt and any `partial`, `abandoned`, or `revoked` transition before attestation. Only a journal head at `black_box_verified`, whose receipt binds C22 digests and C23 immutable references, satisfies C25's dependency.

### C25 promotion order

C25 uses only the complete literal six-command list in the final-review addendum. Announcement consumes the promoted receipt by fixed journal path, verification is mandatory, and the only successful terminal state is `announced`; there are no placeholders or optional gates.

### Round-four review log

Resolved every blocker/high/medium finding in `local://plan-review-findings-round4.json`: attempt/task separation and deterministic duplicate arbitration; observation/result cursor acyclicity; canonical `NoPolicyV1`; explicit C00/C01 bootstrap graphs; complete C00 artifacts and gate; pre-frozen P/R/V acceptance with unified P→R→V→C priority; atomic detector blocking plus claim generations for renewal/resume; README and bounded normative-doc P ownership; compile/boundary gates; CLI reachability and lifecycle commands; explicit workspace selection; revocation-pending uninstall; immutable C22 artifact handoff; durable C23/C25 side-effect receipts; ordinary release signer custody; C24 journal ownership; and verify-before-announce C25 promotion.

## Final-review normative execution addendum

This addendum resolves `local://plan-review-findings-final.json` and replaces every conflicting command, checkpoint, ownership, release, and review-log statement above.

### Frozen checkpoint, claim, and index algorithms

`docs/checkpoints/schema.json` is the pre-C01 schema suite for `ClaimAttemptV1`, `CommandResultV1`, `CheckpointReceiptV1`, and `CheckpointIndexRecordV1`. Every digest uses RFC 8785 JCS UTF-8 bytes and lowercase hex SHA-256:

- `claimDigest = sha256("horseness.claim-attempt.v1\0" || canonicalJson(claimWithoutClaimDigest))`.
- `receiptDigest = sha256("horseness.checkpoint-receipt.v1\0" || canonicalJson(receiptWithoutReceiptDigest))`.
- `recordHash = sha256("horseness.checkpoint-index-record.v1\0" || canonicalJson(indexRecordWithoutRecordHash))`.

Index ordinal is contiguous from zero; records are newline-delimited canonical JSON; `priorRecordHash` equals the immediately preceding record's `recordHash`; ordering is integration order. The frozen genesis line has ordinal zero and hash `03236ed8a97be912484acacfe161d5e9607a2995228094cccd52c3ef3dda6196`. Ordinary and bootstrap C00/C01 fixtures freeze complete canonical bytes and digests before C01 implementation. Dependency receipt digests are ordered exactly as the node's dependency list; prior-attempt digests are chronological; command results are in acceptance ordinal order. Candidate sealing and attestation timestamps MUST each precede claim expiry except bootstrap, whose null expiry is explicitly proven. Signer, CI identity when used, supersession, evidence, and final side-effect head are mandatory schema fields.

Side effects use append-only paths `docs/checkpoints/<ID>/side-effects/<attemptGeneration>/<operationId>/<ordinal>-<phase>.json`; no file is overwritten. The final ordinary receipt is `docs/checkpoints/<ID>/final/<attemptGeneration>.json` and binds the last side-effect receipt digest in `sideEffectHead`. Index records name every literal receipt path. C22, C23, C24, and C25 may integrate these receipt-only commits while their attempt remains in progress; each is chained to the current claim attempt and final candidate. Resume authenticates the complete index and side-effect chain before any lookup/request. C00's validator parses all schemas, recomputes both genesis hashes, validates canonical bootstrap/C01 fixtures, and rejects missing required fields or noncanonical ordering.

### Findings and structural P acceptance

`docs/findings/schema.json` now requires both detector worker and integrated candidate identities and typed reproduction command/environment/exit/stdout/stderr/result digests. Finding index records use `recordHash = sha256("horseness.finding-index-record.v1\0" || canonicalJson(recordWithoutRecordHash))`, contiguous ordinals, and lifecycle transitions `recorded -> planned -> remediated -> closed`; the frozen genesis hash is `574d51ad0de47c639c09000d7da3876f9957c2abd8c41c4728e398a7fa33c340`.

Every P claim seals three exact arrays: `ALLOWED_PATHS`, `AFFECTED_ADR_PATHS`, and `ACCEPTANCE_RECORD_PATHS`. The first may include every mutable planning execution contract, including `AGENTS.md`, `README.md`, `docs/architecture.md`, `docs/plan.md`, `docs/progress.md`, `docs/progress/template.md`, `docs/checkpoints/schema.json`, `docs/checkpoints/index.jsonl`, `docs/findings/schema.json`, `docs/findings/index.jsonl`, security/compatibility/integration/migration/trust/protocol/policy/context documents, exact P/R/V ledgers/checkpoints, and exact finding files. ADRs are only the sealed fully qualified `docs/adr/NNNN-name.md` values. Machine acceptance records are exactly `config/acceptance/<P|R|V><NNN>.json`. Claim validation rejects every write outside the union, symlink traversal, normalization difference, or later array mutation.

The former inline substring check is deleted. The sole pre-frozen ordered P gate is `node scripts/progress-cas.mjs verify-planning-correction --claim-from-ledger docs/progress/${P_ID}.md --finding docs/findings/${F_ID}.json --finding-index docs/findings/index.jsonl --checkpoint-index docs/checkpoints/index.jsonl --acceptance-dir config/acceptance --strict`. C01 owns this validator and schemas for the machine records; P cannot modify them. It recomputes finding/index/claim/receipt hashes, validates lifecycle transition, exact allowed/ADR/acceptance paths, R/V ownership and dependencies, literal command records, stale descendant closure, counts/statuses, priority, ledger/checkpoint subjects, and atomic summary reconciliation. The environment supplies only IDs already sealed in the claim; no comma-delimited ownership or substring search remains.

### Final C00 gate

The C00 gate is the literal Node 22 program and command frozen in `docs/validation/c00-contract-gate.node-e.txt` and the C00 ledger. It enumerates every C00-owned path, parses the schemas, recomputes checkpoint/finding genesis and canonical fixture hashes, checks bootstrap and ordinary graph evidence, and checks the frozen architecture/release contract markers. It does not inspect or require production signing credentials. `scripts/c00-contract-gate.mjs` is C01-owned post-bootstrap output and cannot be invoked by C00.

### Exact vector and compatibility ownership

C02 additionally owns `docs/vectors/{cursors,fork-pin,dependency-join,delta-authority,authorization}/**`. Its literal vector command is replaced by `corepack pnpm run vectors:verify -- events cursors proposal delta fork-pin dependency-join delta-authority context-binding receipt task-dispatch authorization`. It runs before C08/C09 or adapters consume these boundaries. C03 protocol conformance must round-trip all cursor variants, `ForkPinCoreV1`, `DependencyJoinSnapshotCoreV1`, `DeltaAuthorityScopeV1`, proposal-sealing observations, and authorization denials without an unnamed persisted `cursor` field.

The C02 implementation exposed the verifier from `@horseness/domain`, but the frozen repository-root command also requires shared-root integration. C02 therefore owns the single root `package.json` script `"vectors:verify": "pnpm --filter @horseness/domain run vectors:verify"`; this is an ownership correction only and does not broaden C02's root-manifest authority.

C03's two frozen repository-root gates require shared-root forwarding scripts before they can execute. C03 therefore owns only the root `package.json` entries `"protocol:conformance": "pnpm --filter @horseness/protocol run protocol:conformance"` and `"generated:check": "pnpm --filter @horseness/protocol run generated:check"`; this serialized upfront ownership correction does not authorize any other root-manifest change. The C03 tracker claim records `docs/plan.md` as correction-only ownership, and implementation must preserve this exact scope.

### Exact C20 and C24 workspace-bound invocations

The deterministic fixture workspace is `/tmp/horseness-fixture-workspace` on POSIX and `C:\horseness-fixture-workspace` on Windows; harnesses create an empty parent and verify realpath normalization. C20's online command is `corepack pnpm run install:blackbox -- --clean-home --workspace /tmp/horseness-fixture-workspace --create-workspace --host all --accept-executable-risk fixture-release-digest`; offline is `corepack pnpm run install:blackbox:offline -- --clean-home --workspace /tmp/horseness-fixture-workspace --create-workspace --host all --accept-executable-risk fixture-release-digest`. Required Windows OS receipts use `C:\horseness-fixture-workspace` with the same flags. All C24 invocations are defined only by the complete ordered list below.

### Unified C22-C25 external-effect protocol

C22-C25 all own `docs/publication-journal/**` and their append-only side-effect receipt namespace. Before KMS signing, retention-locked upload, registry/release-asset/tag/channel/pointer mutation, exact-public verification-state recording, promotion, or announcement, the current attempt integrates a signed intent. Recovery always performs lookup first; exact digest integrates observed/reconciled, definite absence permits only an idempotent request with the same key, ambiguity blocks, and mismatch records abandoned/revoked. Intermediate receipt commits contain no source changes, bind claim attempt/candidate tree/operation ID/prior journal and checkpoint heads, and the final ordinary receipt binds the complete side-effect head.

C22 therefore adds intent/observed pairs around KMS and immutable upload before its final attestation. C23 does the same for staging destinations. C24 does the same for every verification-state transition and exact-public lookup. C25 does the same for promotion and announcement. The prior restriction to C23/C25 is void.

### C24 complete ordered v3 acceptance list

Every prior C24 acceptance row or amendment is replaced by this single ordered literal list; omission, skip, duplication, or reordering invalidates the receipt: (1) `corepack pnpm run release:fetch-staging -- --from-checkpoint C23 --cross-check C22`; (2) `corepack pnpm run release:verify-public -- --manifest-from-checkpoint C23 --channels immutable-staging`; (3) `corepack pnpm run release:install-exact-public -- --from-checkpoint C23 --mode online --os linux --workspace /tmp/horseness-fixture-workspace --create-workspace --host all`; (4) `corepack pnpm run release:install-exact-public -- --from-checkpoint C23 --mode offline --os linux --workspace /tmp/horseness-fixture-workspace --create-workspace --host all`; (5) `corepack pnpm run release:install-exact-public -- --from-checkpoint C23 --mode online --os macos --workspace /tmp/horseness-fixture-workspace --create-workspace --host all`; (6) `corepack pnpm run release:install-exact-public -- --from-checkpoint C23 --mode offline --os macos --workspace /tmp/horseness-fixture-workspace --create-workspace --host all`; (7) `corepack pnpm run release:install-exact-public -- --from-checkpoint C23 --mode online --os windows --workspace C:\\horseness-fixture-workspace --create-workspace --host all`; (8) `corepack pnpm run release:install-exact-public -- --from-checkpoint C23 --mode offline --os windows --workspace C:\\horseness-fixture-workspace --create-workspace --host all`; (9) `corepack pnpm run release:doctor-exact-public -- --from-checkpoint C23 --host all`; (10) `corepack pnpm run release:lifecycle-exact-public -- --from-checkpoint C23 --compat-version 0.0.0-compat.1 --cover upgrade,migrate,journal,backup-restore,rollback,replay,doctor,load,uninstall,tampered-uninstall`; (11) `corepack pnpm run release:closed-loop:pi -- --from-checkpoint C23 --workspace /tmp/horseness-fixture-workspace`; (12) `corepack pnpm run release:closed-loop:omp -- --from-checkpoint C23 --workspace /tmp/horseness-fixture-workspace`; (13) `corepack pnpm run release:closed-loop:claude -- --from-checkpoint C23 --workspace /tmp/horseness-fixture-workspace`; (14) `corepack pnpm run release:closed-loop:codex -- --from-checkpoint C23 --workspace /tmp/horseness-fixture-workspace`; (15) `corepack pnpm run release:negative-gates -- --from-checkpoint C23 --cover provenance,checksum,signature,revocation,wrong-version,wrong-channel`; (16) `corepack pnpm run release:rollback-public -- --compat-version 0.0.0-compat.1 --from-checkpoint C23`; (17) `corepack pnpm run live-gates:required -- --exact-public --from-checkpoint C23`; (18) `corepack pnpm run ci:require-os-receipts -- C24 linux macos windows`; (19) `corepack pnpm run release:record-verification -- --journal docs/publication-journal/current.jsonl --state black_box_verified`. Commands 1–2 prove C22/C23-only hydration and public digest/signature identity; 3–8 prove online/offline exact-public installation on every required OS; 9–10 and 16 prove doctor, migration, backup, rollback, replay, load, safe/tampered uninstall; 11–14 prove the four host closed loops through accepted delta, reconstruction, and dependent dispatch; 15 proves trust negatives; 17–18 prove live and OS receipts; 19 is the only terminal state transition and must integrate its side-effect receipt.

### Exact C25 command list

C25's complete ordered list is: `corepack pnpm run release:promote -- --journal docs/publication-journal/current.jsonl`; `corepack pnpm run release:reconcile-promotion -- --require-all --journal docs/publication-journal/current.jsonl`; `corepack pnpm run release:verify-default-channels -- --verify-signed-install-pointer --journal docs/publication-journal/current.jsonl`; `corepack pnpm run release:record-promotion -- --journal docs/publication-journal/current.jsonl --state promoted`; `corepack pnpm run release:announce -- --promotion-receipt-from-journal docs/publication-journal/current.jsonl`; `corepack pnpm run release:verify-announcement -- --journal docs/publication-journal/current.jsonl`. No command is optional and no runtime placeholder/substitution is permitted. The terminal journal state is exactly `announced`, with the announcement record naming the integrated promoted record hash.

## Closure-corrected C00/C01 execution contract

This section resolves `local://plan-closure-findings.json` and is the sole authority for C00/C01 paths, indexing, validation, command order, and signer workflow. Every conflicting earlier C00/C01 command row, shorthand path, placeholder, prefix/suffix amendment, and C22/C23 signer-workflow statement is void.

### Append-only bootstrap and claim records

The A00 bootstrap receipt is written exactly once at `docs/checkpoints/C00/bootstrap/0.json`. Its `CheckpointIndexRecordV1` is appended to `docs/checkpoints/index.jsonl` after the ordinal-zero genesis record and names that literal path. C00 owns that path for the A00 receipt-only attestation transaction; it is not present in W00 and is never overwritten.

Every claim attempt is canonical JSON at `docs/claims/<ID>/<attemptGeneration>.json`; K01 is exactly `docs/claims/C01/1.json`. Every creation or renewal appends one `ClaimIndexRecordV1` to `docs/claims/index.jsonl`, ordered by claim integration, with contiguous ordinal, literal claim path, claim digest, pre-claim base SHA, and prior-record hash. Claim files and claim-index lines are append-only; supersession creates the next generation and never mutates an earlier record. The claim and index contain only `preClaimBaseSha`, the commit that was `HEAD` before K was created; neither contains K/B1. The chunk Markdown ledger references the canonical JSON path, digest, and pre-claim base only; it never embeds a second claim object or K/B1 SHA. The checkpoint index authenticates receipts, the claim index authenticates claims, and resume validates both chains before work. C00 owns the claim-index genesis. Each ordinary node owns only its own claim generation path, its append to the claim index, its ledger, receipt path, and checkpoint-index append in addition to its frozen source paths.

Before any C01 source edit, the integrator writes and integrates K01 at `docs/claims/C01/1.json`, appends its claim-index record, updates `docs/progress/C01.md` to reference that path/digest, and runs exactly `node -e "$(cat docs/validation/c01-claim-check.node-e.txt)" -- --claim docs/claims/C01/1.json --a00 <A00-SHA> --c00-receipt <C00-receipt-digest> --now <trusted-current-RFC3339>`. The checker requires the exact C01 allowed-path set, empty ADR/acceptance arrays, null sealing/attestation fields, generation one, unsuperseded lineage, completed C00 dependency, canonical bytes, valid domain-separated identities, and an unexpired claim at the explicit trusted time.

### Sole effective ordered `v3:C01` command list

The following twelve literal commands are the complete C01 acceptance sequence. Receipts contain them at ordinals 0 through 11 exactly; omission, abbreviation, substitution, duplication, or reordering is invalid:

1. `node -e "const fs=require('fs'),crypto=require('crypto');const a=fs.readFileSync('docs/validation/c00-contract-gate.node-e.txt'),b=fs.readFileSync('scripts/c00-contract-gate.mjs');if(!a.equals(b))process.exit(1);console.log(crypto.createHash('sha256').update(a).digest('hex'))"`
2. `node scripts/c00-contract-gate.mjs`
3. `node scripts/progress-cas.mjs verify-bootstrap --receipt docs/checkpoints/fixtures/bootstrap-v1.json --checkpoint-index docs/checkpoints/index.jsonl --strict`
4. `node scripts/progress-cas.mjs verify-claim --claim docs/checkpoints/fixtures/c01-claim-v1.json --claim-index docs/claims/index.jsonl --now 2026-01-01T00:30:00Z --strict`
5. `node scripts/progress-cas.mjs verify-receipt --receipt docs/checkpoints/fixtures/c01-ordinary-v1.json --claim docs/checkpoints/fixtures/c01-claim-v1.json --checkpoint-index docs/checkpoints/index.jsonl --strict`
6. `node scripts/progress-cas.mjs verify-resume --id C01 --claim docs/checkpoints/fixtures/c01-claim-v1.json --receipt docs/checkpoints/fixtures/c01-ordinary-v1.json --checkpoint-index docs/checkpoints/index.jsonl --claim-index docs/claims/index.jsonl --integrated-head A01 --strict`
7. `corepack pnpm install --frozen-lockfile`
8. `corepack pnpm run docs:lint`
9. `corepack pnpm run typecheck`
10. `corepack pnpm run lint`
11. `corepack pnpm run test`
12. `corepack pnpm run boundaries:check`

The canonical bootstrap fixture contains only the sole literal C00 gate command. The canonical ordinary C01 fixture contains all twelve commands above. Abbreviated strings such as `node -e frozen-c00-gate` are invalid negative examples, never valid receipt evidence.

### Release signer workflow closure

The only delegated OIDC signer workflow is `.github/workflows/release.yml`. C22 exclusively owns and creates it, validates it before requesting the KMS signature, and exercises the KMS intent/observed pair from that workflow. The delegated identity remains `refs/heads/main:.github/workflows/release.yml`. C23 consumes the signed immutable C22 handoff and does not own or create the signer workflow. Any earlier C22 `release-stage.yml` signer implication or C23 `release.yml` ownership is void.

### Final review log

Resolved every blocker/high/medium finding in `local://plan-review-findings-final.json`: constructible absent-workspace, workspace-only, absent-run, run-only, and composite observation/result cursors; separated authorization observation from ForkPin source view; durable pre-call launch intent and receipt acceptance race closure; immutable delta scope and precedence; frozen `ForkPinCoreV1` and dependency/join digest vectors; named proposal-sealing observation; complete checkpoint/claim/index schemas and hashes; append-only multi-receipt release checkpoints; typed detector evidence and finding lifecycle; exact P path/ADR/acceptance ownership and structural validator; literal workspace-bound install commands; exact C25 sequence; concrete trust ceremony gate; command authorization matrix; C22/C24 journal authority; exact-public four-host closed loops; and the narrowed realizable same-user threat boundary.

## Definitive blocker/high closure addendum

This addendum resolves `local://plan-definitive-findings.json` and supersedes every conflicting C00/C01 receipt/checker/command, task-resolution, adapter, authorization, CLI, branch, and review-log statement above.

### C00 ownership and signed validation bundle

C00 additionally owns `docs/checkpoints/fixtures/c01-bundle-v1/**`. The bundle is isolated and self-contained: canonical signed bootstrap and ordinary envelopes, K01 claim, dedicated checkpoint/claim indexes, trust store, signature vectors, digest manifest, and reproducible synthetic Git DAG. No production verifier may select fixture behavior from a path heuristic. `verify-fixture-bundle` is an explicit mode that rejects paths outside that bundle and never reads live indexes or authorizes work. Live modes reject fixture paths and read only canonical repository records.

Before W00 sealing, bootstrap normalizes the integration branch to `main`; where a remote exists it verifies the remote default branch and required protection. C00 evidence records `refs/heads/main`, remote/default/protection observations or an explicit no-remote result. Any other local integration branch invalidates W00. C22's workflow trigger, OIDC workflow reference, KMS policy, Sigstore tuple, and release receipts remain exactly aligned to `main`.

The production trust store path is `docs/checkpoints/trust.json`. W00 contains only authorized public-key records obtained by the bootstrap integrator; private keys never enter the repository. Fixture trust is only `docs/checkpoints/fixtures/c01-bundle-v1/trust.json` and its keys are rejected for production subjects.

### Frozen live pre-edit C01 authorization

Immediately after K01 integration and before any C01 source edit, run exactly:

`node -e "$(cat docs/validation/c01-claim-check.node-e.txt)" -- --claim docs/claims/C01/1.json --now <trusted-current-canonical-UTC-seconds> --integrated-head HEAD`

The checker accepts no caller-supplied A00 SHA or C00 digest. It rejects symlinks in every traversed component; requires canonical bytes and canonical UTC-second timestamps; validates the complete live checkpoint and claim index chains; requires exactly one indexed `docs/checkpoints/C00/bootstrap/0.json` envelope and one indexed `docs/claims/C01/1.json`; verifies core/envelope digests, Ed25519 signature and trust scope/time/revocation; treats the integrated `HEAD` commit itself as K01/B1; derives A00 as its sole parent; requires `claim.preClaimBaseSha = index.preClaimBaseSha = A00`; verifies commit type, tree identity, claim/index blob paths and exact bytes in that tree, W00→A00→K01/B1 ancestry, branch `main`, exact C01 ledger pre-claim base, identity, dependency, allowed paths, null sealing/attestation, and `issuedAt <= trustedNow < expiresAt`. `--now` is mandatory trusted authority input and is never inferred from claim or filesystem metadata.

The real A01 resume graph cannot be verified before A01 exists. It is checked only by the post-attestation C02 claim/resume gate against the integrated A01 head.

### Signed CheckpointReceiptCoreV1 acceptance

`docs/checkpoints/schema.json` and all consumers use the definitive architecture's `CheckpointReceiptCoreV1`, `CheckpointSignatureV1`, `CheckpointReceiptEnvelopeV1`, `CheckpointTrustStoreV1`, `coreDigest`, signed-byte, and `envelopeDigest` contract. Checkpoint index `receiptDigest` means envelope digest. C01 `progress-cas` must verify signatures for bootstrap, ordinary, and side-effect receipts and must implement distinct `verify-live-*` and `verify-fixture-bundle` entry points. C02 owns matching public vectors under `docs/vectors/receipt/**`; C21 repeats unknown-key, duplicate-key, revocation boundary, wrong principal/scope, signature/core/envelope substitution, canonical timestamp, trust-time, and symlink negatives.

### Sole effective ordered `v3:C01` command list

The complete ordered C01 list is exactly eleven commands:

1. `node -e "const fs=require('fs'),crypto=require('crypto');const a=fs.readFileSync('docs/validation/c00-contract-gate.node-e.txt'),b=fs.readFileSync('scripts/c00-contract-gate.mjs');if(!a.equals(b))process.exit(1);console.log(crypto.createHash('sha256').update(a).digest('hex'))"`
2. `node scripts/c00-contract-gate.mjs`
3. `node scripts/progress-cas.mjs verify-live-bootstrap --receipt docs/checkpoints/C00/bootstrap/0.json --checkpoint-index docs/checkpoints/index.jsonl --trust docs/checkpoints/trust.json --integrated-head HEAD --strict`
4. `node scripts/progress-cas.mjs verify-live-claim --claim docs/claims/C01/1.json --claim-index docs/claims/index.jsonl --checkpoint-index docs/checkpoints/index.jsonl --trust docs/checkpoints/trust.json --now 2026-01-01T00:30:00Z --integrated-head HEAD --strict`
5. `node scripts/progress-cas.mjs verify-fixture-bundle --bundle docs/checkpoints/fixtures/c01-bundle-v1 --strict`
6. `corepack pnpm install --frozen-lockfile`
7. `corepack pnpm run docs:lint`
8. `corepack pnpm run typecheck`
9. `corepack pnpm run lint`
10. `corepack pnpm run test`
11. `corepack pnpm run boundaries:check`

Commands 3–4 are production checks over real A00/K01 and live indexes. Command 5 alone tests synthetic bootstrap/ordinary receipt, resume, index, signature, trust, chronology, and Git-DAG algorithms. The canonical ordinary fixture seals before ordinal zero starts, orders all command intervals, attests after ordinal ten finishes, uses `claim.preClaimBaseSha = A00`, obtains K01/B1 from the synthetic graph node whose sole parent is A00 and whose tree is `tree-k01`, uses `claimIntegrationSha = workerBaseSha = B1`, binds the claim digest, and has W/I tree equality.

### Completion predicates and closed-loop ownership

C02 owns `TaskCompletionPolicyV1`, completion predicate identities, acceptance-dependent edge contracts, and vectors. C08 owns projections/joins proving successful receipts do not release canonical-change edges. C10 owns admission/resolver/dispatch race and restart matrices proving no ForkPin, binding, launch intent, or dispatch occurs before durable `DeltaAcceptedV1`. C21 security/system suites cover rejected, conflicted, quarantined, approval-required, unevaluated, approval-revoked, duplicate callback, crash-before-accept, crash-after-accept, and replay.

C12 SDK/SPI ownership explicitly includes `WorkerReturnV1`: artifact/evidence publication, receipt submission, proposal sealing/submission, decision subscription/resume, and decision surfacing. C15–C18 native smoke acceptance each must originate this entire return path through the real native bundle and prove one accepted canonical advance plus surfaced rejection, conflict, quarantine, and approval-required outcomes. Harness synthesis is forbidden. C24's four packed exact-public host loops each create an acceptance-dependent upstream task and dependent task, prove no dependent pin/dispatch for all pending/nonaccepted states across daemon and host restarts, then accept through the native contribution, reconstruct from the new canonical tuple, dispatch the dependent, and surface the result in that host.

### Coordinator API, CLI, and security closure

C03 freezes exhaustive JSON-RPC mappings for the full `CommandAuthorizationMatrixV1`; omitted methods are denied. C12 SDK exposes the same typed coordinator and worker surfaces without adapter authority escalation. C14 CLI ownership and acceptance expand to public workspace/run/DAG/task/dependency/fork/context/dispatch/artifact/receipt/proposal/admission/history/join/status commands. Its smoke starts from a fresh authenticated daemon and drives a complete accepted and rejected loop exclusively through the packed CLI entry point. C20's one-command installer acceptance continues from install into that public coordinator smoke without internal calls.

C11 feasibility records, and C15–C18 enforce, host-native credential storage, least-privilege attempt grants, output/evidence size and media bounds, path/realpath confinement, redaction, decision-subscription resume semantics, duplicate callback idempotency, uninstall credential revocation, and explicit failure when a host cannot provide the required native return loop. C21 includes malicious adapter attempts to cross workspace/task/generation, substitute receipt/proposal/evidence/binding, reuse revoked grants, follow symlinks, escape artifact roots, or synthesize admission. C22–C25 signed side-effect envelopes use the same trust lookup plus their stricter release delegation and external-effect journal rules.

### Definitive review log

All blocker/high findings in `local://plan-definitive-findings.json` are resolved: live A00/K01 authentication and ancestry, canonical time/symlink/index/trusted-time checks, isolated fixture verification, corrected receipt provenance/chronology, non-cyclic Ed25519 receipt envelopes and trust vectors, acceptance-gated task completion across races/restarts/hosts, native worker-return loops, exhaustive main-agent control surfaces, aligned `main` branch release identity, and remaining adapter/security closure.

## C01 live-graph correction v4

This versioned correction supersedes only conflicting C01 bootstrap-copy, live-claim, candidate-path, and completion statements above. It does not alter the historical C00 receipt or assert that corrected bytes were present in W00/A00. C01 remains `in-progress` until a new integrated, signed A01 proves this contract.

### Candidate and attestation graph

All C01 acceptance commands execute with the candidate integration or later attestation commit checked out; `HEAD` is therefore an upper graph bound, not an assertion that `HEAD = K01`. A live verifier MUST identify K01 from immutable Git objects by locating the unique ancestor transition whose parent is the claim's `preClaimBaseSha`, whose commit introduces the exact canonical `docs/claims/C01/1.json` blob and matching appended `docs/claims/index.jsonl` blob, and whose tree contains the exact claim/index/ledger bytes. It MUST then prove `A00 -> K01 -> W01 -> I01 -> HEAD`, K01 has sole parent A00, `claimIntegrationSha = workerBaseSha = K01`, W/I tree equality, and the candidate/attestation ancestry required by the signed receipt. Zero or multiple matching K01 commits fails closed. The claim command continues to receive `--integrated-head HEAD`; it derives and verifies K01 and MUST NOT treat that argument as K01.

For C01 generation 1, the canonical K01 Markdown ledgers predate v4 and do not contain literal `claimIntegrationSha` or `workerBaseSha` fields. The live verifier MUST NOT search for those absent fields or mutate historical K01 bytes. It derives both values from the unique qualifying K01 commit identity after enforcing the exact four-path transition, sole parent, newly introduced canonical claim, single canonical index append, and claim-bound subject/global ledger content. Later candidate and receipt validation binds that derived K01 identity as `claimIntegrationSha` and `workerBaseSha`.

Live verification binds every asserted file to immutable Git tree entries and blob bytes at the derived commits, not mutable working-tree bytes. Working-tree reads are permitted only to load the verifier executable and arguments; claim, index, ledger, trust, receipt, and candidate evidence is compared to the selected Git blobs.

### Universal C00 gate executable

`docs/validation/c00-contract-gate.node-e.txt` is the versioned planning validation source. `scripts/c00-contract-gate.mjs` is a C01-owned universal executable implementation of that contract; it need not be byte-for-byte identical to the historical Node `-e` text. C01 acceptance verifies the executable's declared contract version and the corrected digest manifest, then runs both the Node `-e` source and the named `.mjs` executable. This correction updates the planning program digest prospectively and does not rewrite, replace, or reinterpret C00's signed A00 evidence.

### Exact C01 write accounting

K01 owns only `docs/claims/C01/1.json`, its single append to `docs/claims/index.jsonl`, and the claim-state updates to `docs/progress/C01.md` and `docs/progress.md`. W01/I01 candidate authorization remains the exact C01 source/config path set already sealed by the claim. Attestation A01 owns only `docs/progress/C01.md`, `docs/progress.md`, `docs/checkpoints/C01/final/1.json`, and the single append to `docs/checkpoints/index.jsonl`. Claim and attestation records are not candidate source changes. Install-created or ignored outputs, including `node_modules/**`, caches, logs, and unsealed evidence transcripts, are never retroactively authorized; they must be removed from the candidate tree and are not C01 deliverables.

### Corrected effective C01 acceptance prefix

The former byte-equality command and stale `v4:C01` label are void. The authoritative C01 acceptance version is `C01_ACCEPTANCE_VERSION = "v4:C01-remediation"`, and the complete effective list is exactly twelve commands: (1) `node scripts/acceptance.mjs verify-manifest --subject C01 --version v4:C01-remediation`; (2) `node -e "$(cat docs/validation/c00-contract-gate.node-e.txt)"`; (3) `node scripts/c00-contract-gate.mjs`; (4) `node scripts/progress-cas.mjs verify-live-bootstrap --receipt docs/checkpoints/C00/bootstrap/0.json --checkpoint-index docs/checkpoints/index.jsonl --trust docs/checkpoints/trust.json --integrated-head HEAD --strict`; (5) `node scripts/progress-cas.mjs verify-live-remediation-claim --claim docs/claims/R001/1.json --original-claim docs/claims/C01/1.json --claim-index docs/claims/index.jsonl --finding docs/findings/F001.json --finding-index docs/findings/index.jsonl --checkpoint-index docs/checkpoints/index.jsonl --trust docs/checkpoints/trust.json --now 2026-08-11T17:30:00Z --integrated-head HEAD --strict`; (6) `node scripts/progress-cas.mjs verify-fixture-bundle --bundle docs/checkpoints/fixtures/c01-bundle-v1 --strict`; (7) `corepack pnpm install --frozen-lockfile`; (8) `corepack pnpm run docs:lint`; (9) `corepack pnpm run typecheck`; (10) `corepack pnpm run lint`; (11) `corepack pnpm run test`; (12) `corepack pnpm run boundaries:check`. Receipt verification requires byte-for-byte command equality in this order; no other version label or command substitution is valid.

## Formal C01 remediation R001

Finding `F001` is remediated only by generation-1 claim `docs/claims/R001/1.json`. The effective acceptance version is `v4:C01-remediation`. Its twelve-command manifest is the prior `v4:C01` sequence with command 1 using version `v4:C01-remediation`, command 5 replaced by `node scripts/progress-cas.mjs verify-live-remediation-claim --claim docs/claims/R001/1.json --original-claim docs/claims/C01/1.json --claim-index docs/claims/index.jsonl --finding docs/findings/F001.json --finding-index docs/findings/index.jsonl --checkpoint-index docs/checkpoints/index.jsonl --trust docs/checkpoints/trust.json --now 2026-08-11T17:30:00Z --integrated-head HEAD --strict`, and all other commands unchanged.

The remediation verifier derives the exact seven-path F001/R001 claim transition from immutable Git objects, preserves the unique historical K01 transition as C01 provenance, and authorizes candidate changes only against R001's sealed allowlist. K01 claim-transaction paths and all four A01 paths remain excluded from candidate authorization. Receipt and resume verification require `--remediation-claim docs/claims/R001/1.json`; A01 MUST have exactly one parent and that parent MUST equal the sealed remediation candidate integration commit.

## Formal verifier remediation R002

R002 preserves the immutable A01 receipt, checkpoint index, and completion ledgers as historical evidence. Live resume derives the unique A01 commit from the reachable Git graph rather than treating the supplied later head as A01. The derived A01 commit MUST be the sole child transaction of candidate integration `7e9d9b3ccfb90ecd908e6913acc9fe632fd12abc`: it has exactly that one parent, changes exactly `docs/checkpoints/C01/final/1.json`, `docs/checkpoints/index.jsonl`, `docs/progress/C01.md`, and `docs/progress.md`, introduces the receipt as a new regular Git blob, appends exactly one checkpoint-index record, and contains mutually consistent completed C01/global ledgers. Its immutable receipt MUST pass envelope/core/signature/trust/digest checks, exact `C01_ACCEPTANCE_VERSION` and twelve-command equality, C01 claim binding, candidate tree/ancestry, and historical K01 plus R001 provenance.

When `--integrated-head` is later than A01, resume MUST derive the unique generation-1 R002 claim transaction whose sole parent is A01. That transaction changes exactly `docs/claims/R002/1.json`, `docs/claims/index.jsonl`, `docs/findings/F002.json`, `docs/findings/index.jsonl`, `docs/progress/R002.md`, `docs/progress/C01.md`, and `docs/progress.md`; introduces the R002 claim; appends exactly one claim-index record; binds F002 and the immutable C01 receipt; and freezes candidate ownership to exactly `docs/plan.md` and `scripts/progress-cas.mjs`. The supplied later head MUST descend from that claim transaction and its complete diff from the R002 claim commit MUST equal those two allowed paths. Receipt, index, and completion evidence are never rewritten, and C02 remains ineligible during R002.

## Post-C01 development workflow correction

This section supersedes every earlier repository-development claim, attestation, P/R/V, stale-evidence, and per-chunk checkpoint requirement for C02 and later. It does not supersede product runtime evidence contracts, release signing, installer trust, or external-effect journals.

The C00 bootstrap and C01 `v4:C01-remediation` claim/remediation/receipt graph is closed historical evidence. `F001` and `F002` are closed; `R001` and `R002` are complete. The existing C00/C01 claim, finding, trust, receipt, and index files remain immutable. Focused verification authenticates them from Git history, including the unique K01, R001, candidate, and A01 transitions. A later `HEAD` is only an ancestry upper bound; it does not need to be an R002 candidate and no additional receipt is produced.

For every C02–C25 chunk, the exact sequence is:

1. Commit `chore(progress): claim <ID>` with only `docs/progress.md` and `docs/progress/<ID>.md`; record status `in-progress`, dependency completion, base commit, exact owned paths, and the literal acceptance commands from this plan.
2. Commit implementation within those paths. Review may produce ordinary fix commits. Each failure and disposition is recorded in the chunk ledger without allocating F/P/R/V graph nodes.
3. Run the literal ordered acceptance commands at the final candidate. All must exit zero; CI must agree where configured. Record command, environment, exit, and durable CI URL or local output digest in the ledger. This evidence is not a signed per-chunk repository receipt.
4. Commit `chore(progress): complete <ID>` with only the two tracker files; record final candidate commit, green gates, completed review findings, and next eligible chunk.

Dependencies after C01 are satisfied by the integrated tracker completion state and Git ancestry. `docs/claims/**`, `docs/checkpoints/**`, and their indexes are not generic development outputs after C01. C22–C25 still create the product/release side-effect evidence explicitly required by their delivery contracts; those records authenticate external publication effects and are not development-claim closure machinery.