import { createHash, randomUUID } from "node:crypto";
import {
  DomainError, NO_POLICY_DIGEST, NO_POLICY_V1, assertTaskWorkflowAdoptionV1, assertTaskWorkflowLaunchV1, assertTaskPlanRevisionV1,
  attemptContextBindingDigest, canonicalJson, completionPredicateIdentity, contextManifestCoreDigest,
  deltaAuthorityScopeDigest, dependencySatisfied, deriveSchedulability, deterministicReplay, deterministicWorkspaceReplay,
  domainDigest, parseTaskPlanOutputV1, reduceTaskExecutionV1, resolveTask, sealDependencyJoinSnapshot, sealEventEnvelope, sealForkPin, verifyAttemptReceipt,
  sealTaskPlanV1, taskContractDigestV2, taskDependencyClosureV1, taskExecutionProfileDigest, taskWorkflowGraphDigestV1, parseTaskEffortV1,
  type AttemptReceiptEnvelopeV1, type CanonicalDocument, type CompositeCursorV1, type ContextManifestCoreV1, type ContextVersionV1,
  type DependencyOutcomeV1, type DispatchInputV1, type JsonValue, type NativeTaskAdapterIdV1, type RunEventPayloadV1,
  type TaskContractV2, type TaskExecutionEventV1, type TaskExecutionPreparedDataV1, type TaskExecutionProfileV1, type TaskExecutionProjectionV1,
  type TaskWorkflowAuthorizationV1, type WorkspaceState, type TaskEffortV1,
} from "@horseness/domain";
import { evaluateExecutionPolicy, parsePolicySlotV1, policySlotDigest, type PolicySlotV1 } from "@horseness/policy";
import type { AuthenticatedGrantV1, BoundAdapterOperationV1, ProtocolMethodV1, WorkerAdapterV1 } from "@horseness/protocol";
import { StoreConflictError, type AppendResult, type AuthorityStateExpectationV1, type SQLiteAuthority, type StoredEvent, type TrustedAuthorityReader } from "@horseness/store-sqlite";
import { contextSourceDigest } from "../context/reconstruction.js";

export interface ExecutionActorV1 { readonly principalId: string; readonly grantDigest: string }
export interface ExecutionGrantObservationV1 { readonly grant: AuthenticatedGrantV1; readonly expectation: AuthorityStateExpectationV1 }
export interface ExecutionGrantAuthorityV1 {
  observe(digest: string): ExecutionGrantObservationV1 | null;
  producer(input: { actor: ExecutionActorV1; runId: string; taskId: string; attemptId: string; generation: number; adapterId: string; expiresAt: string }): { principalId: string; grantDigest: string; capability: string };
  reference(digest: string): string | null;
}
export interface ExecutionPublicationV1 { readonly digest: string; readonly mediaType: string; readonly bytes: Uint8Array }
export interface ExecutionHostSessionV1 { readonly adapter: WorkerAdapterV1; publication(digest: string): Promise<ExecutionPublicationV1>; close(): Promise<void> }
export interface ExecutionHostDriverV1 {
  resolve(adapterId: NativeTaskAdapterIdV1, model: string | null, purpose: "work" | "planner", effort: TaskEffortV1): Promise<TaskExecutionProfileV1>;
  open(prepared: TaskExecutionPreparedDataV1, binding: BoundAdapterOperationV1): Promise<ExecutionHostSessionV1>;
}
export interface StartTaskWorkflowV1 {
  readonly operationKind: "dispatch" | "breakdown" | "execute";
  readonly operationId: string; readonly requestDigest: string; readonly observationCursor: CompositeCursorV1;
  readonly taskId: string; readonly actor: ExecutionActorV1; readonly adapterId: NativeTaskAdapterIdV1; readonly model: string | null;
  readonly effort?: TaskEffortV1; readonly plannerEffort?: TaskEffortV1;
  readonly autoPlan?: boolean; readonly plannerAdapterId?: NativeTaskAdapterIdV1; readonly plannerModel?: string | null;
}
interface ExecutionView {
  readonly cursor: CompositeCursorV1; readonly runEvents: readonly StoredEvent[];
  readonly canonical: CanonicalDocument;
  readonly state: TaskExecutionProjectionV1; readonly workspace: WorkspaceState;
}
const WORKFLOW_METHOD: Record<StartTaskWorkflowV1["operationKind"], ProtocolMethodV1> = { dispatch: "task.dispatch.v1", breakdown: "task.breakdown.v1", execute: "task.execute.v1" };
const BRIDGE_ADAPTER: Record<NativeTaskAdapterIdV1, string> = { pi: "horseness-pi-v1", omp: "horseness-omp-v1", claude: "horseness-claude-v1", codex: "horseness-codex-v1" };
const MAX_CONTEXT_BYTES = 1024 * 1024;
const NO_RETRY_DIGEST = domainDigest("horseness.task-retry-policy.v1", { automaticRetries: 0 });
const PLANNER_INSTRUCTIONS = 'Return only one JSON object with exactly a tasks array, containing 1 to 32 work tasks. Each task has exactly key, title, instructions, acceptanceCriteria (nonempty string array), and dependsOn (local task-key array). Use unique keys and an acyclic graph. Do not include execution identities, adapters, models, commands to the coordinator, grants, policies, permissions, canonical scopes, or completion predicates. Do not execute the work or modify files. The original objective will run after the sink tasks to integrate and verify their results.';

function failureCode(error: unknown): string {
  if (error && typeof error === "object" && "code" in error && typeof error.code === "string") return error.code;
  if (error instanceof Error) return /^([A-Z][A-Z_]+)(?::|$)/u.exec(error.message)?.[1] ?? "EXECUTION_FAILED";
  return "EXECUTION_FAILED";
}
function terminal(state: string): boolean { return state === "succeeded" || state === "failed" || state === "cancelled"; }
function executionInvariant(code: string): never { throw new DomainError(code); }

/** The authority-owned application service. Native adapters receive no storage handle. */
export class TaskExecutionServiceV1 {
  private readonly bootId = randomUUID();
  private readonly processId = String(process.pid);
  private readonly sessions = new Map<string, ExecutionHostSessionV1>();
  private readonly starts = new Set<Promise<Record<string, JsonValue>>>();
  private pumping: Promise<void> | null = null;
  private stopping = false;
  private requested = false;
  constructor(private readonly authority: SQLiteAuthority, private readonly workspaceId: string,
    private readonly grants: ExecutionGrantAuthorityV1, private readonly hosts: ExecutionHostDriverV1,
    private readonly clock: () => string) {}

  private isStopping(): boolean { return this.stopping; }

  private view(runId: string): ExecutionView {
    const workspaceEvents = this.authority.replay(this.workspaceId, "workspace", this.workspaceId);
    const runEvents = this.authority.replay(this.workspaceId, "run", runId);
    const w = workspaceEvents.at(-1), r = runEvents.at(-1);
    if (!w || !r) throw new DomainError("TASK_NOT_FOUND");
    const replay = deterministicReplay(runEvents);
    return { cursor: { schemaVersion: "1", kind: "composite", workspaceId: this.workspaceId, workspaceSequence: w.envelope.sequence, workspaceEnvelopeHash: w.envelopeHash, workspaceContextEpoch: w.envelope.sequence - 1, runId, runSequence: r.envelope.sequence, runEnvelopeHash: r.envelopeHash, runContextEpoch: r.envelope.sequence - 1 }, runEvents, canonical: replay.canonical, state: replay.operational.execution, workspace: deterministicWorkspaceReplay(workspaceEvents) };
  }

  private authorize(actor: ExecutionActorV1, runId: string, taskId: string, method: ProtocolMethodV1,adapterId?:NativeTaskAdapterIdV1): ExecutionGrantObservationV1 {
    const observed = this.grants.observe(actor.grantDigest), g = observed?.grant;
    if (!observed || !g || g.principalId !== actor.principalId || g.workspaceId !== this.workspaceId || !g.allowedMethods.includes(method) || g.runId !== null && g.runId !== runId || g.taskId !== null && g.taskId !== taskId) throw new DomainError("AUTHORIZATION_DENIED");
    if(adapterId!==undefined&&g.adapterId!==null&&g.adapterId!==BRIDGE_ADAPTER[adapterId])throw new DomainError("AUTHORIZATION_DENIED");
    if((method==="task.dispatch.v1"||method==="task.breakdown.v1"||method==="task.execute.v1"||method==="task.revisePlan.v1")&&(g.attemptId!==null||g.generation!==null||g.proposalId!==null||g.principalRole!=="authority"&&g.principalRole!=="operator"))throw new DomainError("AUTHORIZATION_DENIED");
    return observed;
  }

  private assertCursor(view: ExecutionView, expected: CompositeCursorV1): void {
    if (canonicalJson(view.cursor) !== canonicalJson(expected)) throw new StoreConflictError("execution observation compare-and-swap conflict");
  }

