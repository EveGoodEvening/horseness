#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { resolve } from "node:path";

const canonical = (value) => {
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return Object.is(value, -0) ? "0" : JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
};
const digest = (domain, value) => createHash("sha256").update(`${domain}\0${canonical(value)}`).digest("hex");
const requested = process.argv.slice(2).filter((value) => value !== "--");
if (requested.length === 0) throw new Error("at least one vector family is required");
const root = resolve(new URL("../../../docs/vectors", import.meta.url).pathname);
for (const family of requested) {
  if (!/^[a-z][a-z-]*$/u.test(family)) throw new Error(`invalid family: ${family}`);
  const directory = resolve(root, family);
  if (!directory.startsWith(`${root}/`) || !statSync(directory).isDirectory()) throw new Error(`missing vector family: ${family}`);
  const files = readdirSync(directory).filter((name) => name.endsWith(".json")).sort();
  if (files.length === 0) throw new Error(`empty vector family: ${family}`);
  for (const file of files) {
    const vector = JSON.parse(readFileSync(resolve(directory, file), "utf8"));
    if (vector.schemaVersion !== "1" || vector.family !== family || typeof vector.case !== "string" || typeof vector.domain !== "string" || !("value" in vector)) throw new Error(`invalid vector schema: ${family}/${file}`);
    const canonicalBytes = canonical(vector.value);
    if (canonicalBytes !== vector.canonicalJson) throw new Error(`canonical mismatch: ${family}/${file}`);
    if (digest(vector.domain, vector.value) !== vector.digest) throw new Error(`digest mismatch: ${family}/${file}`);
  }
}
console.log(`verified ${requested.length} vector families: ${requested.join(", ")}`);
