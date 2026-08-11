import { deepClone, digestId, domainDigest, DomainError, jsonValueDigest, type JsonValue } from "./canonical.js";
import type { CompositeCursorV1, ContextVersionV1 } from "./events.js";

export type DeltaOperationV1 =
  | { op: "test"; path: string; expectedValueDigest: string }
  | { op: "add"; path: string; expectedParentDigest: string; value: JsonValue }
  | { op: "replace"; path: string; expectedValueDigest: string; value: JsonValue }
  | { op: "remove"; path: string; expectedValueDigest: string };
export type DeltaReasonCode = "STALE_BASE" | "TEST_FAILED" | "ADD_PARENT_CHANGED" | "ADD_TARGET_EXISTS" | "PATH_MISSING" | "VALUE_DIGEST_MISMATCH" | "ARRAY_INDEX_RANGE" | "INVALID_ENVELOPE" | "PROPOSAL_ID_MISMATCH" | "UNSUPPORTED_SCHEMA_VERSION" | "UNSUPPORTED_CANONICALIZER" | "UNSUPPORTED_HASH" | "INVALID_POINTER" | "ROOT_ADD_FORBIDDEN" | "ROOT_REMOVE_FORBIDDEN" | "DUPLICATE_WRITE_TARGET" | "OVERLAPPING_WRITE_TARGET" | "SCOPE_ESCAPE" | "INVALID_JSON_VALUE" | "EVIDENCE_MISMATCH" | "RECEIPT_MISMATCH" | "FINAL_DOCUMENT_UNCHANGED";
export type DeltaResult = { outcome: "accepted"; document: JsonValue; stateHash: string; operationResultDigest: string } | { outcome: "conflicted" | "rejected"; reason: DeltaReasonCode };

export interface DeltaAuthorityScopeV1 { schemaVersion: "1"; workspaceId: string; runId: string; taskId: string; roots: string[] }
export function validatePointer(path: string): string[] {
  if (path === "") return [];
  if (!path.startsWith("/")) throw new DomainError("INVALID_POINTER");
  return path.slice(1).split("/").map((token) => {
    if (/~(?:[^01]|$)/u.test(token)) throw new DomainError("INVALID_POINTER");
    return token.replaceAll("~1", "/").replaceAll("~0", "~");
  });
}
export function canonicalScope(scope: DeltaAuthorityScopeV1): DeltaAuthorityScopeV1 {
  for (const root of scope.roots) validatePointer(root);
  return { ...scope, roots: [...new Set(scope.roots)].sort() };
}
export function deltaAuthorityScopeDigest(scope: DeltaAuthorityScopeV1): string { return domainDigest("horseness.delta-authority-scope.v1", canonicalScope(scope)); }
export function scopeContains(scope: DeltaAuthorityScopeV1, path: string): boolean {
  validatePointer(path);
  return scope.roots.some((root) => root === "" || path === root || path.startsWith(`${root}/`));
}
export function intersectScopes(left: DeltaAuthorityScopeV1, right: DeltaAuthorityScopeV1): DeltaAuthorityScopeV1 {
  if (left.workspaceId !== right.workspaceId || left.runId !== right.runId || left.taskId !== right.taskId) throw new DomainError("CAPABILITY_SCOPE_MISMATCH");
  const roots = [...left.roots.filter((root) => scopeContains(right, root)), ...right.roots.filter((root) => scopeContains(left, root))];
  return canonicalScope({ ...left, roots });
}

function parentAndKey(document: JsonValue, tokens: readonly string[]): { parent: JsonValue[] | Record<string, JsonValue>; key: string } | undefined {
  let current: JsonValue = document;
  for (const token of tokens.slice(0, -1)) {
    if (Array.isArray(current)) {
      if (!/^(0|[1-9][0-9]*)$/u.test(token) || Number(token) >= current.length) return undefined;
      current = current[Number(token)] as JsonValue;
    } else if (current !== null && typeof current === "object" && Object.hasOwn(current, token)) current = current[token] as JsonValue;
    else return undefined;
  }
  if (current === null || typeof current !== "object") return undefined;
  return { parent: current as JsonValue[] | Record<string, JsonValue>, key: tokens.at(-1) as string };
}
function readAt(document: JsonValue, tokens: readonly string[]): { exists: boolean; value?: JsonValue } {
  if (tokens.length === 0) return { exists: true, value: document };
  const location = parentAndKey(document, tokens);
  if (!location) return { exists: false };
  if (Array.isArray(location.parent)) {
    if (!/^(0|[1-9][0-9]*)$/u.test(location.key) || Number(location.key) >= location.parent.length) return { exists: false };
    return { exists: true, value: location.parent[Number(location.key)] as JsonValue };
  }
  return Object.hasOwn(location.parent, location.key) ? { exists: true, value: location.parent[location.key] as JsonValue } : { exists: false };
}
function failure(reason: DeltaReasonCode): DeltaResult { return { outcome: ["STALE_BASE", "TEST_FAILED", "ADD_PARENT_CHANGED", "ADD_TARGET_EXISTS", "PATH_MISSING", "VALUE_DIGEST_MISMATCH", "ARRAY_INDEX_RANGE"].includes(reason) ? "conflicted" : "rejected", reason } as DeltaResult; }

