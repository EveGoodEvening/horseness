import { randomBytes, randomUUID } from "node:crypto";
import { chmodSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, statSync, writeFileSync, closeSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { canonicalJson, createWorkspaceGenesis, domainDigest, NO_POLICY_DIGEST, type JsonValue } from "@horseness/domain";
import { SQLiteAuthority, StoreConflictError } from "@horseness/store-sqlite";
import type { AuthenticatedGrantV1, ProtocolMethodV1 } from "@horseness/protocol";
import { GRANT_AUTHORITY_STATE_KIND, GrantStore } from "./grant-store.js";

export interface BootstrapCapabilityV1 {
  readonly schemaVersion: "1";
  readonly capabilityId: string;
  readonly secret: string;
  readonly workspaceId: string;
  readonly osIdentity: string;
  readonly authorityPrincipalId: string;
  readonly issuedAt: string;
}

export interface BootstrapResultV1 {
  readonly workspaceId: string;
  readonly principalId: string;
  readonly grantReference: string;
  readonly grantDigest: string;
}
const AUTHORITY_METHODS:readonly ProtocolMethodV1[]=["workspace.get.v1","run.create.v1","run.get.v1","run.list.v1","grant.issue.v1","grant.delegate.v1","grant.revoke.v1","grant.list.v1"];

export class BootstrapCeremony {
  readonly consumingPath: string;
  constructor(
    private readonly authority: SQLiteAuthority,
    readonly capabilityPath: string,
    private readonly workspaceId: string,
    private readonly authorityTime: () => string,
    private readonly currentIdentity: () => string,
  ) { this.consumingPath = `${capabilityPath}.consuming`; }

  createCapability(authorityPrincipalId = `authority:${randomUUID()}`): BootstrapCapabilityV1 {
    mkdirSync(dirname(this.capabilityPath), { recursive: true, mode: 0o700 });
    chmodSync(dirname(this.capabilityPath), 0o700);
    const capability: BootstrapCapabilityV1 = Object.freeze({ schemaVersion: "1", capabilityId: randomUUID(), secret: randomBytes(32).toString("base64url"), workspaceId: this.workspaceId, osIdentity: this.currentIdentity(), authorityPrincipalId, issuedAt: this.authorityTime() });
    const descriptor = openSync(this.capabilityPath, "wx", 0o600);
    try { writeFileSync(descriptor, `${canonicalJson(capability as unknown as JsonValue)}\n`); } finally { closeSync(descriptor); }
    chmodSync(this.capabilityPath, 0o600);
    return capability;
  }

  recoverInterruptedConsumption(): void {
    try {
      const rows = this.authority.replay(this.workspaceId, "workspace", this.workspaceId);
      if (rows.length > 0) rmSync(this.consumingPath, { force: true });
      else renameSync(this.consumingPath, this.capabilityPath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }

  consumeBootstrapCapability(secret: string): BootstrapResultV1 {
    const identity = this.currentIdentity();
    const parent = statSync(dirname(this.capabilityPath));
    const capabilityFile = statSync(this.capabilityPath, { bigint: false });
    if (!parent.isDirectory() || (parent.mode & 0o777) !== 0o700 || !capabilityFile.isFile() || (capabilityFile.mode & 0o777) !== 0o600) throw new Error("bootstrap capability permissions invalid");
    renameSync(this.capabilityPath, this.consumingPath);
    let appended = false;
    try {
      const capability = JSON.parse(readFileSync(this.consumingPath, "utf8")) as BootstrapCapabilityV1;
      if (capability.schemaVersion !== "1" || capability.workspaceId !== this.workspaceId || capability.osIdentity !== identity || capability.secret !== secret || capability.capabilityId.length === 0 || capability.authorityPrincipalId.length === 0) throw new Error("bootstrap capability binding mismatch");
      if (this.authority.replay(this.workspaceId, "workspace", this.workspaceId).length !== 0) throw new StoreConflictError("workspace is already bootstrapped");
      const grantReference = `grant:${randomUUID()}`;
      const digestCore={schemaVersion:"1" as const,principalId:capability.authorityPrincipalId,principalRole:"authority" as const,peerIdentity:identity,expiresAt:new Date(Date.parse(this.authorityTime())+365*24*60*60*1000).toISOString(),workspaceId:this.workspaceId,runId:null,taskId:null,attemptId:null,generation:null,proposalId:null,adapterId:null,allowedMethods:AUTHORITY_METHODS};
      const grantDigest = domainDigest("horseness.daemon-grant.v1",digestCore as unknown as JsonValue);
      const marker = domainDigest("horseness.bootstrap-consumption.v1", { capabilityId: capability.capabilityId, workspaceId: this.workspaceId, osIdentity: identity } as JsonValue);
      const genesis = createWorkspaceGenesis({ workspaceId: this.workspaceId, authorityPrincipalId: capability.authorityPrincipalId, initialGrantDigest: grantDigest, authorityConsumptionMarker: marker, activePolicyDigest: NO_POLICY_DIGEST, commandId: `bootstrap:${capability.capabilityId}` });
      const grant:AuthenticatedGrantV1=Object.freeze({...digestCore,revoked:false,grantDigest});
      const state=GrantStore.initialState(grantReference,grant);
      this.authority.bootstrapWorkspaceAuthorityAtomic({commandId:genesis.event.envelope.causationId,workspace:{streamKind:"workspace",workspaceId:this.workspaceId,streamId:this.workspaceId,expectedSequence:0,expectedEnvelopeHash:null,events:[genesis.event]},authorityState:{schemaVersion:"1",workspaceId:this.workspaceId,stateKind:GRANT_AUTHORITY_STATE_KIND,revision:1,stateDigest:domainDigest("horseness.workspace-authority-state.v1",state as unknown as JsonValue),state:state as unknown as JsonValue}});
      appended = true;
      return Object.freeze({ workspaceId: this.workspaceId, principalId: capability.authorityPrincipalId, grantReference, grantDigest });
    } finally {
      if (appended) rmSync(this.consumingPath, { force: true });
      else { try { renameSync(this.consumingPath, this.capabilityPath); } catch { /* another process owns recovery */ } }
    }
  }
}

export function assertContainedStatePath(workspacePath: string, path: string): void {
  const root = `${resolve(workspacePath)}/`;
  if (!resolve(path).startsWith(root)) throw new Error("daemon state path escapes workspace");
}
