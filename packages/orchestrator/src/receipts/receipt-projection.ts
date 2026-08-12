import {
  DomainError,
  domainDigest,
  reduceDispatch,
  verifyAttemptReceipt,
  type AttemptGenerationStateV1,
  type AttemptReceiptEnvelopeV1,
  type AttemptTerminalState,
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

export interface AuthenticatedReceiptInputV1 {
  readonly eventSequence: number;
  readonly eventDigest: string;
  readonly authenticated: true;
  readonly authenticatedPrincipalId: string;
  readonly authorizedGrantDigest: string;
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
  readonly receipt: AttemptReceiptEnvelopeV1;
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

function validateAuthority(event: AuthenticatedReceiptInputV1, state: AttemptReceiptProjectionV1): AttemptGenerationStateV1 {
  verifyAttemptReceipt(event.receipt);
  const { receipt, binding } = event;
  if (!event.authenticated || event.eventSequence < 1 || !event.eventDigest) throw new DomainError("UNAUTHENTICATED_RECEIPT_EVENT");
  if (receipt.attemptId !== state.attemptId || receipt.attemptId !== binding.attemptId || receipt.generation !== binding.generation) throw new DomainError("RECEIPT_MISMATCH");
  const generation = state.generations.get(receipt.generation);
  if (!generation) throw new DomainError("UNKNOWN_ATTEMPT_GENERATION");
  if (generation.bindingDigest !== binding.digest || receipt.attemptContextBindingDigest !== binding.digest || receipt.contextManifestCoreDigest !== binding.contextManifestCoreDigest || receipt.forkPinDigest !== binding.forkPinDigest) throw new DomainError("RECEIPT_BINDING_MISMATCH");
  if (receipt.producerPrincipalId !== event.authenticatedPrincipalId || receipt.producerPrincipalId !== binding.allowedProducerPrincipalId || receipt.producerGrantDigest !== event.authorizedGrantDigest || receipt.producerGrantDigest !== binding.allowedProducerGrantDigest) throw new DomainError("RECEIPT_GRANT_MISMATCH");
  if (receipt.providerId !== binding.providerId || receipt.providerOperationId !== binding.providerOperationId || receipt.providerIdempotencyKeyDigest !== binding.providerIdempotencyKeyDigest || generation.idempotencyKeyDigest !== binding.providerIdempotencyKeyDigest) throw new DomainError("RECEIPT_OPERATION_MISMATCH");
  return generation;
}

export function projectAuthenticatedReceipt(state: AttemptReceiptProjectionV1, event: AuthenticatedReceiptInputV1): AttemptReceiptProjectionV1 {
  let generation = validateAuthority(event, state);
  const prior = state.outcomes.get(event.receipt.generation);
  if (prior) {
    const code = prior.receiptDigest === event.receipt.receiptDigest ? "DUPLICATE_RECEIPT" : "RECEIPT_TERMINAL_CONFLICT";
    return { ...state, findings: findings([...state.findings, code]) };
  }
  if (state.resolution) return { ...state, findings: findings([...state.findings, "LATE_GENERATION_RECEIPT"]) };
  generation = reduceDispatch(generation, { type: "terminal-receipt", outcome: event.receipt.outcome, eventSequence: event.eventSequence, ...(event.providerHandle === undefined ? {} : { handle: event.providerHandle }) });
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

