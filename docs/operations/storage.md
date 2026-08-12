# Storage operations

C06 treats the SQLite database and content-addressed artifact root as one authority unit.

## Upgrade and startup recovery

Open the C05 authority, run `upgradeAuthority`, and only then serve requests. Upgrade authenticates every raw event envelope, every duplicated SQL event identity column, its enclosing workspace/stream identity, complete hash chains, and every catalogued artifact before applying schema 0002. Transplanted rows and unknown newer schemas fail closed. At startup, call `recoverInterruptedRestore` before opening SQLite, then `resumeRetention` after upgrade. Both operations are idempotent.

## Backup and restore

`createBackup` first verifies the live authority, creates a consistent SQLite image with `VACUUM INTO`, and emits the exact `HorsenessBackupManifestV1` runtime shape. Members live only below the fixed portable roots `db/authority.sqlite` and `artifacts/`; absolute paths, empty/`.`/`..` segments, backslashes, duplicate names, symlinks, and special files are rejected. Verification uses containment-safe, no-follow reads and requires the manifest member set to equal both the backup directory contents and the SQLite artifact catalog, including every byte length and SHA-256 digest.

`restoreBackup` treats SQLite and the artifact root as one authority unit. It verifies the untrusted manifest, stages and fsyncs both units, and runs SQLite integrity, foreign-key, raw replay, stream-head, and artifact checks before changing live paths. A fsynced `HorsenessRestoreJournalV1` advances through `staged`, `old-moved`, `database-activated`, `artifacts-activated`, and `committed`; every journal replacement and authority rename is followed by a parent-directory fsync.

At startup, `recoverInterruptedRestore` reads that journal before SQLite is opened. Any interruption before the durable `committed` marker deterministically restores both old paths (or restores their joint absence); an interruption after it deterministically activates both staged paths. Recovery verifies the final database/artifact pair before deleting either old generation, and its rename/removal cleanup is idempotent. Operators must never move, copy, or delete only one live unit and must retain the journal and all `.old-*`/`.restore-*` siblings until recovery completes.

## Import and compatibility

`importBackup` treats every foreign backup as untrusted. After strict manifest, schema, chain, catalog, and artifact verification, it allocates a new local quarantine namespace adjacent to—but outside—the live artifact root. It copies the database and artifacts only into that namespace and records immutable provenance plus a unique source-workspace-to-local-workspace mapping. It never attaches the foreign database to the live database, copies foreign rows into live tables, or publishes foreign artifact bytes under the live root. Consequently normal authority APIs cannot observe quarantined data.

`promoteImportedBackup` is the only quarantine state transition. It re-verifies the complete quarantined database/artifact authority unit and requires a non-empty reviewer identity and review-evidence reference before atomically replacing the provenance record with `promoted`. Promotion does not rewrite authenticated foreign event envelopes or silently merge identities into an existing live authority; a higher-level reviewed migration must consume the immutable mapping if promoted data is to become a new live authority. Export preserves the stored schema and import requires an exact schema match. Storage schema v2 cannot be downgraded to v1 in place: every v2→v1 request receives an explicit major-version gate.

## Retention

`planRetention` acquires `BEGIN IMMEDIATE` before its final reference/pin check, then commits a durable `pending` intent. Database triggers prevent concurrent writers from adding a reference or pin for any digest under retention. `resumeRetention` takes the writer lock again, rechecks eligibility, removes the artifact catalog row, and compare-and-swaps the intent to durable `deleting` before touching bytes. Only then may it unlink the object; it fsyncs the containing directory and atomically commits the tombstone plus `deleted` state. Recovery resumes either side of the unlink idempotently. Foreign keys plus the retention triggers ensure no live reference can reappear after deletion eligibility commits, so no live reference can point to missing bytes.
