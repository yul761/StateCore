// Atomic digest + state-snapshot writer.
// Wraps the two prisma creates in an interactive $transaction so that a failed
// snapshot write rolls back the digest — no snapshotless latest-digest for
// data_gc to mishandle.

import { carryOverConcurrentNotes, type DigestState, type FacetPack } from "@statecore/core";

export type DigestWriteTx = {
  digest: { create: (args: { data: any }) => Promise<{ id: string }> };
  digestStateSnapshot: {
    create: (args: { data: any }) => Promise<unknown>;
    findFirst: (args: { where: any; orderBy: any }) => Promise<{ state: unknown } | null>;
  };
};

export type DigestWritePrisma = {
  $transaction: <T>(fn: (tx: DigestWriteTx) => Promise<T>) => Promise<T>;
};

export interface CreateDigestWithSnapshotInput {
  scopeId: string;
  summary: string;
  changes: string;       // already-joined "- ..." string
  nextSteps: unknown;
  state: unknown;
  consistency: unknown;
  /** `{ rationale, drops }` — what the selection stage kept and what it discarded. */
  selectionLog?: unknown;
  rebuildGroupId?: string;
  /**
   * The scope's forgotten fact keys. The note carry-over skips (and retires)
   * forgotten notes; without them a digest re-appends every note the pipeline
   * pruned as forgotten, and forgotten notes never free their slots.
   */
  forgottenFactKeys?: ReadonlySet<string>;
  /** The tenant's facet pack (notes cap and display group); defaults to the deployment pack. */
  pack?: FacetPack;
}

export async function createDigestWithSnapshot(
  prisma: DigestWritePrisma,
  input: CreateDigestWithSnapshotInput
): Promise<{ id: string }> {
  return prisma.$transaction(async (tx) => {
    // Close the lost-update window for concurrently written notes: the
    // pipeline's state was projected from a snapshot read seconds-to-minutes
    // ago, and this create makes that stale view the latest. A note written to
    // the previous snapshot row in the meantime would silently leave the
    // lineage; re-read the row here and carry such entries over.
    const latest = await tx.digestStateSnapshot.findFirst({
      where: { scopeId: input.scopeId },
      orderBy: { createdAt: "desc" }
    });
    if (latest?.state) {
      carryOverConcurrentNotes(input.state as DigestState, latest.state as DigestState, {
        forgottenFactKeys: input.forgottenFactKeys,
        pack: input.pack
      });
    }
    const digest = await tx.digest.create({
      data: {
        scopeId: input.scopeId,
        summary: input.summary,
        changes: input.changes,
        nextSteps: input.nextSteps,
        ...(input.selectionLog !== undefined ? { selectionLog: input.selectionLog } : {}),
        ...(input.rebuildGroupId ? { rebuildGroupId: input.rebuildGroupId } : {})
      } as any
    });
    await tx.digestStateSnapshot.create({
      data: {
        scopeId: input.scopeId,
        digestId: digest.id,
        state: input.state,
        consistency: input.consistency
      } as any
    });
    return digest;
  });
}
