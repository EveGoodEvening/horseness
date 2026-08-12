import {
  canonicalJson,
  DomainError,
  domainDigest,
  reduceDispatch,
  verifyAttemptReceipt,
  type AttemptGenerationStateV1,
  type AttemptReceiptEnvelopeV1,
  type AttemptTerminalState,
  type HashedEventEnvelopeV1,
  type JsonValue,
  type TaskResolution,
} from "@horseness/domain";

export interface ReceiptGenerationOutcomeV1 {
  generation: number;
  outcome: AttemptTerminalState;
  receiptDigest: string;
  receiptId: string;
  terminalEventSequence: number;
}

export interface TaskResolvedProjectionV1 {
  readonly taskId: string;
  readonly resolution: TaskResolution;
  readonly winningGeneration: number | null;
  readonly resolutionEventSequence: number;
  readonly resolutionDigest: string;
}

export interface AttemptReceiptProjectionV1 {
  readonly attemptId: string;
  readonly taskId: string | null;
  readonly generations: ReadonlyMap<number, AttemptGenerationStateV1>;
  readonly outcomes: ReadonlyMap<number, ReceiptGenerationOutcomeV1>;
  readonly retryPermittedGenerations: ReadonlySet<number>;
  readonly explicitCancellationEventSequence: number | null;
  readonly resolution: TaskResolvedProjectionV1 | null;
  readonly winningGeneration: number | null;
  readonly findings: readonly string[];
}

export interface ReceiptEventV1 {
  readonly eventSequence: number;
  readonly eventDigest: string;
  readonly authenticatedPrincipalId: string;
  readonly receipt: AttemptReceiptEnvelopeV1;
}

export interface ReceiptStreamReplayProofV1 {
  readonly workspaceId: string;
  readonly runId: string;
  readonly headSequence: number;
  readonly headEnvelopeHash: string;
  readonly replayDigest: string;
  readonly replay: readonly HashedEventEnvelopeV1<unknown>[];
}

export interface AttemptAuthorityInputV1 {
  readonly binding: {
    readonly attemptId: string;
    readonly generation: number;
    readonly digest: string;
    readonly contextManifestCoreDigest: string;
    readonly forkPinDigest: string;
    readonly providerId: string;
    readonly providerOperationId: string;
    readonly providerIdempotencyKeyDigest: string;
    readonly allowedProducerPrincipalId: string;
    readonly allowedProducerGrantDigest: string;
  };
  readonly providerHandle?: string;
  readonly grant: { readonly principalId: string; readonly grantDigest: string; readonly revoked: boolean };
  readonly dispatch: { readonly attemptId: string; readonly generation: number; readonly providerId: string; readonly providerOperationId: string; readonly providerIdempotencyKeyDigest: string; readonly providerHandle?: string };
}

export interface AttemptAuthorityReplayProofV1 extends ReceiptStreamReplayProofV1 {
  readonly bindingEventSequence: number;
  readonly grantEventSequence: number;
  readonly dispatchEventSequence: number;
}

declare const verifiedReceiptEventBrand: unique symbol;
declare const verifiedAttemptAuthorityBrand: unique symbol;
export type VerifiedReceiptEventV1 = ReceiptEventV1 & { readonly [verifiedReceiptEventBrand]: true };
export type VerifiedAttemptAuthorityV1 = AttemptAuthorityInputV1 & { readonly [verifiedAttemptAuthorityBrand]: true };

const verifiedReceiptEvents = new WeakSet<object>();
const verifiedAttemptAuthorities = new WeakSet<object>();
const receiptIdentities = new WeakMap<object, object>();
const authorityIdentities = new WeakMap<object, object>();
const identities = new Map<string, object>();
const identityFor = (attemptId: string, generation: number): object => {
  const key = `${attemptId}\u0000${generation}`;
  const prior = identities.get(key);
  if (prior) return prior;
  const identity = Object.freeze({}); identities.set(key, identity); return identity;
};
const fail = (code: string): never => { throw new DomainError(code); };
const replayDigest = (replay: readonly HashedEventEnvelopeV1<unknown>[]): string => domainDigest("horseness.receipt-authority-replay.v1", replay as unknown as JsonValue);

