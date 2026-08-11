import { digestId, domainDigest, DomainError, type JsonValue } from "./canonical.js";
import type { CompositeCursorV1, ContextVersionV1, ObservationCursorV1 } from "./events.js";

export interface DependencyOutcomeV1 { edgeId: string; edgeType: "requires_success" | "requires_terminal" | "requires_outcome"; sourceTaskId: string; taskResolutionEventSequence: number; taskResolutionDigest: string; winningGeneration: number | null }
export interface DependencyJoinSnapshotCoreV1 { schemaVersion: "1"; runId: string; taskId: string; taskContractDigest: string; joinEvaluationId: string; joinObservationCursor: CompositeCursorV1; dependencies: DependencyOutcomeV1[]; schedulability: Schedulability; reasonCodes: string[] }
export type Schedulability = "ineligible" | "blocked" | "ready" | "running" | "unknown_outcome" | "terminal";
export function sealDependencyJoinSnapshot(core: DependencyJoinSnapshotCoreV1): { core: DependencyJoinSnapshotCoreV1; digest: string; id: string } {
  const normalized = { ...core, dependencies: [...core.dependencies].sort((a, b) => a.sourceTaskId.localeCompare(b.sourceTaskId) || a.edgeId.localeCompare(b.edgeId)), reasonCodes: [...new Set(core.reasonCodes)].sort() };
  const digest = domainDigest("horseness.dependency-join-snapshot-core.v1", normalized);
  return { core: normalized, digest, id: digestId("djs_", digest) };
}

export interface ForkPinCoreV1 { schemaVersion: "1"; forkId: string; pinVersion: number; workspaceId: string; runId: string; parentForkPinDigest: string | null; refreshesForkPinDigest: string | null; canonicalRevision: number; canonicalStateHash: string; canonicalizerVersion: "jcs-v1"; hashVersion: "sha256-v1"; sourceObservationCursor: CompositeCursorV1; sourceContextVersion: ContextVersionV1; dependencyJoinSnapshotDigest: string; deltaAuthorityScopeDigest: string; pinnedPolicyDigest: string; ancestry: string[]; createdByPrincipalId: string; createdByGrantDigest: string }
export function sealForkPin(core: ForkPinCoreV1): { core: ForkPinCoreV1; forkPinDigest: string; forkPinId: string } {
  if (core.pinVersion < 1 || new Set(core.ancestry).size !== core.ancestry.length || (core.parentForkPinDigest === null ? core.ancestry.length !== 0 : core.ancestry.at(-1) !== core.parentForkPinDigest)) throw new DomainError("INVALID_ENVELOPE", "invalid fork ancestry");
  if (core.refreshesForkPinDigest !== null && (core.parentForkPinDigest !== core.refreshesForkPinDigest || core.pinVersion < 2)) throw new DomainError("INVALID_ENVELOPE", "invalid refresh lineage");
  const forkPinDigest = domainDigest("horseness.fork-pin-core.v1", core);
  return { core, forkPinDigest, forkPinId: digestId("fpk_", forkPinDigest) };
}

export interface SourceDescriptorV1 { kind: string; digest: string; byteStart: number; byteEnd: number; priority: number }
export interface AuthorizationOverlayV1 { policyDigest: string; grantDigest: string; quotaDigest: string; result: "allowed" | "denied" }
export interface ContextManifestCoreV1 { schemaVersion: "1"; workspaceId: string; runId: string; attemptId: string; generation: number; forkPinDigest: string; sourceObservationCursor: CompositeCursorV1; sourceContextVersion: ContextVersionV1; authorizationObservationCursor: ObservationCursorV1; authorizationContextVersion: ContextVersionV1; authorizationOverlayV1: AuthorizationOverlayV1; canonicalRevision: number; canonicalStateHash: string; canonicalizerVersion: "jcs-v1"; hashVersion: "sha256-v1"; sources: SourceDescriptorV1[]; rendererVersion: string; omissions: string[]; selectedBytes: number; byteBudget: number; tokenizerMetadata: JsonValue | null; renderedOutputDigest: string }
export function contextManifestCoreDigest(core: ContextManifestCoreV1): string { return domainDigest("horseness.context-manifest-core.v1", core); }
export interface AttemptContextBindingV1 { schemaVersion: "1"; attemptId: string; generation: number; forkPinDigest: string; contextManifestCoreDigest: string; sourceObservationCursor: CompositeCursorV1; sourceContextVersion: ContextVersionV1; authorizationObservationCursor: ObservationCursorV1; authorizationContextVersion: ContextVersionV1; providerIdempotencyKey: string; expectedReceiptSchemaVersion: "1"; allowedProducerPrincipalId: string; allowedProducerGrantDigest: string }
export function attemptContextBindingDigest(binding: AttemptContextBindingV1): string { return domainDigest("horseness.attempt-context-binding.v1", binding); }
export interface ContextManifestRecordV1 { core: ContextManifestCoreV1; contextManifestCoreDigest: string; attemptContextBindingDigest: string }
export function bindContext(core: ContextManifestCoreV1, bindingInput: Omit<AttemptContextBindingV1, "contextManifestCoreDigest">): ContextManifestRecordV1 {
  const manifestDigest = contextManifestCoreDigest(core);
  const binding: AttemptContextBindingV1 = { ...bindingInput, contextManifestCoreDigest: manifestDigest };
  if (binding.forkPinDigest !== core.forkPinDigest || binding.attemptId !== core.attemptId || binding.generation !== core.generation) throw new DomainError("RECEIPT_MISMATCH");
  return { core, contextManifestCoreDigest: manifestDigest, attemptContextBindingDigest: attemptContextBindingDigest(binding) };
}
