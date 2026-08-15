import assert from "node:assert/strict";

const HOSTS = ["pi", "omp", "claude", "codex"];
const HOSTS_ARGUMENT = "pi,omp,claude,codex";
const USAGE = "usage: test:closed-loop -- --hosts pi,omp,claude,codex";

export function parseHosts(argv) {
  const args = argv[0] === "--" ? argv.slice(1) : argv;
  assert.equal(args.length, 2, USAGE);
  assert.equal(args[0], "--hosts", "the only accepted option is --hosts");
  assert.equal(args[1], HOSTS_ARGUMENT, "--hosts must be exactly pi,omp,claude,codex in dependency order");
  return [...HOSTS];
}
