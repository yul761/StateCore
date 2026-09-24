---
"statecore-mcp": minor
---

The embedded store now runs on Node's built-in `node:sqlite` instead of Prisma.

- No `postinstall`, no native module, no engine download: `npm install --ignore-scripts` and pnpm 10's default script blocking both work.
- Requires Node 22.13 or newer.
- The database file is schema-versioned (`PRAGMA user_version`) and migrated in place on open; 0.6.x files open unchanged.
- New `statecore-mcp export [--data <dir>] [--scope <name>]` prints a JSON dump.
- `runScopeDigest`'s first option is now `db` (was `prisma`). `createEmbeddedBackend`, `createHttpBackend`, `listScopes`, `resolveScopeName` are unchanged.
