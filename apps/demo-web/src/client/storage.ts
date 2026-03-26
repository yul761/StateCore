import type { DemoHistoryEntry, StoredDiff, TimelineEntry } from "./lib";

export const HISTORY_STORAGE_PREFIX = "project-memory-demo-history:";
export const TIMELINE_STORAGE_PREFIX = "project-memory-demo-timeline:";
export const DIFF_STORAGE_PREFIX = "project-memory-demo-diff:";

export function historyKey(scopeId: string) {
  return `${HISTORY_STORAGE_PREFIX}${scopeId}`;
}

export function timelineKey(scopeId: string) {
  return `${TIMELINE_STORAGE_PREFIX}${scopeId}`;
}

export function diffKey(scopeId: string) {
  return `${DIFF_STORAGE_PREFIX}${scopeId}`;
}

export function readHistory(scopeId: string | null) {
  if (!scopeId) return [] as DemoHistoryEntry[];
  try {
    const raw = window.localStorage.getItem(historyKey(scopeId));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function writeHistory(scopeId: string | null, items: DemoHistoryEntry[]) {
  if (!scopeId) return;
  window.localStorage.setItem(historyKey(scopeId), JSON.stringify(items.slice(-40)));
}

export function readTimeline(scopeId: string | null) {
  if (!scopeId) return [] as TimelineEntry[];
  try {
    const raw = window.localStorage.getItem(timelineKey(scopeId));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function writeTimeline(scopeId: string | null, items: TimelineEntry[]) {
  if (!scopeId) return;
  window.localStorage.setItem(timelineKey(scopeId), JSON.stringify(items.slice(0, 20)));
}

export function readDiff(scopeId: string | null): StoredDiff {
  if (!scopeId) return { working: [], stable: [] };
  try {
    const raw = window.localStorage.getItem(diffKey(scopeId));
    if (!raw) return { working: [], stable: [] };
    const parsed = JSON.parse(raw);
    return {
      working: Array.isArray(parsed?.working) ? parsed.working : [],
      stable: Array.isArray(parsed?.stable) ? parsed.stable : []
    };
  } catch {
    return { working: [], stable: [] };
  }
}

export function writeDiff(scopeId: string | null, value: StoredDiff) {
  if (!scopeId) return;
  window.localStorage.setItem(diffKey(scopeId), JSON.stringify(value));
}

export function latestAssistantMeta(scopeId: string | null) {
  const items = readHistory(scopeId);
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index];
    if (item?.role === "assistant" && item?.meta) {
      return item.meta;
    }
  }
  return null;
}

export function latestUserTurn(scopeId: string | null) {
  const items = readHistory(scopeId);
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index];
    if (item?.role === "user" && item?.content) {
      return item.content;
    }
  }
  return null;
}
