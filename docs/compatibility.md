# Compatibility Contract

## Version axes

Persisted and public contracts version event envelopes, canonical JSON, hashes, policies including `NoPolicyV1`, proposal/delta schemas, `ObservationCursorV1` and `ResultCursorV1` variants, `ForkPinCoreV1`, `DependencyJoinSnapshotCoreV1`, `DeltaAuthorityScopeV1`, `TaskCompletionPolicyV1`, command-authorization matrices, `WorkerReturnV1`, `CheckpointReceiptCoreV1`/signature/envelope/trust stores, context source-view and authorization-overlay fields, context cores and bindings, RPC mappings, SQLite schema, installer journal, native contribution manifests, release manifests, checkpoint/claim/index records, finding/index records, and publication-journal records independently.

## Reader and writer rules

Writers emit only the current supported version. Readers support the documented N-1/N train, reject unknown newer versions without mutation, and upcast only after raw integrity verification. Downgrade is allowed only with a verified reversible migration; otherwise it is major-gated and requires backup/export confirmation.

## Host matrix

Pi, OMP, Claude Code, and Codex native contributions are mandatory. C11 freezes supported host versions and capabilities. Unsupported or managed-blocked hosts are errors; absent hosts are reported no-ops. CLI-only mode does not satisfy native compatibility.

The machine-readable authority is `config/hosts/capability-matrix.v1.json`. Each row binds canonical upstream package identity, exact version, HTTPS registry URL, registry-published SHA-512 integrity, independently computed archive SHA-256, cache key, executable/member SHA-256, and official-validation provenance. A repository fixture, locally authored wrapper, or coordinated manifest-plus-matrix substitution cannot satisfy native provenance. When upstream ships no independent validator artifact, the row honestly records a same-distribution command/interface and its member digest rather than relabelling it as a separate artifact. `HostValidationResultV1` is the stable nine-field result contract.

Hermetic feasibility uses the repository deterministic provider with frozen request/response bytes, clock, budget, identity, disabled network, and disabled credentials. Real upstream binaries/plugins execute through `HostSandboxLifecycleV1`; successful phase observations, not declarations, derive matrix capability booleans. Path escape, symlink substitution, archive/member tamper, and undeclared output fail closed. Credentialed-live checks are separate: local execution may report `LIVE_CREDENTIAL_ABSENT` only when the allowlisted opaque reference is absent and publication is not required. Once configured, every credential, provenance, redaction, budget, timeout, or host failure is fatal; publication-required evidence never skips.

## Release train

The first public train contains fourteen npm packages: eight core packages, daemon, CLI, and four adapters. npm registry integrity and npm-generated provenance bind each immutable package version; C24 verifies exact public packages before C25 moves `latest`.
C22 establishes `1.0.0` under MIT for those fourteen packages. Public manifests use exact `workspace:1.0.0` internal source pins, and packed manifests contain exact `1.0.0` dependencies. `@horseness/bootstrap` remains private `0.0.0`; self-contained bootstrap binaries, offline archives, custom signatures, trust metadata, and compatibility aliases are not part of the first public train.

## Frozen v1 boundary rules

Unknown cursor kinds, fork-pin/snapshot/scope/completion-policy versions, proposal-sealing observation fields, authorization matrices, worker-return methods, receipt core/signature/envelope/trust versions, or index-record versions fail before mutation. Readers never infer a full composite cursor from a workspace-only or run-only value, never substitute current context for a ForkPin source view, never release an acceptance-dependent edge from a receipt alone, and never accept an unnamed persisted `cursor`. The N-1/N train includes canonical golden vectors for all cursor genesis transitions, ForkPin refresh ancestry, dependency snapshots, delta scopes, signed checkpoint/index hashes and trust rotation/revocation, and four-host proposal/decision round trips.

## Domain v1 implementation train

`@horseness/domain` now writes the frozen v1 forms for canonical JSON (`jcs-v1`), SHA-256 domain-separated identities (`sha256-v1`), workspace/run envelopes, every observation/result cursor variant, canonical and operational reducers, proposals/deltas, policy and approval decisions, task completion and dependency release, fork pins, dependency snapshots, delta authority scopes, context manifests/bindings, attempt dispatch and resolution, authorization decisions, attempt receipts, signed checkpoint receipt envelopes, and deterministic replay.

