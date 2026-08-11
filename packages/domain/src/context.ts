import { canonicalJson, digestId, domainDigest, DomainError, type JsonValue } from "./canonical.js";
import type { CompositeCursorV1, ContextVersionV1, ObservationCursorV1 } from "./events.js";

export interface DependencyOutcomeV1 { edgeId: string; edgeType: "requires_success" | "requires_terminal" | "requires_outcome"; sourceTaskId: string; taskResolutionEventSequence: number; taskResolutionDigest: string; winningGeneration: number | null }
export interface DependencyJoinSnapshotCoreV1 { schemaVersion: "1"; runId: string; taskId: string; taskContractDigest: string; joinEvaluationId: string; joinObservationCursor: CompositeCursorV1; dependencies: DependencyOutcomeV1[]; schedulability: Schedulability; reasonCodes: string[] }
export type Schedulability = "ineligible" | "blocked" | "ready" | "running" | "unknown_outcome" | "terminal";
export function sealDependencyJoinSnapshot(core: DependencyJoinSnapshotCoreV1): { core: DependencyJoinSnapshotCoreV1; digest: string; id: string } {
  const dependencies = [...core.dependencies].sort((a, b) => a.sourceTaskId.localeCompare(b.sourceTaskId) || a.edgeId.localeCompare(b.edgeId));
  if (new Set(dependencies.map((item) => item.edgeId)).size !== dependencies.length || dependencies.some((item) => item.taskResolutionEventSequence < 1 || !item.taskResolutionDigest)) throw new DomainError("INVALID_DEPENDENCY_SNAPSHOT");
  const normalized = { ...core, dependencies, reasonCodes: [...new Set(core.reasonCodes)].sort() };
  const digest = domainDigest("horseness.dependency-join-snapshot-core.v1", normalized);
  return { core: normalized, digest, id: digestId("djs_", digest) };
}

export interface ForkPinCoreV1 { schemaVersion: "1"; forkId: string; pinVersion: number; workspaceId: string; runId: string; parentForkPinDigest: string | null; refreshesForkPinDigest: string | null; canonicalRevision: number; canonicalStateHash: string; canonicalizerVersion: "jcs-v1"; hashVersion: "sha256-v1"; sourceObservationCursor: CompositeCursorV1; sourceContextVersion: ContextVersionV1; dependencyJoinSnapshotDigest: string; deltaAuthorityScopeDigest: string; pinnedPolicyDigest: string; ancestry: string[]; createdByPrincipalId: string; createdByGrantDigest: string }
export interface SealedForkPinV1 { core: ForkPinCoreV1; forkPinDigest: string; forkPinId: string }
function validateForkPinCore(core: ForkPinCoreV1): void {
  if (core.schemaVersion !== "1" || core.pinVersion < 1 || core.canonicalRevision < 0 || !core.forkId || !core.workspaceId || !core.runId) throw new DomainError("INVALID_ENVELOPE", "invalid fork pin");
  if (core.sourceContextVersion.kind !== "composite" || canonicalJson(core.sourceContextVersion.observationCursor) !== canonicalJson(core.sourceObservationCursor)) throw new DomainError("CONTEXT_VERSION_MISMATCH");
  if (new Set(core.ancestry).size !== core.ancestry.length || (core.parentForkPinDigest === null ? core.ancestry.length !== 0 : core.ancestry.at(-1) !== core.parentForkPinDigest)) throw new DomainError("INVALID_ENVELOPE", "invalid fork ancestry");
  if (core.refreshesForkPinDigest !== null && core.parentForkPinDigest !== core.refreshesForkPinDigest) throw new DomainError("INVALID_ENVELOPE", "invalid refresh lineage");
  if (core.pinVersion === 1 && core.refreshesForkPinDigest !== null) throw new DomainError("INVALID_ENVELOPE", "initial pin cannot refresh");
}
export function sealForkPin(core: ForkPinCoreV1): SealedForkPinV1 {
  validateForkPinCore(core);
  const forkPinDigest = domainDigest("horseness.fork-pin-core.v1", core);
  return { core, forkPinDigest, forkPinId: digestId("fpk_", forkPinDigest) };
}
export function verifyForkPin(pin: SealedForkPinV1): void {
  const sealed = sealForkPin(pin.core);
  if (sealed.forkPinDigest !== pin.forkPinDigest || sealed.forkPinId !== pin.forkPinId) throw new DomainError("FORK_PIN_AUTHENTICATION_FAILED");
}
export function createForkPin(core: Omit<ForkPinCoreV1, "ancestry">, parent: SealedForkPinV1 | null): SealedForkPinV1 {
  if (parent === null) {
    if (core.parentForkPinDigest !== null || core.refreshesForkPinDigest !== null || core.pinVersion !== 1) throw new DomainError("INVALID_FORK_LINEAGE");
    return sealForkPin({ ...core, ancestry: [] });
  }
  verifyForkPin(parent);
  if (core.parentForkPinDigest !== parent.forkPinDigest || core.workspaceId !== parent.core.workspaceId || core.runId !== parent.core.runId) throw new DomainError("FORK_PARENT_MISMATCH");
  const refresh = core.refreshesForkPinDigest !== null;
  if (refresh && (core.refreshesForkPinDigest !== parent.forkPinDigest || core.forkId !== parent.core.forkId || core.pinVersion !== parent.core.pinVersion + 1)) throw new DomainError("FORK_REFRESH_CONTINUITY");
  if (!refresh && (core.forkId === parent.core.forkId || core.pinVersion !== 1)) throw new DomainError("FORK_IDENTITY_CONTINUITY");
  return sealForkPin({ ...core, ancestry: [...parent.core.ancestry, parent.forkPinDigest] });
}
export function refreshForkPin(parent: SealedForkPinV1, changes: Omit<ForkPinCoreV1, "forkId" | "pinVersion" | "workspaceId" | "runId" | "parentForkPinDigest" | "refreshesForkPinDigest" | "ancestry">): SealedForkPinV1 {
  verifyForkPin(parent);
  return createForkPin({ ...changes, forkId: parent.core.forkId, pinVersion: parent.core.pinVersion + 1, workspaceId: parent.core.workspaceId, runId: parent.core.runId, parentForkPinDigest: parent.forkPinDigest, refreshesForkPinDigest: parent.forkPinDigest }, parent);
}

