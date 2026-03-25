import type { WorkingMemoryState, WorkingMemoryEventLike } from "./working-memory.extractor";
import { extractWorkingMemoryState } from "./working-memory.extractor";
import {
  compileWorkingMemoryView,
  type WorkingMemoryView
} from "./working-memory.compiler";

export interface WorkingMemorySnapshot {
  id: string;
  scopeId: string;
  version: number;
  state: WorkingMemoryState;
  view: WorkingMemoryView;
  createdAt: Date;
  updatedAt: Date;
}

export interface WorkingMemoryRepo {
  findLatest(scopeId: string): Promise<WorkingMemorySnapshot | null>;
  upsert(input: {
    scopeId: string;
    version: number;
    state: WorkingMemoryState;
    view: WorkingMemoryView;
  }): Promise<WorkingMemorySnapshot>;
}

export interface WorkingMemoryServiceOptions {
  maxItemsPerField?: number;
}

export class WorkingMemoryService {
  constructor(
    private repo: WorkingMemoryRepo,
    private options?: WorkingMemoryServiceOptions
  ) {}

  async getLatest(scopeId: string) {
    return this.repo.findLatest(scopeId);
  }

  async updateFromEvents(scopeId: string, events: WorkingMemoryEventLike[]) {
    const previous = await this.repo.findLatest(scopeId);
    const state = extractWorkingMemoryState(events, {
      maxItemsPerField: this.options?.maxItemsPerField
    });
    const view = compileWorkingMemoryView(state);
    return this.repo.upsert({
      scopeId,
      version: (previous?.version ?? 0) + 1,
      state,
      view
    });
  }
}
