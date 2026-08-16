import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import { chmod, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { canonical, C22_COMMANDS, PUBLISHABLE_MANIFESTS, RELEASE_IDENTITY, provenanceSubjects, reconcileImmutableObject, run, sha256 } from "../lib.mjs";
import { verifyCoherence } from "../coherence.mjs";
import { verifyRootCeremony, verifyRootCeremonyCommand } from "../verify-root-ceremony.mjs";
import { appendSignedJournal } from "../side-effect-journal.mjs";

function pair() { const value = generateKeyPairSync("ed25519"); return { privateKey: value.privateKey, publicKeyPem: value.publicKey.export({ type: "spki", format: "pem" }).toString(), fingerprint: `sha256:${sha256(value.publicKey.export({ type: "spki", format: "der" }))}` }; }
const digest = (value) => `sha256:${sha256(value)}`;
async function ceremonyFixture() {
  const root = await mkdtemp(resolve(tmpdir(), "horseness-c22-ceremony-")); const evidence = resolve(root, "evidence"); await mkdir(evidence); const rootA = pair(); const rootB = pair(); const recovery = pair(); const release = pair();
  const receipts = []; for (const name of ["custody-a.txt", "custody-b.txt", "destroy-a.txt", "destroy-b.txt"]) { const bytes = Buffer.from(name); await writeFile(resolve(evidence, name), bytes); receipts.push({ path: name, sha256: digest(bytes) }); }
  const rootKeys = [["root-a", rootA], ["root-b", rootB]].map(([keyId, key]) => ({ keyId, algorithm: "Ed25519", publicKeyPem: key.publicKeyPem, spkiFingerprint: key.fingerprint, hardwareSerialDigest: digest(`${keyId}-hardware`), generationTool: "node", generationToolVersion: process.version, entropySourceDigest: digest(`${keyId}-entropy`) }));
  const kmsPolicy = { ...RELEASE_IDENTITY, branch: "refs/heads/main", approvalCount: 2, keyResourceDigest: digest("kms") }; const approvals = ["a", "b"].map((name) => ({ reviewerIdentityDigest: digest(`reviewer-${name}`), approvalDigest: digest(`approval-${name}`) })); const core = { keyId: "release-kms-v1", publicKeyPem: release.publicKeyPem, validFromSequence: 1, validThroughSequence: 10, versionRange: { minimum: "1.0.0", maximum: "1.9.9" }, kmsPolicy, approvals }; const installerCore = { keyId: core.keyId, publicKeyPem: core.publicKeyPem, validFromSequence: 1, validThroughSequence: 10 };
  const delegation = { ...core, rootSignatures: [["root-a", rootA], ["root-b", rootB]].map(([keyId, key]) => ({ keyId, signature: sign(null, Buffer.from(canonical(core)), key.privateKey).toString("base64") })), installerRootKeyId: "root-a", installerRootSignature: sign(null, Buffer.from(canonical(installerCore)), rootA.privateKey).toString("base64") };
  const recoveryKey = { keyId: "recovery", algorithm: "Ed25519", publicKeyPem: recovery.publicKeyPem, spkiFingerprint: recovery.fingerprint, hardwareSerialDigest: digest("recovery-hardware"), generationTool: "node", generationToolVersion: process.version, entropySourceDigest: digest("recovery-entropy") };
  const record = { schema: "horseness.root-ceremony.v1", ceremonyId: "fixture-only", performedAt: "2026-08-15T00:00:00.000Z", offline: true, threshold: "2-of-2", rootKeys, recovery: { key: recoveryKey, authorization: "2-of-3", sealedMediaReceiptDigests: [digest("m1"), digest("m2"), digest("m3")], custodianIdentityDigests: [digest("c1"), digest("c2"), digest("c3")] }, witnesses: ["w1", "w2"].map((name) => ({ identity: name, identityDigest: digest(name), attestationDigest: digest(`attest-${name}`) })), custodyReceipts: receipts.slice(0, 2), destructionReceipts: receipts.slice(2), delegation };
  const recordPath = resolve(root, "record.json"); await writeFile(recordPath, `${canonical(record)}\n`); return { root, evidence, recordPath, record, release };
}

test("command contract is exact and nonduplicated", () => { assert.equal(C22_COMMANDS.length, 11); assert.equal(new Set(C22_COMMANDS).size, 11); assert.equal(C22_COMMANDS[0], "corepack pnpm run release:verify-root-ceremony -- --schema docs/trust/root-ceremony-v1.schema.json --record docs/trust/root-ceremony-v1.json --evidence docs/trust/evidence --offline --threshold 2-of-2"); assert.match(C22_COMMANDS[10], /checkpoint-subject C22/u); });
test("provenance subjects use one canonical packages path", () => {
  assert.deepEqual(provenanceSubjects([{ path: "horseness-domain-1.2.3.tgz", sha256: "a".repeat(64) }]), [{ name: "packages/horseness-domain-1.2.3.tgz", digest: { sha256: "a".repeat(64) } }]);
  assert.equal(provenanceSubjects([{ path: "nested/package.tgz", sha256: "b".repeat(64) }])[0].name, "packages/nested/package.tgz");
});

test("CI and release workflows preserve release verification and trust materialization order", async () => {
  const ci = await readFile(resolve(import.meta.dirname, "../../../.github/workflows/ci.yml"), "utf8");
  assert.match(ci, /corepack pnpm run release:test/u);
  assert.match(ci, /corepack pnpm run release:verify-commands/u);
  assert.match(ci, /corepack pnpm run release:verify-no-static-secrets/u);
  const release = await readFile(resolve(import.meta.dirname, "../../../.github/workflows/release.yml"), "utf8");
  const ceremony = release.indexOf("release:verify-root-ceremony");
  const delegation = release.indexOf("release:verify-delegation");
  const materialize = release.indexOf("release:materialize-bootstrap-trust-root");
  assert.match(release, /^\s*- run: corepack pnpm run release:verify-root-ceremony -- --schema docs\/trust\/root-ceremony-v1\.schema\.json --record docs\/trust\/root-ceremony-v1\.json --evidence docs\/trust\/evidence --offline --threshold 2-of-2\s*$/mu);
  assert.ok(ceremony >= 0 && ceremony < delegation && delegation < materialize);
  assert.match(release, /bootstrap-trust-root-sha256/u);
  const stage = await readFile(resolve(import.meta.dirname, "../../../.github/workflows/release-stage.yml"), "utf8");
  assert.ok(stage.indexOf("--expected-sha256") < stage.indexOf("release:build-twice"));
});

test("bootstrap production trust pin is build-materialized and runtime-immutable", async () => {
  const source = await readFile(resolve(import.meta.dirname, "../../../apps/bootstrap/src/index.ts"), "utf8");
  assert.doesNotMatch(source, /HORSENESS_PROJECT_TRUST_ROOT_SHA256/u);
  const pin = await readFile(resolve(import.meta.dirname, "../../../apps/bootstrap/src/trust-pin.ts"), "utf8");
  assert.match(pin, /C20 fixture-only default/u);
  assert.match(pin, /BOOTSTRAP_TRUST_MODE: "fixture" \| "production" = "fixture"/u);
  const materializer = await readFile(resolve(import.meta.dirname, "../materialize-bootstrap-trust-root.mjs"), "utf8");
  assert.match(materializer, /BOOTSTRAP_TRUST_MODE: "fixture" \| "production" = "production"/u);
  const build = await readFile(resolve(import.meta.dirname, "../../bootstrap/build.mjs"), "utf8");
  assert.match(build, /PRODUCTION_TRUST_ROOT_NOT_MATERIALIZED/u);
  assert.match(build, /process\.env\.HORSENESS_PROJECT_TRUST_ROOT =/u);
  assert.doesNotMatch(build, /HORSENESS_PROJECT_TRUST_ROOT_SHA256 \?\?=/u);
});

test("static-secret policy covers production surfaces and isolates the C20 fixture key", async () => {
  await run(process.execPath, [resolve(import.meta.dirname, "../verify-no-static-secrets.mjs")]);
  const build = await readFile(resolve(import.meta.dirname, "../../bootstrap/build.mjs"), "utf8");
  assert.match(build, /privateKey = production \? null :/u);
  const workflows = await Promise.all(["ci.yml", "release.yml", "release-stage.yml", "live-gates.yml"].map((name) => readFile(resolve(import.meta.dirname, `../../../.github/workflows/${name}`), "utf8")));
  assert.ok(workflows.every((text) => !text.includes("c20-fixture-signing-key")));
});

test("root ceremony command accepts only the frozen exact arguments", async () => {
  const fixture = await ceremonyFixture();
  const schemaPath = resolve(import.meta.dirname, "../../../docs/trust/root-ceremony-v1.schema.json");
  const verification = { schemaPath, recordPath: fixture.recordPath, evidenceRoot: fixture.evidence };
  const exact = ["--schema", "docs/trust/root-ceremony-v1.schema.json", "--record", "docs/trust/root-ceremony-v1.json", "--evidence", "docs/trust/evidence", "--offline", "--threshold", "2-of-2"];
  assert.equal((await verifyRootCeremonyCommand(exact, verification)).ceremonyId, "fixture-only");
  for (const invalid of [
    exact.slice(0, -2),
    exact.map((value) => value === "docs/trust/evidence" ? "docs/trust/other-evidence" : value),
    [...exact, "--extra"],
    [...exact, "--offline"],
    [exact[2], exact[3], exact[0], exact[1], ...exact.slice(4)],
  ]) await assert.rejects(verifyRootCeremonyCommand(invalid, verification), /ROOT_CEREMONY_ARGUMENTS_REFUSED/u);
});

test("root ceremony verifier derives offline 2-of-2 policy from the exact signed record", async () => {
  const fixture = await ceremonyFixture();
  const schemaPath = resolve(import.meta.dirname, "../../../docs/trust/root-ceremony-v1.schema.json");
  const paths = { schemaPath, recordPath: fixture.recordPath, evidenceRoot: fixture.evidence };
  await verifyRootCeremony(paths);
  for (const mutation of [
    (record) => { record.offline = false; },
    (record) => { record.threshold = "1-of-2"; },
    (record) => { delete record.offline; },
  ]) {
    const record = structuredClone(fixture.record);
    mutation(record);
    await writeFile(fixture.recordPath, `${canonical(record)}\n`);
    await assert.rejects(verifyRootCeremony(paths), /ROOT_CEREMONY_RECORD_INVALID/u);
  }
});

test("ceremony and delegation verifiers accept witnessed fixture bytes and reject tamper", async () => { const fixture = await ceremonyFixture(); await verifyRootCeremony({ schemaPath: resolve(import.meta.dirname, "../../../docs/trust/root-ceremony-v1.schema.json"), recordPath: fixture.recordPath, evidenceRoot: fixture.evidence }); await run(process.execPath, [resolve(import.meta.dirname, "../verify-delegation.mjs"), "--root-record", fixture.recordPath, "--require-version-range", "--require-kms-policy", "--require-two-approvals", "--release-version", "1.2.3"]); fixture.record.delegation.validThroughSequence = 11; await writeFile(fixture.recordPath, `${canonical(fixture.record)}\n`); await assert.rejects(run(process.execPath, [resolve(import.meta.dirname, "../verify-delegation.mjs"), "--root-record", fixture.recordPath, "--require-version-range", "--require-kms-policy", "--require-two-approvals", "--release-version", "1.2.3"]), /ROOT_DELEGATION_SIGNATURE_INVALID/u); });
test("delegation versionRange rejects below, above, and malformed release versions", async () => { const fixture = await ceremonyFixture(); const verify = (version) => run(process.execPath, [resolve(import.meta.dirname, "../verify-delegation.mjs"), "--root-record", fixture.recordPath, "--require-version-range", "--require-kms-policy", "--require-two-approvals", "--release-version", version]); await assert.rejects(verify("0.9.9"), /DELEGATION_VERSION_BELOW_RANGE/u); await assert.rejects(verify("2.0.0"), /DELEGATION_VERSION_ABOVE_RANGE/u); await assert.rejects(verify("not-a-version"), /DELEGATION_RELEASE_VERSION_INVALID/u); await assert.rejects(verify("1.2"), /DELEGATION_RELEASE_VERSION_INVALID/u); await assert.rejects(verify(""), /DELEGATION_RELEASE_VERSION_INVALID/u); const malformed = structuredClone(fixture.record); malformed.delegation.versionRange = { minimum: "1.0.0", maximum: "0.9.0" }; await writeFile(fixture.recordPath, `${canonical(malformed)}\n`); await assert.rejects(verify("1.2.3"), /DELEGATION_VERSION_RANGE_INVALID/u); });

test("coherence requires one approved version and exact internal pins", async () => { const root = await mkdtemp(resolve(tmpdir(), "horseness-c22-coherence-")); for (const path of PUBLISHABLE_MANIFESTS) { await mkdir(resolve(root, path, ".."), { recursive: true }); await writeFile(resolve(root, path), `${JSON.stringify({ name: `@horseness/${path.replaceAll("/", "-")}`, version: "1.2.3", private: false, dependencies: {} })}\n`); } await writeFile(resolve(root, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\nversion: 1.2.3\n"); assert.equal((await verifyCoherence(root)).version, "1.2.3"); const first = resolve(root, PUBLISHABLE_MANIFESTS[0]); const value = JSON.parse(await readFile(first, "utf8")); value.version = "0.0.0"; await writeFile(first, JSON.stringify(value)); await assert.rejects(verifyCoherence(root), /RELEASE_VERSION_INCOHERENT|APPROVED_RELEASE_VERSION_REQUIRED/u); });

test("side-effect journal is signed and hash chained", async () => { const root = await mkdtemp(resolve(tmpdir(), "horseness-c22-journal-")); const keys = pair(); const keyPath = resolve(root, "key.pem"); await writeFile(keyPath, keys.privateKey.export({ type: "pkcs8", format: "pem" })); const signer = resolve(root, "signer.mjs"); await writeFile(signer, `#!/usr/bin/env node\nconst {readFileSync}=await import('node:fs');const {createPrivateKey,sign}=await import('node:crypto');const key=createPrivateKey(readFileSync(${JSON.stringify(keyPath)}));process.stdout.write(JSON.stringify({keyId:'release-kms-v1',signature:sign(null,Buffer.from(process.argv[2]),key).toString('base64')}));\n`); await chmod(signer, 0o700); const old = process.env.HORSENESS_KMS_SIGNER; process.env.HORSENESS_KMS_SIGNER = signer; try { const path = resolve(root, "journal.jsonl"); const one = await appendSignedJournal(path, { phase: "intent" }); const two = await appendSignedJournal(path, { phase: "observed" }); assert.equal(two.previousHash, one.recordHash); assert.equal(two.sequence, 2); assert.equal((await readFile(path, "utf8")).trim().split("\n").length, 2); } finally { if (old === undefined) delete process.env.HORSENESS_KMS_SIGNER; else process.env.HORSENESS_KMS_SIGNER = old; } });

test("immutable upload is lookup-first and retry reconciles without PUT", async () => {
  const bytes = Buffer.from("candidate"); let stored = null; const calls = [];
  const response = (status, body = Buffer.alloc(0)) => ({ status, ok: status >= 200 && status < 300, arrayBuffer: async () => body, headers: new Headers() });
  const fetcher = async (_url, init) => { calls.push(init.method); if (init.method === "GET") return stored === null ? response(404) : response(200, stored); if (init.method === "PUT") { stored = Buffer.from(init.body); return response(201); } throw new Error("unexpected"); };
  await reconcileImmutableObject(fetcher, "https://storage.invalid/objects/digest", {}, bytes); assert.deepEqual(calls, ["GET", "PUT", "GET"]);
  calls.length = 0; await reconcileImmutableObject(fetcher, "https://storage.invalid/objects/digest", {}, bytes); assert.deepEqual(calls, ["GET", "GET"]);
});
