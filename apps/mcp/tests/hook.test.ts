// tests are not type-checked by pnpm lint (tsconfig include: ["src"])
import { describe, it, expect } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { runHook, hookMain, captureKey, truncateForCapture, isCaptureDisabled } from "../src/cli/hook";
import { MEMORY_BLOCK_HEADER } from "../src/cli/hook-format";
import { createEmbeddedBackend } from "../src/embedded";
import { openStore } from "../src/store";
import { findScopeByName } from "./helpers/seed";

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
  it("uses prompt_id when present, else a content hash; assistant keys also carry an 8-hex content hash so two different replies to one prompt_id don't collide", () => {
    expect(captureKey({ session_id: "s1", prompt_id: "p7" }, "user", "hi")).toBe("cc:s1:p7:user");
    const digest16 = createHash("sha256").update("hi").digest("hex").slice(0, 16);
    const digest8 = createHash("sha256").update("hi").digest("hex").slice(0, 8);
    expect(captureKey({ session_id: "s1" }, "assistant", "hi")).toBe(`cc:s1:${digest16}:assistant:${digest8}`);
    expect(captureKey({ session_id: "s1", prompt_id: "p7" }, "assistant", "hi")).toBe(`cc:s1:p7:assistant:${digest8}`);
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
    const digest8 = createHash("sha256").update(long).digest("hex").slice(0, 8);
    expect(row.key).toBe(`cc:s1:p1:assistant:${digest8}`);
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

  it("a user-prompt captured earlier is recallable in session-start's injected block", async () => {
    const f = fresh();
    await runHook(
      "user-prompt",
      { session_id: "s1", prompt_id: "p1", cwd: f.cwd, prompt: "we decided to ship the zephyr build on friday" },
      f.deps
    );

    await runHook("session-start", { session_id: "s2", cwd: f.cwd, hook_event_name: "SessionStart" }, f.deps);
    expect(f.out).toHaveLength(1);
    const doc = JSON.parse(f.out[0]);
    const block: string = doc.hookSpecificOutput.additionalContext;
    expect(block).toContain("### Recent events");
    expect(block).toContain("zephyr build on friday");
  });

  it("deps.scopeName (--scope) overrides scope resolution; a payload with no cwd still lands in that scope", async () => {
    const f = fresh();
    const scopedDeps = { ...f.deps, scopeName: "/tmp/statecore-explicit-scope" };
    await runHook("user-prompt", { session_id: "s1", prompt_id: "p1", prompt: "scoped via --scope, no cwd in the payload" }, scopedDeps);

    const store = await openStore(f.dataDir);
    try {
      const scope = findScopeByName(store.db, "/tmp/statecore-explicit-scope");
      expect(scope).toBeTruthy();
      const rows = store.db.all<{ scopeId: string; content: string }>(`SELECT "scopeId", "content" FROM "MemoryEvent"`);
      expect(rows).toEqual([{ scopeId: scope!.id, content: "scoped via --scope, no cwd in the payload" }]);
    } finally {
      await store.close();
    }
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
