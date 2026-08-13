import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { CoordinatorClientV1, type CoordinatorCallV1 } from "@horseness/sdk";
import { bootstrapDaemonV1, readProtectedSecretFileV1, rebindRestoredWorkspaceV1, startDaemonV1, stopDaemonV1, type CliDaemonPathsV1 } from "../lifecycle.js";
import { cliFailureV1, cliSuccessV1, type CliResultV1, type JsonValue } from "../result.js";
import type { CliCommandDefinitionV1, CliCommandRegistryV1, CliExecutionContextV1, CliInvocationV1 } from "../registry.js";

const PATH_OPTIONS = ["workspace-path", "database-path", "artifact-root", "endpoint-path", "workspace-id", "daemon-executable"] as const;
function required(invocation: CliInvocationV1, name: string): string {
  const value = invocation.options[name];
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`--${name} requires a value`);
  }
  return value;
}

function optional(invocation: CliInvocationV1, name: string): string | undefined {
  const value = invocation.options[name];
  if (value === undefined) return undefined;
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`--${name} requires a value`);
  }
  return value;
}

function paths(invocation: CliInvocationV1): CliDaemonPathsV1 {
  const workspaceId = optional(invocation, "workspace-id");
  return {
    workspacePath: required(invocation, "workspace-path"),
    databasePath: required(invocation, "database-path"),
    artifactRoot: required(invocation, "artifact-root"),
    endpointPath: required(invocation, "endpoint-path"),
    daemonExecutable: optional(invocation, "daemon-executable") ?? process.env.HORSENESS_DAEMON_EXECUTABLE ?? "horseness-daemon",
    ...(workspaceId === undefined ? {} : { workspaceId }),
  };
}

function failure(command: string, error: unknown): CliResultV1 {
  const codedError = error instanceof Error && "code" in error ? (error as Error & { code: string }) : undefined;
  return cliFailureV1(
    command,
    codedError?.code ?? "LIFECYCLE_FAILED",
    error instanceof Error ? error.message : "lifecycle operation failed",
    null,
  );
}

function definition(
  name: string,
  summary: string,
  usage: string,
  optionNames: readonly string[],
  secretOptions: readonly string[],
  executeCommand: (invocation: CliInvocationV1, context: CliExecutionContextV1) => Promise<JsonValue>,
): CliCommandDefinitionV1 {
  return {
    name,
    aliases: [],
    summary,
    usage,
    optionNames,
    secretOptions,
    async execute(invocation, context) {
      try {
        return cliSuccessV1(name, await executeCommand(invocation, context));
      } catch (error) {
        return failure(name, error);
      }
    },
  };
}

function bootstrapSecret(path: string): string {
  readProtectedSecretFileV1(path);
  const parsed = JSON.parse(readFileSync(resolve(path), "utf8")) as unknown;
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) throw new Error("bootstrap capability file is invalid");
  const secret = (parsed as Record<string, unknown>).secret;
  if (typeof secret !== "string" || secret.length === 0) throw new Error("bootstrap capability file is invalid");
  return secret;
}

export function registerLifecycleCommandsV1(registry: CliCommandRegistryV1): void {
  registry.register(definition("start", "Start the local workspace daemon", "start --workspace-path PATH --database-path PATH --artifact-root PATH --endpoint-path PATH --daemon-executable PATH --grant-reference-file FILE", [...PATH_OPTIONS, "grant-reference-file"], ["grant-reference-file"], async (invocation, context) => startDaemonV1(paths(invocation), required(invocation, "grant-reference-file"), context.authorityTime)));
  registry.register(definition("stop", "Stop the local workspace daemon", "stop --workspace-path PATH [--workspace-id ID]", ["workspace-path", "workspace-id"], [], async (invocation) => { await stopDaemonV1(required(invocation, "workspace-path"), optional(invocation, "workspace-id")); return { stopped: true }; }));
  registry.register(definition("bootstrap", "Consume the one-time bootstrap capability", "bootstrap --workspace-path PATH --database-path PATH --artifact-root PATH --endpoint-path PATH --daemon-executable PATH --bootstrap-capability-file FILE --grant-reference-file FILE", [...PATH_OPTIONS, "bootstrap-capability-file", "grant-reference-file"], ["bootstrap-capability-file", "grant-reference-file"], async (invocation, context) => {
    const capabilityPath = required(invocation, "bootstrap-capability-file");
    const grantReferencePath = resolve(required(invocation, "grant-reference-file"));
    const daemonPaths = paths(invocation);
    const secret = bootstrapSecret(capabilityPath);
    const temporary = `${capabilityPath}.secret`;
    try {
      writeFileSync(temporary, secret, { mode: 0o600, flag: "wx" });
      const result = bootstrapDaemonV1(daemonPaths, temporary, context.authorityTime);
      writeFileSync(grantReferencePath, `${result.grantReference}\n`, { mode: 0o600, flag: "wx" });
      return { workspaceId: result.workspaceId, principalId: result.principalId, grantDigest: result.grantDigest, grantReferenceFile: grantReferencePath };
    } finally { rmSync(temporary, { force: true }); }
  }));
  registry.register(definition("restore-rebind", "Rebind a moved restored workspace", "restore-rebind --workspace-path PATH --database-path PATH --artifact-root PATH --endpoint-path PATH --daemon-executable PATH", PATH_OPTIONS, [], async (invocation, context) => rebindRestoredWorkspaceV1(paths(invocation), context.authorityTime)));
}

