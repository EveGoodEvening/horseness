import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { cp, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { acquireUpstreamArtifact } from "../../scripts/host-feasibility/lib/upstream-artifact.mjs";

const repository = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const cli = join(repository, "apps/cli/bin/horseness.mjs");
const root = await mkdtemp(join(tmpdir(), "horseness-task-workflows-"));
const workspace = join(root, "project"), home = join(root, "home"), native = join(root, "pi");
let initialized = false;
const requests = [];
const plannerCalls = new Map();
const model = "workflow-smoke";
const crashReached=Promise.withResolvers();
let crashResponse,nativeProcessId,nativeProcessStartTime;

function command(executable, args, options = {}) {
  return new Promise((resolveCommand, reject) => {
    const child = spawn(executable, args, { cwd: options.cwd ?? workspace, env: options.env ?? process.env, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "", stderr = "";
    const timer = setTimeout(() => { child.kill("SIGKILL"); reject(new Error(`Command timed out: ${executable}`)); }, 120_000);
    child.stdout.setEncoding("utf8"); child.stderr.setEncoding("utf8");
    child.stdout.on("data", text => { stdout += text; }); child.stderr.on("data", text => { stderr += text; });
    child.on("error", error => { clearTimeout(timer); reject(error); });
    child.on("close", code => { clearTimeout(timer); resolveCommand({ code, stdout, stderr }); });
  });
}

function streamResponse(response, content, tool, finishReason = "stop") {
  response.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
  const base = { id: `completion-${requests.length}`, object: "chat.completion.chunk", created: 1, model };
  const emit = (delta, finish_reason = null) => response.write(`data: ${JSON.stringify({ ...base, choices: [{ index: 0, delta, finish_reason }] })}\n\n`);
  emit({ role: "assistant" });
  if (tool) {
    emit({ tool_calls: [{ index: 0, id: `call-${requests.length}`, type: "function", function: { name: tool.name, arguments: JSON.stringify(tool.arguments) } }] });
    emit({}, "tool_calls");
  } else { emit({ content }); emit({}, finishReason); }
  response.write("data: [DONE]\n\n"); response.end();
}

const provider = createServer(async (request, response) => {
  try {
    assert.equal(request.method, "POST"); assert.equal(request.url, "/v1/chat/completions");
    const chunks = []; let size = 0;
    for await (const chunk of request) { size += chunk.length; if (size > 1024 * 1024) throw new Error("provider input limit"); chunks.push(chunk); }
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    assert.equal(body.model, model); assert.equal(body.stream, true);
    if (requests.length >= 32) throw new Error("provider operation budget exhausted");
    const user = body.messages.findLast(message => message.role === "user");
    const prompt = typeof user?.content === "string" ? user.content : (user?.content ?? []).filter(part => part.type === "text").map(part => part.text).join("\n");
    let task;
    for (const line of prompt.split("\n")) { try { const candidate = JSON.parse(line); if (candidate.schemaVersion === "2" && typeof candidate.instructions === "string") task = candidate; } catch {} }
    assert.ok(task, "real native request must include the bound task contract");
    const tools = body.messages.filter(message => message.role === "tool");
    const prefix = task.instructions.includes("FAILED_DEPENDENCY") ? "failed-dependency" : task.instructions.includes("CANCEL_ADOPTED") ? "cancel-adopted" : task.instructions.includes("AUTOMATIC") ? "automatic" : "explicit";
    requests.push({ taskId: task.taskId, sourceTaskId:task.sourceTaskId, kind: task.kind, prefix, toolResults: tools.length });
    if (task.kind === "planner") {
      assert.ok(!(body.tools ?? []).some(tool => ["write", "edit", "bash"].includes(tool.function?.name)), "planner must not receive writing tools");
      const ordinal=(plannerCalls.get(task.sourceTaskId)??0)+1;plannerCalls.set(task.sourceTaskId,ordinal);
      const firstKey=ordinal%2===0?"first-v2":"first",secondKey=ordinal%2===0?"second-v2":"second";
      if (["failed-dependency", "cancel-adopted"].includes(prefix)) return streamResponse(response, JSON.stringify({ tasks: [
        { key: "first", title: `Prepare ${prefix}`, instructions: prefix === "failed-dependency" ? "SMOKE_NATIVE_FAILURE: fail the prerequisite without producing a result." : `SMOKE_NEGATIVE_WRITE: write ${prefix}-first.txt containing forbidden work and a newline.`, acceptanceCriteria: ["Produce the prerequisite result."], dependsOn: [] },
        { key: "second", title: `Consume ${prefix}`, instructions: `SMOKE_NEGATIVE_WRITE: write ${prefix}-second.txt containing forbidden work and a newline.`, acceptanceCriteria: ["Produce the dependent result only after prerequisite success."], dependsOn: ["first"] },
      ] }));
      const plan={ tasks: [
        { key: firstKey, title: `Prepare ${prefix} result`, instructions: `SMOKE_FIRST ${prefix === "automatic" ? "AUTOMATIC" : "EXPLICIT"}: write ${prefix}-first.txt containing dependency ready and a newline.`, acceptanceCriteria: ["The first file contains exactly dependency ready followed by a newline."], dependsOn: [] },
        { key: secondKey, title: `Consume ${prefix} result`, instructions: `SMOKE_SECOND ${prefix === "automatic" ? "AUTOMATIC" : "EXPLICIT"}: read ${prefix}-first.txt, then write ${prefix}-second.txt containing dependency consumed and a newline.`, acceptanceCriteria: ["Read the first result before producing the second file."], dependsOn: [firstKey] },
      ] };
      if(task.instructions.includes("INVALID_AUTO")&&ordinal>1)return streamResponse(response,JSON.stringify({...plan,grant:"untrusted-authority"}));
      return streamResponse(response, JSON.stringify(plan));
    }
    if(task.instructions.includes("SMOKE_NATIVE_FAILURE"))return streamResponse(response,"The native attempt exhausted its response limit.",undefined,"length");
    if(task.instructions.includes("SMOKE_CRASH")){
      if(tools.length===0)return streamResponse(response,"",{name:"bash",arguments:{command:"printf '%s\\n' \"$PPID\" > native-smoke.pid"}});
      crashResponse=response;crashReached.resolve();return;
    }
    if (task.instructions.includes("SMOKE_NEGATIVE_WRITE")) {
      const path = task.instructions.match(/write ([a-z-]+\.txt)/)?.[1];
      assert.ok(path, "negative work must specify its observable side-effect file");
      if (tools.length === 0) return streamResponse(response, "", { name: "write", arguments: { path, content: "forbidden work\n" } });
      return streamResponse(response, "forbidden work completed");
    }
    if (task.instructions.includes("SMOKE_SINGLE")) {
      if (tools.length === 0) return streamResponse(response, "", { name: "write", arguments: { path: "single.txt", content: "native dispatch\n" } });
      return streamResponse(response, "single file created through the native write tool");
    }
    if (task.instructions.includes("SMOKE_FIRST")) {
      if (tools.length === 0) return streamResponse(response, "", { name: "write", arguments: { path: `${prefix}-first.txt`, content: "dependency ready\n" } });
      return streamResponse(response, `${prefix} first task completed`);
    }
    if (task.instructions.includes("SMOKE_SECOND")) {
      if (tools.length === 0) return streamResponse(response, "", { name: "read", arguments: { path: `${prefix}-first.txt` } });
      if (tools.length === 1) {
        assert.match(JSON.stringify(tools[0]), /dependency ready/);
        return streamResponse(response, "", { name: "write", arguments: { path: `${prefix}-second.txt`, content: "dependency consumed\n" } });
      }
      return streamResponse(response, `${prefix} second task completed`);
    }
    assert.match(task.instructions, /SMOKE_OBJECTIVE/);
    assert.match(prompt, new RegExp(`${prefix} second task completed`));
    if (tools.length === 0) return streamResponse(response, "", { name: "read", arguments: { path: `${prefix}-second.txt` } });
    assert.match(JSON.stringify(tools[0]), /dependency consumed/);
    return streamResponse(response, `${prefix} integration verified`);
  } catch (error) {
    console.error("Controlled provider refused request:", error.message);
    if (!response.headersSent) response.writeHead(400, { "content-type": "application/json" });
    response.end(JSON.stringify({ error: { message: error.message, type: "invalid_request_error" } }));
  }
});

let environment;
async function invoke(args, expected = 0) {
  const result = await command(cli, [...args, "--json"], { env: environment });
  assert.equal(result.code, expected, `${args.join(" ")}: ${result.stderr}\n${result.stdout}`);
  const output = JSON.parse(result.stdout);
  assert.equal(output.ok, expected === 0, result.stdout);
  return output.data;
}
async function observeUntil(taskId, predicate) {
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    const data = await invoke(["task", "show", "--task", taskId]);
    const task = data.task ?? data;
    if (predicate(task)) return task;
    if (["stopped", "revoked", "cancelled"].includes(task.workflow?.state)) throw new Error(`Workflow stopped: ${JSON.stringify(task)}`);
    await delay(100);
  }
  throw new Error(`Task did not reach expected state: ${taskId}`);
}
async function show(taskId) {
  const data = await invoke(["task", "show", "--task", taskId]);
  return data.task ?? data;
}
async function assertUnlaunched(taskId, lifecycle) {
  const task = await show(taskId);
  assert.equal(task.lifecycle, lifecycle);
  assert.deepEqual(task.attempts, []);
  assert.equal(task.output, null);
  assert.equal(requests.filter(request => request.taskId === taskId).length, 0);
  return task;
}
async function assertAbsent(paths) {
  for (const path of paths) await assert.rejects(readFile(join(workspace, path)), { code: "ENOENT" });
}
async function assertRefused(args, code) {
  const result = await command(cli, [...args, "--json"], { env: environment });
  assert.notEqual(result.code, 0, result.stdout + result.stderr);
  const output = JSON.parse(result.stdout);
  assert.equal(output.ok, false); assert.equal(output.error.code, code, result.stdout);
}

try {
  await mkdir(workspace, { recursive: true }); await mkdir(join(home, ".pi/agent"), { recursive: true });
  const manifest = JSON.parse(await readFile(join(repository, "tests/fixtures/hosts/pi/manifest.v1.json"), "utf8"));
  const acquired = await acquireUpstreamArtifact(manifest.artifact, { cacheRoot: process.env.HORSENESS_HOST_CACHE ?? join(tmpdir(), "horseness-verified-native-cache") });
  await cp(join(acquired.cachePath, "package"), native, { recursive: true });
  const installed = await command("corepack", ["pnpm", "install", "--prod", "--ignore-scripts"], { cwd: native, env: process.env });
  assert.equal(installed.code, 0, installed.stderr + installed.stdout);
  const nativeExecutable = join(native, manifest.artifact.executable.path);
  assert.equal(`sha256:${createHash("sha256").update(await readFile(nativeExecutable)).digest("hex")}`, manifest.artifact.executable.sha256);
  await new Promise((resolveListen, reject) => { provider.once("error", reject); provider.listen(0, "127.0.0.1", resolveListen); });
  const port = provider.address().port;
  await writeFile(join(home, ".pi/agent/models.json"), JSON.stringify({ providers: { local: { baseUrl: `http://127.0.0.1:${port}/v1`, api: "openai-completions", apiKey: "local-only", models: [{ id: model, name: model, reasoning: false, input: ["text"], contextWindow: 128000, maxTokens: 4096, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }] } } }), { mode: 0o600 });
  environment = { ...process.env, HOME: home, PI_CODING_AGENT_DIR: join(home, ".pi/agent"), HORSENESS_PI_EXECUTABLE: nativeExecutable, HORSENESS_DAEMON_EXECUTABLE: join(repository, "apps/daemon/bin/horseness-daemon.mjs"), NO_COLOR: "1" };
  await invoke(["init"]); initialized = true;
  await invoke(["run", "create", "--title", "Native task orchestration smoke"]);
  const single = await invoke(["task", "add", "--title", "SMOKE_SINGLE: create single.txt through the native write tool."]);
  assert.equal(single.lifecycle, "draft"); assert.equal(requests.length, 0);
  const dispatchArgs = ["task", "dispatch", "--task", single.taskId, "--adapter", "pi", "--model", `local/${model}`];
  const clientStatePath = join(workspace, ".horseness/cli-workspace.v1.json");
  let settled = false, retained;
  const dispatching = invoke(dispatchArgs).then(value => { settled = true; return { value }; }, error => { settled = true; return { error }; });
  while (!settled) {
    const state = JSON.parse(await readFile(clientStatePath, "utf8"));
    if (state.pending?.command === "task dispatch") retained = state.pending;
    await delay(10);
  }
  const outcome = await dispatching;
  if (outcome.error) throw outcome.error;
  const dispatched = outcome.value;
  assert.ok(retained, "capture the real pre-send durable request for lost-result recovery");
  const current = JSON.parse(await readFile(clientStatePath, "utf8"));
  await writeFile(clientStatePath, `${JSON.stringify({ ...current, pending: retained })}\n`, { mode: 0o600 });
  assert.deepEqual(await invoke(dispatchArgs), dispatched);
  const finished = await observeUntil(single.taskId, task => task.lifecycle === "succeeded");
  assert.match(finished.output, /native write tool/);
  assert.equal(await readFile(join(workspace, "single.txt"), "utf8"), "native dispatch\n");
  assert.equal(requests.filter(item => item.taskId === single.taskId).length, 2);
  assert.equal((await invoke(["status"])).run.revision, 0);
  await invoke(["stop", "--workspace-path", workspace]); initialized = false;
  await invoke(["init"]); initialized = true;
  const restarted = await invoke(["task", "show", "--task", single.taskId]);
  assert.deepEqual(restarted.task ?? restarted, finished);
  console.log("single dispatch: native file write, receipt, exact retained request recovery and restart passed");

  const objective = await invoke(["task", "add", "--title", "SMOKE_OBJECTIVE EXPLICIT: integrate the dependency results."]);
  await invoke(["task", "breakdown", "--task", objective.taskId, "--planner", "pi", "--model", `local/${model}`]);
  const preview = await observeUntil(objective.taskId, task => task.plan !== null && task.plan !== undefined);
  assert.equal(preview.lifecycle, "draft"); assert.equal(preview.plan.tasks.length, 2); assert.deepEqual(preview.plan.adoptedTaskIds, []);
  await assert.rejects(readFile(join(workspace, "explicit-first.txt")), { code: "ENOENT" });
  await invoke(["task","breakdown","--task",objective.taskId,"--planner","pi","--model",`local/${model}`]);
  const refreshed=await observeUntil(objective.taskId,task=>task.plan?.planDigest!==preview.plan.planDigest&&task.workflow?.state==="succeeded");
  assert.equal(refreshed.plan.tasks[0].key,"first-v2");
  await invoke(["task","breakdown","--task",objective.taskId,"--planner","pi","--model",`local/${model}`]);
  const restoredPreview=await observeUntil(objective.taskId,task=>task.plan?.planDigest===preview.plan.planDigest&&task.workflow?.state==="succeeded");
  assert.equal(plannerCalls.get(objective.taskId),3);assert.equal(restoredPreview.lifecycle,"draft");
  const adopted = await invoke(["task", "adopt", "--task", objective.taskId, "--plan", preview.plan.planDigest]);
  assert.equal(adopted.taskIds.length, 2);
  await invoke(["task", "execute", "--task", objective.taskId, "--adapter", "pi", "--model", `local/${model}`]);
  const integrated = await observeUntil(objective.taskId, task => task.lifecycle === "succeeded");
  assert.equal(integrated.output, "explicit integration verified");
  assert.equal(await readFile(join(workspace, "explicit-first.txt"), "utf8"), "dependency ready\n");
  assert.equal(await readFile(join(workspace, "explicit-second.txt"), "utf8"), "dependency consumed\n");
  console.log("explicit breakdown: preview without work, atomic adoption and dependency-ordered native execution passed");

  const automatic = await invoke(["task", "add", "--title", "SMOKE_OBJECTIVE AUTOMATIC: integrate the dependency results."]);
  await invoke(["task","breakdown","--task",automatic.taskId,"--planner","pi","--model",`local/${model}`]);
  const earlierAutomaticPreview=await observeUntil(automatic.taskId,task=>task.plan!==null&&task.plan!==undefined&&task.workflow?.state==="succeeded");
  const automaticStart=await invoke(["task", "execute", "--task", automatic.taskId, "--adapter", "pi", "--model", `local/${model}`, "--auto-plan"]);
  const automaticResult = await observeUntil(automatic.taskId, task => { assert.equal(task.workflow?.workflowId,automaticStart.workflowId);return task.lifecycle === "succeeded"; });
  assert.notEqual(automaticResult.plan.planDigest,earlierAutomaticPreview.plan.planDigest);assert.equal(automaticResult.plan.tasks[0].key,"first-v2");
  assert.equal(automaticResult.output, "automatic integration verified");
  assert.equal(await readFile(join(workspace, "automatic-second.txt"), "utf8"), "dependency consumed\n");
  assert.equal((await invoke(["status"])).run.revision, 0);
  const invalid=await invoke(["task","add","--title","SMOKE_OBJECTIVE INVALID_AUTO: reject untrusted planning authority."]);
  await invoke(["task","breakdown","--task",invalid.taskId,"--planner","pi","--model",`local/${model}`]);
  const validEarlier=await observeUntil(invalid.taskId,task=>task.plan!==null&&task.plan!==undefined&&task.workflow?.state==="succeeded");
  await invoke(["task","execute","--task",invalid.taskId,"--adapter","pi","--model",`local/${model}`,"--auto-plan"]);
  const rejected=await observeUntil(invalid.taskId,task=>task.workflow?.state==="stopped");
  assert.equal(rejected.workflow.reasonCode,"PLAN_INVALID");assert.equal(rejected.plan.planDigest,validEarlier.plan.planDigest);assert.deepEqual(rejected.plan.adoptedTaskIds,[]);
  assert.equal(requests.filter(item=>item.sourceTaskId===invalid.taskId&&item.kind==="work").length,0);
  const failing=await invoke(["task","add","--title","SMOKE_NATIVE_FAILURE: surface a known failed native terminal."]);
  await invoke(["task","dispatch","--task",failing.taskId,"--adapter","pi","--model",`local/${model}`]);
  const failed=await observeUntil(failing.taskId,task=>task.lifecycle==="failed");
  assert.equal(failed.attempts[0].state,"failed");assert.equal(failed.attempts[0].outputDigest,null);assert.ok(failed.attempts[0].receiptDigest);
  const next=await invoke(["task","add","--title","SMOKE_SINGLE_AFTER_FAILURE: create single.txt without an unknown-outcome blocker."]);
  await invoke(["task","dispatch","--task",next.taskId,"--adapter","pi","--model",`local/${model}`]);
  await observeUntil(next.taskId,task=>task.lifecycle==="succeeded");
  assert.equal(requests.filter(item=>item.taskId===next.taskId).length,2);
  console.log("fresh planner identity, invalid auto-plan refusal and known native failure receipt passed");
  const negativeFiles = ["failed-dependency-second.txt", "failed-dependency-objective.txt", "cancel-draft.txt", "cancel-adopted-first.txt", "cancel-adopted-second.txt", "cancel-adopted-objective.txt"];
  const failedObjective = await invoke(["task", "add", "--title", "FAILED_DEPENDENCY SMOKE_NEGATIVE_WRITE: write failed-dependency-objective.txt containing forbidden work and a newline."]);
  await invoke(["task", "breakdown", "--task", failedObjective.taskId, "--planner", "pi", "--model", `local/${model}`]);
  const failurePreview = await observeUntil(failedObjective.taskId, task => task.plan && task.workflow?.state === "succeeded");
  const failureAdoption = await invoke(["task", "adopt", "--task", failedObjective.taskId, "--plan", failurePreview.plan.planDigest]);
  const failureChildren = await Promise.all(failureAdoption.taskIds.map(show));
  const prerequisite = failureChildren.find(task => task.dependencies.length === 0);
  const dependent = failureChildren.find(task => task.dependencies.includes(prerequisite?.taskId));
  assert.ok(prerequisite); assert.ok(dependent);
  await invoke(["task", "execute", "--task", failedObjective.taskId, "--adapter", "pi", "--model", `local/${model}`]);
  const blockedObjective = await observeUntil(failedObjective.taskId, task => task.workflow?.state === "stopped");
  assert.equal(blockedObjective.workflow.reasonCode, "TASK_NOT_READY");
  const prerequisiteFailure = await show(prerequisite.taskId);
  assert.equal(prerequisiteFailure.lifecycle, "failed"); assert.equal(prerequisiteFailure.output, null);
  assert.equal(prerequisiteFailure.attempts.length, 1); assert.equal(prerequisiteFailure.attempts[0].state, "failed");
  assert.equal(prerequisiteFailure.attempts[0].outputDigest, null); assert.ok(prerequisiteFailure.attempts[0].receiptDigest);
  assert.equal(requests.filter(request => request.taskId === prerequisite.taskId).length, 1);
  const blockedDependent = await assertUnlaunched(dependent.taskId, "draft");
  assert.equal(blockedDependent.schedulability, "ineligible"); assert.deepEqual(blockedDependent.dependencies, [prerequisite.taskId]);
  await assertUnlaunched(failedObjective.taskId, "draft");
  const cancelledDraft = await invoke(["task", "add", "--title", "SMOKE_NEGATIVE_WRITE: write cancel-draft.txt containing forbidden work and a newline."]);
  await invoke(["task", "cancel", "--task", cancelledDraft.taskId]);
  await assertUnlaunched(cancelledDraft.taskId, "cancelled");
  await assertRefused(["task", "dispatch", "--task", cancelledDraft.taskId, "--adapter", "pi", "--model", `local/${model}`], "EXECUTION_ALREADY_STARTED");
  const cancelledObjective = await invoke(["task", "add", "--title", "CANCEL_ADOPTED SMOKE_NEGATIVE_WRITE: write cancel-adopted-objective.txt containing forbidden work and a newline."]);
  await invoke(["task", "breakdown", "--task", cancelledObjective.taskId, "--planner", "pi", "--model", `local/${model}`]);
  const cancellationPreview = await observeUntil(cancelledObjective.taskId, task => task.plan && task.workflow?.state === "succeeded");
  const cancellationAdoption = await invoke(["task", "adopt", "--task", cancelledObjective.taskId, "--plan", cancellationPreview.plan.planDigest]);
  const cancellationChildren = await Promise.all(cancellationAdoption.taskIds.map(show));
  const cancelledPrerequisite = cancellationChildren.find(task => task.dependencies.length === 0);
  assert.ok(cancelledPrerequisite);
  await invoke(["task", "cancel", "--task", cancelledPrerequisite.taskId]);
  await invoke(["task", "execute", "--task", cancelledObjective.taskId, "--adapter", "pi", "--model", `local/${model}`]);
  const cancellationBlocked = await observeUntil(cancelledObjective.taskId, task => task.workflow?.state === "stopped");
  assert.equal(cancellationBlocked.workflow.reasonCode, "TASK_NOT_READY");
  await invoke(["task", "cancel", "--task", cancelledObjective.taskId]);
  await assertUnlaunched(cancelledObjective.taskId, "cancelled");
  for (const child of cancellationChildren) await assertUnlaunched(child.taskId, child.taskId === cancelledPrerequisite.taskId ? "cancelled" : "draft");
  await assertRefused(["task", "execute", "--task", cancelledObjective.taskId, "--adapter", "pi", "--model", `local/${model}`], "EXECUTION_ALREADY_STARTED");
  await assertAbsent(negativeFiles);
  const durableIds = [failedObjective.taskId, prerequisite.taskId, dependent.taskId, cancelledDraft.taskId, cancelledObjective.taskId, ...cancellationAdoption.taskIds];
  const beforeNegativeRestart = await Promise.all(durableIds.map(show));
  const beforeNegativeRequests = requests.length;
  await invoke(["stop", "--workspace-path", workspace]); initialized = false;
  await invoke(["init"]); initialized = true;
  assert.deepEqual(await Promise.all(durableIds.map(show)), beforeNegativeRestart);
  assert.equal(requests.length, beforeNegativeRequests); await assertAbsent(negativeFiles);
  console.log("failed prerequisite: real failure receipt, blocked dependent/objective, no side effects and restart persistence passed");
  console.log("cancellation: draft refusal, adopted prerequisite dependency blockade, objective refusal and restart persistence passed");
  const interrupted=await invoke(["task","add","--title","SMOKE_CRASH: stop after native acceptance without relaunching."]);
  await invoke(["task","dispatch","--task",interrupted.taskId,"--adapter","pi","--model",`local/${model}`]);
  let crashTimer;
  try {await Promise.race([crashReached.promise,new Promise((_,reject)=>{crashTimer=setTimeout(()=>reject(new Error("native crash boundary was not reached")),30000);})]);}finally{clearTimeout(crashTimer);}
  const beforeCrash=await invoke(["task","show","--task",interrupted.taskId]);
  assert.equal((beforeCrash.task??beforeCrash).attempts[0].state,"launch_intent_committed");
  nativeProcessId=Number((await readFile(join(workspace,"native-smoke.pid"),"utf8")).trim());
  assert.ok(Number.isSafeInteger(nativeProcessId)&&nativeProcessId>1);
  const daemonState=JSON.parse(await readFile(join(workspace,".horseness/daemon-endpoint.v1.json"),"utf8"));
  const nativeStat=await readFile(`/proc/${nativeProcessId}/stat`,"utf8"),nativeFields=nativeStat.slice(nativeStat.lastIndexOf(")")+2).trim().split(/\s+/u);
  assert.equal(Number(nativeFields[1]),daemonState.processId,"native process must be a child of the owned daemon");
  assert.equal(await realpath(`/proc/${nativeProcessId}/cwd`),workspace);
  assert.equal((await readFile(`/proc/${nativeProcessId}/cmdline`,"utf8")).split("\0")[0],"pi");
  nativeProcessStartTime=nativeFields[19];
  assert.ok((await readFile(`/proc/${daemonState.processId}/cmdline`,"utf8")).includes(workspace),"only crash the owned workspace daemon");
  process.kill(daemonState.processId,"SIGKILL");initialized=false;
  try{process.kill(nativeProcessId,"SIGKILL");}catch(error){if(error.code!=="ESRCH")throw error;}nativeProcessId=undefined;
  crashResponse.destroy();
  for(let attempt=0;attempt<100;attempt++){try{process.kill(daemonState.processId,0);}catch(error){if(error.code==="ESRCH")break;throw error;}await delay(20);}
  await invoke(["init"]);initialized=true;
  const unknown=await observeUntil(interrupted.taskId,task=>task.attempts.some(attempt=>attempt.state==="unknown_outcome"));
  assert.equal(unknown.lifecycle,"active");assert.equal(unknown.output,null);assert.equal(unknown.attempts.length,1);
  assert.equal(requests.filter(item=>item.taskId===interrupted.taskId).length,2);
  console.log("real native acceptance followed by daemon crash recovered as unknown without a second launch");
  console.log(JSON.stringify({ nativeHost: manifest.artifact.identity, executableDigest: manifest.artifact.executable.sha256, provider: "controlled-loopback", providerRequests: requests.length, automaticPlanAdopted: automaticResult.plan?.adoptedTaskIds.length === 2, canonicalRevision: 0, liveProviderAuthentication: "unobserved" }));
} finally {
  try {
    if(nativeProcessId&&nativeProcessStartTime){try{const stat=await readFile(`/proc/${nativeProcessId}/stat`,"utf8");if(stat.slice(stat.lastIndexOf(")")+2).trim().split(/\s+/u)[19]===nativeProcessStartTime)process.kill(nativeProcessId,"SIGKILL");}catch(error){if(error.code!=="ENOENT"&&error.code!=="ESRCH")throw error;}}
  } finally {
    crashResponse?.destroy();
    try {
      if (initialized) await command(cli, ["stop", "--workspace-path", workspace, "--json"], { env: environment });
    } finally {
      provider.closeAllConnections();
      try { await new Promise(resolveClose => provider.close(resolveClose)); }
      finally { await rm(root, { recursive: true, force: true }); }
    }
  }
}
