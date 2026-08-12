import { randomUUID } from "node:crypto";
import { domainDigest, type JsonValue } from "@horseness/domain";
import { METHOD_REGISTRY_V1, type AuthenticatedGrantV1, type GrantLookupV1, type PrincipalRole, type ProtocolMethodV1 } from "@horseness/protocol";
import type { AuthorityStateRecordV1, SQLiteAuthority } from "@horseness/store-sqlite";

export interface IssueGrantV1 { readonly peerIdentity:string; readonly principalId:string; readonly principalRole:PrincipalRole; readonly workspaceId:string; readonly runId?:string; readonly taskId?:string; readonly attemptId?:string; readonly generation?:number; readonly proposalId?:string; readonly adapterId?:string; readonly allowedMethods:readonly ProtocolMethodV1[]; readonly expiresAt:string }
interface StoredGrantV1 extends AuthenticatedGrantV1 { readonly grantReference:string; readonly parentGrantDigest:string|null }
interface GrantAuthorityStateV1 { readonly schemaVersion:"1"; readonly grants:readonly StoredGrantV1[] }
export const GRANT_AUTHORITY_STATE_KIND="local-grants-v1";

function parseState(record:AuthorityStateRecordV1):GrantAuthorityStateV1 {
  const value=record.state;
  if(typeof value!=="object"||value===null||Array.isArray(value)||value.schemaVersion!=="1"||!Array.isArray(value.grants))throw new Error("grant authority state invalid");
  const references=new Set<string>();const digests=new Set<string>();
  for(const item of value.grants){if(typeof item!=="object"||item===null||Array.isArray(item)||typeof item.grantReference!=="string"||typeof item.grantDigest!=="string"||typeof item.peerIdentity!=="string"||typeof item.principalId!=="string"||typeof item.expiresAt!=="string"||typeof item.workspaceId!=="string"||!Array.isArray(item.allowedMethods)||references.has(item.grantReference)||digests.has(item.grantDigest))throw new Error("grant authority entry invalid");const {grantReference:_reference,parentGrantDigest:_parent,grantDigest,revoked:_revoked,...core}=item as unknown as StoredGrantV1;if(domainDigest("horseness.daemon-grant.v1",core as unknown as JsonValue)!==grantDigest)throw new Error("grant digest authentication failed");references.add(item.grantReference);digests.add(item.grantDigest);}
  return value as unknown as GrantAuthorityStateV1;
}

export class GrantStore implements GrantLookupV1 {
  constructor(private readonly authority:SQLiteAuthority,private readonly workspaceId:string,private readonly authorityTime:()=>string) {}
  static initialState(grantReference:string,grant:AuthenticatedGrantV1):GrantAuthorityStateV1{return Object.freeze({schemaVersion:"1",grants:[Object.freeze({...grant,grantReference,parentGrantDigest:null})]});}
  private current():{record:AuthorityStateRecordV1;state:GrantAuthorityStateV1}{const record=this.authority.authenticatedAuthorityState(this.workspaceId,GRANT_AUTHORITY_STATE_KIND);return{record,state:parseState(record)};}
  private replace(record:AuthorityStateRecordV1,state:GrantAuthorityStateV1):void{this.authority.compareAndSwapAuthorityState({commandId:`grant-state:${randomUUID()}`,workspaceId:this.workspaceId,stateKind:GRANT_AUTHORITY_STATE_KIND,expectedRevision:record.revision,expectedStateDigest:record.stateDigest,nextState:state as unknown as JsonValue});}
  issue(input:IssueGrantV1,parentGrantDigest:string|null=null):{readonly grantReference:string;readonly grant:AuthenticatedGrantV1}{
    if(input.workspaceId!==this.workspaceId)throw new Error("cross-workspace grant denied");const allowed=[...new Set(input.allowedMethods)].sort();if(allowed.length===0||allowed.some(method=>!METHOD_REGISTRY_V1.some(definition=>definition.method===method)))throw new Error("grant contains unsupported methods");if(Date.parse(input.expiresAt)<=Date.parse(this.authorityTime()))throw new Error("grant expiry is stale");
    const grantReference=`grant:${randomUUID()}`;const digestCore={schemaVersion:"1",principalId:input.principalId,principalRole:input.principalRole,peerIdentity:input.peerIdentity,expiresAt:input.expiresAt,workspaceId:input.workspaceId,runId:input.runId??null,taskId:input.taskId??null,attemptId:input.attemptId??null,generation:input.generation??null,proposalId:input.proposalId??null,adapterId:input.adapterId??null,allowedMethods:allowed} as const;const grant=Object.freeze({...digestCore,revoked:false,grantDigest:domainDigest("horseness.daemon-grant.v1",digestCore as unknown as JsonValue)});const {record,state}=this.current();this.replace(record,Object.freeze({schemaVersion:"1",grants:[...state.grants,Object.freeze({...grant,grantReference,parentGrantDigest})]}));return Object.freeze({grantReference,grant});
  }
  revoke(grantReference:string):boolean{const {record,state}=this.current();const existing=state.grants.find(grant=>grant.grantReference===grantReference);if(existing===undefined||existing.revoked)return false;this.replace(record,Object.freeze({schemaVersion:"1",grants:state.grants.map(grant=>grant.grantReference===grantReference?Object.freeze({...grant,revoked:true}):grant)}));return true;}
  referenceForDigest(grantDigest:string):string|null{return this.current().state.grants.find(grant=>grant.grantDigest===grantDigest)?.grantReference??null;}
  activeByDigest(grantDigest:string):AuthenticatedGrantV1|null{const grant=this.current().state.grants.find(item=>item.grantDigest===grantDigest);if(grant===undefined||grant.revoked||Date.parse(grant.expiresAt)<=Date.parse(this.authorityTime()))return null;const {grantReference:_reference,parentGrantDigest:_parent,...active}=grant;return Object.freeze(active);}
  async lookupActiveGrant(peerIdentity:string,grantReference:string):Promise<AuthenticatedGrantV1|null>{const grant=this.current().state.grants.find(item=>item.grantReference===grantReference&&item.peerIdentity===peerIdentity);if(grant===undefined||grant.revoked||Date.parse(grant.expiresAt)<=Date.parse(this.authorityTime()))return null;const {grantReference:_reference,parentGrantDigest:_parent,...authenticated}=grant;return Object.freeze(authenticated);}
  list(principalId?:string):readonly AuthenticatedGrantV1[]{return this.current().state.grants.filter(grant=>principalId===undefined||grant.principalId===principalId).map(({grantReference:_reference,parentGrantDigest:_parent,...grant})=>Object.freeze(grant));}
}
