// Copied from apps/worker/src/digest-lookback.ts; keep in sync.

import type { SqlValue } from "./lite-db";

/**
 * Which events a digest run considers.
 *
 * `createdAt` carries two meanings that had been conflated. Ingest sets it to
 * `occurredAt` when the caller supplies one, so it answers "when did this
 * happen" — which is what retrieval and temporal reasoning want. The digest's
 * lookback window, however, needs "when did we learn this", and filtering the
 * second question with the first has a specific and silent failure:
 *
 *   import two years of conversation with occurredAt set
 *     -> every event's createdAt lands outside a 14-day window
 *     -> the digest selects nothing, reports success, writes no facts
 *
 * That is exactly what `occurredAt` exists for, and the field is part of the
 * frozen /v1 contract, so the combination has to work.
 *
 * `ingestedAt` is stamped on write and never moved. The window now admits an
 * event that is recent by either clock: recently ingested, or recently occurred.
 */
export interface DigestWindowInput {
  scopeId: string;
  lookbackDays: number;
  now?: Date;
}

/** A SQL fragment (no leading AND) and its params selecting the events one
 * digest run considers: this scope, unsuppressed, and recent by either clock
 * when a positive lookback is configured. */
export function selectDigestEventWindow(input: DigestWindowInput): { where: string; params: SqlValue[] } {
  const base = { where: `"scopeId" = ? AND "suppressedAt" IS NULL`, params: [input.scopeId] as SqlValue[] };

  // A lookback of zero or less is a misconfiguration, not an instruction to
  // digest nothing. Leaving the window off is the safe reading — the event-count
  // and character budgets still bound the work.
  if (!Number.isFinite(input.lookbackDays) || input.lookbackDays <= 0) return base;

  const cutoff = (input.now ?? new Date()).getTime() - input.lookbackDays * 86_400_000;
  return {
    where: `${base.where} AND ("createdAt" >= ? OR "ingestedAt" >= ?)`,
    params: [...base.params, cutoff, cutoff]
  };
}
