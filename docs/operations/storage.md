# Storage operations

C06 treats the SQLite database and content-addressed artifact root as one authority unit.

## Upgrade and startup recovery

Open the C05 authority, run `upgradeAuthority`, and only then serve requests. Upgrade authenticates every raw event envelope and complete hash chain and verifies every catalogued artifact before applying schema 0002. Unknown newer schemas fail with a major-version gate. At startup, call `recoverInterruptedRestore` before opening SQLite, then `resumeRetention` after upgrade. Both operations are idempotent.

## Backup and restore

`createBackup` first verifies the live authority, creates a consistent SQLite image with `VACUUM INTO`, copies artifacts, and emits `HorsenessBackupManifestV1`. The manifest binds the authority schema version, database byte length and SHA-256 digest, and every artifact path, length, and digest.

`restoreBackup` verifies the manifest, stages both units, runs SQLite integrity, foreign-key, raw replay, stream-head, and artifact checks against the staged unit, records a durable restore intent, and atomically swaps both paths. A failed swap rolls back. Startup recovery rolls an interrupted swap back before the database is opened.

## Import and compatibility

`importBackup` copies a verified backup into an isolated temporary authority. It validates schema version, raw chains, artifacts, and workspace identities before touching the destination. Existing workspace identities and artifact-content conflicts fail closed. The merge is a single SQLite transaction; staged files can only become unreferenced orphans if the SQL transaction fails and are safe to collect later.

Export preserves the stored schema. Import requires an exact schema match. `requireLosslessDowngrade` permits a version-2 to version-1 downgrade only when the retention ledger is empty; every lossy or unknown downgrade returns an explicit major-version gate.

## Retention

`planRetention` takes an immediate transaction, proves an artifact has no references or pins, and writes a durable, idempotent intent. `resumeRetention` rechecks reference accounting, removes the object, then atomically deletes its catalog row and commits a durable tombstone. A crash before the final transaction leaves a pending intent and is safely resumed. Reappearing references, missing catalog records, dangling files, and corrupt referenced content fail closed.
