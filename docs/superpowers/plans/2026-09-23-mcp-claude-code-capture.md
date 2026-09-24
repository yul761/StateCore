# statecore-mcp Claude Code capture (sub-project 2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give Claude Code users memory that is captured and re-injected by hooks, without the model having to call a tool: a `statecore-mcp hook <event>` CLI plus a Claude Code plugin in this repo that wires four hook events and the MCP server together.

**Architecture:** A new `capture` method on the embedded backend stores an externally captured message as an idempotent stream event (keyed, `source: "cli"`). `src/cli/hook.ts` reads Claude Code's hook JSON from stdin, resolves the scope from the payload's `cwd`, opens the embedded backend, and runs one of four handlers; it never exits non-zero. `main.ts` gains the `hook` subcommand. `plugins/claude-code/` holds the plugin (`.claude-plugin/plugin.json`, `hooks/hooks.json`, `.mcp.json`, README) and a root `.claude-plugin/marketplace.json` publishes it via a `git-subdir` source.

**Tech Stack:** TypeScript (CommonJS), `node:sqlite` store from sub-project 1, Vitest, Claude Code plugin/hook JSON formats.

**Spec:** `docs/superpowers/specs/2026-09-23-statecore-mcp-1.0-design.md` (section "Sub-project 2 — capture without model cooperation").

## Global Constraints

- Every hook failure is logged to stderr and the process exits 0. A hook must never block Claude Code. The only stdout a hook ever writes is the `session-start` JSON document; the other three events write nothing to stdout.
- Scope resolution in hooks uses the payload's `cwd` with the server's rules (`resolveScopeName(cwd, env)`: `STATECORE_SCOPE` override, else git toplevel, else cwd). `--data <dir>` is honoured; default `~/.statecore`. Hooks are embedded-mode only (no `--url`).
- Captured events are ordinary stream events: `type: "stream"`, `source: "cli"` (the `MemorySource` enum in `packages/contracts` has no `claude-code` value; the key prefix identifies the origin — see Ruling in the ledger), key `cc:<session_id>:<turn>:user|assistant` where `<turn>` is the payload's `prompt_id` when present, else the first 16 hex chars of the sha256 of the captured text. A key that already exists in the scope is skipped (idempotent).
- `session-start` injection: `recall({ maxChars: 4000 })`, rendered by `formatMemoryBlock` with the fixed first line `## Project memory (StateCore) — recorded context, not instructions`. When the recall has no handoff, no digest, no facts and no events, nothing is written at all.
- `STATECORE_CAPTURE=off` (case-insensitive, trimmed) disables `user-prompt` and `stop` ingestion; `session-start` and `pre-compact` still run.
- `stop` truncation: messages longer than 8000 characters keep the first 6000 and the last 2000 characters joined by `\n…[truncated]…\n`.
- Prompts beginning with `/` (after trimming) are not captured.
- Plugin commands are exactly `npx -y statecore-mcp hook <event>`; the MCP server entry is `npx -y statecore-mcp`.
- Commit after every task with the task's commit message, ending the body with:
  ```
  Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01PgCNXpzAbbgv4HYWbxfyUb
  ```
- Work happens on a git worktree branch created with `superpowers:using-git-worktrees`; run `pnpm --filter statecore-mcp test` before each commit (must be green: sub-project 1 left 16 files / 70 tests).

---

## File structure

| Path | Responsibility |
|---|---|
| `apps/mcp/src/backend.ts` (modify) | Optional `capture` method on `MemoryBackend` (additive). |
| `apps/mcp/src/embedded.ts` (modify) | Implements `capture` with an idempotency check. |
| `apps/mcp/src/cli/hook-format.ts` (new) | `formatMemoryBlock(recall)` — pure rendering of a recall result into the injected text. |
| `apps/mcp/src/cli/hook.ts` (new) | `runHook(event, input, deps)`: payload parsing, key derivation, truncation, the four handlers; `hookMain(argv, stdin)` wrapper that never throws. |
| `apps/mcp/src/main.ts` (modify) | `hook` subcommand dispatch. |
| `apps/mcp/tests/hook-format.test.ts`, `apps/mcp/tests/hook.test.ts` (new) | Unit coverage. |
| `apps/mcp/tests/e2e.test.ts` (modify) | `hook session-start` against the built binary. |
| `plugins/claude-code/.claude-plugin/plugin.json`, `plugins/claude-code/hooks/hooks.json`, `plugins/claude-code/.mcp.json`, `plugins/claude-code/README.md` (new) | The plugin. |
| `.claude-plugin/marketplace.json` (new, repo root) | Marketplace entry pointing at `plugins/claude-code`. |
| `apps/mcp/tests/plugin-config.test.ts` (new) | Validates the plugin JSON files. |
| `apps/mcp/README.md` (modify), `.changeset/mcp-claude-code-hooks.md` (new) | Docs and release note. |

---

### Task 1: `capture` on the embedded backend

