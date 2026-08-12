import {
  attemptContextBindingDigest,
  contextManifestCoreDigest,
  verifyAttemptReceipt,
  verifyForkPin,
  verifyProposal,
  type AdmissionDecisionStateV1,
  type AttemptContextBindingV1,
  type AttemptReceiptEnvelopeV1,
  type CompositeCursorV1,
  type ContextManifestCoreV1,
  type ObservationCursorV1,
  type JsonValue,
  type ProposalEnvelopeV1,
  type SealedForkPinV1,
} from "@horseness/domain";
import {
  METHOD_REGISTRY_V1,
  methodDefinition,
  type JsonRpcFailureV1,
  type JsonRpcRequestV1,
  type JsonRpcResponseV1,
  type MethodDtoValueV1,
  type MethodResultV1,
  type ProtocolMethodV1,
  type SubscriptionResumeV1,
  type SubscriptionResultV1,
} from "@horseness/protocol";

export const SDK_PACKAGE = "@horseness/sdk" as const;

export class SdkError extends Error {
  constructor(readonly code: "INVALID_BINDING" | "SCOPE_SUBSTITUTION" | "CREDENTIAL_NOT_OPAQUE" | "TRANSPORT_FAILURE" | "INVALID_RESPONSE", message: string) {
    super(message);
    this.name = "SdkError";
  }
}

export interface OpaqueCredentialReferenceV1 {
  readonly schemaVersion: "1";
  readonly kind: "keychain" | "environment-reference" | "host-reference";
  readonly reference: string;
  readonly scope: { readonly workspaceId: string; readonly adapterId: string; readonly purpose: string };
}

export interface AuthorizedProtocolTransportV1 {
  request(request: JsonRpcRequestV1, credential: OpaqueCredentialReferenceV1): Promise<JsonRpcResponseV1>;
}

type RegistryDefinitionV1<M extends ProtocolMethodV1> = Extract<(typeof METHOD_REGISTRY_V1)[number], { readonly method: M }>;
type CursorForRequirementV1<R extends (typeof METHOD_REGISTRY_V1)[number]["cursor"]> =
  R extends "absent-workspace" ? Extract<ObservationCursorV1, { kind: "absent-workspace-genesis" }> :
  R extends "workspace" ? Extract<ObservationCursorV1, { kind: "workspace-only" }> :
  R extends "absent-run" ? Extract<ObservationCursorV1, { kind: "absent-run-genesis" }> :
  R extends "run" ? Extract<ObservationCursorV1, { kind: "run-only" | "composite" }> :
  Extract<ObservationCursorV1, { kind: "composite" }>;
export type CoordinatorCursorV1<M extends ProtocolMethodV1> = CursorForRequirementV1<RegistryDefinitionV1<M>["cursor"]>;

export interface CoordinatorCallV1<M extends ProtocolMethodV1 = ProtocolMethodV1> {
  readonly method: M;
  readonly observationCursor: CoordinatorCursorV1<M>;
  readonly workspaceId: string;
  readonly runId?: string;
  readonly taskId?: string;
  readonly attemptId?: string;
  readonly generation?: number;
  readonly proposalId?: string;
  readonly adapterId?: string;
  readonly input: MethodDtoValueV1;
  readonly idempotencyKey?: string;
  readonly resume?: SubscriptionResumeV1;
}

export interface CoordinatorResultV1<M extends ProtocolMethodV1 = ProtocolMethodV1> {
  readonly method: M;
  readonly value: MethodDtoValueV1;
  readonly subscription: SubscriptionResultV1 | null;
}