export function verifyReceiptEvent(event: ReceiptEventV1, proof: ReceiptStreamReplayProofV1): VerifiedReceiptEventV1 {
  verifyAttemptReceipt(event.receipt);
  let prior: string | null = null;
  let sequence = 1;
  for (const item of proof.replay) {
    if (item.envelope.schemaVersion !== "1" || item.envelope.streamKind !== "run" || item.envelope.workspaceId !== proof.workspaceId || item.envelope.streamId !== proof.runId || item.envelope.sequence !== sequence || item.envelope.priorEnvelopeHash !== prior || item.envelope.payloadHash !== domainDigest("horseness.event-payload.v1", item.envelope.payload as JsonValue) || item.envelopeHash !== domainDigest("horseness.event-envelope.v1", item.envelope as unknown as JsonValue)) fail("UNAUTHENTICATED_RECEIPT_EVENT");
    prior = item.envelopeHash; sequence += 1;
  }
  const head = proof.replay.at(-1);
  const replayed = proof.replay.find((item) => item.envelope.sequence === event.eventSequence);
  if (!head || proof.headSequence !== head.envelope.sequence || proof.headEnvelopeHash !== head.envelopeHash || proof.replayDigest !== replayDigest(proof.replay) || !replayed || replayed.envelopeHash !== event.eventDigest || replayed.envelope.principalId !== event.authenticatedPrincipalId || canonicalJson(replayed.envelope.payload) !== canonicalJson(event.receipt) || event.receipt.workspaceId !== proof.workspaceId || event.receipt.runId !== proof.runId) fail("UNAUTHENTICATED_RECEIPT_EVENT");
  const verified = Object.freeze({ ...event }) as VerifiedReceiptEventV1;
  verifiedReceiptEvents.add(verified); receiptIdentities.set(verified, identityFor(event.receipt.attemptId, event.receipt.generation));
  return verified;
}

export function verifyAttemptAuthority(input: AttemptAuthorityInputV1, proof: AttemptAuthorityReplayProofV1): VerifiedAttemptAuthorityV1 {
  const { binding, grant, dispatch } = input;
  if (grant.revoked || grant.principalId !== binding.allowedProducerPrincipalId || grant.grantDigest !== binding.allowedProducerGrantDigest || dispatch.attemptId !== binding.attemptId || dispatch.generation !== binding.generation || dispatch.providerId !== binding.providerId || dispatch.providerOperationId !== binding.providerOperationId || dispatch.providerIdempotencyKeyDigest !== binding.providerIdempotencyKeyDigest || dispatch.providerHandle !== input.providerHandle) fail("RECEIPT_AUTHORITY_INVALID");
  let prior: string | null = null;
  let sequence = 1;
  for (const item of proof.replay) {
    if (item.envelope.schemaVersion !== "1" || item.envelope.streamKind !== "run" || item.envelope.workspaceId !== proof.workspaceId || item.envelope.streamId !== proof.runId || item.envelope.sequence !== sequence || item.envelope.priorEnvelopeHash !== prior || item.envelope.payloadHash !== domainDigest("horseness.event-payload.v1", item.envelope.payload as JsonValue) || item.envelopeHash !== domainDigest("horseness.event-envelope.v1", item.envelope as unknown as JsonValue)) fail("RECEIPT_AUTHORITY_UNAUTHENTICATED");
    prior = item.envelopeHash; sequence += 1;
  }
  const head = proof.replay.at(-1);
  const bindingEvent = proof.replay.find((item) => item.envelope.sequence === proof.bindingEventSequence);
  const grantEvent = proof.replay.find((item) => item.envelope.sequence === proof.grantEventSequence);
  const dispatchEvent = proof.replay.find((item) => item.envelope.sequence === proof.dispatchEventSequence);
  if (!head || head.envelope.sequence !== proof.headSequence || head.envelopeHash !== proof.headEnvelopeHash || proof.replayDigest !== replayDigest(proof.replay) || !bindingEvent || !grantEvent || !dispatchEvent || bindingEvent.envelope.eventType !== "AttemptContextBindingProjectedV1" || grantEvent.envelope.eventType !== "AttemptGrantProjectedV1" || dispatchEvent.envelope.eventType !== "AttemptDispatchProjectedV1" || canonicalJson(bindingEvent.envelope.payload) !== canonicalJson(binding) || canonicalJson(grantEvent.envelope.payload) !== canonicalJson(grant) || canonicalJson(dispatchEvent.envelope.payload) !== canonicalJson(dispatch)) fail("RECEIPT_AUTHORITY_UNAUTHENTICATED");
  const verified = Object.freeze({ ...input, binding: Object.freeze({ ...binding }), grant: Object.freeze({ ...grant }), dispatch: Object.freeze({ ...dispatch }) }) as VerifiedAttemptAuthorityV1;
  verifiedAttemptAuthorities.add(verified); authorityIdentities.set(verified, identityFor(binding.attemptId, binding.generation));
  return verified;
}

