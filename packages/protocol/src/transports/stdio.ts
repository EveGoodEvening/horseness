import {userInfo} from "node:os";
import type {StdioTransportInspectorV1,TransportInspectionV1} from "../spi.js";

export class StdioTransportInspector implements StdioTransportInspectorV1{
 async inspectStdio():Promise<Extract<TransportInspectionV1,{transport:"stdio"}>>{
  const peerIdentity=process.env.USER?.trim()||userInfo().username;
  if(peerIdentity.length===0)throw new Error("Unable to determine inherited stdio peer identity");
  return{transport:"stdio",localOnly:true,peerVerified:true,peerIdentity,processInherited:true};
 }
}
