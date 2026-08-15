import assert from "node:assert/strict";
import { parseHosts } from "./closed-loop-args.mjs";
import { expectedNativeVersion } from "./closed-loop-native-versions.mjs";
import { jsonObjects, requireSuccess, runCommand } from "./process-helper.mjs";
import { findReceiptAuthMaterial } from "./receipt-secret-audit.mjs";

const EXPECTED_DECISIONS = ["accepted", "approval_required", "conflicted", "quarantined", "rejected"].sort();
const HASH = /^(?:sha256:)?[0-9a-f]{64}$/u;
const SUBSCRIPTION_HOSTS = new Set(["claude", "codex"]);

function requireDigest(value, label) {
  assert.equal(typeof value, "string", `${label} is missing`);
  assert.match(value, HASH, `${label} is not a SHA-256 digest`);
}

function isSubscriptionHost(host) {
  return SUBSCRIPTION_HOSTS.has(host);
}

function hostSmokeSchemaVersion(host) {
  if (host === "pi") return "PiHostSmokeResultV1";
  if (host === "omp") return "OMPHostSmokeResultV1";
  return `${host[0].toUpperCase()}${host.slice(1)}HostSmokeResultV1`;
}

function subscriptionReceiptSchemaVersion(host) {
  return host === "claude" ? "ClaudeSubscriptionLiveReceiptV1" : "CodexSubscriptionLiveReceiptV1";
}

async function readGitObject(label, revision) {
  const result = await requireSuccess(label, "git", ["rev-parse", revision], {
    timeoutMs: 5_000,
    maxOutputBytes: 4096,
  });
  return result.stdout.trim();
}

function requireFiveOutcomes(result) {
  assert.equal(result.decisions?.length, 5, `${result.host} did not surface exactly five authority decisions`);
  assert.deepEqual([...result.decisions].sort(), EXPECTED_DECISIONS, `${result.host} did not surface the exact authority outcome set`);
  assert.equal(result.canonicalRevision, 1, `${result.host} did not advance canonical revision exactly once`);
  assert.deepEqual(result.canonicalDocument, { value: 2 }, `${result.host} did not surface the authority-produced canonical document`);
  requireDigest(result.receiptDigest, `${result.host} receiptDigest`);
  if (result.host === "pi" || result.host === "omp") requireDigest(result.proposalDigest, `${result.host} proposalDigest`);
}

function requireLifecycle(result) {
  switch (result.host) {
    case "pi":
    case "omp":
      assert.equal(result.lifecycle?.uninstallDiscovery, "disabled", `${result.host} did not prove discovery was disabled`);
      assert.deepEqual(result.lifecycle.calls, ["launch", "reconcile", "reattach", "resume", "collect"]);
      assert.equal(result.lifecycle.credential, "revoked");
      requireDigest(result.lifecycle.activeForkPinDigest, `${result.host} active fork pin`);
      requireDigest(result.loaderDigest, `${result.host} native loader provenance`);
      break;
    case "claude":
      assert.equal(result.lifecycle?.uninstallDiscovery, "same-path-native-init-after-discovery-disable-authority-revoke-and-recovery", "claude did not prove exact discovery-disable lifecycle");
      assert.equal(typeof result.sessions?.resumed, "string", "claude resume session missing");
      assert.equal(typeof result.sessions?.forked, "string", "claude fork session missing");
      assert.notEqual(result.sessions.forked, result.sessions.resumed, "claude fork reused its source session");
      assert.equal(result.authMode, "existing-user-subscription-session");
      requireDigest(result.executableDigest, "claude native executable provenance");
      break;
    case "codex":
      assert.equal(result.lifecycle?.uninstallDiscovery, "native-plugin-uninstall-marketplace-remove-fresh-thread-inventory-absent", "codex did not prove marketplace removal and absent inventory");
      assert.equal(typeof result.sessions?.resumed, "string", "codex resume session missing");
      assert.equal(typeof result.sessions?.forked, "string", "codex fork session missing");
      assert.notEqual(result.sessions.forked, result.sessions.resumed, "codex fork reused its source session");
      assert.equal(result.authMode, "existing-user-subscription-session");
      requireDigest(result.executableDigest, "codex native executable provenance");
      break;
    default:
      assert.fail(`unsupported lifecycle contract for host ${String(result.host)}`);
  }
}