  private append(view: ExecutionView, payloads: readonly RunEventPayloadV1[], commandId: string, principalId: string,
    expectation?: AuthorityStateExpectationV1, publications: readonly { data: string | Uint8Array; mediaType: string }[] = [],clientRequestDigest?:string): CompositeCursorV1 {
    let prior = view.cursor.runEnvelopeHash;
    const events = payloads.map((payload, index) => {
      const event = sealEventEnvelope({ schemaVersion: "1", streamKind: "run", workspaceId: this.workspaceId, streamId: view.cursor.runId,
        sequence: view.cursor.runSequence + index + 1, priorEnvelopeHash: prior,
        eventId: domainDigest("horseness.execution-event-id.v1", { commandId, index }), eventType: payload.eventType,
        principalId, causationId: commandId, correlationId: commandId, idempotencyKey: `${commandId}:${String(index)}`, payload });
      prior = event.envelopeHash; return event;
    });
    const last = events.at(-1);
    if (!last) throw new DomainError("EXECUTION_INVALID");
    deterministicReplay([...view.runEvents, ...events]);
    const artifacts = publications.map(item => ({ data: item.data, mediaType: item.mediaType, references: [{ ownerKind: "event", ownerId: last.envelope.eventId }] }));
    const request = { commandId, workspaceObservationCursor: view.cursor, ...(expectation ? { authorityStateExpectations: [expectation] } : {}),...(clientRequestDigest===undefined?{}:{clientRequestDigest}),
      run: { streamKind: "run" as const, workspaceId: this.workspaceId, streamId: view.cursor.runId, expectedSequence: view.cursor.runSequence, expectedEnvelopeHash: view.cursor.runEnvelopeHash, events } };
    if (artifacts.length) this.authority.publishAndAppendAtomic({ ...request, artifacts, requiredArtifactDigests: [...new Set(publications.map(item => createHash("sha256").update(item.data).digest("hex")))] });
    else this.authority.appendAtomic(request);
    return { ...view.cursor, runSequence: last.envelope.sequence, runEnvelopeHash: last.envelopeHash, runContextEpoch: last.envelope.sequence - 1 };
  }

  private recoveredMutationCursor(input:{runId:string;operationId:string;requestDigest:string;observationCursor:CompositeCursorV1}):CompositeCursorV1|null {
    const previous=this.authority.committedAppendResult(this.workspaceId,input.runId,input.operationId);
    if(!previous)return null;
    if(previous.clientRequestDigest!==input.requestDigest||!previous.runHead)throw new DomainError("OPERATION_ID_REUSED");
    return {...input.observationCursor,runSequence:previous.runHead.sequence,runEnvelopeHash:previous.runHead.envelopeHash,runContextEpoch:previous.runHead.sequence-1};
  }

  private commitNoop(view:ExecutionView,operationId:string,requestDigest:string,expectation:AuthorityStateExpectationV1):CompositeCursorV1 {
    const result:AppendResult={commandId:operationId,clientRequestDigest:requestDigest,deduplicated:false,runHead:{sequence:view.cursor.runSequence,envelopeHash:view.cursor.runEnvelopeHash}};
    this.authority.executionCommandResult({workspaceId:this.workspaceId,runId:view.cursor.runId,commandId:operationId,requestDigest,observationCursor:view.cursor,authorityStateExpectations:[expectation]},result as unknown as JsonValue);
    return view.cursor;
  }

  private policy(view: ExecutionView): PolicySlotV1 {
    if (view.workspace.activePolicyDigest === NO_POLICY_DIGEST) return NO_POLICY_V1;
    const snapshot = this.authority.latestSnapshot(this.workspaceId, "run", view.cursor.runId, "admission-current", "1");
    const owner = snapshot && view.runEvents.find(event => event.envelope.sequence === snapshot.sequence && event.envelopeHash === snapshot.envelopeHash);
    const snapshotState: unknown = snapshot?.state;
    if (!snapshot || !owner || !snapshotState || typeof snapshotState !== "object" || Array.isArray(snapshotState)) throw new DomainError("POLICY_AUTHORITY_UNAVAILABLE");
    const policy = parsePolicySlotV1((snapshotState as Record<string, unknown>).currentPolicy);
    if (policySlotDigest(policy) !== view.workspace.activePolicyDigest) throw new DomainError("POLICY_AUTHORITY_UNAVAILABLE");
    return policy;
  }

  private checkPolicy(view: ExecutionView, taskId: string, intentDigest: string, pinnedPolicy?: PolicySlotV1): { policy: PolicySlotV1; quotaDigest: string } {
    const current = this.policy(view);
    const evaluated = evaluateExecutionPolicy({ schemaVersion: "1", intentDigest, action: "task.dispatch", paths: [`/tasks/${taskId.replaceAll("~", "~0").replaceAll("/", "~1")}`], version: "1", pinnedPolicy: pinnedPolicy ?? current, currentPolicy: current, evidence: [], evaluationClock: { schemaVersion: "1", authorityTime: new Date(this.clock()).toISOString().replace(/\.\d{3}Z$/u, "Z"), observationCursor: view.cursor } });
    if (evaluated.result !== "accepted") throw new DomainError("POLICY_DENIED", evaluated.result);
    if (Object.keys(view.workspace.quotas).length) {
      const snapshot = this.authority.latestSnapshot(this.workspaceId, "run", view.cursor.runId, "admission-current", "1");
      const state = snapshot?.state as { evaluationObservationCursor?: CompositeCursorV1; quota?: { digest: string; available: boolean } } | undefined;
      if (!snapshot || snapshot.sequence !== view.cursor.runSequence || snapshot.envelopeHash !== view.cursor.runEnvelopeHash || !state?.evaluationObservationCursor || canonicalJson(state.evaluationObservationCursor) !== canonicalJson(view.cursor) || !state.quota) throw new DomainError("QUOTA_AUTHORITY_UNAVAILABLE");
      if (!state.quota.available) throw new DomainError("QUOTA_DENIED");
      return { policy: current, quotaDigest: state.quota.digest };
    }
    return { policy: current, quotaDigest: domainDigest("horseness.serial-execution-quota.v1", { workspaceId: this.workspaceId, limit: 1, runId: view.cursor.runId, observationCursor: view.cursor }) };
  }

  private dependencies(view: ExecutionView, taskId: string): { satisfied: boolean; unknown: boolean; cancelled: boolean; outcomes: DependencyOutcomeV1[] } {
    const edges = view.state.edges.filter(edge => edge.dependentTaskId === taskId), outcomes: DependencyOutcomeV1[] = [];
    let satisfied = true, unknown = false, cancelled = false;
    for (const edge of edges) {
      const resolution = view.state.resolutions[edge.sourceTaskId];
      if (!resolution) { unknown = true; satisfied = false; continue; }
      const event = view.runEvents.find(item => item.envelope.payload.eventType === "TaskResolvedV2" && item.envelope.payload.resolution.taskId === edge.sourceTaskId);
      if (!event) throw new DomainError("TASK_RESOLUTION_MISMATCH");
      const successReceipt = Object.values(view.state.receipts).find(receipt => receipt.taskId === edge.sourceTaskId && receipt.generation === resolution.winningGeneration && receipt.outcome === "succeeded");
      const released = edge.releasePredicate === "task-resolution" || edge.releasePredicate === completionPredicateIdentity({ kind: "receipt-only" }) && successReceipt !== undefined;
      if (!released || !dependencySatisfied(edge, resolution.resolution)) satisfied = false;
      if (edge.propagateCancellation && resolution.resolution === "cancelled") cancelled = true;
      outcomes.push({ edgeId: edge.edgeId, edgeType: edge.edgeType, sourceTaskId: edge.sourceTaskId, taskResolutionEventSequence: event.envelope.sequence, taskResolutionDigest: event.envelopeHash, winningGeneration: resolution.winningGeneration });
    }
    return { satisfied, unknown, cancelled, outcomes };
  }

  private taskAttempts(view: ExecutionView, taskId: string) {
    return Object.entries(view.state.prepared).filter(([, prepared]) => prepared.taskId === taskId).map(([key, prepared]) => ({ key, prepared, state: view.state.attempts[key] ?? executionInvariant("EXECUTION_INVALID"), receipt: view.state.receipts[key] }));
  }

