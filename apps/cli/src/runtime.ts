import type { AuthorizedProtocolTransportV1, OpaqueCredentialReferenceV1 } from "@horseness/sdk";
import { CliParseErrorV1, parseCliInvocationV1 } from "./parser.js";
import { createDefaultCliCommandRegistryV1, type CliCommandRegistryV1, type CliExecutionContextV1, type InstallerCliRuntimeV1 } from "./registry.js";
import { cliFailureV1, renderCliHumanV1, renderCliJsonV1, type CliResultV1 } from "./result.js";
import { renderCliHelpV1 } from "./help.js";

export interface CliRuntimeDependenciesV1 {
  readonly transport: AuthorizedProtocolTransportV1;
  readonly credential: OpaqueCredentialReferenceV1;
  readonly registry?: CliCommandRegistryV1;
  readonly stdout?: (text: string) => void;
  readonly stderr?: (text: string) => void;
  readonly authorityTime?: () => string;
  readonly installer?: InstallerCliRuntimeV1;
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
    ...(dependencies.installer === undefined ? {} : { installer: dependencies.installer }),
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
  const words = [initial.command, ...initial.args];
  let definition = registry.resolve(words.join(" "));
  for (let length = words.length - 1; definition === undefined && length > 0; length -= 1) {
    definition = registry.resolve(words.slice(0, length).join(" "));
  }
  const helpTarget = initial.command === "help" ? initial.args.join(" ") : definition?.name ?? words.join(" ");
  const group = registry.list().some((entry) => entry.name.startsWith(`${helpTarget} `));
  if (initial.command === "help" || initial.options.help === true || (definition === undefined && group)) {
    if (helpTarget !== "" && registry.resolve(helpTarget) === undefined && !group) {
      writeResult(cliFailureV1(helpTarget, "UNKNOWN_COMMAND", "Unknown command. Run horseness --help.", null, 2), initial.outputMode, [], context);
      return 2;
    }
    // Registry help contains option names such as "credential", never their values.
    // Secret-pattern redaction applies to operation results, not this static text.
    const help = renderCliHelpV1(registry, helpTarget || undefined, initial.options.all === true).trimEnd();
    context.stdout(initial.outputMode === "json" ? `${JSON.stringify({ command: "help", data: help, ok: true, schemaVersion: "1" })}\n` : `${help}\n`);
    return 0;
  }
  if (definition === undefined) {
    const failure = cliFailureV1(initial.command, "UNKNOWN_COMMAND", `Unknown command ${words.join(" ")}. Run horseness --help.`, null, 2);
    writeResult(failure, initial.outputMode, [], context);
    return 2;
  }

  let invocation;
  try {
    invocation = parseCliInvocationV1(argv, definition);
    if (invocation.args.length > 0) throw new CliParseErrorV1("INVALID_INVOCATION", `Unexpected arguments. Usage: horseness ${definition.usage}`, definition.name);
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
    return result.exitCode ?? (result.ok ? 0 : 1);
  } catch (error) {
    const message = error instanceof Error ? error.message : "unexpected command failure";
    const failure = cliFailureV1(definition.name, "UNEXPECTED_ERROR", message, null);
    writeResult(failure, invocation.outputMode, definition.secretOptions, context);
    return 1;
  }
}
