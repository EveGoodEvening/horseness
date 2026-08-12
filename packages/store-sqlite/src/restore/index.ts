import { randomUUID } from "node:crypto";
import {
  closeSync,
  cpSync,
  existsSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { containedBackupPath, createBackup, resolveBackupRoot, verifyBackup, verifyBackupIdentity, type BackupCreationPoint, type VerifiedBackupIdentityV1 } from "../backup/index.js";
import { verifyAuthority } from "../recovery/index.js";

export type RestorePhase =
  | "staged"
  | "old-moved"
  | "database-activated"
  | "artifacts-activated"
  | "committed";

export type RestoreCrashPoint =
  | BackupCreationPoint
  | `restore.journal.${"write" | "fsync"}.${"before" | "after"}`
  | `restore.rename.${"database-old" | "artifacts-old" | "database-activate" | "artifacts-activate" | "database-rollback" | "artifacts-rollback"}.${"before" | "after"}`
  | `restore.remove.${"database" | "artifacts" | "old-database" | "old-artifacts" | "stage-database" | "stage-artifacts" | "journal"}.${"before" | "after"}`;

export type RestoreCrashInjector = (point: RestoreCrashPoint) => void;
export interface RestoreOptions {
  readonly confirmReplacement?: boolean;
  readonly retainedBackupRoot?: string;
}

export interface RestoreCommitEvidenceV1 {
  readonly version: "HorsenessRestoreCommitEvidenceV1";
  readonly generationToken: string;
  readonly retainedBackupRoot: string;
  readonly retainedBackupIdentity: VerifiedBackupIdentityV1;
}
const noCrash: RestoreCrashInjector = () => undefined;

interface RestoreJournalV1 {
  version: "HorsenessRestoreJournalV1";
  phase: RestorePhase;
  generationToken: string;
  hadDatabase: boolean;
  hadArtifacts: boolean;
  retainedBackupRoot: string | null;
  retainedBackupIdentity: VerifiedBackupIdentityV1 | null;
}

interface RestorePaths extends RestoreJournalV1 {
  databasePath: string;
  artifactRoot: string;
  oldDatabase: string;
  oldArtifacts: string;
  stageDatabase: string;
  stageArtifacts: string;
}

const journalPath = (databasePath: string): string => `${databasePath}.restore-intent.json`;
const journalNextPath = (databasePath: string): string => `${journalPath(databasePath)}.next`;
const commitEvidencePath = (databasePath: string): string => `${databasePath}.restore-commit.json`;

function syncFile(path: string): void {
  const fd = openSync(path, "r");
  try { fsyncSync(fd); } finally { closeSync(fd); }
}

function syncDirectory(path: string): void {
  const fd = openSync(path, "r");
  try { fsyncSync(fd); } finally { closeSync(fd); }
}

function durableRename(from: string, to: string): void {
  renameSync(from, to);
  syncDirectory(dirname(from));
  if (dirname(to) !== dirname(from)) syncDirectory(dirname(to));
}

function syncTree(path: string): void {
  for (const entry of readdirSync(path)) {
    const child = join(path, entry);
    if (statSync(child).isDirectory()) syncTree(child);
    else syncFile(child);
  }
  syncDirectory(path);
}

function writeJournal(journal: RestorePaths, inject: RestoreCrashInjector): void {
  const path = journalPath(journal.databasePath);
  const next = journalNextPath(journal.databasePath);
  const persisted: RestoreJournalV1 = {
    version: journal.version,
    phase: journal.phase,
    generationToken: journal.generationToken,
    hadDatabase: journal.hadDatabase,
    hadArtifacts: journal.hadArtifacts,
    retainedBackupRoot: journal.retainedBackupRoot,
    retainedBackupIdentity: journal.retainedBackupIdentity,
  };
  inject("restore.journal.write.before");
  writeFileSync(next, `${JSON.stringify(persisted)}\n`, { mode: 0o600 });
  inject("restore.journal.write.after");
  inject("restore.journal.fsync.before");
  syncFile(next);
  inject("restore.journal.fsync.after");
  durableRename(next, path);
}

const GENERATION_TOKEN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

function authoritySibling(livePath: string, marker: "old" | "restore", token: string): string {
  const parent = dirname(livePath);
  const name = basename(livePath);
  if (name === "" || name === "." || name === ".." || name.includes(sep)) throw new Error("unsafe restore authority basename");
  const siblingName = `${name}.${marker}-${token}`;
  if (basename(siblingName) !== siblingName) throw new Error("unsafe restore sibling basename");
  const sibling = join(parent, siblingName);
  if (dirname(sibling) !== parent || basename(sibling) !== siblingName) throw new Error("unsafe restore sibling path");
  return sibling;
}

function assertExpectedPath(path: string, expected: "file" | "directory"): void {
  if (!existsSync(path)) return;
  const stat = lstatSync(path);
  if (stat.isSymbolicLink() || (expected === "file" ? !stat.isFile() : !stat.isDirectory())) throw new Error("unsafe restore path component");
}

function resolvedAuthorityPath(path: string, expected: "file" | "directory"): string {
  const absolute = resolve(path);
  const parent = dirname(absolute);
  const parentStat = lstatSync(parent);
  if (parentStat.isSymbolicLink() || !parentStat.isDirectory() || realpathSync(parent) !== parent) throw new Error("unsafe restore authority parent");
  assertExpectedPath(absolute, expected);
  return absolute;
}

interface StableDirectoryIdentity {
  readonly path: string;
  readonly device: bigint;
  readonly inode: bigint;
}

function stableDirectoryIdentity(path: string, label: string): StableDirectoryIdentity {
  const absolute = resolve(path);
  const stat = lstatSync(absolute, { bigint: true });
  if (stat.isSymbolicLink() || !stat.isDirectory() || realpathSync(absolute) !== absolute) throw new Error(`unsafe ${label}`);
  return { path: absolute, device: stat.dev, inode: stat.ino };
}

function assertStableDirectory(identity: StableDirectoryIdentity, label: string): void {
  const current = stableDirectoryIdentity(identity.path, label);
  if (current.device !== identity.device || current.inode !== identity.inode) throw new Error(`${label} changed during restore`);
}

function pathsOverlap(left: string, right: string): boolean {
  const fromLeft = relative(left, right);
  const fromRight = relative(right, left);
  return fromLeft === "" || (!fromLeft.startsWith(`..${sep}`) && fromLeft !== ".." && !isAbsolute(fromLeft)) || (!fromRight.startsWith(`..${sep}`) && fromRight !== ".." && !isAbsolute(fromRight));
}

function assertRetainedBackupContainment(retainedBackupRoot: string, paths: RestorePaths): StableDirectoryIdentity {
  const retained = resolve(retainedBackupRoot);
  const affectedPaths = [
    paths.databasePath,
    paths.artifactRoot,
    paths.oldDatabase,
    paths.oldArtifacts,
    paths.stageDatabase,
    paths.stageArtifacts,
    journalPath(paths.databasePath),
    journalNextPath(paths.databasePath),
    commitEvidencePath(paths.databasePath),
  ];
  if (affectedPaths.some(path => pathsOverlap(retained, path))) throw new Error("retained backup root overlaps restore authority paths");
  const retainedName = basename(retained);
  const reservedPrefixes = [
    `${basename(paths.databasePath)}.old-`,
    `${basename(paths.databasePath)}.restore-`,
    `${basename(paths.artifactRoot)}.old-`,
    `${basename(paths.artifactRoot)}.restore-`,
  ];
  if (reservedPrefixes.some(prefix => retainedName.startsWith(prefix))) throw new Error("retained backup root collides with restore sibling namespace");
  if (existsSync(retained)) throw new Error("retained backup destination already exists");
  return stableDirectoryIdentity(dirname(retained), "retained backup parent");
}

function verifyRetainedBackupAfterRestore(root: string, expected: VerifiedBackupIdentityV1, parent: StableDirectoryIdentity): void {
  assertStableDirectory(parent, "retained backup parent");
  const stat = lstatSync(root);
  if (stat.isSymbolicLink() || !stat.isDirectory() || realpathSync(root) !== root) throw new Error("retained backup identity is unsafe after restore");
  const actual = verifyBackupIdentity(root);
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error("retained backup identity changed during restore");
}

function deriveRestorePaths(databasePath: string, artifactRoot: string, journal: RestoreJournalV1): RestorePaths {
  databasePath = resolvedAuthorityPath(databasePath, "file");
  artifactRoot = resolvedAuthorityPath(artifactRoot, "directory");
  const paths: RestorePaths = {
    ...journal,
    databasePath,
    artifactRoot,
    oldDatabase: authoritySibling(databasePath, "old", journal.generationToken),
    oldArtifacts: authoritySibling(artifactRoot, "old", journal.generationToken),
    stageDatabase: authoritySibling(databasePath, "restore", journal.generationToken),
    stageArtifacts: authoritySibling(artifactRoot, "restore", journal.generationToken),
  };
  assertExpectedPath(paths.oldDatabase, "file");
  assertExpectedPath(paths.stageDatabase, "file");
  assertExpectedPath(paths.oldArtifacts, "directory");
  assertExpectedPath(paths.stageArtifacts, "directory");
  return paths;
}

function parseJournal(databasePath: string, artifactRoot: string): RestorePaths {
  const value: unknown = JSON.parse(readFileSync(journalPath(databasePath), "utf8"));
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error("invalid restore journal");
  const keys = Object.keys(value).sort();
  if (keys.join("\0") !== ["generationToken", "hadArtifacts", "hadDatabase", "phase", "retainedBackupIdentity", "retainedBackupRoot", "version"].sort().join("\0")) throw new Error("invalid restore journal keys");
  const journal = value as Partial<RestoreJournalV1>;
  const phases: readonly RestorePhase[] = ["staged", "old-moved", "database-activated", "artifacts-activated", "committed"];
  const identity = journal.retainedBackupIdentity;
  const validIdentity = identity === null || (
    typeof identity === "object" && identity !== null &&
    Object.keys(identity).sort().join("\0") === ["createdAt", "databaseDigest", "kind", "manifestDigest"].sort().join("\0") &&
    identity.kind === "HorsenessVerifiedBackupIdentityV1" &&
    typeof identity.createdAt === "string" &&
    typeof identity.databaseDigest === "string" && /^[0-9a-f]{64}$/u.test(identity.databaseDigest) &&
    typeof identity.manifestDigest === "string" && /^[0-9a-f]{64}$/u.test(identity.manifestDigest)
  );
  if (
    journal.version !== "HorsenessRestoreJournalV1" ||
    !phases.includes(journal.phase as RestorePhase) ||
    typeof journal.generationToken !== "string" ||
    !GENERATION_TOKEN.test(journal.generationToken) ||
    typeof journal.hadDatabase !== "boolean" ||
    typeof journal.hadArtifacts !== "boolean" ||
    !(journal.retainedBackupRoot === null || typeof journal.retainedBackupRoot === "string") ||
    !validIdentity ||
    ((journal.hadDatabase || journal.hadArtifacts) && (journal.retainedBackupRoot === null || identity === null))
  ) throw new Error("invalid restore journal");
  return deriveRestorePaths(databasePath, artifactRoot, journal as RestoreJournalV1);
}

function removePath(path: string, recursive: boolean, label: "database" | "artifacts" | "old-database" | "old-artifacts" | "stage-database" | "stage-artifacts" | "journal", inject: RestoreCrashInjector): void {
  if (!existsSync(path)) return;
  inject(`restore.remove.${label}.before`);
  rmSync(path, { recursive, force: true });
  syncDirectory(dirname(path));
  inject(`restore.remove.${label}.after`);
}

function renamePath(from: string, to: string, label: "database-old" | "artifacts-old" | "database-activate" | "artifacts-activate" | "database-rollback" | "artifacts-rollback", inject: RestoreCrashInjector): void {
  inject(`restore.rename.${label}.before`);
  durableRename(from, to);
  inject(`restore.rename.${label}.after`);
}

function verifyPair(databasePath: string, artifactRoot: string): void {
  if (!existsSync(databasePath) || !existsSync(artifactRoot)) throw new Error("restore authority unit is incomplete");
  const database = new DatabaseSync(databasePath);
  try { verifyAuthority(database, artifactRoot); } finally { database.close(); }
}

function rollback(journal: RestorePaths, inject: RestoreCrashInjector): void {
  if (existsSync(journal.oldDatabase)) {
    removePath(journal.databasePath, false, "database", inject);
    renamePath(journal.oldDatabase, journal.databasePath, "database-rollback", inject);
  } else if (!journal.hadDatabase) removePath(journal.databasePath, false, "database", inject);
  if (existsSync(journal.oldArtifacts)) {
    removePath(journal.artifactRoot, true, "artifacts", inject);
    renamePath(journal.oldArtifacts, journal.artifactRoot, "artifacts-rollback", inject);
  } else if (!journal.hadArtifacts) removePath(journal.artifactRoot, true, "artifacts", inject);
  removePath(journal.stageDatabase, false, "stage-database", inject);
  removePath(journal.stageArtifacts, true, "stage-artifacts", inject);
}

function finishForward(journal: RestorePaths, inject: RestoreCrashInjector): void {
  if (!existsSync(journal.databasePath) && existsSync(journal.stageDatabase)) renamePath(journal.stageDatabase, journal.databasePath, "database-activate", inject);
  if (!existsSync(journal.artifactRoot) && existsSync(journal.stageArtifacts)) renamePath(journal.stageArtifacts, journal.artifactRoot, "artifacts-activate", inject);
  verifyPair(journal.databasePath, journal.artifactRoot);
  removePath(journal.oldDatabase, false, "old-database", inject);
  removePath(journal.oldArtifacts, true, "old-artifacts", inject);
  removePath(journal.stageDatabase, false, "stage-database", inject);
  removePath(journal.stageArtifacts, true, "stage-artifacts", inject);
}

export function recoverInterruptedRestore(databasePath: string, artifactRoot: string, inject: RestoreCrashInjector = noCrash): void {
  databasePath = resolve(databasePath);
  artifactRoot = resolve(artifactRoot);
  const path = journalPath(databasePath);
  if (!existsSync(path)) {
    resolvedAuthorityPath(databasePath, "file");
    resolvedAuthorityPath(artifactRoot, "directory");
    removePath(journalNextPath(databasePath), false, "journal", inject);
    return;
  }
  const journal = parseJournal(databasePath, artifactRoot);
  if (journal.phase === "committed") finishForward(journal, inject);
  else rollback(journal, inject);
  removePath(journalNextPath(databasePath), false, "journal", inject);
  removePath(path, false, "journal", inject);
}

export function restoreBackup(backupRoot: string, databasePath: string, artifactRoot: string, options: RestoreOptions = {}, inject: RestoreCrashInjector = noCrash): RestoreCommitEvidenceV1 {
  databasePath = resolve(databasePath);
  artifactRoot = resolve(artifactRoot);
  mkdirSync(dirname(databasePath), { recursive: true });
  mkdirSync(dirname(artifactRoot), { recursive: true });
  databasePath = resolvedAuthorityPath(databasePath, "file");
  artifactRoot = resolvedAuthorityPath(artifactRoot, "directory");
  backupRoot = resolveBackupRoot(backupRoot);
  const manifest = verifyBackup(backupRoot);
  const token = randomUUID();
  let retainedBackupRoot = options.retainedBackupRoot ? resolve(options.retainedBackupRoot) : null;
  const preflightJournal = deriveRestorePaths(databasePath, artifactRoot, {
    version: "HorsenessRestoreJournalV1",
    phase: "staged",
    generationToken: token,
    hadDatabase: existsSync(databasePath),
    hadArtifacts: existsSync(artifactRoot),
    retainedBackupRoot,
    retainedBackupIdentity: null,
  });
  let retainedBackupParent: StableDirectoryIdentity | null = null;
  if (retainedBackupRoot !== null) retainedBackupParent = assertRetainedBackupContainment(retainedBackupRoot, preflightJournal);
  if (retainedBackupRoot !== null && existsSync(journalPath(databasePath))) {
    const interrupted = parseJournal(databasePath, artifactRoot);
    assertRetainedBackupContainment(retainedBackupRoot, interrupted);
  }
  recoverInterruptedRestore(databasePath, artifactRoot, inject);
  const hadDatabase = existsSync(databasePath);
  const hadArtifacts = existsSync(artifactRoot);
  let retainedBackupIdentity: VerifiedBackupIdentityV1 | null = null;
  if (hadDatabase || hadArtifacts) {
    if (options.confirmReplacement !== true) throw new Error("live authority replacement requires explicit confirmation");
    if (retainedBackupRoot === null) throw new Error("live authority replacement requires a retained pre-restore backup location");
    if (!hadDatabase || !hadArtifacts) throw new Error("cannot retain incomplete live authority unit");
    retainedBackupParent ??= assertRetainedBackupContainment(retainedBackupRoot, preflightJournal);
    assertStableDirectory(retainedBackupParent, "retained backup parent");
    const live = new DatabaseSync(databasePath);
    try { createBackup(live, artifactRoot, retainedBackupRoot, point => { inject(point); }); } finally { live.close(); }
    assertStableDirectory(retainedBackupParent, "retained backup parent");
    retainedBackupIdentity = verifyBackupIdentity(retainedBackupRoot);
  }
  const journal = deriveRestorePaths(databasePath, artifactRoot, {
    version: "HorsenessRestoreJournalV1",
    phase: "staged",
    generationToken: token,
    hadDatabase,
    hadArtifacts,
    retainedBackupRoot,
    retainedBackupIdentity,
  });
  cpSync(containedBackupPath(backupRoot, manifest.database.file), journal.stageDatabase, { errorOnExist: true });
  cpSync(join(backupRoot, "artifacts"), journal.stageArtifacts, { recursive: true, errorOnExist: true });
  syncFile(journal.stageDatabase);
  syncTree(journal.stageArtifacts);
  verifyPair(journal.stageDatabase, journal.stageArtifacts);
  try { writeJournal(journal, inject); }
  catch (error) {
    if (!existsSync(journalPath(databasePath))) {
      rmSync(journal.stageDatabase, { force: true });
      rmSync(journal.stageArtifacts, { recursive: true, force: true });
      rmSync(journalNextPath(databasePath), { force: true });
    }
    throw error;
  }
  if (journal.hadDatabase) renamePath(databasePath, journal.oldDatabase, "database-old", inject);
  if (journal.hadArtifacts) renamePath(artifactRoot, journal.oldArtifacts, "artifacts-old", inject);
  journal.phase = "old-moved"; writeJournal(journal, inject);
  renamePath(journal.stageDatabase, databasePath, "database-activate", inject);
  journal.phase = "database-activated"; writeJournal(journal, inject);
  renamePath(journal.stageArtifacts, artifactRoot, "artifacts-activate", inject);
  journal.phase = "artifacts-activated"; writeJournal(journal, inject);
  verifyPair(databasePath, artifactRoot);
  journal.phase = "committed"; writeJournal(journal, inject);
  const evidence: RestoreCommitEvidenceV1 = { version: "HorsenessRestoreCommitEvidenceV1", generationToken: token, retainedBackupRoot: retainedBackupRoot ?? "", retainedBackupIdentity: retainedBackupIdentity ?? verifyBackupIdentity(backupRoot) };
  writeFileSync(commitEvidencePath(databasePath), `${JSON.stringify(evidence)}\n`, { mode: 0o600 });
  syncFile(commitEvidencePath(databasePath));
  syncDirectory(dirname(databasePath));
  finishForward(journal, inject);
  if (retainedBackupRoot !== null && retainedBackupIdentity !== null && retainedBackupParent !== null) {
    verifyRetainedBackupAfterRestore(retainedBackupRoot, retainedBackupIdentity, retainedBackupParent);
  }
  removePath(journalNextPath(databasePath), false, "journal", inject);
  removePath(journalPath(databasePath), false, "journal", inject);
  return evidence;
}

export function rollbackFromRetainedBackup(retainedBackupRoot: string, databasePath: string, artifactRoot: string, options: RestoreOptions, inject: RestoreCrashInjector = noCrash): RestoreCommitEvidenceV1 {
  return restoreBackup(retainedBackupRoot, databasePath, artifactRoot, options, inject);
}