async function coordinator(invocation: CliInvocationV1, context: CliExecutionContextV1, method: "grant.issue.v1" | "grant.revoke.v1", input: JsonValue): Promise<JsonValue> {
  const cursor = JSON.parse(required(invocation, "cursor")) as CoordinatorCallV1["observationCursor"];
  const result = await new CoordinatorClientV1(context.transport, context.credential).call({ method, workspaceId: required(invocation, "workspace-id"), observationCursor: cursor, input: input as never, idempotencyKey: required(invocation, "idempotency-key") } as CoordinatorCallV1<typeof method>);
  return result as unknown as JsonValue;
}

export function registerCredentialCommandsV1(registry: CliCommandRegistryV1): void {
  const common = ["workspace-id", "cursor", "idempotency-key"] as const;
  registry.register(definition("credential-revoke", "Revoke an active credential grant", "credential-revoke --workspace-id ID --cursor JSON --idempotency-key KEY --grant-digest DIGEST --reason TEXT", [...common, "grant-digest", "reason"], [], (invocation, context) => coordinator(invocation, context, "grant.revoke.v1", { operationId: required(invocation, "idempotency-key"), grantDigest: required(invocation, "grant-digest"), reason: required(invocation, "reason"), effectiveAt: context.authorityTime() })));
  registry.register(definition("credential-rotate", "Issue a replacement credential then revoke the prior grant", "credential-rotate --workspace-id ID --cursor JSON --idempotency-key KEY --old-grant-digest DIGEST --principal-id ID --principal-role ROLE --actions-file FILE --scope-file FILE --expires-at TIME", [...common, "old-grant-digest", "principal-id", "principal-role", "actions-file", "scope-file", "expires-at"], ["actions-file", "scope-file"], async (invocation, context) => {
    const actions = JSON.parse(readProtectedSecretFileV1(required(invocation, "actions-file"))) as JsonValue;
    const resourceScope = JSON.parse(readProtectedSecretFileV1(required(invocation, "scope-file"))) as JsonValue;
    const issued = await coordinator(invocation, context, "grant.issue.v1", { operationId: `${required(invocation, "idempotency-key")}:issue`, principalId: required(invocation, "principal-id"), principalRole: required(invocation, "principal-role"), actions, resourceScope, expiresAt: required(invocation, "expires-at") });
    await coordinator(invocation, context, "grant.revoke.v1", { operationId: `${required(invocation, "idempotency-key")}:revoke`, grantDigest: required(invocation, "old-grant-digest"), reason: "credential rotation", effectiveAt: context.authorityTime() });
    return issued;
  }));
  registry.register(definition("credential-recover", "Load an opaque recovered grant reference", "credential-recover --recovery-file FILE --workspace-id ID", ["recovery-file", "workspace-id"], ["recovery-file"], async (invocation) => {
    const parsed = JSON.parse(readProtectedSecretFileV1(required(invocation, "recovery-file"))) as Record<string, unknown>;
    if (parsed.schemaVersion !== "1" || parsed.workspaceId !== required(invocation, "workspace-id") || typeof parsed.grantReference !== "string" || !parsed.grantReference.startsWith("grant:")) throw new Error("recovery material binding mismatch");
    return { recovered: true, workspaceId: parsed.workspaceId as string };
  }));
}

export function registerLifecycleCliCommandsV1(registry: CliCommandRegistryV1): void {
  registerLifecycleCommandsV1(registry);
  registerCredentialCommandsV1(registry);
}