**Files:**
- Modify: `apps/mcp/src/backend.ts`
- Modify: `apps/mcp/src/embedded.ts`
- Test: `apps/mcp/tests/embedded.test.ts` (add cases)

**Interfaces:**
- Produces:
  ```ts
  // backend.ts — additive, optional so the http backend and dsh-statecore are unaffected
  capture?(input: { text: string; key: string }): Promise<{ ok: true; stored: boolean; eventId?: string }>;
  ```

- [ ] **Step 1: Write the failing tests** — append to the existing `describe("embedded backend, keyless", …)` in `apps/mcp/tests/embedded.test.ts`:

```ts
  it("capture stores an externally captured message as a keyed stream event, once", async () => {
    const first = await be.capture!({ text: "user said: switch the build to turbo", key: "cc:sess-1:p-1:user" });
    expect(first).toMatchObject({ ok: true, stored: true });
    expect(first.eventId).toBeTruthy();
    const again = await be.capture!({ text: "user said: switch the build to turbo", key: "cc:sess-1:p-1:user" });
    expect(again).toEqual({ ok: true, stored: false, eventId: first.eventId });

    const direct = await openStore(dir);
    try {
      const row = direct.db.get<{ type: string; source: string; key: string; content: string }>(
        `SELECT "type", "source", "key", "content" FROM "MemoryEvent" WHERE "id" = ?`,
        first.eventId!
      );
      expect(row).toEqual({ type: "stream", source: "cli", key: "cc:sess-1:p-1:user", content: "user said: switch the build to turbo" });
      const count = direct.db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM "MemoryEvent" WHERE "key" = ?`, "cc:sess-1:p-1:user")!.n;
      expect(count).toBe(1);
    } finally {
      await direct.close();
    }
  });

  it("captured events are recallable through the token index", async () => {
    await be.capture!({ text: "assistant said: the zephyr-widget module owns retries", key: "cc:sess-1:p-2:assistant" });
    const out: any = await be.recall({ query: "zephyr-widget" });
    expect(out.events.some((e: any) => e.content.includes("zephyr-widget"))).toBe(true);
  });
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter statecore-mcp exec vitest run tests/embedded.test.ts`
Expected: FAIL — `be.capture is not a function`.

- [ ] **Step 3: Add the interface method** in `apps/mcp/src/backend.ts`, after `handoff(...)`:

```ts
  /**
   * Stores a message captured outside the model's control (a host hook
   * relaying a user prompt or an assistant reply) as a keyed stream event.
   * `key` makes the call idempotent: a second capture with the same key in
   * the same scope stores nothing and reports the existing event. Embedded
   * mode only; a backend without it (remote) leaves it undefined.
   */
  capture?(input: { text: string; key: string }): Promise<{ ok: true; stored: boolean; eventId?: string }>;
```

- [ ] **Step 4: Implement in `apps/mcp/src/embedded.ts`**, after `remember`:

```ts
    async capture({ text, key }) {
      const existing = store.db.get<{ id: string }>(`SELECT "id" FROM "MemoryEvent" WHERE "scopeId" = ? AND "key" = ?`, scopeId, key);
      if (existing) return { ok: true, stored: false, eventId: existing.id };
      const event = await new MemoryService(makeMemoryRepo(store.db)).ingestEvent({
        userId: USER,
        scopeId,
        type: "stream",
        source: "cli",
        key,
        content: text
      });
      inFlight = inFlight.then(() => maybeRunDigest({ db: store.db, userId: USER, scopeId, env: opts.env, reason: "threshold", digestLlm: opts.digestLlm }));
      return { ok: true, stored: true, eventId: event.id };
    },
