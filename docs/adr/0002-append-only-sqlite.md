# ADR 0002: Append-only SQLite authority

## Status
Accepted for C00 freeze.

## Decision
SQLite WAL stores append-only workspace and run event streams. Raw envelope chains are verified before upcasting. Transactions validate typed absent-genesis, workspace-only, run-only, or full composite observation cursors and return the corresponding typed result cursor. Projections and snapshots are disposable.

## Consequences
Recovery is deterministic; migrations, backups, artifact publication, and corruption handling fail closed.
