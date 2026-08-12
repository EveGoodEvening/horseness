---
"@horseness/store-sqlite": minor
---

Add the migration-0001 SQLite event authority and crash-safe content-addressed artifact store.

Artifact garbage collection is intentionally deferred to C06: no destructive collector ships until the durable tombstone protocol can make deletion race-safe.
