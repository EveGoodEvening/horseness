# ADR 0004: Authorized local daemon

## Status
Accepted for C00 freeze.

## Decision
The daemon uses permission-restricted local transports, authenticated OS identity, `CommandAuthorizationMatrixV1`, scoped/revocable workspace grants, and one-time first-authority bootstrap. TCP is disabled by default. Secrets are opaque references; current authorization observation is distinct from a ForkPin source view.

## Consequences
Local does not mean unauthenticated; restore requires credential rebinding and every adapter receives least privilege.
