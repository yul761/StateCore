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
  // backgroundDigest: false — this process exits right after fn() returns
  // (close() runs in the finally below), so it must never block on the
  // fire-and-forget startup-catchup/threshold digest chains a long-lived
  // host would let run in the background. digestNow() (used by pre-compact)
  // is unaffected and remains this short-lived caller's one distillation
  // moment.
  const backend = createEmbeddedBackend({ dataDir: deps.dataDir, scopeName: resolveScopeName(cwd, deps.env), env: deps.env, backgroundDigest: false });
  try {
    // init() inside the try: a failure here (e.g. a corrupt store) must still
    // reach close() below, since init() may have already opened the store
    // connection that close() needs to release.
    await backend.init();
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
