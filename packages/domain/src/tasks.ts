import { domainDigest, DomainError, type JsonValue } from "./canonical.js";
import type { CompositeCursorV1 } from "./events.js";
import type { DependencyOutcomeV1, Schedulability } from "./context.js";

export type TaskLifecycle = "draft" | "active" | "succeeded" | "failed" | "cancelled";
export type TaskResolution = Exclude<TaskLifecycle, "draft" | "active">;
export type CompletionPredicateV1 =
  | { kind: "receipt-only" }
  | { kind: "canonical-change"; proposalDigest: string; acceptedEventDigest: string; resultingRevision: number; resultingStateHash: string }
  | { kind: "artifact-published"; objectDigests: string[]; publicationEventDigests: string[] }
  | { kind: "approval-recorded"; approvalId: string; scopeDigest: string; evaluationCursor: CompositeCursorV1; expiresAt: string };
export type TaskCompletionPolicyV1 = { schemaVersion: "1"; kind: "predicate"; predicate: CompletionPredicateV1 } | { schemaVersion: "1"; kind: "all"; predicates: CompletionPredicateV1[] };
export function completionPredicateIdentity(predicate: CompletionPredicateV1): string { return domainDigest("horseness.task-completion-predicate.v1", predicate as unknown as JsonValue); }
export function completionPolicySatisfied(policy: TaskCompletionPolicyV1, durablePredicateIds: ReadonlySet<string>): boolean {
  const predicates = policy.kind === "predicate" ? [policy.predicate] : policy.predicates;
  if (predicates.length === 0) throw new DomainError("INVALID_COMPLETION_POLICY");
  return predicates.every((predicate) => durablePredicateIds.has(completionPredicateIdentity(predicate)));
}

export type TaskLifecycleInputV1 = { type: "activate" } | { type: "resolve"; resolution: TaskResolution };
export function reduceTaskLifecycle(state: TaskLifecycle, input: TaskLifecycleInputV1): TaskLifecycle {
  if (state === "draft" && input.type === "activate") return "active";
  if (state === "active" && input.type === "resolve") return input.resolution;
  throw new DomainError("ILLEGAL_TASK_TRANSITION");
}

export interface TaskResolutionV1 { schemaVersion: "1"; taskId: string; consideredGenerationOutcomes: { generation: number; outcome: AttemptTerminalState; terminalEventSequence: number }[]; winningGeneration: number | null; retryPolicyDigest: string; arbitrationReason: string; observationCursor: CompositeCursorV1; resolution: TaskResolution }
export function resolveTask(input: { taskId: string; generations: readonly AttemptGenerationStateV1[]; retryPolicyDigest: string; retryPermitted: boolean; cancellationRequested: boolean; observationCursor: CompositeCursorV1 }): TaskResolutionV1 | null {
  const generations = [...input.generations].sort((a, b) => a.generation - b.generation);
  if (new Set(generations.map((item) => item.generation)).size !== generations.length || generations.some((item) => item.generation < 1)) throw new DomainError("INVALID_ATTEMPT_GENERATION");
  const terminal = generations.filter((generation): generation is AttemptGenerationStateV1 & { state: AttemptTerminalState; terminalEventSequence: number } => isTerminal(generation.state) && generation.terminalEventSequence !== null);
  const successes = terminal.filter((generation) => generation.state === "succeeded").sort((a, b) => a.terminalEventSequence - b.terminalEventSequence || a.generation - b.generation);
  const unresolved = generations.some((generation) => !isTerminal(generation.state));
  let resolution: TaskResolution;
  let winningGeneration: number | null = null;
  let arbitrationReason: string;
  if (successes[0]) { resolution = "succeeded"; winningGeneration = successes[0].generation; arbitrationReason = "earliest-terminal-success"; }
  else if (unresolved || input.retryPermitted) return null;
  else if (input.cancellationRequested) { resolution = "cancelled"; arbitrationReason = "explicit-cancellation"; }
  else { resolution = "failed"; arbitrationReason = "all-generations-terminal-no-success"; }
  return { schemaVersion: "1", taskId: input.taskId, consideredGenerationOutcomes: terminal.map(({ generation, state: outcome, terminalEventSequence }) => ({ generation, outcome, terminalEventSequence })).sort((a, b) => a.generation - b.generation), winningGeneration, retryPolicyDigest: input.retryPolicyDigest, arbitrationReason, observationCursor: input.observationCursor, resolution };
}

