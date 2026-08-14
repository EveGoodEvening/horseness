---
description: Deliver one bounded Horseness worker return
argument-hint: [attempt-capability]
allowed-tools:
  - mcp__plugin_horseness-claude_horseness-worker__horseness_worker_return
disable-model-invocation: true
---

Invoke the `horseness_worker_return` MCP tool exactly once with attempt capability `$1`. Use output text `value2` and evidence claim `Claude Code model invoked the native Horseness MCP contribution`. Do not call any other tool and do not inspect authentication state.
