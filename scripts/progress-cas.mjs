import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const root = fs.realpathSync(".");
const args = parseArgs(process.argv.slice(2));
const mode = args._[0];
try {
  if (mode === "verify-live-bootstrap") verifyLiveBootstrap();
  else if (mode === "verify-live-claim") verifyLiveClaim();
  else if (mode === "verify-live-receipt") verifyLiveReceipt();
  else if (mode === "verify-live-resume") verifyLiveResume();
  else if (mode === "verify-fixture-bundle") verifyFixtureBundle();
  else if (mode === "verify-planning-correction") verifyPlanningCorrection();
  else usage();
  console.log(`${mode} passed`);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(3);
}

function verifyLiveBootstrap() {
  requireOptions("receipt", "checkpoint-index", "trust", "integrated-head");
  rejectFixturePaths(args.receipt, args["checkpoint-index"], args.trust);
  const receipt = readCanonical(args.receipt);
  const trust = readCanonical(args.trust);
  verifyEnvelope(receipt, trust, "bootstrap-v1", "C00");
  const rows = verifyIndex(args["checkpoint-index"], "checkpoint");
  requireUnique(rows, (r) => r.receiptPath === args.receipt && r.receiptDigest === receipt.envelopeDigest, "bootstrap index membership");
  const core = receipt.core;
  assert(core.rootParent === null && core.workerBaseSha === null && core.claimAttemptDigest === null, "invalid bootstrap roots");
  assert(core.commandResults.length === 1, "bootstrap must contain one command");
  assert(core.commandResults[0].command === frozenC00Command(), "bootstrap command mismatch");
  verifyCommandChronology(core, null);
  const head = gitRev(args["integrated-head"]);
  assert(isAncestor(core.candidateIntegrationSha, head), "bootstrap candidate is not an ancestor of integrated head");
  assert(gitTree(core.candidateIntegrationSha) === core.candidateTree, "bootstrap candidate tree mismatch");
}

function verifyLiveClaim() {
  requireOptions("claim", "claim-index", "checkpoint-index", "trust", "now", "integrated-head");
  rejectFixturePaths(args.claim, args["claim-index"], args["checkpoint-index"], args.trust);
  const claim = readCanonical(args.claim);
  verifyClaim(claim, args.now);
  const claimRows = verifyIndex(args["claim-index"], "claim");
  requireUnique(claimRows, (r) => r.claimPath === args.claim && r.claimDigest === claim.claimDigest && r.preClaimBaseSha === claim.preClaimBaseSha, "claim index membership");
  const checkpointRows = verifyIndex(args["checkpoint-index"], "checkpoint");
  const dependency = checkpointRows.find((r) => r.receiptDigest === claim.dependencyReceiptDigests[0]);
  assert(dependency?.receiptPath, "claim dependency not indexed");
  const dependencyEnvelope = readCanonical(dependency.receiptPath);
  verifyEnvelope(dependencyEnvelope, readCanonical(args.trust), "bootstrap-v1", "C00");
  const head = gitRev(args["integrated-head"]);
  assert(gitParents(head).length === 1, "claim integration commit must have one parent");
  assert(gitParents(head)[0] === claim.preClaimBaseSha, "claim pre-base is not integrated head parent");
  assert(isAncestor(dependencyEnvelope.core.candidateIntegrationSha, claim.preClaimBaseSha), "dependency is not integrated before claim");
  assert(gitPath(head, args.claim) === safeRead(args.claim), "claim bytes differ from integrated head");
  assert(gitPath(head, args["claim-index"]) === safeRead(args["claim-index"]), "claim index bytes differ from integrated head");
  assert(currentBranch() === "main", "live integration branch must be main");
}

function verifyLiveReceipt() {
  requireOptions("receipt", "claim", "checkpoint-index", "trust", "integrated-head");
  rejectFixturePaths(args.receipt, args.claim, args["checkpoint-index"], args.trust);
  const receipt = readCanonical(args.receipt);
  const claim = readCanonical(args.claim);
  verifyClaim(claim, receipt.core.attestedAt, true);
  verifyEnvelope(receipt, readCanonical(args.trust), undefined, claim.subjectId);
  verifyOrdinary(receipt.core, claim, gitAdapter());
  const rows = verifyIndex(args["checkpoint-index"], "checkpoint");
  requireUnique(rows, (r) => r.receiptPath === args.receipt && r.receiptDigest === receipt.envelopeDigest, "receipt index membership");
  assert(isAncestor(receipt.core.candidateIntegrationSha, gitRev(args["integrated-head"])), "receipt candidate is not integrated");
}