Readers reject unknown schema, cursor, canonicalizer, hash, operation, policy, dispatch, receipt, and authorization variants before mutation. The public compatibility train is the eleven-family vector set under `docs/vectors/{events,cursors,proposal,delta,fork-pin,dependency-join,delta-authority,context-binding,receipt,task-dispatch,authorization}`. Each vector freezes canonical JSON bytes and its domain-separated digest; downstream protocol, policy, storage, orchestration, SDK, and adapter packages consume these identities rather than redefining them.

The domain vectors verifier is repository-only: run it through the root `vectors:verify` script. The former `horseness-vectors-verify` package binary is not published because the authoritative vectors and documentation remain repository-owned.

## Protocol v1 implementation train

`@horseness/protocol` now freezes the exhaustive JSON-RPC 2.0 method registry and omitted-deny authorization matrix for the full coordinator and adapter SPI surface. Runtime readers require exact request fields, protocol version `1`, method-specific observation cursor scope, command idempotency keys, and role authorization before dispatch. Unknown methods, versions, cursor kinds, extra fields, or unauthorized role/method combinations fail closed.

Pagination names `afterObservationCursor` separately from emitted result cursors. Subscription resumption binds subscription ID, after-observation cursor, and opaque resume token. Stable success/error envelopes, local-only transport metadata, domain-owned receipt/proposal mappings, capability detection, provider lifecycle SPI, and `WorkerReturnV1` are public v1 contracts. Generated canonical schemas/manifests and executable vectors are checked byte-for-byte; no v1 reader infers missing cursor scope, transport identity, idempotency, or authority.

## Adapter-kit v1 implementation train

`@horseness/adapter-kit` consumes the protocol-owned adapter SPI rather than defining a competing wire contract. It retains the complete immutable attempt binding across launch, cancel, reconcile, reattach, native resume, and receipt collection; repeated callbacks are idempotent and any workspace, run, task, attempt, generation, ForkPin, manifest, binding, capability, or provider-key substitution fails closed.

Credentials cross the adapter boundary only as versioned opaque references scoped to a workspace, adapter, and purpose. Secure subprocesses use argv arrays without a shell, realpath-confined executable and working-directory roots, an explicit environment allowlist with secret-shaped keys stripped, time limits, byte limits, and deterministic redaction. Install contributions are declarative relative paths and content identities only: adapters expose no install hooks and never write host targets. Doctor results are versioned, exact, read-only records; repair remains a separate installer operation.

The executable adapter conformance suite covers capability detection, lifecycle recovery, immutable binding retention, callback deduplication, credential/reference exclusion, scope rejection, executable/cwd and symlink confinement, bounded/redacted output, declarative install and doctor validation, and a `WorkerReturnV1` artifact/receipt/proposal/decision-resume loop through an SDK-compatible client fake. The repository root `adapter:conformance` command is the focused gate for this contract.

## Pi adapter v1 implementation train

`@horseness/adapter-pi` supports exactly `@mariozechner/pi-coding-agent@0.73.1` and binds the upstream native extension loader member digest. Its shipped contribution and package manifest are immutable, declarative, read-only resources; the adapter does not install into host targets or expose mutation hooks.

The Pi lifecycle is a thin `WorkerAdapterV1` over adapter-kit. It accepts only opaque credential references scoped to the bound workspace, `horseness-pi-v1`, and `pi-provider-auth`; retains the complete immutable attempt binding; and delegates provider launch, cancellation, restart reconciliation, reattachment, native resume, and receipt collection without store, orchestrator, SQLite, shell, scheduling, admission, or proposal-synthesis authority.

The adapter-owned `host:smoke:pi` gate resolves the real installed Pi 0.73.1 package, verifies the frozen loader digest, loads the native contribution through Pi's own loader, exercises deterministic provider output/evidence and binding-valid receipt/proposal delivery through `@horseness/sdk`, resumes all five canonical decision states, proves accepted canonical revision advance, observes restart/reconcile/resume and ForkPin switch, and uninstalls the contribution. C11 registry integrity, archive SHA-256, member SHA-256, cache revalidation, and official-interface provenance remain mandatory and unchanged.

## OMP adapter v1 implementation train

