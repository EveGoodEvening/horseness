import type { CliCommandRegistryV1 } from "./registry.js";
export function renderCliHelpV1(registry: CliCommandRegistryV1, command?: string, includeProtocol = false): string {
  const definitions = registry.list();
  if (command !== undefined) {
    const definition = registry.resolve(command);
    if (definition !== undefined) {
      return `${definition.summary}\n\nUsage: horseness ${definition.usage}\n\nOptions:\n${(definition.optionNames ?? []).map((name) => `  --${name}`).join("\n")}\n  --json   Output one machine-readable result\n  -h, --help   Show this help\n`;
    }
    const children = definitions.filter((entry) => entry.name.startsWith(`${command} `));
    if (children.length === 0) return `Unknown command ${command}. Run horseness --help.\n`;
    return `Usage: horseness ${command} <command>\n\n${children.map((entry) => `  ${entry.name.padEnd(20)} ${entry.summary}`).join("\n")}\n\nUse horseness ${command} <command> --help for options.\n`;
  }
  const workflows = definitions.filter((entry) => entry.category === "workflow");
  const administration = definitions.filter((entry) => entry.category === undefined);
  const protocol = definitions.filter((entry) => entry.category === "protocol");
  const lines = ["Horseness — local workspace coordination", "", "Quick start:", "  horseness init", '  horseness run create --title "Fix login"', '  horseness task add --title "Inspect authentication"', "  horseness status", "", "Everyday commands:", ...workflows.map((entry) => `  ${entry.name.padEnd(20)} ${entry.summary}`)];
  if (administration.length > 0) lines.push("", "Administration:", ...administration.map((entry) => `  ${entry.name.padEnd(20)} ${entry.summary}`));
  if (includeProtocol) lines.push("", "Low-level protocol commands (explicit cursor and JSON input):", ...protocol.map((entry) => `  ${entry.name.padEnd(28)} ${entry.summary}`));
  lines.push("", "Run horseness <command> --help for options; horseness help --all for protocol commands.", "Use --json for scripts. Workflows discover the initialized workspace from the current directory", "or accept --workspace PATH. Task addition records a draft; it does not launch a worker.");
  return `${lines.join("\n")}\n`;
}
