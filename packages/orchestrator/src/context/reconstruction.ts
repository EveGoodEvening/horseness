import {
  attemptContextBindingDigest,
  bindContext,
  canonicalJson,
  contextManifestCoreDigest,
  domainDigest,
  DomainError,
  verifyForkPin,
  type AttemptContextBindingV1,
  type AuthorizationOverlayV1,
  type CompositeCursorV1,
  type ContextManifestCoreV1,
  type ContextManifestRecordV1,
  type ContextVersionV1,
  type JsonValue,
  type SealedForkPinV1,
  type SourceDescriptorV1,
} from "@horseness/domain";
import type { AuthenticatedAuthorityViewV1, TrustedAuthorityReader } from "@horseness/store-sqlite";

const encoder = new TextEncoder();
const snapshots = new WeakSet<object>();
const utf8Compare = (left: string, right: string): number => Buffer.compare(Buffer.from(left), Buffer.from(right));
const same = (left: unknown, right: unknown): boolean => canonicalJson(left as JsonValue) === canonicalJson(right as JsonValue);
function fail(code: string): never { throw new DomainError(code); }

export type ContextSourceKindV1 = "system" | "objective" | "task" | "canonical" | "dependency" | "receipt" | "evidence" | "decision" | "approval" | "policy" | "renderer" | "summary";
export interface ContextSourceInputV1 {
  readonly sourceId: string;
  readonly kind: ContextSourceKindV1;
  readonly priority: number;
  readonly bytes: Uint8Array | string;
  readonly digest: string;
  readonly activationEpoch: number;
  readonly deactivationEpoch: number | null;
  readonly visibleAtRunSequence: number;
  readonly artifactDigest: string | null;
}
export interface ContextArtifactAuthorityV1 {
  readDurableReferenced(digest: string, workspaceId: string): Uint8Array;
}
export interface AuthenticatedContextSnapshotV1 {
  readonly schemaVersion: "1";
  readonly view: AuthenticatedAuthorityViewV1;
  readonly pin: SealedForkPinV1;
  readonly canonicalState: JsonValue;
  readonly sources: readonly ContextSourceInputV1[];
  readonly artifacts: ContextArtifactAuthorityV1;
}
export interface ReconstructContextRequestV1 {
  readonly snapshot: AuthenticatedContextSnapshotV1;
  readonly attemptId: string;
  readonly generation: number;
  readonly byteBudget: number;
  readonly rendererVersion: string;
  readonly authorizationObservationCursor: CompositeCursorV1;
  readonly authorizationContextVersion: ContextVersionV1;
  readonly authorizationOverlay: AuthorizationOverlayV1;
  readonly providerIdempotencyKey: string;
  readonly allowedProducerPrincipalId: string;
  readonly allowedProducerGrantDigest: string;
  readonly tokenizerMetadata?: JsonValue | null;
}
export interface ReconstructedContextV1 {
  readonly bytes: Uint8Array;
  readonly manifest: ContextManifestRecordV1;
  readonly binding: AttemptContextBindingV1;
}

function bytesOf(value: Uint8Array | string): Uint8Array { return typeof value === "string" ? encoder.encode(value.normalize("NFC")) : new Uint8Array(value); }
function rawDigest(bytes: Uint8Array): string { return domainDigest("horseness.context-source-bytes.v1", Buffer.from(bytes).toString("base64") as unknown as JsonValue); }
function cursorAtPin(view: AuthenticatedAuthorityViewV1, pin: SealedForkPinV1): void {
  const cursor = pin.core.sourceObservationCursor;
  const workspace = view.workspaceEvents.find((item) => item.envelope.sequence === cursor.workspaceSequence);
  const run = view.runEvents.find((item) => item.envelope.sequence === cursor.runSequence);
  if (!workspace || workspace.envelopeHash !== cursor.workspaceEnvelopeHash || !run || run.envelopeHash !== cursor.runEnvelopeHash) fail("CONTEXT_AUTHORITY_CURSOR_SUBSTITUTED");
  if (cursor.workspaceContextEpoch !== Math.max(0, cursor.workspaceSequence - 1) || cursor.runContextEpoch !== Math.max(0, cursor.runSequence - 1)) fail("CONTEXT_AUTHORITY_CURSOR_SUBSTITUTED");
  if (view.cursor.workspaceId !== cursor.workspaceId || view.cursor.runId !== cursor.runId || view.cursor.workspaceSequence < cursor.workspaceSequence || view.cursor.runSequence < cursor.runSequence) fail("CONTEXT_AUTHORITY_CURSOR_STALE");
}

export function authenticateContextSnapshot(reader: TrustedAuthorityReader, input: Omit<AuthenticatedContextSnapshotV1, "schemaVersion" | "view">): AuthenticatedContextSnapshotV1 {
  verifyForkPin(input.pin);
  const view = reader.authenticatedView(input.pin.core.workspaceId, input.pin.core.runId);
  cursorAtPin(view, input.pin);
  if (domainDigest("horseness.canonical-document.v1", input.canonicalState) !== input.pin.core.canonicalStateHash) fail("CONTEXT_CANONICAL_STATE_SUBSTITUTED");
  const snapshot: AuthenticatedContextSnapshotV1 = Object.freeze({ schemaVersion: "1", view, ...input, sources: Object.freeze([...input.sources]) });
  snapshots.add(snapshot);
  return snapshot;
}

