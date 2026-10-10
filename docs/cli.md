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

### Explicit execution, planning and cancellation

All task commands below accept `--run current|ID`, `--workspace PATH` and `--json`. Use `task list` to find the task ID; creating a task remains draft-only.

```sh
horseness task dispatch --task TASK_ID --adapter pi --model PROVIDER/MODEL
horseness task show --task TASK_ID
horseness task breakdown --task TASK_ID --planner claude --model CONCRETE_MODEL
horseness task show --task TASK_ID
horseness task adopt --task TASK_ID --plan PLAN_DIGEST
horseness task execute --task TASK_ID --adapter pi --model PROVIDER/MODEL
horseness task cancel --task TASK_ID
```

`dispatch` explicitly starts one native attempt. Supported hosts are `pi`, `omp`, `claude` and `codex`; no host or model is silently substituted. Omit `--model` only when the daemon can resolve a concrete configured default through supported non-secret metadata; otherwise `MODEL_REQUIRED` requests a concrete model. Missing runtime, access, policy or quota fails explicitly. The CLI only calls the daemon protocol; it never starts native workers itself.

`dispatch`, `breakdown` and `execute` accept `--effort off|none|low|medium|high|xhigh|max`, defaulting to `medium` when omitted. On `breakdown` this controls the planner; on `execute` it controls the objective and its dependency work. The selected spelling is frozen into the execution profile, its digest and the CLI's exact-recovery request. Both `off` and `none` explicitly request no reasoning; neither means omission. `task show --json` reports each attempt's original `effort` (`null` for historical profiles that predate this setting). Changing effort, including switching between off and none, is not an exact retry of a pending operation.

Pi and OMP receive native `--thinking`, with both no-reasoning spellings translated to `off`. Claude receives native `--effort` for reasoning levels, or an invocation-local `MAX_THINKING_TOKENS=0` for off/none. Codex receives `effort` on `turn/start`, using native `none` for off/none. Users select the level without a hardcoded model-effort allowlist; the native runtime/model governs applicability and these are not portable token budgets. Invalid public values fail before a workspace mutation. Pinned Pi has no `max` selector and rejects it before launch; OMP probes advertised xhigh/max capabilities and Codex retains its native advertised-effort preflight. Horseness does not silently substitute a lower level.

`dispatch`, `breakdown` and `execute` return a **durable acknowledgement**, not a completed task or successful worker result. There is no CLI polling loop. `task show` observes dependencies, schedulability, attempt generation/state and authenticated receipt/output digests, published output, plan preview and workflow state/reason. Only authority-backed task resolution means completion; prose and a start acknowledgement do not. Unknown outcomes must be inspected, never implicitly relaunched.

`breakdown` runs a separate planner; it does not activate or complete the objective, adopt children or launch their work. Inspect the preview's instructions, human acceptance criteria and dependency keys, then explicitly `adopt` its exact digest. Adoption checks the unchanged draft source contract and creates its dependency graph atomically. The objective remains the final integration task, depending on terminal child tasks. Invalid planner output is rejected, not converted into fake tasks. Human-language acceptance criteria are guidance, not claimed automatic semantic verification.

`execute` durably authorizes **serial dependency-ordered execution** of the exact target closure. Optional automatic planning/adoption is explicit:

```sh
horseness task execute --task TASK_ID --adapter pi --model PROVIDER/MODEL --effort high \
  --auto-plan --planner claude --planner-model CONCRETE_PLANNER_MODEL --planner-effort low
```

`--auto-plan` is a valueless flag, defaults off and is invalid on other commands. `--planner` defaults to the execution adapter. With the same adapter, omitted `--planner-model` reuses the chosen execution model; a different planner host never inherits another host's model selection and needs its own concrete model if no safe default is available. Planner flags require `--auto-plan`. Automatic authorization does not bypass grants, policy, quota, dependencies or cancellation; execution stops on failed dependencies, denial or unknown outcome. `cancel` durably stops the target/workflow's future launches, including after restart; it is not a claim that already handed-off external work was undone.

`--planner-effort off|none|low|medium|high|xhigh|max` requires `--auto-plan`. Its omitted-value default is independently `medium`: `--effort high --auto-plan` uses high effort for work and medium effort for planning. Omission and explicitly writing `medium` produce the same new CLI recovery request.

Existing initialized workspace grants are not upgraded by `init`. An owner whose current authority grant permits `grant.issue.v1` can explicitly request a same-principal replacement:

```sh
horseness workspace enable-execution
```

This inspects the current grant through `grant.list.v1`, preserves its identity, scope and expiry, and adds the task observation/execution methods through `grant.issue.v1`. Nonauthority callers are denied. The opaque issued reference is atomically replaced and fsynced in its owner-only file, never printed. This command grants access; it launches no model or task.

Daily workflows generate creation/operation IDs and obtain cursors internally; users select reported task/run IDs and reviewed plan digests, not protocol JSON or caller-generated idempotency keys. Workspace selection and run observations live in owner-only `.horseness/cli-workspace.v1.json`; the opaque grant reference is stored separately. This file is client context, never canonical authority.

### Edit a breakdown before adoption

`adopt` means adopting an exact reviewed task graph, not approving a canonical-state proposal. To change a ready preview, export a private editable copy before adoption:

