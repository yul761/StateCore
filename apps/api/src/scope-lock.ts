/**
 * Serializes writes to one scope's state snapshot across processes (API
 * replicas and the worker). Postgres runs these transactions at READ
 * COMMITTED with no row lock, so two read-modify-write paths — a note write,
 * a forget, a digest write — could read the same snapshot and the later write
 * would drop the earlier one's change. A transaction-scoped advisory lock on
 * the scope id makes them take turns; it is released at commit or rollback.
 *
 * apps/worker/src/digest-write.ts takes the same lock (same key derivation);
 * keep the two in sync.
 */
export async function lockScopeForWrite(
  tx: { $executeRaw: (query: TemplateStringsArray, ...values: unknown[]) => Promise<unknown> },
  scopeId: string
): Promise<void> {
  // $executeRaw, not $queryRaw: pg_advisory_xact_lock returns void, which
  // $queryRaw cannot deserialize.
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${scopeId}))`;
}