function verifyLiveResume() {
  verifyLiveReceipt();
  const receipt = readCanonical(args.receipt);
  assert(isAncestor(receipt.core.candidateIntegrationSha, gitRev(args["integrated-head"])), "attested candidate missing from resume head");
}

function verifyFixtureBundle() {
  requireOptions("bundle");
  const bundle = normalizeRelative(args.bundle);
  assert(bundle === "docs/checkpoints/fixtures/c01-bundle-v1", "fixture mode accepts only the canonical C01 bundle");
  const digestManifest = readCanonical(`${bundle}/digests.json`);
  for (const [relative, expected] of Object.entries(digestManifest)) assert(sha(safeRead(`${bundle}/${relative}`)) === expected, `fixture digest mismatch: ${relative}`);
  const trust = readCanonical(`${bundle}/trust.json`);
  const bootstrap = readCanonical(`${bundle}/receipts/bootstrap-v1.json`);
  const ordinary = readCanonical(`${bundle}/receipts/c01-ordinary-v1.json`);
  const claim = readCanonical(`${bundle}/claims/c01-claim-v1.json`);
  verifyEnvelope(bootstrap, trust, "bootstrap-v1", "C00");
  verifyEnvelope(ordinary, trust, "ordinary-v1", "C01");
  verifyClaim(claim, ordinary.core.attestedAt, true);
  const checkpointRows = verifyIndex(`${bundle}/checkpoint-index.jsonl`, "checkpoint", bundle);
  const claimRows = verifyIndex(`${bundle}/claim-index.jsonl`, "claim", bundle);
  requireUnique(checkpointRows, (r) => r.receiptPath === "receipts/bootstrap-v1.json" && r.receiptDigest === bootstrap.envelopeDigest, "fixture bootstrap membership");
  requireUnique(checkpointRows, (r) => r.receiptPath === "receipts/c01-ordinary-v1.json" && r.receiptDigest === ordinary.envelopeDigest, "fixture ordinary membership");
  requireUnique(claimRows, (r) => r.claimPath === "claims/c01-claim-v1.json" && r.claimDigest === claim.claimDigest, "fixture claim membership");
  const graph = readCanonical(`${bundle}/git-graph.json`);
  const adapter = graphAdapter(graph);
  assert(graph.claimCommit.sha === "B1" && graph.claimCommit.preClaimBaseSha === claim.preClaimBaseSha, "fixture claim commit mismatch");
  verifyOrdinary(ordinary.core, claim, adapter);
  for (const [ancestor, descendant] of graph.requiredRelations) assert(adapter.isAncestor(ancestor, descendant), `fixture ancestry missing: ${ancestor}->${descendant}`);
  verifySignatureVectors(`${bundle}/signature-vectors.json`, ordinary, bootstrap, trust);
}

function verifyPlanningCorrection() {
  requireOptions("claim-from-ledger", "finding", "finding-index", "checkpoint-index", "acceptance-dir");
  const ledger = safeRead(args["claim-from-ledger"]);
  const claimPath = ledger.match(/docs\/claims\/(P\d{3})\/(\d+)\.json/)?.[0];
  assert(claimPath, "planning ledger does not name a canonical claim");
  const claim = readCanonical(claimPath);
  assert(/^P\d{3}$/.test(claim.subjectId), "planning claim subject is not PNNN");
  assert(claim.allowedPaths.includes(args.finding) && claim.allowedPaths.includes(args["finding-index"]), "planning claim omits finding paths");
  verifyIndex(args["finding-index"], "finding");
  verifyIndex(args["checkpoint-index"], "checkpoint");
  const finding = readCanonical(args.finding);
  assert(typeof finding.findingDigest === "string", "finding digest missing");
  const acceptanceFiles = fs.readdirSync(safeDirectory(args["acceptance-dir"])).filter((name) => /^(R|V)\d{3}\.json$/.test(name));
  assert(acceptanceFiles.length > 0, "planning correction has no acceptance records");
  for (const file of acceptanceFiles) {
    const recordPath = `${normalizeRelative(args["acceptance-dir"])}/${file}`;
    assert(claim.acceptanceRecordPaths.includes(recordPath), `unclaimed acceptance record: ${recordPath}`);
    const record = readCanonical(recordPath);
    assert(Array.isArray(record.commands) && record.commands.length > 0, `${file}: empty commands`);
    assert(Array.isArray(record.allowedPaths) && record.allowedPaths.length > 0, `${file}: empty ownership`);
  }
}