export interface DependencyEdgeV1 { edgeId: string; sourceTaskId: string; dependentTaskId: string; edgeType: "requires_success" | "requires_terminal" | "requires_outcome"; allowedOutcomes?: TaskResolution[]; releasePredicate: "task-resolution" | string; propagateCancellation: boolean }
export function validateDependencyEdge(edge: DependencyEdgeV1): void {
  if (!edge.edgeId || !edge.sourceTaskId || !edge.dependentTaskId || edge.sourceTaskId === edge.dependentTaskId) throw new DomainError("INVALID_DEPENDENCY");
  if (edge.edgeType === "requires_outcome") {
    if (!edge.allowedOutcomes?.length || new Set(edge.allowedOutcomes).size !== edge.allowedOutcomes.length) throw new DomainError("INVALID_DEPENDENCY");
  } else if (edge.allowedOutcomes !== undefined) throw new DomainError("INVALID_DEPENDENCY");
}
export function assertAcyclic(tasks: readonly string[], edges: readonly DependencyEdgeV1[]): void {
  if (new Set(tasks).size !== tasks.length) throw new DomainError("INVALID_DEPENDENCY");
  const outgoing = new Map(tasks.map((task) => [task, [] as string[]]));
  const edgeIds = new Set<string>();
  for (const edge of edges) { validateDependencyEdge(edge); if (edgeIds.has(edge.edgeId) || !outgoing.has(edge.sourceTaskId) || !outgoing.has(edge.dependentTaskId)) throw new DomainError("INVALID_DEPENDENCY"); edgeIds.add(edge.edgeId); outgoing.get(edge.sourceTaskId)?.push(edge.dependentTaskId); }
  const visiting = new Set<string>(); const visited = new Set<string>();
  const visit = (task: string): void => { if (visiting.has(task)) throw new DomainError("DEPENDENCY_CYCLE"); if (visited.has(task)) return; visiting.add(task); for (const next of outgoing.get(task) ?? []) visit(next); visiting.delete(task); visited.add(task); };
  for (const task of tasks) visit(task);
}
export function dependencySatisfied(edge: DependencyEdgeV1, resolution: TaskResolution): boolean {
  validateDependencyEdge(edge);
  switch (edge.edgeType) {
    case "requires_success": return resolution === "succeeded";
    case "requires_terminal": return true;
    case "requires_outcome": return edge.allowedOutcomes?.includes(resolution) ?? false;
    default: throw new DomainError("UNSUPPORTED_DEPENDENCY_TYPE");
  }
}
export function evaluateDependencies(edges: readonly DependencyEdgeV1[], outcomes: ReadonlyMap<string, DependencyOutcomeV1 & { resolution: TaskResolution }>): { satisfied: boolean; unknown: boolean; cancellationPropagated: boolean; reasonCodes: string[] } {
  let unknown = false; let unsatisfied = false; let cancellationPropagated = false;
  for (const edge of edges) {
    validateDependencyEdge(edge);
    const outcome = outcomes.get(edge.edgeId);
    if (!outcome || outcome.sourceTaskId !== edge.sourceTaskId || outcome.edgeType !== edge.edgeType) { unknown = true; continue; }
    if (!dependencySatisfied(edge, outcome.resolution)) unsatisfied = true;
    if (outcome.resolution === "cancelled" && edge.propagateCancellation) cancellationPropagated = true;
  }
  const reasonCodes = [...(unknown ? ["DEPENDENCY_UNKNOWN"] : []), ...(unsatisfied ? ["DEPENDENCY_UNSATISFIED"] : []), ...(cancellationPropagated ? ["CANCELLATION_PROPAGATED"] : [])].sort();
  return { satisfied: !unknown && !unsatisfied && !cancellationPropagated, unknown, cancellationPropagated, reasonCodes };
}
export function deriveSchedulability(input: { lifecycle: TaskLifecycle; contractValid: boolean; dependenciesSatisfied: boolean; hasUnknownDependency: boolean; cancellationPropagated?: boolean; authorizationAllowed: boolean; quotaAllowed: boolean; liveAttempt: boolean; unknownOutcome: boolean }): Schedulability {
  if (isTaskTerminal(input.lifecycle)) return "terminal";
  if (input.lifecycle === "draft" || !input.contractValid || input.cancellationPropagated) return "ineligible";
  if (input.unknownOutcome) return "unknown_outcome";
  if (input.liveAttempt) return "running";
  if (!input.dependenciesSatisfied || input.hasUnknownDependency || !input.authorizationAllowed || !input.quotaAllowed) return "blocked";
  return "ready";
}
function isTaskTerminal(state: TaskLifecycle): state is TaskResolution { return state === "succeeded" || state === "failed" || state === "cancelled"; }

