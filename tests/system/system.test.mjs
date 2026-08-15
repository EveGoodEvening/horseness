import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { requirePackageTests, requireSuccess } from "./process-helper.mjs";

const nodePackageTests = [
  {
    name: "completion predicates remain closed across every non-accepted terminal and revocation edge",
    packageName: "@horseness/domain",
    files: ["test/state-machines.test.ts", "test/protocol-contracts.test.ts", "test/domain.test.ts", "test/vector-contracts.test.ts"],
  },
  {
    name: "real daemon, SQLite authority, endpoint ownership, cursor, and multiprocess lifecycle integrate",
    packageName: "@horseness/daemon",
    files: ["test/server.test.ts", "test/multiprocess.test.ts"],
  },
  {
    name: "public packed CLI drives a real daemon and SQLite database without internal state access",
    packageName: "@horseness/cli",
    files: ["test/smoke-packed.test.ts", "test/core.test.ts", "test/lifecycle.test.ts"],
  },
];

for (const group of nodePackageTests) {
  test(group.name, { timeout: 240_000 }, async () => {
    await requirePackageTests(group);
  });
}

const blackboxes = [
  {
    name: "neutral bundle installs and recovers online through the public bootstrap executable",
    args: (root) => ["pnpm", "run", "install:blackbox", "--", "--clean-home", "--workspace", join(root, "workspace"), "--create-workspace", "--host", "all", "--accept-executable-risk", "fixture-release-digest"],
  },
  {
    name: "neutral bundle installs and recovers offline through the same public lifecycle",
    args: (root) => ["pnpm", "run", "install:blackbox:offline", "--", "--clean-home", "--workspace", join(root, "workspace"), "--create-workspace", "--host", "all", "--accept-executable-risk", "fixture-release-digest"],
  },
  {
    name: "installer hostile doctor is bounded, redacted, and has no side effects",
    args: () => ["pnpm", "run", "doctor:hostile-no-side-effects"],
  },
  {
    name: "uninstall resumes every journaled crash boundary and leaves no live contribution",
    args: () => ["pnpm", "run", "uninstall:failure-matrix"],
  },
  {
    name: "packed CLI completes install, upgrade, downgrade, rollback, retry, repair, rebind, smoke, and uninstall",
    args: () => ["pnpm", "run", "cli:lifecycle:blackbox", "--", "install", "upgrade", "downgrade", "rollback", "retry-install", "uninstall", "doctor", "repair", "rebind-workspace", "smoke"],
  },
];

async function runBlackbox(scenario) {
  const root = await mkdtemp(join(tmpdir(), "horseness-c21-system-"));
  try {
    await requireSuccess(scenario.name, "corepack", scenario.args(root), { timeoutMs: 290_000 });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

for (const scenario of blackboxes) {
  test(scenario.name, { timeout: 300_000 }, async () => {
    await runBlackbox(scenario);
  });
}
