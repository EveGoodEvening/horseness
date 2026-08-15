# ADR 0008: C20 repository completion without OS receipt artifacts

## Status
Accepted.

## Context
C20 final local candidate `e49c5e1c` has green Node 22 results for the commands originally numbered 1–7, 9, and 10 and a clean definitive blocker/high review. The repository has no candidate-bound `horseness.os-receipt.v2` artifact for Linux, macOS, or Windows, so former command 8 cannot pass. The implemented `.github/workflows/install-smoke.yml`, receipt writer, and versioned verifier can collect and authenticate those artifacts in a suitable external CI environment, but those artifacts are not available. On 2026-08-15 the user explicitly authorized continuing without them.

## Decision
For C20 repository chunk completion only, former gate 8, `corepack pnpm run ci:require-os-receipts -- C20 linux macos windows`, is `waived/unobserved by explicit user direction on 2026-08-15` and is removed from the effective C20 completion predicate. It MUST NOT be recorded as passed, skipped, synthesized, or satisfied by local substitute evidence. The observed execution evidence is exactly the recorded local Linux Node 22 results for original gates 1–7, 9, and 10 plus the clean definitive review.

This ADR supersedes only:

1. The ADR 0007 Consequences paragraph beginning `C20 completion requires candidate-bound Linux, macOS, and Windows receipts`.
2. The ADR 0007 Rejected Alternative `Completing C20 without candidate-bound receipts from all three required operating systems.`

Every other ADR 0007 decision remains in full force, including neutral signed bundle composition, independent byte verification, support classification, owner-private roots and markers, path and realpath confinement, POSIX modes, Windows DACLs, refcounts, unsupported-host behavior, pure read-only doctor, repair separation, fail-safe uninstall and quarantine, and exact ownership.

No candidate-bound Linux, macOS, or Windows C20 receipt is claimed and no three-OS or cross-OS C20 validation claim is made. The accepted validation gap includes unobserved macOS behavior and unobserved Windows `%LOCALAPPDATA%`, DACL, named-pipe integration, backslash path resolution, and marker/refcount behavior. This ADR changes no C20 implementation byte and weakens no product runtime security control, installer trust boundary, doctor non-mutation guarantee, uninstall safety rule, or path-confinement rule.

`.github/workflows/install-smoke.yml`, `scripts/bootstrap/write-c20-os-receipt.mjs`, `scripts/ci-require-os-receipts.mjs`, `tests/ci-require-os-receipts.test.mjs`, and the `horseness.os-receipt.v2` profile remain intact and MUST NOT be removed or weakened by this correction. Future candidate-bound receipts may be collected and verified as supplemental evidence; they do not retroactively alter C20 completion.

C21 does not inherit this waiver. Its existing security, system, install-recovery, and four-host closed-loop obligations remain unchanged, and any OS-specific evidence required by its own contract must be satisfied or separately corrected. This ADR creates no precedent for C22–C25. In particular, it does not alter C24 commands 3–8 for exact-public online/offline installation on Linux, macOS, and Windows, C24 command 18 `corepack pnpm run ci:require-os-receipts -- C24 linux macos windows`, fresh C24 live or OS receipts, or C25's prohibition on skip, synthetic evidence, or receipt reuse. Any later change to those gates requires separate explicit user authorization, a reviewed planning correction, and an ADR.

## Consequences
After this correction receives independent review, C20 is eligible for the ordinary tracker-completion transaction without OS receipt artifacts. Until that transaction, C20 remains in progress and C21 remains dependency-blocked. The workflow and verifier remain available, the runtime design and security posture are unchanged, and the repository accepts a documented C20 cross-OS validation gap rather than fabricating evidence.

## Rejected Alternatives
- Marking former gate 8 passed or creating synthetic or local substitute receipts.
- Deleting or weakening the workflow, receipt writer, verifier, tests, or v2 profile.
- Claiming Linux, macOS, or Windows C20 receipt evidence or cross-OS validation without artifacts.
- Extending this evidence waiver to C21, release, exact-public verification, publication, promotion, or any other chunk.