function requireReceipt(receipt, host, head, tree, invocationStartedAt) {
  assert.equal(receipt.schemaVersion, subscriptionReceiptSchemaVersion(host));
  assert.equal(receipt.host, host);
  assert.equal(receipt.authMode, "existing-user-subscription-session");
  assert.deepEqual(receipt.candidate, { head, tree }, `${host} receipt is not candidate-bound to the current C21 HEAD/tree`);
  assert.equal(receipt.hostVersion, expectedNativeVersion(host));
  assert.equal(receipt.terminal?.result, "succeeded");
  assert.equal(receipt.redactionAudit?.passed, true);
  assert.ok(Array.isArray(receipt.bindings) && receipt.bindings.length === 5, `${host} receipt lacks five exact bindings`);
  requireDigest(receipt.provenance?.archiveDigest, `${host} archive provenance`);
  requireDigest(receipt.provenance?.executableDigest, `${host} executable provenance`);
  requireDigest(receipt.provenance?.packageDigest, `${host} package provenance`);
  assert.ok(Array.isArray(receipt.provenance?.contributions) && receipt.provenance.contributions.length > 0, `${host} contribution provenance missing`);
  for (const item of receipt.provenance.contributions) requireDigest(item.digest, `${host} contribution ${item.name}`);
  const startedAt = Date.parse(receipt.timing?.startedAt);
  const finishedAt = Date.parse(receipt.timing?.finishedAt);
  assert.ok(Number.isFinite(startedAt) && startedAt >= invocationStartedAt - 1_000, `${host} receipt is stale`);
  assert.ok(Number.isFinite(finishedAt) && finishedAt >= startedAt && finishedAt <= Date.now() + 1_000, `${host} receipt timing is invalid`);
  const authMaterial = findReceiptAuthMaterial(receipt);
  assert.deepEqual(authMaterial, [], `${host} receipt exposed auth material: ${authMaterial.join(", ")}`);
}

const hosts = parseHosts(process.argv.slice(2));
const head = await readGitObject("read current HEAD", "HEAD");
const tree = await readGitObject("read current tree", "HEAD^{tree}");
const summaries = [];

for (const host of hosts) {
  const invocationStartedAt = Date.now();
  const timeoutMs = isSubscriptionHost(host) ? 900_000 : 300_000;
  const run = await runCommand("corepack", ["pnpm", "run", `host:smoke:${host}`], {
    timeoutMs,
    maxOutputBytes: 16 * 1024 * 1024,
  });
  assert.equal(run.signal, null, `${host} smoke terminated by ${run.signal}`);
  assert.equal(run.code, 0, `${host} smoke failed\nstdout:\n${run.stdout}\nstderr:\n${run.stderr}`);
  assert.doesNotMatch(`${run.stdout}\n${run.stderr}`, /(?:SKIP|skipped|credential[_ -]?ref|synthetic decision|hermetic substitution)/iu, `${host} smoke used a forbidden skip or stale credential-reference route`);
  const values = jsonObjects(run.stdout);
  const result = values.find((value) => value?.schemaVersion === hostSmokeSchemaVersion(host));
  assert.ok(result, `${host} smoke did not emit its JSON result`);
  assert.equal(result.host, host);
  assert.equal(result.version, expectedNativeVersion(host), `${host} did not execute the pinned native version`);
  requireDigest(result.packageDigest, `${host} packageDigest`);
  requireFiveOutcomes(result);
  requireLifecycle(result);
  if (isSubscriptionHost(host)) {
    const receiptSchemaVersion = subscriptionReceiptSchemaVersion(host);
    const receipt = values.find((value) => value?.schemaVersion === receiptSchemaVersion);
    assert.ok(receipt, `${host} did not emit a fresh subscription receipt`);
    requireReceipt(receipt, host, head, tree, invocationStartedAt);
  }
  summaries.push({ host, version: result.version, packageDigest: result.packageDigest, receiptDigest: result.receiptDigest, decisions: result.decisions, canonicalRevision: result.canonicalRevision });
}

const finalHead = await readGitObject("recheck current HEAD", "HEAD");
const finalTree = await readGitObject("recheck current tree", "HEAD^{tree}");
assert.deepEqual({ head: finalHead, tree: finalTree }, { head, tree }, "candidate changed during the closed loop");
process.stdout.write(`${JSON.stringify({ schemaVersion: "C21ClosedLoopResultV1", candidate: { head, tree }, hosts: summaries })}\n`);