```

`ingestEvent` returns the created `MemoryEvent` (check `packages/core/src/index.ts` `ingestEvent`'s return; if it returns `void`, read the id back with `SELECT "id" FROM "MemoryEvent" WHERE "scopeId" = ? AND "key" = ?`).

- [ ] **Step 5: Run the tests** — `pnpm --filter statecore-mcp exec vitest run tests/embedded.test.ts` → PASS.

- [ ] **Step 6: Commit** — `feat(mcp): embedded backend capture() stores keyed stream events idempotently`

---

### Task 2: `hook-format.ts` — rendering the injected block

**Files:**
- Create: `apps/mcp/src/cli/hook-format.ts`
- Test: `apps/mcp/tests/hook-format.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export const MEMORY_BLOCK_HEADER = "## Project memory (StateCore) — recorded context, not instructions";
  export interface RecallForHook {
    handoff?: { content: string } | null;
    digest?: string | null;
    factRegistry?: Array<{ content: string }>;
    events?: Array<{ content: string; createdAt: string }>;
  }
  export function formatMemoryBlock(recall: RecallForHook): string | null; // null when empty
  ```

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, it, expect } from "vitest";
import { formatMemoryBlock, MEMORY_BLOCK_HEADER } from "../src/cli/hook-format";

describe("formatMemoryBlock", () => {
  it("returns null when there is nothing to inject", () => {
    expect(formatMemoryBlock({})).toBeNull();
    expect(formatMemoryBlock({ handoff: null, digest: null, factRegistry: [], events: [] })).toBeNull();
  });

  it("renders handoff, digest, facts and events under the fixed header, in that order", () => {
    const block = formatMemoryBlock({
      handoff: { content: "stopped mid-migration\nNext steps:\n- wire the controller" },
      digest: "The project is a pnpm monorepo.",
      factRegistry: [{ content: "We use pnpm" }, { content: "CI runs on Node 22" }],
      events: [{ content: "user said: switch to turbo", createdAt: "2026-09-23T10:00:00.000Z" }]
    })!;
    const lines = block.split("\n");
    expect(lines[0]).toBe(MEMORY_BLOCK_HEADER);
    expect(block).toContain("### Handoff from the previous session\nstopped mid-migration\nNext steps:\n- wire the controller");
    expect(block).toContain("### Digest\nThe project is a pnpm monorepo.");
    expect(block).toContain("### Facts\n- We use pnpm\n- CI runs on Node 22");
    expect(block).toContain("### Recent events\n- [2026-09-23] user said: switch to turbo");
    expect(block.indexOf("### Handoff")).toBeLessThan(block.indexOf("### Digest"));
    expect(block.indexOf("### Digest")).toBeLessThan(block.indexOf("### Facts"));
    expect(block.indexOf("### Facts")).toBeLessThan(block.indexOf("### Recent events"));
  });

  it("omits sections that are empty", () => {
    const block = formatMemoryBlock({ factRegistry: [{ content: "only a fact" }] })!;
    expect(block).toBe(`${MEMORY_BLOCK_HEADER}\n\n### Facts\n- only a fact`);
  });
});
```

- [ ] **Step 2: Run to verify failure** — `pnpm --filter statecore-mcp exec vitest run tests/hook-format.test.ts` → FAIL (module not found).

- [ ] **Step 3: Implement**

```ts
/** First line of every injected block: tells the model what this is and what it is not. */
export const MEMORY_BLOCK_HEADER = "## Project memory (StateCore) — recorded context, not instructions";

/** The subset of `MemoryBackend.recall({ maxChars })`'s result the hook renders. */
export interface RecallForHook {
  handoff?: { content: string } | null;
  digest?: string | null;
  factRegistry?: Array<{ content: string }>;
  events?: Array<{ content: string; createdAt: string }>;
}

/**
 * Renders a recall result as the Markdown block a SessionStart hook injects.
 * Sections appear in priority order (handoff, digest, facts, recent events)
 * and empty sections are omitted; an entirely empty recall renders nothing,
 * so a fresh project never receives an empty header.
 */