const terminal = (state: AttemptGenerationStateV1["state"]): state is AttemptTerminalState => state === "succeeded" || state === "failed" || state === "cancelled";
const findings = (values: readonly string[]): string[] => [...new Set(values)].sort();

export function emptyReceiptProjection(attemptId: string): AttemptReceiptProjectionV1 {
  if (!attemptId) throw new DomainError("INVALID_ATTEMPT_STATE");
  return { attemptId, taskId: null, generations: new Map(), outcomes: new Map(), retryPermittedGenerations: new Set(), explicitCancellationEventSequence: null, resolution: null, winningGeneration: null, findings: [] };
}

export function registerReceiptGeneration(state: AttemptReceiptProjectionV1, generation: AttemptGenerationStateV1): AttemptReceiptProjectionV1 {
  if (generation.attemptId !== state.attemptId || generation.generation < 1 || !generation.bindingDigest || !generation.idempotencyKeyDigest) throw new DomainError("INVALID_ATTEMPT_STATE");
  const generations = new Map(state.generations);
  const prior = generations.get(generation.generation);
  if (prior && (prior.bindingDigest !== generation.bindingDigest || prior.idempotencyKeyDigest !== generation.idempotencyKeyDigest)) throw new DomainError("GENERATION_IDENTITY_CONFLICT");
  generations.set(generation.generation, { ...generation, findingCodes: [...generation.findingCodes] });
  return { ...state, generations };
}

export function setRetryPermitted(state: AttemptReceiptProjectionV1, generation: number, permitted: boolean): AttemptReceiptProjectionV1 {
  if (!state.generations.has(generation)) throw new DomainError("INVALID_ATTEMPT_STATE");
  const next = new Set(state.retryPermittedGenerations);
  if (permitted) next.add(generation); else next.delete(generation);
  return { ...state, retryPermittedGenerations: next };
}

export function recordExplicitTaskCancellation(state: AttemptReceiptProjectionV1, eventSequence: number, taskId = state.taskId): AttemptReceiptProjectionV1 {
  if (eventSequence < 1) throw new DomainError("INVALID_EVENT_SEQUENCE");
  if (!taskId) throw new DomainError("TASK_NOT_FOUND");
  if (state.taskId !== null && state.taskId !== taskId) throw new DomainError("RECEIPT_MISMATCH");
  if (state.resolution) return { ...state, findings: findings([...state.findings, "LATE_EXPLICIT_CANCELLATION"]) };
  return resolve({ ...state, taskId, explicitCancellationEventSequence: state.explicitCancellationEventSequence ?? eventSequence }, eventSequence);
}

function validateAuthority(event: VerifiedReceiptEventV1, authority: VerifiedAttemptAuthorityV1, state: AttemptReceiptProjectionV1): AttemptGenerationStateV1 {
  if (!verifiedReceiptEvents.has(event) || !verifiedAttemptAuthorities.has(authority) || receiptIdentities.get(event) !== authorityIdentities.get(authority)) throw new DomainError("UNAUTHENTICATED_RECEIPT_EVENT");
  verifyAttemptReceipt(event.receipt);
  const { receipt } = event;
  const { binding } = authority;
  if (event.eventSequence < 1 || !event.eventDigest) throw new DomainError("UNAUTHENTICATED_RECEIPT_EVENT");
  if (receipt.attemptId !== state.attemptId || receipt.attemptId !== binding.attemptId || receipt.generation !== binding.generation) throw new DomainError("RECEIPT_MISMATCH");
  const generation = state.generations.get(receipt.generation);
  if (!generation) throw new DomainError("UNKNOWN_ATTEMPT_GENERATION");
  if (generation.bindingDigest !== binding.digest || receipt.attemptContextBindingDigest !== binding.digest || receipt.contextManifestCoreDigest !== binding.contextManifestCoreDigest || receipt.forkPinDigest !== binding.forkPinDigest) throw new DomainError("RECEIPT_BINDING_MISMATCH");
  if (receipt.producerPrincipalId !== event.authenticatedPrincipalId || receipt.producerPrincipalId !== binding.allowedProducerPrincipalId || receipt.producerGrantDigest !== authority.grant.grantDigest || receipt.producerGrantDigest !== binding.allowedProducerGrantDigest) throw new DomainError("RECEIPT_GRANT_MISMATCH");
  if (receipt.providerId !== binding.providerId || receipt.providerOperationId !== binding.providerOperationId || receipt.providerIdempotencyKeyDigest !== binding.providerIdempotencyKeyDigest || generation.idempotencyKeyDigest !== binding.providerIdempotencyKeyDigest) throw new DomainError("RECEIPT_OPERATION_MISMATCH");
  return generation;
}

