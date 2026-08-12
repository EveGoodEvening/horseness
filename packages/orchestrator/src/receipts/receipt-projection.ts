import {
  DomainError,
  domainDigest,
  reduceDispatch,
  verifyAttemptReceipt,
  type AttemptGenerationStateV1,
  type AttemptReceiptEnvelopeV1,
  type AttemptTerminalState,
  type CompositeCursorV1,
  type JsonValue,
  type TaskResolution,
} from "@horseness/domain";
import { type TrustedAuthorityReader } from "@horseness/store-sqlite";

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

declare const verifiedReceiptEventBrand: unique symbol;
declare const verifiedAttemptAuthorityBrand: unique symbol;
export type VerifiedReceiptEventV1 = ReceiptEventV1 & { readonly [verifiedReceiptEventBrand]: true };
export type VerifiedAttemptAuthorityV1 = AttemptAuthorityInputV1 & { readonly [verifiedAttemptAuthorityBrand]: true };

export interface RetryDecisionEventV1 {
  readonly workspaceId: string; readonly runId: string; readonly taskId: string; readonly attemptId: string;
  readonly generation: number; readonly decision: "permitted" | "denied"; readonly retryPolicyDigest: string;
  readonly eventSequence: number; readonly eventHash: string; readonly cursor: CompositeCursorV1;
}
export interface CancellationEventV1 {
  readonly workspaceId: string; readonly runId: string; readonly taskId: string; readonly attemptId: string;
  readonly generation: number; readonly decision: "cancelled"; readonly eventSequence: number;
  readonly eventHash: string; readonly cursor: CompositeCursorV1;
}
declare const retryDecisionBrand: unique symbol;
declare const cancellationBrand: unique symbol;
export type VerifiedRetryDecisionV1 = RetryDecisionEventV1 & { readonly [retryDecisionBrand]: true };
export type VerifiedCancellationV1 = CancellationEventV1 & { readonly [cancellationBrand]: true };

const verifiedReceiptEvents = new WeakSet<object>();
const verifiedAttemptAuthorities = new WeakSet<object>();
const verifiedRetryDecisions = new WeakSet<object>();
const verifiedCancellations = new WeakSet<object>();
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
function record(value:JsonValue,code:string):Record<string,JsonValue> {
  if(value===null||typeof value!=="object"||Array.isArray(value))fail(code);
  return value as Record<string,JsonValue>;
}

