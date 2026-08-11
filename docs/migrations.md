# Storage migrations

## SQLite migration 0001 — initial authority

Migration 0001 creates the append-only workspace and run event streams, command and idempotency deduplication, projection/snapshot metadata, and content-addressed artifact reference and pin ledgers. The store enables foreign keys, WAL journaling, and `synchronous=FULL`. Migration identity is recorded in `schema_migrations`; reopening is idempotent and a conflicting version/name pair fails closed.

Event writes use `BEGIN IMMEDIATE` and compare both expected sequence and envelope hash. A command identifier is bound to a canonical request digest; exact retries return the recorded result, while identifier reuse with different input is rejected. Dual workspace/run appends and their dedup result commit together.

Artifacts are staged with mode `0600`, fully written, file-fsynced, atomically renamed into their SHA-256 object path, and parent-directory-fsynced before a SQL reference may be registered. Reads verify the digest and recorded length. Missing, corrupt, or unknown referenced objects fail closed. References and pins protect objects from orphan collection; startup removes abandoned staging files.

This migration has no downgrade. Backup, restore, import, upgrade, and retention procedures are introduced by C06; until then, preserve the database and artifact directory as one authority unit.
