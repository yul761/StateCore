import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { MemoryBackend } from "./backend";

type ToolResult = { content: Array<{ type: "text"; text: string }>; isError?: boolean };

/**
 * `McpServer.registerTool`'s generic overload combines the SDK's dual zod v3/v4 compatibility
 * union (`AnySchema`) with a mapped type over the input shape; instantiating it for a raw shape
 * with 2+ keys exceeds TypeScript's recursion budget (TS2589) under this repo's `strict` compiler
 * options. Declaring `server`'s tool-registration surface with this narrower, non-generic shape
 * — checked once via the cast below — asserts the same runtime contract without re-triggering that
 * instantiation at each call site; the zod schemas still enforce their constraints at the protocol
 * boundary, and each handler below re-asserts its own argument type from the schema it declared.
 */
interface ToolRegistrar {
  registerTool(
    name: string,
    config: { description: string; inputSchema?: Record<string, z.ZodTypeAny> },
    cb: (args: Record<string, unknown>) => Promise<ToolResult>
  ): unknown;
}

// Shared between the wire-level `inputSchema` raw shape (below) and
// `rememberSchema`'s cross-field refinement: both must accept the same
// field-level constraints so the refinement only ever narrows arguments that
// already passed SDK-level validation.
const rememberShape = {
  text: z
    .string()
    .min(1)
    .max(2000)
    .describe("One self-contained fact, in plain language. Up to 500 characters, or 2000 with consolidate=true."),
  consolidate: z
    .boolean()
    .optional()
    .describe("true for longer conversational context to be distilled into facts in the background; omit for a single fact.")
};

// Enforces the note-path cap (500 chars) that HTTP mode's server already
// enforces via `AddNoteInput.max(500)` (packages/contracts/src/index.ts),
// which the embedded note path (embedded.ts's `addNoteFact`) has no
// equivalent check for — without this, the same `remember` call behaved
// differently per backend. Applied as a second, manual `safeParse` inside the
// handler rather than attached to the wire-level `inputSchema` object below:
// a `.superRefine()`'d `z.object(...)` is a `ZodEffects` with no `.shape`
// property, which the SDK's `normalizeObjectSchema` (zod-compat.js) cannot
// normalize back to an object schema, so `listTools()` would report an empty
// `{}` JSON schema for `remember` instead of its real `text`/`consolidate`
// parameters — breaking client-visible parameter introspection. Keeping the
// refinement here preserves that introspection while still rejecting the
// oversized note before it reaches the backend.
const rememberSchema = z.object(rememberShape).superRefine((value, ctx) => {
  if (!value.consolidate && value.text.length > 500) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "notes are capped at 500 characters; pass consolidate: true for longer conversational content"
    });
  }
});

/** Registers the six memory verbs — remember/recall/facts/why/forget/handoff — as MCP tools backed by `backend`. */
export function registerTools(server: McpServer, backend: MemoryBackend): void {
  const registrar = server as unknown as ToolRegistrar;

  registrar.registerTool(
    "remember",
    {
      description:
        "Store a durable fact about this project or user. Use for preferences, decisions, constraints, and anything worth knowing next session. Deterministic and audit-tracked. Notes (the default path) are capped at 500 characters; pass consolidate=true for longer conversational context, accepted up to 2000 characters and distilled in the background.",
      inputSchema: rememberShape
    },
    async (args) => {
      const parsed = rememberSchema.safeParse(args);
      if (!parsed.success) {
        return { content: [{ type: "text", text: parsed.error.issues.map((issue) => issue.message).join("; ") }], isError: true };
      }
      return json(await backend.remember(parsed.data));
    }
  );
  registrar.registerTool(
    "recall",
    {
      description:
        "Retrieve project memory relevant to a query, packed into a character budget. Read-only. Returns the active session handoff, the distilled digest, believed facts (with factIds for why), recent events, and a budget report of what was left out. Call at the start of a session or before relying on past context; use facts instead to see the whole memory unranked.",
      inputSchema: {
        query: z
          .string()
          .optional()
          .describe("What you are about to work on, in natural language. Ranks facts and events by relevance; omit to rank by confidence and recency."),
        maxChars: z
          .number()
          .int()
          .positive()
          .max(32000)
          .optional()
          .describe("Character budget for the whole response (default 4000, max 32000). Items that do not fit are listed in the budget report, not silently dropped.")
      }
    },
    async (args) => {
      const a = args as { query?: string; maxChars?: number };
      return json(await backend.recall({ query: a.query, maxChars: a.maxChars ?? 4000 }));
    }
  );
  registrar.registerTool(
    "facts",
    {
      description:
        "List everything currently believed about this project, grouped, with each fact's factId (for why) and factKey (for forget), plus how many captured events are still waiting for distillation. Read-only, takes no arguments, and returns the full set unranked. Use to review or audit the memory; use recall instead to get only what is relevant to a task."
    },
    async () => {
      const groups = await backend.facts();
      const pending = backend.pendingEvents ? await backend.pendingEvents() : null;
      return json(pending ? { groups, pending } : { groups });
    }
  );
  registrar.registerTool(
    "why",
    {
      description:
        "Explain why a fact is believed: its source evidence and the full version chain, including superseded and retired versions. Read-only. Use before trusting or correcting a fact that looks stale or surprising.",
      inputSchema: { factId: z.string().min(1).describe("The factId of a fact, as returned by facts or recall, or a handoffId from handoff.") }
    },
    async (args) => json(await backend.why(args as { factId: string }))
  );
  registrar.registerTool(
    "forget",
    {
      description:
        "Suppress a fact that is wrong or no longer relevant, so recall and facts stop returning it. The record is retired, not deleted — why still shows it and the audit chain is preserved. To change a fact rather than drop it, call remember with the corrected version instead; the engine supersedes the old one.",
      inputSchema: { factKey: z.string().min(1).describe("The factKey of the fact to retire, as listed by facts (not its factId).") }
    },
    async (args) => json(await backend.forget(args as { factKey: string }))
  );
  registrar.registerTool(
    "handoff",
    {
      description:
        "Record where this session stopped — a summary, open questions, and next steps — before ending or compacting. The next session (in this client or any other MCP client) receives it at the top of recall; each handoff supersedes the previous one on an auditable chain (why on the returned handoffId walks it). Pass clear=true to retire the active handoff instead.",
      inputSchema: {
        summary: z.string().trim().max(2000).optional(),
        openQuestions: z.array(z.string().trim().min(1).max(500)).max(10).optional(),
        nextSteps: z.array(z.string().trim().min(1).max(500)).max(10).optional(),
        clear: z.boolean().optional()
      }
    },
    async (args) => {
      const a = args as { summary?: string; openQuestions?: string[]; nextSteps?: string[]; clear?: boolean };
      if (!a.clear && !a.summary?.trim()) {
        return { content: [{ type: "text", text: "summary is required unless clear is true" }], isError: true };
      }
      return json(await backend.handoff(a));
    }
  );
}

const json = (v: unknown): ToolResult => ({ content: [{ type: "text", text: JSON.stringify(v, null, 2) }] });