  private taskDescription(view: ExecutionView, taskId: string, actor: ExecutionActorV1, details: boolean): JsonValue {
    const runId=view.cursor.runId, task = view.state.contracts[taskId], lifecycle = view.state.lifecycles[taskId];
    if (!task || !lifecycle) throw new DomainError("TASK_NOT_FOUND");
    const attempts = this.taskAttempts(view, taskId), deps = this.dependencies(view, taskId);
    let allowed = true;
    try { this.authorize(actor, runId, taskId, "task.dispatch.v1"); this.checkPolicy(view, taskId, taskContractDigestV2(task)); this.assertWorkspaceAvailable(attempts.at(-1)?.key); } catch(error) { if(!(error instanceof DomainError))throw error;allowed = false; }
    const schedulability = deriveSchedulability({ lifecycle, contractValid: true, dependenciesSatisfied: deps.satisfied, hasUnknownDependency: deps.unknown, cancellationPropagated: deps.cancelled, authorizationAllowed: allowed, quotaAllowed: allowed, liveAttempt: attempts.some(item => !terminal(item.state.state) && item.state.state !== "unknown_outcome"), unknownOutcome: attempts.some(item => item.state.state === "unknown_outcome") });
    const winner = view.state.resolutions[taskId]?.winningGeneration;
    const receipt = attempts.find(item => item.receipt?.generation === winner)?.receipt ?? attempts.at(-1)?.receipt;
    const output = details && receipt?.outputDigest ? Buffer.from(this.authority.artifacts.readReferenced(receipt.outputDigest)).toString("utf8") : null;
    const latestPlan=view.state.latestPlansByTask[taskId],plan=latestPlan?view.state.plans[latestPlan]:undefined;
    let previewEvent: StoredEvent["envelope"] | undefined;
    if (details && plan) for (let index = view.runEvents.length - 1; index >= 0; index--) {
      const candidate = view.runEvents[index]?.envelope;
      if (candidate && (candidate.payload.eventType === "TaskPlanProposedV1" || candidate.payload.eventType === "TaskPlanRevisedV1") && candidate.payload.plan.sourceTaskId === taskId) { previewEvent = candidate; break; }
    }
    let workflow:TaskExecutionProjectionV1["workflows"][string]|undefined,planningWorkflow:TaskExecutionProjectionV1["workflows"][string]|undefined;
    for(const candidate of Object.values(view.state.workflows)){if(candidate.authorization.targetTaskId===taskId)workflow=candidate;else if(candidate.authorization.planningSource?.taskId===taskId)planningWorkflow=candidate;}
    workflow??=planningWorkflow;
    return { taskId, title: task.title, lifecycle, schedulability, kind: task.kind,
      dependencies: view.state.edges.filter(edge => edge.dependentTaskId === taskId).map(edge => edge.sourceTaskId).sort(),
      attempts: attempts.map(item => ({ attemptId: item.prepared.attemptId, generation: item.prepared.generation, adapterId: item.prepared.profile.adapterId, model: item.prepared.profile.modelId, effort: item.prepared.profile.effort ?? null, state: item.state.state, providerOperationId: item.receipt?.providerOperationId ?? item.state.providerHandle, receiptDigest: item.receipt?.receiptDigest ?? null, outputDigest: item.receipt?.outputDigest ?? null, failureCode: item.state.findingCodes.at(-1) ?? null })), output,
      plan: details && plan ? { ...plan, adoptedTaskIds: view.state.adopted[plan.planDigest] ?? [] } : null,
      planRevision: previewEvent?.payload.eventType === "TaskPlanRevisedV1" ? { basePlanDigest: previewEvent.payload.basePlanDigest, principalId: previewEvent.principalId, eventSequence: previewEvent.sequence } : null,
      planRejection: view.state.planRejections[taskId] ?? null,
      workflow: workflow ? { workflowId: workflow.authorization.workflowId, state: workflow.state, reasonCode: workflow.reasonCode } : null } as unknown as JsonValue;
  }

  describe(runId: string, taskId: string, actor: ExecutionActorV1): JsonValue {
    return this.taskDescription(this.view(runId), taskId, actor, true);
  }

  list(runId: string, actor: ExecutionActorV1): JsonValue[] {
    const view = this.view(runId);
    return Object.keys(view.state.contracts).sort().map(taskId => this.taskDescription(view, taskId, actor, false));
  }

  observation(runId: string): CompositeCursorV1 { return this.view(runId).cursor; }

  dispatchState(runId:string,taskId:string,attemptId:string,generation:number,actor:ExecutionActorV1):JsonValue {
    this.authorize(actor,runId,taskId,"dispatch.get.v1");
    const view=this.view(runId),key=`${attemptId}:${String(generation)}`,prepared=view.state.prepared[key],state=view.state.attempts[key];
    if(!prepared||prepared.taskId!==taskId||!state)throw new DomainError("TASK_NOT_FOUND");
    return {attemptId,generation,taskId,profileDigest:prepared.profileDigest,adapterId:prepared.profile.adapterId,modelId:prepared.profile.modelId,state:state.state,providerOperationId:view.state.receipts[key]?.providerOperationId??state.providerHandle,receiptDigest:view.state.receipts[key]?.receiptDigest??null};
  }

  async dispatchExisting(input:{runId:string;taskId:string;attemptId:string;generation:number;operationId:string;requestDigest:string;observationCursor:CompositeCursorV1;actor:ExecutionActorV1;action:"launch"|"reconcile";adapterId?:string;bindingDigest?:string}):Promise<Record<string,JsonValue>> {
    const observed=this.authorize(input.actor,input.runId,input.taskId,input.action==="launch"?"dispatch.launch.v1":"dispatch.reconcile.v1");
    const key=`${input.attemptId}:${String(input.generation)}`,view=this.view(input.runId),prepared=view.state.prepared[key],attempt=view.state.attempts[key];
    const workflow=prepared?.workflowId?view.state.workflows[prepared.workflowId]:undefined;
    if(!prepared||prepared.taskId!==input.taskId||!prepared.workflowId||!attempt||!workflow)throw new DomainError("TASK_NOT_FOUND");
    if(input.action==="launch"&&(input.adapterId!==BRIDGE_ADAPTER[prepared.profile.adapterId]||input.bindingDigest!==attemptContextBindingDigest(prepared.binding)))throw new DomainError("EXECUTION_PROFILE_MISMATCH");
    const command={workspaceId:this.workspaceId,runId:input.runId,commandId:domainDigest("horseness.execution-rpc-command.v1",{principalId:input.actor.principalId,operationId:input.operationId,action:input.action}),requestDigest:input.requestDigest};
    const previous=this.authority.executionCommandResult(command);
    if(previous)return previous as Record<string,JsonValue>;
    if(this.sessions.has(key))throw new DomainError("TASK_NOT_READY");
    this.authority.recordAuthorityConsumption({workspaceId:this.workspaceId,runId:input.runId,principalId:input.actor.principalId,authorityKey:`dispatch.${input.action}:${input.operationId}`,commandId:input.requestDigest,observationCursor:input.observationCursor,authorityStateExpectations:[observed.expectation]});
    if(input.action==="reconcile"&&attempt.state==="planned")throw new DomainError("TASK_NOT_READY");
    await this.runAttempt(input.runId,prepared,workflow.authorization);
    const current=this.view(input.runId),state=current.state.attempts[key]??executionInvariant("EXECUTION_INVALID"),receipt=current.state.receipts[key];
    let result:Record<string,JsonValue>;
    if(input.action==="launch"){
      const handle=receipt?.providerOperationId??state.providerHandle;
      if(!handle)throw new DomainError("UNKNOWN_OUTCOME");
      result={outcomeId:input.operationId,status:"completed",dispatchId:input.attemptId,adapterHandle:handle,providerIdempotencyKey:prepared.binding.providerIdempotencyKey};
    }else result={outcomeId:input.operationId,status:"completed",dispatchId:input.attemptId,observedState:state.state,receiptAvailable:receipt!==undefined};
    return this.authority.executionCommandResult(command,result) as Record<string,JsonValue>;
  }

  private assertWorkspaceAvailable(exceptKey?:string):void {
    for(const runId of this.authority.listRunIds(this.workspaceId))for(const [key,state] of Object.entries(this.view(runId).state.attempts))if(key!==exceptKey&&!terminal(state.state)&&state.state!=="planned")throw new DomainError("EXECUTION_WORKSPACE_BUSY");
  }

  private acknowledgement(view: ExecutionView, authorization: TaskWorkflowAuthorizationV1, originalCursor: CompositeCursorV1): Record<string, JsonValue> {
    const event = view.runEvents.find(item => item.envelope.payload.eventType === "TaskWorkflowStartedV1" && item.envelope.payload.authorization.workflowId === authorization.workflowId);
    if (!event) throw new DomainError("EXECUTION_INVALID");
    const cursor = { ...originalCursor, runSequence: event.envelope.sequence, runEnvelopeHash: event.envelopeHash, runContextEpoch: event.envelope.sequence - 1 };
    const taskId = authorization.planningSource?.taskId ?? authorization.targetTaskId;
    const common={outcomeId:event.envelope.causationId,status:"accepted",observationCursor:cursor as unknown as JsonValue};
    if(authorization.operationKind==="breakdown")return {...common,taskId,plannerTaskId:authorization.targetTaskId};
    if(authorization.operationKind==="execute")return {...common,taskId,workflowId:authorization.workflowId};
    const task=view.state.contracts[authorization.targetTaskId]??executionInvariant("TASK_NOT_FOUND");
    return {...common,task:{taskId:authorization.targetTaskId,title:task.title,lifecycle:"active",workflowId:authorization.workflowId}};
  }

  start(input:StartTaskWorkflowV1):Promise<Record<string,JsonValue>> {
    const pending=this.startWorkflow(input);this.starts.add(pending);
    void pending.then(()=>this.starts.delete(pending),()=>this.starts.delete(pending));
    return pending;
  }

