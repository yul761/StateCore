import type { MemoryEvent, Digest, ProjectScope, MemorySource, MemoryType, ProjectStage } from "@statecore/core";
import type { SqlValue } from "./lite-db";

/** Prisma's SQLite connector stored DateTime as integer unix milliseconds; every
 * write here does the same so 0.6.0 rows and new rows are indistinguishable. */
export function toMs(d: Date): number {
  return d.getTime();
}

/** Reads a DATETIME cell. Integers are unix ms (the only format Prisma wrote);
 * a text value can only come from SQLite's own `CURRENT_TIMESTAMP` default
 * (`YYYY-MM-DD HH:MM:SS`, UTC) on a row inserted by hand, and is accepted too. */
export function fromMs(v: SqlValue): Date {
  if (typeof v === "number" || typeof v === "bigint") return new Date(Number(v));
  if (typeof v === "string") {
    const iso = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(v) ? `${v.replace(" ", "T")}Z` : v;
    return new Date(iso);
  }
  throw new Error(`rows: cannot read a date from ${String(v)}`);
}

export function fromMsNullable(v: SqlValue | undefined): Date | null {
  return v === null || v === undefined ? null : fromMs(v);
}

/** Reads a JSONB cell stored as text. `fallback` covers NULL and the literal
 * text `null` (what Prisma wrote for `Prisma.JsonNull`). */
export function parseJson<T>(v: SqlValue | undefined, fallback: T): T {
  if (typeof v !== "string") return fallback;
  const parsed = JSON.parse(v) as T | null;
  return parsed === null ? fallback : parsed;
}

/** Serializes for a JSONB cell. `undefined` and `null` both become the text
 * `null`, matching what Prisma wrote for `Prisma.JsonNull`. */
export function toJson(v: unknown): string {
  return v === undefined ? "null" : JSON.stringify(v);
}

export function toBool(v: SqlValue): boolean {
  return Number(v) === 1;
}

export function placeholders(n: number): string {
  return Array.from({ length: n }, () => "?").join(", ");
}

export const EVENT_COLUMNS =
  '"id", "userId", "scopeId", "type", "source", "key", "content", "contentHash", "createdAt", "ingestedAt", "updatedAt", "classifiedType", "suppressedAt", "pinned"';

export interface EventRow {
  id: string;
  userId: string;
  scopeId: string;
  type: string;
  source: string;
  key: string | null;
  content: string;
  contentHash: string | null;
  createdAt: number;
  ingestedAt: number;
  updatedAt: number | null;
  classifiedType: string | null;
  suppressedAt: number | null;
  pinned: number;
}

export function eventFromRow(row: EventRow): MemoryEvent {
  return {
    id: row.id,
    userId: row.userId,
    scopeId: row.scopeId,
    type: row.type as MemoryType,
    source: row.source as MemorySource,
    key: row.key,
    content: row.content,
    contentHash: row.contentHash,
    createdAt: fromMs(row.createdAt),
    updatedAt: fromMsNullable(row.updatedAt),
    classifiedType: row.classifiedType,
    pinned: toBool(row.pinned)
  };
}

export const DIGEST_COLUMNS = '"id", "scopeId", "summary", "changes", "nextSteps", "rebuildGroupId", "createdAt"';

export interface DigestRow {
  id: string;
  scopeId: string;
  summary: string;
  changes: string;
  nextSteps: string;
  rebuildGroupId: string | null;
  createdAt: number;
}

export function digestFromRow(row: DigestRow): Digest {
  const nextSteps = parseJson<unknown>(row.nextSteps, []);
  return {
    id: row.id,
    scopeId: row.scopeId,
    summary: row.summary,
    changes: row.changes,
    nextSteps: Array.isArray(nextSteps) ? (nextSteps as string[]) : [],
    rebuildGroupId: row.rebuildGroupId,
    createdAt: fromMs(row.createdAt)
  };
}

export const SCOPE_COLUMNS = '"id", "userId", "name", "goal", "stage", "template", "createdAt"';

export interface ScopeRow {
  id: string;
  userId: string;
  name: string;
  goal: string | null;
  stage: string;
  template: string;
  createdAt: number;
}

export function scopeFromRow(row: ScopeRow): ProjectScope {
  return {
    id: row.id,
    userId: row.userId,
    name: row.name,
    goal: row.goal,
    stage: row.stage as ProjectStage,
    template: row.template,
    createdAt: fromMs(row.createdAt)
  };
}

export interface SnapshotRow {
  id: string;
  state: string;
  createdAt: number;
}
