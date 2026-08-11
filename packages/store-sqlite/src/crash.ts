export type CrashPoint =
  | "artifact.mkdir.before" | "artifact.mkdir.after"
  | "artifact.open.before" | "artifact.open.after"
  | "artifact.write.before" | "artifact.write.after"
  | "artifact.file-fsync.before" | "artifact.file-fsync.after"
  | "artifact.close.before" | "artifact.close.after"
  | "artifact.rename.before" | "artifact.rename.after"
  | "artifact.dir-fsync.before" | "artifact.dir-fsync.after"
  | "artifact.sql-reference.before" | "artifact.sql-reference.after"
  | "transaction.begin.before" | "transaction.begin.after"
  | "transaction.write.before" | "transaction.write.after"
  | "transaction.commit.before" | "transaction.commit.after"
  | "transaction.rollback.before" | "transaction.rollback.after";

export type CrashInjector = (point: CrashPoint) => void;

export class CrashInjectedError extends Error {
  constructor(readonly point: CrashPoint) {
    super(`crash injected at ${point}`);
    this.name = "CrashInjectedError";
  }
}

export function noCrash(point: CrashPoint): void { void point; }
