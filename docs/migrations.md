# Storage migrations

## SQLite migration 0001 — initial authority

Migration 0001 creates the append-only workspace and run event streams, command and idempotency deduplication, projection/snapshot metadata, and content-addressed artifact reference and pin ledgers. The complete migration, including its ledger record, commits in one transaction and reopening is idempotent. Before enabling foreign keys, changing journal or synchronous mode, or beginning a write transaction, the migrator reads the existing migration ledger and rejects unknown versions newer than the implementation supports. Version 1 with a conflicting name also fails closed.

`workspace_id` is part of every stream, event, snapshot, projection, and command-dedup identity, key, lookup, and applicable foreign key. Consequently identical run IDs, event IDs, idempotency keys, and command IDs may safely exist in different workspaces without sharing heads, results, snapshots, or projections.

Event writes use `BEGIN IMMEDIATE` and compare both expected sequence and envelope hash. The command-dedup lookup occurs after the write lock is acquired. A command identifier is bound, within its workspace, to a canonical request digest; exact concurrent or later retries return the originally committed result, while identifier reuse with different input is rejected. Dual workspace/run appends and their dedup result commit together.

Run creation is a distinct append operation, not an ordinary run append at sequence zero. Its `AbsentRunGenesisCursorV1` carries the observed workspace sequence, envelope hash, and context epoch plus `expectedRunHead: "absent"`. After acquiring the same `BEGIN IMMEDIATE` write lock used for event appends, the authority authenticates the complete workspace chain, compares all three observed workspace fields, and proves that no stream, event, snapshot, or projection authority state exists for the run ID. Only then does it append exactly one `RunCreatedV1` genesis and commit its command-dedup result. Missing workspaces, stale or substituted observations, pre-existing run authority state, and attempts to send run genesis through the ordinary append path fail closed without mutation.

Both decoded and raw replay authenticate before returning data. Authentication parses every stored envelope, checks its workspace/stream identity and redundant row sequence, prior hash, and envelope hash, verifies the complete hash chain from genesis, and proves that its final event equals the stored stream head. A partial replay still authenticates the preceding chain and current stored head, so range selection cannot hide earlier or later corruption.

Artifacts are staged with mode `0600`, fully written, file-fsynced, atomically renamed into their SHA-256 object path, and parent-directory-fsynced before a SQL reference may be registered. Reads verify the digest and recorded length. Missing, corrupt, or unknown referenced objects fail closed. References and pins protect objects from orphan collection; startup removes abandoned staging files.

This migration has no downgrade. Backup, restore, import, upgrade, and retention procedures are introduced by C06; until then, preserve the database and artifact directory as one authority unit.
