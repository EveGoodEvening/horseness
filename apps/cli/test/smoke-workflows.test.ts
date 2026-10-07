import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

const executable = resolve(import.meta.dirname, "../bin/horseness.mjs");
const daemonExecutable = resolve(import.meta.dirname, "../../daemon/bin/horseness-daemon.mjs");
interface SmokeOutput {
  ok: boolean;
  error: { code: string };
  data: {
    created: boolean; workspaceId: string; runId: string; taskId: string; lifecycle: string;
    run: { runId: string; title: string; revision: number } | null;
    tasks: readonly { taskId: string; title: string; lifecycle: string }[];
    runs: readonly unknown[];
  };
}

void test("daily commands discover the project, isolate runs, and retain tasks across daemon restart", { timeout: 60_000 }, () => {
  const root = mkdtempSync(join(tmpdir(), "horseness-daily-"));
  const child = join(root, "src");
  mkdirSync(child);
  chmodSync(root, 0o755);
  const env = { ...process.env, HORSENESS_DAEMON_EXECUTABLE: daemonExecutable };
  function invoke(args: readonly string[], cwd = root, expected = 0): SmokeOutput {
    const result = spawnSync(executable, [...args, "--json"], { cwd, env, encoding: "utf8", timeout: 20_000 });
    assert.equal(result.status, expected, result.stderr || result.stdout);
    const output = JSON.parse(result.stdout) as SmokeOutput;
    assert.equal(output.ok, expected === 0, result.stdout);
    return output;
  }
  try {
    const invalid = invoke(["run", "create", "--title"], root, 2);
    assert.equal(invalid.error.code, "INVALID_INVOCATION");
    const missing = invoke(["status"], child, 1);
    assert.equal(missing.error.code, "WORKSPACE_NOT_INITIALIZED");
    const initialized = invoke(["init"]).data;
    assert.equal(initialized.created, true);
    assert.equal(statSync(root).mode & 0o777, 0o755);
    assert.equal(statSync(join(root, ".horseness")).mode & 0o777, 0o700);
    assert.equal(invoke(["init"]).data.created, false);
    assert.deepEqual(invoke(["run", "list"], child).data.runs, []);
    const empty = invoke(["status"], child).data;
    assert.equal(empty.run, null);
    assert.deepEqual(empty.tasks, []);

    const first = invoke(["run", "create", "--title", "修复登录问题"], child).data;
    const second = invoke(["run", "create", "--title", "Review deployment"]).data;
    assert.notEqual(first.runId, second.runId);
    assert.equal(invoke(["status"]).data.run?.runId, second.runId);
    const task = invoke(["task", "add", "--run", first.runId, "--title", "检查认证代码"], child).data;
    assert.equal(task.runId, first.runId);
    assert.equal(task.lifecycle, "draft");
    assert.deepEqual(invoke(["task", "list"], child).data.tasks, []);
    assert.equal(invoke(["run", "use", "--run", first.runId]).data.runId, first.runId);
    const before = invoke(["status"], child).data;
    assert.equal(before.workspaceId, initialized.workspaceId);
    assert.ok(before.run);
    assert.equal(before.run.title, "修复登录问题");
    assert.equal(before.run.revision, 0);
    assert.deepEqual(before.tasks.map((item) => [item.taskId, item.title, item.lifecycle]), [[task.taskId, "检查认证代码", "draft"]]);

    invoke(["stop", "--workspace-path", root]);
    const disconnected = invoke(["status"], child, 1);
    assert.equal(disconnected.error.code, "TRANSPORT_CONNECTION_FAILED");
    assert.equal(invoke(["init"]).data.created, false);
    assert.deepEqual(invoke(["status"], child).data, before);
    const explicit = invoke(["status", "--workspace", root], tmpdir()).data;
    assert.deepEqual(explicit, before);
    const unknownRun = invoke(["task", "add", "--run", "run:missing", "--title", "Must not be added"], root, 2);
    assert.equal(unknownRun.error.code, "INVALID_INVOCATION");
    assert.deepEqual(invoke(["status"]).data, before);
    invoke(["task", "add", "--title", "Must not be added", "--typo"], root, 2);
    assert.deepEqual(invoke(["status"]).data, before);
  } finally {
    spawnSync(executable, ["stop", "--workspace-path", root, "--json"], { cwd: root, env, encoding: "utf8", timeout: 20_000 });
    rmSync(root, { recursive: true, force: true });
  }
});