  private async startWorkflow(input: StartTaskWorkflowV1): Promise<Record<string, JsonValue>> {
    if(this.stopping)throw new DomainError("WORKFLOW_STOPPED");
    let view = this.view(input.observationCursor.runId);
    this.authorize(input.actor, view.cursor.runId, input.taskId, WORKFLOW_METHOD[input.operationKind],input.adapterId);
    if(input.autoPlan)this.authorize(input.actor,view.cursor.runId,input.taskId,"task.execute.v1",input.plannerAdapterId??input.adapterId);
    const workflowId = `workflow:${domainDigest("horseness.task-workflow-id.v1", { workspaceId: this.workspaceId, runId: view.cursor.runId, operationId: input.operationId })}`;
    const previous = view.state.workflows[workflowId];
    if (previous) {
      if (previous.authorization.requestDigest !== input.requestDigest || previous.authorization.issuerPrincipalId !== input.actor.principalId) throw new DomainError("OPERATION_ID_REUSED");
      this.wake(); return this.acknowledgement(view, previous.authorization, input.observationCursor);
    }
    this.assertCursor(view, input.observationCursor);
    const source = view.state.contracts[input.taskId], lifecycle = view.state.lifecycles[input.taskId];
    if (!source || !lifecycle) throw new DomainError("TASK_NOT_FOUND");
    if (terminal(lifecycle)) throw new DomainError("EXECUTION_ALREADY_STARTED");
    if (Object.values(view.state.workflows).some(item => item.state === "running" && (item.authorization.targetTaskId === input.taskId || item.authorization.planningSource?.taskId === input.taskId))) throw new DomainError("WORKFLOW_ALREADY_RUNNING");
    if ((input.operationKind === "breakdown" || input.autoPlan) && (view.state.lifecycles[input.taskId] !== "draft" || this.taskAttempts(view, input.taskId).length)) throw new DomainError("TASK_NOT_DRAFT");
    let profile: TaskExecutionProfileV1, plannerProfile: TaskExecutionProfileV1 | null = null;
    try {
      const { effort = "medium", plannerEffort = "medium" } = input;
      profile = await this.hosts.resolve(input.adapterId, input.model, input.operationKind === "breakdown" ? "planner" : "work", parseTaskEffortV1(effort));
      if (profile.effort !== effort) throw new DomainError("EXECUTION_PROFILE_MISMATCH");
      if (input.autoPlan) {
        const plannerAdapterId = input.plannerAdapterId ?? input.adapterId;
        plannerProfile = await this.hosts.resolve(plannerAdapterId, input.plannerModel ?? (plannerAdapterId === input.adapterId ? input.model : null), "planner", parseTaskEffortV1(plannerEffort));
        if (plannerProfile.effort !== plannerEffort) throw new DomainError("EXECUTION_PROFILE_MISMATCH");
      }
    } catch (error) { throw new DomainError(failureCode(error) === "MODEL_REQUIRED" ? "MODEL_REQUIRED" : "EXECUTION_PREFLIGHT_FAILED", error instanceof Error ? error.message : "native preflight failed"); }
    if(this.isStopping())throw new DomainError("WORKFLOW_STOPPED");
    view = this.view(view.cursor.runId); this.assertCursor(view, input.observationCursor);
    const observed = this.authorize(input.actor, view.cursor.runId, input.taskId, WORKFLOW_METHOD[input.operationKind]);
    const payloads: RunEventPayloadV1[] = [], common = { workspaceId: this.workspaceId, runId: view.cursor.runId };
    let target = source, closure = taskDependencyClosureV1(view.state, input.taskId);
    if (input.operationKind === "breakdown") {
      target = { schemaVersion: "2", taskId: `planner:${workflowId}`, title: `Plan: ${source.title}`, instructions: `${PLANNER_INSTRUCTIONS}\nObjective: ${source.instructions}`, acceptanceCriteria: ["Return the complete validated task graph as JSON without executing it."], kind: "planner", sourceTaskId: source.taskId, completionPolicy: { schemaVersion: "1", kind: "predicate", predicate: { kind: "receipt-only" } } };
      payloads.push({ eventType: "TaskCreatedV2", ...common, contract: target }, { eventType: "TaskActivatedV1", ...common, taskId: target.taskId });
      closure = { contracts: [target], edges: [] };
    } else if (input.operationKind === "dispatch") {
      const deps = this.dependencies(view, input.taskId);
      if (!deps.satisfied || deps.unknown || deps.cancelled) throw new DomainError("TASK_NOT_READY");
      if (view.state.lifecycles[input.taskId] === "draft") payloads.push({ eventType: "TaskActivatedV1", ...common, taskId: input.taskId });
    }
    this.checkPolicy(view, input.taskId, input.requestDigest);
    const authorization: TaskWorkflowAuthorizationV1 = { schemaVersion: "1", workflowId, ...common, operationKind: input.operationKind, requestDigest: input.requestDigest,
      planningSource: input.operationKind === "breakdown" || input.autoPlan ? { taskId: source.taskId, contractDigest: taskContractDigestV2(source) } : null, parentWorkflowId: null,
      targetTaskId: target.taskId, targetContractDigest: taskContractDigestV2(target), issuerPrincipalId: input.actor.principalId, issuerGrantDigest: input.actor.grantDigest, expiresAt: new Date(Math.min(Date.parse(observed.grant.expiresAt), Date.parse(this.clock()) + profile.timeoutMs * (input.operationKind === "execute" ? 33 : 1) + (plannerProfile?.timeoutMs ?? 0) + 120_000)).toISOString(),
      executionProfile: profile, plannerProfile, autoPlan: input.autoPlan === true, graphDigest: input.autoPlan ? null : taskWorkflowGraphDigestV1(closure.contracts, closure.edges), planDigest: null };
    payloads.push({ eventType: "TaskWorkflowStartedV1", ...common, authorization });
    this.append(view, payloads, input.operationId, input.actor.principalId, observed.expectation,[],input.requestDigest);
    const result = this.acknowledgement(this.view(view.cursor.runId), authorization, input.observationCursor);
    this.wake(); return result;
  }

  adopt(input: { runId: string; taskId: string; planDigest: string; operationId: string; requestDigest:string; observationCursor: CompositeCursorV1; actor: ExecutionActorV1 }): Record<string, JsonValue> {
    const view = this.view(input.runId), observed = this.authorize(input.actor, input.runId, input.taskId, "task.adoptPlan.v1");
    const recovered=this.recoveredMutationCursor(input);
    const plan = view.state.plans[input.planDigest];
    if (!plan || plan.sourceTaskId !== input.taskId) throw new DomainError("PLAN_NOT_FOUND");
    if(recovered)return {outcomeId:input.operationId,status:"completed",taskId:input.taskId,taskIds:view.state.adopted[input.planDigest]??executionInvariant("EXECUTION_INVALID"),planDigest:input.planDigest,observationCursor:recovered as unknown as JsonValue};
    this.assertCursor(view, input.observationCursor);
    const adopted = view.state.adopted[input.planDigest];
    if(adopted){const cursor=this.commitNoop(view,input.operationId,input.requestDigest,observed.expectation);return {outcomeId:input.operationId,status:"completed",taskId:input.taskId,taskIds:adopted,planDigest:input.planDigest,observationCursor:cursor as unknown as JsonValue};}
    if (Object.values(view.state.workflows).some(item => item.state === "running" && item.authorization.targetTaskId === input.taskId)) throw new DomainError("WORKFLOW_ALREADY_RUNNING");
    this.checkPolicy(view, input.taskId, plan.planDigest);
    const resultCursor = this.append(view, [{ eventType: "TaskPlanAdoptedV1", workspaceId: this.workspaceId, runId: input.runId, taskId: input.taskId, planDigest: input.planDigest }], input.operationId, input.actor.principalId, observed.expectation,[],input.requestDigest);
    return { outcomeId: input.operationId, status: "completed", taskId: input.taskId, taskIds: this.view(input.runId).state.adopted[input.planDigest] ?? executionInvariant("EXECUTION_INVALID"), planDigest: input.planDigest, observationCursor: resultCursor as unknown as JsonValue };
  }

  revisePlan(input: { runId: string; taskId: string; basePlanDigest: string; plan: unknown; operationId: string; requestDigest: string; observationCursor: CompositeCursorV1; actor: ExecutionActorV1 }): Record<string, JsonValue> {
    const view = this.view(input.runId), observed = this.authorize(input.actor, input.runId, input.taskId, "task.revisePlan.v1");
    const base = view.state.plans[input.basePlanDigest];
    if (!base || base.sourceTaskId !== input.taskId) throw new DomainError("PLAN_NOT_FOUND");
    const output = parseTaskPlanOutputV1(input.plan);
    if (Buffer.byteLength(canonicalJson(output as unknown as JsonValue)) > 64 * 1024) throw new DomainError("PLAN_INVALID");
    const plan = sealTaskPlanV1(input.taskId, base.sourceContractDigest, output);
    const recovered = this.recoveredMutationCursor(input);
    const result = (cursor: CompositeCursorV1): Record<string, JsonValue> => ({ outcomeId: input.operationId, status: "completed", taskId: input.taskId, basePlanDigest: input.basePlanDigest, planDigest: plan.planDigest, observationCursor: cursor as unknown as JsonValue });
    if (recovered) return result(recovered);
    this.assertCursor(view, input.observationCursor);
    assertTaskPlanRevisionV1(view.state, input.taskId, input.basePlanDigest);
    this.checkPolicy(view, input.taskId, plan.planDigest);
    if (plan.planDigest === input.basePlanDigest) return result(this.commitNoop(view, input.operationId, input.requestDigest, observed.expectation));
    return result(this.append(view, [{ eventType: "TaskPlanRevisedV1", workspaceId: this.workspaceId, runId: input.runId, basePlanDigest: input.basePlanDigest, plan }], input.operationId, input.actor.principalId, observed.expectation, [], input.requestDigest));
  }

