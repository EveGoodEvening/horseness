import { access, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import {
  RELEASE_ROOT,
  canonical,
  loadCandidate,
  parseArgs,
  registryIntegrity,
  registryTagVersion,
  run,
} from "./lib.mjs";

async function installAndSmoke(packages, runCommand = run) {
  const root = await mkdtemp(join(tmpdir(), "horseness-npm-public-"));
  try {
    const dependencies = Object.fromEntries(packages.map((item) => [item.name, item.version]));
    await writeFile(resolve(root, "package.json"), `${JSON.stringify({ private: true, type: "module", dependencies })}\n`, { mode: 0o600 });
    await runCommand("npm", ["install", "--ignore-scripts", "--no-fund", "--loglevel=error"], {
      cwd: root,
      code: "PUBLIC_INSTALL_FAILED",
      limit: 4 * 1024 * 1024,
    });
    await runCommand("npm", ["audit", "signatures"], {
      cwd: root,
      code: "PUBLIC_SIGNATURE_AUDIT_FAILED",
      limit: 4 * 1024 * 1024,
    });
    const smokePath = resolve(root, "smoke.mjs");
    await writeFile(smokePath, `const names=${JSON.stringify(packages.map((item) => item.name))};for(const name of names){const value=await import(name);if(value===null||typeof value!=="object")throw new Error(\`PACKAGE_IMPORT_INVALID:\${name}\`)}process.stdout.write(JSON.stringify({schema:"horseness.public-package-smoke.v1",packages:names.length})+"\\n");\n`, { mode: 0o600 });
    await runCommand(process.execPath, ["--import", "tsx", smokePath], {
      cwd: root,
      code: "PUBLIC_IMPORT_SMOKE_FAILED",
      limit: 4 * 1024 * 1024,
    });
    const cli = resolve(root, "node_modules", ".bin", process.platform === "win32" ? "horseness.cmd" : "horseness");
    await access(cli);
    const cliResult = await runCommand("npm", ["exec", "--", "horseness"], {
      cwd: root,
      code: "PUBLIC_CLI_SMOKE_FAILED",
      limit: 1024 * 1024,
      allowedStatuses: [2],
    });
    if (cliResult.status !== 2 || !cliResult.stderr.includes("INVALID_INVOCATION")) throw new Error("PUBLIC_CLI_SMOKE_INVALID");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

const defaultOperations = {
  getIntegrity: registryIntegrity,
  getTag: registryTagVersion,
  installAndSmoke,
};

export async function verifyPublicPackages(packages, operations = defaultOperations) {
  for (const item of packages) {
    if (await operations.getIntegrity(item.name, item.version) !== item.integrity) throw new Error(`PUBLIC_PACKAGE_INTEGRITY_MISMATCH:${item.name}@${item.version}`);
    if (await operations.getTag(item.name, "next") !== item.version) throw new Error(`PUBLIC_NEXT_TAG_MISMATCH:${item.name}`);
  }
  await operations.installAndSmoke(packages);
}

export async function verifyPublic(candidatePath, operations = defaultOperations, expectedVersion) {
  const candidate = await loadCandidate(candidatePath);
  if (expectedVersion !== undefined && candidate.manifest.version !== expectedVersion) throw new Error("PUBLIC_CANDIDATE_VERSION_MISMATCH");
  await verifyPublicPackages(candidate.packages, operations);
  return {
    schema: "horseness.public-packages-verified.v1",
    version: candidate.manifest.version,
    packages: candidate.packages.length,
    platform: process.platform,
    architecture: process.arch,
  };
}

if (import.meta.url === new URL(`file://${resolve(process.argv[1] ?? "")}`).href) {
  const args = parseArgs();
  for (const key of args.keys()) if (!["candidate", "version"].includes(key)) throw new Error(`UNEXPECTED_ARGUMENT:--${key}`);
  const candidate = String(args.get("candidate") ?? resolve(RELEASE_ROOT, "build-1", "release-manifest.json"));
  const version = args.get("version");
  if (typeof version !== "string") throw new Error("NPM_RELEASE_VERSION_REQUIRED");
  process.stdout.write(`${canonical(await verifyPublic(candidate, defaultOperations, version))}\n`);
}
