import { randomUUID } from "node:crypto";
import {
  closeSync,
  cpSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { containedBackupPath, verifyBackup } from "../backup/index.js";
import { verifyAuthority } from "../recovery/index.js";

export type RestorePhase =
  | "staged"
  | "old-moved"
  | "database-activated"
  | "artifacts-activated"
  | "committed";

export type RestoreCrashPoint =
  | `restore.journal.${"write" | "fsync"}.${"before" | "after"}`
  | `restore.rename.${"database-old" | "artifacts-old" | "database-activate" | "artifacts-activate" | "database-rollback" | "artifacts-rollback"}.${"before" | "after"}`
  | `restore.remove.${"database" | "artifacts" | "old-database" | "old-artifacts" | "stage-database" | "stage-artifacts" | "journal"}.${"before" | "after"}`;

export type RestoreCrashInjector = (point: RestoreCrashPoint) => void;
const noCrash: RestoreCrashInjector = () => undefined;

interface RestoreJournalV1 {
  version: "HorsenessRestoreJournalV1";
  phase: RestorePhase;
  databasePath: string;
  artifactRoot: string;
  oldDatabase: string;
  oldArtifacts: string;
  stageDatabase: string;
  stageArtifacts: string;
  hadDatabase: boolean;
  hadArtifacts: boolean;
}

const journalPath = (databasePath: string): string => `${databasePath}.restore-intent.json`;
const journalNextPath = (databasePath: string): string => `${journalPath(databasePath)}.next`;

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

function writeJournal(journal: RestoreJournalV1, inject: RestoreCrashInjector): void {
  const path = journalPath(journal.databasePath);
  const next = journalNextPath(journal.databasePath);
  inject("restore.journal.write.before");
  writeFileSync(next, `${JSON.stringify(journal)}\n`, { mode: 0o600 });
  inject("restore.journal.write.after");
  inject("restore.journal.fsync.before");
  syncFile(next);
  inject("restore.journal.fsync.after");
  durableRename(next, path);
}

function parseJournal(databasePath: string, artifactRoot: string): RestoreJournalV1 {
  const value: unknown = JSON.parse(readFileSync(journalPath(databasePath), "utf8"));
  if (typeof value !== "object" || value === null) throw new Error("invalid restore journal");
  const journal = value as Partial<RestoreJournalV1>;
  const phases: readonly RestorePhase[] = ["staged", "old-moved", "database-activated", "artifacts-activated", "committed"];
  if (
    journal.version !== "HorsenessRestoreJournalV1" ||
    !phases.includes(journal.phase as RestorePhase) ||
    journal.databasePath !== resolve(databasePath) ||
    journal.artifactRoot !== resolve(artifactRoot) ||
    typeof journal.oldDatabase !== "string" ||
    typeof journal.oldArtifacts !== "string" ||
    typeof journal.stageDatabase !== "string" ||
    typeof journal.stageArtifacts !== "string" ||
    typeof journal.hadDatabase !== "boolean" ||
    typeof journal.hadArtifacts !== "boolean"
  ) throw new Error("invalid restore journal");
  const allowedDatabasePrefix = `${journal.databasePath}.`;
  const allowedArtifactPrefix = `${journal.artifactRoot}.`;
  if (
    !journal.oldDatabase.startsWith(`${allowedDatabasePrefix}old-`) ||
    !journal.stageDatabase.startsWith(`${allowedDatabasePrefix}restore-`) ||
    !journal.oldArtifacts.startsWith(`${allowedArtifactPrefix}old-`) ||
    !journal.stageArtifacts.startsWith(`${allowedArtifactPrefix}restore-`)
  ) throw new Error("unsafe restore journal path");
  return journal as RestoreJournalV1;
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

function rollback(journal: RestoreJournalV1, inject: RestoreCrashInjector): void {
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

function finishForward(journal: RestoreJournalV1, inject: RestoreCrashInjector): void {
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
    removePath(journalNextPath(databasePath), false, "journal", inject);
    return;
  }
  const journal = parseJournal(databasePath, artifactRoot);
  if (journal.phase === "committed") finishForward(journal, inject);
  else rollback(journal, inject);
  removePath(journalNextPath(databasePath), false, "journal", inject);
  removePath(path, false, "journal", inject);
}

export function restoreBackup(backupRoot: string, databasePath: string, artifactRoot: string, inject: RestoreCrashInjector = noCrash): void {
  databasePath = resolve(databasePath);
  artifactRoot = resolve(artifactRoot);
  const manifest = verifyBackup(backupRoot);
  recoverInterruptedRestore(databasePath, artifactRoot, inject);
  mkdirSync(dirname(databasePath), { recursive: true });
  mkdirSync(dirname(artifactRoot), { recursive: true });
  const token = randomUUID();
  const journal: RestoreJournalV1 = {
    version: "HorsenessRestoreJournalV1",
    phase: "staged",
    databasePath,
    artifactRoot,
    oldDatabase: `${databasePath}.old-${token}`,
    oldArtifacts: `${artifactRoot}.old-${token}`,
    stageDatabase: `${databasePath}.restore-${token}`,
    stageArtifacts: `${artifactRoot}.restore-${token}`,
    hadDatabase: existsSync(databasePath),
    hadArtifacts: existsSync(artifactRoot),
  };
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
  finishForward(journal, inject);
  removePath(journalNextPath(databasePath), false, "journal", inject);
  removePath(journalPath(databasePath), false, "journal", inject);
}
