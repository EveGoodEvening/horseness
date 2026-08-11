# ADR 0005: Transactional installation ownership

## Status
Accepted for C00 freeze.

## Decision
Only the installer mutates host installation targets. A scope-local append-only journal records consent, selected workspace, owned bytes, discovery registrations, credentials, migrations, compensation, kill switch, and revocation state. The guarantee assumes the daemon/installer trust base and OS-user boundary; arbitrary same-user process compromise is outside v1.

## Consequences
Install, upgrade, rollback, repair, and uninstall are resumable, drift-aware, and independently auditable for every host.