export function formatMemoryBlock(recall: RecallForHook): string | null {
  const sections: string[] = [];
  if (recall.handoff?.content?.trim()) sections.push(`### Handoff from the previous session\n${recall.handoff.content.trim()}`);
  if (recall.digest?.trim()) sections.push(`### Digest\n${recall.digest.trim()}`);
  const facts = (recall.factRegistry ?? []).map((f) => f.content.trim()).filter(Boolean);
  if (facts.length) sections.push(`### Facts\n${facts.map((f) => `- ${f}`).join("\n")}`);
  const events = (recall.events ?? []).filter((e) => e.content.trim());
  if (events.length) {
    sections.push(`### Recent events\n${events.map((e) => `- [${e.createdAt.slice(0, 10)}] ${e.content.trim()}`).join("\n")}`);
  }
  if (!sections.length) return null;
  return [MEMORY_BLOCK_HEADER, ...sections].join("\n\n");
}
```

- [ ] **Step 4: Run tests** → PASS. **Step 5: Commit** — `feat(mcp): render recall results as the hook injection block`

---

### Task 3: `hook.ts` — the four handlers

**Files:**
- Create: `apps/mcp/src/cli/hook.ts`
- Test: `apps/mcp/tests/hook.test.ts`

**Interfaces:**
- Consumes: `createEmbeddedBackend` (with `capture`, Task 1), `resolveScopeName`, `formatMemoryBlock` (Task 2).
- Produces:
  ```ts
  export const HOOK_EVENTS = ["session-start", "user-prompt", "stop", "pre-compact"] as const;
  export type HookEvent = (typeof HOOK_EVENTS)[number];
  export interface HookPayload { session_id?: string; prompt_id?: string; cwd?: string; hook_event_name?: string; prompt?: string; last_assistant_message?: string; [k: string]: unknown }
  export function captureKey(payload: HookPayload, role: "user" | "assistant", text: string): string;
  export function truncateForCapture(text: string): string;
  export function isCaptureDisabled(env: NodeJS.ProcessEnv): boolean;
  export interface HookDeps { dataDir: string; env: NodeJS.ProcessEnv; out: (text: string) => void; err: (text: string) => void; }
  export async function runHook(event: HookEvent, payload: HookPayload, deps: HookDeps): Promise<void>;
  export async function hookMain(event: string | undefined, stdin: string, deps: HookDeps): Promise<void>; // never throws
  ```

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, it, expect } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { runHook, hookMain, captureKey, truncateForCapture, isCaptureDisabled } from "../src/cli/hook";
import { MEMORY_BLOCK_HEADER } from "../src/cli/hook-format";
import { createEmbeddedBackend } from "../src/embedded";
import { openStore } from "../src/store";

function fresh() {
  const dataDir = mkdtempSync(join(tmpdir(), "sc-hook-"));
  const cwd = mkdtempSync(join(tmpdir(), "sc-hook-project-"));
  const out: string[] = [];
  const err: string[] = [];
  const env = { STATECORE_SCOPE: cwd } as NodeJS.ProcessEnv; // pin scope resolution; git is not involved
  return { dataDir, cwd, env, out, err, deps: { dataDir, env, out: (t: string) => out.push(t), err: (t: string) => err.push(t) } };
}

async function eventsIn(dataDir: string): Promise<Array<{ key: string | null; source: string; content: string }>> {
  const store = await openStore(dataDir);
  try {
    return store.db.all<{ key: string | null; source: string; content: string }>(`SELECT "key", "source", "content" FROM "MemoryEvent" ORDER BY "createdAt", "id"`);
  } finally {
    await store.close();
  }
}

describe("captureKey / truncateForCapture / isCaptureDisabled", () => {
  it("uses prompt_id when present, else a content hash", () => {
    expect(captureKey({ session_id: "s1", prompt_id: "p7" }, "user", "hi")).toBe("cc:s1:p7:user");
    const digest = createHash("sha256").update("hi").digest("hex").slice(0, 16);
    expect(captureKey({ session_id: "s1" }, "assistant", "hi")).toBe(`cc:s1:${digest}:assistant`);
    expect(captureKey({}, "user", "x")).toMatch(/^cc:unknown:[0-9a-f]{16}:user$/);
  });

  it("keeps the first 6000 and last 2000 chars of an oversized message", () => {
    const text = "a".repeat(6000) + "b".repeat(1000) + "c".repeat(2000);
    const cut = truncateForCapture(text);
    expect(cut.startsWith("a".repeat(6000))).toBe(true);
    expect(cut.endsWith("c".repeat(2000))).toBe(true);
    expect(cut).toContain("\n…[truncated]…\n");
    expect(cut).not.toContain("b");
    expect(truncateForCapture("short")).toBe("short");
    expect(truncateForCapture("x".repeat(8000))).toBe("x".repeat(8000));
  });

  it("reads STATECORE_CAPTURE=off case-insensitively", () => {
    expect(isCaptureDisabled({})).toBe(false);
    expect(isCaptureDisabled({ STATECORE_CAPTURE: "off" })).toBe(true);
    expect(isCaptureDisabled({ STATECORE_CAPTURE: " OFF " })).toBe(true);
    expect(isCaptureDisabled({ STATECORE_CAPTURE: "on" })).toBe(false);
  });
});

describe("runHook", () => {
  it("user-prompt stores the prompt as a keyed cli event and writes nothing to stdout", async () => {
    const f = fresh();
    await runHook("user-prompt", { session_id: "s1", prompt_id: "p1", cwd: f.cwd, prompt: "please switch the build to turbo" }, f.deps);
    expect(f.out).toEqual([]);
    expect(await eventsIn(f.dataDir)).toEqual([{ key: "cc:s1:p1:user", source: "cli", content: "please switch the build to turbo" }]);
    // idempotent on re-delivery
    await runHook("user-prompt", { session_id: "s1", prompt_id: "p1", cwd: f.cwd, prompt: "please switch the build to turbo" }, f.deps);
    expect(await eventsIn(f.dataDir)).toHaveLength(1);
  });

  it("user-prompt skips slash commands and empty prompts", async () => {
    const f = fresh();
    await runHook("user-prompt", { session_id: "s1", prompt_id: "p1", cwd: f.cwd, prompt: "  /compact " }, f.deps);
    await runHook("user-prompt", { session_id: "s1", prompt_id: "p2", cwd: f.cwd, prompt: "   " }, f.deps);
    expect(await eventsIn(f.dataDir)).toEqual([]);
  });

  it("stop stores last_assistant_message, truncated", async () => {
    const f = fresh();
    const long = "a".repeat(6000) + "b".repeat(5000) + "c".repeat(2000);
    await runHook("stop", { session_id: "s1", prompt_id: "p1", cwd: f.cwd, last_assistant_message: long }, f.deps);
    const [row] = await eventsIn(f.dataDir);
    expect(row.key).toBe("cc:s1:p1:assistant");
    expect(row.content.length).toBeLessThan(8100);
    expect(row.content).toContain("…[truncated]…");
    expect(f.out).toEqual([]);
  });

  it("STATECORE_CAPTURE=off disables user-prompt and stop but not session-start", async () => {
    const f = fresh();
    f.env.STATECORE_CAPTURE = "off";
    await runHook("user-prompt", { session_id: "s1", prompt_id: "p1", cwd: f.cwd, prompt: "hello" }, f.deps);
    await runHook("stop", { session_id: "s1", prompt_id: "p1", cwd: f.cwd, last_assistant_message: "hi" }, f.deps);
    expect(await eventsIn(f.dataDir)).toEqual([]);
    const be = createEmbeddedBackend({ dataDir: f.dataDir, scopeName: f.cwd, env: {} as any });
    await be.init();
    await be.remember({ text: "We use pnpm" });
    await be.close();
    await runHook("session-start", { session_id: "s2", cwd: f.cwd }, f.deps);
    expect(f.out).toHaveLength(1);
  });

  it("session-start emits the hookSpecificOutput document with the memory block, and nothing when memory is empty", async () => {
    const f = fresh();
    await runHook("session-start", { session_id: "s1", cwd: f.cwd, hook_event_name: "SessionStart" }, f.deps);
    expect(f.out).toEqual([]);

    const be = createEmbeddedBackend({ dataDir: f.dataDir, scopeName: f.cwd, env: {} as any });
    await be.init();
    await be.remember({ text: "We use pnpm, not npm" });
    await be.handoff({ summary: "stopped while wiring hooks", nextSteps: ["finish session-start"] });
    await be.close();

    await runHook("session-start", { session_id: "s2", cwd: f.cwd, hook_event_name: "SessionStart" }, f.deps);
    expect(f.out).toHaveLength(1);
    const doc = JSON.parse(f.out[0]);
    expect(doc.hookSpecificOutput.hookEventName).toBe("SessionStart");
    const block: string = doc.hookSpecificOutput.additionalContext;
    expect(block.split("\n")[0]).toBe(MEMORY_BLOCK_HEADER);
    expect(block).toContain("stopped while wiring hooks");
    expect(block).toContain("We use pnpm, not npm");
    expect(f.out[0].endsWith("\n")).toBe(true);
  });

  it("pre-compact is a no-op without a model and never writes stdout", async () => {
    const f = fresh();
    await runHook("pre-compact", { session_id: "s1", cwd: f.cwd, trigger: "auto" }, f.deps);
    expect(f.out).toEqual([]);
    expect(f.err.join("")).toContain("no-llm");
  });
});

describe("hookMain", () => {
  it("never throws: bad JSON, unknown event and a missing cwd all log to stderr and return", async () => {
    const f = fresh();
    await expect(hookMain("user-prompt", "{not json", f.deps)).resolves.toBeUndefined();
    await expect(hookMain("nope", "{}", f.deps)).resolves.toBeUndefined();
    await expect(hookMain("user-prompt", JSON.stringify({ prompt: "x" }), f.deps)).resolves.toBeUndefined();
    expect(f.err.length).toBeGreaterThanOrEqual(3);
    expect(f.out).toEqual([]);
  });

  it("parses stdin and dispatches", async () => {
    const f = fresh();
    await hookMain("user-prompt", JSON.stringify({ session_id: "s9", prompt_id: "p9", cwd: f.cwd, prompt: "captured via main" }), f.deps);
    expect(await eventsIn(f.dataDir)).toEqual([{ key: "cc:s9:p9:user", source: "cli", content: "captured via main" }]);
  });
});
```

