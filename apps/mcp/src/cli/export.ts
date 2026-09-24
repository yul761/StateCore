import { getActiveFactRegistry, type DigestState, type FactRegistryEntry } from "@statecore/core";
import { openStore } from "../store";
import type { LiteDb } from "../lite-db";
import { fromMs, fromMsNullable, parseJson, toBool } from "../rows";

const EMPTY_STATE = (): DigestState => ({ stableFacts: { decisions: [] }, workingNotes: {}, todos: [], factRegistry: [], profile: {} });

export interface ExportDocument {
  schemaVersion: number;
  exportedAt: string;
  scopes: Array<{
    id: string;
    name: string;
    template: string;
    createdAt: string;
    events: Array<{ id: string; type: string; source: string; key: string | null; content: string; createdAt: string; ingestedAt: string; suppressedAt: string | null; pinned: boolean }>;
    digests: Array<{ id: string; summary: string; changes: string; nextSteps: unknown; selectionLog: unknown; rebuildGroupId: string | null; createdAt: string }>;
    snapshots: Array<{ id: string; digestId: string; state: unknown; consistency: unknown; createdAt: string }>;
    factRegistry: FactRegistryEntry[];
    handoffs: Array<{ id: string; content: string; createdAt: string; supersededBy: string | null; retiredAt: string | null; retiredReason: string | null }>;
    forgotten: Array<{ factKey: string; contentSnapshot: string; forgottenAt: string }>;
  }>;
}

const isoOrNull = (v: number | null): string | null => fromMsNullable(v)?.toISOString() ?? null;

/**
 * A complete, self-describing dump of the embedded store: every scope (or one,
 * by name) with its events, digests, snapshots, handoffs and forgotten facts.
 * Dates are ISO-8601 strings and JSON columns are parsed, so the document is
 * readable without knowing the on-disk conventions. `schemaVersion` is the
 * store's `PRAGMA user_version` at export time.
 */
export function buildExport(db: LiteDb, scopeName?: string): ExportDocument {
  const scopes = scopeName
    ? db.all<{ id: string; name: string; template: string; createdAt: number }>(`SELECT "id", "name", "template", "createdAt" FROM "ProjectScope" WHERE "name" = ? ORDER BY "name"`, scopeName)
    : db.all<{ id: string; name: string; template: string; createdAt: number }>(`SELECT "id", "name", "template", "createdAt" FROM "ProjectScope" ORDER BY "name"`);
  return {
    schemaVersion: db.userVersion(),
    exportedAt: new Date().toISOString(),
    scopes: scopes.map((scope) => ({
      id: scope.id,
      name: scope.name,
      template: scope.template,
      createdAt: fromMs(scope.createdAt).toISOString(),
      events: db
        .all<{ id: string; type: string; source: string; key: string | null; content: string; createdAt: number; ingestedAt: number; suppressedAt: number | null; pinned: number }>(
          `SELECT "id", "type", "source", "key", "content", "createdAt", "ingestedAt", "suppressedAt", "pinned" FROM "MemoryEvent" WHERE "scopeId" = ? ORDER BY "createdAt", "id"`,
          scope.id
        )
        .map((e) => ({ ...e, createdAt: fromMs(e.createdAt).toISOString(), ingestedAt: fromMs(e.ingestedAt).toISOString(), suppressedAt: isoOrNull(e.suppressedAt), pinned: toBool(e.pinned) })),
      digests: db
        .all<{ id: string; summary: string; changes: string; nextSteps: string; selectionLog: string | null; rebuildGroupId: string | null; createdAt: number }>(
          `SELECT "id", "summary", "changes", "nextSteps", "selectionLog", "rebuildGroupId", "createdAt" FROM "Digest" WHERE "scopeId" = ? ORDER BY "createdAt", "id"`,
          scope.id
        )
        .map((d) => ({ ...d, nextSteps: parseJson<unknown>(d.nextSteps, []), selectionLog: parseJson<unknown>(d.selectionLog, null), createdAt: fromMs(d.createdAt).toISOString() })),
      snapshots: db
        .all<{ id: string; digestId: string; state: string; consistency: string | null; createdAt: number }>(
          `SELECT "id", "digestId", "state", "consistency", "createdAt" FROM "DigestStateSnapshot" WHERE "scopeId" = ? ORDER BY "createdAt", "id"`,
          scope.id
        )
        .map((s) => ({ ...s, state: parseJson<unknown>(s.state, null), consistency: parseJson<unknown>(s.consistency, null), createdAt: fromMs(s.createdAt).toISOString() })),
      factRegistry: (() => {
        const latest = db.get<{ state: string }>(
          `SELECT "state" FROM "DigestStateSnapshot" WHERE "scopeId" = ? ORDER BY "createdAt" DESC, "id" DESC LIMIT 1`,
          scope.id
        );
        return latest ? getActiveFactRegistry(parseJson<DigestState>(latest.state, EMPTY_STATE())) : [];
      })(),
      handoffs: db
        .all<{ id: string; content: string; createdAt: number; supersededBy: string | null; retiredAt: number | null; retiredReason: string | null }>(
          `SELECT "id", "content", "createdAt", "supersededBy", "retiredAt", "retiredReason" FROM "SessionHandoff" WHERE "scopeId" = ? ORDER BY "createdAt", "id"`,
          scope.id
        )
        .map((h) => ({ ...h, createdAt: fromMs(h.createdAt).toISOString(), retiredAt: isoOrNull(h.retiredAt) })),
      forgotten: db
        .all<{ factKey: string; contentSnapshot: string; forgottenAt: number }>(
          `SELECT "factKey", "contentSnapshot", "forgottenAt" FROM "ForgottenFact" WHERE "scopeId" = ? ORDER BY "forgottenAt"`,
          scope.id
        )
        .map((f) => ({ ...f, forgottenAt: fromMs(f.forgottenAt).toISOString() }))
    }))
  };
}

/**
 * `statecore-mcp export [--data <dir>] [--scope <name>]`: writes the document
 * as pretty JSON to `out`. When `scopeName` is given but matches no scope in
 * the store, the (empty-`scopes`) document is still written to `out` — `err`
 * additionally gets a one-line note so the mistake isn't silent — and the
 * returned `found` is `false`, which `main.ts` turns into a non-zero exit
 * code.
 */
export async function runExport(
  args: { dataDir: string; scopeName?: string },
  out: (text: string) => void,
  err: (text: string) => void = (text) => process.stderr.write(text)
): Promise<{ found: boolean }> {
  const store = await openStore(args.dataDir);
  try {
    const doc = buildExport(store.db, args.scopeName);
    out(JSON.stringify(doc, null, 2) + "\n");
    const found = args.scopeName === undefined || doc.scopes.length > 0;
    if (!found) err(`statecore-mcp export: no scope named "${args.scopeName}"\n`);
    return { found };
  } finally {
    await store.close();
  }
}
