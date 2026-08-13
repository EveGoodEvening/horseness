# Horseness CLI

The `horseness` executable is the supported command-line boundary for the local coordinator. It requires Node.js 22 and communicates with the daemon through its permission-restricted local endpoint; it does not read the authority database directly.

## Output and exit status

Pass `--json` to any command for one canonical JSON object followed by a newline. Human and JSON output are rendered from the same result. Credential, bootstrap, recovery, and other secret-shaped material is recursively redacted from both successful and failed output.

Exit status is stable:

- `0`: success
- `1`: an authenticated operation failed
- `2`: invalid invocation, option, or command

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

## Repository development

From the repository root:

```sh
corepack pnpm --filter @horseness/cli run typecheck
corepack pnpm --filter @horseness/cli run test
corepack pnpm --filter @horseness/cli run smoke
```

The smoke command runs the packed executable against a fresh daemon and removes its temporary workspace and daemon process on completion.