- [ ] **Step 2: Run to verify failure** — `pnpm --filter statecore-mcp exec vitest run tests/hook.test.ts` → FAIL (module not found).

- [ ] **Step 3: Implement `apps/mcp/src/cli/hook.ts`**

```ts
import { createHash } from "node:crypto";
import { createEmbeddedBackend } from "../embedded";
import { resolveScopeName } from "../scope";
import { formatMemoryBlock, type RecallForHook } from "./hook-format";
import type { MemoryBackend } from "../backend";

export const HOOK_EVENTS = ["session-start", "user-prompt", "stop", "pre-compact"] as const;
export type HookEvent = (typeof HOOK_EVENTS)[number];

export function isHookEvent(value: string | undefined): value is HookEvent {
  return (HOOK_EVENTS as readonly string[]).includes(value ?? "");
}

/** The fields of Claude Code's hook stdin JSON this module reads (https://code.claude.com/docs/en/hooks). Everything else is passed through untouched. */
export interface HookPayload {
  session_id?: string;
  prompt_id?: string;
  cwd?: string;
  hook_event_name?: string;
  prompt?: string;
  last_assistant_message?: string;
  [key: string]: unknown;
}

export interface HookDeps {
  dataDir: string;
  env: NodeJS.ProcessEnv;
  out: (text: string) => void;
  err: (text: string) => void;
}

const INJECT_BUDGET_CHARS = 4000;
const CAPTURE_MAX_CHARS = 8000;
const CAPTURE_HEAD_CHARS = 6000;
const CAPTURE_TAIL_CHARS = 2000;

/** `cc:<session>:<turn>:<role>` — the idempotency key for one captured message. `turn` is the payload's prompt_id, else a content hash (a host that omits prompt_id still gets exactly-once per distinct text). */
export function captureKey(payload: HookPayload, role: "user" | "assistant", text: string): string {
  const session = payload.session_id?.trim() || "unknown";
  const turn = payload.prompt_id?.trim() || createHash("sha256").update(text).digest("hex").slice(0, 16);
  return `cc:${session}:${turn}:${role}`;
}

/** Keeps the head and tail of an oversized message; the middle of a long reply is the least memorable part. */
export function truncateForCapture(text: string): string {
  if (text.length <= CAPTURE_MAX_CHARS) return text;
  return `${text.slice(0, CAPTURE_HEAD_CHARS)}\n…[truncated]…\n${text.slice(-CAPTURE_TAIL_CHARS)}`;
}

export function isCaptureDisabled(env: NodeJS.ProcessEnv): boolean {
  return (env.STATECORE_CAPTURE ?? "").trim().toLowerCase() === "off";
}

async function withBackend<T>(payload: HookPayload, deps: HookDeps, fn: (backend: MemoryBackend) => Promise<T>): Promise<T> {
  const cwd = payload.cwd?.trim();
  if (!cwd) throw new Error("payload has no cwd; cannot resolve a scope");
  const backend = createEmbeddedBackend({ dataDir: deps.dataDir, scopeName: resolveScopeName(cwd, deps.env), env: deps.env });
  await backend.init();
  try {
    return await fn(backend);
  } finally {
    await backend.close();
  }
}

async function captureMessage(role: "user" | "assistant", raw: string | undefined, payload: HookPayload, deps: HookDeps): Promise<void> {
  if (isCaptureDisabled(deps.env)) return;
  const text = (raw ?? "").trim();
  if (!text) return;
  if (role === "user" && text.startsWith("/")) return; // slash commands are host UI, not conversation
  const content = truncateForCapture(text);
  await withBackend(payload, deps, async (backend) => {
    if (!backend.capture) throw new Error("backend has no capture()");
    await backend.capture({ text: content, key: captureKey(payload, role, text) });
  });
}

/**
 * Runs one hook event against the embedded store. Throws on failure; the
 * `hookMain` wrapper turns that into a stderr line and a clean exit.
 */
export async function runHook(event: HookEvent, payload: HookPayload, deps: HookDeps): Promise<void> {
  switch (event) {
    case "session-start": {
      const block = await withBackend(payload, deps, async (backend) => {
        const recall = (await backend.recall({ maxChars: INJECT_BUDGET_CHARS })) as RecallForHook;
        return formatMemoryBlock(recall);
      });
      if (!block) return;
      deps.out(`${JSON.stringify({ hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: block } })}\n`);
      return;
    }
    case "user-prompt":
      await captureMessage("user", payload.prompt, payload, deps);
      return;
    case "stop":
      await captureMessage("assistant", payload.last_assistant_message, payload, deps);
      return;
    case "pre-compact": {
      const outcome = await withBackend(payload, deps, (backend) => backend.digestNow());
      deps.err(`[statecore-mcp] hook pre-compact: digest ${outcome.ran ? "ran" : `skipped (${outcome.reason})`}\n`);
      return;
    }
  }
}

/** `statecore-mcp hook <event>` entry: parses stdin, dispatches, and never throws or writes to stdout on failure — a hook must not block the host. */
export async function hookMain(event: string | undefined, stdin: string, deps: HookDeps): Promise<void> {
  try {
    if (!isHookEvent(event)) throw new Error(`unknown hook event ${JSON.stringify(event ?? "")}; expected one of ${HOOK_EVENTS.join(", ")}`);
    let payload: HookPayload;
    try {
      payload = stdin.trim() ? (JSON.parse(stdin) as HookPayload) : {};
    } catch (error) {
      throw new Error(`stdin is not valid JSON: ${(error as Error).message}`);
    }
    await runHook(event, payload, deps);
  } catch (error) {
    deps.err(`[statecore-mcp] hook ${event ?? ""} failed: ${(error as Error).message}\n`);
  }
}
```

