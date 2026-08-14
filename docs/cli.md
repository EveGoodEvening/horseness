# Horseness CLI

The `horseness` executable is the supported command-line boundary for the local coordinator. It requires Node.js 22 and communicates with the daemon through its permission-restricted local endpoint; it does not read the authority database directly.

## Output and exit status

Pass `--json` to any command for one canonical JSON object followed by a newline. Human and JSON output are rendered from the same result. Credential, bootstrap, recovery, and other secret-shaped material is recursively redacted from both successful and failed output.

Exit status is stable:

- `0`: complete success
- `1`: operational failure
- `2`: invalid invocation, option, or command
- `3`: partial per-host success
- `4`: consent or trust refusal

## Local daemon lifecycle

Create a private workspace directory and start the daemon with explicit state paths:

```sh
horseness start \
  --workspace-path "$PWD" \
  --database-path "$PWD/.horseness/authority.sqlite" \
  --artifact-root "$PWD/.horseness/artifacts" \
  --endpoint-path "$PWD/.horseness/daemon.sock" \
  --grant-reference-file "$PWD/.horseness/grant-reference"
```

Bootstrap consumes protected capability material from a file rather than command-line text:

```sh
horseness bootstrap \
  --workspace-path "$PWD" \
  --database-path "$PWD/.horseness/authority.sqlite" \
  --artifact-root "$PWD/.horseness/artifacts" \
  --endpoint-path "$PWD/.horseness/daemon.sock" \
  --bootstrap-capability-file "$PWD/.horseness/bootstrap-capability.v1.json"
```

Stop the owner daemon with:

```sh
horseness stop --workspace-path "$PWD"
```

Lifecycle state files and references must remain owner-only. Do not place bootstrap capability or recovery material directly in argv, shell history, logs, or JSON output.

## Coordinator operations

Every public coordinator method is available under its stable kebab-case name derived from the protocol registry, for example `workspace-get`, `run-create`, `run-get`, `run-list`, `grant-issue`, `grant-delegate`, `grant-revoke`, and `grant-list`. Commands accept the registry-defined workspace, cursor, identifier, and idempotency inputs. Use `horseness <command> --help` for the exact usage registered by the installed version.

The credential lifecycle commands are:

- `credential-rotate`: replace an active grant while revoking its predecessor.
- `credential-revoke`: revoke a grant by digest and reason.
- `credential-recover`: consume protected recovery material from `--recovery-file`.
- `restore-rebind`: rebind a restored authority to the current workspace state paths.

Treat grant references as opaque host references. The CLI passes a reference during the daemon transport handshake and never accepts the underlying credential secret as a normal option.

## Installer lifecycle commands

The typed registry/router exposes `install`, `upgrade`, `downgrade`, `rollback`, `retry-install`, `uninstall`, `doctor`, `repair`, `rebind-workspace`, and `smoke`. Help and shell completion are generated from the same registry, so routing, usage, and completion cannot silently diverge.

Every lifecycle invocation requires an explicit absolute `--workspace`; pass `--create-workspace` only when creation is intended. `--host all` applies the signed platform catalog to all four hosts. Unattended executable consent requires `--accept-executable-risk <release-manifest-digest>`. Doctor is static and non-mutating; repair is the separate mutating command.
The lifecycle blackbox deploys the real CLI package, invokes the packed bootstrap and daemon, and observes different signed release versions, retained bytes, journaled crash/retry, compensation, doctor/repair/smoke status, workspace binding, and uninstall. No command-success fixture executable participates.

## Repository development

From the repository root:

```sh
corepack pnpm --filter @horseness/cli run typecheck
corepack pnpm --filter @horseness/cli run test
corepack pnpm --filter @horseness/cli run smoke
```

The smoke command runs the packed executable against a fresh daemon and removes its temporary workspace and daemon process on completion.
