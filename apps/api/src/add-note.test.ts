import { describe, it, expect, vi } from "vitest";
import type { DigestState } from "@statecore/core";
import { MemoryFactsService } from "./memory-facts.service";
import { makeMockPrisma } from "./test-support/mock-prisma";

const baseState = (): DigestState => ({
  stableFacts: { decisions: [] },
  workingNotes: {},
  todos: [],
  factRegistry: [],
  profile: {}
});

describe("MemoryFactsService.addNote", () => {
  it("with existing snapshot: updates snapshot and persists the note text", async () => {
    const existingState = baseState();
    const updateMock = vi.fn().mockResolvedValue({});
    const mockPrisma = makeMockPrisma({
      digestStateSnapshot: {
        findFirst: vi.fn().mockResolvedValue({ id: "s1", state: existingState }),
        update: updateMock
      }
    });

    const service = new MemoryFactsService(mockPrisma);
    const result = await service.addNote("user-1", "scope-1", "Remember to check the API limits");

    expect(result).toEqual({ ok: true });
    expect(updateMock).toHaveBeenCalledOnce();

    const updatedState = updateMock.mock.calls[0][0].data.state;
    expect(updatedState.profile?.notes).toBeDefined();
    expect(updatedState.profile.notes).toContain("Remember to check the API limits");
  });

  it("with existing snapshot: also surfaces note in getFacts as Notes group", async () => {
    const existingState = baseState();
    const capturedState = { current: existingState };
    const updateMock = vi.fn().mockImplementation(async (args: any) => {
      capturedState.current = args.data.state;
    });
    const mockPrisma = makeMockPrisma({
      digestStateSnapshot: {
        findFirst: vi.fn().mockResolvedValue({ id: "s1", state: existingState }),
        update: updateMock
      }
    });

    const service = new MemoryFactsService(mockPrisma);
    await service.addNote("user-1", "scope-1", "Deploy to prod on Friday");

    // Now simulate getFacts on the updated state
    const getFacstPrisma = makeMockPrisma({
      digestStateSnapshot: {
        findFirst: vi.fn().mockResolvedValue({ state: capturedState.current })
      },
      forgottenFact: { findMany: vi.fn().mockResolvedValue([]) }
    });
    const service2 = new MemoryFactsService(getFacstPrisma);
    const groups = await service2.getFacts("scope-1", "user-1");

    const notesGroup = groups.find((g) => g.group === "Notes");
    expect(notesGroup).toBeDefined();
    expect(notesGroup!.items.map((i) => i.text)).toContain("Deploy to prod on Friday");
  });

  it("idempotency: calling addNote twice with same text does not duplicate", async () => {
    const state = baseState();
    // Track updates so second call sees updated state
    const updateMock = vi.fn().mockImplementation(async (args: any) => {
      Object.assign(state, args.data.state);
    });
    const findFirstMock = vi.fn()
      .mockResolvedValueOnce({ id: "s1", state: state })
      .mockResolvedValueOnce({ id: "s1", state: state });

    const mockPrisma = makeMockPrisma({
      digestStateSnapshot: {
        findFirst: findFirstMock,
        update: updateMock
      }
    });

    const service = new MemoryFactsService(mockPrisma);
    await service.addNote("user-1", "scope-1", "API keys rotate every 90 days");
    await service.addNote("user-1", "scope-1", "API keys rotate every 90 days");

    // update should only be called once (second call is idempotent, addNoteFact returns false)
    expect(updateMock).toHaveBeenCalledOnce();
    // Notes array should have exactly 1 entry
    expect(state.profile?.notes?.length).toBe(1);
  });

  it("no-snapshot path: creates a digest + snapshot via $transaction with the note", async () => {
    const txMock = vi.fn().mockImplementation(async (fn: any) => {
      const tx = {
        digest: {
          create: vi.fn().mockResolvedValue({ id: "digest-1" })
        },
        digestStateSnapshot: {
          create: vi.fn().mockResolvedValue({})
        }
      };
      await fn(tx);
      return { tx };
    });
    const mockPrisma = makeMockPrisma({
      digestStateSnapshot: {
        findFirst: vi.fn().mockResolvedValue(null)
      },
      $transaction: txMock
    });

    const service = new MemoryFactsService(mockPrisma);
    const result = await service.addNote("user-1", "scope-new", "First note ever");

    expect(result).toEqual({ ok: true });
    expect(txMock).toHaveBeenCalledOnce();

    // Introspect transaction calls
    const txFn = txMock.mock.calls[0][0];
    const digestCreate = vi.fn().mockResolvedValue({ id: "digest-1" });
    const snapshotCreate = vi.fn().mockResolvedValue({});
    await txFn({ digest: { create: digestCreate }, digestStateSnapshot: { create: snapshotCreate } });

    expect(digestCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ scopeId: "scope-new", summary: "Notes" }) })
    );

    const snapshotData = snapshotCreate.mock.calls[0][0].data;
    expect(snapshotData.state?.profile?.notes).toContain("First note ever");
  });

  it("no-snapshot path: stamps the placeholder digest just before the scope's earliest event, so those events stay pending", async () => {
    // A placeholder stamped "now" put every earlier event behind the latest
    // Digest: the pending count missed them and the pipeline exited no_new_events.
    const earliest = new Date("2026-09-01T10:00:00.000Z");
    const digestCreate = vi.fn().mockResolvedValue({ id: "digest-1" });
    const snapshotCreate = vi.fn().mockResolvedValue({});
    const mockPrisma = makeMockPrisma({
      digestStateSnapshot: { findFirst: vi.fn().mockResolvedValue(null) },
      memoryEvent: { aggregate: vi.fn().mockResolvedValue({ _min: { ingestedAt: earliest } }) },
      $transaction: vi.fn(async (fn: any) => fn({ digest: { create: digestCreate }, digestStateSnapshot: { create: snapshotCreate } }))
    });

    await new MemoryFactsService(mockPrisma).addNote("user-1", "scope-1", "First note");

    expect(mockPrisma.memoryEvent.aggregate).toHaveBeenCalledWith({ where: { scopeId: "scope-1" }, _min: { ingestedAt: true } });
    const createdAt: Date = digestCreate.mock.calls[0][0].data.createdAt;
    expect(createdAt.getTime()).toBe(earliest.getTime() - 1);
    expect(snapshotCreate.mock.calls[0][0].data.createdAt.getTime()).toBe(earliest.getTime() - 1);
  });

  it("no-snapshot path: stamps now when the scope has no events", async () => {
    const digestCreate = vi.fn().mockResolvedValue({ id: "digest-1" });
    const mockPrisma = makeMockPrisma({
      digestStateSnapshot: { findFirst: vi.fn().mockResolvedValue(null) },
      $transaction: vi.fn(async (fn: any) => fn({ digest: { create: digestCreate }, digestStateSnapshot: { create: vi.fn() } }))
    });
    const before = Date.now();

    await new MemoryFactsService(mockPrisma).addNote("user-1", "scope-1", "First note");

    expect(digestCreate.mock.calls[0][0].data.createdAt.getTime()).toBeGreaterThanOrEqual(before);
  });

  it("heals a forgotten note still holding a slot instead of evicting a live note at the cap", async () => {
    const { computeFactKey } = await import("@statecore/core");
    const texts = Array.from({ length: 30 }, (_, i) => `主题${String.fromCharCode(0x4e00 + i * 13)}的笔记`);
    const state = baseState();
    state.profile = { notes: [...texts] };
    state.factRegistry = texts.map((content, i) => ({
      id: `n${i}`, content, type: "profile" as const, confidence: 0.9, addedAt: "2026-06-27T00:00:00.000Z",
      evidenceId: `ev${i}`, evidenceType: "event" as const, facet: "notes"
    }));
    const update = vi.fn().mockResolvedValue({});
    const mockPrisma = makeMockPrisma({
      digestStateSnapshot: { findFirst: vi.fn().mockResolvedValue({ id: "s1", state }), update },
      forgottenFact: { findMany: vi.fn().mockResolvedValue([{ factKey: computeFactKey("Notes", texts[3]) }]) }
    });

    await new MemoryFactsService(mockPrisma).addNote("user-1", "scope-1", "a brand new note");

    const notes = update.mock.calls[0][0].data.state.profile.notes as string[];
    expect(notes).toHaveLength(30);
    expect(notes).toContain(texts[0]); // the oldest live note was not evicted
    expect(notes).not.toContain(texts[3]);
    expect(notes).toContain("a brand new note");
  });
});