- [ ] **Step 4: Run tests** — `pnpm --filter statecore-mcp exec vitest run tests/hook.test.ts tests/embedded.test.ts` → PASS. **Step 5: Commit** — `feat(mcp): hook subcommand handlers for Claude Code session-start, user-prompt, stop, pre-compact`

---

### Task 4: `main.ts` dispatch and the built-binary e2e case

**Files:**
- Modify: `apps/mcp/src/main.ts`
- Modify: `apps/mcp/tests/e2e.test.ts`

- [ ] **Step 1: Dispatch** — in `main.ts`: `const SUBCOMMANDS = ["export", "hook"] as const;` and inside the subcommand branch:

```ts
    if (argv[0] === "hook") {
      const stdin = await readStdin();
      await hookMain(argv[1], stdin, {
        dataDir: parseArgs(argv.slice(2)).dataDir ?? defaultDataDir,
        env: process.env,
        out: (text) => process.stdout.write(text),
        err: (text) => process.stderr.write(text)
      });
      return;
    }
```

with, at module level:

```ts
import { hookMain } from "./cli/hook";

/** Reads all of stdin (Claude Code writes the hook payload then closes the pipe). An unattached stdin resolves to "". */
function readStdin(): Promise<string> {
  return new Promise((resolve) => {
    if (process.stdin.isTTY) return resolve("");
    const chunks: Buffer[] = [];
    process.stdin.on("data", (chunk: Buffer) => chunks.push(chunk));
    process.stdin.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    process.stdin.on("error", () => resolve(""));
  });
}
```

