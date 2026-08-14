import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const argument = process.argv.indexOf("--version");
const version = argument >= 0 ? process.argv[argument + 1] : undefined;
if (version !== "0.0.0-compat.1") throw new Error("COMPAT_TRAIN_VERSION_UNSUPPORTED");
const sourceRoot = resolve(root, "tests/fixtures/compat-train/packed-home");
const names = ["cli.json", "daemon.json", "database.json", "journal.json"];
const files = Object.fromEntries(await Promise.all(names.map(async (name) => [name, await readFile(resolve(sourceRoot, name), "utf8")])));
const canonical = (value) => {
  if (value === null || typeof value === "boolean" || typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number") return String(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
};
const bytes = `${canonical({ files, schema: "horseness.compat-train-artifact.v1", version })}\n`;
const output = resolve(root, `tests/fixtures/compat-train/build/compat-train-${version}.tgz`);
await mkdir(dirname(output), { recursive: true, mode: 0o700 });
await writeFile(output, bytes, { mode: 0o600 });
const digest = createHash("sha256").update(bytes).digest("hex");
process.stdout.write(`${JSON.stringify({ artifactDigest: digest, bytes: Buffer.byteLength(bytes), schema: "horseness.compat-train-build-result.v1", version })}\n`);