  private workflowAuthority(view: ExecutionView, authorization: TaskWorkflowAuthorizationV1): ExecutionGrantObservationV1 {
    const registered=view.state.workflows[authorization.workflowId];
    if(!registered||registered.state!=="running"||canonicalJson(registered.authorization as unknown as JsonValue)!==canonicalJson(authorization as unknown as JsonValue))throw new DomainError("WORKFLOW_STOPPED");
    const parent = authorization.parentWorkflowId ? view.state.workflows[authorization.parentWorkflowId] : null;
    if (authorization.parentWorkflowId && (!parent || parent.state !== "running")) throw new DomainError("WORKFLOW_STOPPED");
    const grantTask = parent?.authorization.targetTaskId ?? authorization.planningSource?.taskId ?? authorization.targetTaskId;
    const method = parent ? "task.execute.v1" : WORKFLOW_METHOD[authorization.operationKind];
    const actor = { principalId: authorization.issuerPrincipalId, grantDigest: authorization.issuerGrantDigest };
    const observation = this.authorize(actor, view.cursor.runId, grantTask, method,authorization.executionProfile.adapterId);
    if(authorization.plannerProfile)this.authorize(actor,view.cursor.runId,grantTask,method,authorization.plannerProfile.adapterId);
    if (Date.parse(this.clock()) >= Date.parse(authorization.expiresAt)) throw new DomainError("WORKFLOW_AUTHORIZATION_EXPIRED");
    if (view.state.lifecycles[authorization.targetTaskId] === "cancelled" || authorization.planningSource && view.state.lifecycles[authorization.planningSource.taskId] === "cancelled") throw new DomainError("TASK_CANCELLED");
    return observation;
  }

  private stopWorkflow(runId: string, workflowId: string, state: "succeeded" | "stopped" | "cancelled" | "revoked", reasonCode: string): void {
    const view = this.view(runId), workflow = view.state.workflows[workflowId];
    if (!workflow || workflow.state !== "running") return;
    this.append(view, [{ eventType: "TaskWorkflowStoppedV1", workspaceId: this.workspaceId, runId, workflowId, state, reasonCode }], `${workflowId}:stop`, workflow.authorization.issuerPrincipalId);
  }

  private startAutomaticPlanner(view: ExecutionView, parent: TaskWorkflowAuthorizationV1): string {
    const workflowId = `${parent.workflowId}:planner`;
    if (view.state.workflows[workflowId]) return workflowId;
    const observed = this.workflowAuthority(view, parent), source = view.state.contracts[parent.targetTaskId];
    if (!parent.plannerProfile || !parent.planningSource || !source) throw new DomainError("EXECUTION_INVALID");
    const task: TaskContractV2 = { schemaVersion: "2", taskId: `planner:${parent.workflowId}`, title: `Plan: ${source.title}`, instructions: `${PLANNER_INSTRUCTIONS}\nObjective: ${source.instructions}`, acceptanceCriteria: ["Return a complete validated JSON task graph; do not execute or edit project files."], kind: "planner", sourceTaskId: source.taskId, completionPolicy: { schemaVersion: "1", kind: "predicate", predicate: { kind: "receipt-only" } } };
    const authorization: TaskWorkflowAuthorizationV1 = { ...parent, workflowId, operationKind: "breakdown", requestDigest: domainDigest("horseness.automatic-planner-request.v1", { workflowId, parentRequestDigest: parent.requestDigest }), parentWorkflowId: parent.workflowId, targetTaskId: task.taskId, targetContractDigest: taskContractDigestV2(task), executionProfile: parent.plannerProfile, plannerProfile: null, autoPlan: false, graphDigest: taskWorkflowGraphDigestV1([task], []), planDigest: null };
    this.append(view, [{ eventType: "TaskCreatedV2", workspaceId: this.workspaceId, runId: view.cursor.runId, contract: task }, { eventType: "TaskActivatedV1", workspaceId: this.workspaceId, runId: view.cursor.runId, taskId: task.taskId }, { eventType: "TaskWorkflowStartedV1", workspaceId: this.workspaceId, runId: view.cursor.runId, authorization }], workflowId, parent.issuerPrincipalId, observed.expectation);
    return workflowId;
  }

  private adoptAutomaticPlan(runId: string, workflowId: string): void {
    const view = this.view(runId), authorization = (view.state.workflows[workflowId] ?? executionInvariant("WORKFLOW_STOPPED")).authorization;
    const observed = this.workflowAuthority(view, authorization);
    const plannerTaskId=view.state.workflows[`${workflowId}:planner`]?.authorization.targetTaskId;
    const digest=plannerTaskId?view.state.plansByPlanner[plannerTaskId]:undefined,plan=digest?view.state.plans[digest]:undefined;
    if (!plan) throw new DomainError("PLAN_NOT_READY");
    assertTaskWorkflowAdoptionV1(view.state, workflowId, plan, this.clock(), authorization.issuerPrincipalId, authorization.issuerGrantDigest);
    const adoption = { eventType: "TaskPlanAdoptedV1" as const, workspaceId: this.workspaceId, runId, taskId: authorization.targetTaskId, planDigest: plan.planDigest };
    const projected = reduceTaskExecutionV1(view.state, adoption, view.cursor.runSequence + 1);
    const closure = taskDependencyClosureV1(projected, authorization.targetTaskId);
    this.checkPolicy(view, authorization.targetTaskId, plan.planDigest);
    this.append(view, [adoption, { eventType: "TaskWorkflowPlanBoundV1", workspaceId: this.workspaceId, runId, workflowId, planDigest: plan.planDigest, graphDigest: taskWorkflowGraphDigestV1(closure.contracts, closure.edges) }], `${workflowId}:adopt`, authorization.issuerPrincipalId, observed.expectation);
  }

