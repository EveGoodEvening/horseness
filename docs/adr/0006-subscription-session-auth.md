# ADR 0006: Native subscription-session authentication

## Status
Accepted.

## Context
Claude Code and Codex require authenticated native sessions to prove their complete live contribution matrices. The invoking OS user already has host-owned subscription sessions. Requiring a separate least-privilege provider account and opaque provider credential reference would block C17/C18, while copying or extracting native authentication material would violate Horseness's secret boundary.

## Decision
C17, C18, and their later exact-public verification may drive the pinned, provenance-verified native Claude Code or Codex executable under the invoking OS user's existing logged-in subscription session. Provider authentication and billing come from that host-owned session. Horseness workspace and attempt authorization remains a separate opaque, least-privilege, immutable grant.

This exception accepts the user's normal provider account scope and subscription billing. It claims no dedicated least-privilege provider account, opaque provider credential reference, monetary cap, or token-cost cap. Exact request fixtures and scenario count, provider-operation and turn maxima, allowed tools and network purpose, input/output/evidence byte ceilings, output redaction, and a finite wall-clock watchdog remain mandatory deterministic bounds; they are not a provider cost guarantee.

## Security Boundary
Only the pinned native executable may use its normal authentication store under the invoking OS identity. Horseness code and adapters must not open, parse, copy, hash, back up, journal, export, print, or persist auth files or secret values; receive bearer tokens, cookies, OAuth material, request headers, or environment-exported secrets; manufacture authentication environment variables; or place subscription state in fixtures, packages, receipts, logs, artifacts, or retained resume state.

The native host must attest session usability through a bounded status or invocation path without exposing secrets. Missing, expired, rejected, wrong-host, model-unavailable, interactive-login-required, timeout, redaction failure, or native-host failure is a hard failure with a stable redacted reason code, never a skip, prompt, refresh, or fallback. Restart, reconcile, and resume reuse the bound host session without copying authentication state.

Uninstall revokes Horseness grants and disables or removes the native contribution. It does not log out, revoke, or delete the provider-owned subscription session; native host logout or provider account controls perform that action.

## Evidence
Hermetic validator receipts, Claude subscription-session receipts, and Codex subscription-session receipts are distinct. A live receipt records only schema/version; `authMode: existing-user-subscription-session`; host identity; pinned native distribution/version/archive/member/executable and contribution digests; observed model identifier; candidate commit/tree; exact command and scenario-set digest; immutable workspace/run/task/attempt/ForkPin/context/receipt/proposal bindings; output/evidence digests and redaction audit; start/end/duration; terminal result; and stable reason code.

Receipts omit account identifiers, emails, subscription IDs, auth paths, token fingerprints, credential references, request headers, secret-derived hashes, and secret material. Candidate receipts are host- and candidate-bound. Exact-public verification emits fresh host-distinct receipts bound to the release manifest and exact artifact digests; receipts cannot be reused across hosts, candidates, or releases.

## Consequences
C17 and C18 can use real native authenticated behavior without Horseness possessing provider credentials. Acceptance becomes dependent on a noninteractive usable session and fails closed when it is unavailable. Native provenance, Horseness least-privilege grants, immutable bindings, authority-produced decisions, contribution confinement, redaction, bounded evidence, and complete `WorkerReturnV1` proof remain unchanged.

The security posture is weaker than a dedicated controlled account because the verified native executable operates with the user's normal provider account scope, and provider-side usage may occur. This risk and subscription billing are explicitly accepted. No logout or provider-session revocation claim is made.

## Rejected Alternatives
- Fabricating an opaque Horseness credential reference to the same native session.
- Copying native auth files into a sandbox, fixture, adapter store, or retained state.
- Extracting tokens, cookies, OAuth material, headers, or secret-derived fingerprints.
- Treating missing or unusable authentication as a skip or reduced success.
- Substituting hermetic validation, CLI-only behavior, or synthetic receipts for the real native live loop.
- Retaining the superseded dedicated controlled-account prerequisite for C17/C18.
