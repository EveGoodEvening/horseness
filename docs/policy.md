# Policy lifecycle and admission

## Immutable documents

`PolicyDocumentV1` contains a validated `PolicyDocumentCoreV1` and its SHA-256 digest, computed as `sha256("horseness.policy.v1\0" || canonicalJson(core))`. Documents are immutable values. Revision zero has no predecessor; every later revision names its predecessor digest. Rules, constraints, paths, and evidence requirements are canonical and use one unsigned UTF-8 byte ordering. JSON Pointer parsing and containment use the domain helpers, including root (`""`) and decoded-token containment. Activation stores only a verified digest and advances its activation sequence exactly once when the reference changes. Deactivation stores the explicit canonical `NO_POLICY_DIGEST`; policy references and admission policy slots are never nullable. Repeating either state is idempotent.

## Pure conjunctive admission

`evaluateAdmission` has no clock, storage, network, or environment access. Its authority time and composite observation cursor are explicit inputs. It validates all runtime values before evaluation and returns a stable explanation order.

Base and operation precondition conflict is evaluated first and dominates policy. Otherwise the fork-pinned and currently active slots each contain either an immutable `PolicyDocumentV1` or the explicit canonical `NoPolicyV1`; their digests are always concrete. Decisions are conjoined with precedence `rejected > quarantined > approval_required > accepted`. Constraint values and explanations use the same unsigned UTF-8 byte comparator. This makes no-policy, equal, loosened, tightened, and incomparable pinned/current combinations deterministic; the current document never replaces the pinned one.

Evidence requirements bind evidence ID, digest, canonical JSON Pointer, and version. Missing evidence quarantines; digest, path, or version substitution rejects. Proposal path selectors use domain JSON Pointer token containment rather than string prefixes. Snapshot evaluation rejects substituted grant/quota digests, an evaluation cursor different from the authority clock, or an issue cursor ordered after the evaluation cursor; exhausted but current quota quarantines. Base revisions and cursor sequences/epochs are nonnegative safe integers.

## Approvals

An approval can satisfy only `approval_required` explanations. It binds the proposal author and requires a distinct authenticated approver, as well as the proposal/base tuple, both concrete policy digests (including `NO_POLICY_DIGEST`), action, approver grant digest, exact issue snapshot, and exact evaluation snapshot. The issue cursor must not be ordered after the evaluation cursor. Authority, issue, and expiry timestamps are canonical UTC-second strings (`YYYY-MM-DDTHH:mm:ssZ`), the interval is nonempty, and evaluation must fall within `[issuedAt, expiresAt)`. A self-authored approval, authenticated-principal substitution, stale/substituted issue snapshot, evaluation cursor movement, policy/grant replacement, proposal amendment, or base movement cannot reuse the approval.

## Runtime compatibility

Readers reject unknown schema/kind/effect variants, extra or missing fields, malformed lineage, noncanonical rule/evidence order, duplicate identifiers, invalid cursors, non-finite authority time, and malformed snapshots before returning a decision. C04 writes only schema version `1`.
