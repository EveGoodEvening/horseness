import { spawnSync } from "node:child_process";
import { chmodSync, lstatSync, type Stats } from "node:fs";
import { join } from "node:path";

type StatePathKind = "file" | "directory";
const PERMISSION_ERROR = "bootstrap capability permissions invalid";

function inspectStatePath(path: string, kind: StatePathKind): Stats {
  const state = lstatSync(path);
  if (state.isSymbolicLink() || (kind === "directory" ? !state.isDirectory() : !state.isFile())) throw new Error(PERMISSION_ERROR);
  return state;
}

const WINDOWS_PRIVATE_ACL = `
$ErrorActionPreference = 'Stop'
$path = $env:HORSENESS_PRIVATE_STATE_PATH
$attributes = [IO.File]::GetAttributes($path)
if (($attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'Reparse point refused' }
$directory = $env:HORSENESS_PRIVATE_STATE_KIND -eq 'directory'
if ((($attributes -band [IO.FileAttributes]::Directory) -ne 0) -ne $directory) { throw 'State path type mismatch' }
$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$sid = $identity.User
$acl = if ($directory) { [IO.Directory]::GetAccessControl($path) } else { [IO.File]::GetAccessControl($path) }
if ($env:HORSENESS_PRIVATE_STATE_PROTECT -eq 'true') {
  $owner = $acl.GetOwner([Security.Principal.SecurityIdentifier])
  if ($owner.Value -ne $sid.Value -and $owner.Value -ne $identity.Owner.Value) { throw 'State path owner mismatch' }
  if ($directory) {
    $acl = [Security.AccessControl.DirectorySecurity]::new()
    $inheritance = [Security.AccessControl.InheritanceFlags]'ContainerInherit, ObjectInherit'
  } else {
    $acl = [Security.AccessControl.FileSecurity]::new()
    $inheritance = [Security.AccessControl.InheritanceFlags]::None
  }
  $acl.SetOwner($sid)
  $acl.SetAccessRuleProtection($true, $false)
  $rule = [Security.AccessControl.FileSystemAccessRule]::new($sid, [Security.AccessControl.FileSystemRights]::FullControl, $inheritance, [Security.AccessControl.PropagationFlags]::None, [Security.AccessControl.AccessControlType]::Allow)
  $acl.AddAccessRule($rule)
  if ($directory) { [IO.Directory]::SetAccessControl($path, $acl) } else { [IO.File]::SetAccessControl($path, $acl) }
  $acl = if ($directory) { [IO.Directory]::GetAccessControl($path) } else { [IO.File]::GetAccessControl($path) }
}
if ($acl.GetOwner([Security.Principal.SecurityIdentifier]).Value -ne $sid.Value -or -not $acl.AreAccessRulesProtected) { throw 'State path owner or inheritance mismatch' }
$rules = @($acl.GetAccessRules($true, $true, [Security.Principal.SecurityIdentifier]))
if ($rules.Count -ne 1) { throw 'State path is not owner-only' }
$rule = $rules[0]
if ($rule.IsInherited -or $rule.IdentityReference.Value -ne $sid.Value -or $rule.AccessControlType -ne [Security.AccessControl.AccessControlType]::Allow -or ($rule.FileSystemRights -band [Security.AccessControl.FileSystemRights]::FullControl) -ne [Security.AccessControl.FileSystemRights]::FullControl) { throw 'State path is not owner-only' }
`;

function windowsPrivateState(path: string, kind: StatePathKind, protect: boolean): void {
  const systemRoot = process.env.SystemRoot;
  if (!systemRoot) throw new Error(PERMISSION_ERROR);
  const environment: NodeJS.ProcessEnv = { HORSENESS_PRIVATE_STATE_PATH: path, HORSENESS_PRIVATE_STATE_KIND: kind, HORSENESS_PRIVATE_STATE_PROTECT: String(protect) };
  for (const key of ["SystemRoot", "SystemDrive", "WINDIR", "COMSPEC", "PATH", "PATHEXT", "TEMP", "TMP", "USERPROFILE", "HOMEDRIVE", "HOMEPATH", "LOCALAPPDATA", "APPDATA", "COMPUTERNAME"]) {
    const value = process.env[key];
    if (value !== undefined) environment[key] = value;
  }
  const result = spawnSync(join(systemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe"), ["-NoProfile", "-NonInteractive", "-Command", WINDOWS_PRIVATE_ACL], {
    encoding: "utf8", windowsHide: true, timeout: 30_000, maxBuffer: 64 * 1024,
    env: environment,
  });
  if (result.error || result.status !== 0) throw new Error(PERMISSION_ERROR, { cause: result.error ?? new Error(result.stderr.trim()) });
}

export function protectPrivateStatePath(path: string, kind: StatePathKind): void {
  inspectStatePath(path, kind);
  if (process.platform === "win32") windowsPrivateState(path, kind, true);
  else chmodSync(path, kind === "directory" ? 0o700 : 0o600);
}

export function assertPrivateStatePath(path: string, kind: StatePathKind): void {
  const state = inspectStatePath(path, kind);
  if (process.platform === "win32") windowsPrivateState(path, kind, false);
  else if ((state.mode & 0o777) !== (kind === "directory" ? 0o700 : 0o600)) throw new Error(PERMISSION_ERROR);
}
