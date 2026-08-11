export const PROTOCOL_VERSION = "1" as const;
export type PrincipalRole = "authority" | "approver" | "operator" | "worker" | "adapter";
export type MethodKind = "command" | "query" | "subscription" | "adapter-spi";
export type CursorRequirement = "absent-workspace" | "workspace" | "absent-run" | "run" | "composite";
export interface MethodDefinitionV1 {
  readonly method: string;
  readonly kind: MethodKind;
  readonly roles: readonly PrincipalRole[];
  readonly cursor: CursorRequirement;
  readonly idempotency: "required" | "forbidden";
  readonly scope: "workspace" | "run" | "task" | "attempt" | "proposal" | "adapter";
}
const command = (method: string, roles: readonly PrincipalRole[], cursor: CursorRequirement, scope: MethodDefinitionV1["scope"]): MethodDefinitionV1 => ({method,kind:"command",roles,cursor,idempotency:"required",scope});
const query = (method: string, roles: readonly PrincipalRole[], cursor: CursorRequirement, scope: MethodDefinitionV1["scope"]): MethodDefinitionV1 => ({method,kind:"query",roles,cursor,idempotency:"forbidden",scope});
const subscription = (method: string, roles: readonly PrincipalRole[], scope: MethodDefinitionV1["scope"]): MethodDefinitionV1 => ({method,kind:"subscription",roles,cursor:"composite",idempotency:"forbidden",scope});
const spi = (method: string): MethodDefinitionV1 => ({method,kind:"adapter-spi",roles:["adapter"],cursor:"composite",idempotency:"required",scope:"adapter"});
const A=["authority"] as const, AO=["authority","operator"] as const, AA=["authority","approver"] as const, AOW=["authority","operator","worker"] as const, AOWD=["authority","operator","worker","adapter"] as const, ALL=["authority","approver","operator","worker","adapter"] as const;
export const METHOD_REGISTRY_V1 = [
 command("workspace.create.v1",A,"absent-workspace","workspace"), query("workspace.get.v1",ALL,"workspace","workspace"),
 command("run.create.v1",A,"absent-run","run"), query("run.get.v1",ALL,"composite","run"), query("run.list.v1",AO,"workspace","workspace"), query("run.status.v1",ALL,"composite","run"), command("run.close.v1",A,"composite","run"),
 command("task.create.v1",AO,"composite","task"), command("task.update.v1",AO,"composite","task"), command("task.cancel.v1",AO,"composite","task"), command("task.resolve.v1",A,"composite","task"), query("task.get.v1",AOWD,"composite","task"), query("task.list.v1",AO,"composite","run"),
 command("dependency.add.v1",AO,"composite","task"), query("dependency.list.v1",AOW,"composite","task"), query("join.get.v1",AOW,"composite","task"), query("join.list.v1",AO,"composite","run"),
 command("fork.create.v1",AO,"composite","task"), command("fork.refresh.v1",AO,"composite","task"), query("fork.get.v1",AOWD,"composite","task"),
 command("context.materialize.v1",AO,"composite","attempt"), command("context.bind.v1",AO,"composite","attempt"), query("context.get.v1",AOWD,"composite","attempt"),
 command("dispatch.launch.v1",AO,"composite","attempt"), command("dispatch.cancel.v1",AO,"composite","attempt"), command("dispatch.reconcile.v1",AO,"composite","attempt"), command("dispatch.resolveUnknown.v1",A,"composite","attempt"), command("dispatch.authorizeDuplicateRisk.v1",A,"composite","attempt"), query("dispatch.get.v1",AOWD,"composite","attempt"),
 command("artifact.publish.v1",AOWD,"composite","attempt"), query("artifact.get.v1",AOWD,"composite","attempt"),
 command("receipt.submit.v1",["worker","adapter"],"composite","attempt"), query("receipt.get.v1",AOWD,"composite","attempt"),
 command("proposal.submit.v1",["worker","adapter"],"composite","proposal"), query("proposal.get.v1",AOWD,"composite","proposal"), command("proposal.evaluate.v1",A,"composite","proposal"), command("proposal.approve.v1",AA,"composite","proposal"), command("proposal.reject.v1",AA,"composite","proposal"), command("proposal.release.v1",A,"composite","proposal"), command("proposal.rebase.v1",AOW,"composite","proposal"),
 query("admission.decision.v1",AOWD,"composite","proposal"), subscription("admission.subscribe.v1",AOWD,"proposal"), query("admission.history.v1",AOW,"composite","proposal"),
 query("canonical.get.v1",ALL,"composite","run"), query("history.list.v1",AOW,"composite","run"), subscription("history.subscribe.v1",AOW,"run"),
 command("policy.set.v1",A,"workspace","workspace"), query("policy.get.v1",AO,"workspace","workspace"), command("grant.issue.v1",A,"workspace","workspace"), command("grant.delegate.v1",A,"workspace","workspace"), command("grant.revoke.v1",A,"workspace","workspace"), query("grant.list.v1",A,"workspace","workspace"), command("quota.set.v1",A,"workspace","workspace"), query("quota.get.v1",AO,"workspace","workspace"),
 query("adapter.capabilities.v1",["authority","operator","adapter"],"composite","adapter"), spi("adapter.launch.v1"), spi("adapter.cancel.v1"), spi("adapter.reconcile.v1"), spi("adapter.resume.v1"), spi("adapter.reattach.v1"), spi("adapter.injectContext.v1"), spi("adapter.collectReceipt.v1"), spi("adapter.nativePackageMetadata.v1"), spi("adapter.installContributions.v1"), spi("adapter.doctor.v1"), spi("adapter.workerReturn.v1")
] as const satisfies readonly MethodDefinitionV1[];
export type ProtocolMethodV1 = typeof METHOD_REGISTRY_V1[number]["method"];
const registry = new Map<string, MethodDefinitionV1>(METHOD_REGISTRY_V1.map((definition)=>[definition.method,definition]));
if (registry.size !== METHOD_REGISTRY_V1.length) throw new Error("duplicate protocol method");
export function methodDefinition(method:string):MethodDefinitionV1|undefined{return registry.get(method)}
export function isAuthorizedMethod(role:PrincipalRole,method:string):boolean{return registry.get(method)?.roles.includes(role)??false}
