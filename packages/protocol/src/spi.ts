import type {AttemptReceiptEnvelopeV1,JsonValue,ProposalEnvelopeV1} from "@horseness/domain";
import type {PrincipalRole,ProtocolMethodV1} from "./registry.js";

export interface AdapterCapabilitiesV1{schemaVersion:"1";adapterId:string;providerId:string;launch:boolean;cancel:boolean;reconcile:"supported"|"unsupported";reattach:"supported"|"unsupported";nativeResume:"supported"|"unsupported";contextInjection:"bytes"|"file"|"native";receiptCollection:true;maxContextBytes:number;outputMediaTypes:string[];evidenceMediaTypes:string[]}
export interface BoundAdapterOperationV1{schemaVersion:"1";workspaceId:string;runId:string;taskId:string;attemptId:string;generation:number;forkPinDigest:string;contextManifestCoreDigest:string;attemptContextBindingDigest:string;providerIdempotencyKeyDigest:string;attemptCapability:string}
export interface AdapterLaunchRequestV1 extends BoundAdapterOperationV1{operation:"launch";renderedContextDigest:string;providerOptions:JsonValue}
export interface AdapterCancelRequestV1 extends BoundAdapterOperationV1{operation:"cancel";providerOperationId:string;cancelIdempotencyKey:string}
export interface AdapterReconcileRequestV1 extends BoundAdapterOperationV1{operation:"reconcile";providerOperationId:string|null}
export interface AdapterResumeRequestV1 extends BoundAdapterOperationV1{operation:"resume"|"reattach";providerOperationId:string;nativeSessionId:string|null}
export type AdapterOperationResultV1={schemaVersion:"1";status:"accepted"|"found"|"not-found"|"unsupported"|"ambiguous";providerOperationId:string|null;nativeSessionId:string|null;details:JsonValue};
export interface WorkerReturnV1{schemaVersion:"1";binding:BoundAdapterOperationV1;receipt:AttemptReceiptEnvelopeV1;proposal:ProposalEnvelopeV1;publishedObjectDigests:string[];decisionResume:{proposalId:string;proposalDigest:string;subscriptionId:string;resumeToken:string|null}}
export interface CapabilityProviderV1{detectCapabilities():Promise<AdapterCapabilitiesV1>}
export interface WorkerAdapterV1 extends CapabilityProviderV1{launch(request:AdapterLaunchRequestV1):Promise<AdapterOperationResultV1>;cancel(request:AdapterCancelRequestV1):Promise<AdapterOperationResultV1>;reconcile(request:AdapterReconcileRequestV1):Promise<AdapterOperationResultV1>;resume(request:AdapterResumeRequestV1):Promise<AdapterOperationResultV1>;collectReceipt(binding:BoundAdapterOperationV1):Promise<AttemptReceiptEnvelopeV1>}
export interface NativePackageMetadataV1{schemaVersion:"1";adapterId:string;adapterVersion:string;hostId:string;hostVersionRange:string;packageDigest:string;contributions:readonly {kind:string;name:string;digest:string}[]}
export interface DoctorProbeResultV1{schemaVersion:"1";checks:readonly {code:string;status:"ok"|"warning"|"error";evidenceDigest:string|null}[];restartRequired:boolean}

/** Output of privileged OS inspection, never JSON supplied by an RPC peer. */
export type TransportInspectionV1=
 |{readonly transport:"stdio";readonly localOnly:true;readonly peerVerified:true;readonly peerIdentity:string;readonly processInherited:true}
 |{readonly transport:"unix-socket";readonly localOnly:true;readonly peerVerified:boolean;readonly peerIdentity:string|null;readonly endpointPath:string;readonly realPath:string;readonly endpointType:"socket"|"other";readonly isSymbolicLink:boolean;readonly ownerMatchesProcess:boolean;readonly mode:number;readonly parentPath:string;readonly parentRealPath:string;readonly parentType:"directory"|"other";readonly parentIsSymbolicLink:boolean;readonly parentOwnerMatchesProcess:boolean;readonly parentMode:number}
 |{readonly transport:"windows-named-pipe";readonly localOnly:true;readonly peerVerified:boolean;readonly peerIdentity:string|null;readonly ownerMatchesProcess:boolean;readonly ownerOnlyDacl:boolean;readonly daclInheriting:boolean}
 |{readonly transport:"tcp";readonly localOnly:boolean;readonly peerVerified:boolean;readonly peerIdentity:string|null};

export interface StdioTransportInspectorV1{inspectStdio():Promise<Extract<TransportInspectionV1,{transport:"stdio"}>>}
export interface UnixSocketTransportInspectorV1{inspectUnixSocket(endpointPath:string):Promise<Extract<TransportInspectionV1,{transport:"unix-socket"}>>}
export interface WindowsPipeTransportInspectorV1{inspectWindowsPipe(pipeName:string):Promise<Extract<TransportInspectionV1,{transport:"windows-named-pipe"}>>}
export interface TransportInspectorsV1{stdio:StdioTransportInspectorV1;unixSocket:UnixSocketTransportInspectorV1;windowsPipe:WindowsPipeTransportInspectorV1}

/** Authoritative grant-store result bound to the inspected OS peer. */
export interface AuthenticatedGrantV1{
 readonly schemaVersion:"1";readonly principalId:string;readonly principalRole:PrincipalRole;readonly grantDigest:string;readonly peerIdentity:string;readonly expiresAt:string;readonly revoked:boolean;
 readonly workspaceId:string;readonly runId:string|null;readonly taskId:string|null;readonly attemptId:string|null;readonly generation:number|null;readonly proposalId:string|null;readonly adapterId:string|null;
 readonly allowedMethods:readonly ProtocolMethodV1[];
}
export interface GrantLookupV1{lookupActiveGrant(peerIdentity:string,grantReference:string):Promise<AuthenticatedGrantV1|null>}
