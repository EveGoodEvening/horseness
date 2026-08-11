import type {JsonValue} from "@horseness/domain";
import type {ProtocolReasonCode} from "./wire.js";

export const PROTOCOL_RPC_CODES:Readonly<Record<ProtocolReasonCode,number>>={
 PARSE_ERROR:-32700,INVALID_REQUEST:-32600,METHOD_NOT_FOUND:-32601,METHOD_NOT_AUTHORIZED:-32001,INVALID_PARAMS:-32602,UNSUPPORTED_PROTOCOL_VERSION:-32002,CURSOR_SCOPE_INSUFFICIENT:-32003,
 IDEMPOTENCY_REQUIRED:-32004,IDEMPOTENCY_FORBIDDEN:-32005,STALE_OBSERVATION:-32006,RESUME_TOKEN_INVALID:-32007,RESUME_TOKEN_EXPIRED:-32008,RESUME_CURSOR_MISMATCH:-32009,
 AUTH_CONTEXT_REQUIRED:-32010,AUTH_SCOPE_MISMATCH:-32011,GRANT_INVALID:-32012,GRANT_EXPIRED:-32013,TRANSPORT_NOT_ALLOWED:-32014,TRANSPORT_OWNER_INVALID:-32015,TRANSPORT_PERMISSIONS_INVALID:-32016,PEER_IDENTITY_INVALID:-32017,UNTRUSTED_SECURITY_METADATA:-32018,
 INTERNAL_ERROR:-32603
};
export class ProtocolError extends Error{
 constructor(readonly reasonCode:ProtocolReasonCode,readonly rpcCode=PROTOCOL_RPC_CODES[reasonCode],readonly retryable=false,readonly details:JsonValue|null=null){super(reasonCode);this.name="ProtocolError"}
}
export function protocolError(reasonCode:ProtocolReasonCode,retryable=false,details:JsonValue|null=null):ProtocolError{return new ProtocolError(reasonCode,PROTOCOL_RPC_CODES[reasonCode],retryable,details)}