function verifyEnvelope(env, trust, variant, subject) {
  assert(env.recordType === "CheckpointReceiptEnvelopeV1" && env.schemaVersion === "1", "invalid envelope shape");
  if (variant) assert(env.core.receiptVariant === variant, `expected ${variant}`);
  if (subject) assert(env.core.subjectId === subject, `expected subject ${subject}`);
  const coreDigest = domain("horseness.checkpoint-receipt-core.v1", env.core);
  assert(coreDigest === env.coreDigest && env.signature.signedDigest === coreDigest, "CORE_DIGEST_MISMATCH");
  assert(domain("horseness.checkpoint-receipt-envelope.v1", without(env, "envelopeDigest")) === env.envelopeDigest, "ENVELOPE_DIGEST_MISMATCH");
  assert(trust.recordType === "CheckpointTrustStoreV1" && new Set(trust.keys.map((k) => k.keyId)).size === trust.keys.length, "invalid trust store");
  const key = trust.keys.find((k) => k.keyId === env.signature.keyId);
  assert(key, "TRUST_KEY_UNKNOWN");
  assert(key.principalId === env.signature.principalId, "TRUST_PRINCIPAL_MISMATCH");
  const at = timestamp(env.core.attestedAt, "attestedAt");
  assert(at >= timestamp(key.notBefore, "notBefore") && at < timestamp(key.notAfter, "notAfter"), "TRUST_KEY_TIME");
  assert(key.revokedAt === null || at < timestamp(key.revokedAt, "revokedAt"), "TRUST_KEY_REVOKED");
  assert(key.allowedReceiptVariants.includes(env.core.receiptVariant) && key.allowedSubjects.includes(env.core.subjectId), "TRUST_SCOPE");
  const der = Buffer.from(key.publicKeySpkiBase64, "base64");
  assert(key.spkiFingerprint === `sha256:${sha(der)}`, "SPKI_FINGERPRINT_MISMATCH");
  assert(crypto.verify(null, Buffer.from(`horseness.checkpoint-receipt-signature.v1\0${coreDigest}`), crypto.createPublicKey({ key: der, format: "der", type: "spki" }), Buffer.from(env.signature.signatureBase64, "base64")), "SIGNATURE_INVALID");
  verifyCommandChronology(env.core, null);
}

function verifyClaim(claim, now, allowCompleted = false) {
  assert(claim.recordType === "ClaimAttemptV1" && claim.schemaVersion === "1", "invalid claim shape");
  assert(domain("horseness.claim-attempt.v1", without(claim, "claimDigest")) === claim.claimDigest, "claim digest mismatch");
  timestamp(claim.issuedAt, "issuedAt"); timestamp(claim.expiresAt, "expiresAt"); timestamp(now, "now");
  assert(timestamp(claim.issuedAt) < timestamp(claim.expiresAt), "claim interval invalid");
  if (!allowCompleted || claim.attestedAt === null) assert(timestamp(now) < timestamp(claim.expiresAt), "claim expired");
  assert(new Set(claim.allowedPaths).size === claim.allowedPaths.length, "duplicate allowed paths");
  for (const p of [...claim.allowedPaths, ...claim.affectedAdrPaths, ...claim.acceptanceRecordPaths]) normalizeRelative(p);
  if (claim.subjectId === "C01" && claim.attemptGeneration === 1) {
    const expected = c01AllowedPaths();
    assert(claim.allowedPaths.length === expected.length && expected.every((p, i) => claim.allowedPaths[i] === p), "C01 allowed paths mismatch");
    assert(claim.affectedAdrPaths.length === 0 && claim.acceptanceRecordPaths.length === 0, "C01 secondary path arrays must be empty");
  }
}

function verifyOrdinary(core, claim, adapter) {
  assert(core.receiptVariant === "ordinary-v1" && core.claimAttemptDigest === claim.claimDigest, "ordinary claim binding mismatch");
  assert(core.claimIntegrationSha === core.workerBaseSha, "worker base must equal claim integration");
  assert(adapter.parents(core.claimIntegrationSha).length === 1 && adapter.parents(core.claimIntegrationSha)[0] === claim.preClaimBaseSha, "claim integration parent mismatch");
  assert(adapter.isAncestor(core.workerBaseSha, core.workerCandidateSha) && adapter.isAncestor(core.workerBaseSha, core.candidateIntegrationSha), "candidate ancestry mismatch");
  assert(adapter.tree(core.workerCandidateSha) === core.candidateTree && adapter.tree(core.candidateIntegrationSha) === core.candidateTree, "candidate tree mismatch");
  verifyCommandChronology(core, claim.expiresAt);
}

