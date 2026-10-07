import { randomUUID } from "node:crypto";
import { domainDigest, type JsonValue } from "@horseness/domain";
import { METHOD_REGISTRY_V1, protocolError, type AuthenticatedGrantV1, type GrantLookupV1, type PrincipalRole, type ProtocolMethodV1 } from "@horseness/protocol";
import { StoreConflictError, type AuthorityStateExpectationV1, type AuthorityStateRecordV1, type SQLiteAuthority } from "@horseness/store-sqlite";

export interface IssueGrantV1 { readonly peerIdentity:string; readonly principalId:string; readonly principalRole:PrincipalRole; readonly workspaceId:string; readonly runId?:string; readonly taskId?:string; readonly attemptId?:string; readonly generation?:number; readonly proposalId?:string; readonly adapterId?:string; readonly allowedMethods:readonly ProtocolMethodV1[]; readonly expiresAt:string }
interface StoredGrantV1 extends AuthenticatedGrantV1 { readonly grantReference:string; readonly parentGrantDigest:string|null }
interface GrantAuthorityStateV1 { readonly schemaVersion:"1"; readonly grants:readonly StoredGrantV1[]; readonly issuances?:Readonly<Record<string,{readonly requestDigest:string;readonly grantDigest:string;readonly issuedAt:string}>> }
export interface GrantAuthorityObservationV1 { readonly grant:AuthenticatedGrantV1; readonly expectation:AuthorityStateExpectationV1 }
export const GRANT_AUTHORITY_STATE_KIND="local-grants-v1";

function parseState(record:AuthorityStateRecordV1):GrantAuthorityStateV1 {
  const value=record.state;
  if(typeof value!=="object"||value===null||Array.isArray(value)||value.schemaVersion!=="1"||!Array.isArray(value.grants))throw new Error("grant authority state invalid");
  const references=new Set<string>();const digests=new Set<string>();
  for(const item of value.grants){if(typeof item!=="object"||item===null||Array.isArray(item)||typeof item.grantReference!=="string"||typeof item.grantDigest!=="string"||typeof item.peerIdentity!=="string"||typeof item.principalId!=="string"||typeof item.expiresAt!=="string"||typeof item.workspaceId!=="string"||!Array.isArray(item.allowedMethods)||references.has(item.grantReference)||digests.has(item.grantDigest))throw new Error("grant authority entry invalid");const {grantReference:_reference,parentGrantDigest:_parent,grantDigest,revoked:_revoked,...core}=item as unknown as StoredGrantV1;void _reference;void _parent;void _revoked;if(domainDigest("horseness.daemon-grant.v1",core as unknown as JsonValue)!==grantDigest)throw new Error("grant digest authentication failed");references.add(item.grantReference);digests.add(item.grantDigest);}
  if(value.issuances!==undefined){
    if(value.issuances===null||typeof value.issuances!=="object"||Array.isArray(value.issuances))throw new Error("grant issuance state invalid");
    for(const entry of Object.values(value.issuances))if(entry===null||typeof entry!=="object"||Array.isArray(entry)||typeof entry.requestDigest!=="string"||typeof entry.grantDigest!=="string"||!digests.has(entry.grantDigest)||typeof entry.issuedAt!=="string"||!Number.isFinite(Date.parse(entry.issuedAt)))throw new Error("grant issuance record invalid");
  }
  return value as unknown as GrantAuthorityStateV1;
}

