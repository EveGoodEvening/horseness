import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { ROOT, canonical, inventory, provenanceSubjects, readJson, sha256, verifyEd25519 } from "./lib.mjs";
const record = await readJson(resolve(ROOT, "docs/trust/root-ceremony-v1.json")); const delegation = record.delegation;
for (const buildName of ["build-1", "build-2"]) {
  const root = resolve(ROOT, ".acceptance", buildName); const manifest = await readJson(resolve(root, "release-manifest.json")); const sbom = await readJson(resolve(root, "sbom.cdx.json")); const provenanceBytes = await readFile(resolve(root, "provenance.intoto.jsonl"));
  if (sbom.bomFormat !== "CycloneDX" || sbom.specVersion !== "1.6" || manifest.schema !== "horseness.release-candidate.v1") throw new Error("RELEASE_METADATA_INVALID");
  const actual = (await inventory(root)).filter((item) => !["release-manifest.json", "release-manifest.sig", "provenance.sig"].includes(item.path)); if (canonical(actual) !== canonical(manifest.artifacts)) throw new Error("RELEASE_MANIFEST_INVENTORY_MISMATCH");
  const manifestSignature = JSON.parse(await readFile(resolve(root, "release-manifest.sig"), "utf8")); const provenanceSignature = JSON.parse(await readFile(resolve(root, "provenance.sig"), "utf8"));
  const manifestDigest = sha256(canonical(manifest)); const provenanceDigest = sha256(provenanceBytes);
  if (manifestSignature.keyId !== delegation.keyId || manifestSignature.payloadDigest !== manifestDigest || !verifyEd25519(delegation.publicKeyPem, Buffer.from(manifestDigest), manifestSignature.signature)) throw new Error("RELEASE_MANIFEST_SIGNATURE_INVALID");
  if (provenanceSignature.keyId !== delegation.keyId || provenanceSignature.payloadDigest !== provenanceDigest || !verifyEd25519(delegation.publicKeyPem, Buffer.from(provenanceDigest), provenanceSignature.signature)) throw new Error("RELEASE_PROVENANCE_SIGNATURE_INVALID");
  const statement = JSON.parse(provenanceBytes.toString("utf8"));
  const packageArtifacts = manifest.artifacts.filter((item) => item.path.startsWith("packages/")).map((item) => ({ ...item, path: item.path.slice("packages/".length) }));
  if (statement.predicateType !== "https://slsa.dev/provenance/v1" || canonical(statement.subject) !== canonical(provenanceSubjects(packageArtifacts))) throw new Error("PROVENANCE_SUBJECT_MISMATCH");
}
process.stdout.write("Verified SBOM, provenance, and delegated signatures for both builds\n");