function verifyCommandChronology(core, expiresAt) {
  let cursor = timestamp(core.candidateSealedAt, "candidateSealedAt");
  core.commandResults.forEach((result, ordinal) => {
    assert(result.ordinal === ordinal, `command ordinal mismatch: ${ordinal}`);
    const start = timestamp(result.startedAt, `command ${ordinal} start`), finish = timestamp(result.finishedAt, `command ${ordinal} finish`);
    assert(start >= cursor && finish >= start, `command chronology mismatch: ${ordinal}`); cursor = finish;
  });
  const attested = timestamp(core.attestedAt, "attestedAt");
  assert(attested >= cursor, "attestation precedes commands");
  if (expiresAt) assert(timestamp(core.candidateSealedAt) < timestamp(expiresAt) && attested < timestamp(expiresAt), "receipt exceeds claim expiry");
}

function verifyIndex(file, kind, fixtureRoot = null) {
  if (!fixtureRoot) rejectFixturePaths(file);
  const raw = safeRead(file); assert(raw.endsWith("\n"), `${kind} index lacks final newline`);
  let prior = null;
  return raw.trimEnd().split("\n").map((line, ordinal) => {
    const row = JSON.parse(line); assert(line === jcs(row), `${kind} index line is noncanonical`);
    assert(row.ordinal === ordinal && row.priorRecordHash === prior, `${kind} index chain mismatch at ${ordinal}`);
    const domainName = kind === "checkpoint" ? "horseness.checkpoint-index-record.v1" : kind === "claim" ? "horseness.claim-index-record.v1" : "horseness.finding-index-record.v1";
    assert(domain(domainName, without(row, "recordHash")) === row.recordHash, `${kind} index hash mismatch at ${ordinal}`);
    prior = row.recordHash; return row;
  });
}

function verifySignatureVectors(file, ordinary, bootstrap, trust) {
  const vectors = readCanonical(file);
  for (const vector of vectors.cases) {
    if (vector.expected === "valid") continue;
    const env = structuredClone(ordinary);
    if (vector.name === "core-substitution") env.core.candidateTree = "tree-substituted";
    if (vector.name === "signature-substitution") env.signature.signatureBase64 = bootstrap.signature.signatureBase64;
    if (vector.name === "unknown-key") env.signature.keyId = "unknown-key";
    if (vector.name === "revoked-key") env.signature.keyId = "fixture-revoked-2026";
    if (vector.name === "principal-substitution") env.signature.principalId = "other";
    if (vector.name !== "core-substitution") env.envelopeDigest = domain("horseness.checkpoint-receipt-envelope.v1", without(env, "envelopeDigest"));
    let rejected = false; try { verifyEnvelope(env, trust); } catch (error) { rejected = error.message === vector.expectedError; }
    assert(rejected, `signature vector failed: ${vector.name}`);
  }
}