export interface SourceDescriptorV1 { kind: string; digest: string; byteStart: number; byteEnd: number; priority: number }
export interface AuthorizationOverlayV1 { policyDigest: string; grantDigest: string; quotaDigest: string; result: "allowed" | "denied" }
export interface ContextManifestCoreV1 { schemaVersion: "1"; workspaceId: string; runId: string; attemptId: string; generation: number; forkPinDigest: string; sourceObservationCursor: CompositeCursorV1; sourceContextVersion: ContextVersionV1; authorizationObservationCursor: ObservationCursorV1; authorizationContextVersion: ContextVersionV1; authorizationOverlayV1: AuthorizationOverlayV1; canonicalRevision: number; canonicalStateHash: string; canonicalizerVersion: "jcs-v1"; hashVersion: "sha256-v1"; sources: SourceDescriptorV1[]; rendererVersion: string; omissions: string[]; selectedBytes: number; byteBudget: number; tokenizerMetadata: JsonValue | null; renderedOutputDigest: string }
function validateManifest(core: ContextManifestCoreV1): void {
  if (core.generation < 1 || core.canonicalRevision < 0 || core.selectedBytes < 0 || core.byteBudget < 0 || core.selectedBytes > core.byteBudget) throw new DomainError("INVALID_CONTEXT_MANIFEST");
  if (core.sourceContextVersion.kind !== "composite" || canonicalJson(core.sourceContextVersion.observationCursor) !== canonicalJson(core.sourceObservationCursor) || canonicalJson(core.authorizationContextVersion.observationCursor) !== canonicalJson(core.authorizationObservationCursor)) throw new DomainError("CONTEXT_VERSION_MISMATCH");
  for (const source of core.sources) if (source.byteStart < 0 || source.byteEnd < source.byteStart || source.byteEnd > core.selectedBytes) throw new DomainError("INVALID_CONTEXT_SOURCE");
}
export function contextManifestCoreDigest(core: ContextManifestCoreV1): string { validateManifest(core); return domainDigest("horseness.context-manifest-core.v1", core); }
export interface AttemptContextBindingV1 { schemaVersion: "1"; attemptId: string; generation: number; forkPinDigest: string; contextManifestCoreDigest: string; sourceObservationCursor: CompositeCursorV1; sourceContextVersion: ContextVersionV1; authorizationObservationCursor: ObservationCursorV1; authorizationContextVersion: ContextVersionV1; providerIdempotencyKey: string; expectedReceiptSchemaVersion: "1"; allowedProducerPrincipalId: string; allowedProducerGrantDigest: string }
export function attemptContextBindingDigest(binding: AttemptContextBindingV1): string {
  if (binding.generation < 1 || !binding.providerIdempotencyKey || binding.sourceContextVersion.kind !== "composite" || canonicalJson(binding.sourceContextVersion.observationCursor) !== canonicalJson(binding.sourceObservationCursor) || canonicalJson(binding.authorizationContextVersion.observationCursor) !== canonicalJson(binding.authorizationObservationCursor)) throw new DomainError("INVALID_CONTEXT_BINDING");
  return domainDigest("horseness.attempt-context-binding.v1", binding);
}
export interface ContextManifestRecordV1 { core: ContextManifestCoreV1; contextManifestCoreDigest: string; attemptContextBindingDigest: string }
export function bindContext(core: ContextManifestCoreV1, bindingInput: Omit<AttemptContextBindingV1, "contextManifestCoreDigest">): ContextManifestRecordV1 {
  const manifestDigest = contextManifestCoreDigest(core);
  const binding: AttemptContextBindingV1 = { ...bindingInput, contextManifestCoreDigest: manifestDigest };
  if (binding.forkPinDigest !== core.forkPinDigest || binding.attemptId !== core.attemptId || binding.generation !== core.generation || canonicalJson(binding.sourceObservationCursor) !== canonicalJson(core.sourceObservationCursor) || canonicalJson(binding.sourceContextVersion) !== canonicalJson(core.sourceContextVersion)) throw new DomainError("RECEIPT_MISMATCH");
  return { core, contextManifestCoreDigest: manifestDigest, attemptContextBindingDigest: attemptContextBindingDigest(binding) };
}
