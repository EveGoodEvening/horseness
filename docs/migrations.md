# Storage migrations

## SQLite migration 0001 — initial authority

Migration 0001 creates the append-only workspace and run event streams, workspace- and run-scoped command deduplication, an authority-consumption ledger, projection/snapshot metadata, and content-addressed artifact reference and pin ledgers. The complete migration, including its ledger record, commits in one transaction and reopening is idempotent. Before enabling foreign keys, changing journal or synchronous mode, or beginning a write transaction, the migrator reads the existing migration ledger and rejects unknown versions newer than the implementation supports. Version 1 with a conflicting name also fails closed.

Every command-dedup identity is `(workspace_id, scope_kind, scope_id, command_id)`. Workspace-only commands use `scope_kind='workspace'` and `scope_id=workspace_id`; commands addressing a run use `scope_kind='run'` and the run ID. Thus workspace-only behavior is preserved while the same command ID can safely occur in separate runs or workspaces. The authority-consumption ledger uses the same explicit scope plus `(principal_id, authority_key)`, records the consuming command, and treats an exact retry as idempotent while rejecting reuse by another command.

Event writes use `BEGIN IMMEDIATE` and compare both expected sequence and envelope hash. The scoped command-dedup lookup occurs after the write lock is acquired. A command identifier is bound, within its scope, to a canonical request digest; exact concurrent or later retries return the originally committed result, while identifier reuse with different input is rejected. Dual workspace/run appends and their run-scoped dedup result commit together.

Run creation is a distinct append operation, not an ordinary run append at sequence zero. Its `AbsentRunGenesisCursorV1` carries the observed workspace sequence, envelope hash, and context epoch plus `expectedRunHead: "absent"`. After acquiring the same `BEGIN IMMEDIATE` write lock used for event appends, the authority authenticates the complete workspace chain, compares all three observed workspace fields, and proves that no stream, event, snapshot, projection, run-scoped command-dedup row, or run-scoped authority-consumption record exists for the run ID. Only then does it append exactly one `RunCreatedV1` genesis and commit its run-scoped command-dedup result. A retry is accepted only when that dedup result is accompanied by the created run stream; an orphan dedup row fails closed. Workspace-scoped dedup and authority-consumption rows do not falsely make a run present. Missing workspaces, stale or substituted observations, pre-existing run authority state, and attempts to send run genesis through the ordinary append or artifact-publication paths fail closed.

Both decoded and raw replay authenticate before returning data. Authentication parses every stored envelope, checks its workspace/stream identity and redundant row sequence, prior hash, and envelope hash, verifies the complete hash chain from genesis, and proves that its final event equals the stored stream head. A partial replay still authenticates the preceding chain and current stored head, so range selection cannot hide earlier or later corruption.

Artifacts are staged with mode `0600`, fully written, file-fsynced, atomically renamed into their SHA-256 object path, and parent-directory-fsynced before a SQL reference may be registered. Reads verify the digest and recorded length. Missing, corrupt, or unknown referenced objects fail closed. References and pins protect objects from orphan collection; startup removes abandoned staging files.

This migration has no downgrade. Backup, restore, import, upgrade, and retention procedures are introduced by C06; until then, preserve the database and artifact directory as one authority unit.

## SQLite migration 0002 — recovery and retention

Migration 0002 adds a durable retention state machine (`pending` → `deleting` → `deleted`), artifact tombstones, and database triggers that reject new references or pins as soon as an intent exists. The authoritative migration ledger recognizes only the exact ordered identities `0001_initial_authority`, `0002_retention_recovery`. Fresh authorities install both migrations, and exact-v2 authorities reopen idempotently. An existing v1 authority cannot be upgraded by the constructor or the generic migrator: callers must use `SQLiteAuthority.open(databasePath, artifactRoot)` (or the explicit `upgradeAuthority` primitive when they already own the database handle). The factory first resolves any interrupted restore for the authority pair, inspects the ledger without mutable PRAGMAs, authenticates full raw and semantic replay plus every referenced or pinned artifact with `verifyAuthority()`, and only then applies 0002 transactionally. Verification failure leaves the v2 ledger entry and schema absent. Gaps, reordered or conflicting identities, and future versions fail before mutable PRAGMAs or schema writes.

Storage schema v2 has no in-place downgrade to v1. `requireLosslessDowngrade` always returns an explicit major-version gate for a v2→v1 request, even when the retention ledger is empty; a real downgrade requires a separately implemented and verified authority-unit migration. Backup manifests record the authority schema version, and isolated imports require exact schema equality.

## Installer journal migration train

C19 freezes `horseness.installer-journal-record.v1` and an authenticated N-1 reader for v0. A reader validates the exact raw schema, domain-separated record hash, generation, sequence, and previous-record hash before it constructs the v1 payload. Unknown newer journal or installer-state schemas refuse before any state or journal mutation.

Each migration generation proceeds through durable `begun`, `backup-created`, `staged`, activation, and `complete` transitions. The engine writes owner-only temporary files, file-fsyncs them, atomically renames them, and fsyncs their parent directories. Active-home replacement is staged beneath the same private authority root. A backup is complete and durable before transformation starts. Crash fixtures cover every boundary after begin, backup, staged-tree fsync, activation rename, activation directory fsync, and compensation.

Restart recovery never guesses that a migration completed. It authenticates installer state, restores a confined durable backup for every interrupted nonterminal phase, and records `compensated`; absent or unusable recovery evidence becomes explicit `repair-required`. Failed transforms compensate without losing the prior home. Uninstall requested after an upgrade is represented by durable `uninstall-pending` and `uninstalled` journal transitions; C19 does not perform host mutation.

Downgrade is permitted only through a declared reversible plan. Crossing a semantic major version additionally requires the explicit major-version gate; otherwise the engine refuses while retaining the backup. The non-public signed `0.0.0-compat.1` fixture is the C19 N-1 source for deterministic migration initiation.

## C20 operation recovery

C20 operation writes reuse the authenticated C19 journal and migration authority. Contribution bytes are file-fsynced into a private staging tree, the tree is activated by same-filesystem rename, and the parent directory and owner marker are made durable before success. Exact retries authenticate marker and byte digests and are idempotent; substitution, unmarked occupancy, or drift refuses.

Upgrade, downgrade, rollback, and retry-install use the same neutral-bundle ownership and staging rules. Downgrades continue to require the C19 reversible-plan and explicit major-version gates. Uninstall recovery follows the durable order kill switch, discovery disable, credential revocation, cleanup. A crash at any boundary resumes from persisted evidence rather than restoring discoverability or re-enabling a revoked contribution.

## C22 release migration handoff

The C22 release manifest and dependency graph bind the exact migration-capable package bytes and coherent train version. The immutable receipt includes their digests and retention reference; C23 and later chunks fetch those bytes rather than ambient build output. A version choice or publication policy is not inferred from the C19 compatibility fixture. Unknown, absent, or inconsistent release version and trust inputs refuse before signing or upload.
