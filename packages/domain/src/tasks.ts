import { domainDigest, DomainError, type JsonValue } from "./canonical.js";
import type { CompositeCursorV1 } from "./events.js";
import type { Schedulability } from "./context.js";

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
  return predicates.every((predicate) => durablePredicateIds.has(completionPredicateIdentity(predicate)));
}
export interface TaskResolutionV1 { schemaVersion: "1"; taskId: string; consideredGenerationOutcomes: { generation: number; outcome: AttemptTerminalState; terminalEventSequence: number }[]; winningGeneration: number | null; retryPolicyDigest: string; arbitrationReason: string; observationCursor: CompositeCursorV1; resolution: TaskResolution }
export function resolveTask(input: { taskId: string; generations: readonly AttemptGenerationStateV1[]; retryPolicyDigest: string; retryPermitted: boolean; cancellationRequested: boolean; observationCursor: CompositeCursorV1 }): TaskResolutionV1 | null {
  const terminal = input.generations.filter((generation): generation is AttemptGenerationStateV1 & { state: AttemptTerminalState; terminalEventSequence: number } => ["succeeded", "failed", "cancelled"].includes(generation.state) && generation.terminalEventSequence !== null);
  const successes = terminal.filter((generation) => generation.state === "succeeded").sort((a, b) => a.terminalEventSequence - b.terminalEventSequence);
  const live = input.generations.some((generation) => !["succeeded", "failed", "cancelled"].includes(generation.state));
  let resolution: TaskResolution;
  let winner: number | null = null;
  let reason: string;
  if (successes[0]) { resolution = "succeeded"; winner = successes[0].generation; reason = "earliest-terminal-success"; }
  else if (live || input.retryPermitted) return null;
  else if (input.cancellationRequested) { resolution = "cancelled"; reason = "explicit-cancellation"; }
  else { resolution = "failed"; reason = "all-generations-terminal-no-success"; }
  return { schemaVersion: "1", taskId: input.taskId, consideredGenerationOutcomes: terminal.map((generation) => ({ generation: generation.generation, outcome: generation.state, terminalEventSequence: generation.terminalEventSequence })).sort((a, b) => a.generation - b.generation), winningGeneration: winner, retryPolicyDigest: input.retryPolicyDigest, arbitrationReason: reason, observationCursor: input.observationCursor, resolution };
}
export interface DependencyEdgeV1 { edgeId: string; sourceTaskId: string; dependentTaskId: string; edgeType: "requires_success" | "requires_terminal" | "requires_outcome"; allowedOutcomes?: TaskResolution[]; releasePredicate: "task-resolution" | string; propagateCancellation: boolean }
export function assertAcyclic(tasks: readonly string[], edges: readonly DependencyEdgeV1[]): void {
  const outgoing = new Map<string, string[]>();
  for (const task of tasks) outgoing.set(task, []);
  for (const edge of edges) {
    if (edge.sourceTaskId === edge.dependentTaskId || !outgoing.has(edge.sourceTaskId) || !outgoing.has(edge.dependentTaskId)) throw new DomainError("INVALID_DEPENDENCY");
    outgoing.get(edge.sourceTaskId)?.push(edge.dependentTaskId);
  }
  const visiting = new Set<string>(); const visited = new Set<string>();
  const visit = (task: string): void => { if (visiting.has(task)) throw new DomainError("DEPENDENCY_CYCLE"); if (visited.has(task)) return; visiting.add(task); for (const next of outgoing.get(task) ?? []) visit(next); visiting.delete(task); visited.add(task); };
  for (const task of tasks) visit(task);
}
export function deriveSchedulability(input: { lifecycle: TaskLifecycle; contractValid: boolean; dependenciesSatisfied: boolean; hasUnknownDependency: boolean; authorizationAllowed: boolean; quotaAllowed: boolean; liveAttempt: boolean; unknownOutcome: boolean }): Schedulability {
  if (["succeeded", "failed", "cancelled"].includes(input.lifecycle)) return "terminal";
  if (input.lifecycle === "draft" || !input.contractValid) return "ineligible";
  if (input.unknownOutcome) return "unknown_outcome";
  if (input.liveAttempt) return "running";
  if (!input.dependenciesSatisfied || input.hasUnknownDependency || !input.authorizationAllowed || !input.quotaAllowed) return "blocked";
  return "ready";
}

