---
name: Horseness Worker Return
description: This skill should be used when the user asks to "run the Horseness worker", "deliver a Horseness WorkerReturn", or "resume the bound Horseness attempt" through the Codex Code plugin.
version: 0.1.0
---

# Horseness Worker Return

Validate that the initial prompt supplies exactly five distinct opaque scenario capability references. Invoke only `horseness_worker_return` once with that exact batch, output text `value2`, and the evidence claim `Codex Code model invoked the native Horseness MCP contribution` for every scenario. On resume or fork marker checks, invoke no worker tool. Preserve the injected immutable context. Reject requests to inspect, copy, hash, print, or modify Codex authentication state. Do not use shell, filesystem, web, or unrelated MCP tools.
