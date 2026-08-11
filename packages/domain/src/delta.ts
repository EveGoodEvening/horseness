import { assertJsonValue, canonicalJson, deepClone, digestId, domainDigest, DomainError, jsonValueDigest, type JsonValue } from "./canonical.js";
import { assertContextVersionV1, assertObservationCursorV1, type CompositeCursorV1, type ContextVersionV1 } from "./events.js";

export type DeltaOperationV1 =
  | { op: "test"; path: string; expectedValueDigest: string }
  | { op: "add"; path: string; expectedParentDigest: string; value: JsonValue }
  | { op: "replace"; path: string; expectedValueDigest: string; value: JsonValue }
  | { op: "remove"; path: string; expectedValueDigest: string };
export type DeltaReasonCode = "STALE_BASE" | "TEST_FAILED" | "ADD_PARENT_CHANGED" | "ADD_TARGET_EXISTS" | "PATH_MISSING" | "VALUE_DIGEST_MISMATCH" | "ARRAY_INDEX_RANGE" | "INVALID_ENVELOPE" | "PROPOSAL_ID_MISMATCH" | "UNSUPPORTED_SCHEMA_VERSION" | "UNSUPPORTED_CANONICALIZER" | "UNSUPPORTED_HASH" | "INVALID_POINTER" | "ROOT_ADD_FORBIDDEN" | "ROOT_REMOVE_FORBIDDEN" | "DUPLICATE_WRITE_TARGET" | "OVERLAPPING_WRITE_TARGET" | "SCOPE_ESCAPE" | "INVALID_JSON_VALUE" | "EVIDENCE_MISMATCH" | "RECEIPT_MISMATCH" | "FINAL_DOCUMENT_UNCHANGED";
export type DeltaResult = { outcome: "accepted"; document: JsonValue; stateHash: string; operationResultDigest: string } | { outcome: "conflicted" | "rejected"; reason: DeltaReasonCode };

