/**
 * The dual-mode hinge: an embedded (keyless, in-process SQLite) and a remote
 * (Task 6/7, talks to a StateCore server) implementation both satisfy this
 * interface, so the MCP tool layer built on it never branches on which mode is
 * active.
 */
export interface MemoryBackend {
  /** Records a fact. Without `consolidate`, upserts into the active facts snapshot; with it, appends a stream event for later digesting. */
  /** `superseded`: content of the active note this one replaced (note-revision supersession). */
  /**
   * `distillation` (consolidate path only): `"scheduled"` when a background
   * digest was queued for the new event; `"deferred"` when none was, with
   * `reason` naming why — `"no model configured"` (no usable LLM) or
   * `"background digest disabled"` (this backend was created with
   * `backgroundDigest: false`, e.g. by the Claude Code hooks).
   */
  remember(input: {
    text: string;
    consolidate?: boolean;
  }): Promise<{
    ok: true;
    mode: "note" | "event";
    superseded?: string;
    distillation?: "scheduled" | "deferred";
    reason?: "no model configured" | "background digest disabled";
  }>;
  /** The engine's retrieve result for `query`, passed through with an added `budget` reporting the requested `maxChars`. */
  recall(input: { query?: string; maxChars?: number }): Promise<unknown>;
  /** Active facts grouped for display, each item carrying `factKey` and `factId` (the latter for `why`). */
  facts(): Promise<unknown>;
  /** The evidence chain for a fact id from `facts()`, or null if the id is unknown. */
  why(input: { factId: string }): Promise<unknown>;
  /** Retires a fact by its `factKey` and suppresses its evidence event; the record is kept, not deleted. */
  forget(input: { factKey: string }): Promise<{ ok: true }>;
  /**
   * Records where this session stopped — summary, open questions, next steps.
   * Each handoff supersedes the previous one on an audit chain (`why` on the
   * returned `handoffId` walks it); the next session (any MCP client) receives
   * the active handoff in its `recall` result. `clear: true` retires the
   * active handoff instead (never deleted). Remote mode calls
   * `POST /v1/memory/handoff`.
   */
  handoff(input: {
    summary?: string;
    openQuestions?: string[];
    nextSteps?: string[];
    clear?: boolean;
  }): Promise<{ ok: true; handoffId?: string; superseded: boolean; cleared?: boolean }>;
  /**
   * Stores a message captured outside the model's control (a host hook
   * relaying a user prompt or an assistant reply) as a keyed stream event.
   * `key` makes the call idempotent: a second capture with the same key in
   * the same scope stores nothing and reports the existing event. Embedded
   * mode only; a backend without it (remote) leaves it undefined.
   */
  capture?(input: { text: string; key: string }): Promise<{ ok: true; stored: boolean; eventId?: string }>;
  /**
   * Count of stream events captured/consolidated since the last digest, plus
   * the oldest one's timestamp (ISO string) — how much is currently waiting
   * for distillation. `null` when nothing is pending. Embedded mode only; a
   * backend without it (remote) leaves it undefined.
   */
  pendingEvents?(): Promise<{ events: number; oldest: string } | null>;
  /**
   * Demands a digest pass now, regardless of the pending-event threshold —
   * for callers at a moment when raw context is about to disappear from a
   * model's view (e.g. a host compacting its conversation). Never rejects.
   * Embedded mode reports how the run ended; remote mode reports
   * `{ ran: false, reason: "unsupported" }` because the server deployment's
   * worker owns digest scheduling and the frozen `/v1` surface exposes no
   * trigger.
   */
  digestNow(): Promise<DigestNowResult>;
  /** Ensures the backend's scope exists and kicks off startup digest catch-up. */
  init(): Promise<void>;
  /** Releases the backend's resources (its store connection). */
  close(): Promise<void>;
}

/**
 * Outcome of one {@link MemoryBackend.digestNow} demand. `ran: true` means a
 * digest pipeline completed and wrote its result; otherwise `reason` names
 * why nothing was written: no usable LLM, nothing pending, another run
 * holding the lock, a failed pipeline (logged to stderr, events left pending
 * for retry), or a backend mode with no digest trigger at all.
 */
export type DigestNowResult =
  | { ran: true }
  | { ran: false; reason: "no-llm" | "below-threshold" | "locked" | "failed" | "unsupported" };