  private prepare(runId: string, authorization: TaskWorkflowAuthorizationV1, taskId: string): TaskExecutionPreparedDataV1 {
    let view = this.view(runId), observed = this.workflowAuthority(view, authorization);
    assertTaskWorkflowLaunchV1(view.state, authorization.workflowId, taskId, this.clock(), authorization.issuerPrincipalId, authorization.issuerGrantDigest);
    this.assertWorkspaceAvailable(this.taskAttempts(view,taskId).at(-1)?.key);
    if (view.state.lifecycles[taskId] === "draft") {
      this.append(view, [{ eventType: "TaskActivatedV1", workspaceId: this.workspaceId, runId, taskId }], `${authorization.workflowId}:activate:${taskId}`, authorization.issuerPrincipalId, observed.expectation);
      view = this.view(runId); observed = this.workflowAuthority(view, authorization);
    }
    const existing = this.taskAttempts(view, taskId);
    const retained = existing.at(-1);
    if (retained) {
      if(retained.prepared.profileDigest!==taskExecutionProfileDigest(authorization.executionProfile))throw new DomainError("EXECUTION_PROFILE_MISMATCH");
      if(retained.state.state==="planned"&&(retained.prepared.workflowId!==authorization.workflowId||retained.prepared.forkPin.core.createdByPrincipalId!==authorization.issuerPrincipalId||retained.prepared.forkPin.core.createdByGrantDigest!==authorization.issuerGrantDigest))throw new DomainError("AUTHORIZATION_DENIED");
      return retained.prepared;
    }
    const deps = this.dependencies(view, taskId);
    if (!deps.satisfied || deps.unknown || deps.cancelled) throw new DomainError("TASK_NOT_READY");
    const attemptId = `attempt:${domainDigest("horseness.task-attempt.v1", { workflowId: authorization.workflowId, taskId })}`, generation = 1;
    const profile = authorization.executionProfile, profileDigest = taskExecutionProfileDigest(profile);
    const producer = this.grants.producer({ actor: { principalId: authorization.issuerPrincipalId, grantDigest: authorization.issuerGrantDigest }, runId, taskId, attemptId, generation, adapterId: BRIDGE_ADAPTER[profile.adapterId], expiresAt: authorization.expiresAt });
    observed = this.workflowAuthority(view, authorization);
    const selectedPolicy = this.checkPolicy(view, taskId, profileDigest), task = view.state.contracts[taskId] ?? executionInvariant("TASK_NOT_FOUND");
    const join = sealDependencyJoinSnapshot({ schemaVersion: "1", runId, taskId, taskContractDigest: taskContractDigestV2(task), joinEvaluationId: `${attemptId}:join`, joinObservationCursor: view.cursor, dependencies: deps.outcomes, schedulability: "ready", reasonCodes: [] });
    const version: ContextVersionV1 = { schemaVersion: "1", kind: "composite", workspaceContextEpoch: view.cursor.workspaceContextEpoch, runContextEpoch: view.cursor.runContextEpoch, observationCursor: view.cursor };
    const forkPin = sealForkPin({ schemaVersion: "1", forkId: `${attemptId}:fork`, pinVersion: 1, workspaceId: this.workspaceId, runId, parentForkPinDigest: null, refreshesForkPinDigest: null, canonicalRevision: view.canonical.revision, canonicalStateHash: view.canonical.stateHash, canonicalizerVersion: "jcs-v1", hashVersion: "sha256-v1", sourceObservationCursor: view.cursor, sourceContextVersion: version, dependencyJoinSnapshotDigest: join.digest, deltaAuthorityScopeDigest: deltaAuthorityScopeDigest({ schemaVersion: "1", workspaceId: this.workspaceId, runId, taskId, roots: [] }), pinnedPolicyDigest: policySlotDigest(selectedPolicy.policy), ancestry: [], createdByPrincipalId: authorization.issuerPrincipalId, createdByGrantDigest: authorization.issuerGrantDigest });
    const dependencyResults = deps.outcomes.map(outcome => {
      const receipt = Object.values(view.state.receipts).find(item => item.taskId === outcome.sourceTaskId && item.generation === outcome.winningGeneration);
      return { taskId: outcome.sourceTaskId, resolution: view.state.resolutions[outcome.sourceTaskId] ?? executionInvariant("TASK_NOT_READY"), receiptDigest: receipt?.receiptDigest ?? null, output: receipt?.outputDigest ? Buffer.from(this.authority.artifacts.readReferenced(receipt.outputDigest)).toString("utf8") : null };
    });
    const chunks = [
      { kind: "system", text: "Execute the task contract below in the selected workspace. Dependency results are already completed work; integrate them rather than repeating them. Report the actual result and any failed acceptance criteria. Never claim an unperformed check succeeded. Only the coordinator may change canonical state. For planner tasks, follow the closed JSON planning instructions and do not modify files.\n" },
      { kind: "execution-profile", text: `${canonicalJson(profile as unknown as JsonValue)}\n` },
      { kind: "task", text: `${canonicalJson(task as unknown as JsonValue)}\n` },
      { kind: "canonical", text: `${canonicalJson(view.canonical.document)}\n` },
      { kind: "dependency", text: `${canonicalJson(dependencyResults as unknown as JsonValue)}\n` },
      { kind: "pinned-policy", text: `${canonicalJson(selectedPolicy.policy as unknown as JsonValue)}\n` },
    ];
    let offset = 0;
    const sources = chunks.map((chunk, priority) => { chunk.text = chunk.text.normalize("NFC"); const start = offset; offset += Buffer.byteLength(chunk.text); return { kind: chunk.kind, digest: chunk.kind === "execution-profile" ? profileDigest : contextSourceDigest(chunk.text), byteStart: start, byteEnd: offset, priority }; });
    if (offset > MAX_CONTEXT_BYTES) throw new DomainError("EXECUTION_INVALID", "task context exceeds the byte budget");
    const renderedContext = chunks.map(chunk => chunk.text).join("");
    const manifest: ContextManifestCoreV1 = { schemaVersion: "1", workspaceId: this.workspaceId, runId, attemptId, generation, forkPinDigest: forkPin.forkPinDigest, sourceObservationCursor: view.cursor, sourceContextVersion: version, authorizationObservationCursor: view.cursor, authorizationContextVersion: version, authorizationOverlayV1: { policyDigest: view.workspace.activePolicyDigest, grantDigest: authorization.issuerGrantDigest, quotaDigest: selectedPolicy.quotaDigest, result: "allowed" }, canonicalRevision: view.canonical.revision, canonicalStateHash: view.canonical.stateHash, canonicalizerVersion: "jcs-v1", hashVersion: "sha256-v1", sources, rendererVersion: "task-execution-v1", omissions: [], selectedBytes: offset, byteBudget: MAX_CONTEXT_BYTES, tokenizerMetadata: null, renderedOutputDigest: contextSourceDigest(renderedContext) };
    const issuedAt = new Date(this.clock()).toISOString();
    const prepared: TaskExecutionPreparedDataV1 = { taskId, attemptId, generation, workflowId: authorization.workflowId, profile, profileDigest, forkPin, join: join.core, manifest,
      binding: { schemaVersion: "1", attemptId, generation, forkPinDigest: forkPin.forkPinDigest, contextManifestCoreDigest: contextManifestCoreDigest(manifest), sourceObservationCursor: view.cursor, sourceContextVersion: version, authorizationObservationCursor: view.cursor, authorizationContextVersion: version, providerIdempotencyKey: domainDigest("horseness.task-provider-key.v1", { workspaceId: this.workspaceId, runId, attemptId, generation }), expectedReceiptSchemaVersion: "1", allowedProducerPrincipalId: producer.principalId, allowedProducerGrantDigest: producer.grantDigest }, renderedContext,
      evaluationClock: { schemaVersion: "1", authorityTime: issuedAt, observationCursor: view.cursor }, lease: { ownerId: `${this.bootId}:${this.processId}`, bootId: this.bootId, processId: this.processId, issuedAt, expiresAt: new Date(Date.parse(issuedAt) + profile.timeoutMs).toISOString(), durationMs: profile.timeoutMs, fenceToken: 1, observationCursor: view.cursor } };
    this.append(view, [{ eventType: "TaskExecutionPreparedV1", workspaceId: this.workspaceId, runId, prepared }], `${attemptId}:prepare`, authorization.issuerPrincipalId, observed.expectation,
      [{ data: renderedContext, mediaType: "text/plain" }, { data: canonicalJson(manifest as unknown as JsonValue), mediaType: "application/vnd.horseness.context-manifest+json" }, { data: canonicalJson(forkPin as unknown as JsonValue), mediaType: "application/vnd.horseness.fork-pin+json" }, { data: canonicalJson(profile as unknown as JsonValue), mediaType: "application/vnd.horseness.execution-profile+json" }]);
    return prepared;
  }

  private boundOperation(prepared: TaskExecutionPreparedDataV1): BoundAdapterOperationV1 {
    const grant=this.grants.observe(prepared.binding.allowedProducerGrantDigest)?.grant;
    if(!grant||grant.principalId!==prepared.binding.allowedProducerPrincipalId||grant.workspaceId!==this.workspaceId||grant.runId!==prepared.forkPin.core.runId||grant.taskId!==prepared.taskId||grant.attemptId!==prepared.attemptId||grant.generation!==prepared.generation||grant.adapterId!==BRIDGE_ADAPTER[prepared.profile.adapterId]||!grant.allowedMethods.includes("receipt.submit.v1"))throw new DomainError("AUTHORIZATION_DENIED");
    const capability = this.grants.reference(prepared.binding.allowedProducerGrantDigest);
    if (!capability) throw new DomainError("AUTHORIZATION_DENIED");
    return { schemaVersion: "1", workspaceId: this.workspaceId, runId: prepared.forkPin.core.runId, taskId: prepared.taskId, attemptId: prepared.attemptId, generation: prepared.generation, forkPinDigest: prepared.forkPin.forkPinDigest, contextManifestCoreDigest: prepared.binding.contextManifestCoreDigest, attemptContextBindingDigest: attemptContextBindingDigest(prepared.binding), providerIdempotencyKeyDigest: domainDigest("horseness.provider-idempotency-key.v1", prepared.binding.providerIdempotencyKey), attemptCapability: capability };
  }

  private transition(runId: string, prepared: TaskExecutionPreparedDataV1, input: DispatchInputV1, suffix: string, expectation?: AuthorityStateExpectationV1): void {
    const view = this.view(runId);
    this.append(view, [{ eventType: "TaskExecutionTransitionV1", workspaceId: this.workspaceId, runId, taskId: prepared.taskId, attemptId: prepared.attemptId, generation: prepared.generation, profileDigest: prepared.profileDigest, input }], `${prepared.attemptId}:${suffix}`, prepared.forkPin.core.createdByPrincipalId, expectation);
  }

