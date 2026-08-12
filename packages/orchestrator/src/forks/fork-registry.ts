import {
  DomainError,
  assertContextVersionV1,
  assertObservationCursorV1,
  canonicalJson,
  createForkPin,
  deltaAuthorityScopeDigest,
  domainDigest,
  refreshForkPin,
  verifyForkPin,
  type CompositeCursorV1,
  type ContextVersionV1,
  type DeltaAuthorityScopeV1,
  type JsonValue,
  type SealedForkPinV1,
} from "@horseness/domain";
import type { TrustedAuthorityReader } from "@horseness/store-sqlite";

export interface ForkSourceSnapshotV1 {
  schemaVersion: "1";
  workspaceId: string;
  runId: string;
  observationCursor: CompositeCursorV1;
  contextVersion: ContextVersionV1;
  canonicalRevision: number;
  canonicalStateHash: string;
  dependencyJoinSnapshotDigest: string;
  scope: DeltaAuthorityScopeV1;
  pinnedPolicyDigest: string;
}

export interface ForkAuthorizationSnapshotV1 {
  schemaVersion: "1";
  workspaceId: string;
  runId: string;
  observationCursor: CompositeCursorV1;
  contextVersion: ContextVersionV1;
  principalId: string;
  grantDigest: string;
  revoked: boolean;
  pinnedPolicyDigest: string;
  currentPolicyDigest: string;
  quotaId: string;
  quotaDigest: string;
  quotaAvailable: boolean;
  expectedActiveForkPinDigest: string | null;
}

export interface ForkAuthorityContextV1 {
  source: ForkSourceSnapshotV1;
  authorization: ForkAuthorizationSnapshotV1;
}

const forkAuthorityCapabilities = new WeakSet<object>();
const forkAuthorityCapability: unique symbol = Symbol("forkAuthorityCapability");
export interface ForkAuthorityCapabilityV1 {
  readonly context: ForkAuthorityContextV1;
  readonly [forkAuthorityCapability]: true;
}

export interface ForkAuthoritySnapshotIdentitiesV1 {
  sourceSnapshotDigest: string;
  authorizationSnapshotDigest: string;
}

export interface ForkProjectionV1 {
  pins: ReadonlyMap<string, SealedForkPinV1>;
  activeByForkId: ReadonlyMap<string, string>;
  authoritySnapshotsByPin: ReadonlyMap<string, ForkAuthoritySnapshotIdentitiesV1>;
}

export function emptyForkProjection(): ForkProjectionV1 {
  return { pins: new Map(), activeByForkId: new Map(), authoritySnapshotsByPin: new Map() };
}

function fail(code: string): never { throw new DomainError(code); }
function same(left: unknown, right: unknown): boolean { return canonicalJson(left as JsonValue) === canonicalJson(right as JsonValue); }

function authenticate(capability: ForkAuthorityCapabilityV1): ForkAuthoritySnapshotIdentitiesV1 {
  if (!forkAuthorityCapabilities.has(capability) || capability[forkAuthorityCapability] !== true) fail("FORK_AUTHORITY_UNAUTHENTICATED");
  const context = capability.context;
  const { source, authorization } = context;
  if (source.schemaVersion !== "1" || authorization.schemaVersion !== "1") fail("UNSUPPORTED_SCHEMA_VERSION");
  try {
    assertObservationCursorV1(source.observationCursor);
    assertObservationCursorV1(authorization.observationCursor);
    assertContextVersionV1(source.contextVersion);
    assertContextVersionV1(authorization.contextVersion);
  } catch { fail("FORK_AUTHORITY_CURSOR_INVALID"); }
  if (source.observationCursor.kind !== "composite" || authorization.observationCursor.kind !== "composite") fail("FORK_AUTHORITY_CURSOR_INVALID");
  if (!same(source.contextVersion.observationCursor, source.observationCursor) || !same(authorization.contextVersion.observationCursor, authorization.observationCursor)) fail("CONTEXT_VERSION_MISMATCH");
  if (source.workspaceId !== authorization.workspaceId || source.runId !== authorization.runId ||
      source.observationCursor.workspaceId !== source.workspaceId || source.observationCursor.runId !== source.runId ||
      authorization.observationCursor.workspaceId !== authorization.workspaceId || authorization.observationCursor.runId !== authorization.runId ||
      source.scope.workspaceId !== source.workspaceId || source.scope.runId !== source.runId) fail("CAPABILITY_SCOPE_MISMATCH");
  if (!authorization.principalId || !authorization.grantDigest) fail("FORK_GRANT_INVALID");
  if (authorization.revoked) fail("FORK_GRANT_REVOKED");
  if (authorization.pinnedPolicyDigest !== source.pinnedPolicyDigest) fail("FORK_PINNED_POLICY_SUBSTITUTED");
  if (!authorization.currentPolicyDigest) fail("FORK_CURRENT_POLICY_INVALID");
  if (!authorization.quotaId || !authorization.quotaDigest || !authorization.quotaAvailable) fail("FORK_QUOTA_UNAVAILABLE");
  const { expectedActiveForkPinDigest: _casExpectation, ...authenticatedAuthorization } = authorization;
  return {
    sourceSnapshotDigest: domainDigest("horseness.fork-source-snapshot.v1", source as unknown as JsonValue),
    authorizationSnapshotDigest: domainDigest("horseness.fork-authorization-snapshot.v1", authenticatedAuthorization as unknown as JsonValue),
  };
}

