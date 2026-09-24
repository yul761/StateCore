import { describe, it, expect } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { openStore } from "../src/store";
import { buildExport, runExport } from "../src/cli/export";
import { CURRENT_SCHEMA_VERSION } from "../src/migrations";
import { seedUser, seedScope, insertEvent, insertDigest, insertSnapshot } from "./helpers/seed";

const iso = z.string().datetime();
const ExportSchema = z.object({
  schemaVersion: z.number().int().positive(),
  exportedAt: iso,
  scopes: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      template: z.string(),
      createdAt: iso,
      events: z.array(z.object({ id: z.string(), type: z.string(), source: z.string(), key: z.string().nullable(), content: z.string(), createdAt: iso, ingestedAt: iso, suppressedAt: iso.nullable(), pinned: z.boolean() })),
      digests: z.array(z.object({ id: z.string(), summary: z.string(), changes: z.string(), nextSteps: z.unknown(), selectionLog: z.unknown(), rebuildGroupId: z.string().nullable(), createdAt: iso })),
      snapshots: z.array(z.object({ id: z.string(), digestId: z.string(), state: z.unknown(), consistency: z.unknown(), createdAt: iso })),
      handoffs: z.array(z.object({ id: z.string(), content: z.string(), createdAt: iso, supersededBy: z.string().nullable(), retiredAt: iso.nullable(), retiredReason: z.string().nullable() })),
      forgotten: z.array(z.object({ factKey: z.string(), contentSnapshot: z.string(), forgottenAt: iso }))
    })
  )
});

describe("export", () => {
  it("buildExport dumps every scope with ISO dates and parsed JSON, and validates against the schema", async () => {
    const dir = mkdtempSync(join(tmpdir(), "sc-export-"));
    const store = await openStore(dir);
    seedUser(store.db);
    const a = seedScope(store.db, { name: "/proj/a" });
    const b = seedScope(store.db, { name: "/proj/b" });
    insertEvent(store.db, { scopeId: a.id, content: "hello a" });
    const digest = insertDigest(store.db, { scopeId: a.id, summary: "Notes", nextSteps: ["x"] });
    insertSnapshot(store.db, { scopeId: a.id, digestId: digest.id, state: { factRegistry: [] } });
    insertEvent(store.db, { scopeId: b.id, content: "hello b" });

    const doc = buildExport(store.db);
    expect(ExportSchema.parse(doc)).toBeTruthy();
    expect(doc.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    expect(doc.scopes.map((s) => s.name)).toEqual(["/proj/a", "/proj/b"]);
    expect(doc.scopes[0].events[0].content).toBe("hello a");
    expect(doc.scopes[0].digests[0].nextSteps).toEqual(["x"]);
    expect(doc.scopes[0].snapshots[0].state).toEqual({ factRegistry: [] });

    const only = buildExport(store.db, "/proj/b");
    expect(only.scopes.map((s) => s.name)).toEqual(["/proj/b"]);
    await store.close();
  });

  it("runExport writes the JSON document to the sink", async () => {
    const dir = mkdtempSync(join(tmpdir(), "sc-export-run-"));
    const store = await openStore(dir);
    seedUser(store.db);
    seedScope(store.db, { name: "/proj/only" });
    await store.close();
    let out = "";
    await runExport({ dataDir: dir }, (text) => (out += text));
    const parsed = ExportSchema.parse(JSON.parse(out));
    expect(parsed.scopes).toHaveLength(1);
  });
});
