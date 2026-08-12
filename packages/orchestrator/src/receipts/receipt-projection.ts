import { DomainError, verifyAttemptReceipt, type AttemptReceiptEnvelopeV1, type AttemptTerminalState } from "@horseness/domain";

export interface ReceiptGenerationOutcomeV1 { generation:number; outcome:AttemptTerminalState; receiptDigest:string; receiptId:string; terminalEventSequence:number }
export interface AttemptReceiptProjectionV1 { attemptId:string; outcomes:ReadonlyMap<number,ReceiptGenerationOutcomeV1>; winningGeneration:number|null; findings:readonly string[] }
export function emptyReceiptProjection(attemptId:string):AttemptReceiptProjectionV1 { if(!attemptId)throw new DomainError("INVALID_ATTEMPT_STATE");return {attemptId,outcomes:new Map(),winningGeneration:null,findings:[]}; }
export function projectReceipt(state:AttemptReceiptProjectionV1,receipt:AttemptReceiptEnvelopeV1,eventSequence:number):AttemptReceiptProjectionV1 {
  verifyAttemptReceipt(receipt); if(receipt.attemptId!==state.attemptId||eventSequence<1)throw new DomainError("RECEIPT_MISMATCH");
  const outcomes=new Map(state.outcomes); const prior=outcomes.get(receipt.generation); const findings=[...state.findings];
  if(prior){ if(prior.receiptDigest===receipt.receiptDigest)return {...state,findings:[...new Set([...findings,"DUPLICATE_RECEIPT"])].sort()}; return {...state,findings:[...new Set([...findings,"CONFLICTING_GENERATION_RECEIPT"])].sort()}; }
  outcomes.set(receipt.generation,{generation:receipt.generation,outcome:receipt.outcome,receiptDigest:receipt.receiptDigest,receiptId:receipt.receiptId,terminalEventSequence:eventSequence});
  const successes=[...outcomes.values()].filter(item=>item.outcome==="succeeded").sort((a,b)=>a.terminalEventSequence-b.terminalEventSequence||a.generation-b.generation);
  const winningGeneration=successes[0]?.generation??null;
  if(winningGeneration!==null&&receipt.generation!==winningGeneration)findings.push("LATE_GENERATION_RECEIPT");
  return {attemptId:state.attemptId,outcomes,winningGeneration,findings:[...new Set(findings)].sort()};
}