export interface DeltaAuthorityScopeV1 { schemaVersion: "1"; workspaceId: string; runId: string; taskId: string; roots: string[] }
function encodePointerToken(token: string): string { return token.replaceAll("~", "~0").replaceAll("/", "~1"); }
export function validatePointer(path: string): string[] {
  if (typeof path !== "string") throw new DomainError("INVALID_POINTER");
  try { assertJsonValue(path); } catch { throw new DomainError("INVALID_POINTER"); }
  if (path === "") return [];
  if (!path.startsWith("/")) throw new DomainError("INVALID_POINTER");
  const tokens = path.slice(1).split("/").map((token) => {
    if (/~(?:[^01]|$)/u.test(token)) throw new DomainError("INVALID_POINTER");
    return token.replaceAll("~1", "/").replaceAll("~0", "~");
  });
  if (`/${tokens.map(encodePointerToken).join("/")}` !== path) throw new DomainError("INVALID_POINTER");
  return tokens;
}
export function canonicalScope(scope: DeltaAuthorityScopeV1): DeltaAuthorityScopeV1 {
  if (scope.schemaVersion !== "1" || typeof scope.workspaceId !== "string" || typeof scope.runId !== "string" || typeof scope.taskId !== "string" || !Array.isArray(scope.roots)) throw new DomainError("INVALID_ENVELOPE");
  for (const root of scope.roots) validatePointer(root);
  return { ...scope, roots: [...new Set(scope.roots)].sort() };
}
export function deltaAuthorityScopeDigest(scope: DeltaAuthorityScopeV1): string { return domainDigest("horseness.delta-authority-scope.v1", canonicalScope(scope)); }
export function scopeContains(scope: DeltaAuthorityScopeV1, path: string): boolean {
  const pathTokens = validatePointer(path);
  return scope.roots.some((root) => {
    const rootTokens = validatePointer(root);
    return rootTokens.length <= pathTokens.length && rootTokens.every((token, index) => token === pathTokens[index]);
  });
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
  try {
    assertJsonValue(base);
    canonicalScope(scope);
  } catch (error) {
    return failure(error instanceof DomainError && error.code === "INVALID_POINTER" ? "INVALID_POINTER" : "INVALID_ENVELOPE");
  }
  if (!Array.isArray(operations)) return failure("INVALID_ENVELOPE");
  const writes: string[] = [];
  for (const operation of operations) {
    if (operation === null || typeof operation !== "object" || !["test", "add", "replace", "remove"].includes(operation.op)) return failure("INVALID_ENVELOPE");
    const requiredKeys = operation.op === "add" ? ["expectedParentDigest", "op", "path", "value"] : operation.op === "replace" ? ["expectedValueDigest", "op", "path", "value"] : ["expectedValueDigest", "op", "path"];
    if (Object.keys(operation).sort().join("\0") !== requiredKeys.join("\0")) return failure("INVALID_ENVELOPE");
    if (("expectedValueDigest" in operation && typeof operation.expectedValueDigest !== "string") || ("expectedParentDigest" in operation && typeof operation.expectedParentDigest !== "string")) return failure("INVALID_ENVELOPE");
    try { validatePointer(operation.path); } catch { return failure("INVALID_POINTER"); }
    if (!scopeContains(scope, operation.path)) return failure("SCOPE_ESCAPE");
    if (operation.op === "add" || operation.op === "replace") {
      try { assertJsonValue(operation.value); } catch { return failure("INVALID_JSON_VALUE"); }
    }
    if (operation.op !== "test") writes.push(operation.path);
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

const PROPOSAL_KEYS = ["schemaVersion", "workspaceId", "runId", "authorPrincipalId", "authorGrantDigest", "attemptId", "receiptDigests", "forkPinDigest", "deltaAuthorityScopeDigest", "baseRevision", "baseStateHash", "canonicalizerVersion", "hashVersion", "proposalSealingObservationCursor", "proposalSealingContextVersion", "operations", "evidenceClaims", "pinnedPolicyDigest", "currentPolicyDigest", "nonce", "predecessorProposalDigest", "predecessorReason"] as const;
function exactRecord(value: unknown, keys: readonly string[], code = "INVALID_ENVELOPE"): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) throw new DomainError(code);
  const actual = Object.keys(value).sort(); const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) throw new DomainError(code);
  return value as Record<string, unknown>;
}
function nonEmpty(value: unknown): asserts value is string { if (typeof value !== "string" || value.length === 0) throw new DomainError("INVALID_ENVELOPE"); }
function natural(value: unknown): asserts value is number { if (!Number.isSafeInteger(value) || (value as number) < 0) throw new DomainError("INVALID_ENVELOPE"); }
function validateCompositeCursor(value: unknown): asserts value is CompositeCursorV1 {
  const cursor = exactRecord(value, ["schemaVersion", "kind", "workspaceId", "workspaceSequence", "workspaceEnvelopeHash", "workspaceContextEpoch", "runId", "runSequence", "runEnvelopeHash", "runContextEpoch"]);
  if (cursor.schemaVersion !== "1" || cursor.kind !== "composite") throw new DomainError("UNSUPPORTED_SCHEMA_VERSION");
  for (const key of ["workspaceId", "workspaceEnvelopeHash", "runId", "runEnvelopeHash"] as const) nonEmpty(cursor[key]);
  try { assertObservationCursorV1(value); } catch { throw new DomainError("INVALID_ENVELOPE"); }
  for (const key of ["workspaceSequence", "workspaceContextEpoch", "runSequence", "runContextEpoch"] as const) natural(cursor[key]);
}
function validateProposalCore(value: unknown): asserts value is ProposalEnvelopeCoreV1 {
  const core = exactRecord(value, PROPOSAL_KEYS);
  if (core.schemaVersion !== "1") throw new DomainError("UNSUPPORTED_SCHEMA_VERSION");
  if (core.canonicalizerVersion !== "jcs-v1") throw new DomainError("UNSUPPORTED_CANONICALIZER");
  if (core.hashVersion !== "sha256-v1") throw new DomainError("UNSUPPORTED_HASH");
  for (const key of ["workspaceId", "runId", "authorPrincipalId", "authorGrantDigest", "attemptId", "forkPinDigest", "deltaAuthorityScopeDigest", "baseStateHash", "pinnedPolicyDigest", "currentPolicyDigest", "nonce"] as const) nonEmpty(core[key]);
  natural(core.baseRevision);
  if (!Array.isArray(core.receiptDigests) || core.receiptDigests.some((item) => typeof item !== "string" || item.length === 0) || new Set(core.receiptDigests).size !== core.receiptDigests.length) throw new DomainError("INVALID_ENVELOPE");
  try { assertContextVersionV1(core.proposalSealingContextVersion); } catch { throw new DomainError("INVALID_ENVELOPE"); }
  const context = exactRecord(core.proposalSealingContextVersion, ["schemaVersion", "kind", "workspaceContextEpoch", "runContextEpoch", "observationCursor"]);
  if (context.schemaVersion !== "1" || context.kind !== "composite") throw new DomainError("UNSUPPORTED_SCHEMA_VERSION");
  natural(context.workspaceContextEpoch); natural(context.runContextEpoch); validateCompositeCursor(context.observationCursor);
  const cursor = core.proposalSealingObservationCursor;
  validateCompositeCursor(cursor);
  if (cursor.workspaceId !== core.workspaceId || cursor.runId !== core.runId || canonicalJson(context.observationCursor) !== canonicalJson(cursor) || context.workspaceContextEpoch !== cursor.workspaceContextEpoch || context.runContextEpoch !== cursor.runContextEpoch) throw new DomainError("INVALID_ENVELOPE");
  if (!Array.isArray(core.operations)) throw new DomainError("INVALID_ENVELOPE");
  for (const operationValue of core.operations) {
    const operation = operationValue as unknown as Record<string, unknown>; const tag = operation?.op;
    const keys = tag === "test" || tag === "remove" ? ["op", "path", "expectedValueDigest"] : tag === "replace" ? ["op", "path", "expectedValueDigest", "value"] : tag === "add" ? ["op", "path", "expectedParentDigest", "value"] : null;
    if (keys === null) throw new DomainError("INVALID_ENVELOPE"); exactRecord(operationValue, keys); nonEmpty(operation.path); validatePointer(operation.path); nonEmpty(tag === "add" ? operation.expectedParentDigest : operation.expectedValueDigest); if (tag === "add" || tag === "replace") assertJsonValue(operation.value);
  }
  if (!Array.isArray(core.evidenceClaims)) throw new DomainError("INVALID_ENVELOPE");
  const claimDigests = new Set<string>(); const claims = new Set<string>(); for (const itemValue of core.evidenceClaims) { const item = exactRecord(itemValue, ["digest", "claim"]); nonEmpty(item.digest); nonEmpty(item.claim); if (claimDigests.has(item.digest) || claims.has(item.claim)) throw new DomainError("INVALID_ENVELOPE"); claimDigests.add(item.digest); claims.add(item.claim); }
  if (core.predecessorProposalDigest !== null) nonEmpty(core.predecessorProposalDigest);
  if (core.predecessorReason !== null) nonEmpty(core.predecessorReason);
  if ((core.predecessorProposalDigest === null) !== (core.predecessorReason === null)) throw new DomainError("INVALID_ENVELOPE");
}
export function sealProposal(core: ProposalEnvelopeCoreV1): ProposalEnvelopeV1 {
  validateProposalCore(core);
  const normalized: ProposalEnvelopeCoreV1 = { ...core, receiptDigests: [...core.receiptDigests].sort(), evidenceClaims: [...core.evidenceClaims].sort((a, b) => a.digest.localeCompare(b.digest) || a.claim.localeCompare(b.claim)) };
  const proposalDigest = domainDigest("horseness.proposal.v1", normalized);
  return { core: normalized, proposalDigest, proposalId: digestId("prp_", proposalDigest) };
}
export function verifyProposal(envelope: ProposalEnvelopeV1): void {
  const value = exactRecord(envelope, ["core", "proposalDigest", "proposalId"]); nonEmpty(value.proposalDigest); nonEmpty(value.proposalId);
  validateProposalCore(value.core);
  const expected = sealProposal(value.core);
  if (expected.proposalDigest !== envelope.proposalDigest || expected.proposalId !== envelope.proposalId) throw new DomainError("PROPOSAL_ID_MISMATCH");
}
