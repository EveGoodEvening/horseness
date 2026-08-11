import {parseDomainCommandV1,parseDomainCommandResultV1,parseDomainQueryV1,parseQueryResultV1,verifyAttemptReceipt,verifyProposal,type AttemptReceiptEnvelopeV1,type DomainCommandResultV1,type DomainCommandV1,type DomainQueryV1,type ProposalEnvelopeV1,type QueryResultV1} from "@horseness/domain";
import {ProtocolError} from "./errors.js";
export type DomainWireMappingV1=
 |{mapping:"domain-command";value:DomainCommandV1}
 |{mapping:"domain-command-result";value:DomainCommandResultV1}
 |{mapping:"domain-query";value:DomainQueryV1}
 |{mapping:"domain-query-result";value:QueryResultV1}
 |{mapping:"attempt-receipt";value:AttemptReceiptEnvelopeV1}
 |{mapping:"proposal-envelope";value:ProposalEnvelopeV1};
export function parseDomainWireMappingV1(mapping:DomainWireMappingV1["mapping"],value:unknown):DomainWireMappingV1{try{switch(mapping){case"domain-command":return{mapping,value:parseDomainCommandV1(value)};case"domain-command-result":return{mapping,value:parseDomainCommandResultV1(value)};case"domain-query":return{mapping,value:parseDomainQueryV1(value)};case"domain-query-result":return{mapping,value:parseQueryResultV1(value)};case"attempt-receipt":verifyAttemptReceipt(value as AttemptReceiptEnvelopeV1);return{mapping,value:value as AttemptReceiptEnvelopeV1};case"proposal-envelope":verifyProposal(value as ProposalEnvelopeV1);return{mapping,value:value as ProposalEnvelopeV1};default:throw new ProtocolError("UNSUPPORTED_PROTOCOL_VERSION",-32002)}}catch(error){if(error instanceof ProtocolError)throw error;throw new ProtocolError("INVALID_PARAMS",-32602,false,{mapping} as never)}}
export const DOMAIN_MAPPING_NAMES_V1=["domain-command","domain-command-result","domain-query","domain-query-result","attempt-receipt","proposal-envelope"] as const;