export function reconstructPinnedContext(request: ReconstructContextRequestV1): ReconstructedContextV1 {
  if (!snapshots.has(request.snapshot)) fail("CONTEXT_AUTHORITY_UNAUTHENTICATED");
  const { snapshot } = request;
  verifyForkPin(snapshot.pin);
  cursorAtPin(snapshot.view, snapshot.pin);
  if (!Number.isSafeInteger(request.generation) || request.generation < 1 || !Number.isSafeInteger(request.byteBudget) || request.byteBudget < 0) fail("INVALID_CONTEXT_REQUEST");
  if (!same(request.authorizationContextVersion.observationCursor, request.authorizationObservationCursor)) fail("CONTEXT_AUTHORIZATION_VERSION_SUBSTITUTED");
  const pin = snapshot.pin.core;
  if (pin.sourceContextVersion.kind !== "composite") fail("CONTEXT_VERSION_MISMATCH");
  const epoch = pin.sourceContextVersion.runContextEpoch;
  const visible = snapshot.sources.filter((source) => source.activationEpoch <= epoch && (source.deactivationEpoch === null || epoch < source.deactivationEpoch) && source.visibleAtRunSequence <= pin.sourceObservationCursor.runSequence);
  const normalized = visible.map((source) => {
    if (!source.sourceId || !Number.isSafeInteger(source.priority) || source.priority < 0 || source.activationEpoch < 0 || (source.deactivationEpoch !== null && source.deactivationEpoch <= source.activationEpoch)) fail("INVALID_CONTEXT_SOURCE");
    let bytes = bytesOf(source.bytes);
    if (source.artifactDigest !== null) {
      const durable = snapshot.artifacts.readDurableReferenced(source.artifactDigest, pin.workspaceId);
      if (!Buffer.from(durable).equals(Buffer.from(bytes))) fail("CONTEXT_ARTIFACT_SUBSTITUTED");
      bytes = new Uint8Array(durable);
    }
    if (rawDigest(bytes) !== source.digest) fail("CONTEXT_SOURCE_DIGEST_MISMATCH");
    return { source, bytes };
  }).sort((a, b) => a.source.priority - b.source.priority || utf8Compare(a.source.kind, b.source.kind) || utf8Compare(a.source.sourceId, b.source.sourceId) || utf8Compare(a.source.digest, b.source.digest));
  const chunks: Uint8Array[] = [], descriptors: SourceDescriptorV1[] = [], omissions: string[] = [];
  let offset = 0;
  for (const item of normalized) {
    if (offset + item.bytes.byteLength > request.byteBudget) { omissions.push(`budget:${item.source.sourceId}`); continue; }
    chunks.push(item.bytes); descriptors.push({ kind: item.source.kind, digest: item.source.digest, byteStart: offset, byteEnd: offset + item.bytes.byteLength, priority: item.source.priority }); offset += item.bytes.byteLength;
  }
  const bytes = new Uint8Array(offset); let position = 0; for (const chunk of chunks) { bytes.set(chunk, position); position += chunk.byteLength; }
  const renderedOutputDigest = rawDigest(bytes);
  const core: ContextManifestCoreV1 = {
    schemaVersion: "1", workspaceId: pin.workspaceId, runId: pin.runId, attemptId: request.attemptId, generation: request.generation,
    forkPinDigest: snapshot.pin.forkPinDigest, sourceObservationCursor: pin.sourceObservationCursor, sourceContextVersion: pin.sourceContextVersion,
    authorizationObservationCursor: request.authorizationObservationCursor, authorizationContextVersion: request.authorizationContextVersion,
    authorizationOverlayV1: request.authorizationOverlay, canonicalRevision: pin.canonicalRevision, canonicalStateHash: pin.canonicalStateHash,
    canonicalizerVersion: pin.canonicalizerVersion, hashVersion: pin.hashVersion, sources: descriptors, rendererVersion: request.rendererVersion,
    omissions: omissions.sort(utf8Compare), selectedBytes: offset, byteBudget: request.byteBudget, tokenizerMetadata: request.tokenizerMetadata ?? null, renderedOutputDigest,
  };
  const manifestDigest = contextManifestCoreDigest(core);
  const binding: AttemptContextBindingV1 = {
    schemaVersion: "1", attemptId: request.attemptId, generation: request.generation, forkPinDigest: snapshot.pin.forkPinDigest,
    contextManifestCoreDigest: manifestDigest, sourceObservationCursor: pin.sourceObservationCursor, sourceContextVersion: pin.sourceContextVersion,
    authorizationObservationCursor: request.authorizationObservationCursor, authorizationContextVersion: request.authorizationContextVersion,
    providerIdempotencyKey: request.providerIdempotencyKey, expectedReceiptSchemaVersion: "1", allowedProducerPrincipalId: request.allowedProducerPrincipalId,
    allowedProducerGrantDigest: request.allowedProducerGrantDigest,
  };
  const { contextManifestCoreDigest: _manifestDigest, ...bindingInput } = binding;
  const manifest = bindContext(core, bindingInput);
  if (manifest.contextManifestCoreDigest !== manifestDigest || manifest.attemptContextBindingDigest !== attemptContextBindingDigest(binding)) fail("CONTEXT_BINDING_DIGEST_MISMATCH");
  return Object.freeze({ bytes, manifest, binding });
}

export function contextSourceDigest(bytes: Uint8Array | string): string { return rawDigest(bytesOf(bytes)); }
