import { cp, lstat, mkdir, open, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import { InstallerJournal, installerSha256, type JournalOperationV1 } from "../journal/index.js";

export type MigrationPhaseV1 = "begun" | "backup-created" | "staged" | "activated" | "compensating" | "compensated" | "repair-required" | "complete";
export type MigrationCrashPointV1 = "after-begin" | "after-backup" | "after-stage-fsync" | "after-activate-rename" | "after-activate-fsync" | "during-compensation";

export interface InstallerStateV1 {
  readonly schema: "horseness.installer-state.v1";
  readonly installedVersion: string;
  readonly generation: number;
  readonly phase: MigrationPhaseV1;
  readonly transactionId: string | null;
  readonly backupPath: string | null;
  readonly stagedPath: string | null;
  readonly targetVersion: string | null;
  readonly detailDigest: string;
}

export interface MigrationPlanV1 {
  readonly schema: "horseness.migration-plan.v1";
  readonly transactionId: string;
  readonly explicitMajorGate: boolean;
  readonly fromVersion: string;
  readonly toVersion: string;
  readonly reversible: boolean;
  readonly transform: (sourceHome: string, stagedHome: string) => Promise<void>;
}

export class InstallerMigrationError extends Error { constructor(readonly code: string) { super(code); this.name = "InstallerMigrationError"; } }
const VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u;

async function fsyncDirectory(path: string): Promise<void> { const handle = await open(path, "r"); try { await handle.sync(); } finally { await handle.close(); } }
async function writeAtomic(path: string, bytes: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.tmp-${process.pid}`;
  const handle = await open(temporary, "w", 0o600);
  try { await handle.writeFile(bytes, "utf8"); await handle.sync(); } finally { await handle.close(); }
  await rename(temporary, path); await fsyncDirectory(dirname(path));
}
function stateDigest(state: Omit<InstallerStateV1, "detailDigest">): string { return installerSha256(`horseness.installer-state.v1\0${JSON.stringify(state)}`); }
function createState(fields: Omit<InstallerStateV1, "schema" | "detailDigest">): InstallerStateV1 {
  const core = {
    schema: "horseness.installer-state.v1" as const,
    installedVersion: fields.installedVersion,
    generation: fields.generation,
    phase: fields.phase,
    transactionId: fields.transactionId,
    backupPath: fields.backupPath,
    stagedPath: fields.stagedPath,
    targetVersion: fields.targetVersion,
  };
  return Object.freeze({ ...core, detailDigest: stateDigest(core) });
}
async function record(journal: InstallerJournal, operation: JournalOperationV1, state: InstallerStateV1): Promise<void> {
  await journal.append({ operation, transactionId: state.transactionId ?? `steady-${state.generation}`, releaseVersion: state.targetVersion ?? state.installedVersion, detailDigest: state.detailDigest }, state.generation);
}

export class InstallerMigrationEngine {
  readonly authorityRoot: string;
  readonly activeHome: string;
  readonly statePath: string;
  readonly journal: InstallerJournal;
  private constructor(authorityRoot: string, journal: InstallerJournal) {
    this.authorityRoot = authorityRoot; this.activeHome = join(authorityRoot, "active"); this.statePath = join(authorityRoot, "state.json"); this.journal = journal;
  }
  static async open(authorityRootPath: string, initialVersion = "0.0.0-compat.1"): Promise<InstallerMigrationEngine> {
    if (!VERSION.test(initialVersion)) throw new InstallerMigrationError("INVALID_VERSION");
    const authorityRoot = resolve(authorityRootPath);
    await mkdir(authorityRoot, { recursive: true, mode: 0o700 });
    const info = await lstat(authorityRoot);
    if (!info.isDirectory() || info.isSymbolicLink() || (info.mode & 0o077) !== 0) throw new InstallerMigrationError("MIGRATION_ROOT_NOT_PRIVATE");
    const journal = await InstallerJournal.open(join(authorityRoot, "journal"));
    const engine = new InstallerMigrationEngine(authorityRoot, journal);
    try { await engine.readState(); } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      await mkdir(engine.activeHome, { recursive: true, mode: 0o700 });
      await engine.persist(createState({ installedVersion: initialVersion, generation: 1, phase: "complete", transactionId: null, backupPath: null, stagedPath: null, targetVersion: null }));
    }
    return engine;
  }
  async readState(): Promise<InstallerStateV1> {
    const value: unknown = JSON.parse(await readFile(this.statePath, "utf8"));
    if (value === null || typeof value !== "object" || Array.isArray(value)) throw new InstallerMigrationError("INVALID_INSTALLER_STATE");
    if ("schema" in value && typeof value.schema === "string" && /^horseness\.installer-state\.v[2-9][0-9]*$/u.test(value.schema)) {
      throw new InstallerMigrationError("UNKNOWN_NEWER_INSTALLER_STATE");
    }
    const keys = Object.keys(value).sort();
    const expected = ["schema", "installedVersion", "generation", "phase", "transactionId", "backupPath", "stagedPath", "targetVersion", "detailDigest"].sort();
    if (keys.length !== expected.length || keys.some((key, index) => key !== expected[index])) throw new InstallerMigrationError("INVALID_INSTALLER_STATE");
    const state = value as InstallerStateV1;
    const { detailDigest: _digest, ...core } = state;
    if (state.schema !== "horseness.installer-state.v1" || !VERSION.test(state.installedVersion) || !Number.isSafeInteger(state.generation) || state.generation < 1 || state.detailDigest !== stateDigest(core)) throw new InstallerMigrationError("INSTALLER_STATE_INTEGRITY_MISMATCH");
    return state;
  }
  private async persist(state: InstallerStateV1): Promise<void> { await writeAtomic(this.statePath, `${JSON.stringify(state)}\n`); }
  private confined(path: string): string {
    const resolved = resolve(path);
    if (!resolved.startsWith(`${this.authorityRoot}${sep}`)) throw new InstallerMigrationError("MIGRATION_PATH_ESCAPE");
    return resolved;
  }
  async migrate(plan: MigrationPlanV1, crash?: (point: MigrationCrashPointV1) => void): Promise<InstallerStateV1> {
    if (plan.schema !== "horseness.migration-plan.v1" || !VERSION.test(plan.fromVersion) || !VERSION.test(plan.toVersion) || typeof plan.reversible !== "boolean" || typeof plan.explicitMajorGate !== "boolean") throw new InstallerMigrationError("INVALID_MIGRATION_PLAN");
    const fromParts = plan.fromVersion.split(".").map((part) => Number.parseInt(part, 10));
    const toParts = plan.toVersion.split(".").map((part) => Number.parseInt(part, 10));
    const downgrade = (toParts[0] ?? 0) < (fromParts[0] ?? 0) || ((toParts[0] ?? 0) === (fromParts[0] ?? 0) && ((toParts[1] ?? 0) < (fromParts[1] ?? 0) || ((toParts[1] ?? 0) === (fromParts[1] ?? 0) && (toParts[2] ?? 0) < (fromParts[2] ?? 0))));
    if (downgrade && !plan.reversible) throw new InstallerMigrationError("DOWNGRADE_REVERSIBLE_PLAN_REQUIRED");
    if (downgrade && (toParts[0] ?? 0) !== (fromParts[0] ?? 0) && !plan.explicitMajorGate) throw new InstallerMigrationError("DOWNGRADE_MAJOR_GATE_REQUIRED");
    let state = await this.recover();
    if (state.installedVersion !== plan.fromVersion || state.phase !== "complete") throw new InstallerMigrationError("MIGRATION_SOURCE_MISMATCH");
    const generation = state.generation + 1;
    const backupPath = this.confined(join(this.authorityRoot, "backups", `${generation}-${plan.fromVersion}`));
    const stagedPath = this.confined(join(this.authorityRoot, "staging", `${generation}-${plan.toVersion}`));
    state = createState({ installedVersion: plan.fromVersion, generation, phase: "begun", transactionId: plan.transactionId, backupPath, stagedPath, targetVersion: plan.toVersion });
    await this.persist(state); await record(this.journal, "migration-begun", state); crash?.("after-begin");
    try {
      await mkdir(dirname(backupPath), { recursive: true, mode: 0o700 }); await rm(backupPath, { recursive: true, force: true }); await cp(this.activeHome, backupPath, { recursive: true, force: false }); await fsyncDirectory(dirname(backupPath));
      state = createState({ ...state, phase: "backup-created" }); await this.persist(state); await record(this.journal, "backup-created", state); crash?.("after-backup");
      await mkdir(dirname(stagedPath), { recursive: true, mode: 0o700 }); await rm(stagedPath, { recursive: true, force: true }); await plan.transform(this.activeHome, stagedPath); await fsyncDirectory(stagedPath); await fsyncDirectory(dirname(stagedPath));
      state = createState({ ...state, phase: "staged" }); await this.persist(state); await record(this.journal, "staged", state); crash?.("after-stage-fsync");
      const previous = this.confined(join(this.authorityRoot, `previous-${generation}`)); await rename(this.activeHome, previous); await rename(stagedPath, this.activeHome); crash?.("after-activate-rename"); await fsyncDirectory(this.authorityRoot); crash?.("after-activate-fsync"); await rm(previous, { recursive: true, force: true });
      state = createState({ installedVersion: plan.toVersion, generation, phase: "complete", transactionId: null, backupPath, stagedPath: null, targetVersion: null }); await this.persist(state); await record(this.journal, "activated", { ...state, transactionId: plan.transactionId, targetVersion: plan.toVersion }); return state;
    } catch (error) {
      if (error instanceof InstallerMigrationError && error.code === "INJECTED_CRASH") throw error;
      state = createState({ ...state, phase: "compensating" }); await this.persist(state); await record(this.journal, "compensating", state);
      try { crash?.("during-compensation"); await rm(this.activeHome, { recursive: true, force: true }); await cp(backupPath, this.activeHome, { recursive: true, force: false }); await fsyncDirectory(this.authorityRoot);
        state = createState({ installedVersion: plan.fromVersion, generation, phase: "compensated", transactionId: plan.transactionId, backupPath, stagedPath: null, targetVersion: plan.toVersion }); await this.persist(state); await record(this.journal, "compensated", state); return state;
      } catch { state = createState({ ...state, phase: "repair-required" }); await this.persist(state); await record(this.journal, "repair-required", state); return state; }
    }
  }
  async recover(): Promise<InstallerStateV1> {
    let state = await this.readState();
    if (state.phase === "complete" || state.phase === "compensated") return state;
    if (state.backupPath === null) { state = createState({ ...state, phase: "repair-required" }); await this.persist(state); return state; }
    const backup = this.confined(state.backupPath);
    try { await stat(backup); } catch { state = createState({ ...state, phase: "repair-required" }); await this.persist(state); return state; }
    await rm(this.activeHome, { recursive: true, force: true }); await cp(backup, this.activeHome, { recursive: true, force: false }); await fsyncDirectory(this.authorityRoot);
    state = createState({ installedVersion: state.installedVersion, generation: state.generation, phase: "compensated", transactionId: state.transactionId, backupPath: backup, stagedPath: null, targetVersion: state.targetVersion }); await this.persist(state); await record(this.journal, "compensated", state); return state;
  }
  async requireDowngrade(targetVersion: string, explicitMajorGate: boolean): Promise<void> {
    const state = await this.readState();
    const currentMajor = Number.parseInt(state.installedVersion.split(".")[0] ?? "", 10); const targetMajor = Number.parseInt(targetVersion.split(".")[0] ?? "", 10);
    if (!VERSION.test(targetVersion)) throw new InstallerMigrationError("INVALID_VERSION");
    if (currentMajor !== targetMajor && !explicitMajorGate) throw new InstallerMigrationError("DOWNGRADE_MAJOR_GATE_REQUIRED");
  }
  async markUninstallPending(transactionId: string): Promise<void> { const state = await this.readState(); await record(this.journal, "uninstall-pending", { ...state, transactionId }); }
  async markUninstalled(transactionId: string): Promise<void> { const state = await this.readState(); await record(this.journal, "uninstalled", { ...state, transactionId }); }
}

export async function copyMigrationFixture(sourceHome: string, stagedHome: string): Promise<void> {
  await cp(sourceHome, stagedHome, { recursive: true, force: false });
  await writeFile(join(stagedHome, "migration-ready"), "ready\n", { mode: 0o600 });
}
