import {lstat,realpath,stat} from "node:fs/promises";
import {dirname,resolve} from "node:path";
import type {TransportInspectionV1,UnixSocketTransportInspectorV1} from "../spi.js";

export class UnixSocketTransportInspector implements UnixSocketTransportInspectorV1{
 async inspectUnixSocket(endpointPath:string):Promise<Extract<TransportInspectionV1,{transport:"unix-socket"}>>{
  const absolute=resolve(endpointPath),parentPath=dirname(absolute);
  const [endpointLink,parentLink]=await Promise.all([lstat(absolute),lstat(parentPath)]);
  const [endpointRealPath,parentRealPath]=await Promise.all([realpath(absolute),realpath(parentPath)]);
  const [endpointStats,parentStats]=await Promise.all([stat(absolute),stat(parentPath)]);
  const processUid=typeof process.getuid==="function"?process.getuid():null;
  return{
   transport:"unix-socket",localOnly:true,
   peerVerified:false,
   peerIdentity:null,
   endpointPath:absolute,realPath:endpointRealPath,endpointType:endpointStats.isSocket()?"socket":"other",isSymbolicLink:endpointLink.isSymbolicLink(),ownerMatchesProcess:processUid!==null&&endpointStats.uid===processUid,mode:endpointStats.mode&0o777,
   parentPath,parentRealPath,parentType:parentStats.isDirectory()?"directory":"other",parentIsSymbolicLink:parentLink.isSymbolicLink(),parentOwnerMatchesProcess:processUid!==null&&parentStats.uid===processUid,parentMode:parentStats.mode&0o777
  };
 }
}
