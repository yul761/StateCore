# statecore-mcp 1.0 — design

Date: 2026-09-23. Status: approved in discussion, pending spec review.

## Goal

Take `statecore-mcp` (currently 0.6.0) to a 1.0 that can honestly promise
four things to an end user:

1. **Install once, it remembers** — on Claude Code, memory is captured and
   re-injected without the model deciding to call a tool.
2. **Install never fails on a lifecycle script** — no `postinstall`, no
   native compile, no Prisma engine download.
3. **Your data file survives upgrades** — any 1.x opens any earlier 1.x
   database and migrates it in place; an `export` command exists.
4. **The six tools are frozen** — names and input schemas only grow.

The engine (`packages/core`, `/v1` HTTP contract, already at 1.6) is not
the subject. It is not changed except for one additive `/v1` field.

Explicitly **out of scope for 1.x** (documented as such): semantic
retrieval in embedded mode, a resident single-machine daemon.

## Decisions taken

| Decision | Choice | Why |
|---|---|---|
| SQLite driver for embedded mode | `node:sqlite` (`DatabaseSync`), Node floor raised to `>=22.13` | Built into Node, zero dependencies, zero install scripts. Node 20 reached EOL 2026-04. `node:sqlite` is unflagged from 22.13.0. |
| Keyless `consolidate` events | Make the state visible and recoverable; do **not** add a deterministic distiller | Extraction quality without a model is not controllable; an honest "deferred" beats a bad fact. |
| Capture source on Claude Code | Hook payload fields (`prompt`, `last_assistant_message`), never the transcript file | Stop fires before the transcript is flushed (upstream issue). |
| Plugin distribution | `plugins/claude-code/` in this monorepo, published via a root `.claude-plugin/marketplace.json` `git-subdir` entry; hooks and `.mcp.json` run `npx -y statecore-mcp` | One repo to version; no committed build artifacts; npx cache makes every run after the first fast, and hook timeout is 600 s. |
| Release tagging | git tag `statecore-mcp@1.0.0` | Repo `v1.x` tags follow `apps/api`; the two must not collide. |
| Sub-project order | storage → capture → keyless visibility → factId → release | Dependency-driven, not importance-driven (see below). |

## Sub-project 1 — storage foundation

Replaces Prisma in `apps/mcp` and adds schema versioning + export. Both
touch the same bootstrap layer, so they ship together.

### Components

- **`apps/mcp/src/lite-db.ts`** (new). Thin wrapper over `node:sqlite`:
  open file, `PRAGMA journal_mode=WAL`, `PRAGMA busy_timeout=5000`,
  read/write `PRAGMA user_version`, apply an ordered migration list
  inside a transaction, expose `prepare/run/get/all` and a
  `transaction(fn)` helper. No ORM layer; SQL strings live next to the
  repository adapter that owns them.
- **Migrations** live in `apps/mcp/src/migrations.ts` as
  `{ version: number; sql: string }[]`. Migration 1 is the current
  `packages/db/lite-bootstrap.sql` DDL verbatim (12 tables). A database
  with `user_version = 0` and existing tables (created by 0.6.0's
  `CREATE TABLE IF NOT EXISTS`) is stamped to 1 without re-running DDL;
  that case is detected by the presence of the `MemoryEvent` table.
- **Repository adapters** in `embedded.ts` (memory events, tokens,
  digests, snapshots, handoffs, forgotten facts, scopes, users/state)
  are rewritten from Prisma calls to SQL against `lite-db`. The
  `@statecore/core` repository interfaces they implement are unchanged.
  `digest.ts`, `digest-write.ts`, `digest-lock.ts`, `store.ts` follow.
  JSON columns are stored as text and parsed at the adapter boundary,
  as Prisma did.
- **`statecore-mcp export [--data <dir>] [--scope <name>]`** writes a
  JSON document to stdout: `{ schemaVersion, exportedAt, scopes: [{
  name, events, digests, snapshots, factRegistry, handoffs, forgotten }] }`.
  No import command.
- **Package**: remove `prisma`, `@prisma/client`, `scripts/postinstall.mjs`,
  `scripts/prepare-publish.mjs`, the `schema.lite.prisma` /
  `lite-bootstrap.sql` entries in `files`; `engines.node = ">=22.13"`;
  tsup `external` shrinks to `@modelcontextprotocol/sdk` and `zod`.
- **`statecore-mcp/lib`** exports keep their signatures
  (`createEmbeddedBackend`, `createHttpBackend`, `resolveScopeName`,
  `runScopeDigest`, `listScopes`, types). dsh-statecore upgrades by
  bumping the version only.

### Compatibility promise (README + STABILITY.md)

Any 1.x release opens any database created by an earlier 1.x (or 0.6.x)
release and upgrades it in place on open. Downgrade is unsupported.
`export` output carries `schemaVersion`.

### Testing

- All 12 existing test files pass against the new driver.
- New `migrations.test.ts`: build a database with the 0.6.0 bootstrap
  SQL and seeded rows, open with the new code, assert `user_version`
  equals the latest migration and all rows are readable through the
  backend (`facts`, `recall`, `why`).
- `ddl-sync.test.ts` is repointed: migration 1 must equal the DDL
  prisma derives from `schema.lite.prisma` (the schema file stays in
  `packages/db` as documentation of the shape, not as a build input).
