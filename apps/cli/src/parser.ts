import type { CliCommandDefinitionV1, CliInvocationV1, CliOutputModeV1 } from "./registry.js";

export class CliParseErrorV1 extends Error {
  readonly code: "INVALID_INVOCATION" | "UNKNOWN_COMMAND" | "UNKNOWN_OPTION";
  readonly command: string;

  constructor(code: CliParseErrorV1["code"], message: string, command = "cli") {
    super(message);
    this.name = "CliParseErrorV1";
    this.code = code;
    this.command = command;
  }
}

export function parseCliInvocationV1(argv: readonly string[], definition?: CliCommandDefinitionV1): CliInvocationV1 {
  let outputMode: CliOutputModeV1 = "human";
  const positional: string[] = [];
  const options: Record<string, string | boolean> = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === undefined) continue;

    if (token === "--json") {
      outputMode = "json";
      continue;
    }
    if (token === "--help" || token === "-h") {
      options.help = true;
      continue;
    }
    if (token === "--") {
      positional.push(...argv.slice(index + 1));
      break;
    }
    if (!token.startsWith("--")) {
      positional.push(token);
      continue;
    }

    const equalsIndex = token.indexOf("=");
    const name = token.slice(2, equalsIndex < 0 ? undefined : equalsIndex);
    const command = definition?.name ?? positional[0];
    if (name.length === 0) {
      throw new CliParseErrorV1("INVALID_INVOCATION", "empty option name", positional[0]);
    }
    if (definition !== undefined && !(definition.optionNames ?? []).includes(name)) {
      throw new CliParseErrorV1("UNKNOWN_OPTION", `unknown option --${name}`, definition.name);
    }
    if (Object.hasOwn(options, name)) {
      throw new CliParseErrorV1("INVALID_INVOCATION", `duplicate option --${name}`, command);
    }

    if (equalsIndex >= 0) {
      const value = token.slice(equalsIndex + 1);
      if (value.length === 0) {
        throw new CliParseErrorV1("INVALID_INVOCATION", `--${name} requires a value`, command);
      }
      options[name] = value;
      continue;
    }

    const next = argv[index + 1];
    if (next !== undefined && next !== "-h" && !next.startsWith("--")) {
      options[name] = next;
      index += 1;
    } else {
      options[name] = true;
    }
  }
  const first = positional.shift();
  if (first === undefined) {
    if (options.help === true || argv.length === 0 || (argv.length === 1 && outputMode === "json")) {
      return { command: "help", args: [], options, outputMode };
    }
    throw new CliParseErrorV1("INVALID_INVOCATION", "Choose a command; run horseness --help.");
  }
  let command = first;
  if (definition !== undefined) {
    const spelling = [definition.name, ...definition.aliases].find((name) => {
      const words = name.split(" ");
      return words[0] === first && words.slice(1).every((word, index) => positional[index] === word);
    });
    if (spelling !== undefined) {
      positional.splice(0, spelling.split(" ").length - 1);
      command = definition.name;
    }
  }
  return { command, args: positional, options, outputMode };
}
