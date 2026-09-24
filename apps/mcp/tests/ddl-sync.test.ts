// apps/mcp/src/migrations.ts (migration 1) and packages/db/prisma/schema.lite.prisma
// are both hand-maintained, with no gate keeping them in sync (final-review.md
// Important 6). schema.lite.prisma remains the documentation of the shape;
// migration 1 is what actually runs against the embedded node:sqlite store, so
// drift between them means a client writing a column migration 1 never created,
// on a user's first run. This regenerates the DDL prisma itself would produce
// from the current schema and compares it, statement by statement, against the
// committed migration. This suite shells out to packages/db's prisma CLI even
// though apps/mcp itself is Prisma-free, so CI's "Generate Prisma client" step
// and packages/db's prisma devDependency must both stay in place for it to run.
import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { MIGRATIONS } from "../src/migrations";

const dbRoot = resolve(__dirname, "../../../packages/db");

/** Strips `--`-prefixed comment lines (both the `-- CreateTable`/`-- CreateIndex`
 * markers prisma emits and the free-text explanatory comments hand-added to
 * `lite-bootstrap.sql`), then splits on `;` into individual statements, each
 * collapsed to single-spaced text so formatting differences (indentation,
 * line breaks inside a `CREATE TABLE` body) don't register as drift. Also
 * drops the `IF NOT EXISTS` prisma's own `migrate diff --script` never emits
 * but `lite-bootstrap.sql` adds for safe re-application. */
function normalizeStatements(sql: string): string[] {
  const withoutComments = sql
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n");
  return withoutComments
    .split(";")
    .map((stmt) => stmt.replace(/\bIF NOT EXISTS\b/gi, "").replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

describe("migration 1 matches schema.lite.prisma", () => {
  it("regenerating the DDL from the schema yields the same statement set as the committed migration", () => {
    const generated = execFileSync(
      "pnpm",
      ["exec", "prisma", "migrate", "diff", "--from-empty", "--to-schema-datamodel", "prisma/schema.lite.prisma", "--script"],
      { cwd: dbRoot, encoding: "utf8", maxBuffer: 16 * 1024 * 1024, stdio: ["ignore", "pipe", "ignore"] }
    );
    const committed = MIGRATIONS[0].sql;

    const generatedStatements = new Set(normalizeStatements(generated));
    // DigestLock is MCP-private (apps/mcp/src/digest-lock.ts): it has no
    // schema.lite.prisma model, so it can never appear in prisma's generated
    // output and must be excluded from the committed side of the comparison
    // too, or this gate would permanently fail on a table that is correctly
    // absent from the schema.
    const committedStatements = new Set(
      normalizeStatements(committed).filter((stmt) => !stmt.includes('"DigestLock"'))
    );

    const missingFromBootstrap = [...generatedStatements].filter((s) => !committedStatements.has(s));
    const extraInBootstrap = [...committedStatements].filter((s) => !generatedStatements.has(s));

    expect(
      { missingFromBootstrap, extraInBootstrap },
      "apps/mcp/src/migrations.ts (migration 1) has drifted from packages/db/prisma/schema.lite.prisma — regenerate it " +
        "with `pnpm exec prisma migrate diff --from-empty --to-schema-datamodel prisma/schema.lite.prisma --script` " +
        "(cwd packages/db), reapply IF NOT EXISTS, and keep the DigestLock block"
    ).toEqual({ missingFromBootstrap: [], extraInBootstrap: [] });
  }, 30_000);
});
