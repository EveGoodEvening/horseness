import type { CliCommandRegistryV1 } from "./registry.js";
export function renderCliHelpV1(registry: CliCommandRegistryV1, command?: string): string {
  if (command !== undefined) { const definition = registry.resolve(command); if (definition === undefined) return `unknown command ${command}\n`; return `${definition.name}: ${definition.summary}\nusage: horseness ${definition.usage}\n`; }
  return `Horseness commands:\n${registry.list().map((definition) => `  ${definition.name.padEnd(24)} ${definition.summary}`).join("\n")}\n`;
}
