# Horseness CLI

The `horseness` executable is the supported command-line boundary for the local coordinator. It requires Node.js 22 and communicates with the daemon through its permission-restricted local endpoint; it does not read the authority database directly.

## Daily workflow

With matching CLI and daemon executables available on `PATH`:

```sh
horseness init
horseness run create --title "Fix login"
horseness task add --run current --title "Inspect authentication"
horseness status
```

`init` explicitly initializes the current project directory, performs the existing local first-authority ceremony, and starts the daemon. It does not install host adapters or bypass installer consent. Repeating it reconnects to the same authority or starts its stopped daemon; it never resets existing state or issues a replacement grant. An existing incomplete or foreign `.horseness` directory is refused rather than overwritten.

Subsequent workflow commands discover the nearest initialized ancestor, so they also work from project subdirectories. Pass `--workspace PATH` to select a different existing project directory. There is no global most-recent-workspace fallback. `init` from inside another workspace refuses accidental nesting unless an explicit `--workspace` is supplied.

Run creation selects the new run as `current`. Use `horseness run list` and `horseness run use --run ID` to revisit an existing run. `task add` and `task list` default to `--run current`; an explicit run ID does not change that selection. A new task is a durable **draft**, with a frozen receipt-only completion predicate. Adding it does not launch a worker or change the canonical document revision.

No daily command requires cursor JSON, protocol versions, principal IDs, entity IDs, or idempotency keys. The CLI obtains authoritative observations and builds exact versioned requests internally. Workspace selection and run observations live in owner-only `.horseness/cli-workspace.v1.json`; the opaque grant reference is stored separately. This file is client context, never canonical authority.

### Concurrency and interrupted operations

- Stale observations and denied operations fail explicitly with stable codes and an actionable message. The CLI never silently refreshes and retries a mutation.
- Before sending a mutation, the CLI durably saves its complete request, generated IDs, cursor, and key. A connection interruption leaves this pending operation intact. Inspect `horseness status`, then explicitly repeat the same command and title to recover its exact result without creating another entity. A different mutation or run switch is blocked until that pending operation is resolved.
- Concurrent CLI operations on one workspace fail with `WORKSPACE_BUSY`. If a CLI process was forcibly killed, confirm no workspace command is active before removing only `.horseness/cli-workspace.v1.lock`; retain the context and repeat the original command. Stale locks are not automatically removed because concurrent reclaimers could otherwise delete a live lock.
- Never delete `.horseness` to fix access problems. It contains durable authority state. Existing pre-workflow workspaces continue to use explicit low-level commands; `init` does not silently adopt their authority or broaden their grants.

`horseness`, `horseness --help`, `horseness run --help`, and `horseness task add --help` provide help without requiring a daemon. `horseness help --all` lists the low-level protocol commands as well.

### Run from a checkout

Use Node 22 and install the frozen dependencies, then invoke the shipped source executables from any project directory:

```sh
corepack pnpm install --frozen-lockfile
HORSENESS="$PWD/apps/cli/bin/horseness.mjs"
export HORSENESS_DAEMON_EXECUTABLE="$PWD/apps/daemon/bin/horseness-daemon.mjs"
"$HORSENESS" init --workspace /absolute/path/to/project
"$HORSENESS" run create --workspace /absolute/path/to/project --title "Fix login"
"$HORSENESS" status --workspace /absolute/path/to/project
```

The selected project must already exist. `--daemon-executable PATH` also selects the daemon during initialization. Source and packaged launchers resolve their TypeScript loader relative to their package, not the caller's directory.

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
