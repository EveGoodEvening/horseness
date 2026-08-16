# Horseness

A multi-Agent state machine with version control, evidence gating, and deterministic reconstruction.

## The Problem

Main Agent + free-form subagent summaries + session compression have inherent flaws:

- Summaries drop constraints; new and old facts bleed together.
- Conclusions cannot be traced back to evidence.
- Concurrent subagents overwrite each other.
- No precise replay; no way to tell which code version a conclusion holds against.

## Core Idea

Move the main Agent's correct cognition out of session text and into a **verifiable, replayable, versioned canonical working state**.

The closed loop:

```
subagent exploration
→ evidence-gated state delta
→ canonical working state
→ automatic context reconstruction
→ dependency-aware fork
```

## Mechanisms

**Canonical state (main branch)** — the single deterministic state owned by the main Agent, carrying a `revision` and `stateHash`. Only `DeltaAccepted` advances `revision + 1`.

**ForkPin (work branch locked to a base)** — a subagent creates an immutable fork from a fixed revision, binding the visible receipt/evidence, the delta scope it is authorized to modify, and the parent fork lineage. Concurrent forks never overwrite each other.

**Delta proposal (a PR with preconditions)** — a subagent does not mutate canonical state directly; it submits a structured delta: exact base revision, scope, `test`/`replace`/`remove` preconditions, and evidence claims. If the base has moved, it returns `conflicted` rather than silently overwriting.

**Evidence-gated admission (deterministic CI + policy gate)** — five deterministic checks: structural identity, modification authority, evidence authenticity, concurrency conflict, and the conjunction of pinned + current policy. Outcomes are only `accepted`/`rejected`/`conflicted`/`quarantined`/`approval_required`; only `accepted` advances the canonical revision.

**Automatic context reconstruction (deterministic minimal-context build)** — rather than letting the main Agent hand-trim the session, the system deterministically renders a digest-verifiable minimal context from persistent state, driven by the ForkPin, task scope, and a fixed budget. Whole items are omitted, not truncated, and omissions are recorded.

**Dependency-aware fork (task DAG)** — downstream forks are created only after an upstream task's receipt/evidence at a specific generation satisfies its success conditions, binding an immutable join snapshot. Subsequent fixes build on `canonical revision + ForkPin + dependency snapshot`, not on the main Agent's current natural-language session.

## Analogy

```
Git-like forks
+ database transactions
+ content-addressed evidence
+ deterministic build-like context generation
+ policy-gated pull requests
+ task DAG scheduler
```

| Horseness              | Git / engineering analogy                       |
| ---------------------- | ----------------------------------------------- |
| main Agent             | sole authorized integrator                      |
| canonical state        | main branch                                     |
| ForkPin                | work branch locked to a base commit             |
| subagent exploration   | research on a branch                            |
| evidence               | test output, artifacts, receipts                |
| delta proposal         | PR with path scope and preconditions            |
| admission              | deterministic CI + policy gate                  |
| DeltaAccepted          | merge commit                                    |
| context reconstruction | minimal context rebuilt from a locked revision  |
| dependency-aware fork  | downstream branch created only after upstream succeeds |

## Quality Boundaries

What it optimizes: long-task consistency, multi-Agent concurrency safety, traceability, replayable context, error isolation, stale-context detection, evidence-to-conclusion binding, and precise baselines for follow-up fixes.

What it costs: heavier than free-form chat; every proposal needs a structured delta; evidence must be persisted and verified; task scope and dependencies must be defined up front; admission only deterministically verifies encoded rules — it does not judge semantic correctness; when the contract/scope/policy itself is misdesigned, the closed loop can only consistently execute the wrong rules.

> For long-running, multi-Agent engineering tasks that need reliable fixes and auditability, this closed loop is typically far more reliable than free-form summaries + session compression. For one-off small tasks, the cost may exceed the benefit.

## Core Constraint

> Any subagent conclusion is only candidate information — not the main Agent's canonical truth — until it has bound a ForkPin, scope, receipt, evidence, and precondition, and passed admission.

## Status

The core domain/store/orchestrator/SDK/daemon/CLI and the Pi and OMP adapter layers are established. The complete closed loop across all four hosts, installation, system verification, and release are not yet fully done. See `docs/DESIGN_CHOICE.md` and `docs/progress.md`.

## Further Reading

- `docs/DESIGN_PRINCIPLE.md` — design principles: main Agent responsibility boundaries, full admission checklist, context reconstruction replayability, retry/resume attempt identity.
- `docs/DESIGN_CHOICE.md` — design tradeoffs: original idea and flaw analysis, step-by-step closed-loop walkthrough, concrete examples, quality boundaries and costs.
- `docs/architecture.md` — product invariants and state semantics (normative document).
- `docs/plan.md` — chunk boundaries, dependencies, path ownership, acceptance commands.
- `docs/progress.md` — progress ledger.
