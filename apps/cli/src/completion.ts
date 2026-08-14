import type { CliCommandRegistryV1 } from "./registry.js";
export function renderCliCompletionV1(registry: CliCommandRegistryV1, shell: "bash" | "zsh" | "fish"): string {
  const names = registry.list().map((definition) => definition.name).join(" ");
  if (shell === "fish") return `complete -c horseness -f -a '${names}'\n`;
  const functionName = shell === "zsh" ? "_horseness" : "_horseness_completion";
  return `${functionName}() { COMPREPLY=( $(compgen -W '${names}' -- \"${"${COMP_WORDS[COMP_CWORD]}"}\") ); }\ncomplete -F ${functionName} horseness\n`;
}
