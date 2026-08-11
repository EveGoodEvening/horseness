import type {JsonValue} from "@horseness/domain";
import type {ProtocolReasonCode} from "./wire.js";
export class ProtocolError extends Error{constructor(readonly reasonCode:ProtocolReasonCode,readonly rpcCode:number,readonly retryable=false,readonly details:JsonValue|null=null){super(reasonCode)}}
