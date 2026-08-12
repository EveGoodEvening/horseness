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
  type JsonValue,
  type ProposalEnvelopeV1,
  type SealedForkPinV1,
} from "@horseness/domain";
import {
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
  readonly reference: string;
}

export interface AuthorizedProtocolTransportV1 {
  request(request: JsonRpcRequestV1, credential: OpaqueCredentialReferenceV1): Promise<JsonRpcResponseV1>;
}

export interface CoordinatorCallV1<M extends ProtocolMethodV1 = ProtocolMethodV1> {
  readonly method: M;
  readonly observationCursor: CompositeCursorV1;
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

const SECRET_KEY = /(?:secret|token|password|passwd|api[-_]?key|private[-_]?key|credential(?:value)?|bearer)/i;
const SECRET_VALUE = /^(?:bearer\s+|sk[-_]|gh[pousr]_|xox[baprs]-|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----)/i;
function opaqueCredential(value: OpaqueCredentialReferenceV1): OpaqueCredentialReferenceV1 {
  if (Object.getPrototypeOf(value) !== Object.prototype || Object.keys(value).sort().join(",") !== "reference,schemaVersion" || value.schemaVersion !== "1" || typeof value.reference !== "string" || value.reference.length < 3 || value.reference.length > 512 || SECRET_KEY.test(value.reference) || SECRET_VALUE.test(value.reference) || /[\r\n\0]/.test(value.reference)) {
    throw new SdkError("CREDENTIAL_NOT_OPAQUE", "credential must be an opaque reference, never secret material");
  }
  return Object.freeze({ ...value });
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
    if (definition.cursor !== "composite") throw new SdkError("INVALID_BINDING", "SDK calls require a bound composite cursor");
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
  constructor(readonly coordinator: CoordinatorClientV1, binding: WorkerBindingV1) {
    assertBinding(binding);
    this.#binding = Object.freeze({ ...binding, forkPin: Object.freeze(binding.forkPin), manifest: Object.freeze(binding.manifest), contextBinding: Object.freeze(binding.contextBinding), observationCursor: Object.freeze({ ...binding.observationCursor }) });
  }
  get binding(): Readonly<WorkerBindingV1> { return this.#binding; }
  async readBoundContext(): Promise<ContextManifestCoreV1> {
    const result = await this.#attemptCall("context.get.v1", { operationId: `context:${this.#binding.attemptId}:${this.#binding.generation}`, attemptId: this.#binding.attemptId, generation: this.#binding.generation, manifestDigest: contextManifestCoreDigest(this.#binding.manifest) });
    if (!same(result.value, this.#binding.manifest)) throw new SdkError("SCOPE_SUBSTITUTION", "context manifest differs from immutable binding");
    return result.value as ContextManifestCoreV1;
  }
  async publishArtifact(artifact: ArtifactPublicationV1): Promise<MethodDtoValueV1> { return (await this.#attemptCall("artifact.publish.v1", { ...artifact }, artifact.operationId)).value; }
  async publishOutput(output: ArtifactPublicationV1): Promise<MethodDtoValueV1> { return this.publishArtifact({ ...output, storageReference: `output:${output.storageReference}` }); }
  async publishEvidence(evidence: ArtifactPublicationV1): Promise<MethodDtoValueV1> { return this.publishArtifact({ ...evidence, storageReference: `evidence:${evidence.storageReference}` }); }
  async submitReceipt(receipt: AttemptReceiptEnvelopeV1, idempotencyKey: string): Promise<MethodDtoValueV1> {
    verifyAttemptReceipt(receipt); this.#assertReceipt(receipt);
    return (await this.#attemptCall("receipt.submit.v1", receipt, idempotencyKey)).value;
  }
  async submitProposal(proposal: ProposalEnvelopeV1, idempotencyKey: string): Promise<MethodDtoValueV1> {
    verifyProposal(proposal); this.#assertProposal(proposal);
    return (await this.#proposalCall("proposal.submit.v1", proposal, proposal.proposalId, idempotencyKey)).value;
  }
  async decision(proposal: ProposalEnvelopeV1): Promise<DecisionEventV1> {
    verifyProposal(proposal); this.#assertProposal(proposal);
    const result = await this.#proposalCall("admission.decision.v1", { operationId: `decision:${proposal.proposalId}`, proposalId: proposal.proposalId, proposalDigest: proposal.proposalDigest }, proposal.proposalId);
    const value = result.value as Readonly<Record<string, unknown>>;
    return decisionEvent(value.decision, proposal.proposalId, proposal.proposalDigest);
  }
  async subscribeDecisions(proposal: ProposalEnvelopeV1, operationId: string, resume?: SubscriptionResumeV1): Promise<DecisionBatchV1> {
    verifyProposal(proposal); this.#assertProposal(proposal);
    const afterSequence = resume === undefined || !("runSequence" in resume.afterObservationCursor) ? 0 : resume.afterObservationCursor.runSequence;
    const result = await this.#proposalCall("admission.subscribe.v1", { operationId, proposalId: proposal.proposalId, afterSequence, resumeToken: resume?.resumeToken ?? operationId }, proposal.proposalId, undefined, resume);
    const value = result.value as Readonly<Record<string, unknown>>;
    if (!Array.isArray(value.events) || result.subscription === null) throw new SdkError("INVALID_RESPONSE", "decision subscription response is incomplete");
    const events = value.events.map(item => decisionEvent(item, proposal.proposalId, proposal.proposalDigest));
    return { events, resume: { schemaVersion: "1", subscriptionId: result.subscription.subscriptionId, afterObservationCursor: result.subscription.afterObservationCursor, resumeToken: result.subscription.resumeToken } };
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
    if (proposal.core.workspaceId !== b.workspaceId || proposal.core.runId !== b.runId || proposal.core.attemptId !== b.attemptId || proposal.core.forkPinDigest !== b.forkPin.forkPinDigest) throw new SdkError("SCOPE_SUBSTITUTION", "proposal differs from immutable worker binding");
  }
  #attemptCall<M extends ProtocolMethodV1>(method: M, input: MethodDtoValueV1, idempotencyKey?: string): Promise<CoordinatorResultV1<M>> {
    const b = this.#binding;
    return this.coordinator.call({ method, observationCursor: b.observationCursor, workspaceId: b.workspaceId, runId: b.runId, taskId: b.taskId, attemptId: b.attemptId, generation: b.generation, input, ...(idempotencyKey === undefined ? {} : { idempotencyKey }) });
  }
  #proposalCall<M extends ProtocolMethodV1>(method: M, input: MethodDtoValueV1, proposalId: string, idempotencyKey?: string, resume?: SubscriptionResumeV1): Promise<CoordinatorResultV1<M>> {
    const b = this.#binding;
    return this.coordinator.call({ method, observationCursor: b.observationCursor, workspaceId: b.workspaceId, runId: b.runId, proposalId, input, ...(idempotencyKey === undefined ? {} : { idempotencyKey }), ...(resume === undefined ? {} : { resume }) });
  }
}