  private resolveTaskResult(runId: string, taskId: string, cancelled = false): void {
    const view = this.view(runId);
    if (view.state.resolutions[taskId]) return;
    const generations = this.taskAttempts(view, taskId).map(item => item.state);
    const resolution = resolveTask({ taskId, generations, retryPolicyDigest: NO_RETRY_DIGEST, retryPermitted: false, cancellationRequested: cancelled || generations.some(item => item.state === "cancelled"), observationCursor: view.cursor });
    if (!resolution) return;
    for(const receipt of Object.values(view.state.receipts))if(receipt.taskId===taskId){if(receipt.outputDigest)this.authority.artifacts.readReferenced(receipt.outputDigest);for(const evidence of receipt.evidence)if(this.authority.artifacts.readReferenced(evidence.digest).byteLength!==evidence.size)throw new DomainError("ARTIFACT_MISMATCH");}
    this.append(view, [{ eventType: "TaskResolvedV2", workspaceId: this.workspaceId, runId, resolution, evaluationClock: { schemaVersion: "1", authorityTime: this.clock(), observationCursor: view.cursor } }], `resolve:${taskId}`, view.workspace.authorityPrincipalId);
  }

  async submitReceipt(runId: string, receipt: AttemptReceiptEnvelopeV1, actor: ExecutionActorV1, publications: readonly ExecutionPublicationV1[] = []): Promise<CompositeCursorV1> {
    verifyAttemptReceipt(receipt);
    const view = this.view(runId), key = `${receipt.attemptId}:${String(receipt.generation)}`, prepared = view.state.prepared[key];
    if (!prepared) throw new DomainError("TASK_NOT_FOUND");
    const observed = this.authorize(actor, runId, prepared.taskId, "receipt.submit.v1",prepared.profile.adapterId);
    if (actor.principalId !== prepared.binding.allowedProducerPrincipalId || actor.grantDigest !== prepared.binding.allowedProducerGrantDigest || observed.grant.attemptId!==receipt.attemptId || observed.grant.generation!==receipt.generation) throw new DomainError("AUTHORIZATION_DENIED");
    const previous = view.state.receipts[key];
    if (previous) { if (previous.receiptDigest !== receipt.receiptDigest) throw new DomainError("RECEIPT_CONFLICT"); return view.cursor; }
    const required = new Map(receipt.evidence.map(item => [item.digest, item]));
    if (receipt.outputDigest) required.set(receipt.outputDigest, { digest: receipt.outputDigest, size: -1, mediaType: "" });
    const objects: { data: Uint8Array; mediaType: string }[] = [];
    let reader:TrustedAuthorityReader|undefined,source:StoredEvent|undefined;
    for (const [digest, descriptor] of required) {
      const supplied = publications.find(item => item.digest === digest);
      let bytes:Uint8Array;
      if(supplied)bytes=supplied.bytes;
      else {
        source??=view.runEvents.find(event=>event.envelope.payload.eventType==="TaskExecutionPreparedV1"&&event.envelope.payload.prepared.attemptId===prepared.attemptId&&event.envelope.payload.prepared.generation===prepared.generation);
        if(!source)throw new DomainError("ARTIFACT_MISMATCH");
        reader??=this.authority.trustedReader();
        try { bytes=reader.readEventBoundArtifact(this.workspaceId,runId,source.envelope.sequence,source.envelope.eventId,digest).bytes; }
        catch { throw new DomainError("ARTIFACT_MISMATCH","receipt object has no authorized attempt publication"); }
      }
      if (createHash("sha256").update(bytes).digest("hex") !== digest || descriptor.size >= 0 && bytes.byteLength !== descriptor.size || supplied && descriptor.mediaType && supplied.mediaType !== descriptor.mediaType || bytes.byteLength > prepared.profile.maxOutputBytes) throw new DomainError("ARTIFACT_MISMATCH");
      objects.push({ data: bytes, mediaType: supplied?.mediaType ?? (descriptor.mediaType || "text/plain") });
    }
    const result = this.append(view, [{ eventType: "TaskExecutionReceiptV1", workspaceId: this.workspaceId, runId, taskId: prepared.taskId, attemptId: prepared.attemptId, generation: prepared.generation, profileDigest: prepared.profileDigest, receipt }], `${prepared.attemptId}:receipt:${receipt.receiptDigest}`, actor.principalId, observed.expectation, objects);
    this.resolveTaskResult(runId, prepared.taskId);
    return await Promise.resolve(result);
  }

  private async runAttempt(runId: string, prepared: TaskExecutionPreparedDataV1, authorization: TaskWorkflowAuthorizationV1): Promise<void> {
    const key = `${prepared.attemptId}:${String(prepared.generation)}`;
    let view = this.view(runId), state = view.state.attempts[key] ?? executionInvariant("EXECUTION_INVALID");
    if (terminal(state.state)) { this.resolveTaskResult(runId, prepared.taskId); return; }
    this.assertWorkspaceAvailable(key);
    const original = this.authority.artifacts.readReferenced(createHash("sha256").update(prepared.renderedContext).digest("hex"));
    if (contextSourceDigest(original) !== prepared.manifest.renderedOutputDigest) throw new DomainError("ARTIFACT_MISMATCH");
    if (state.state === "planned") {
      const observed = this.workflowAuthority(view, authorization);
      if(prepared.workflowId!==authorization.workflowId||prepared.profileDigest!==taskExecutionProfileDigest(authorization.executionProfile)||prepared.forkPin.core.createdByPrincipalId!==authorization.issuerPrincipalId||prepared.forkPin.core.createdByGrantDigest!==authorization.issuerGrantDigest)throw new DomainError("AUTHORIZATION_DENIED");
      this.boundOperation(prepared);
      assertTaskWorkflowLaunchV1(view.state, authorization.workflowId, prepared.taskId, this.clock(), authorization.issuerPrincipalId, authorization.issuerGrantDigest);
      if (Date.parse(this.clock()) >= Date.parse(prepared.lease.expiresAt)) throw new DomainError("TASK_NOT_READY", "execution lease expired before handoff");
      const descriptor = prepared.manifest.sources.find(source => source.kind === "pinned-policy");
      if (!descriptor) throw new DomainError("POLICY_AUTHORITY_UNAVAILABLE");
      const pinned = parsePolicySlotV1(JSON.parse(Buffer.from(original).subarray(descriptor.byteStart, descriptor.byteEnd).toString("utf8")));
      if (policySlotDigest(pinned) !== prepared.forkPin.core.pinnedPolicyDigest) throw new DomainError("POLICY_AUTHORITY_UNAVAILABLE");
      this.checkPolicy(view, prepared.taskId, prepared.profileDigest, pinned);
      this.transition(runId, prepared, { type: "commit-launch-intent" }, "intent", observed.expectation);
    }
    let session:ExecutionHostSessionV1|undefined;
    try {
      session = await this.hosts.open(prepared, this.boundOperation(prepared));
      this.sessions.set(key, session);
      if (state.state === "planned") {
        view=this.view(runId);
        this.workflowAuthority(view,authorization);
        if(view.state.workflows[authorization.workflowId]?.state!=="running"||view.state.attempts[key]?.state!=="launch_intent_committed")throw new DomainError("UNKNOWN_OUTCOME");
        const launched = await session.adapter.launch({ ...this.boundOperation(prepared), operation: "launch", renderedContextDigest: prepared.manifest.renderedOutputDigest, providerOptions: { profileDigest: prepared.profileDigest } });
        if (!launched.providerOperationId || launched.status !== "accepted" && launched.status !== "found") throw new DomainError("UNKNOWN_OUTCOME");
        view = this.view(runId); state = view.state.attempts[key] ?? executionInvariant("EXECUTION_INVALID");
        if (!terminal(state.state)) this.transition(runId, prepared, { type: "record-handle", handle: launched.providerOperationId }, "handle");
      } else {
        const found = await session.adapter.reconcile({ ...this.boundOperation(prepared), operation: "reconcile", providerOperationId: state.providerHandle });
        if (found.status !== "found" || !found.providerOperationId) throw new DomainError("UNKNOWN_OUTCOME");
      }
      const receipt = await session.adapter.collectReceipt(this.boundOperation(prepared));
      const digests = new Set(receipt.evidence.map(item => item.digest)); if (receipt.outputDigest) digests.add(receipt.outputDigest);
      const publications: ExecutionPublicationV1[] = [];
      for (const digest of digests) publications.push(await session.publication(digest));
      await this.submitReceipt(runId, receipt, { principalId: receipt.producerPrincipalId, grantDigest: receipt.producerGrantDigest }, publications);
    } catch (error) {
      view = this.view(runId); state = view.state.attempts[key] ?? executionInvariant("EXECUTION_INVALID");
      if (!terminal(state.state) && state.state !== "unknown_outcome") {
        if (state.state !== "reconciliation_required") this.transition(runId, prepared, { type: "require-reconciliation" }, "reconcile");
        this.transition(runId, prepared, { type: "reconcile-ambiguous" }, "unknown");
      }
      throw new DomainError("UNKNOWN_OUTCOME", failureCode(error));
    } finally { this.sessions.delete(key); if(session)await session.close();this.wake(); }
  }

