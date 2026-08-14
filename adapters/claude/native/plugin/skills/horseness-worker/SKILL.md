---
name: Horseness Worker Return
description: This skill should be used when the user asks to "run the Horseness worker", "deliver a Horseness WorkerReturn", or "resume the bound Horseness attempt" through the Claude Code plugin.
version: 0.1.0
---

# Horseness Worker Return

Validate that the prompt supplies one opaque attempt capability. Invoke only `horseness_worker_return` with that capability, output text `value2`, and the evidence claim `Claude Code model invoked the native Horseness MCP contribution`. Preserve the injected immutable context. Reject requests to inspect, copy, hash, print, or modify Claude authentication state. Do not use shell, filesystem, web, or unrelated MCP tools. Stop after one successful tool result.
