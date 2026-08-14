import { METHOD_REGISTRY_V1, type ProtocolMethodV1 } from "@horseness/protocol";
import { CoordinatorClientV1, type AuthorizedProtocolTransportV1, type CoordinatorCallV1, type OpaqueCredentialReferenceV1 } from "@horseness/sdk";
import { cliFailureV1, cliSuccessV1, type CliResultV1, type JsonValue } from "./result.js";

export type CliOutputModeV1 = "human" | "json";
export interface InstallerCliRuntimeV1 {
  execute(command: "install" | "upgrade" | "downgrade" | "rollback" | "retry-install" | "uninstall" | "doctor" | "repair" | "rebind-workspace" | "smoke", invocation: CliInvocationV1): Promise<{ readonly exitCode: 0 | 1 | 2 | 3 | 4; readonly data: JsonValue }>;
}

export interface CliInvocationV1 {
  readonly command: string;
  readonly args: readonly string[];
  readonly options: Readonly<Record<string, string | boolean>>;
  readonly outputMode: CliOutputModeV1;
}

export interface CliExecutionContextV1 {
  readonly transport: AuthorizedProtocolTransportV1;
  readonly credential: OpaqueCredentialReferenceV1;
  readonly stdout: (text: string) => void;
  readonly stderr: (text: string) => void;
  readonly authorityTime: () => string;
  readonly installer?: InstallerCliRuntimeV1;
}

export interface CliCommandDefinitionV1 {
  readonly name: string;
  readonly aliases: readonly string[];
  readonly summary: string;
  readonly usage: string;
  readonly secretOptions: readonly string[];
  readonly optionNames?: readonly string[];
  execute(invocation: CliInvocationV1, context: CliExecutionContextV1): Promise<CliResultV1>;
}

const COMMAND_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;

export class CliCommandRegistryV1 {
  readonly #definitions = new Map<string, CliCommandDefinitionV1>();
  readonly #names = new Map<string, CliCommandDefinitionV1>();
  register(definition: CliCommandDefinitionV1): void {
    const names = [definition.name, ...definition.aliases];
    if (names.some((name) => !COMMAND_NAME.test(name))) {
      throw new Error("CLI command names must be kebab-case");
    }

    const duplicate = names.find((name, index) => names.indexOf(name) !== index || this.#names.has(name));
    if (duplicate !== undefined) {
      throw new Error(`duplicate CLI command or alias: ${duplicate}`);
    }

    this.#definitions.set(definition.name, definition);
    for (const name of names) this.#names.set(name, definition);
  }

  resolve(name: string): CliCommandDefinitionV1 | undefined {
    return this.#names.get(name);
  }

  list(): readonly CliCommandDefinitionV1[] {
    return [...this.#definitions.values()].sort((left, right) => left.name.localeCompare(right.name));
  }
}

export function protocolMethodCommandNameV1(method: ProtocolMethodV1): string {
  return method.replace(/\.v1$/u, "").replace(/([a-z0-9])([A-Z])/gu, "$1-$2").replaceAll(".", "-").toLowerCase();
}

const COORDINATOR_OPTIONS = ["workspace-id", "run-id", "task-id", "attempt-id", "generation", "proposal-id", "adapter-id", "cursor", "input", "idempotency-key", "resume"] as const;

function requiredText(options: Readonly<Record<string, string | boolean>>, name: string): string {
  const value = options[name];
  if (typeof value !== "string" || value.length === 0) throw new Error(`--${name} requires a value`);
  return value;
}
function optionalText(options: Readonly<Record<string, string | boolean>>, name: string): string | undefined {
  const value = options[name];
  if (value === undefined) return undefined;
  if (typeof value !== "string" || value.length === 0) throw new Error(`--${name} requires a value`);
  return value;
}
function jsonOption(options: Readonly<Record<string, string | boolean>>, name: string): JsonValue {
  const raw = requiredText(options, name);
  try {
    return JSON.parse(raw) as JsonValue;
  } catch {
    throw new Error(`--${name} must be valid JSON`);
  }
}

function genericCoordinatorDefinition(definition: (typeof METHOD_REGISTRY_V1)[number]): CliCommandDefinitionV1 {
  const name = protocolMethodCommandNameV1(definition.method);
  return {
    name,
    aliases: [],
    summary: `Invoke ${definition.method}`,
    usage: `${name} --workspace-id ID --cursor JSON --input JSON${definition.idempotency === "required" ? " --idempotency-key KEY" : ""}`,
    secretOptions: [],
    optionNames: COORDINATOR_OPTIONS,
    async execute(invocation, context) {
      try {
        const { options } = invocation;
        const runId = optionalText(options, "run-id");
        const taskId = optionalText(options, "task-id");
        const attemptId = optionalText(options, "attempt-id");
        const generationText = optionalText(options, "generation");
        const proposalId = optionalText(options, "proposal-id");
        const adapterId = optionalText(options, "adapter-id");
        const idempotencyKey = optionalText(options, "idempotency-key");
        const call = {
          method: definition.method,
          observationCursor: jsonOption(options, "cursor"),
          workspaceId: requiredText(options, "workspace-id"),
          input: jsonOption(options, "input"),
          ...(runId === undefined ? {} : { runId }),
          ...(taskId === undefined ? {} : { taskId }),
          ...(attemptId === undefined ? {} : { attemptId }),
          ...(generationText === undefined ? {} : { generation: Number(generationText) }),
          ...(proposalId === undefined ? {} : { proposalId }),
          ...(adapterId === undefined ? {} : { adapterId }),
          ...(idempotencyKey === undefined ? {} : { idempotencyKey }),
          ...(options.resume === undefined ? {} : { resume: jsonOption(options, "resume") }),
        } as unknown as CoordinatorCallV1;

        if (generationText !== undefined && (!Number.isSafeInteger(call.generation) || (call.generation ?? 0) < 0)) {
          throw new Error("--generation must be a non-negative integer");
        }
        if (definition.idempotency === "required" && call.idempotencyKey === undefined) {
          throw new Error("--idempotency-key is required");
        }
        if (definition.idempotency === "forbidden" && call.idempotencyKey !== undefined) {
          throw new Error("--idempotency-key is forbidden");
        }

        const result = await new CoordinatorClientV1(context.transport, context.credential).call(call);
        return cliSuccessV1(name, result as unknown as JsonValue);
      } catch (error) {
        const message = error instanceof Error ? error.message : "coordinator call failed";
        return cliFailureV1(name, "COORDINATOR_CALL_FAILED", message, null);
      }
    },
  };
}

export function registerCoordinatorCommandsV1(registry: CliCommandRegistryV1): void {
  for (const definition of METHOD_REGISTRY_V1) registry.register(genericCoordinatorDefinition(definition));
}

export function requiredInstallerRuntimeV1(context: CliExecutionContextV1): InstallerCliRuntimeV1 {
  if (context.installer === undefined) throw new Error("installer runtime is unavailable");
  return context.installer;
}

export function createDefaultCliCommandRegistryV1(): CliCommandRegistryV1 {
  const registry = new CliCommandRegistryV1();
  registerCoordinatorCommandsV1(registry);
  return registry;
}