export function applyDelta(base: JsonValue, operations: readonly DeltaOperationV1[], scope: DeltaAuthorityScopeV1): DeltaResult {
  const writes = operations.filter((operation) => operation.op !== "test").map((operation) => operation.path);
  for (const path of writes) {
    try { validatePointer(path); } catch { return failure("INVALID_POINTER"); }
    if (!scopeContains(scope, path)) return failure("SCOPE_ESCAPE");
  }
  if (new Set(writes).size !== writes.length) return failure("DUPLICATE_WRITE_TARGET");
  for (let index = 0; index < writes.length; index += 1) for (let other = index + 1; other < writes.length; other += 1) if ((writes[index] !== "" && writes[other]?.startsWith(`${writes[index]}/`)) || (writes[other] !== "" && writes[index]?.startsWith(`${writes[other]}/`)) || writes[index] === "" || writes[other] === "") return failure("OVERLAPPING_WRITE_TARGET");
  let document = deepClone(base);
  for (const operation of operations) {
    let tokens: string[];
    try { tokens = validatePointer(operation.path); } catch { return failure("INVALID_POINTER"); }
    const current = readAt(document, tokens);
    if (operation.op === "test") {
      if (!current.exists || jsonValueDigest(current.value as JsonValue) !== operation.expectedValueDigest) return failure("TEST_FAILED");
      continue;
    }
    if (operation.op === "replace") {
      if (!current.exists) return failure("PATH_MISSING");
      if (jsonValueDigest(current.value as JsonValue) !== operation.expectedValueDigest) return failure("VALUE_DIGEST_MISMATCH");
      if (tokens.length === 0) document = deepClone(operation.value);
      else { const location = parentAndKey(document, tokens) as { parent: JsonValue[] | Record<string, JsonValue>; key: string }; if (Array.isArray(location.parent)) location.parent[Number(location.key)] = deepClone(operation.value); else location.parent[location.key] = deepClone(operation.value); }
    } else if (operation.op === "remove") {
      if (tokens.length === 0) return failure("ROOT_REMOVE_FORBIDDEN");
      if (!current.exists) return failure("PATH_MISSING");
      if (jsonValueDigest(current.value as JsonValue) !== operation.expectedValueDigest) return failure("VALUE_DIGEST_MISMATCH");
      const location = parentAndKey(document, tokens) as { parent: JsonValue[] | Record<string, JsonValue>; key: string };
      if (Array.isArray(location.parent)) location.parent.splice(Number(location.key), 1); else delete location.parent[location.key];
    } else {
      if (tokens.length === 0) return failure("ROOT_ADD_FORBIDDEN");
      const location = parentAndKey(document, tokens);
      if (!location) return failure("PATH_MISSING");
      if (jsonValueDigest(location.parent as JsonValue) !== operation.expectedParentDigest) return failure("ADD_PARENT_CHANGED");
      if (Array.isArray(location.parent)) {
        if (!/^(0|[1-9][0-9]*)$/u.test(location.key) || Number(location.key) > location.parent.length) return failure("ARRAY_INDEX_RANGE");
        location.parent.splice(Number(location.key), 0, deepClone(operation.value));
      } else {
        if (Object.hasOwn(location.parent, location.key)) return failure("ADD_TARGET_EXISTS");
        location.parent[location.key] = deepClone(operation.value);
      }
    }
  }
  if (jsonValueDigest(document) === jsonValueDigest(base)) return failure("FINAL_DOCUMENT_UNCHANGED");
  return { outcome: "accepted", document, stateHash: domainDigest("horseness.canonical-document.v1", document), operationResultDigest: domainDigest("horseness.delta-operation-result.v1", { operations: operations as unknown as JsonValue, document }) };
}

export interface ProposalEnvelopeCoreV1 { schemaVersion: "1"; workspaceId: string; runId: string; authorPrincipalId: string; authorGrantDigest: string; attemptId: string; receiptDigests: string[]; forkPinDigest: string; deltaAuthorityScopeDigest: string; baseRevision: number; baseStateHash: string; canonicalizerVersion: "jcs-v1"; hashVersion: "sha256-v1"; proposalSealingObservationCursor: CompositeCursorV1; proposalSealingContextVersion: ContextVersionV1; operations: DeltaOperationV1[]; evidenceClaims: { digest: string; claim: string }[]; pinnedPolicyDigest: string; currentPolicyDigest: string; nonce: string; predecessorProposalDigest: string | null; predecessorReason: string | null; }
export interface ProposalEnvelopeV1 { core: ProposalEnvelopeCoreV1; proposalDigest: string; proposalId: string }
export function sealProposal(core: ProposalEnvelopeCoreV1): ProposalEnvelopeV1 {
  const normalized: ProposalEnvelopeCoreV1 = { ...core, receiptDigests: [...new Set(core.receiptDigests)].sort(), evidenceClaims: [...core.evidenceClaims].sort((a, b) => a.digest.localeCompare(b.digest) || a.claim.localeCompare(b.claim)) };
  const proposalDigest = domainDigest("horseness.proposal.v1", normalized);
  return { core: normalized, proposalDigest, proposalId: digestId("prp_", proposalDigest) };
}
export function verifyProposal(envelope: ProposalEnvelopeV1): void {
  const expected = sealProposal(envelope.core);
  if (expected.proposalDigest !== envelope.proposalDigest || expected.proposalId !== envelope.proposalId) throw new DomainError("PROPOSAL_ID_MISMATCH");
}