function graphAdapter(graph) { const commits = new Map(graph.commits.map((c) => [c.sha, c])); return { parents: (sha) => commits.get(sha)?.parents ?? [], tree: (sha) => commits.get(sha)?.tree, isAncestor: (a, b, seen = new Set()) => a === b || (!seen.has(b) && (seen.add(b), (commits.get(b)?.parents ?? []).some((p) => graphAdapter(graph).isAncestor(a, p, seen)))) }; }
function gitAdapter() { return { parents: gitParents, tree: gitTree, isAncestor }; }
function gitRev(ref) { return git("rev-parse", "--verify", `${ref}^{commit}`).trim(); }
function gitTree(ref) { return git("rev-parse", `${ref}^{tree}`).trim(); }
function gitParents(ref) { return git("show", "-s", "--format=%P", ref).trim().split(/\s+/).filter(Boolean); }
function isAncestor(a, b) { try { execFileSync("git", ["merge-base", "--is-ancestor", a, b], { stdio: "ignore" }); return true; } catch { return false; } }
function currentBranch() { return git("symbolic-ref", "--short", "HEAD").trim(); }
function gitPath(ref, file) { return git("show", `${ref}:${normalizeRelative(file)}`); }
function git(...argv) { return execFileSync("git", argv, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }); }
function readCanonical(file) { const raw = safeRead(file), value = JSON.parse(raw); assert(raw === jcs(value), `noncanonical JSON: ${file}`); return value; }
function safeRead(file) { const relative = normalizeRelative(file), absolute = path.join(root, relative); let cursor = root; for (const part of relative.split("/")) { cursor = path.join(cursor, part); assert(!fs.lstatSync(cursor).isSymbolicLink(), `symlink rejected: ${file}`); } assert(fs.realpathSync(absolute) === absolute && fs.statSync(absolute).isFile(), `unsafe file: ${file}`); return fs.readFileSync(absolute, "utf8"); }
function safeDirectory(dir) { const relative = normalizeRelative(dir), absolute = path.join(root, relative); assert(fs.realpathSync(absolute) === absolute && fs.statSync(absolute).isDirectory(), `unsafe directory: ${dir}`); return absolute; }
function normalizeRelative(file) { assert(typeof file === "string" && file.length > 0 && !path.isAbsolute(file), `path must be relative: ${file}`); const normalized = file.replaceAll("\\", "/"); assert(path.posix.normalize(normalized) === normalized && !normalized.startsWith("../"), `path escapes root: ${file}`); return normalized; }
function rejectFixturePaths(...files) { for (const file of files) assert(!normalizeRelative(file).startsWith("docs/checkpoints/fixtures/"), `fixture path rejected in live mode: ${file}`); }
function timestamp(value, label = "timestamp") { assert(typeof value === "string" && /^\d{4}-(0[1-9]|1[0-2])-([0-2]\d|3[01])T([01]\d|2[0-3]):[0-5]\d:[0-5]\dZ$/.test(value), `noncanonical ${label}`); const ms = Date.parse(value); assert(Number.isFinite(ms) && new Date(ms).toISOString() === value.replace("Z", ".000Z"), `invalid ${label}`); return ms; }
function jcs(value) { if (value === null) return "null"; if (Array.isArray(value)) return `[${value.map(jcs).join(",")}]`; if (typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${jcs(value[key])}`).join(",")}}`; return JSON.stringify(value); }
function sha(value) { return crypto.createHash("sha256").update(value).digest("hex"); }
function domain(name, value) { return sha(Buffer.concat([Buffer.from(`${name}\0`), Buffer.from(jcs(value))])); }
function without(object, key) { return Object.fromEntries(Object.entries(object).filter(([name]) => name !== key)); }
function requireUnique(rows, predicate, label) { assert(rows.filter(predicate).length === 1, `expected exactly one ${label}`); }
function requireOptions(...names) { for (const name of names) assert(typeof args[name] === "string", `missing --${name}`); }
function assert(condition, message) { if (!condition) throw new Error(message); }
function parseArgs(argv) { const result = { _: [] }; for (let i = 0; i < argv.length; i++) { const value = argv[i]; if (!value.startsWith("--")) { result._.push(value); continue; } const name = value.slice(2); if (name === "strict") result.strict = true; else { assert(i + 1 < argv.length && !argv[i + 1].startsWith("--"), `missing value for --${name}`); result[name] = argv[++i]; } } return result; }
function frozenC00Command() { return `node -e "$(cat docs/validation/c00-contract-gate.node-e.txt)"`; }
function usage() { console.error("Usage: progress-cas.mjs <verify-live-bootstrap|verify-live-claim|verify-live-receipt|verify-live-resume|verify-fixture-bundle|verify-planning-correction> [options] --strict"); process.exit(2); }
function c01AllowedPaths() { return ["package.json","pnpm-workspace.yaml","pnpm-lock.yaml","tsconfig.base.json","eslint.config.js",".npmrc",".node-version",".github/workflows/ci.yml",".changeset/config.json","scripts/acceptance.mjs","scripts/c00-contract-gate.mjs","scripts/progress-cas.mjs","scripts/boundaries-check.mjs","README.md","docs/progress/C01.md","docs/progress.md","docs/checkpoints/C01/final/1.json","docs/checkpoints/index.jsonl","docs/claims/C01/1.json","docs/claims/index.jsonl","packages/domain/package.json","packages/domain/src/index.ts","packages/protocol/package.json","packages/protocol/src/index.ts","packages/policy/package.json","packages/policy/src/index.ts","packages/store-sqlite/package.json","packages/store-sqlite/src/index.ts","packages/orchestrator/package.json","packages/orchestrator/src/index.ts","packages/sdk/package.json","packages/sdk/src/index.ts","packages/adapter-kit/package.json","packages/adapter-kit/src/index.ts","packages/installer/package.json","packages/installer/src/index.ts","apps/daemon/package.json","apps/daemon/src/index.ts","apps/cli/package.json","apps/cli/src/index.ts","adapters/pi/package.json","adapters/pi/src/index.ts","adapters/omp/package.json","adapters/omp/src/index.ts","adapters/claude/package.json","adapters/claude/src/index.ts","adapters/codex/package.json","adapters/codex/src/index.ts"]; }
