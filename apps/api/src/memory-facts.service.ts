import { Injectable, Optional } from "@nestjs/common";
import {
  flattenScopeFacts,
  groupFactsForDisplay,
  attachFactIds,
  addNoteFact,
  retireForgottenNotes,
  resolveFacetPackForScope,
  formatHandoff,
  type DisplayFact
} from "@statecore/core";
import type { DigestState } from "@statecore/core";
import { prisma as defaultPrisma } from "@statecore/db";
import { randomUUID } from "node:crypto";

@Injectable()
export class MemoryFactsService {
  constructor(@Optional() private readonly prisma: typeof defaultPrisma = defaultPrisma) {}

  /**
   * The tenant's facet ontology. A cloud account maps 1:1 onto a core user, so
   * the pack lives on the User row. Resolved per call (cached inside the
   * resolver) rather than read from a process-wide "current pack", which would
   * silently serve one tenant's ontology to another.
   */
  private async packFor(userId: string, scopeId: string) {
    const scope = await this.prisma.projectScope.findUnique({
      where: { id: scopeId },
      select: { template: true }
    });
    return resolveFacetPackForScope(
      {
        findFacetPack: async (id: string) => {
          const row = await this.prisma.user.findUnique({ where: { id }, select: { facetPack: true } });
          return row?.facetPack ?? null;
        }
      },
      userId,
      scope?.template ?? null
    );
  }

  async forgetFact(userId: string, scopeId: string, factKey: string): Promise<{ ok: true }> {
    const snapshot = await this.prisma.digestStateSnapshot.findFirst({
      where: { scopeId },
      orderBy: { createdAt: "desc" }
    });
    const pack = await this.packFor(userId, scopeId);
    const facts = snapshot ? flattenScopeFacts(snapshot.state as unknown as DigestState, undefined, pack) : [];
    const match = facts.find((f) => f.factKey === factKey);
    const contentSnapshot = match?.text ?? "";

    // The ForgottenFact row and the snapshot rewrite commit together. A
    // forgotten note leaves profile.notes and its registry entry is retired,
    // so it stops holding one of the notes facet's slots. The snapshot is
    // re-read inside the transaction; a note write racing it is healed by the
    // next addNote (addNoteFact retires forgotten notes) and a digest racing
    // it by the write-time carry-over, both of which read ForgottenFact.
    const forgotten = new Set([factKey]);
    await this.prisma.$transaction(async (tx: any) => {
      await tx.forgottenFact.upsert({
        where: { scopeId_factKey: { scopeId, factKey } },
        create: { userId, scopeId, factKey, contentSnapshot },
        update: {}
      });
      if (!snapshot) return;
      const latest = await tx.digestStateSnapshot.findFirst({ where: { scopeId }, orderBy: { createdAt: "desc" } });
      if (!latest) return;
      const state = latest.state as unknown as DigestState;
      if (retireForgottenNotes(state, forgotten, () => new Date().toISOString(), pack) > 0) {
        await tx.digestStateSnapshot.update({ where: { id: latest.id }, data: { state: state as any } });
      }
    });

    if (match?.evidenceId) {
      await this.prisma.memoryEvent.updateMany({
        where: { id: match.evidenceId },
        data: { suppressedAt: new Date() }
      });
      // A suppressed event must also leave the lexical index, or it keeps
      // occupying candidate slots that findByIds then filters out.
      await this.prisma.memoryEventToken.deleteMany({ where: { eventId: match.evidenceId } });
    }
    return { ok: true };
  }