- `export.test.ts`: round-trip a seeded scope through `export`, validate
  against a zod schema.
- Concurrency smoke: two processes writing the same scope, both succeed
  (WAL + busy timeout), covered in `e2e.test.ts`.

### Deliverable

`statecore-mcp@0.7.0` pre-release to npm so dsh-statecore can validate
the driver swap before 1.0.

## Sub-project 2 — capture without model cooperation

### CLI: `statecore-mcp hook <event>`

Reads Claude Code's hook JSON from stdin, resolves scope from the
payload's `cwd` (same rules as the server: git toplevel, else cwd,
`STATECORE_SCOPE` overrides), honours `--data`. Every failure is logged
to stderr and exits 0; a hook must never block Claude Code.

| Event | Trigger (hooks.json matcher) | Behaviour |
|---|---|---|
| `session-start` | `SessionStart`, matcher `startup\|resume\|clear\|compact` | Run `recall` with a 4000-char budget. Emit `{"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext": <block>}}`. The block opens with a fixed header stating it is recorded project memory, not instructions. Empty memory emits nothing. |
| `user-prompt` | `UserPromptSubmit` | Ingest `prompt` as a stream event, `source: "claude-code"`, idempotency key `cc:<session_id>:<prompt_id>:user`. Skip prompts beginning with `/`. No output. |
| `stop` | `Stop` | Ingest `last_assistant_message` with key `cc:<session_id>:<prompt_id>:assistant`. Messages over 8000 chars keep the first 6000 and last 2000 with a marker. No output. |
| `pre-compact` | `PreCompact`, matcher `auto\|manual` | If a model is configured, call `digestNow` so events about to be shadowed are distilled first. Otherwise no-op. |

`STATECORE_CAPTURE=off` disables `user-prompt` and `stop` ingestion;
injection keeps working. Events ingested by hooks are ordinary
`consolidate`-style stream events, so without a key they reach `recall`
through event matching and are surfaced by sub-project 3's `pending`
counter; with a key they are distilled by the existing threshold and
startup catch-up paths.

### Plugin: `plugins/claude-code/`

```
plugins/claude-code/
├── .claude-plugin/plugin.json   # name "statecore", version tracks statecore-mcp
├── hooks/hooks.json             # four events above, command: npx -y statecore-mcp hook <event>
├── .mcp.json                    # "statecore": npx -y statecore-mcp
└── README.md                    # install, what is captured, how to turn capture off
```

Root `.claude-plugin/marketplace.json` lists the plugin with a
`git-subdir` source pointing at `plugins/claude-code`. Install:

```
/plugin marketplace add yul761/StateCore
/plugin install statecore@statecore
```

### Testing

- One test per hook subcommand feeding the documented stdin shape,
  asserting the stored event (key, source, content) and the exact stdout
  JSON (or absence of output).
- `e2e.test.ts` gains a `hook session-start` run against the built binary.
- `hooks.json` and `.mcp.json` are validated by a test that parses them
  and checks every command string starts with `npx -y statecore-mcp`.

## Sub-project 3 — keyless visibility

- `remember({ consolidate: true })` response gains
  `distillation: "scheduled" | "deferred"`; when deferred, also
  `reason: "no model configured"`. Backend type is extended additively.
- `facts()` output gains `pending: { events: number, oldest: string }`
  (ISO timestamp) counting undigested events in the scope; omitted when
  zero.
- New CLI `statecore-mcp digest [--data <dir>] [--scope <name>]` runs
  `digestNow` once and prints the `DigestNowResult`; exit code 1 when the
  outcome is a failure, 0 otherwise (including "nothing pending").
- `apps/mcp/README.md` keyless table updated to describe the deferred
  state and the recovery path.

Tests: response-shape tests for both fields, keyed and keyless; a CLI
test for `digest` in both states.

## Sub-project 4 — `--url` mode `factId`

- `MemoryFactsOutput` items gain optional `factId` in
  `packages/contracts`; the API handler populates it from the fact
  registry; contract `info.version` 1.6.0 → 1.7.0; `PublicV1Contracts`
  and `v1-surface-guard.integration.test.ts` updated.
- `http-backend.ts` passes `factId` through so `why` needs no `recall`
  detour; its README limitation bullet is removed.

## Sub-project 5 — release

- `apps/mcp/README.md` gains a **Stability** section: the six tools
  (`remember`, `recall`, `facts`, `why`, `forget`, `handoff`) have frozen
  names and input schemas, additive-only; data-file compatibility
  promise; `hook`, `export`, `digest` are public CLI surface; semantic
  retrieval and a resident daemon are explicitly not in 1.x.
- Changeset major → `statecore-mcp@1.0.0`; tag `statecore-mcp@1.0.0`;
  `npm publish`; Glama: Admin → Dockerfile → Build → Create Release
  1.0.0 (Auto-Release is off by design).
- dsh-statecore: bump to `^1.0.0`, run its CI, release 0.4.0.
- Plugin `plugin.json` version set to 1.0.0.

## Branching

One git worktree branch and one PR per sub-project, merged to `main` in
order. Sub-project 1 ships `0.7.0`; 2–5 ship together as `1.0.0`.