function record(value: JsonValue, code: string): Record<string, JsonValue> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) fail(code);
  return value as Record<string, JsonValue>;
}

export function issueForkAuthorityCapability(reader: TrustedAuthorityReader, input: { workspaceId: string; runId: string }): ForkAuthorityCapabilityV1 {
  const view = reader.authenticatedView(input.workspaceId, input.runId);
  const source = structuredClone(record(reader.exactRunHeadSnapshot(input.workspaceId, input.runId, "fork-source").state, "FORK_SOURCE_AUTHORITY_INVALID")) as unknown as ForkSourceSnapshotV1;
  const authorization = structuredClone(record(reader.exactRunHeadSnapshot(input.workspaceId, input.runId, "fork-authorization").state, "FORK_AUTHORIZATION_AUTHORITY_INVALID")) as unknown as ForkAuthorizationSnapshotV1;
  if (!same(authorization.observationCursor, view.cursor)) fail("FORK_AUTHORITY_CURSOR_INVALID");
  const capability = Object.freeze({ context: Object.freeze({ source: Object.freeze(source), authorization: Object.freeze(authorization) }), [forkAuthorityCapability]: true as const });
  forkAuthorityCapabilities.add(capability);
  authenticate(capability);
  return capability;
}

function pinInput(context: ForkAuthorityContextV1) {
  const { source, authorization } = context;
  return { schemaVersion: "1" as const, canonicalRevision: source.canonicalRevision, canonicalStateHash: source.canonicalStateHash,
    canonicalizerVersion: "jcs-v1" as const, hashVersion: "sha256-v1" as const, sourceObservationCursor: source.observationCursor,
    sourceContextVersion: source.contextVersion, dependencyJoinSnapshotDigest: source.dependencyJoinSnapshotDigest,
    deltaAuthorityScopeDigest: deltaAuthorityScopeDigest(source.scope), pinnedPolicyDigest: source.pinnedPolicyDigest,
    createdByPrincipalId: authorization.principalId, createdByGrantDigest: authorization.grantDigest };
}

export function createProjectedFork(state: ForkProjectionV1, forkId: string, capability: ForkAuthorityCapabilityV1): { state: ForkProjectionV1; pin: SealedForkPinV1 } {
  const identities = authenticate(capability);
  const context = capability.context;
  if (state.activeByForkId.has(forkId) || context.authorization.expectedActiveForkPinDigest !== null) fail("FORK_IDENTITY_CONTINUITY");
  const pin = createForkPin({ ...pinInput(context), forkId, pinVersion: 1, workspaceId: context.source.workspaceId, runId: context.source.runId, parentForkPinDigest: null, refreshesForkPinDigest: null }, null);
  return store(state, pin, identities);
}

export function refreshProjectedFork(state: ForkProjectionV1, forkId: string, capability: ForkAuthorityCapabilityV1): { state: ForkProjectionV1; pin: SealedForkPinV1 } {
  const identities = authenticate(capability);
  const context = capability.context;
  const digest = state.activeByForkId.get(forkId);
  const parent = digest ? state.pins.get(digest) : undefined;
  if (!parent || context.authorization.expectedActiveForkPinDigest !== digest) fail("FORK_REFRESH_CAS_MISMATCH");
  verifyForkPin(parent);
  if (parent.core.workspaceId !== context.source.workspaceId || parent.core.runId !== context.source.runId) fail("FORK_PARENT_MISMATCH");
  const pin = refreshForkPin(parent, pinInput(context));
  return store(state, pin, identities);
}

export function reuseProjectedFork(state: ForkProjectionV1, forkId: string, capability: ForkAuthorityCapabilityV1): SealedForkPinV1 {
  const identities = authenticate(capability);
  const context = capability.context;
  const digest = state.activeByForkId.get(forkId);
  const pin = digest ? state.pins.get(digest) : undefined;
  if (!pin || context.authorization.expectedActiveForkPinDigest !== digest) fail("FORK_REUSE_STALE");
  verifyForkPin(pin);
  const recorded = state.authoritySnapshotsByPin.get(pin.forkPinDigest);
  if (!recorded || !same(recorded, identities) || pin.core.canonicalRevision !== context.source.canonicalRevision ||
      pin.core.canonicalStateHash !== context.source.canonicalStateHash || pin.core.dependencyJoinSnapshotDigest !== context.source.dependencyJoinSnapshotDigest ||
      pin.core.deltaAuthorityScopeDigest !== deltaAuthorityScopeDigest(context.source.scope) || pin.core.pinnedPolicyDigest !== context.source.pinnedPolicyDigest ||
      !same(pin.core.sourceObservationCursor, context.source.observationCursor) || !same(pin.core.sourceContextVersion, context.source.contextVersion)) fail("FORK_REUSE_STALE");
  return pin;
}

function store(state: ForkProjectionV1, pin: SealedForkPinV1, identities: ForkAuthoritySnapshotIdentitiesV1): { state: ForkProjectionV1; pin: SealedForkPinV1 } {
  const pins = new Map(state.pins); pins.set(pin.forkPinDigest, pin);
  const activeByForkId = new Map(state.activeByForkId); activeByForkId.set(pin.core.forkId, pin.forkPinDigest);
  const authoritySnapshotsByPin = new Map(state.authoritySnapshotsByPin); authoritySnapshotsByPin.set(pin.forkPinDigest, identities);
  return { state: { pins, activeByForkId, authoritySnapshotsByPin }, pin };
}
