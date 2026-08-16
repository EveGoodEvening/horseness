import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { C22_COMMANDS, ROOT } from "./lib.mjs";

const manifest = JSON.parse(await readFile(resolve(ROOT, "package.json"), "utf8"));
const expected = {
  "release:docs-lint": "markdownlint-cli2 README.md README.zh.md CHANGELOG.md docs/architecture.md docs/plan.md docs/progress.md docs/progress/C22.md docs/adr/0009-npm-first-release.md docs/release-process.md docs/trust-root.md docs/install.md docs/compatibility.md docs/migrations.md",
  "release:coherence": "node scripts/release/coherence.mjs",
  "release:build-twice": "node scripts/release/build-twice.mjs",
  "release:verify-candidate": "node scripts/release/verify-candidate.mjs",
  "release:publish-next": "node scripts/release/publish-next.mjs",
  "release:verify-public": "node scripts/release/verify-public.mjs",
  "release:promote-latest": "node scripts/release/promote-latest.mjs",
  "release:verify-no-static-secrets": "node scripts/release/verify-no-static-secrets.mjs",
  "release:verify-commands": "node scripts/release/verify-commands.mjs",
  "release:test": "node --test scripts/release/test/*.test.mjs",
};
for (const [key, value] of Object.entries(expected)) {
  if (manifest.scripts?.[key] !== value) throw new Error(`RELEASE_COMMAND_MISMATCH:${key}`);
}
if (C22_COMMANDS.length !== 9 || new Set(C22_COMMANDS).size !== 9) throw new Error("C22_COMMAND_CONTRACT_INVALID");
if (C22_COMMANDS[0] !== "corepack pnpm install --frozen-lockfile" || C22_COMMANDS[8] !== "corepack pnpm run boundaries:check") throw new Error("C22_COMMAND_ORDER_INVALID");
process.stdout.write(`Verified ${Object.keys(expected).length} release forwarding keys and ${C22_COMMANDS.length} acceptance commands\n`);
