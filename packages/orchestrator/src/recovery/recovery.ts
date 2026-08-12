import { canonicalJson, domainDigest, DomainError, type JsonValue } from "@horseness/domain";
import { assertImmutableBinding, isBoundAttempt, rehydrateBoundAttempt, type BoundAttemptV1 } from "../attempts/attempts.js";
import { assertDispatchBinding, handoffCancellation, isDispatchRecord, lookupDispatch, recordLookupFailure, recordProviderHandle, rehydrateDispatchRecord, requestDispatchCancellation, type DispatchRecordV1, type ProviderAdapterV1 } from "../dispatch/dispatch.js";
import { assertLeaseFence, rehydrateLeaseFence, type LeaseFenceV1 } from "../leases/leases.js";

export type RecoveryClassificationV1="NO_ACTION"|"REATTACH"|"ADOPT"|"RELAUNCH_IDEMPOTENT"|"UNKNOWN_OUTCOME"|"DUPLICATE_RISK_REQUIRED"|"CANCEL_HANDED_OFF"|"CANCEL_RECONCILE"|"TERMINAL_AUDIT_ONLY";
export type RecoveryLookupOutcomeV1="not_needed"|"found"|"not_found"|"unsupported"|"unknown";
export interface RecoveryActionV1 {readonly schemaVersion:"1";readonly attemptId:string;readonly generation:number;readonly bindingDigest:string;readonly fenceToken:number;readonly lookupOutcome:RecoveryLookupOutcomeV1;readonly classification:RecoveryClassificationV1;readonly operationId:string|null;readonly providerHandle:string|null;readonly cancellationRequested:boolean;readonly duplicateRisk:boolean;readonly actionDigest:string}
export interface RecoveryResultV1 {readonly record:DispatchRecordV1;readonly action:RecoveryActionV1}
export interface SerializedRecoveryStateV1 {readonly attempt:BoundAttemptV1;readonly lease:LeaseFenceV1;readonly record:DispatchRecordV1}
const terminal=(phase:DispatchRecordV1["phase"]):boolean=>phase==="succeeded"||phase==="failed"||phase==="cancelled";
function action(input:Omit<RecoveryActionV1,"schemaVersion"|"actionDigest">):RecoveryActionV1{const core={schemaVersion:"1" as const,...input};return Object.freeze({...core,actionDigest:domainDigest("horseness.recovery-action.v1",core as unknown as JsonValue)});}
function result(record:DispatchRecordV1,lease:LeaseFenceV1,lookupOutcome:RecoveryLookupOutcomeV1,classification:RecoveryClassificationV1,duplicateRisk=false):RecoveryResultV1{return{record,action:action({attemptId:record.attemptId,generation:record.generation,bindingDigest:record.bindingDigest,fenceToken:lease.fenceToken,lookupOutcome,classification,operationId:record.operationId,providerHandle:record.providerHandle,cancellationRequested:record.cancellationRequested,duplicateRisk})};}
function guard(input:{record:DispatchRecordV1;attempt:BoundAttemptV1;lease:LeaseFenceV1;ownerId:string;fenceToken:number;now:string}):void{if(!isDispatchRecord(input.record)||!isBoundAttempt(input.attempt))throw new DomainError("RECOVERY_STATE_UNTRUSTED");assertDispatchBinding(input.record,input.attempt);assertLeaseFence(input.attempt,input.lease,input.ownerId,input.fenceToken,input.now);}
/** Authenticate durable JSON state before exposing it to the capability-based recovery reducer. */
export function rehydrateRecoveryState(value:SerializedRecoveryStateV1):SerializedRecoveryStateV1{if(value===null||typeof value!=="object"||Array.isArray(value))throw new DomainError("RECOVERY_STATE_SCHEMA_INVALID");const attempt=rehydrateBoundAttempt(value.attempt),lease=rehydrateLeaseFence(value.lease),record=rehydrateDispatchRecord(value.record);assertDispatchBinding(record,attempt);if(lease.attemptId!==attempt.attemptId||lease.generation!==attempt.generation||lease.bindingDigest!==attempt.bindingDigest)throw new DomainError("RECOVERY_STATE_BINDING_MISMATCH");return Object.freeze({attempt,lease,record});}
/** Deterministically reconcile one durable attempt generation after restart. Provider calls are always lease-fenced. */
export function recoverDispatch(input:{record:DispatchRecordV1;attempt:BoundAttemptV1;lease:LeaseFenceV1;ownerId:string;fenceToken:number;now:string;adapter:ProviderAdapterV1}):RecoveryResultV1{
 guard(input);let record=input.record;
 if(terminal(record.phase))return result(record,input.lease,"not_needed","TERMINAL_AUDIT_ONLY");
 if(record.phase==="planned")return result(record,input.lease,"not_needed",record.cancellationRequested?"CANCEL_RECONCILE":"NO_ACTION");
 if(record.phase==="unknown_outcome")return result(record,input.lease,"not_needed","DUPLICATE_RISK_REQUIRED",true);
 if(record.cancellationRequested){try{record=handoffCancellation(record,input.adapter);return result(record,input.lease,"not_needed",record.phase==="cancel_handed_off"?"CANCEL_HANDED_OFF":"CANCEL_RECONCILE");}catch{return result(record,input.lease,"unknown","CANCEL_RECONCILE",true);}}
 const priorOperation=record.operationId,priorHandle=record.providerHandle;
 try{record=lookupDispatch(record,input.adapter);}catch{record=recordLookupFailure(record);return result(record,input.lease,"unknown","DUPLICATE_RISK_REQUIRED",true);}
 const last=record.events.at(-1)?.eventType;
 if(record.providerHandle){const classification=priorHandle===record.providerHandle?"REATTACH":"ADOPT";return result(record,input.lease,"found",classification);}
 if(last==="DispatchLookupNotFoundV1")return result(record,input.lease,"not_found","RELAUNCH_IDEMPOTENT");
 if(last==="DispatchLookupUnsupportedV1")return result(record,input.lease,"unsupported","DUPLICATE_RISK_REQUIRED",true);
 if(record.phase==="unknown_outcome"||priorOperation)return result(record,input.lease,"not_found","DUPLICATE_RISK_REQUIRED",true);
 return result(record,input.lease,"unknown","UNKNOWN_OUTCOME",true);
}
/** Propagate durable attempt cancellation without launching or changing its immutable binding. */
export function recoverCancellation(input:{record:DispatchRecordV1;attempt:BoundAttemptV1;lease:LeaseFenceV1;ownerId:string;fenceToken:number;now:string;adapter:ProviderAdapterV1}):RecoveryResultV1{guard(input);const record=requestDispatchCancellation(input.record);return recoverDispatch({...input,record});}
/** Validate a late provider handle. Terminal generations retain their selected result; the observation is audit-only. */
export function auditLateHandle(input:{record:DispatchRecordV1;attempt:BoundAttemptV1;operationId:string;handle:string}):RecoveryResultV1{
 assertDispatchBinding(input.record,input.attempt);if(!terminal(input.record.phase))return{record:recordProviderHandle(input.record,{operationId:input.operationId,handle:input.handle}),action:action({attemptId:input.record.attemptId,generation:input.record.generation,bindingDigest:input.record.bindingDigest,fenceToken:0,lookupOutcome:"found",classification:input.record.providerHandle?"REATTACH":"ADOPT",operationId:input.operationId,providerHandle:input.handle,cancellationRequested:input.record.cancellationRequested,duplicateRisk:false})};
 const mismatch=input.record.operationId!==null&&input.record.operationId!==input.operationId||input.record.providerHandle!==null&&input.record.providerHandle!==input.handle;
 return{record:input.record,action:action({attemptId:input.record.attemptId,generation:input.record.generation,bindingDigest:input.record.bindingDigest,fenceToken:0,lookupOutcome:"found",classification:"TERMINAL_AUDIT_ONLY",operationId:input.operationId,providerHandle:input.handle,cancellationRequested:input.record.cancellationRequested,duplicateRisk:mismatch})};
}
/** A retry/duplicate-risk launch must be a fresh generation with a newly authenticated binding and key. */
export function assertRecoveryGenerationRefresh(prior:BoundAttemptV1,next:BoundAttemptV1):void{if(!isBoundAttempt(prior)||!isBoundAttempt(next)||prior.attemptId!==next.attemptId||next.generation!==prior.generation+1||next.priorGeneration!==prior.generation||next.bindingDigest===prior.bindingDigest||next.forkPinDigest===prior.forkPinDigest||next.authorizationKey===prior.authorizationKey||canonicalJson(next.binding as unknown as JsonValue)===canonicalJson(prior.binding as unknown as JsonValue))throw new DomainError("RECOVERY_GENERATION_NOT_REFRESHED");assertImmutableBinding(next,next);}
