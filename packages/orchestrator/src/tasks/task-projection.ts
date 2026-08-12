import {
  DomainError,
  assertAcyclic,
  completionPolicySatisfied,
  completionPredicateIdentity,
  deriveSchedulability,
  evaluateDependencies,
  sealDependencyJoinSnapshot,
  type CompositeCursorV1,
  type DependencyEdgeV1,
  type DependencyOutcomeV1,
  type DependencyJoinSnapshotCoreV1,
  type Schedulability,
  type TaskCompletionPolicyV1,
  type TaskLifecycle,
  type TaskResolution,
} from "@horseness/domain";

export interface TaskContractV1 {
  taskId: string;
  contractDigest: string;
  completionPolicy: TaskCompletionPolicyV1;
}
export interface DurableTaskStateV1 {
  contract: TaskContractV1;
  lifecycle: TaskLifecycle;
  resolution: TaskResolution | null;
  winningGeneration: number | null;
  resolutionEventSequence: number | null;
  resolutionDigest: string | null;
  durablePredicateIds: ReadonlySet<string>;
}
export interface TaskProjectionV1 {
  tasks: ReadonlyMap<string, DurableTaskStateV1>;
  edges: ReadonlyMap<string, DependencyEdgeV1>;
}
export interface JoinEvaluationV1 {
  taskId: string;
  schedulability: Schedulability;
  cancellationPropagated: boolean;
  snapshot: { core: DependencyJoinSnapshotCoreV1; digest: string; id: string };
}

const cloneTask = (task: DurableTaskStateV1): DurableTaskStateV1 => ({ ...task, durablePredicateIds: new Set(task.durablePredicateIds) });
const clone = (state: TaskProjectionV1): { tasks: Map<string, DurableTaskStateV1>; edges: Map<string, DependencyEdgeV1> } => ({ tasks: new Map([...state.tasks].map(([id, task]) => [id, cloneTask(task)])), edges: new Map(state.edges) });
export const emptyTaskProjection = (): TaskProjectionV1 => ({ tasks: new Map(), edges: new Map() });

function validateGraph(state: TaskProjectionV1): void {
  assertAcyclic([...state.tasks.keys()], [...state.edges.values()]);
}
export function addTask(state: TaskProjectionV1, contract: TaskContractV1): TaskProjectionV1 {
  if (!contract.taskId || !contract.contractDigest || state.tasks.has(contract.taskId)) throw new DomainError("TASK_IDENTITY_CONFLICT");
  const next = clone(state);
  next.tasks.set(contract.taskId, { contract, lifecycle: "draft", resolution: null, winningGeneration: null, resolutionEventSequence: null, resolutionDigest: null, durablePredicateIds: new Set() });
  return next;
}
export function addDependency(state: TaskProjectionV1, edge: DependencyEdgeV1): TaskProjectionV1 {
  if (state.edges.has(edge.edgeId)) throw new DomainError("DEPENDENCY_IDENTITY_CONFLICT");
  const source = state.tasks.get(edge.sourceTaskId); const dependent = state.tasks.get(edge.dependentTaskId);
  if (!source || !dependent) throw new DomainError("INVALID_DEPENDENCY");
  if (source.lifecycle !== "draft" || dependent.lifecycle !== "draft") throw new DomainError("LATE_DEPENDENCY_MUTATION");
  const next = clone(state); next.edges.set(edge.edgeId, edge); validateGraph(next); return next;
}
export function activateTask(state: TaskProjectionV1, taskId: string): TaskProjectionV1 {
  const current = state.tasks.get(taskId); if (!current || current.lifecycle !== "draft") throw new DomainError("ILLEGAL_TASK_TRANSITION");
  const next = clone(state); next.tasks.set(taskId, { ...cloneTask(current), lifecycle: "active" }); return next;
}
export function recordDurablePredicate(state: TaskProjectionV1, taskId: string, predicate: TaskCompletionPolicyV1 extends never ? never : Parameters<typeof completionPredicateIdentity>[0]): TaskProjectionV1 {
  const current = state.tasks.get(taskId); if (!current || current.lifecycle !== "active") throw new DomainError("ILLEGAL_TASK_TRANSITION");
  const next = clone(state); const ids = new Set(current.durablePredicateIds); ids.add(completionPredicateIdentity(predicate)); next.tasks.set(taskId, { ...cloneTask(current), durablePredicateIds: ids }); return next;
}
export function resolveProjectedTask(state: TaskProjectionV1, input: { taskId: string; resolution: TaskResolution; winningGeneration: number | null; eventSequence: number; eventDigest: string }): TaskProjectionV1 {
  const current = state.tasks.get(input.taskId); if (!current || current.lifecycle !== "active" || input.eventSequence < 1 || !input.eventDigest) throw new DomainError("ILLEGAL_TASK_TRANSITION");
  if (!completionPolicySatisfied(current.contract.completionPolicy, current.durablePredicateIds)) throw new DomainError("TASK_COMPLETION_UNSATISFIED");
  const next = clone(state); next.tasks.set(input.taskId, { ...cloneTask(current), lifecycle: input.resolution, resolution: input.resolution, winningGeneration: input.winningGeneration, resolutionEventSequence: input.eventSequence, resolutionDigest: input.eventDigest }); return next;
}
function incoming(state: TaskProjectionV1, taskId: string): DependencyEdgeV1[] { return [...state.edges.values()].filter((edge) => edge.dependentTaskId === taskId).sort((a,b)=>a.edgeId.localeCompare(b.edgeId)); }
export function evaluateTaskJoin(state: TaskProjectionV1, input: { taskId: string; cursor: CompositeCursorV1; authorizationAllowed: boolean; quotaAllowed: boolean; liveAttempt: boolean; unknownOutcome: boolean }): JoinEvaluationV1 {
  const task = state.tasks.get(input.taskId); if (!task) throw new DomainError("TASK_NOT_FOUND");
  const edges = incoming(state, input.taskId); const outcomes = new Map<string, DependencyOutcomeV1 & { resolution: TaskResolution }>();
  for (const edge of edges) { const source = state.tasks.get(edge.sourceTaskId)!; if (source.resolution && source.resolutionEventSequence && source.resolutionDigest) outcomes.set(edge.edgeId, { edgeId: edge.edgeId, edgeType: edge.edgeType, sourceTaskId: edge.sourceTaskId, taskResolutionEventSequence: source.resolutionEventSequence, taskResolutionDigest: source.resolutionDigest, winningGeneration: source.winningGeneration, resolution: source.resolution }); }
  const evaluated = evaluateDependencies(edges, outcomes);
  const schedulability = deriveSchedulability({ lifecycle: task.lifecycle, contractValid: true, dependenciesSatisfied: evaluated.satisfied, hasUnknownDependency: evaluated.unknown, cancellationPropagated: evaluated.cancellationPropagated, authorizationAllowed: input.authorizationAllowed, quotaAllowed: input.quotaAllowed, liveAttempt: input.liveAttempt, unknownOutcome: input.unknownOutcome });
  const dependencies = [...outcomes.values()].map(({ resolution: _resolution, ...outcome }) => outcome);
  const snapshot = sealDependencyJoinSnapshot({ schemaVersion:"1", runId:input.cursor.runId, taskId:input.taskId, taskContractDigest:task.contract.contractDigest, joinEvaluationId:`join:${input.taskId}:${input.cursor.runSequence}`, joinObservationCursor:input.cursor, dependencies, schedulability, reasonCodes:evaluated.reasonCodes });
  return { taskId:input.taskId, schedulability, cancellationPropagated:evaluated.cancellationPropagated, snapshot };
}
