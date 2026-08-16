import { access, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { tmpdir } from "node:os";
import {
  RELEASE_ROOT,
  canonical,
  loadCandidate,
  parseArgs,
  run,
} from "./lib.mjs";

async function installAndSmoke(packages, runCommand = run) {
  const root = await mkdtemp(join(tmpdir(), "horseness-npm-candidate-"));
  try {
    const dependencies = Object.fromEntries(packages.map((item) => [item.name, pathToFileURL(item.tarballPath).href]));
    await writeFile(resolve(root, "package.json"), `${JSON.stringify({ private: true, type: "module", dependencies })}\n`, { mode: 0o600 });
    await runCommand("npm", ["install", "--ignore-scripts", "--no-audit", "--no-fund", "--loglevel=error"], {
      cwd: root,
      code: "CANDIDATE_INSTALL_FAILED",
      limit: 4 * 1024 * 1024,
    });
    const smokePath = resolve(root, "smoke.mjs");
    await writeFile(smokePath, `const names=${JSON.stringify(packages.map((item) => item.name))};for(const name of names){const value=await import(name);if(value===null||typeof value!=="object")throw new Error(\`PACKAGE_IMPORT_INVALID:\${name}\`)}process.stdout.write(JSON.stringify({schema:"horseness.package-import-smoke.v1",packages:names.length})+"\\n");\n`, { mode: 0o600 });
    await runCommand(process.execPath, ["--import", "tsx", smokePath], {
      cwd: root,
      code: "CANDIDATE_IMPORT_SMOKE_FAILED",
      limit: 4 * 1024 * 1024,
    });
    const cli = resolve(root, "node_modules", ".bin", process.platform === "win32" ? "horseness.cmd" : "horseness");
    await access(cli);
    const cliResult = await runCommand("npm", ["exec", "--", "horseness"], {
      cwd: root,
      code: "CANDIDATE_CLI_SMOKE_FAILED",
      limit: 1024 * 1024,
      allowedStatuses: [2],
    });
    if (cliResult.status !== 2 || !cliResult.stderr.includes("INVALID_INVOCATION")) throw new Error("CANDIDATE_CLI_SMOKE_INVALID");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

export async function verifyCandidate(candidatePath, comparisonPath, options = {}) {
  const first = await loadCandidate(candidatePath);
  const second = await loadCandidate(comparisonPath);
  if (canonical(first.manifest) !== canonical(second.manifest)) throw new Error("RELEASE_BUILDS_NOT_REPRODUCIBLE");
  await (options.installAndSmoke ?? installAndSmoke)(first.packages, options.runCommand ?? run);
  return {
    schema: "horseness.npm-candidate-verified.v1",
    version: first.manifest.version,
    packages: first.packages.length,
  };
}

if (import.meta.url === new URL(`file://${resolve(process.argv[1] ?? "")}`).href) {
  const args = parseArgs();
  for (const key of args.keys()) if (!["candidate", "comparison"].includes(key)) throw new Error(`UNEXPECTED_ARGUMENT:--${key}`);
  const candidate = String(args.get("candidate") ?? resolve(RELEASE_ROOT, "build-1", "release-manifest.json"));
  const comparison = String(args.get("comparison") ?? resolve(RELEASE_ROOT, "build-2", "release-manifest.json"));
  process.stdout.write(`${canonical(await verifyCandidate(candidate, comparison))}\n`);
}
