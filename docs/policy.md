# Policy lifecycle and admission

## Immutable documents

`PolicyDocumentV1` contains a validated `PolicyDocumentCoreV1` and its SHA-256 digest, computed as `sha256("horseness.policy.v1\0" || canonicalJson(core))`. Documents are immutable values. Revision zero has no predecessor; every later revision names its predecessor digest. Rules and evidence requirements use unique, lexical identifiers so equivalent documents have one byte representation. Activation stores only a verified digest and advances its activation sequence exactly once when the reference changes. Deactivation is the same lifecycle operation with a null reference. Repeating either state is idempotent.

## Pure conjunctive admission

`evaluateAdmission` has no clock, storage, network, or environment access. Its authority time and composite observation cursor are explicit inputs. It validates all runtime values before evaluation and returns a stable explanation order.

Base and operation precondition conflict is evaluated first and dominates policy. Otherwise the fork-pinned and currently active documents are evaluated independently. A null reference is domain `NoPolicyV1`. Decisions are conjoined with precedence `rejected > quarantined > approval_required > accepted`. Constraint values are unioned, deduplicated, and lexically sorted; explanation identity retains `(policyDigest, ruleId, subject)`. This makes no-policy, equal, loosened, tightened, and incomparable pinned/current combinations deterministic; the current document never replaces the pinned one.

Evidence requirements bind evidence ID, digest, absolute logical path, and version. Missing evidence quarantines; digest, path, or version substitution rejects. Proposal path and version selectors are exact deterministic rule inputs. Snapshot evaluation rejects substituted or stale grant/quota digests and a stale composite cursor; an exhausted but current quota quarantines.

## Approvals

An approval can satisfy only `approval_required` explanations. It binds the proposal and base tuple, both evaluated policy digests, action, approver grant digest, and evaluation cursor. The authority evaluation time must be within `[issuedAt, expiresAt)`. Expiry equality is invalid. Policy replacement, grant replacement, cursor movement, proposal amendment, or base movement causes full re-evaluation and cannot reuse the old approval. Approval records are immutable; replacement creates a new record.

## Runtime compatibility

Readers reject unknown schema/kind/effect variants, extra or missing fields, malformed lineage, noncanonical rule/evidence order, duplicate identifiers, invalid cursors, non-finite authority time, and malformed snapshots before returning a decision. C04 writes only schema version `1`.
