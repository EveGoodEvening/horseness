import { randomUUID } from "node:crypto";
import { chmodSync, closeSync, fsyncSync, mkdirSync, openSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { userInfo } from "node:os";
import { dirname } from "node:path";
import { canonicalJson, type JsonValue } from "@horseness/domain";
import { StdioTransportInspector, StdioTransportServer, UnixSocketTransportInspector, UnixSocketTransportServer, WindowsPipeTransportInspector, type TransportInspectorsV1, type TransportServerV1 } from "@horseness/protocol";
import { createOrLoadAuthorityCredential, rebindAuthorityCredential, SQLiteAuthority, type AuthorityCredentialV1 } from "@horseness/store-sqlite";
import { BootstrapCeremony, assertContainedStatePath, type BootstrapCapabilityV1, type BootstrapResultV1 } from "./bootstrap.js";
import { resolveDaemonConfig, type DaemonConfigV1, type ResolvedDaemonConfigV1 } from "./config.js";
import { GrantStore } from "./grant-store.js";
import { DaemonServer } from "./server.js";

export interface EndpointStateV1 { readonly schemaVersion: "1"; readonly workspaceId: string; readonly transport: "stdio" | "unix-socket"; readonly endpointPath: string | null; readonly processId: number; readonly startedAt: string; }

export class Daemon {
  readonly config: ResolvedDaemonConfigV1;
  private authorityValue:SQLiteAuthority;
  grants: GrantStore;
  bootstrap: BootstrapCeremony;
  server: DaemonServer;
  private transportServer: TransportServerV1 | null = null;
  private readonly identity: () => string;
  private readonly credential:AuthorityCredentialV1;

  constructor(config: DaemonConfigV1, options: { readonly identity?: () => string } = {}) {
    this.config = resolveDaemonConfig(config);
    assertContainedStatePath(this.config.workspacePath, this.config.bootstrapCapabilityPath);
    assertContainedStatePath(this.config.workspacePath, this.config.endpointStatePath);
    mkdirSync(this.config.workspacePath, { recursive: true, mode: 0o700 });
    mkdirSync(dirname(this.config.databasePath), { recursive: true, mode: 0o700 });
    mkdirSync(this.config.artifactRoot, { recursive: true, mode: 0o700 });
    this.identity = options.identity ?? (() => process.env.USER ?? userInfo().username);
    this.credential=createOrLoadAuthorityCredential(this.config.databasePath,this.config.artifactRoot,this.config.workspaceId);
    const bootstrapAuthority=SQLiteAuthority.open(this.config.databasePath,this.config.artifactRoot);
    const existing=bootstrapAuthority.replay(this.config.workspaceId,"workspace",this.config.workspaceId);
    if(existing.length===0)this.authorityValue=bootstrapAuthority;
    else{bootstrapAuthority.close();this.authorityValue=SQLiteAuthority.openAuthenticatedWorkspace(this.config.databasePath,this.config.artifactRoot,{workspaceId:this.config.workspaceId,sessionId:`daemon:${process.pid}:${randomUUID()}`,credential:this.credential}).authority;}
    this.grants = new GrantStore(this.authorityValue,this.config.workspaceId,this.config.authorityTime);
    this.bootstrap = new BootstrapCeremony(this.authorityValue, this.config.bootstrapCapabilityPath, this.config.workspaceId, this.config.authorityTime, this.identity);
    this.bootstrap.recoverInterruptedConsumption();
    this.server = new DaemonServer(this.authorityValue, this.grants);
  }

  get authority():SQLiteAuthority{return this.authorityValue;}

  get running(): boolean { return this.transportServer?.running ?? false; }

  createBootstrapCapability(authorityPrincipalId?: string): BootstrapCapabilityV1 { return this.bootstrap.createCapability(authorityPrincipalId); }

  consumeBootstrapCapability(secret: string): BootstrapResultV1 {
    const result = this.bootstrap.consumeBootstrapCapability(secret);
    this.authorityValue.close();
    this.authorityValue=SQLiteAuthority.openAuthenticatedWorkspace(this.config.databasePath,this.config.artifactRoot,{workspaceId:this.config.workspaceId,sessionId:`daemon:${process.pid}:${randomUUID()}`,credential:this.credential}).authority;
    this.grants=new GrantStore(this.authorityValue,this.config.workspaceId,this.config.authorityTime);
    this.bootstrap=new BootstrapCeremony(this.authorityValue,this.config.bootstrapCapabilityPath,this.config.workspaceId,this.config.authorityTime,this.identity);
    this.server=new DaemonServer(this.authorityValue,this.grants);
    return result;
  }

  rebindRestoredWorkspace():void {
    if(this.running)throw new Error("stop daemon before workspace rebind");
    this.authorityValue.close();
    this.authorityValue=SQLiteAuthority.openAuthenticatedWorkspace(this.config.databasePath,this.config.artifactRoot,{workspaceId:this.config.workspaceId,sessionId:`daemon:${process.pid}:${randomUUID()}`,credential:this.credential}).authority;
    this.grants=new GrantStore(this.authorityValue,this.config.workspaceId,this.config.authorityTime);this.bootstrap=new BootstrapCeremony(this.authorityValue,this.config.bootstrapCapabilityPath,this.config.workspaceId,this.config.authorityTime,this.identity);this.server=new DaemonServer(this.authorityValue,this.grants);
  }

  async start(grantReference: string): Promise<void> {
    if (this.transportServer !== null) throw new Error("daemon already started");
    const inspectors: TransportInspectorsV1 = { stdio: new StdioTransportInspector(), unixSocket: new UnixSocketTransportInspector(), windowsPipe: new WindowsPipeTransportInspector() };
    const common = { grantReference, inspectors, grants: this.grants, authorityTime: this.config.authorityTime, handler: (context: Parameters<DaemonServer["dispatch"]>[0], request: unknown) => this.server.dispatch(context, request) };
    this.transportServer = this.config.transport.kind === "stdio" ? new StdioTransportServer(common) : new UnixSocketTransportServer({ inspectors,grants:this.grants,authorityTime:this.config.authorityTime,handler:common.handler,endpointPath:this.config.transport.endpointPath });
    await this.transportServer.start();
    try {
      mkdirSync(this.config.stateDirectory, { recursive: true, mode: 0o700 }); chmodSync(this.config.stateDirectory, 0o700);
      const state: EndpointStateV1 = Object.freeze({ schemaVersion: "1", workspaceId: this.config.workspaceId, transport: this.config.transport.kind === "stdio" ? "stdio" : "unix-socket", endpointPath: this.config.transport.kind === "unix-socket" ? this.config.transport.endpointPath : null, processId: process.pid, startedAt: this.config.authorityTime() });
      const temporary=`${this.config.endpointStatePath}.${process.pid}.tmp`;const descriptor=openSync(temporary,"wx",0o600);
      try{writeFileSync(descriptor,`${canonicalJson(state as unknown as JsonValue)}\n`);fsyncSync(descriptor);}finally{closeSync(descriptor);}
      renameSync(temporary,this.config.endpointStatePath);chmodSync(this.config.endpointStatePath,0o600);const directory=openSync(this.config.stateDirectory,"r");try{fsyncSync(directory);}finally{closeSync(directory);}
    } catch(error) { const transport=this.transportServer;this.transportServer=null;if(transport!==null)await transport.close();rmSync(this.config.endpointStatePath,{force:true});throw error; }
  }

  async stop(): Promise<void> {
    const transport = this.transportServer;
    this.transportServer = null;
    if (transport !== null) await transport.close();
    rmSync(this.config.endpointStatePath, { force: true });
  }

  close(): void { if (this.running) throw new Error("stop daemon before close"); this.authority.close(); }

  static reopen(config: DaemonConfigV1): Daemon {
    createOrLoadAuthorityCredential(config.databasePath, config.artifactRoot, resolveDaemonConfig(config).workspaceId);
    return new Daemon(config);
  }

  static rebindRestored(config:DaemonConfigV1):Daemon {const credential=rebindAuthorityCredential(config.databasePath,config.artifactRoot);return new Daemon({...config,workspaceId:credential.workspaceId});}
}

export function daemonSessionId(): string { return randomUUID(); }