export class GrantStore implements GrantLookupV1 {
  constructor(private readonly authority:SQLiteAuthority,private readonly workspaceId:string,private readonly authorityTime:()=>string) {}
  static initialState(grantReference:string,grant:AuthenticatedGrantV1):GrantAuthorityStateV1{return Object.freeze({schemaVersion:"1",grants:[Object.freeze({...grant,grantReference,parentGrantDigest:null})]});}
  private current():{record:AuthorityStateRecordV1;state:GrantAuthorityStateV1}{const record=this.authority.authenticatedAuthorityState(this.workspaceId,GRANT_AUTHORITY_STATE_KIND);return{record,state:parseState(record)};}
  private replace(record:AuthorityStateRecordV1,state:GrantAuthorityStateV1):void{this.authority.compareAndSwapAuthorityState({commandId:`grant-state:${randomUUID()}`,workspaceId:this.workspaceId,stateKind:GRANT_AUTHORITY_STATE_KIND,expectedRevision:record.revision,expectedStateDigest:record.stateDigest,nextState:state as unknown as JsonValue});}
  private activeInLineage(state:GrantAuthorityStateV1,grant:StoredGrantV1):boolean {
    const seen=new Set<string>(),now=Date.parse(this.authorityTime());
    if(!Number.isFinite(now))return false;
    let current:StoredGrantV1|undefined=grant;
    while(current){
      const expiry=Date.parse(current.expiresAt);
      if(current.revoked||!Number.isFinite(expiry)||expiry<=now||seen.has(current.grantDigest))return false;
      if(current.parentGrantDigest===null)return true;
      const parentDigest:string=current.parentGrantDigest;
      seen.add(current.grantDigest);current=state.grants.find(item=>item.grantDigest===parentDigest);
    }
    return false;
  }
  private assertMutationAuthority(record:AuthorityStateRecordV1,state:GrantAuthorityStateV1,authorization?:GrantAuthorityObservationV1):void {
    if(!authorization)return;
    const expected=authorization.expectation;
    if(expected.stateKind!==record.stateKind||expected.revision!==record.revision||expected.stateDigest!==record.stateDigest)throw new StoreConflictError("grant authority observation compare-and-swap conflict");
    const issuer=state.grants.find(item=>item.grantDigest===authorization.grant.grantDigest);
    if(!issuer||!this.activeInLineage(state,issuer))throw protocolError("GRANT_INVALID");
  }
  issue(input:IssueGrantV1,parentGrantDigest:string|null=null,operation?:{readonly id:string;readonly requestDigest:string},authorization?:GrantAuthorityObservationV1):{readonly grantReference:string;readonly grant:AuthenticatedGrantV1;readonly issuedAt:string}{
    if(input.workspaceId!==this.workspaceId)throw new Error("cross-workspace grant denied");
    const {record,state}=this.current();
    this.assertMutationAuthority(record,state,authorization);
    if(operation){
      if(!operation.id||!operation.requestDigest)throw protocolError("INVALID_PARAMS");
      const prior=state.issuances&&Object.hasOwn(state.issuances,operation.id)?state.issuances[operation.id]:undefined;
      if(prior){
        if(prior.requestDigest!==operation.requestDigest)throw protocolError("INVALID_PARAMS");
        const stored=state.grants.find(item=>item.grantDigest===prior.grantDigest);
        if(!stored)throw new Error("grant issuance target is missing");
        const {grantReference,parentGrantDigest:_parent,...grant}=stored; void _parent;
        return Object.freeze({grantReference,grant:Object.freeze(grant),issuedAt:prior.issuedAt});
      }
    }
    const allowed=[...new Set(input.allowedMethods)].sort();
    if(parentGrantDigest!==null){const parent=state.grants.find(item=>item.grantDigest===parentGrantDigest);if(!parent||!this.activeInLineage(state,parent))throw protocolError("GRANT_INVALID");}
    if(allowed.length===0||allowed.some(method=>!METHOD_REGISTRY_V1.some(definition=>definition.method===method)))throw new Error("grant contains unsupported methods");
    const issuedAt=this.authorityTime(),expires=Date.parse(input.expiresAt);
    if(!Number.isFinite(expires)||expires<=Date.parse(issuedAt))throw new Error("grant expiry is stale");
    const digestCore={schemaVersion:"1",principalId:input.principalId,principalRole:input.principalRole,peerIdentity:input.peerIdentity,expiresAt:input.expiresAt,workspaceId:input.workspaceId,runId:input.runId??null,taskId:input.taskId??null,attemptId:input.attemptId??null,generation:input.generation??null,proposalId:input.proposalId??null,adapterId:input.adapterId??null,allowedMethods:allowed} as const;
    const grant=Object.freeze({...digestCore,revoked:false,grantDigest:domainDigest("horseness.daemon-grant.v1",digestCore as unknown as JsonValue)});
    const existing=state.grants.find(item=>item.grantDigest===grant.grantDigest);
    if(existing&&(existing.revoked||existing.parentGrantDigest!==parentGrantDigest))throw protocolError("GRANT_INVALID");
    const grantReference=existing?.grantReference??`grant:${randomUUID()}`;
    const grants=existing?state.grants:[...state.grants,Object.freeze({...grant,grantReference,parentGrantDigest})];
    const next:GrantAuthorityStateV1={...state,grants,...(operation?{issuances:{...state.issuances,[operation.id]:{requestDigest:operation.requestDigest,grantDigest:grant.grantDigest,issuedAt}}}:{})};
    if(!existing||operation)this.replace(record,Object.freeze(next));
    return Object.freeze({grantReference,grant,issuedAt});
  }
  revoke(grantReference:string,authorization?:GrantAuthorityObservationV1):boolean{const {record,state}=this.current();this.assertMutationAuthority(record,state,authorization);const existing=state.grants.find(grant=>grant.grantReference===grantReference);if(existing===undefined||existing.revoked)return false;this.replace(record,Object.freeze({...state,grants:state.grants.map(grant=>grant.grantReference===grantReference?Object.freeze({...grant,revoked:true}):grant)}));return true;}
  referenceForDigest(grantDigest:string):string|null{return this.current().state.grants.find(grant=>grant.grantDigest===grantDigest)?.grantReference??null;}
  observe(grantDigest:string):GrantAuthorityObservationV1|null {
    const {record,state}=this.current();
    const stored=state.grants.find(item=>item.grantDigest===grantDigest);
    if(!stored||!this.activeInLineage(state,stored))return null;
    const {grantReference:_reference,parentGrantDigest:_parent,...grant}=stored; void _reference; void _parent;
    return Object.freeze({grant:Object.freeze(grant),expectation:{stateKind:record.stateKind,revision:record.revision,stateDigest:record.stateDigest}});
  }
  activeByDigest(grantDigest:string):AuthenticatedGrantV1|null{return this.observe(grantDigest)?.grant??null;}
  async lookupActiveGrant(peerIdentity:string,grantReference:string):Promise<AuthenticatedGrantV1|null>{const {state}=this.current();const grant=state.grants.find(item=>item.grantReference===grantReference&&item.peerIdentity===peerIdentity);if(!grant||!this.activeInLineage(state,grant))return null;const {grantReference:_reference,parentGrantDigest:_parent,...authenticated}=grant;void _reference;void _parent;return await Promise.resolve(Object.freeze(authenticated));}
  list(principalId?:string):readonly AuthenticatedGrantV1[]{return this.current().state.grants.filter(grant=>principalId===undefined||grant.principalId===principalId).map(({grantReference:_reference,parentGrantDigest:_parent,...grant})=>{void _reference;void _parent;return Object.freeze(grant);});}
}