```sh
horseness task export-plan --task TASK_ID --out plan.json
# Edit plan.json; use the digest reported by export-plan as BASE_DIGEST.
horseness task revise --task TASK_ID --plan BASE_DIGEST --file plan.json
horseness task show --task TASK_ID
# After reviewing the revised preview, use its digest as NEW_DIGEST.
horseness task adopt --task TASK_ID --plan NEW_DIGEST
horseness task execute --task TASK_ID --adapter pi --model PROVIDER/MODEL
```

The exported file contains only the editable data, for example:

```json
{
  "tasks": [
    {
      "key": "inspect",
      "title": "Inspect authentication",
      "instructions": "Locate the login failure and report the responsible code paths.",
      "acceptanceCriteria": ["Identify a reproducible failing login case."],
      "dependsOn": []
    },
    {
      "key": "fix",
      "title": "Fix and verify",
      "instructions": "Fix the identified defect and add a regression test.",
      "acceptanceCriteria": ["The reproduction succeeds and the regression test passes."],
      "dependsOn": ["inspect"]
    }
  ]
}
```

Add or remove tasks, edit titles/instructions/acceptance criteria, and change keys or dependencies. Keep 1–32 tasks, unique keys, nonempty acceptance criteria, and an acyclic graph whose dependency keys all exist. Extra fields, including models, permissions, grants or completion policies, are rejected. The JSON file may be at most 1 MiB; its canonical plan data may be at most 64 KiB. File paths are relative to the invoking directory, independently of `--workspace`.

`export-plan` creates an owner-only file and refuses to overwrite any existing path. It exports exact task text rather than console-redacted text, so keep that file private. Editing the file alone changes no authority state. `revise` validates and saves a new immutable preview with its own digest and recorded base/author; `task show` reports its revision provenance. The original planner preview remains unchanged. No children or native calls are created, and canonical revision is unchanged. Submitting unchanged content returns the same digest as a durable no-op. To revise again, use the newest preview digest.

The source must still be draft, with no adopted plan and no active planning/execution workflow involving it. A stale base fails with `PLAN_STALE`; an adopted graph fails with `PLAN_ALREADY_ADOPTED`. Cancellation, changed source contracts, invalid graphs, concurrent observations, current grants and policy are rechecked. There is no implicit rebase, adoption or execution. Existing workspace owners missing `task.revisePlan.v1` must explicitly run `workspace enable-execution`; `init` never broadens their grant.

If a revision command is interrupted, retain the original JSON content and repeat the same command to recover its saved request. Changing the file while an operation is pending fails with `OPERATION_PENDING`; it must not silently replace the content, IDs, cursor or key of the original operation.

### Native runtime prerequisites

The concrete bridges verify the pinned distribution before execution: Pi `0.73.1`, OMP `17.2.15`, Claude Code `2.1.228`, and Codex `0.144.1-linux-x64`. A newer installed binary is not silently accepted. The owner daemon may select a verified executable with `HORSENESS_PI_EXECUTABLE`, `HORSENESS_OMP_EXECUTABLE`, `HORSENESS_CLAUDE_EXECUTABLE`, or `HORSENESS_CODEX_EXECUTABLE`; these are daemon configuration, never planner-provided options. Pi/OMP use the pinned distribution's `dist/cli.js` entrypoint. Starting a daemon does not install or upgrade native hosts.

Pi and OMP require exact `provider/model` identifiers. Claude and Codex require concrete native model IDs. Native identity, model, permission mode, time/output bounds, and context are frozen before handoff and checked against native observations. Authenticate through the host's own normal session/configuration; Horseness does not inspect or copy native authentication stores. Native subprocesses receive an allowlisted environment, not ambient provider-secret or executable-preload variables.

Planner mode does not expose writing tools. Codex additionally requires a complete empty native MCP inventory before any model turn; configured, unsupported, or partially enumerated MCP servers refuse execution rather than bypassing the preview-only boundary. Workspace selection is not a new OS sandbox: normal coding tools retain the native host's OS-user privileges and permission behavior.

Attempts use a one-MiB context budget and a one-MiB native output/evidence capture bound. Default native deadlines are five minutes for Pi/OMP and two minutes for Claude/Codex. Bounds are not monetary/token-cost guarantees. Successful output and failed/cancelled diagnostic evidence are published before their receipt is referenced. A retained terminal can be reconciled after restart without launching a new native operation; absent terminal evidence remains `unknown_outcome`. There is no automatic duplicate launch, native resume, or host/model fallback.

### Concurrency and interrupted operations

- Stale observations and denied operations fail explicitly with stable codes and an actionable message. The CLI never silently refreshes and retries a mutation.
- Before sending a mutation, the CLI durably saves its complete request, generated IDs, cursor, key and normalized execution option fingerprint. A connection interruption leaves it intact. Inspect `horseness status` or `task show`, then explicitly repeat the exact command/options to recover its result without duplicating authorization or external work. Changed task, run, adapter, model, plan or automatic/planner flags cannot replay the original request. Queries remain available while pending; another mutation or run switch is blocked. A verified definitive rejection clears pending state, but an unverified response retains it.
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

- `0`: successful command (execution mutations acknowledge durable acceptance, not task completion)
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
