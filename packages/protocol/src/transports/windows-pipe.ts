import {userInfo} from "node:os";
import {promisify} from "node:util";
import {execFile} from "node:child_process";
import type {TransportInspectionV1,WindowsPipeTransportInspectorV1} from "../spi.js";

export interface WindowsPipeInspectionProviderV1{
 inspect(pipeName:string):Promise<{peerIdentity:string;ownerMatchesProcess:boolean;ownerOnlyDacl:boolean;daclInheriting:boolean}>;
}

/** Windows ACL inspection is injected so production may use a native, OS-authenticated provider. */
export class WindowsPipeTransportInspector implements WindowsPipeTransportInspectorV1{
 readonly #provider:WindowsPipeInspectionProviderV1|undefined;
 constructor(provider?:WindowsPipeInspectionProviderV1){this.#provider=provider}
 async inspectWindowsPipe(pipeName:string):Promise<Extract<TransportInspectionV1,{transport:"windows-named-pipe"}>>{
  if(process.platform!=="win32")return{transport:"windows-named-pipe",localOnly:true,peerVerified:false,peerIdentity:null,ownerMatchesProcess:false,ownerOnlyDacl:false,daclInheriting:true};
  const inspected=this.#provider===undefined?await inspectAclWithPowerShell(pipeName):await this.#provider.inspect(pipeName),localIdentity=process.env.USERNAME?.trim()||userInfo().username;
  return{transport:"windows-named-pipe",localOnly:true,peerVerified:inspected.peerIdentity===localIdentity,peerIdentity:inspected.peerIdentity,ownerMatchesProcess:inspected.ownerMatchesProcess,ownerOnlyDacl:inspected.ownerOnlyDacl,daclInheriting:inspected.daclInheriting};
 }
}

async function inspectAclWithPowerShell(pipeName:string):Promise<{peerIdentity:string;ownerMatchesProcess:boolean;ownerOnlyDacl:boolean;daclInheriting:boolean}>{
 if(!/^\\\\\.\\pipe\\[^\\\r\n]+$/u.test(pipeName))throw new Error("Invalid Windows named-pipe path");
 const script="$acl=Get-Acl -LiteralPath $env:HORSENESS_PIPE_PATH;$me=[System.Security.Principal.WindowsIdentity]::GetCurrent().Name;$rules=@($acl.Access);[pscustomobject]@{peerIdentity=$me;ownerMatchesProcess=($acl.Owner -eq $me);ownerOnlyDacl=($rules.Count -gt 0 -and @($rules|Where-Object{$_.IdentityReference.Value -ne $me}).Count -eq 0);daclInheriting=(@($rules|Where-Object{$_.IsInherited}).Count -ne 0)}|ConvertTo-Json -Compress";
 const {stdout}=await promisify(execFile)("powershell.exe",["-NoProfile","-NonInteractive","-Command",script],{encoding:"utf8",windowsHide:true,env:{SystemRoot:process.env.SystemRoot??"C:\\Windows",HORSENESS_PIPE_PATH:pipeName}});
 const value=JSON.parse(stdout) as Record<string,unknown>;
 if(typeof value.peerIdentity!=="string"||typeof value.ownerMatchesProcess!=="boolean"||typeof value.ownerOnlyDacl!=="boolean"||typeof value.daclInheriting!=="boolean")throw new Error("Invalid Windows ACL inspection result");
 return{peerIdentity:value.peerIdentity,ownerMatchesProcess:value.ownerMatchesProcess,ownerOnlyDacl:value.ownerOnlyDacl,daclInheriting:value.daclInheriting};
}