  async addNote(userId: string, scopeId: string, text: string): Promise<{ ok: true }> {
    const snap = await this.prisma.digestStateSnapshot.findFirst({
      where: { scopeId },
      orderBy: { createdAt: "desc" }
    });

    if (snap) {
      const state = snap.state as unknown as DigestState;
      // Forgotten keys let a snapshot written before forget retired notes heal
      // here, instead of the cap evicting a live note.
      const forgotten = await this.prisma.forgottenFact.findMany({ where: { scopeId }, select: { factKey: true } });
      const forgottenKeys = new Set(forgotten.map((f: { factKey: string }) => f.factKey));
      if (addNoteFact(state, text, () => randomUUID(), () => new Date().toISOString(), await this.packFor(userId, scopeId), forgottenKeys).changed) {
        await this.prisma.digestStateSnapshot.update({
          where: { id: snap.id },
          data: { state: state as any }
        });
      }
    } else {
      const state: DigestState = {
        stableFacts: { decisions: [] },
        workingNotes: {},
        todos: [],
        factRegistry: [],
        profile: {}
      };
      addNoteFact(state, text, () => randomUUID(), () => new Date().toISOString(), await this.packFor(userId, scopeId));
      // Pending events are those newer than the latest Digest, so a placeholder
      // stamped "now" hid every event ingested before the first note from the
      // digest (it exited no_new_events). Stamp it just before the earliest one.
      const earliest = await this.prisma.memoryEvent.aggregate({ where: { scopeId }, _min: { ingestedAt: true } });
      const oldest: Date | null | undefined = earliest?._min?.ingestedAt;
      const now = new Date();
      const createdAt = oldest && oldest.getTime() - 1 < now.getTime() ? new Date(oldest.getTime() - 1) : now;
      await this.prisma.$transaction(async (tx: any) => {
        const digest = await tx.digest.create({
          data: { scopeId, summary: "Notes", changes: "", nextSteps: [], createdAt }
        });
        await tx.digestStateSnapshot.create({
          data: { scopeId, digestId: digest.id, state: state as any, consistency: null, createdAt }
        });
      });
    }

    return { ok: true };
  }

  // Handoffs live in their own table (SessionHandoff), deliberately not in the
  // digest state snapshot — see packages/core/src/handoff.ts for why. The
  // transaction makes supersession atomic: concurrent writers serialize instead
  // of overwriting each other's whole-JSON state.
  async setHandoff(
    scopeId: string,
    input: { summary?: string; openQuestions?: string[]; nextSteps?: string[]; clear?: boolean }
  ): Promise<{ ok: true; handoffId?: string; superseded: boolean; cleared?: boolean }> {
    if (input.clear) {
      const retired = await this.prisma.sessionHandoff.updateMany({
        where: { scopeId, supersededBy: null, retiredAt: null },
        data: { retiredAt: new Date(), retiredReason: "user_cleared" }
      });
      return { ok: true, superseded: false, cleared: retired.count > 0 };
    }
    const summary = input.summary?.trim();
    // Input validation guarantees this; stated rather than silently no-oping.
    if (!summary) throw new Error("handoff not stored: empty summary");
    const content = formatHandoff({ summary, openQuestions: input.openQuestions, nextSteps: input.nextSteps });
    return this.prisma.$transaction(async (tx: any) => {
      const created = await tx.sessionHandoff.create({ data: { scopeId, content } });
      const superseded = await tx.sessionHandoff.updateMany({
        where: { scopeId, supersededBy: null, retiredAt: null, NOT: { id: created.id } },
        data: { supersededBy: created.id }
      });
      return { ok: true as const, handoffId: created.id, superseded: superseded.count > 0 };
    });
  }

  async getFacts(scopeId: string, userId: string) {
    const [snapshot, forgotten] = await Promise.all([
      this.prisma.digestStateSnapshot.findFirst({ where: { scopeId }, orderBy: { createdAt: "desc" } }),
      this.prisma.forgottenFact.findMany({ where: { scopeId } })
    ]);
    if (!snapshot) return [];
    const forgottenKeys = new Set(forgotten.map((f) => f.factKey));
    const pack = await this.packFor(userId, scopeId);
    const state = snapshot.state as unknown as DigestState;
    const facts: DisplayFact[] = flattenScopeFacts(state, undefined, pack).filter(
      (f) => !forgottenKeys.has(f.factKey)
    );
    return attachFactIds(groupFactsForDisplay(facts, pack), state, pack);
  }
}