export function issueStoredReceiptCapabilities(reader:TrustedAuthorityReader,input:{workspaceId:string;runId:string;receiptEventSequence:number}):{event:VerifiedReceiptEventV1;authority:VerifiedAttemptAuthorityV1} {
  const view=reader.authenticatedView(input.workspaceId,input.runId);
  const found=view.runEvents.find(item=>item.envelope.sequence===input.receiptEventSequence);
  if(found===undefined)throw new DomainError("UNAUTHENTICATED_RECEIPT_EVENT");
  const stored=found;
  if(stored.envelope.eventType!=="AttemptReceiptRecordedV1")fail("UNAUTHENTICATED_RECEIPT_EVENT");
  const eventState=record(reader.exactRunHeadSnapshot(input.workspaceId,input.runId,"receipt-event").state,"UNAUTHENTICATED_RECEIPT_EVENT");
  const authorityState=record(reader.exactRunHeadSnapshot(input.workspaceId,input.runId,"receipt-authority").state,"RECEIPT_AUTHORITY_UNAUTHENTICATED");
  if(eventState.eventSequence!==input.receiptEventSequence||eventState.eventDigest!==stored.envelopeHash||eventState.authenticatedPrincipalId!==stored.envelope.principalId)fail("UNAUTHENTICATED_RECEIPT_EVENT");
  const receipt=eventState.receipt as unknown as AttemptReceiptEnvelopeV1;
  const authority=authorityState as unknown as AttemptAuthorityInputV1;
  const storedPayload=stored.envelope.payload;
  if(storedPayload===null||typeof storedPayload!=="object"||!("receiptId" in storedPayload)||!("receiptDigest" in storedPayload)||!("outcome" in storedPayload)||receipt.receiptId!==storedPayload.receiptId||receipt.receiptDigest!==storedPayload.receiptDigest||receipt.outcome!==storedPayload.outcome)fail("UNAUTHENTICATED_RECEIPT_EVENT");
  verifyAttemptReceipt(receipt);
  const {binding,grant,dispatch}=authority;
  if(grant.revoked||grant.principalId!==binding.allowedProducerPrincipalId||grant.grantDigest!==binding.allowedProducerGrantDigest||dispatch.attemptId!==binding.attemptId||dispatch.generation!==binding.generation||dispatch.providerId!==binding.providerId||dispatch.providerOperationId!==binding.providerOperationId||dispatch.providerIdempotencyKeyDigest!==binding.providerIdempotencyKeyDigest||dispatch.providerHandle!==authority.providerHandle)fail("RECEIPT_AUTHORITY_INVALID");
  if(receipt.workspaceId!==input.workspaceId||receipt.runId!==input.runId||receipt.attemptId!==binding.attemptId||receipt.generation!==binding.generation)fail("RECEIPT_AUTHORITY_INVALID");
  const verifiedEvent=Object.freeze({eventSequence:input.receiptEventSequence,eventDigest:stored.envelopeHash,authenticatedPrincipalId:stored.envelope.principalId,receipt}) as VerifiedReceiptEventV1;
  const verifiedAuthority=Object.freeze({...authority,binding:Object.freeze({...binding}),grant:Object.freeze({...grant}),dispatch:Object.freeze({...dispatch})}) as VerifiedAttemptAuthorityV1;
  const identity=identityFor(binding.attemptId,binding.generation);verifiedReceiptEvents.add(verifiedEvent);receiptIdentities.set(verifiedEvent,identity);verifiedAttemptAuthorities.add(verifiedAuthority);authorityIdentities.set(verifiedAuthority,identity);
  return Object.freeze({event:verifiedEvent,authority:verifiedAuthority});
}

function exactCursor(left: CompositeCursorV1, right: CompositeCursorV1): boolean {
  return left.workspaceId === right.workspaceId && left.runId === right.runId &&
    left.workspaceSequence === right.workspaceSequence && left.workspaceEnvelopeHash === right.workspaceEnvelopeHash && left.workspaceContextEpoch === right.workspaceContextEpoch &&
    left.runSequence === right.runSequence && left.runEnvelopeHash === right.runEnvelopeHash && left.runContextEpoch === right.runContextEpoch;
}

function arbitrationState(reader: TrustedAuthorityReader, workspaceId: string, runId: string, projectionName: string): Record<string, JsonValue> {
  return record(reader.exactRunHeadSnapshot(workspaceId, runId, projectionName).state, "ARBITRATION_AUTHORITY_UNAUTHENTICATED");
}

export function issueStoredRetryDecision(reader: TrustedAuthorityReader, input: { workspaceId: string; runId: string; taskId: string; attemptId: string; generation: number }): VerifiedRetryDecisionV1 {
  const view = reader.authenticatedView(input.workspaceId, input.runId);
  const state = arbitrationState(reader, input.workspaceId, input.runId, "receipt-retry-decision");
  const sequence = state.eventSequence;
  const decision = state.decision;
  const event = typeof sequence === "number" ? view.runEvents.find((item) => item.envelope.sequence === sequence) : undefined;
  if (!event) throw new DomainError("ARBITRATION_AUTHORITY_UNAUTHENTICATED");
  if ((decision !== "permitted" && decision !== "denied") || state.workspaceId !== input.workspaceId || state.runId !== input.runId || state.taskId !== input.taskId || state.attemptId !== input.attemptId || state.generation !== input.generation || typeof state.retryPolicyDigest !== "string" || !state.retryPolicyDigest || state.eventHash !== event.envelopeHash) fail("ARBITRATION_AUTHORITY_UNAUTHENTICATED");
  if (event.envelope.eventType !== "AttemptReceiptRecordedV1") fail("ARBITRATION_AUTHORITY_UNAUTHENTICATED");
  const payload = event.envelope.payload as unknown as { workspaceId: string; runId: string; outcome: string };
  if (payload.workspaceId !== input.workspaceId || payload.runId !== input.runId || payload.outcome !== "failed") fail("ARBITRATION_AUTHORITY_UNAUTHENTICATED");
  const capability = Object.freeze({ ...input, decision, retryPolicyDigest: state.retryPolicyDigest, eventSequence: sequence, eventHash: event.envelopeHash, cursor: view.cursor }) as VerifiedRetryDecisionV1;
  verifiedRetryDecisions.add(capability);
  return capability;
}

