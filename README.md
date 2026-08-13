# Horseness

Horseness is a local-first orchestration system for auditable multi-agent coding work. It connects AI coding hosts such as Pi, OMP, Claude Code, and Codex through one provider-neutral workflow.

## What it does

- Gives each worker an immutable, versioned view of the workspace.
- Collects proposed changes with their evidence and origin.
- Applies policy and authorization checks before accepting changes.
- Records tasks, decisions, artifacts, and state transitions for deterministic replay and audit.
- Runs locally by default; SQLite and append-only event streams hold authoritative state.

## Purpose

Horseness makes parallel agent work controlled and reproducible: workers can explore independently, but no worker can silently overwrite canonical state. Only an authorized, policy-approved proposal advances it.

## Usage

The project is still under development and is not release-ready. Current progress and blockers are tracked in [docs/progress.md](docs/progress.md).

To work on the repository:

```bash
corepack pnpm install --frozen-lockfile
corepack pnpm typecheck
corepack pnpm lint
corepack pnpm test
corepack pnpm boundaries:check
```

Requirements: Node.js 22 and pnpm 10 (the exact pnpm version is declared in `package.json`).

Product architecture: [docs/architecture.md](docs/architecture.md). Delivery plan: [docs/plan.md](docs/plan.md).
