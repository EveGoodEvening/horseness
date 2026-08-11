# <ID> Execution Ledger

- Status: `not-started`
- Attempt generation: `0`
- Dependencies: `<ordered receipt digests>`
- Claim/expiry: `<canonical docs/claims/<ID>/<generation>.json path and digest; pre-claim base (never the claim commit SHA); issued/expiry; sealing/attestation proof>`
- Supersession lineage: `<prior attempt/receipt digests>`
- Allowed paths: `<exact allowedPaths>`
- Affected ADR paths: `<exact affectedAdrPaths>`
- Acceptance record paths: `<exact config/acceptance paths>`
- Acceptance contract: `v3:<ID-or-parameterized-kind>`
- Candidate: `<worker SHA/tree and integration SHA>`
- Verification evidence: `<typed ordered command results and artifact digests>`
- Side-effect head: `<digest or null>`
- Final checkpoint receipt: `<docs/checkpoints/<ID>/final/<generation>.json and digest>`
- Blocker/finding: `none`
- Supersedes/superseded by: `none`

## Checklist

- [ ] Dependencies and priority verified
- [ ] Exact ownership verified
- [ ] Candidate sealed from current attempt base
- [ ] Frozen acceptance completed in order
- [ ] Receipt/index integrated
