import { describe, it, expect } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { openLiteDb } from "../src/lite-db";
import { MIGRATIONS, CURRENT_SCHEMA_VERSION } from "../src/migrations";
import { createEmbeddedBackend } from "../src/embedded";

/** Builds a database shaped like a real 0.6.0 file: tables from the 0.6.0 DDL,
 * no user_version, and rows stored the way Prisma's SQLite connector stored
 * them — DATETIME as integer unix ms, JSONB as JSON text, BOOLEAN as 0/1. */
function buildLegacyDatabase(path: string): void {
  const raw = new DatabaseSync(path);
  raw.exec(MIGRATIONS[0].sql); // identical to 0.6.0's lite-bootstrap.sql
  const now = 1786833183844;
  raw.prepare(`INSERT INTO "User" ("id", "identity", "createdAt") VALUES (?, ?, ?)`).run("local", "local", now);
  raw.prepare(`INSERT INTO "ProjectScope" ("id", "userId", "name", "stage", "template", "createdAt") VALUES (?, ?, ?, 'idea', 'project', ?)`).run("scope-1", "local", "/legacy/project", now);
  raw
    .prepare(`INSERT INTO "MemoryEvent" ("id", "userId", "scopeId", "type", "source", "content", "createdAt", "ingestedAt", "pinned") VALUES (?, ?, ?, 'stream', 'api', ?, ?, ?, 0)`)
    .run("ev-1", "local", "scope-1", "legacy event text", now, now);
  raw.prepare(`INSERT INTO "Digest" ("id", "scopeId", "summary", "changes", "nextSteps", "createdAt") VALUES (?, ?, 'Notes', '', '[]', ?)`).run("dg-1", "scope-1", now);
  // Shaped exactly as 0.6.0's addNoteFact (packages/core/src/digest/fact-registry.ts)
  // actually wrote it: facet "notes" (not "note"), and the note text also
  // pushed into profile.notes — evidenceId is pinned to "ev-1" here (rather
  // than addNoteFact's own freshly-minted one) so the provenance test below
  // has a real seeded event to resolve back to.
  const state = {
    stableFacts: { decisions: [] },
    workingNotes: {},
    todos: [],
    profile: { notes: ["We use pnpm"] },
    factRegistry: [
      { id: "reg-1", content: "We use pnpm", type: "profile", confidence: 0.9, addedAt: "2026-08-01T00:00:00.000Z", evidenceId: "ev-1", evidenceType: "event", facet: "notes" }
    ]
  };
  raw
    .prepare(`INSERT INTO "DigestStateSnapshot" ("id", "scopeId", "digestId", "state", "consistency", "createdAt") VALUES (?, ?, ?, ?, 'null', ?)`)
    .run("snap-1", "scope-1", "dg-1", JSON.stringify(state), now);
  expect(raw.prepare("PRAGMA user_version").get()).toEqual(expect.objectContaining({ user_version: 0 }));
  raw.close();
}

describe("opening a 0.6.0 database", () => {
  // openLiteDb (first test) takes the file path; createEmbeddedBackend
  // (second test) takes the containing directory — build the temp dir once
  // and derive both from it, so both tests exercise the same on-disk file.
  const dir = mkdtempSync(join(tmpdir(), "sc-legacy-"));
  const path = join(dir, "statecore.db");
  buildLegacyDatabase(path);

  it("stamps user_version to the current schema and keeps every row readable", () => {
    const db = openLiteDb(path);
    expect(db.userVersion()).toBe(CURRENT_SCHEMA_VERSION);
    expect(db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM "MemoryEvent"`)!.n).toBe(1);
    const snap = db.get<{ state: string; createdAt: number }>(`SELECT "state", "createdAt" FROM "DigestStateSnapshot" WHERE "id" = 'snap-1'`)!;
    expect(JSON.parse(snap.state).factRegistry[0].content).toBe("We use pnpm");
    expect(typeof snap.createdAt).toBe("number");
    db.close();
  });

  it("serves the upgraded 0.6.0 data through the real backend (facts/why/recall)", async () => {
    const be = createEmbeddedBackend({ dataDir: dir, scopeName: "/legacy/project", env: {} as any });
    try {
      await be.init();

      const groups = (await be.facts()) as Array<{ items: Array<{ factId: string | null; text: string }> }>;
      const item = groups.flatMap((g) => g.items).find((i) => i.factId === "reg-1");
      expect(item?.text).toBe("We use pnpm");

      const provenance = (await be.why({ factId: "reg-1" })) as { fact: { content: string; evidenceId: string } };
      expect(provenance.fact.content).toContain("We use pnpm");
      expect(provenance.fact.evidenceId).toBe("ev-1");

      const recallResult = (await be.recall({})) as {
        digest: string | null;
        events: Array<{ content: string }>;
        factRegistry: Array<{ id: string }>;
      };
      expect(recallResult.digest).toBe("Notes");
      expect(recallResult.events).toHaveLength(1);
      expect(recallResult.events[0].content).toBe("legacy event text");
      expect(recallResult.factRegistry.some((f) => f.id === "reg-1")).toBe(true);
    } finally {
      await be.close();
    }
  });
});