The exit code stays 0 on every hook path (`hookMain` never throws; do not set `process.exitCode`).

- [ ] **Step 2: e2e case** — add to `apps/mcp/tests/e2e.test.ts` after the export case:

```ts
  it("`hook session-start` on the built binary injects the remembered memory as hookSpecificOutput", async () => {
    await client.callTool({ name: "remember", arguments: { text: "hook probe fact about lanterns" } });
    const { spawnSync } = await import("node:child_process");
    const payload = JSON.stringify({ session_id: "e2e", cwd: process.cwd(), hook_event_name: "SessionStart", source: "startup" });
    const run = spawnSync(distEntry, ["hook", "session-start", "--data", dataDir], {
      input: payload,
      encoding: "utf8",
      env: { ...getDefaultEnvironment(), STATECORE_SCOPE: "e2e-scope" }
    });
    expect(run.status).toBe(0);
    const doc = JSON.parse(run.stdout);
    expect(doc.hookSpecificOutput.hookEventName).toBe("SessionStart");
    expect(doc.hookSpecificOutput.additionalContext).toContain("hook probe fact about lanterns");

    const bad = spawnSync(distEntry, ["hook", "user-prompt", "--data", dataDir], { input: "{not json", encoding: "utf8", env: getDefaultEnvironment() });
    expect(bad.status).toBe(0);
    expect(bad.stdout).toBe("");
    expect(bad.stderr).toContain("hook user-prompt failed");
  });
```

- [ ] **Step 3: Run** — `pnpm --filter statecore-mcp exec vitest run tests/e2e.test.ts` (rebuilds the bundle) → PASS. Then the whole suite and `tsc --noEmit`. **Step 4: Commit** — `feat(mcp): hook subcommand wired into the CLI; e2e covers session-start on the built binary`

---

### Task 5: the Claude Code plugin and marketplace entry

**Files:**
- Create: `plugins/claude-code/.claude-plugin/plugin.json`, `plugins/claude-code/hooks/hooks.json`, `plugins/claude-code/.mcp.json`, `plugins/claude-code/README.md`
- Create: `.claude-plugin/marketplace.json` (repo root)
- Test: `apps/mcp/tests/plugin-config.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const repoRoot = resolve(__dirname, "../../..");
const pluginRoot = resolve(repoRoot, "plugins/claude-code");
const read = (p: string) => JSON.parse(readFileSync(p, "utf8"));

describe("Claude Code plugin config", () => {
  it("plugin.json names the plugin and tracks the package version", () => {
    const manifest = read(resolve(pluginRoot, ".claude-plugin/plugin.json"));
    const pkg = read(resolve(repoRoot, "apps/mcp/package.json"));
    expect(manifest.name).toBe("statecore");
    expect(manifest.version).toBe(pkg.version);
    expect(typeof manifest.description).toBe("string");
  });

  it("hooks.json wires exactly the four events to `npx -y statecore-mcp hook <event>`", () => {
    const hooks = read(resolve(pluginRoot, "hooks/hooks.json")).hooks;
    expect(Object.keys(hooks).sort()).toEqual(["PreCompact", "SessionStart", "Stop", "UserPromptSubmit"]);
    const commands: Record<string, string[]> = {};
    for (const [event, groups] of Object.entries<any>(hooks)) {
      commands[event] = groups.flatMap((g: any) => g.hooks.map((h: any) => h.command));
      for (const g of groups) for (const h of g.hooks) expect(h.type).toBe("command");
    }
    expect(commands.SessionStart).toEqual(["npx -y statecore-mcp hook session-start"]);
    expect(commands.UserPromptSubmit).toEqual(["npx -y statecore-mcp hook user-prompt"]);
    expect(commands.Stop).toEqual(["npx -y statecore-mcp hook stop"]);
    expect(commands.PreCompact).toEqual(["npx -y statecore-mcp hook pre-compact"]);
    expect(hooks.SessionStart[0].matcher).toBe("startup|resume|clear|compact");
    expect(hooks.PreCompact[0].matcher).toBe("auto|manual");
  });

  it(".mcp.json runs the server with npx", () => {
    const mcp = read(resolve(pluginRoot, ".mcp.json"));
    expect(mcp.statecore).toEqual({ command: "npx", args: ["-y", "statecore-mcp"] });
  });

  it("marketplace.json publishes the plugin from the plugins/claude-code subdirectory", () => {
    const market = read(resolve(repoRoot, ".claude-plugin/marketplace.json"));
    expect(market.name).toBe("statecore");
    const entry = market.plugins.find((p: any) => p.name === "statecore");
    expect(entry.source).toEqual({ source: "git-subdir", url: "https://github.com/yul761/StateCore.git", path: "plugins/claude-code" });
  });
});
```

