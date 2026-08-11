#!/usr/bin/env node
import { tsImport } from "tsx/esm/api";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { resolve } from "node:path";

const domain = await tsImport("../src/index.ts", import.meta.url);
const requested = process.argv.slice(2).filter((value) => value !== "--");
if (requested.length === 0) throw new Error("at least one vector family is required");
const root = resolve(new URL("../../../docs/vectors", import.meta.url).pathname);

const execute = (vector) => {
  switch (vector.action) {
    case "canonicalJson": return domain.canonicalJson(vector.input);
    case "domainDigest": return domain.domainDigest(vector.input.domain, vector.input.value);
    case "jsonValueDigest": return domain.jsonValueDigest(vector.input);
    case "validatePointer": return domain.validatePointer(vector.input);
    case "canonicalScope": return domain.canonicalScope(vector.input);
    case "deltaAuthorityScopeDigest": return domain.deltaAuthorityScopeDigest(vector.input);
    case "intersectScopes": return domain.intersectScopes(vector.input.left, vector.input.right);
    case "applyDelta": return domain.applyDelta(vector.input.base, vector.input.operations, vector.input.scope);
    case "sealProposal": return domain.sealProposal(vector.input);
    case "verifyProposal": domain.verifyProposal(vector.input); return "verified";
    case "authorizeCommand": return domain.authorizeCommand(vector.input);
    case "createWorkspaceGenesis": return domain.createWorkspaceGenesis(vector.input);
    case "createRunGenesis": return domain.createRunGenesis(vector.input);
    default: throw new Error(`unsupported vector action: ${vector.action}`);
  }
};

let count = 0;
for (const family of requested) {
  if (!/^[a-z][a-z-]*$/u.test(family)) throw new Error(`invalid family: ${family}`);
  const directory = resolve(root, family);
  if (!directory.startsWith(`${root}/`) || !statSync(directory).isDirectory()) throw new Error(`missing vector family: ${family}`);
  const files = readdirSync(directory).filter((name) => name.endsWith(".json")).sort();
  if (files.length === 0) throw new Error(`empty vector family: ${family}`);
  for (const file of files) {
    const vector = JSON.parse(readFileSync(resolve(directory, file), "utf8"));
    if (vector.schemaVersion !== "2" || vector.familyVersion !== "1" || vector.family !== family || typeof vector.case !== "string" || typeof vector.action !== "string" || !("input" in vector) || (!("expected" in vector) && typeof vector.expectedError !== "string")) throw new Error(`invalid vector schema: ${family}/${file}`);
    try {
      const executed = execute(vector);
      const actual = Array.isArray(vector.select) ? vector.select.reduce((value, key) => value?.[key], executed) : executed;
      if (vector.expectedError) throw new Error(`expected ${vector.expectedError}, action succeeded`);
      if (domain.canonicalJson(actual) !== domain.canonicalJson(vector.expected)) throw new Error(`result mismatch: expected ${domain.canonicalJson(vector.expected)}, received ${domain.canonicalJson(actual)}`);
    } catch (error) {
      if (!vector.expectedError || !(error instanceof domain.DomainError) || error.code !== vector.expectedError) throw error;
    }
    count += 1;
  }
}
console.log(`verified ${count} cases across ${requested.length} vector families: ${requested.join(", ")}`);