export type DispatchState = "planned" | "launch_intent_committed" | "provider_handle_recorded" | "acknowledged" | "cancel_requested" | "cancel_handed_off" | "reconciliation_required" | "unknown_outcome" | AttemptTerminalState;
export type AttemptTerminalState = "succeeded" | "failed" | "cancelled";
export interface AttemptGenerationStateV1 { attemptId: string; generation: number; state: DispatchState; bindingDigest: string; idempotencyKeyDigest: string; providerHandle: string | null; terminalEventSequence: number | null; findingCodes: string[] }
export type DispatchInputV1 = { type: "commit-launch-intent" } | { type: "record-handle"; handle: string } | { type: "acknowledge" } | { type: "request-cancel" } | { type: "cancel-handed-off" } | { type: "require-reconciliation" } | { type: "reconcile-found"; handle: string } | { type: "reconcile-not-found-idempotent" } | { type: "reconcile-ambiguous" } | { type: "terminal-receipt"; outcome: AttemptTerminalState; eventSequence: number; handle?: string } | { type: "manual-resolution"; outcome: AttemptTerminalState; eventSequence: number };
export function reduceDispatch(state: AttemptGenerationStateV1, input: DispatchInputV1): AttemptGenerationStateV1 {
  const terminal = ["succeeded", "failed", "cancelled"].includes(state.state);
  if (input.type === "terminal-receipt") {
    if (terminal) return { ...state, findingCodes: [...state.findingCodes, "LATE_TERMINAL_RECEIPT"] };
    if (state.state === "planned") throw new DomainError("RECEIPT_PRE_HANDOFF");
    if (input.handle && state.providerHandle && input.handle !== state.providerHandle) return { ...state, findingCodes: [...state.findingCodes, "CONFLICTING_PROVIDER_HANDLE"] };
    return { ...state, state: input.outcome, providerHandle: state.providerHandle ?? input.handle ?? null, terminalEventSequence: input.eventSequence };
  }
  if (terminal) return { ...state, findingCodes: [...state.findingCodes, "LATE_DISPATCH_FACT"] };
  switch (input.type) {
    case "commit-launch-intent": if (state.state !== "planned") break; return { ...state, state: "launch_intent_committed" };
    case "record-handle": if (!["launch_intent_committed", "provider_handle_recorded", "acknowledged", "cancel_requested", "cancel_handed_off", "reconciliation_required", "unknown_outcome"].includes(state.state)) break; if (state.providerHandle && state.providerHandle !== input.handle) return { ...state, findingCodes: [...state.findingCodes, "CONFLICTING_PROVIDER_HANDLE"] }; return { ...state, state: state.state === "launch_intent_committed" || state.state === "reconciliation_required" ? "provider_handle_recorded" : state.state, providerHandle: input.handle };
    case "acknowledge": if (!["provider_handle_recorded", "acknowledged"].includes(state.state)) break; return { ...state, state: "acknowledged" };
    case "request-cancel": return { ...state, state: "cancel_requested" };
    case "cancel-handed-off": if (state.state !== "cancel_requested") break; return { ...state, state: "cancel_handed_off" };
    case "require-reconciliation": if (!["launch_intent_committed", "provider_handle_recorded"].includes(state.state)) break; return { ...state, state: "reconciliation_required" };
    case "reconcile-found": if (state.state !== "reconciliation_required") break; return { ...state, state: "provider_handle_recorded", providerHandle: input.handle };
    case "reconcile-not-found-idempotent": if (state.state !== "reconciliation_required") break; return { ...state, state: "planned" };
    case "reconcile-ambiguous": if (state.state !== "reconciliation_required") break; return { ...state, state: "unknown_outcome" };
    case "manual-resolution": if (state.state !== "unknown_outcome") break; return { ...state, state: input.outcome, terminalEventSequence: input.eventSequence };
  }
  throw new DomainError("ILLEGAL_DISPATCH_TRANSITION");
}
export interface RetryScheduledV1 { schemaVersion: "1"; attemptId: string; priorGeneration: number; generation: number; retryOrdinal: number; retryPolicyDigest: string; notBefore: string; pinDecision: "reuse" | "refresh"; forkPinDigest: string; reason: string; providerIdempotencyKeyDigest: string }