export type DispatchState = "planned" | "launch_intent_committed" | "provider_handle_recorded" | "acknowledged" | "cancel_requested" | "cancel_handed_off" | "reconciliation_required" | "unknown_outcome" | AttemptTerminalState;
export type AttemptTerminalState = "succeeded" | "failed" | "cancelled";
export interface AttemptGenerationStateV1 { attemptId: string; generation: number; state: DispatchState; bindingDigest: string; idempotencyKeyDigest: string; providerHandle: string | null; terminalEventSequence: number | null; findingCodes: string[] }
export type DispatchInputV1 = { type: "commit-launch-intent" } | { type: "record-handle"; handle: string } | { type: "acknowledge" } | { type: "request-cancel" } | { type: "cancel-handed-off" } | { type: "require-reconciliation" } | { type: "reconcile-found"; handle: string } | { type: "reconcile-not-found-idempotent" } | { type: "reconcile-ambiguous" } | { type: "terminal-receipt"; outcome: AttemptTerminalState; eventSequence: number; handle?: string } | { type: "manual-resolution"; outcome: AttemptTerminalState; eventSequence: number };
const isTerminal = (state: DispatchState): state is AttemptTerminalState => state === "succeeded" || state === "failed" || state === "cancelled";
const finding = (state: AttemptGenerationStateV1, code: string): AttemptGenerationStateV1 => state.findingCodes.includes(code) ? state : { ...state, findingCodes: [...state.findingCodes, code] };
export function reduceDispatch(state: AttemptGenerationStateV1, input: DispatchInputV1): AttemptGenerationStateV1 {
  if (state.generation < 1 || state.terminalEventSequence !== null && !isTerminal(state.state)) throw new DomainError("INVALID_ATTEMPT_STATE");
  if (input.type === "terminal-receipt") {
    if (input.eventSequence < 1) throw new DomainError("INVALID_EVENT_SEQUENCE");
    if (isTerminal(state.state)) return finding(state, input.outcome === state.state ? "LATE_TERMINAL_RECEIPT" : "CONFLICTING_LATE_TERMINAL_RECEIPT");
    if (state.state === "planned") throw new DomainError("RECEIPT_PRE_HANDOFF");
    if (input.handle && state.providerHandle && input.handle !== state.providerHandle) return finding(state, "CONFLICTING_PROVIDER_HANDLE");
    return { ...state, state: input.outcome, providerHandle: state.providerHandle ?? input.handle ?? null, terminalEventSequence: input.eventSequence };
  }
  if (isTerminal(state.state)) return finding(state, "LATE_DISPATCH_FACT");
  switch (input.type) {
    case "commit-launch-intent": if (state.state === "planned") return { ...state, state: "launch_intent_committed" }; break;
    case "record-handle": if (["launch_intent_committed", "provider_handle_recorded", "acknowledged", "cancel_requested", "cancel_handed_off", "reconciliation_required", "unknown_outcome"].includes(state.state)) { if (!input.handle) throw new DomainError("INVALID_PROVIDER_HANDLE"); if (state.providerHandle && state.providerHandle !== input.handle) return finding(state, "CONFLICTING_PROVIDER_HANDLE"); return { ...state, state: state.state === "launch_intent_committed" || state.state === "reconciliation_required" ? "provider_handle_recorded" : state.state, providerHandle: input.handle }; } break;
    case "acknowledge": if (state.state === "provider_handle_recorded" || state.state === "acknowledged") return { ...state, state: "acknowledged" }; break;
    case "request-cancel": if (["launch_intent_committed", "provider_handle_recorded", "acknowledged", "reconciliation_required", "unknown_outcome"].includes(state.state)) return { ...state, state: "cancel_requested" }; break;
    case "cancel-handed-off": if (state.state === "cancel_requested") return { ...state, state: "cancel_handed_off" }; break;
    case "require-reconciliation": if (["launch_intent_committed", "provider_handle_recorded", "acknowledged", "cancel_requested", "cancel_handed_off"].includes(state.state)) return { ...state, state: "reconciliation_required" }; break;
    case "reconcile-found": if (state.state === "reconciliation_required") { if (!input.handle) throw new DomainError("INVALID_PROVIDER_HANDLE"); if (state.providerHandle && state.providerHandle !== input.handle) return finding(state, "CONFLICTING_PROVIDER_HANDLE"); return { ...state, state: "provider_handle_recorded", providerHandle: input.handle }; } break;
    case "reconcile-not-found-idempotent": if (state.state === "reconciliation_required") return { ...state, state: "planned", providerHandle: null }; break;
    case "reconcile-ambiguous": if (state.state === "reconciliation_required") return { ...state, state: "unknown_outcome" }; break;
    case "manual-resolution": if (state.state === "unknown_outcome" && input.eventSequence > 0) return { ...state, state: input.outcome, terminalEventSequence: input.eventSequence }; break;
  }
  throw new DomainError("ILLEGAL_DISPATCH_TRANSITION");
}