  private finishPlan(runId: string, authorization: TaskWorkflowAuthorizationV1): void {
    const view = this.view(runId), source = authorization.planningSource;
    if(!source||view.state.plansByPlanner[authorization.targetTaskId])return;
    if(view.state.planRejectionsByPlanner[authorization.targetTaskId])throw new DomainError("PLAN_INVALID");
    const observed = this.workflowAuthority(view, authorization);
    if (view.state.lifecycles[authorization.targetTaskId] !== "succeeded") throw new DomainError("PLAN_NOT_READY");
    const receipt = Object.values(view.state.receipts).find(item => item.taskId === authorization.targetTaskId && item.outcome === "succeeded");
    if (!receipt?.outputDigest) throw new DomainError("PLAN_INVALID");
    try {
      const bytes = this.authority.artifacts.readReferenced(receipt.outputDigest);
      if (bytes.byteLength > 64 * 1024) throw new DomainError("PLAN_INVALID");
      const plan = sealTaskPlanV1(source.taskId, source.contractDigest, parseTaskPlanOutputV1(JSON.parse(Buffer.from(bytes).toString("utf8"))));
      this.append(view, [{ eventType: "TaskPlanProposedV1", workspaceId: this.workspaceId, runId, plannerTaskId: authorization.targetTaskId, plan }], `${authorization.workflowId}:plan`, authorization.issuerPrincipalId, observed.expectation);
    } catch (error) {
      if (error instanceof StoreConflictError) throw error;
      this.append(view, [{ eventType: "TaskPlanRejectedV1", workspaceId: this.workspaceId, runId, taskId: source.taskId, plannerTaskId: authorization.targetTaskId, reasonCode: "PLAN_INVALID" }], `${authorization.workflowId}:plan-rejected`, authorization.issuerPrincipalId, observed.expectation);
      throw new DomainError("PLAN_INVALID");
    }
  }

  private async driveWorkflow(runId: string, workflowId: string): Promise<void> {
    while (!this.stopping) {
      let view = this.view(runId);
      const workflow = view.state.workflows[workflowId];
      if (!workflow || workflow.state !== "running") return;
      const a = workflow.authorization;
      try {
        this.workflowAuthority(view, a);
        if (a.autoPlan && a.graphDigest === null) {
          const plannerId = this.startAutomaticPlanner(view, a);
          await this.driveWorkflow(runId, plannerId);
          if (this.isStopping()) return;
          view = this.view(runId);
          if (view.state.workflows[plannerId]?.state !== "succeeded") throw new DomainError(view.state.workflows[plannerId]?.reasonCode??"PLAN_NOT_READY");
          this.adoptAutomaticPlan(runId, workflowId); continue;
        }
        const lifecycle = view.state.lifecycles[a.targetTaskId] ?? executionInvariant("ILLEGAL_TASK_TRANSITION");
        if (terminal(lifecycle)) {
          if (lifecycle === "succeeded" && a.operationKind === "breakdown") this.finishPlan(runId, a);
          this.stopWorkflow(runId, workflowId, lifecycle === "succeeded" ? "succeeded" : lifecycle === "cancelled" ? "cancelled" : "stopped", lifecycle === "succeeded" ? "COMPLETED" : "TASK_FAILED"); return;
        }
        const closure = a.operationKind === "execute" ? taskDependencyClosureV1(view.state, a.targetTaskId).contracts : [view.state.contracts[a.targetTaskId] ?? executionInvariant("TASK_NOT_FOUND")];
        if (closure.some(task => view.state.lifecycles[task.taskId] === "failed" || view.state.lifecycles[task.taskId] === "cancelled")) throw new DomainError("TASK_NOT_READY");
        const task = closure.find(candidate => view.state.lifecycles[candidate.taskId] !== "succeeded" && this.dependencies(view, candidate.taskId).satisfied);
        if (!task) throw new DomainError("TASK_NOT_READY");
        const prepared = this.prepare(runId, a, task.taskId);
        await this.runAttempt(runId, prepared, a);
      } catch (error) {
        if (this.isStopping()) return;
        const code = failureCode(error);
        if(code==="EXECUTION_WORKSPACE_BUSY"||code==="TASK_NOT_READY"&&this.sessions.size>0)return;
        const reasonCode=code==="UNKNOWN_OUTCOME"&&error instanceof DomainError&&/^[A-Z_]+$/.test(error.message)?error.message:code;
        this.stopWorkflow(runId, workflowId, code === "AUTHORIZATION_DENIED" || code === "WORKFLOW_AUTHORIZATION_EXPIRED" ? "revoked" : code === "TASK_CANCELLED" ? "cancelled" : "stopped", reasonCode);
        return;
      }
    }
  }

  wake(): void {
    this.requested = true;
    if (this.pumping || this.stopping) return;
    this.pumping = new Promise<void>(resolve => setImmediate(resolve)).then(async () => {
      while (this.requested && !this.stopping) {
        this.requested = false;
        for (const runId of this.authority.listRunIds(this.workspaceId)) {
          const snapshot=this.view(runId);
          for(const [taskId,lifecycle] of Object.entries(snapshot.state.lifecycles))if(lifecycle==="active"&&!snapshot.state.resolutions[taskId]){const attempts=this.taskAttempts(snapshot,taskId);if(attempts.length&&attempts.every(item=>terminal(item.state.state)))this.resolveTaskResult(runId,taskId);}
          const workflows = Object.values(this.view(runId).state.workflows).filter(item => item.state === "running" && item.authorization.parentWorkflowId === null);
          for (const workflow of workflows) { if (this.isStopping()) return; await this.driveWorkflow(runId, workflow.authorization.workflowId); }
        }
      }
    }).finally(() => { this.pumping = null; if (this.requested && !this.stopping) this.wake(); });
    // Errors outside an individual workflow indicate corrupt authority; leave durable progress untouched.
    void this.pumping.catch((error: unknown) => { this.requested = false;this.stopping=true;process.stderr.write(`Task execution authority failed: ${failureCode(error)}\n`); });
  }

  async cancel(input: { runId: string; taskId: string; actor: ExecutionActorV1; observationCursor: CompositeCursorV1; operationId: string; requestDigest:string }): Promise<CompositeCursorV1> {
    let view = this.view(input.runId);
    const observed = this.authorize(input.actor, input.runId, input.taskId, "task.cancel.v1");
    const recovered=this.recoveredMutationCursor(input);if(recovered)return recovered;
    this.assertCursor(view, input.observationCursor);
    const lifecycle=view.state.lifecycles[input.taskId];
    if (!view.state.contracts[input.taskId] || !lifecycle) throw new DomainError("TASK_NOT_FOUND");
    if(terminal(lifecycle))return this.commitNoop(view,input.operationId,input.requestDigest,observed.expectation);
    const workflows = Object.values(view.state.workflows).filter(item => item.state === "running" && (item.authorization.targetTaskId === input.taskId || item.authorization.planningSource?.taskId === input.taskId));
    const payloads:TaskExecutionEventV1[] = workflows.map(item => ({ eventType: "TaskWorkflowStoppedV1", workspaceId: this.workspaceId, runId: input.runId, workflowId: item.authorization.workflowId, state: "cancelled", reasonCode: "OPERATOR_CANCELLED" }));
    const evaluationClock={schemaVersion:"1" as const,authorityTime:this.clock(),observationCursor:view.cursor};
    for(const item of this.taskAttempts(view,input.taskId)){
      if(terminal(item.state.state))continue;
      const common={workspaceId:this.workspaceId,runId:input.runId,taskId:input.taskId,attemptId:item.prepared.attemptId,generation:item.prepared.generation,profileDigest:item.prepared.profileDigest};
      if(item.state.state==="planned")payloads.push({eventType:"TaskExecutionAbortedV1",...common,reasonCode:"OPERATOR_CANCELLED",evaluationClock});
      else if(item.state.state!=="cancel_requested"&&item.state.state!=="cancel_handed_off")payloads.push({eventType:"TaskExecutionTransitionV1",...common,input:{type:"request-cancel"}});
    }
    let projected=view.state;
    for(const [index,event] of payloads.entries())projected=reduceTaskExecutionV1(projected,event,view.cursor.runSequence+index+1);
    const generations=Object.entries(projected.prepared).filter(([,prepared])=>prepared.taskId===input.taskId).map(([key])=>projected.attempts[key]??executionInvariant("EXECUTION_INVALID"));
    const resolution=resolveTask({taskId:input.taskId,generations,retryPolicyDigest:NO_RETRY_DIGEST,retryPermitted:false,cancellationRequested:true,observationCursor:view.cursor});
    if(resolution)payloads.push({eventType:"TaskResolvedV2",workspaceId:this.workspaceId,runId:input.runId,resolution,evaluationClock});
    const resultCursor=payloads.length?this.append(view,payloads,input.operationId,input.actor.principalId,observed.expectation,[],input.requestDigest):this.commitNoop(view,input.operationId,input.requestDigest,observed.expectation);
    for (const [key, session] of this.sessions) {
      view = this.view(input.runId);
      const prepared = view.state.prepared[key];
      if (prepared && (prepared.taskId === input.taskId || workflows.some(item => item.authorization.workflowId === prepared.workflowId))) await session.close();
    }
    return resultCursor;
  }

  async close(): Promise<void> {
    this.stopping = true;
    await Promise.allSettled([...this.starts]);
    for (const session of this.sessions.values()) await session.close();
    await this.pumping;
  }
}