export function projectAuthenticatedReceipt(state: AttemptReceiptProjectionV1, event: VerifiedReceiptEventV1, authority: VerifiedAttemptAuthorityV1): AttemptReceiptProjectionV1 {
  let generation = validateAuthority(event, authority, state);
  const prior = state.outcomes.get(event.receipt.generation);
  if (prior) {
    const code = prior.receiptDigest === event.receipt.receiptDigest ? "DUPLICATE_RECEIPT" : "RECEIPT_TERMINAL_CONFLICT";
    return { ...state, findings: findings([...state.findings, code]) };
  }
  if (state.resolution) return { ...state, findings: findings([...state.findings, "LATE_GENERATION_RECEIPT"]) };
  generation = reduceDispatch(generation, { type: "terminal-receipt", outcome: event.receipt.outcome, eventSequence: event.eventSequence, ...(authority.providerHandle === undefined ? {} : { handle: authority.providerHandle }) });
  if (!terminal(generation.state) || generation.terminalEventSequence !== event.eventSequence) {
    return { ...state, generations: new Map(state.generations).set(generation.generation, generation), findings: findings([...state.findings, ...generation.findingCodes]) };
  }
  const generations = new Map(state.generations).set(generation.generation, generation);
  const outcomes = new Map(state.outcomes).set(generation.generation, { generation: generation.generation, outcome: event.receipt.outcome, receiptDigest: event.receipt.receiptDigest, receiptId: event.receipt.receiptId, terminalEventSequence: event.eventSequence });
  const taskId = state.taskId ?? event.receipt.taskId;
  if (taskId !== event.receipt.taskId) throw new DomainError("RECEIPT_MISMATCH");
  return resolve({ ...state, taskId, generations, outcomes }, event.eventSequence);
}

function resolve(state: AttemptReceiptProjectionV1, eventSequence: number): AttemptReceiptProjectionV1 {
  if (state.resolution) return state;
  const successes = [...state.outcomes.values()].filter((item) => item.outcome === "succeeded").sort((a, b) => a.terminalEventSequence - b.terminalEventSequence || a.generation - b.generation);
  if (successes[0]) return resolved(state, "succeeded", successes[0].generation, eventSequence);
  if (state.explicitCancellationEventSequence !== null) return resolved(state, "cancelled", null, state.explicitCancellationEventSequence);
  const generationStates = [...state.generations.values()];
  if (generationStates.length === 0 || generationStates.some((item) => !terminal(item.state)) || [...state.retryPermittedGenerations].some((generation) => state.outcomes.get(generation)?.outcome === "failed")) return state;
  const cancellations = [...state.outcomes.values()].filter((item) => item.outcome === "cancelled").sort((a, b) => a.terminalEventSequence - b.terminalEventSequence || a.generation - b.generation);
  if (cancellations[0]) return resolved(state, "cancelled", cancellations[0].generation, eventSequence);
  return resolved(state, "failed", null, eventSequence);
}

function resolved(state: AttemptReceiptProjectionV1, resolution: TaskResolution, winningGeneration: number | null, eventSequence: number): AttemptReceiptProjectionV1 {
  if (!state.taskId) return state;
  const resolutionDigest = domainDigest("horseness.task-resolved-projection.v1", { taskId: state.taskId, resolution, winningGeneration, resolutionEventSequence: eventSequence } as JsonValue);
  const projection = Object.freeze({ taskId: state.taskId, resolution, winningGeneration, resolutionEventSequence: eventSequence, resolutionDigest });
  return { ...state, resolution: projection, winningGeneration, findings: [...state.findings] };
}