const REFERENCE = /^[A-Za-z0-9][A-Za-z0-9:._-]{2,255}$/u;
const RAW_SECRET = /(?:[\s=]|bearer|token|secret|password|passwd|api[-_]?key|private[-_]?key|credential|sk[-_]|gh[pousr]_|xox[baprs]-|-----BEGIN)/iu;
function nonEmpty(value: unknown): value is string { return typeof value === "string" && value.length > 0; }
function opaqueCredential(value: OpaqueCredentialReferenceV1): OpaqueCredentialReferenceV1 {
  const scope = value?.scope;
  if (Object.getPrototypeOf(value) !== Object.prototype || Object.keys(value).sort().join(",") !== "kind,reference,schemaVersion,scope" || value.schemaVersion !== "1" || !(["keychain", "environment-reference", "host-reference"] as unknown[]).includes(value.kind) || !REFERENCE.test(value.reference) || RAW_SECRET.test(value.reference) || typeof scope !== "object" || scope === null || Array.isArray(scope) || Object.getPrototypeOf(scope) !== Object.prototype || Object.keys(scope).sort().join(",") !== "adapterId,purpose,workspaceId" || !nonEmpty(scope.workspaceId) || !nonEmpty(scope.adapterId) || !nonEmpty(scope.purpose)) {
    throw new SdkError("CREDENTIAL_NOT_OPAQUE", "credential must be an opaque reference, never secret material");
  }
  return Object.freeze({ ...value, scope: Object.freeze({ ...scope }) });
}

export function coordinatorCursorMatchesV1(requirement: (typeof METHOD_REGISTRY_V1)[number]["cursor"], cursor: ObservationCursorV1): boolean {
  return requirement === "absent-workspace" ? cursor.kind === "absent-workspace-genesis" : requirement === "workspace" ? cursor.kind === "workspace-only" : requirement === "absent-run" ? cursor.kind === "absent-run-genesis" : requirement === "run" ? cursor.kind === "run-only" || cursor.kind === "composite" : cursor.kind === "composite";
}

function failure(response: JsonRpcFailureV1): never {
  throw new SdkError("TRANSPORT_FAILURE", `${response.error.data.reasonCode}: ${response.error.message}`);
}

export class CoordinatorClientV1 {
  readonly #credential: OpaqueCredentialReferenceV1;
  #nextId = 1;
  constructor(readonly transport: AuthorizedProtocolTransportV1, credential: OpaqueCredentialReferenceV1) {
    this.#credential = opaqueCredential(credential);
  }

