#!/usr/bin/env node
import {readFile} from "node:fs/promises";
import {resolve} from "node:path";
import {METHOD_REGISTRY_V1,parseJsonRpcRequestV1,ProtocolError,type PrincipalRole} from "../src/index.js";
interface Vector{schemaVersion:"1";cases:{name:string;role:PrincipalRole;request:unknown;outcome:"accept"|string}[]}
const path=resolve(import.meta.dirname,"../../../docs/vectors/protocol/conformance-v1.json");
const vectors=JSON.parse(await readFile(path,"utf8")) as Vector;
if(vectors.schemaVersion!=="1")throw new Error("unsupported vector version");
for(const vector of vectors.cases){let observed="accept";try{parseJsonRpcRequestV1(vector.request,vector.role)}catch(error){observed=error instanceof ProtocolError?error.reasonCode:"unexpected-error"}if(observed!==vector.outcome)throw new Error(`${vector.name}: expected ${vector.outcome}, observed ${observed}`)}
if(new Set(METHOD_REGISTRY_V1.map(({method})=>method)).size!==METHOD_REGISTRY_V1.length)throw new Error("registry is not exhaustive and unique");
console.log(`protocol conformance: ${vectors.cases.length} vectors, ${METHOD_REGISTRY_V1.length} methods`);
