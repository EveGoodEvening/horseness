import type { CliCommandRegistryV1 } from "./registry.js";
export function renderCliCompletionV1(registry: CliCommandRegistryV1, shell: "bash" | "zsh" | "fish"): string {
  const names = registry.list().map((definition) => definition.name);
  const roots = [...new Set(names.map((name) => name.split(" ")[0]!))];
  const groups = roots.map((root) => [root, names.filter((name) => name.startsWith(`${root} `)).map((name) => name.slice(root.length + 1))] as const).filter(([, children]) => children.length > 0);
  if (shell === "fish") {
    return `complete -c horseness -f -n '__fish_use_subcommand' -a '${roots.join(" ")}'\n${groups.map(([root, children]) => `complete -c horseness -f -n '__fish_seen_subcommand_from ${root}; and not __fish_seen_subcommand_from ${children.join(" ")}' -a '${children.join(" ")}'`).join("\n")}\n`;
  }
  const cases = groups.map(([root, children]) => `      ${root}) choices=(${children.join(" ")});;`).join("\n");
  if (shell === "zsh") return `_horseness() {\n  local -a choices\n  if (( CURRENT == 2 )); then\n    choices=(${roots.join(" ")})\n  elif (( CURRENT == 3 )); then\n    case "$words[2]" in\n${cases}\n    esac\n  fi\n  compadd -- $choices\n}\ncompdef _horseness horseness\n`;
  return `_horseness_completion() {\n  local -a choices=()\n  if (( COMP_CWORD == 1 )); then\n    choices=(${roots.join(" ")})\n  elif (( COMP_CWORD == 2 )); then\n    case "${"${COMP_WORDS[1]}"}" in\n${cases}\n    esac\n  fi\n  COMPREPLY=( $(compgen -W "${"${choices[*]}"}" -- "${"${COMP_WORDS[COMP_CWORD]}"}") )\n}\ncomplete -F _horseness_completion horseness\n`;
}