OMP support is pinned to `@oh-my-pi/pi-coding-agent@17.2.15` and its same-distribution Bun extension loader (`src/extensibility/extensions/loader.ts`, SHA-256 `c0076ad052d435ee1075abfa0682e83ad4a075a1415c720bbbdf71d9affcc48f`). The smoke executes that interface only from the C11 digest-verified archive copied into an isolated work root with offline-installed dependencies. The shipped native contribution uses OMP `registerTool`, `registerCommand`, `before_agent_start`, `agent_start`, and exact 17.2.15 session event fields; Pi names, paths, and lifecycle assumptions are not compatibility aliases.

The `host:smoke:omp` gate proves attempt-scoped immutable context injection and the complete native-origin `WorkerReturnV1` path through the real loaded extension, durable tuple-bound cross-instance deduplication, resumable decision-subscription checkpoints, all five authority outcomes, accepted canonical advance, restart/reconcile/reattach/resume, real branch lifecycle signaling, and uninstall as contribution removal plus loader rediscovery and trusted runtime credential revocation. `session_shutdown` is ordinary teardown because OMP 17.2.15 exposes no uninstall reason.

## Claude Code adapter v1 implementation train

Claude Code support is pinned to the verified `@anthropic-ai/claude-code-linux-x64@2.1.228` distribution and executable SHA-256 `d535985e6941a3eb00179ccd7f52ceb0c6623a0305a518ebc4e6514f84a94c99`. Its live gate uses only the invoking OS user's already logged-in native subscription session under ADR 0006. Horseness never reads, copies, hashes, logs, exports, or persists Claude authentication material, and an absent or unusable session fails with a stable redacted reason.

The `host:smoke:claude` gate leaves the invoking user's native Claude config and authentication store untouched. It isolates only the workspace, exact temporary plugin bytes, MCP retained/runtime state, HOME-neutral outputs, and temporary files. One initial real Claude session discovers the copied plugin through `--plugin-dir` and makes one namespaced native MCP call carrying an exact batch of five distinct capability references. The trusted MCP/runtime executes five complete authority-backed `WorkerReturnV1` paths, but its strictly bounded 8 KiB response exposes only nonsecret per-scenario binding identifiers, decisions, receipt/proposal/output/evidence digests, and the accepted canonical revision/state digest. The smoke checks those returned digests against retained authority and local canonical state, records a digest of the compact batch response in its live receipt, and never synthesizes authority outcomes or canonical state. Minimal real resume and fork-session marker invocations prove durable SessionStart mapping and immutable pre-registered branch transition without additional worker calls. Uninstall persists its kill switch, disables the temporary discovery path, revokes the Horseness grant, rejects the cached capability, and restarts the native binary without the plugin; it never logs out or alters the provider session.

## Codex adapter v1 implementation train

Codex support is pinned to the digest-verified `@openai/codex@0.144.1-linux-x64` archive and executable SHA-256 `a96f944d1a596dbfb7fdd84f482be5c50e34b04bb371126840d873e4ebf26902`. Its deterministic shipped plugin manifest, MCP declaration, context contribution, skill, and MCP server are independently hashed. The temporary native marketplace copy uses SemVer build metadata derived from the shipped contribution package digest to give Codex a cache-unique plugin version while preserving the stable `horseness-codex@horseness-c18` ID; the resulting installed bytes and installed package digest are independently verified and receipted. The pinned `.mcp.json` uses plugin-root-relative `cwd: "."`, a relative server argument, and an exact three-variable Horseness runtime allowlist. No per-thread `config.mcp_servers` override is used; native inventory must expose the Horseness server/tool, and the completed `mcpToolCall.pluginId` must identify `horseness-codex@horseness-c18`.

The live gate uses ADR 0006's invoking-user subscription session without inspecting or mutating provider authentication state. App-server processes receive only verified runtime paths, required native session homes, locale, bounded temp paths, reviewed nonsecret controls, and the active Horseness claim variables; secret-shaped, provider API key, cloud/CI credential, and proxy variables are stripped. Fresh processes carry the initial, resume, and fork claims before plugin MCP startup. Structured plugin mention plus skill input selects the installed contribution, a real model-native batch originates five durable tuple-bound `WorkerReturnV1` deliveries, and crash-injected uninstall removes plugin/marketplace discovery before authority revocation.

