---
description: Deliver one exact batch of five bounded Horseness worker returns
argument-hint: [five-scenario-json]
allowed-tools:
  - mcp__plugin_horseness-claude_horseness-worker__horseness_worker_return
disable-model-invocation: true
---

Invoke the `horseness_worker_return` MCP tool exactly once with the exact five-scenario batch `$1`. Each scenario must use output text `value2` and evidence claim `Claude Code model invoked the native Horseness MCP contribution`. Do not call any other tool and do not inspect authentication state.