  async call<M extends ProtocolMethodV1>(call: CoordinatorCallV1<M>): Promise<CoordinatorResultV1<M>> {
    const definition = methodDefinition(call.method);
    if (definition === undefined) throw new SdkError("INVALID_BINDING", `unknown protocol method ${call.method}`);
    if (!coordinatorCursorMatchesV1(definition.cursor, call.observationCursor)) throw new SdkError("INVALID_BINDING", `method ${call.method} requires ${definition.cursor} cursor`);
    const input = definition.parseInput({ schemaVersion: "1", requestType: call.method, value: call.input });
    const body = {
      schemaVersion: "1",
      workspaceId: call.workspaceId,
      ...(call.runId === undefined ? {} : { runId: call.runId }),
      ...(call.taskId === undefined ? {} : { taskId: call.taskId }),
      ...(call.attemptId === undefined ? {} : { attemptId: call.attemptId }),
      ...(call.generation === undefined ? {} : { generation: call.generation }),
      ...(call.proposalId === undefined ? {} : { proposalId: call.proposalId }),
      ...(call.adapterId === undefined ? {} : { adapterId: call.adapterId }),
      input,
    };
    const request: JsonRpcRequestV1 = {
      jsonrpc: "2.0",
      id: this.#nextId++,
      method: call.method,
      params: {
        protocolVersion: "1",
        observationCursor: call.observationCursor,
        ...(call.idempotencyKey === undefined ? {} : { idempotencyKey: call.idempotencyKey }),
        body: body as unknown as JsonValue,
        ...(call.resume === undefined ? {} : { resume: call.resume }),
      },
    };
    const response = await this.transport.request(request, this.#credential);
    if (response.jsonrpc !== "2.0" || response.id !== request.id) throw new SdkError("INVALID_RESPONSE", "transport response does not match request");
    if ("error" in response) failure(response);
    if (response.result.method !== call.method) throw new SdkError("INVALID_RESPONSE", "protocol method response was substituted");
    let parsed: MethodResultV1;
    try { parsed = definition.parseResult(response.result.data); } catch { throw new SdkError("INVALID_RESPONSE", "protocol result failed its registered DTO mapping"); }
    return { method: call.method, value: parsed.value, subscription: response.result.subscription ?? null };
  }
}

export interface WorkerBindingV1 {
  readonly schemaVersion: "1";
  readonly workspaceId: string;
  readonly runId: string;
  readonly taskId: string;
  readonly attemptId: string;
  readonly generation: number;
  readonly forkPin: SealedForkPinV1;
  readonly manifest: ContextManifestCoreV1;
  readonly contextBinding: AttemptContextBindingV1;
  readonly providerId: string;
  readonly providerIdempotencyKeyDigest: string;
  readonly observationCursor: CompositeCursorV1;
  readonly dispatchId: string;
}

export interface ArtifactPublicationV1 { readonly operationId: string; readonly artifactId: string; readonly mediaType: string; readonly contentDigest: string; readonly byteLength: number; readonly storageReference: string }
export interface BoundArtifactPublicationV1 extends ArtifactPublicationV1 { readonly purpose: "output" | "evidence" }
export interface DecisionEventV1 { readonly state: AdmissionDecisionStateV1; readonly proposalId: string; readonly proposalDigest: string; readonly value: JsonValue }
export interface DecisionBatchV1 { readonly events: readonly DecisionEventV1[]; readonly resume: SubscriptionResumeV1 }

function same(a: unknown, b: unknown): boolean { return JSON.stringify(a) === JSON.stringify(b); }
function cloneFreeze<T>(value: T): T {
  const clone = structuredClone(value);
  const freeze = (item: unknown): void => { if (typeof item !== "object" || item === null || Object.isFrozen(item)) return; for (const child of Object.values(item)) freeze(child); Object.freeze(item); };
  freeze(clone);
  return clone;
}
function assertBinding(binding: WorkerBindingV1): void {
  try { verifyForkPin(binding.forkPin); contextManifestCoreDigest(binding.manifest); attemptContextBindingDigest(binding.contextBinding); } catch { throw new SdkError("INVALID_BINDING", "worker binding failed domain verification"); }
  const valid = binding.schemaVersion === "1" && binding.generation >= 1 && binding.providerId.length > 0 && binding.providerIdempotencyKeyDigest.length > 0 &&
    binding.forkPin.core.workspaceId === binding.workspaceId && binding.forkPin.core.runId === binding.runId &&
    binding.manifest.workspaceId === binding.workspaceId && binding.manifest.runId === binding.runId && binding.manifest.attemptId === binding.attemptId && binding.manifest.generation === binding.generation && binding.manifest.forkPinDigest === binding.forkPin.forkPinDigest &&
    binding.contextBinding.attemptId === binding.attemptId && binding.contextBinding.generation === binding.generation && binding.contextBinding.forkPinDigest === binding.forkPin.forkPinDigest && binding.contextBinding.contextManifestCoreDigest === contextManifestCoreDigest(binding.manifest) &&
    binding.contextBinding.providerIdempotencyKey.length > 0 && binding.observationCursor.workspaceId === binding.workspaceId && binding.observationCursor.runId === binding.runId && same(binding.contextBinding.sourceObservationCursor, binding.manifest.sourceObservationCursor);
  if (!valid) throw new SdkError("INVALID_BINDING", "worker identities are not an immutable coherent binding");
}
function decisionEvent(value: unknown, proposalId: string, proposalDigest: string): DecisionEventV1 {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new SdkError("INVALID_RESPONSE", "decision event must be an object");
  const record = value as Record<string, unknown>;
  const state = record.state;
  if (!(["accepted", "rejected", "conflicted", "quarantined", "approval_required"] as unknown[]).includes(state) || record.proposalId !== proposalId || record.proposalDigest !== proposalDigest) throw new SdkError("SCOPE_SUBSTITUTION", "decision event escaped the bound proposal");
  return { state: state as AdmissionDecisionStateV1, proposalId, proposalDigest, value: value as JsonValue };
}

export class WorkerClientV1 {
  readonly #binding: Readonly<WorkerBindingV1>;
  readonly #expected: Readonly<{ forkPinDigest: string; manifestDigest: string; contextBindingDigest: string; deltaAuthorityScopeDigest: string; pinnedPolicyDigest: string }>;
  readonly #acceptedReceipts = new Map<string, AttemptReceiptEnvelopeV1>();
  readonly #publishedEvidence = new Map<string, { digest: string; claim: string }>();
  readonly #resumeScopes = new Map<string, { subscriptionId: string; proposalId: string; proposalDigest: string; cursor: CompositeCursorV1 }>();
  #proposalPhase: "publishing-evidence" | "accepting-receipts" | "submitted" = "publishing-evidence";
  constructor(readonly coordinator: CoordinatorClientV1, binding: WorkerBindingV1) {
    assertBinding(binding);
    this.#binding = cloneFreeze(binding);
    this.#expected = Object.freeze({ forkPinDigest: binding.forkPin.forkPinDigest, manifestDigest: contextManifestCoreDigest(binding.manifest), contextBindingDigest: attemptContextBindingDigest(binding.contextBinding), deltaAuthorityScopeDigest: binding.forkPin.core.deltaAuthorityScopeDigest, pinnedPolicyDigest: binding.forkPin.core.pinnedPolicyDigest });
  }
  get binding(): Readonly<WorkerBindingV1> { return this.#binding; }
  async readBoundContext(): Promise<ContextManifestCoreV1> {
    const result = await this.#attemptCall("context.get.v1", { operationId: `context:${this.#binding.attemptId}:${this.#binding.generation}`, attemptId: this.#binding.attemptId, generation: this.#binding.generation, manifestDigest: contextManifestCoreDigest(this.#binding.manifest) });
    if (!same(result.value, this.#binding.manifest)) throw new SdkError("SCOPE_SUBSTITUTION", "context manifest differs from immutable binding");
    return result.value as ContextManifestCoreV1;
  }
  async publishArtifact(artifact: ArtifactPublicationV1): Promise<MethodDtoValueV1> { return (await this.#attemptCall("artifact.publish.v1", { ...artifact }, artifact.operationId)).value; }
  async publishOutput(output: ArtifactPublicationV1): Promise<MethodDtoValueV1> { return this.publishArtifact({ ...output, storageReference: `output:${output.storageReference}` }); }
  async publishEvidence(evidence: ArtifactPublicationV1, claim = evidence.artifactId): Promise<MethodDtoValueV1> {
    if (this.#proposalPhase !== "publishing-evidence") throw new SdkError("INVALID_BINDING", "evidence must be published before receipts are accepted");
    if (!nonEmpty(claim)) throw new SdkError("INVALID_BINDING", "evidence claim must be non-empty");
    const result = await this.publishArtifact({ ...evidence, storageReference: `evidence:${evidence.storageReference}` });
    const record = result as Readonly<Record<string, unknown>>;
    if (record.status !== "accepted" || record.artifactId !== evidence.artifactId || record.publishedDigest !== evidence.contentDigest) throw new SdkError("INVALID_RESPONSE", "evidence publication was not accepted with its bound digest");
    this.#publishedEvidence.set(evidence.contentDigest, Object.freeze({ digest: evidence.contentDigest, claim }));
    return result;
  }
  async submitReceipt(receipt: AttemptReceiptEnvelopeV1, idempotencyKey: string): Promise<MethodDtoValueV1> {
    if (this.#proposalPhase === "submitted") throw new SdkError("INVALID_BINDING", "proposal submission is already sealed");
    verifyAttemptReceipt(receipt); this.#assertReceipt(receipt);
    const result = (await this.#attemptCall("receipt.submit.v1", receipt, idempotencyKey)).value;
    this.#acceptedReceipts.set(receipt.receiptDigest, cloneFreeze(receipt));
    this.#proposalPhase = "accepting-receipts";
    return result;
  }
  async submitProposal(proposal: ProposalEnvelopeV1, idempotencyKey: string): Promise<MethodDtoValueV1> {
    if (this.#proposalPhase !== "accepting-receipts") throw new SdkError("INVALID_BINDING", "proposal requires at least one accepted receipt after evidence publication");
    verifyProposal(proposal); this.#assertProposal(proposal);
    const result = (await this.#proposalCall("proposal.submit.v1", proposal, proposal.proposalId, idempotencyKey)).value;
    this.#proposalPhase = "submitted";
    return result;
  }
  async decision(proposal: ProposalEnvelopeV1): Promise<DecisionEventV1> {
    verifyProposal(proposal); this.#assertProposal(proposal);
    const result = await this.#proposalCall("admission.decision.v1", { operationId: `decision:${proposal.proposalId}`, proposalId: proposal.proposalId, proposalDigest: proposal.proposalDigest }, proposal.proposalId);
    const value = result.value as Readonly<Record<string, unknown>>;
    return decisionEvent(value.decision, proposal.proposalId, proposal.proposalDigest);
  }
  async subscribeDecisions(proposal: ProposalEnvelopeV1, operationId: string, resume?: SubscriptionResumeV1): Promise<DecisionBatchV1> {
    verifyProposal(proposal); this.#assertProposal(proposal);
    const observationCursor = resume === undefined ? this.#binding.observationCursor : this.#verifiedResumeCursor(proposal, resume);
    const afterSequence = resume === undefined || !("runSequence" in resume.afterObservationCursor) ? 0 : resume.afterObservationCursor.runSequence;
    const result = await this.#proposalCall("admission.subscribe.v1", { operationId, proposalId: proposal.proposalId, afterSequence, resumeToken: resume?.resumeToken ?? operationId }, proposal.proposalId, undefined, resume, observationCursor);
    const value = result.value as Readonly<Record<string, unknown>>;
    if (!Array.isArray(value.events) || result.subscription === null) throw new SdkError("INVALID_RESPONSE", "decision subscription response is incomplete");
    const events = value.events.map(item => decisionEvent(item, proposal.proposalId, proposal.proposalDigest));
    const next = cloneFreeze({ schemaVersion: "1", subscriptionId: result.subscription.subscriptionId, afterObservationCursor: result.subscription.afterObservationCursor, resumeToken: result.subscription.resumeToken } as SubscriptionResumeV1);
    if (next.afterObservationCursor.kind !== "composite" || next.afterObservationCursor.workspaceId !== this.#binding.workspaceId || next.afterObservationCursor.runId !== this.#binding.runId || !this.#monotonic(observationCursor, next.afterObservationCursor)) throw new SdkError("SCOPE_SUBSTITUTION", "subscription returned a substituted or regressed resume cursor");
    this.#resumeScopes.set(next.resumeToken, { subscriptionId: next.subscriptionId, proposalId: proposal.proposalId, proposalDigest: proposal.proposalDigest, cursor: next.afterObservationCursor });
    return { events, resume: next };
  }
  async cancelOwnAttempt(reason: string, force = false): Promise<MethodDtoValueV1> {
    const operationId = `cancel:${this.#binding.attemptId}:${this.#binding.generation}`;
    return (await this.#attemptCall("dispatch.cancel.v1", { operationId, dispatchId: this.#binding.dispatchId, reason, force }, operationId)).value;
  }
  #assertReceipt(receipt: AttemptReceiptEnvelopeV1): void {
    const b = this.#binding;
    if (receipt.workspaceId !== b.workspaceId || receipt.runId !== b.runId || receipt.taskId !== b.taskId || receipt.attemptId !== b.attemptId || receipt.generation !== b.generation || receipt.forkPinDigest !== b.forkPin.forkPinDigest || receipt.contextManifestCoreDigest !== contextManifestCoreDigest(b.manifest) || receipt.attemptContextBindingDigest !== attemptContextBindingDigest(b.contextBinding) || receipt.providerId !== b.providerId || receipt.providerIdempotencyKeyDigest !== b.providerIdempotencyKeyDigest) throw new SdkError("SCOPE_SUBSTITUTION", "receipt differs from immutable worker binding");
  }
  #assertProposal(proposal: ProposalEnvelopeV1): void {
    const b = this.#binding;
    const receiptDigests = [...this.#acceptedReceipts.keys()].sort();
    const evidenceClaims = [...this.#publishedEvidence.values()].sort((a, c) => a.digest.localeCompare(c.digest) || a.claim.localeCompare(c.claim));
    if (proposal.core.workspaceId !== b.workspaceId || proposal.core.runId !== b.runId || proposal.core.attemptId !== b.attemptId || proposal.core.forkPinDigest !== this.#expected.forkPinDigest || proposal.core.deltaAuthorityScopeDigest !== this.#expected.deltaAuthorityScopeDigest || proposal.core.pinnedPolicyDigest !== this.#expected.pinnedPolicyDigest || !same(proposal.core.proposalSealingObservationCursor, b.observationCursor) || !same(proposal.core.proposalSealingContextVersion, b.contextBinding.authorizationContextVersion) || !same(proposal.core.receiptDigests, receiptDigests) || !same(proposal.core.evidenceClaims, evidenceClaims)) throw new SdkError("SCOPE_SUBSTITUTION", "proposal differs from exact publication, receipt, sealing, policy, or authority binding");
  }
  #monotonic(prior: CompositeCursorV1, next: CompositeCursorV1): boolean {
    if (prior.workspaceId !== next.workspaceId || prior.runId !== next.runId || next.workspaceSequence < prior.workspaceSequence || next.runSequence < prior.runSequence || next.workspaceContextEpoch < prior.workspaceContextEpoch || next.runContextEpoch < prior.runContextEpoch) return false;
    if (next.workspaceSequence === prior.workspaceSequence && next.workspaceEnvelopeHash !== prior.workspaceEnvelopeHash) return false;
    if (next.runSequence === prior.runSequence && next.runEnvelopeHash !== prior.runEnvelopeHash) return false;
    return true;
  }
  #verifiedResumeCursor(proposal: ProposalEnvelopeV1, resume: SubscriptionResumeV1): CompositeCursorV1 {
    const scope = this.#resumeScopes.get(resume.resumeToken);
    if (scope === undefined || scope.subscriptionId !== resume.subscriptionId || scope.proposalId !== proposal.proposalId || scope.proposalDigest !== proposal.proposalDigest || resume.afterObservationCursor.kind !== "composite" || !same(scope.cursor, resume.afterObservationCursor) || !this.#monotonic(this.#binding.observationCursor, resume.afterObservationCursor)) throw new SdkError("SCOPE_SUBSTITUTION", "resume token is not verified for this proposal and worker scope");
    return resume.afterObservationCursor;
  }
  #attemptCall<M extends ProtocolMethodV1>(method: M, input: MethodDtoValueV1, idempotencyKey?: string): Promise<CoordinatorResultV1<M>> {
    const b = this.#binding;
    return this.coordinator.call({ method, observationCursor: b.observationCursor as CoordinatorCursorV1<M>, workspaceId: b.workspaceId, runId: b.runId, taskId: b.taskId, attemptId: b.attemptId, generation: b.generation, input, ...(idempotencyKey === undefined ? {} : { idempotencyKey }) });
  }
  #proposalCall<M extends ProtocolMethodV1>(method: M, input: MethodDtoValueV1, proposalId: string, idempotencyKey?: string, resume?: SubscriptionResumeV1, observationCursor: CompositeCursorV1 = this.#binding.observationCursor): Promise<CoordinatorResultV1<M>> {
    const b = this.#binding;
    return this.coordinator.call({ method, observationCursor: observationCursor as CoordinatorCursorV1<M>, workspaceId: b.workspaceId, runId: b.runId, proposalId, input, ...(idempotencyKey === undefined ? {} : { idempotencyKey }), ...(resume === undefined ? {} : { resume }) });
  }
}
