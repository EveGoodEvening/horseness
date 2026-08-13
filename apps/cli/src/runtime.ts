import type { AuthorizedProtocolTransportV1, OpaqueCredentialReferenceV1 } from "@horseness/sdk";
import { CliParseErrorV1, parseCliInvocationV1 } from "./parser.js";
import { createDefaultCliCommandRegistryV1, type CliCommandRegistryV1, type CliExecutionContextV1 } from "./registry.js";
import { cliFailureV1, renderCliHumanV1, renderCliJsonV1, type CliResultV1 } from "./result.js";

export interface CliRuntimeDependenciesV1 {
  readonly transport: AuthorizedProtocolTransportV1;
  readonly credential: OpaqueCredentialReferenceV1;
  readonly registry?: CliCommandRegistryV1;
  readonly stdout?: (text: string) => void;
  readonly stderr?: (text: string) => void;
  readonly authorityTime?: () => string;
}

function writeResult(result: CliResultV1, mode: "human" | "json", secretOptions: readonly string[], context: CliExecutionContextV1): void {
  const rendered = mode === "json" ? renderCliJsonV1(result, secretOptions) : renderCliHumanV1(result, secretOptions);
  if (mode === "json" || result.ok) {
    context.stdout(rendered);
  } else {
    context.stderr(rendered);
  }
}

export async function runCliV1(argv: readonly string[], dependencies: CliRuntimeDependenciesV1): Promise<number> {
  const context: CliExecutionContextV1 = {
    transport: dependencies.transport,
    credential: dependencies.credential,
    stdout: dependencies.stdout ?? ((text) => process.stdout.write(text)),
    stderr: dependencies.stderr ?? ((text) => process.stderr.write(text)),
    authorityTime: dependencies.authorityTime ?? (() => new Date().toISOString()),
  };
  const registry = dependencies.registry ?? createDefaultCliCommandRegistryV1();
  let initial;
  try {
    initial = parseCliInvocationV1(argv);
  } catch (error) {
    const command = error instanceof CliParseErrorV1 ? error.command : "cli";
    const message = error instanceof Error ? error.message : "invalid invocation";
    const failure = cliFailureV1(command, "INVALID_INVOCATION", message, null);
    writeResult(failure, argv.includes("--json") ? "json" : "human", [], context);
    return 2;
  }
  const definition = registry.resolve(initial.command);
  if (definition === undefined) {
    const failure = cliFailureV1(initial.command, "UNKNOWN_COMMAND", `unknown command ${initial.command}`, null);
    writeResult(failure, initial.outputMode, [], context);
    return 2;
  }

  let invocation;
  try {
    invocation = parseCliInvocationV1(argv, definition);
  } catch (error) {
    const code = error instanceof CliParseErrorV1 ? error.code : "INVALID_INVOCATION";
    const message = error instanceof Error ? error.message : "invalid invocation";
    const failure = cliFailureV1(definition.name, code, message, null);
    writeResult(failure, initial.outputMode, definition.secretOptions, context);
    return 2;
  }
  try {
    const result = await definition.execute({ ...invocation, command: definition.name }, context);
    writeResult(result, invocation.outputMode, definition.secretOptions, context);
    return result.ok ? 0 : 1;
  } catch (error) {
    const message = error instanceof Error ? error.message : "unexpected command failure";
    const failure = cliFailureV1(definition.name, "UNEXPECTED_ERROR", message, null);
    writeResult(failure, invocation.outputMode, definition.secretOptions, context);
    return 1;
  }
}
