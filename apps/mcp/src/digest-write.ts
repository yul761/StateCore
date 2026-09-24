// Mirrors apps/worker/src/digest-write.ts; keep in sync.
// Atomic digest + state-snapshot writer: one transaction, so a failed snapshot
// write rolls back the digest — no snapshotless latest-digest for data_gc to
// mishandle.
import { randomUUID } from "node:crypto";
import { carryOverConcurrentNotes, type DigestState } from "@statecore/core";
import type { LiteDb } from "./lite-db";
import { nowMs } from "./embedded-repos";
import { parseJson, toJson } from "./rows";

export interface CreateDigestWithSnapshotInput {
  scopeId: string;
  summary: string;
  changes: string; // already-joined "- ..." string
  nextSteps: unknown;
  state: unknown;
  consistency: unknown;
  /** `{ rationale, drops }` — what the selection stage kept and what it discarded. */
  selectionLog?: unknown;
  rebuildGroupId?: string;
}

export async function createDigestWithSnapshot(db: LiteDb, input: CreateDigestWithSnapshotInput): Promise<{ id: string }> {
  return db.transaction(() => {
    // Close the lost-update window for concurrently written notes: the
    // pipeline's state was projected from a snapshot read seconds-to-minutes
    // ago, and this create makes that stale view the latest. A note written to
    // the previous snapshot row in the meantime would silently leave the
    // lineage; re-read the row here and carry such entries over.
    const latest = db.get<{ state: string }>(
      `SELECT "state" FROM "DigestStateSnapshot" WHERE "scopeId" = ? ORDER BY "createdAt" DESC, "id" DESC LIMIT 1`,
      input.scopeId
    );
    const latestState = latest ? parseJson<DigestState | null>(latest.state, null) : null;
    if (latestState) carryOverConcurrentNotes(input.state as DigestState, latestState);

    const now = nowMs();
    const digestId = randomUUID();
    db.run(
      `INSERT INTO "Digest" ("id", "scopeId", "summary", "changes", "nextSteps", "selectionLog", "rebuildGroupId", "createdAt") VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      digestId,
      input.scopeId,
      input.summary,
      input.changes,
      toJson(input.nextSteps),
      input.selectionLog === undefined ? null : toJson(input.selectionLog),
      input.rebuildGroupId ?? null,
      now
    );
    db.run(
      `INSERT INTO "DigestStateSnapshot" ("id", "scopeId", "digestId", "state", "consistency", "createdAt") VALUES (?, ?, ?, ?, ?, ?)`,
      randomUUID(),
      input.scopeId,
      digestId,
      toJson(input.state),
      toJson(input.consistency),
      now
    );
    return { id: digestId };
  });
}