export function issueStoredCancellation(reader: TrustedAuthorityReader, input: { workspaceId: string; runId: string; taskId: string; attemptId: string; generation: number }): VerifiedCancellationV1 {
  const view = reader.authenticatedView(input.workspaceId, input.runId);
  const state = arbitrationState(reader, input.workspaceId, input.runId, "receipt-cancellation");
  const sequence = state.eventSequence;
  const event = typeof sequence === "number" ? view.runEvents.find((item) => item.envelope.sequence === sequence) : undefined;
  if (!event) throw new DomainError("ARBITRATION_AUTHORITY_UNAUTHENTICATED");
  if (state.decision !== "cancelled" || state.workspaceId !== input.workspaceId || state.runId !== input.runId || state.taskId !== input.taskId || state.attemptId !== input.attemptId || state.generation !== input.generation || state.eventHash !== event.envelopeHash) fail("ARBITRATION_AUTHORITY_UNAUTHENTICATED");
  if (event.envelope.eventType !== "TaskResolvedV1") fail("ARBITRATION_AUTHORITY_UNAUTHENTICATED");
  const payload = event.envelope.payload as unknown as { workspaceId: string; runId: string; taskId: string; resolution: string };
  if (payload.workspaceId !== input.workspaceId || payload.runId !== input.runId || payload.taskId !== input.taskId || payload.resolution !== "cancelled") fail("ARBITRATION_AUTHORITY_UNAUTHENTICATED");
  const capability = Object.freeze({ ...input, decision: "cancelled", eventSequence: sequence, eventHash: event.envelopeHash, cursor: view.cursor }) as VerifiedCancellationV1;
  verifiedCancellations.add(capability);
  return capability;
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

export function applyStoredRetryDecision(state: AttemptReceiptProjectionV1, reader: TrustedAuthorityReader, capability: VerifiedRetryDecisionV1): AttemptReceiptProjectionV1 {
  if (!verifiedRetryDecisions.has(capability)) throw new DomainError("ARBITRATION_AUTHORITY_UNAUTHENTICATED");
  const view = reader.authenticatedView(capability.workspaceId, capability.runId);
  if (!exactCursor(view.cursor, capability.cursor)) throw new DomainError("ARBITRATION_AUTHORITY_STALE");
  if (capability.attemptId !== state.attemptId || !state.generations.has(capability.generation) || state.taskId !== null && state.taskId !== capability.taskId) throw new DomainError("RECEIPT_MISMATCH");
  const next = new Set(state.retryPermittedGenerations);
  if (capability.decision === "permitted") next.add(capability.generation); else next.delete(capability.generation);
  return resolve({ ...state, taskId: state.taskId ?? capability.taskId, retryPermittedGenerations: next }, capability.eventSequence);
}

export function applyStoredCancellation(state: AttemptReceiptProjectionV1, reader: TrustedAuthorityReader, capability: VerifiedCancellationV1): AttemptReceiptProjectionV1 {
  if (!verifiedCancellations.has(capability)) throw new DomainError("ARBITRATION_AUTHORITY_UNAUTHENTICATED");
  const view = reader.authenticatedView(capability.workspaceId, capability.runId);
  if (!exactCursor(view.cursor, capability.cursor)) throw new DomainError("ARBITRATION_AUTHORITY_STALE");
  if (capability.attemptId !== state.attemptId || !state.generations.has(capability.generation) || state.taskId !== null && state.taskId !== capability.taskId) throw new DomainError("RECEIPT_MISMATCH");
  if (state.resolution) return { ...state, findings: findings([...state.findings, "LATE_EXPLICIT_CANCELLATION"]) };
  return resolve({ ...state, taskId: capability.taskId, explicitCancellationEventSequence: state.explicitCancellationEventSequence ?? capability.eventSequence }, capability.eventSequence);
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

