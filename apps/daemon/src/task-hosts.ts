import { join } from "node:path";
import { domainDigest, type NativeTaskAdapterIdV1 } from "@horseness/domain";
import type { ExecutionHostDriverV1 } from "@horseness/orchestrator";
import type { NativeTaskAdapterOptionsV1, NativeTaskAdapterSessionV1, NativeTaskProfileOptionsV1 } from "@horseness/adapter-kit";
import { createPiTaskAdapterV1, resolvePiTaskProfileV1 } from "@horseness/adapter-pi";
import { createOMPTaskAdapterV1, resolveOMPTaskProfileV1 } from "@horseness/adapter-omp";
import { createClaudeTaskAdapterV1, resolveClaudeTaskProfileV1 } from "@horseness/adapter-claude";
import { createCodexTaskAdapterV1, resolveCodexTaskProfileV1 } from "@horseness/adapter-codex";
import type { TaskExecutionProfileV1 } from "@horseness/domain";

const HOSTS: Record<NativeTaskAdapterIdV1, {
  resolve(options: NativeTaskProfileOptionsV1): Promise<TaskExecutionProfileV1>;
  create(options: NativeTaskAdapterOptionsV1): Promise<NativeTaskAdapterSessionV1>;
  executableVariable: string;
}> = {
  pi: { resolve: resolvePiTaskProfileV1, create: createPiTaskAdapterV1, executableVariable: "HORSENESS_PI_EXECUTABLE" },
  omp: { resolve: resolveOMPTaskProfileV1, create: createOMPTaskAdapterV1, executableVariable: "HORSENESS_OMP_EXECUTABLE" },
  claude: { resolve: resolveClaudeTaskProfileV1, create: createClaudeTaskAdapterV1, executableVariable: "HORSENESS_CLAUDE_EXECUTABLE" },
  codex: { resolve: resolveCodexTaskProfileV1, create: createCodexTaskAdapterV1, executableVariable: "HORSENESS_CODEX_EXECUTABLE" },
};

/** Executable overrides come from the owner daemon environment, never task or planner data. */
export function createTaskHostDriverV1(workspacePath: string, stateRoot: string): ExecutionHostDriverV1 {
  return {
    async resolve(adapterId, model, purpose, effort) {
      const host = HOSTS[adapterId], executablePath = process.env[host.executableVariable];
      return host.resolve({ workspacePath, model, purpose, effort, ...(executablePath ? { executablePath } : {}) });
    },
    async open(prepared, binding) {
      const profile = prepared.profile;
      const directory = domainDigest("horseness.task-attempt-directory.v1", { workspaceId: binding.workspaceId, runId: binding.runId, attemptId: binding.attemptId, generation: binding.generation });
      return HOSTS[profile.adapterId].create({ binding, profile, workspacePath, stateDirectory: join(stateRoot, "task-attempts", directory), renderedContext: prepared.renderedContext,
        producerPrincipalId: prepared.binding.allowedProducerPrincipalId, producerGrantDigest: prepared.binding.allowedProducerGrantDigest,
        model: profile.adapterId === "pi" || profile.adapterId === "omp" ? `${profile.providerId}/${profile.modelId}` : profile.modelId,
        ...(profile.effort === undefined ? {} : { effort: profile.effort }), purpose: profile.purpose, executablePath: profile.nativeExecutablePath, timeoutMs: profile.timeoutMs });
    },
  };
}
