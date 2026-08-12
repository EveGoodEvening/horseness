import { readFile } from "node:fs/promises";
import { canonicalJson, evidenceDigest } from "./contracts.mjs";

export async function runDeterministicProvider(manifest, fixtureRoot = process.cwd()) {
  if (manifest.provider.network !== "disabled" || manifest.provider.credentials !== "disabled") throw new Error("provider isolation disabled");
  const request = JSON.parse(await readFile(new URL(manifest.provider.requestFixture, `file://${fixtureRoot.replace(/\/$/, "")}/`), "utf8"));
  const response = JSON.parse(await readFile(new URL(manifest.provider.responseFixture, `file://${fixtureRoot.replace(/\/$/, "")}/`), "utf8"));
  const evidence = {
    providerIdentity: manifest.provider.identity,
    clock: manifest.provider.clock,
    budget: manifest.provider.budget,
    request,
    response
  };
  return { request, response, evidence, bytes: canonicalJson(response), digest: evidenceDigest(evidence) };
}