- [ ] **Step 2: Run to verify failure** → FAIL (ENOENT).

- [ ] **Step 3: Create the files**

`plugins/claude-code/.claude-plugin/plugin.json`:
```json
{
  "name": "statecore",
  "version": "0.6.0",
  "description": "Auditable project memory for Claude Code: captures every prompt and reply into StateCore, re-injects the project's memory at session start and after compaction, and exposes the remember/recall/facts/why/forget/handoff tools.",
  "author": { "name": "yul761", "url": "https://github.com/yul761/StateCore" },
  "homepage": "https://github.com/yul761/StateCore/tree/main/plugins/claude-code",
  "repository": "https://github.com/yul761/StateCore",
  "license": "MIT",
  "keywords": ["memory", "statecore", "mcp", "hooks"]
}
```
(`version` must equal `apps/mcp/package.json`'s current version — read it; the test enforces equality.)

`plugins/claude-code/hooks/hooks.json`:
```json
{
  "hooks": {
    "SessionStart": [
      { "matcher": "startup|resume|clear|compact", "hooks": [{ "type": "command", "command": "npx -y statecore-mcp hook session-start" }] }
    ],
    "UserPromptSubmit": [
      { "matcher": "", "hooks": [{ "type": "command", "command": "npx -y statecore-mcp hook user-prompt" }] }
    ],
    "Stop": [
      { "matcher": "", "hooks": [{ "type": "command", "command": "npx -y statecore-mcp hook stop" }] }
    ],
    "PreCompact": [
      { "matcher": "auto|manual", "hooks": [{ "type": "command", "command": "npx -y statecore-mcp hook pre-compact" }] }
    ]
  }
}
```

`plugins/claude-code/.mcp.json`:
```json
{
  "statecore": { "command": "npx", "args": ["-y", "statecore-mcp"] }
}
```

`.claude-plugin/marketplace.json` (repo root):
```json
{
  "name": "statecore",
  "owner": { "name": "yul761", "url": "https://github.com/yul761" },
  "metadata": { "description": "StateCore plugins for Claude Code", "version": "1.0.0" },
  "plugins": [
    {
      "name": "statecore",
      "description": "Auditable project memory: hooks capture the conversation and re-inject memory; MCP tools for remember/recall/facts/why/forget/handoff.",
      "source": { "source": "git-subdir", "url": "https://github.com/yul761/StateCore.git", "path": "plugins/claude-code" },
      "category": "productivity",
      "keywords": ["memory", "statecore"]
    }
  ]
}
```

`plugins/claude-code/README.md`:
```markdown
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

| When | What happens |
|---|---|
| Session start, resume, `/clear`, after compaction | The project's memory (handoff, digest, facts, recent events) is injected as context, capped at 4000 characters. After a compaction the memory is re-injected so `/compact` never forgets. |
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
```

- [ ] **Step 4: Run the test** → PASS. **Step 5: Commit** — `feat(plugin): Claude Code plugin with capture/inject hooks and marketplace entry`

---

### Task 6: docs and changeset

**Files:**
- Modify: `apps/mcp/README.md` (the "### Claude Code" host-config section)
- Create: `.changeset/mcp-claude-code-hooks.md`

- [ ] **Step 1: README** — in `apps/mcp/README.md` under "### Claude Code", keep the existing `claude mcp add` line as the manual route and add above it:

```markdown
**Plugin (recommended):** installs the MCP server *and* hooks that capture every prompt and reply and re-inject memory at session start and after compaction — no tool call needed for memory to work.

```
/plugin marketplace add yul761/StateCore
/plugin install statecore@statecore
```

See [`plugins/claude-code/README.md`](../../plugins/claude-code/README.md) for what is captured and how to turn capture off (`STATECORE_CAPTURE=off`). The hooks call `statecore-mcp hook <event>`; that subcommand is part of the public CLI.
```

- [ ] **Step 2: Changeset** — `.changeset/mcp-claude-code-hooks.md`:

```markdown
---
"statecore-mcp": minor
---

`statecore-mcp hook <session-start|user-prompt|stop|pre-compact>` reads a Claude Code hook payload from stdin and captures the conversation into project memory (keyed, idempotent stream events) or injects the project's memory as `hookSpecificOutput.additionalContext`. A Claude Code plugin (`plugins/claude-code`, marketplace `yul761/StateCore`) wires the four events and the MCP server. `STATECORE_CAPTURE=off` disables capture. The embedded backend gains an optional `capture({ text, key })` method.
```

- [ ] **Step 3: Verify and commit** — `pnpm --filter statecore-mcp test`, `pnpm lint`; commit `docs(mcp): Claude Code plugin install and hook subcommand; changeset`