## Installer journal and trust implementation train

`@horseness/installer` writes the exact `horseness.installer-journal-record.v1`, `horseness.installer-state.v1`, `horseness.release-manifest.v1`, `horseness.signed-release-manifest.v1`, `horseness.project-trust-root.v1`, and `horseness.install-consent.v1` forms. Journal readers support v0/v1, authenticate raw record bytes and the complete generation hash chain before upcast, and refuse unknown newer journal or state schemas before mutation.

Migration generations durably record backup, staged-tree, activation, compensation, repair-required, and uninstall-after-upgrade transitions. Backups and staging are confined to an owner-private authority root and use write/fsync/rename/directory-fsync publication. The crash matrix freezes recovery at every publication boundary. Downgrades require a reversible migration and cross-major downgrades additionally require an explicit gate.

The deferred signed-bundle verifier implements Ed25519 project-root delegation, release signatures, anti-replay sequence/version state, rotation windows and revocation, exact artifact/dependency-graph digests, and Sigstore identity checks for repository fixture/system validation. Lifecycle scripts, wrong identity, wrong key, replay, and tamper fail closed. ADR 0009 does not publish that bootstrap trust path in `1.0.0`; it preserves the runtime/test invariant for a future distribution design.

The frozen non-public `0.0.0-compat.1` train reproducibly packs prior database, journal, daemon, CLI, and installer behavior sufficient to initiate migration. Offline build and verify commands bind its source digest, artifact digest, release-manifest digest, dependency graph, and fixture project-root signing provenance.

## Daemon v1 implementation train

`@horseness/daemon` serves the local authority through versioned stdio, Unix-domain socket, and Windows named-pipe endpoints. Stdio is process-inherited; filesystem endpoints require an owner-only parent and endpoint. TCP is not a v1 transport and remains disabled by default. Transport implementations authenticate peers and frame newline-delimited JSON-RPC 2.0 messages, while daemon services alone own bootstrap, grants, dispatch, and authority mutations.

The first-authority ceremony uses a single-use bootstrap capability stored as an owner-only `0o600` file beneath an owner-only `0o700` directory. Its v1 payload binds the workspace identity and local OS account. Consumption verifies that binding, atomically appends workspace genesis and the initial grant through the authority compare-and-swap boundary, and removes the capability; concurrent, substituted-user, or already-consumed attempts fail closed.

The v1 grant lookup contract returns authenticated principal, role, grant digest, workspace/run/task scope, allowed methods, expiry, and revocation state from authoritative SQLite projections. Restarts and restored workspaces must rebind the local authority credential and endpoint identity before serving requests.

C13 CI receipts use `horseness.os-receipt.v1`. Each Linux, macOS, and Windows receipt binds the exact candidate commit SHA and records successful focused typecheck and daemon multiprocess gates. Receipt aggregation rejects absent platforms, duplicate or unexpected fields, candidate substitution, reordered or missing gates, and any status other than `passed`; local fixture inputs are accepted only when an explicit candidate SHA environment override matches them.

## Policy v1 implementation train

`@horseness/policy` writes immutable `PolicyDocumentV1` values addressed by the domain-separated `horseness.policy.v1` digest and strict `PolicyReferenceStateV1` lifecycle values. `NoPolicyV1` and `NO_POLICY_DIGEST` are the only neutral representation; policy references and pinned/current policy slots are never nullable. Readers reject unknown versions, kinds, effects, extra fields, malformed lineage, duplicate or noncanonical rule/evidence identifiers, substituted document digests, noncanonical JSON Pointers, and noncanonical UTF-8 ordering.

Admission is a pure v1 function over a canonical UTC-second authority time and explicit composite observation cursors. It independently evaluates the concrete pinned and current slots and deterministically conjoins every result, constraint, and explanation. Path scopes use domain JSON Pointer token containment, including root. Approval compatibility binds the proposal author, a distinct authenticated approver, both policy digests, proposal/base tuple, action, grant digest, exact issue snapshot, exact evaluation snapshot, cursor ordering, and nonempty `[issuedAt, expiresAt)` validity; no v1 reader carries an approval across identity, policy, grant, proposal, base, issue-snapshot, or evaluation-snapshot substitution.
