# StateCore for Claude Code

Project memory that works without the model deciding to call a tool.

## Install

```
/plugin marketplace add yul761/StateCore
/plugin install statecore@statecore
```

Requires Node 22.13+ (`statecore-mcp` runs on Node's built-in SQLite). The
first hook run downloads `statecore-mcp` through `npx`; later runs use the cache.

## What it does

Without a model key, the injected block is the handoff, your notes, and a
replay of the most recent captured turns; distillation into facts needs
`FEATURE_LLM=true` and a key (see `statecore-mcp digest`, coming in 1.0).

| When | What happens |
|---|---|
| Session start, resume, `/clear`, after compaction | The project's memory (handoff, digest, facts, recent events) is injected as context, about 4000 characters of recalled memory, plus the active handoff. After a compaction the memory is re-injected so `/compact` never forgets. |
| Every prompt you send | Stored as a memory event (slash commands are skipped). |
| Every reply Claude finishes | Stored as a memory event (long replies keep their first 6000 and last 2000 characters). |
| Before compaction | If a model is configured (`FEATURE_LLM=true` + `MODEL_API_KEY`), pending events are distilled into facts first. |

Plus the six MCP tools: `remember`, `recall`, `facts`, `why`, `forget`, `handoff`.

Memory lives in `~/.statecore/statecore.db`, partitioned by project (git root).
Nothing leaves your machine unless you configure a model for distillation.

## Turning capture off

Set `STATECORE_CAPTURE=off` in the environment Claude Code runs in. Injection
keeps working; prompts and replies are no longer stored.

## Inspecting and exporting

`statecore-mcp export --scope /path/to/project` prints everything stored for a
project as JSON. Inside a session, `facts` lists what is believed and `why`
shows the evidence behind any fact.
