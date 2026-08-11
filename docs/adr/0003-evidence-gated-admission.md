# ADR 0003: Evidence-gated admission

## Status
Accepted for C00 freeze.

## Decision
Workers submit sealed proposals with immutable `ForkPinCoreV1`, pin-bound delta scope, receipt/evidence lineage, a named proposal-sealing observation, and policy provenance. Structural and scope checks precede conflict checks; conjunctive pinned/current policy and current authorization follow. Only `accepted` advances canonical state.

## Consequences
Approvals trigger full re-evaluation and cannot bypass changed grants, quotas, policy, evidence, or base state.