export function assertEvaluationClock(clock: { schemaVersion: "1"; authorityTime: string; observationCursor: CompositeCursorV1 }, expectedCursor: CompositeCursorV1): void {
  if (clock.schemaVersion !== "1" || !Number.isFinite(Date.parse(clock.authorityTime)) || domainDigest("horseness.evaluation-cursor.v1", clock.observationCursor as unknown as JsonValue) !== domainDigest("horseness.evaluation-cursor.v1", expectedCursor as unknown as JsonValue)) throw new DomainError("INVALID_EVALUATION_CLOCK");
}
export interface RetryScheduledV1 { schemaVersion: "1"; attemptId: string; priorGeneration: number; generation: number; retryOrdinal: number; retryPolicyDigest: string; notBefore: string; pinDecision: "reuse" | "refresh"; forkPinDigest: string; reason: string; providerIdempotencyKeyDigest: string }
export function scheduleRetry(input: Omit<RetryScheduledV1, "schemaVersion" | "generation"> & { prior: AttemptGenerationStateV1 }): RetryScheduledV1 {
  if (!isTerminal(input.prior.state) || input.prior.generation !== input.priorGeneration || input.retryOrdinal < 1 || !input.providerIdempotencyKeyDigest || input.providerIdempotencyKeyDigest === input.prior.idempotencyKeyDigest) throw new DomainError("RETRY_NOT_PERMITTED");
  return { schemaVersion: "1", attemptId: input.attemptId, priorGeneration: input.priorGeneration, generation: input.priorGeneration + 1, retryOrdinal: input.retryOrdinal, retryPolicyDigest: input.retryPolicyDigest, notBefore: input.notBefore, pinDecision: input.pinDecision, forkPinDigest: input.forkPinDigest, reason: input.reason, providerIdempotencyKeyDigest: input.providerIdempotencyKeyDigest };
}
export function authorizeDuplicateRiskGeneration(input: { prior: AttemptGenerationStateV1; newBindingDigest: string; newIdempotencyKeyDigest: string }): AttemptGenerationStateV1 {
  if (input.prior.state !== "unknown_outcome" || !input.newBindingDigest || input.newIdempotencyKeyDigest === input.prior.idempotencyKeyDigest) throw new DomainError("DUPLICATE_RISK_NOT_PERMITTED");
  return { attemptId: input.prior.attemptId, generation: input.prior.generation + 1, state: "planned", bindingDigest: input.newBindingDigest, idempotencyKeyDigest: input.newIdempotencyKeyDigest, providerHandle: null, terminalEventSequence: null, findingCodes: ["DUPLICATE_RISK_AUTHORIZED"] };
}
