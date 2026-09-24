---
"statecore-mcp": minor
---

`statecore-mcp hook <session-start|user-prompt|stop|pre-compact>` reads a Claude Code hook payload from stdin and captures the conversation into project memory (keyed, idempotent stream events) or injects the project's memory as `hookSpecificOutput.additionalContext`. A Claude Code plugin (`plugins/claude-code`, marketplace `yul761/StateCore`) wires the four events and the MCP server. `STATECORE_CAPTURE=off` disables capture. The embedded backend gains an optional `capture({ text, key })` method.
